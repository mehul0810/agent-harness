import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
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
  return references;
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

    return {
      ok: diagnostics.length === 0,
      command,
      exitCode: diagnostics.length === 0 ? EXIT_CODES.OK : EXIT_CODES.VALIDATION_FAILED,
      diagnostics,
      summary: {
        projectRoot,
        filesChecked: files.size,
        scenariosChecked: config.scenarios.length,
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
