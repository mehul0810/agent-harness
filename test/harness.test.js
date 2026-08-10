import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EXIT_CODES,
  executeCli,
  formatCliResult,
  initProject,
  validateProject,
  validateRunRecordObject,
} from '../src/index.js';

const temporaryDirectories = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-'));
  temporaryDirectories.push(directory);
  return directory;
}

test.after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
}

function baseConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    projectRoot: '.',
    requiredFiles: ['README.md', 'skills/example/SKILL.md'],
    requiredPhrases: [{ file: 'README.md', phrases: ['Required phrase'] }],
    skillBudgets: {
      defaultMaxWords: 3,
      files: ['skills/example/SKILL.md'],
      overrides: {},
    },
    routeBudgets: [{ name: 'main', maxWords: 6, files: ['skills/example/SKILL.md', 'route.md'] }],
    scenarios: [{ name: 'happy', file: 'scenario.md', requiredPhrases: ['Expected: pass'] }],
    ...overrides,
  };
}

async function projectFixture(config = baseConfig(), fileOverrides = {}) {
  const root = await temporaryDirectory();
  await writeFiles(root, {
    'README.md': 'Required phrase\n',
    'skills/example/SKILL.md': 'one two three',
    'route.md': 'four five six',
    'scenario.md': 'Expected: pass\n',
    ...fileOverrides,
  });
  await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(config)}\n`, 'utf8');
  return root;
}

function diagnosticCodes(result) {
  return result.diagnostics.map((item) => item.code);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceDigest(files) {
  const hash = createHash('sha256');
  for (const [file, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    const bytes = Buffer.from(content);
    hash.update(file);
    hash.update('\0');
    hash.update(String(bytes.length));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function scenarioDigest(id, file, anchor, line) {
  const hash = createHash('sha256');
  for (const value of [id, file, anchor, line]) {
    hash.update(value);
    hash.update('\0');
  }
  return hash.digest('hex');
}

test('validates a project at exact skill and route word-budget boundaries', async () => {
  const root = await projectFixture();
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, EXIT_CODES.OK);
  assert.deepEqual(result.summary, { projectRoot: await realpath(root), filesChecked: 4, scenariosChecked: 1, behaviorBaselinesChecked: 0 });
});

test('binds behavior evidence to exact source, scenario, run checks, outcome, and telemetry', async () => {
  const root = await temporaryDirectory();
  const sourceFiles = { 'skills/example/SKILL.md': 'bounded behavior\n' };
  const scenarioLine = 'Scenario: bounded behavior must remain observable.';
  const sourceSha = sourceDigest(sourceFiles);
  const scenarioSha = scenarioDigest('bounded-behavior', 'evals/scenarios.md', 'Scenario: bounded behavior', scenarioLine);
  const run = {
    schemaVersion: 1,
    runId: 'run-001',
    scenario: 'bounded-behavior',
    result: 'succeeded',
    startedAt: new Date().toISOString(),
    durationMs: 20,
    checks: [{ name: 'scope', result: 'pass' }],
    metrics: { checks_passed: 1, input_tokens: 80 },
    tags: ['source-blind'],
    lineage: { verificationId: 'run-001', artifactPointer: 'evals/run-001.json' },
    measurement: { status: 'met', verifiedAt: new Date().toISOString(), summary: 'Observed behavior met the bounded scenario.' },
  };
  const runText = `${JSON.stringify(run)}\n`;
  const config = {
    schemaVersion: 1,
    projectRoot: '.',
    requiredFiles: [],
    requiredPhrases: [],
    routeBudgets: [],
    scenarios: [],
    behaviorBaselines: [{
      name: 'bounded',
      sourceFiles: Object.keys(sourceFiles),
      sourceSha256: sourceSha,
      scenario: { id: 'bounded-behavior', files: ['evals/scenarios.md'], anchors: ['Scenario: bounded behavior'], sha256: scenarioSha },
      requiredChecks: ['scope'],
      requiredTags: ['source-blind'],
      maxAgeDays: 1,
      telemetryBudgets: [{ metric: 'input_tokens', required: true, max: 100 }],
      evidence: { runRecord: 'evals/run-001.json', runRecordSha256: sha256(runText), testedSourceSha256: sourceSha, testedScenarioSha256: scenarioSha },
    }],
  };
  await writeFiles(root, { ...sourceFiles, 'evals/scenarios.md': `${scenarioLine}\n`, 'evals/run-001.json': runText });
  await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(config)}\n`);

  const valid = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  await writeFile(path.join(root, 'skills/example/SKILL.md'), 'changed behavior\n');
  const stale = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.ok(diagnosticCodes(stale).includes('BEHAVIOR_SOURCE_STALE'));
});

test('reports a missing required file', async () => {
  const config = baseConfig({ requiredFiles: ['README.md', 'missing.md'] });
  const root = await projectFixture(config);
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.exitCode, EXIT_CODES.VALIDATION_FAILED);
  assert.ok(diagnosticCodes(result).includes('FILE_MISSING'));
});

test('reports missing required and scenario phrases', async () => {
  const root = await projectFixture(baseConfig(), {
    'README.md': 'No match\n',
    'scenario.md': 'Expected: fail\n',
  });
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.ok(diagnosticCodes(result).includes('PHRASE_MISSING'));
  assert.ok(diagnosticCodes(result).includes('SCENARIO_PHRASE_MISSING'));
});

test('reports a skill budget exceeded by one word', async () => {
  const root = await projectFixture(baseConfig(), { 'skills/example/SKILL.md': 'one two three four' });
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));
  const budget = result.diagnostics.find((item) => item.code === 'SKILL_BUDGET_EXCEEDED');

  assert.deepEqual({ actualWords: budget.actualWords, maxWords: budget.maxWords }, { actualWords: 4, maxWords: 3 });
});

test('applies skill budget overrides', async () => {
  const config = baseConfig({
    skillBudgets: {
      defaultMaxWords: 3,
      files: ['skills/example/SKILL.md'],
      overrides: { 'skills/example/SKILL.md': 4 },
    },
    routeBudgets: [],
  });
  const root = await projectFixture(config, { 'skills/example/SKILL.md': 'one two three four' });
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.ok, true);
});

test('reports a named route budget exceeded by one word', async () => {
  const config = baseConfig({
    skillBudgets: undefined,
    routeBudgets: [{ name: 'main', maxWords: 5, files: ['skills/example/SKILL.md', 'route.md'] }],
  });
  delete config.skillBudgets;
  const root = await projectFixture(config);
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));
  const budget = result.diagnostics.find((item) => item.code === 'ROUTE_BUDGET_EXCEEDED');

  assert.deepEqual({ route: budget.route, actualWords: budget.actualWords, maxWords: budget.maxWords }, {
    route: 'main',
    actualWords: 6,
    maxWords: 5,
  });
});

test('emits a non-failing route warning at the configured utilization', async () => {
  const config = baseConfig({
    skillBudgets: undefined,
    routeBudgets: [{ name: 'main', maxWords: 7, warningPercent: 85, files: ['skills/example/SKILL.md', 'route.md'] }],
  });
  delete config.skillBudgets;
  const root = await projectFixture(config);
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, EXIT_CODES.OK);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.warnings.map((item) => item.code), ['ROUTE_BUDGET_WARNING']);
  assert.match(formatCliResult(result), /^WARNING ROUTE_BUDGET_WARNING:/);
});

test('rejects an out-of-range route warning percentage', async () => {
  const config = baseConfig({
    routeBudgets: [{ name: 'main', maxWords: 7, warningPercent: 101, files: ['route.md'] }],
  });
  const root = await projectFixture(config);
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.ok(result.diagnostics.some((item) => item.path === '$.routeBudgets[0].warningPercent'));
});

test('rejects traversal paths before reading project files', async () => {
  const config = baseConfig({ requiredFiles: ['../outside.md'], requiredPhrases: [], skillBudgets: undefined, routeBudgets: [], scenarios: [] });
  delete config.skillBudgets;
  const root = await projectFixture(config);
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));

  assert.equal(result.exitCode, EXIT_CODES.UNSAFE_PATH);
  assert.deepEqual(diagnosticCodes(result), ['UNSAFE_PATH']);
});

test('rejects a symlink that resolves outside the project root', async () => {
  const root = await projectFixture(baseConfig({ requiredFiles: ['escape.md'], requiredPhrases: [], skillBudgets: undefined, routeBudgets: [], scenarios: [] }));
  const outside = await temporaryDirectory();
  const outsideFile = path.join(outside, 'outside.md');
  await writeFile(outsideFile, 'outside\n', 'utf8');
  await symlink(outsideFile, path.join(root, 'escape.md'));
  const config = JSON.parse(await readFile(path.join(root, 'agent-harness.config.json'), 'utf8'));
  delete config.skillBudgets;
  await writeFile(path.join(root, 'agent-harness.config.json'), JSON.stringify(config), 'utf8');

  const result = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.equal(result.exitCode, EXIT_CODES.UNSAFE_PATH);
});

test('validates sanitized run records and rejects extra payload fields', () => {
  const record = {
    schemaVersion: 1,
    runId: 'run-001',
    scenario: 'happy-path',
    result: 'succeeded',
    startedAt: '2026-07-14T05:00:00.000Z',
    durationMs: 42,
    checks: [{ name: 'contract', result: 'pass' }],
    metrics: { checksPassed: 1 },
  };

  assert.equal(validateRunRecordObject(record).valid, true);
  const unsafePayload = validateRunRecordObject({ ...record, prompt: 'sensitive text' });
  assert.equal(unsafePayload.valid, false);
  assert.equal(unsafePayload.diagnostics[0].path, '$.prompt');
});

test('rejects successful run records without passing checks or closed outcome evidence', () => {
  const record = {
    schemaVersion: 1,
    runId: 'run-closure',
    scenario: 'closure',
    result: 'succeeded',
    startedAt: '2026-07-14T05:00:00.000Z',
    durationMs: 1,
    checks: [{ name: 'contract', result: 'fail' }],
    metrics: {},
    measurement: { status: 'met' },
  };
  const result = validateRunRecordObject(record);
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.path === '$.checks'));
  assert.ok(result.diagnostics.some((item) => item.path === '$.measurement.verifiedAt'));
  assert.ok(result.diagnostics.some((item) => item.path === '$.measurement.summary'));
});

test('validates sanitized lineage and measurement without accepting payload data', () => {
  const record = {
    schemaVersion: 1,
    runId: 'run-lineage-001',
    scenario: 'feedback-outcome',
    result: 'succeeded',
    startedAt: '2026-07-18T05:00:00.000Z',
    durationMs: 42,
    checks: [{ name: 'contract', result: 'pass' }],
    metrics: { issues_created: 1, outcome_delta: 0.2 },
    lineage: {
      observationId: 'obs-001',
      decisionId: 'decision-001',
      actionId: 'https://github.com/example/repo/issues/1',
      verificationId: 'verify-001',
      learningCandidateId: 'lc_123456789abc'
    },
    measurement: {
      status: 'met',
      windowEndsAt: '2026-07-25T05:00:00.000Z',
      verifiedAt: '2026-07-25T05:05:00.000Z',
      metricNames: ['outcome_delta'],
      summary: 'The bounded outcome met its target.'
    }
  };

  assert.equal(validateRunRecordObject(record).valid, true);
  assert.equal(validateRunRecordObject({ ...record, lineage: { prompt: 'do not store this' } }).valid, false);
  assert.equal(validateRunRecordObject({ ...record, measurement: { status: 'claimed' } }).valid, false);
});

test('accepts loop lifecycle outcomes and keeps check results separate', () => {
  for (const result of ['succeeded', 'no-op', 'blocked', 'failed', 'escalated']) {
    const record = {
      schemaVersion: 1,
      runId: `run-${result}`,
      scenario: 'lifecycle',
      result,
      startedAt: '2026-07-14T05:00:00.000Z',
      durationMs: 1,
      checks: [{ name: 'contract', result: 'pass' }],
      metrics: {},
    };
    assert.equal(validateRunRecordObject(record).valid, true);
  }

  const invalid = validateRunRecordObject({
    schemaVersion: 1,
    runId: 'run-invalid',
    scenario: 'lifecycle',
    result: 'pass',
    startedAt: '2026-07-14T05:00:00.000Z',
    durationMs: 1,
    checks: [{ name: 'contract', result: 'succeeded' }],
    metrics: {},
  });
  assert.equal(invalid.valid, false);
});

test('validate-run rejects invalid timestamps and negative durations', async () => {
  const root = await temporaryDirectory();
  await writeFile(path.join(root, 'run.json'), JSON.stringify({
    schemaVersion: 1,
    runId: 'run-001',
    scenario: 'happy-path',
    result: 'succeeded',
    startedAt: 'yesterday',
    durationMs: -1,
    checks: [],
    metrics: {},
  }), 'utf8');

  const result = await executeCli(['validate-run', '--file', 'run.json'], { cwd: root });
  assert.equal(result.exitCode, EXIT_CODES.VALIDATION_FAILED);
  assert.ok(result.diagnostics.some((item) => item.path === '$.startedAt'));
  assert.ok(result.diagnostics.some((item) => item.path === '$.durationMs'));
  assert.ok(result.diagnostics.some((item) => item.path === '$.checks'));
});

test('init creates a valid scaffold and never overwrites existing files', async () => {
  const root = await temporaryDirectory();
  const first = await initProject('skills', 'project', { cwd: root });
  assert.equal(first.ok, true);

  const target = path.join(root, 'project');
  const validation = await validateProject(path.join(target, 'agent-harness.config.json'));
  assert.equal(validation.ok, true);

  await writeFile(path.join(target, 'README.md'), 'owner content\n', 'utf8');
  const second = await initProject('skills', 'project', { cwd: root });
  assert.equal(second.exitCode, EXIT_CODES.INIT_CONFLICT);
  assert.equal(await readFile(path.join(target, 'README.md'), 'utf8'), 'owner content\n');
});

test('CLI emits machine-readable JSON and rejects unsafe run paths', async () => {
  const root = await projectFixture();
  const result = await executeCli(['validate', '--config', 'agent-harness.config.json', '--json'], { cwd: root });
  const output = JSON.parse(formatCliResult(result));
  assert.equal(output.ok, true);
  assert.equal(output.exitCode, 0);

  const unsafe = await executeCli(['validate-run', '--file', '../run.json'], { cwd: root });
  assert.equal(unsafe.exitCode, EXIT_CODES.UNSAFE_PATH);
});
