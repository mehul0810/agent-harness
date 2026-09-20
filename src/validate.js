import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EXIT_CODES } from './constants.js';
import { validateConfigObject, validateRunRecordObject } from './contracts.js';
import { diagnostic, failureResult, HarnessError } from './errors.js';
import { resolveCliPath, resolveProjectFile, resolveProjectRoot } from './path-safety.js';

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

async function readJsonFile(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    throw new HarnessError(`${label} could not be read.`, { code: 'FILE_UNREADABLE', path: filePath });
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new HarnessError(`${label} is not valid JSON: ${error.message}`, { code: 'JSON_INVALID', path: filePath });
  }
}

function projectReferences(config) {
  const references = new Set(config.requiredFiles);
  config.requiredPhrases.forEach((rule) => references.add(rule.file));
  config.skillBudgets?.files.forEach((file) => references.add(file));
  config.routeBudgets.forEach((route) => route.files.forEach((file) => references.add(file)));
  config.scenarios.forEach((scenario) => references.add(scenario.file));
  config.behaviorBaselines.forEach((baseline) => {
    baseline.sourceFiles.forEach((file) => references.add(file));
    baseline.scenario.files.forEach((file) => references.add(file));
    references.add(baseline.evidence.runRecord);
  });
  return references;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function digestFiles(files, configuredPaths) {
  const hash = createHash('sha256');
  for (const configuredPath of [...configuredPaths].sort()) {
    const file = files.get(configuredPath);
    if (!file?.exists || !file.isFile) return null;
    const bytes = await readFile(file.path);
    hash.update(configuredPath);
    hash.update('\0');
    hash.update(String(bytes.length));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function digestScenario(files, scenario, diagnostics, baselineName) {
  const hash = createHash('sha256');
  hash.update(scenario.id);
  hash.update('\0');
  for (const configuredPath of [...scenario.files].sort()) {
    const file = files.get(configuredPath);
    if (!file?.exists || !file.isFile) return null;
    const content = await readFile(file.path, 'utf8');
    const lines = content.split(/\r?\n/u);
    for (const anchor of scenario.anchors) {
      const matches = lines.filter((line) => line.includes(anchor));
      if (matches.length !== 1) {
        diagnostics.push(diagnostic('BEHAVIOR_SCENARIO_ANCHOR_INVALID', `Behavior baseline ${JSON.stringify(baselineName)} anchor must match exactly one line; found ${matches.length}.`, {
          path: configuredPath,
          baseline: baselineName,
          anchor,
        }));
        continue;
      }
      hash.update(configuredPath);
      hash.update('\0');
      hash.update(anchor);
      hash.update('\0');
      hash.update(matches[0]);
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

async function validateBehaviorBaseline(baseline, files, diagnostics, now = Date.now()) {
  const sourceDigest = await digestFiles(files, baseline.sourceFiles);
  const scenarioDigest = await digestScenario(files, baseline.scenario, diagnostics, baseline.name);
  if (sourceDigest !== null && sourceDigest !== baseline.sourceSha256) {
    diagnostics.push(diagnostic('BEHAVIOR_SOURCE_STALE', `Behavior baseline ${JSON.stringify(baseline.name)} no longer matches its source files.`, { baseline: baseline.name }));
  }
  if (scenarioDigest !== null && scenarioDigest !== baseline.scenario.sha256) {
    diagnostics.push(diagnostic('BEHAVIOR_SCENARIO_STALE', `Behavior baseline ${JSON.stringify(baseline.name)} no longer matches its scenario anchors.`, { baseline: baseline.name }));
  }
  if (baseline.evidence.testedSourceSha256 !== baseline.sourceSha256 || baseline.evidence.testedScenarioSha256 !== baseline.scenario.sha256) {
    diagnostics.push(diagnostic('BEHAVIOR_EVIDENCE_STALE', `Behavior evidence for ${JSON.stringify(baseline.name)} was produced for different source or scenario content.`, { baseline: baseline.name }));
  }

  const runFile = files.get(baseline.evidence.runRecord);
  if (!runFile?.exists || !runFile.isFile) return;
  let runBytes;
  let run;
  try {
    runBytes = await readFile(runFile.path);
    run = JSON.parse(runBytes.toString('utf8'));
  } catch (error) {
    diagnostics.push(diagnostic('BEHAVIOR_RUN_INVALID', `Behavior evidence for ${JSON.stringify(baseline.name)} is not valid JSON: ${error.message}`, {
      path: baseline.evidence.runRecord,
      baseline: baseline.name,
    }));
    return;
  }
  if (sha256(runBytes) !== baseline.evidence.runRecordSha256) {
    diagnostics.push(diagnostic('BEHAVIOR_RUN_DIGEST_MISMATCH', `Behavior run record for ${JSON.stringify(baseline.name)} changed after approval.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  }
  const contract = validateRunRecordObject(run);
  for (const item of contract.diagnostics) {
    diagnostics.push(diagnostic('BEHAVIOR_RUN_CONTRACT_INVALID', `${baseline.name}: ${item.message}`, { path: baseline.evidence.runRecord, baseline: baseline.name, contractPath: item.path }));
  }
  if (!contract.valid) return;

  const fileRunId = path.basename(baseline.evidence.runRecord, path.extname(baseline.evidence.runRecord));
  if (run.runId !== fileRunId) diagnostics.push(diagnostic('BEHAVIOR_RUN_ID_MISMATCH', `Run ID must match evidence filename ${JSON.stringify(fileRunId)}.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  if (run.scenario !== baseline.scenario.id) diagnostics.push(diagnostic('BEHAVIOR_RUN_SCENARIO_MISMATCH', `Behavior run for ${JSON.stringify(baseline.name)} used a different scenario.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  if (run.result !== 'succeeded') diagnostics.push(diagnostic('BEHAVIOR_RUN_NOT_SUCCESSFUL', `Behavior run for ${JSON.stringify(baseline.name)} did not succeed.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));

  const expectedChecks = [...baseline.requiredChecks].sort();
  const actualChecks = run.checks.map((check) => check.name).sort();
  if (JSON.stringify(actualChecks) !== JSON.stringify(expectedChecks) || run.checks.some((check) => check.result !== 'pass')) {
    diagnostics.push(diagnostic('BEHAVIOR_CHECK_SET_INVALID', `Behavior run for ${JSON.stringify(baseline.name)} must contain exactly the required passing checks.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  }
  if (run.metrics.checks_passed !== run.checks.length) diagnostics.push(diagnostic('BEHAVIOR_CHECK_COUNT_INVALID', `Behavior run for ${JSON.stringify(baseline.name)} must report checks_passed equal to its check count.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  for (const tag of baseline.requiredTags ?? []) {
    if (!run.tags?.includes(tag)) diagnostics.push(diagnostic('BEHAVIOR_TAG_MISSING', `Behavior run for ${JSON.stringify(baseline.name)} is missing required tag ${JSON.stringify(tag)}.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  }
  if (run.lineage?.verificationId !== run.runId || typeof run.lineage?.artifactPointer !== 'string' || run.lineage.artifactPointer.trim() === '') {
    diagnostics.push(diagnostic('BEHAVIOR_LINEAGE_INVALID', `Behavior run for ${JSON.stringify(baseline.name)} must point to its verification ID and durable artifact.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  }
  if (run.measurement?.status !== 'met') diagnostics.push(diagnostic('BEHAVIOR_MEASUREMENT_UNVERIFIED', `Behavior run for ${JSON.stringify(baseline.name)} requires a measured outcome.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  if (baseline.maxAgeDays !== undefined) {
    const ageMs = now - Date.parse(run.startedAt);
    if (ageMs < 0 || ageMs > baseline.maxAgeDays * 86400000) diagnostics.push(diagnostic('BEHAVIOR_EVIDENCE_EXPIRED', `Behavior run for ${JSON.stringify(baseline.name)} is outside its ${baseline.maxAgeDays}-day freshness window.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
  }
  for (const budget of baseline.telemetryBudgets ?? []) {
    const value = run.metrics[budget.metric];
    if (value === undefined) {
      if (budget.required === true) diagnostics.push(diagnostic('BEHAVIOR_TELEMETRY_MISSING', `Behavior run for ${JSON.stringify(baseline.name)} is missing required metric ${JSON.stringify(budget.metric)}.`, { path: baseline.evidence.runRecord, baseline: baseline.name }));
      continue;
    }
    const allowed = budget.max ?? (budget.baseline * (1 + budget.maxRegressionPercent / 100));
    if (value > allowed) diagnostics.push(diagnostic('BEHAVIOR_TELEMETRY_EXCEEDED', `Behavior run metric ${JSON.stringify(budget.metric)} is ${value}; limit is ${allowed}.`, { path: baseline.evidence.runRecord, baseline: baseline.name, metric: budget.metric, actual: value, max: allowed }));
  }
}

function contentReferences(config) {
  const references = new Set();
  config.requiredPhrases.forEach((rule) => references.add(rule.file));
  config.skillBudgets?.files.forEach((file) => references.add(file));
  config.routeBudgets.forEach((route) => route.files.forEach((file) => references.add(file)));
  config.scenarios.forEach((scenario) => references.add(scenario.file));
  return references;
}

export async function validateProject(configPath) {
  const command = 'validate';
  try {
    const resolvedConfig = await realpath(path.resolve(configPath));
    const configStats = await stat(resolvedConfig);
    if (!configStats.isFile()) throw new Error('not a file');

    const input = await readJsonFile(resolvedConfig, 'Configuration');
    const contract = validateConfigObject(input);
    if (!contract.valid) {
      return { ok: false, command, exitCode: EXIT_CODES.INVALID_INPUT, diagnostics: contract.diagnostics };
    }

    const config = contract.value;
    const projectRoot = await resolveProjectRoot(path.dirname(resolvedConfig), config.projectRoot);
    const files = new Map();
    const diagnostics = [];
    const warnings = [];

    for (const configuredPath of projectReferences(config)) {
      const file = await resolveProjectFile(projectRoot, configuredPath);
      files.set(configuredPath, file);
      if (!file.exists) {
        diagnostics.push(diagnostic('FILE_MISSING', 'Required file is missing.', { path: configuredPath }));
      } else if (!file.isFile) {
        diagnostics.push(diagnostic('FILE_NOT_REGULAR', 'Configured path is not a regular file.', { path: configuredPath }));
      }
    }

    const contents = new Map();
    for (const configuredPath of contentReferences(config)) {
      const file = files.get(configuredPath);
      if (!file?.exists || !file.isFile) continue;
      try {
        contents.set(configuredPath, await readFile(file.path, 'utf8'));
      } catch {
        diagnostics.push(diagnostic('FILE_UNREADABLE', 'Configured file could not be read as UTF-8 text.', { path: configuredPath }));
      }
    }

    for (const rule of config.requiredPhrases) {
      const content = contents.get(rule.file);
      if (content === undefined) continue;
      for (const phrase of rule.phrases) {
        if (!content.includes(phrase)) {
          diagnostics.push(diagnostic('PHRASE_MISSING', `Missing required phrase: ${JSON.stringify(phrase)}.`, { path: rule.file }));
        }
      }
    }

    if (config.skillBudgets) {
      for (const file of config.skillBudgets.files) {
        const content = contents.get(file);
        if (content === undefined) continue;
        const actualWords = countWords(content);
        const maxWords = config.skillBudgets.overrides[file] ?? config.skillBudgets.defaultMaxWords;
        if (actualWords > maxWords) {
          diagnostics.push(diagnostic('SKILL_BUDGET_EXCEEDED', `Skill uses ${actualWords} words; limit is ${maxWords}.`, {
            path: file,
            actualWords,
            maxWords,
          }));
        }
      }
    }

    for (const route of config.routeBudgets) {
      if (route.files.some((file) => !contents.has(file))) continue;
      const actualWords = route.files.reduce((total, file) => total + countWords(contents.get(file)), 0);
      if (actualWords > route.maxWords) {
        diagnostics.push(diagnostic('ROUTE_BUDGET_EXCEEDED', `Route ${JSON.stringify(route.name)} uses ${actualWords} words; limit is ${route.maxWords}.`, {
          route: route.name,
          actualWords,
          maxWords: route.maxWords,
        }));
      } else if (route.warningPercent !== undefined && actualWords * 100 >= route.maxWords * route.warningPercent) {
        warnings.push(diagnostic('ROUTE_BUDGET_WARNING', `Route ${JSON.stringify(route.name)} uses ${actualWords} words; warning threshold is ${route.warningPercent}% of ${route.maxWords}.`, {
          severity: 'warning',
          route: route.name,
          actualWords,
          maxWords: route.maxWords,
          warningPercent: route.warningPercent,
        }));
      }
    }

    for (const scenario of config.scenarios) {
      const content = contents.get(scenario.file);
      if (content === undefined) continue;
      for (const phrase of scenario.requiredPhrases) {
        if (!content.includes(phrase)) {
          diagnostics.push(diagnostic('SCENARIO_PHRASE_MISSING', `Scenario ${JSON.stringify(scenario.name)} is missing phrase ${JSON.stringify(phrase)}.`, {
            path: scenario.file,
            scenario: scenario.name,
          }));
        }
      }
    }

    for (const baseline of config.behaviorBaselines) {
      await validateBehaviorBaseline(baseline, files, diagnostics);
    }

    return {
      ok: diagnostics.length === 0,
      command,
      exitCode: diagnostics.length === 0 ? EXIT_CODES.OK : EXIT_CODES.VALIDATION_FAILED,
      diagnostics,
      warnings,
      summary: {
        projectRoot,
        filesChecked: files.size,
        scenariosChecked: config.scenarios.length,
        behaviorBaselinesChecked: config.behaviorBaselines.length,
      },
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return failureResult(command, new HarnessError('Configuration file does not exist.', { code: 'FILE_MISSING', path: configPath }));
    }
    return failureResult(command, error);
  }
}

export async function planContext(configPath, routeName) {
  const command = 'plan-context';
  try {
    const resolvedConfig = await realpath(path.resolve(configPath));
    const input = await readJsonFile(resolvedConfig, 'Configuration');
    const contract = validateConfigObject(input);
    if (!contract.valid) {
      return { ok: false, command, exitCode: EXIT_CODES.INVALID_INPUT, diagnostics: contract.diagnostics };
    }

    const route = contract.value.routeBudgets.find((candidate) => candidate.name === routeName);
    if (!route) {
      return failureResult(command, new HarnessError(`Unknown context route: ${routeName}`, {
        code: 'ROUTE_NOT_FOUND',
      }));
    }

    const projectRoot = await resolveProjectRoot(path.dirname(resolvedConfig), contract.value.projectRoot);
    const files = [];
    for (const configuredPath of route.files) {
      const file = await resolveProjectFile(projectRoot, configuredPath);
      if (!file.exists || !file.isFile) {
        return failureResult(command, new HarnessError('Context route file is missing or not a regular file.', {
          code: file.exists ? 'FILE_NOT_REGULAR' : 'FILE_MISSING',
          path: configuredPath,
        }));
      }
      let content;
      try {
        content = await readFile(file.path, 'utf8');
      } catch {
        return failureResult(command, new HarnessError('Context route file could not be read as UTF-8 text.', {
          code: 'FILE_UNREADABLE',
          path: configuredPath,
        }));
      }
      files.push({ path: configuredPath, words: countWords(content) });
    }

    const actualWords = files.reduce((total, file) => total + file.words, 0);
    const warnings = [];
    if (
      actualWords <= route.maxWords
      && route.warningPercent !== undefined
      && actualWords * 100 >= route.maxWords * route.warningPercent
    ) {
      warnings.push(diagnostic(
        'ROUTE_BUDGET_WARNING',
        `Route ${JSON.stringify(route.name)} uses ${actualWords} words; warning threshold is ${route.warningPercent}% of ${route.maxWords}.`,
        {
          severity: 'warning',
          route: route.name,
          actualWords,
          maxWords: route.maxWords,
          warningPercent: route.warningPercent,
        },
      ));
    }
    return {
      ok: actualWords <= route.maxWords,
      command,
      exitCode: actualWords <= route.maxWords ? EXIT_CODES.OK : EXIT_CODES.VALIDATION_FAILED,
      diagnostics: actualWords <= route.maxWords ? [] : [diagnostic(
        'ROUTE_BUDGET_EXCEEDED',
        `Route ${JSON.stringify(route.name)} uses ${actualWords} words; limit is ${route.maxWords}.`,
        { route: route.name, actualWords, maxWords: route.maxWords },
      )],
      warnings,
      summary: {
        route: route.name,
        files,
        actualWords,
        maxWords: route.maxWords,
        headroomWords: route.maxWords - actualWords,
      },
    };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return failureResult(command, new HarnessError('Configuration file does not exist.', { code: 'FILE_MISSING', path: configPath }));
    }
    return failureResult(command, error);
  }
}

export async function validateRunFile(filePath, { cwd = process.cwd() } = {}) {
  const command = 'validate-run';
  try {
    const resolvedPath = await resolveCliPath(cwd, filePath, { mustExist: true });
    const fileStats = await stat(resolvedPath);
    if (!fileStats.isFile()) {
      throw new HarnessError('Run record path is not a regular file.', { code: 'FILE_NOT_REGULAR', path: filePath });
    }
    const input = await readJsonFile(resolvedPath, 'Run record');
    const contract = validateRunRecordObject(input);
    return {
      ok: contract.valid,
      command,
      exitCode: contract.valid ? EXIT_CODES.OK : EXIT_CODES.VALIDATION_FAILED,
      diagnostics: contract.diagnostics,
      summary: contract.valid ? { runId: input.runId, scenario: input.scenario, result: input.result } : undefined,
    };
  } catch (error) {
    return failureResult(command, error);
  }
}
