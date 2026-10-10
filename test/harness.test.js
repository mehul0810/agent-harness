import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readRegularFile, FILE_LIMITS } from '../src/bounded-read.js';
import {
  EXIT_CODES,
  executeCli,
  formatCliResult,
  initProject,
  planContext,
  validateProject,
  validateRunFile,
  validateConfigObject,
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

async function createSparseFile(filePath, size) {
  const handle = await open(filePath, 'w');
  try { await handle.truncate(size); } finally { await handle.close(); }
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

async function runRealCli(cwd, args) {
  const child = spawn(process.execPath, [path.resolve('bin/agent-harness.js'), ...args, '--json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI exceeded test timeout')); }, 2000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); resolve({ stdout, stderr, code }); });
  });
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

function scenarioDigest(id, scenarioFiles, fixtureFiles = {}) {
  const hash = createHash('sha256');
  hash.update('full-contract-v2');
  hash.update('\0');
  hash.update(id);
  hash.update('\0');
  for (const [kind, files] of [['scenario', scenarioFiles], ['fixture', fixtureFiles]]) {
    hash.update(kind);
    hash.update('\0');
    for (const [file, content] of Object.entries(files).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      const bytes = Buffer.from(content);
      hash.update(file);
      hash.update('\0');
      hash.update(String(bytes.length));
      hash.update('\0');
      hash.update(bytes);
      hash.update('\0');
    }
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

test('plans a deterministic minimum context bundle for a named route', async () => {
  const root = await projectFixture();
  const result = await planContext(path.join(root, 'agent-harness.config.json'), 'main');

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    route: 'main',
    files: [
      { path: 'skills/example/SKILL.md', words: 3 },
      { path: 'route.md', words: 3 },
    ],
    actualWords: 6,
    maxWords: 6,
    headroomWords: 0,
  });
});

test('rejects an unknown context route without reading unrelated files', async () => {
  const root = await projectFixture();
  const result = await planContext(path.join(root, 'agent-harness.config.json'), 'missing');

  assert.equal(result.ok, false);
  assert.deepEqual(diagnosticCodes(result), ['ROUTE_NOT_FOUND']);
});

test('supports plan-context through the CLI', async () => {
  const root = await projectFixture();
  const result = await executeCli(['plan-context', '--config', 'agent-harness.config.json', '--route', 'main'], { cwd: root });

  assert.equal(result.ok, true);
  assert.match(formatCliResult(result), /Context route: main/);
  assert.match(formatCliResult(result), /Total: 6\/6 words; headroom 0/);
});

test('bounded readers reject FIFOs without waiting for a writer in API and CLI paths', async () => {
  const root = await projectFixture();
  const fifo = path.join(root, 'pipe');
  execFileSync('mkfifo', [fifo]);
  const started = Date.now();
  const api = await planContext(fifo, 'main');
  assert.equal(api.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.equal(diagnosticCodes(api)[0], 'FILE_NOT_REGULAR');

  await writeFile(path.join(root, 'agent-harness.config.json'), '');
  await rm(path.join(root, 'agent-harness.config.json'));
  await symlink(fifo, path.join(root, 'agent-harness.config.json'));
  const validation = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.equal(validation.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.equal(diagnosticCodes(validation)[0], 'FILE_NOT_REGULAR');

  const output = await runRealCli(root, ['plan-context', '--config', 'pipe', '--route', 'main']);
  assert.ok(Date.now() - started < 2000);
  assert.equal(output.code, EXIT_CODES.INVALID_INPUT);
  assert.equal(JSON.parse(output.stderr).diagnostics[0].code, 'FILE_NOT_REGULAR');
});

test('bounded readers reject oversized config, run record, and context source with structured diagnostics', async () => {
  const root = await projectFixture();
  const configPath = path.join(root, 'agent-harness.config.json');
  await writeFile(configPath, `${' '.repeat(1024 * 1024 + 1)}`);
  for (const result of [await validateProject(configPath), await planContext(configPath, 'main')]) {
    assert.equal(result.exitCode, EXIT_CODES.INVALID_INPUT);
    assert.equal(diagnosticCodes(result)[0], 'FILE_TOO_LARGE');
  }
  const configCli = await runRealCli(root, ['validate', '--config', 'agent-harness.config.json']);
  assert.equal(configCli.code, EXIT_CODES.INVALID_INPUT);
  assert.equal(JSON.parse(configCli.stderr).diagnostics[0].code, 'FILE_TOO_LARGE');

  const runPath = path.join(root, 'run.json');
  await writeFile(runPath, ' '.repeat(256 * 1024 + 1));
  const run = await executeCli(['validate-run', '--file', 'run.json'], { cwd: root });
  assert.equal(run.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.equal(diagnosticCodes(run)[0], 'FILE_TOO_LARGE');
  const runApi = await validateRunFile('run.json', { cwd: root });
  assert.equal(diagnosticCodes(runApi)[0], 'FILE_TOO_LARGE');
  const runCli = await runRealCli(root, ['validate-run', '--file', 'run.json']);
  assert.equal(runCli.code, EXIT_CODES.INVALID_INPUT);
  assert.equal(JSON.parse(runCli.stderr).diagnostics[0].code, 'FILE_TOO_LARGE');

  const config = baseConfig({ routeBudgets: [{ name: 'main', maxWords: 10, files: ['huge.md'] }] });
  await writeFile(configPath, JSON.stringify(config));
  await createSparseFile(path.join(root, 'huge.md'), FILE_LIMITS.projectFile + 1);
  const project = await validateProject(configPath);
  assert.ok(diagnosticCodes(project).includes('FILE_TOO_LARGE'));
  const context = await planContext(configPath, 'main');
  assert.equal(context.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.equal(diagnosticCodes(context)[0], 'FILE_TOO_LARGE');
  const contextCli = await runRealCli(root, ['plan-context', '--config', 'agent-harness.config.json', '--route', 'main']);
  assert.equal(contextCli.code, EXIT_CODES.INVALID_INPUT);
  assert.equal(JSON.parse(contextCli.stderr).diagnostics[0].code, 'FILE_TOO_LARGE');
});

test('bounded reader closes descriptors after successful and rejected reads', async (t) => {
  const descriptorDirectory = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
  let before;
  try { before = (await readdir(descriptorDirectory)).length; }
  catch { t.skip('process descriptor inventory is unavailable on this platform'); return; }
  const root = await temporaryDirectory();
  const validPath = path.join(root, 'small.txt');
  const largePath = path.join(root, 'large.txt');
  await writeFile(validPath, 'safe');
  await writeFile(largePath, 'x'.repeat(FILE_LIMITS.runRecord + 1));
  for (let index = 0; index < 25; index += 1) {
    assert.equal((await readRegularFile(validPath, 16)).toString(), 'safe');
    await assert.rejects(readRegularFile(largePath, FILE_LIMITS.runRecord), { code: 'FILE_TOO_LARGE' });
  }
  assert.equal((await readdir(descriptorDirectory)).length, before);
});

test('plan-context preserves configured route warnings', async () => {
  const config = baseConfig({
    routeBudgets: [{ name: 'main', maxWords: 7, warningPercent: 85, files: ['skills/example/SKILL.md', 'route.md'] }],
  });
  const root = await projectFixture(config);
  const result = await planContext(path.join(root, 'agent-harness.config.json'), 'main');

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings.map((item) => item.code), ['ROUTE_BUDGET_WARNING']);
  assert.match(formatCliResult(result), /^WARNING ROUTE_BUDGET_WARNING:/);
  assert.match(formatCliResult(result), /Context route: main/);
});

test('plan-context prints its manifest when the route exceeds its budget', async () => {
  const config = baseConfig({
    routeBudgets: [{ name: 'main', maxWords: 5, files: ['skills/example/SKILL.md', 'route.md'] }],
  });
  const root = await projectFixture(config);
  const result = await planContext(path.join(root, 'agent-harness.config.json'), 'main');
  const output = formatCliResult(result);

  assert.equal(result.ok, false);
  assert.match(output, /^ERROR ROUTE_BUDGET_EXCEEDED:/);
  assert.match(output, /- skills\/example\/SKILL.md: 3 words/);
  assert.match(output, /Total: 6\/5 words; headroom -1/);
});

test('binds behavior evidence to exact source, scenario, run checks, outcome, and telemetry', async () => {
  const root = await temporaryDirectory();
  const sourceFiles = { 'skills/example/SKILL.md': 'bounded behavior\n' };
  const scenarioFiles = { 'evals/scenarios.md': 'Scenario: bounded behavior must remain observable.\nAdditional instruction text.\n' };
  const fixtureFiles = { 'evals/input.bin': Buffer.alloc(1_100_000, 93) };
  const sourceSha = sourceDigest(sourceFiles);
  const scenarioSha = scenarioDigest('bounded-behavior', scenarioFiles, fixtureFiles);
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
      scenario: { id: 'bounded-behavior', sha256Scope: 'full-contract-v2', files: Object.keys(scenarioFiles), fixtureFiles: Object.keys(fixtureFiles), sha256: scenarioSha },
      requiredChecks: ['scope'],
      requiredTags: ['source-blind'],
      maxAgeDays: 1,
      telemetryBudgets: [{ metric: 'input_tokens', required: true, max: 100 }],
      evidence: { runRecord: 'evals/run-001.json', runRecordSha256: sha256(runText), testedSourceSha256: sourceSha, testedScenarioSha256: scenarioSha },
    }],
  };
  await writeFiles(root, { ...sourceFiles, ...scenarioFiles, ...fixtureFiles, 'evals/run-001.json': runText });
  await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(config)}\n`);

  const valid = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));

  const futureRun = { ...run, measurement: { ...run.measurement, verifiedAt: '2099-01-01T00:00:00.000Z' } };
  const futureText = `${JSON.stringify(futureRun)}\n`;
  const futureConfig = structuredClone(config);
  futureConfig.behaviorBaselines[0].evidence.runRecordSha256 = sha256(futureText);
  await writeFile(path.join(root, 'evals/run-001.json'), futureText);
  await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(futureConfig)}\n`);
  const future = await validateProject(path.join(root, 'agent-harness.config.json'), { now: Date.parse('2098-12-31T23:59:59.999Z') });
  assert.ok(diagnosticCodes(future).includes('BEHAVIOR_VERIFICATION_FUTURE'));
  await writeFile(path.join(root, 'evals/run-001.json'), runText);
  await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(config)}\n`);

  await writeFile(path.join(root, 'evals/scenarios.md'), `${scenarioFiles['evals/scenarios.md']}Changed instruction outside prior anchor.\n`);
  const changedScenario = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.ok(diagnosticCodes(changedScenario).includes('BEHAVIOR_SCENARIO_STALE'));
  await writeFile(path.join(root, 'evals/scenarios.md'), scenarioFiles['evals/scenarios.md']);

  await writeFile(path.join(root, 'evals/input.bin'), Buffer.alloc(1_100_000, 94));
  const changedFixture = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.ok(diagnosticCodes(changedFixture).includes('BEHAVIOR_SCENARIO_STALE'));
  await writeFile(path.join(root, 'evals/input.bin'), fixtureFiles['evals/input.bin']);

  await writeFile(path.join(root, 'skills/example/SKILL.md'), 'changed behavior\n');
  const stale = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.ok(diagnosticCodes(stale).includes('BEHAVIOR_SOURCE_STALE'));
});

test('fails closed for legacy anchor-only behavior baselines', async () => {
  const root = await temporaryDirectory();
  const scenarioSha = '0'.repeat(64);
  const run = {
    schemaVersion: 1,
    runId: 'run-legacy',
    scenario: 'legacy',
    result: 'succeeded',
    startedAt: new Date().toISOString(),
    durationMs: 1,
    checks: [{ name: 'scope', result: 'pass' }],
    metrics: { checks_passed: 1 },
    lineage: { verificationId: 'run-legacy', artifactPointer: 'evals/run-legacy.json' },
    measurement: { status: 'met', verifiedAt: new Date().toISOString(), summary: 'Verified.' },
  };
  const runText = `${JSON.stringify(run)}\n`;
  const config = {
    schemaVersion: 1,
    projectRoot: '.',
    behaviorBaselines: [{
      name: 'legacy', sourceFiles: ['source.md'], sourceSha256: sha256('source.md\0'),
      scenario: { id: 'legacy', files: ['scenario.md'], anchors: ['Scenario: legacy'], sha256: scenarioSha },
      requiredChecks: ['scope'],
      evidence: { runRecord: 'evals/run-legacy.json', runRecordSha256: sha256(runText), testedSourceSha256: '0'.repeat(64), testedScenarioSha256: scenarioSha },
    }],
  };
  await writeFiles(root, { 'source.md': 'source\n', 'scenario.md': 'Scenario: legacy\n', 'evals/run-legacy.json': runText });
  const configPath = path.join(root, 'agent-harness.config.json');
  await writeFile(configPath, JSON.stringify(config));

  const result = await validateProject(configPath);
  assert.equal(result.exitCode, EXIT_CODES.INVALID_INPUT);
  assert.ok(result.diagnostics.some((item) => item.path.endsWith('.sha256Scope') && /refreshed approval/u.test(item.message)));
});

test('applies project-root path safety to behavior fixture files', async () => {
  const config = baseConfig({ requiredFiles: [], requiredPhrases: [], skillBudgets: undefined, routeBudgets: [], scenarios: [] });
  delete config.skillBudgets;
  config.behaviorBaselines = [{
    name: 'fixture-path', sourceFiles: ['source.md'], sourceSha256: '0'.repeat(64),
    scenario: { id: 'fixture-path', sha256Scope: 'full-contract-v2', files: ['scenario.md'], fixtureFiles: ['../outside.json'], sha256: '0'.repeat(64) },
    requiredChecks: ['scope'], evidence: { runRecord: 'run.json', runRecordSha256: '0'.repeat(64), testedSourceSha256: '0'.repeat(64), testedScenarioSha256: '0'.repeat(64) },
  }];
  const root = await projectFixture(config, { 'source.md': 'source\n', 'scenario.md': 'scenario\n', 'run.json': '{}' });
  const result = await validateProject(path.join(root, 'agent-harness.config.json'));
  assert.equal(result.exitCode, EXIT_CODES.UNSAFE_PATH);
  assert.ok(diagnosticCodes(result).includes('UNSAFE_PATH'));
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

test('rejects explicit null optional config arrays while defaulting omitted arrays', () => {
  const valid = validateConfigObject({ schemaVersion: 1, projectRoot: '.' });
  assert.equal(valid.valid, true);
  for (const key of ['requiredFiles', 'requiredPhrases', 'routeBudgets', 'scenarios', 'behaviorBaselines']) {
    const result = validateConfigObject({ schemaVersion: 1, projectRoot: '.', [key]: null });
    assert.equal(result.valid, false, key);
    assert.ok(result.diagnostics.some((item) => item.path === `$.${key}`), key);
  }
});

test('telemetry budgets cannot silently choose between simultaneous ceilings', () => {
  const baseline = {
    name: 'dual-limit', sourceFiles: ['source.md'], sourceSha256: 'a'.repeat(64),
    scenario: { id: 'scenario', sha256Scope: 'full-contract-v2', files: ['scenario.md'], fixtureFiles: [], sha256: 'b'.repeat(64) },
    requiredChecks: ['quality'], telemetryBudgets: [{ metric: 'input_tokens', max: 1000, baseline: 100, maxRegressionPercent: 10 }],
    evidence: { runRecord: 'run.json', runRecordSha256: 'c'.repeat(64), testedSourceSha256: 'a'.repeat(64), testedScenarioSha256: 'b'.repeat(64) },
  };
  const result = validateConfigObject({ schemaVersion: 1, projectRoot: '.', behaviorBaselines: [baseline] });
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some((item) => item.path.endsWith('.telemetryBudgets[0]')));
});

test('run record validator returns field diagnostics for malformed metricNames', () => {
  const base = {
    schemaVersion: 1, runId: 'metric-names', scenario: 'metrics', result: 'succeeded',
    startedAt: '2026-07-14T05:00:00.000Z', durationMs: 1,
    checks: [{ name: 'contract', result: 'pass' }], metrics: {},
    measurement: { status: 'met', verifiedAt: '2026-07-14T05:00:00.000Z', summary: 'Verified.' },
  };
  for (const metricNames of [null, 1, 'input_tokens', {}]) {
    const result = validateRunRecordObject({ ...base, measurement: { ...base.measurement, metricNames } });
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some((item) => item.path === '$.measurement.metricNames'));
  }
});

test('requires canonical calendar timestamps and a completed measurement window', () => {
  const base = {
    schemaVersion: 1, runId: 'canonical-time', scenario: 'time', result: 'succeeded',
    startedAt: '2026-02-28T05:00:00.000Z', durationMs: 1,
    checks: [{ name: 'contract', result: 'pass' }], metrics: {},
    measurement: { status: 'met', windowEndsAt: '2026-02-28T05:02:00.000Z', verifiedAt: '2026-02-28T05:03:00.000Z', summary: 'Verified.' },
  };
  assert.equal(validateRunRecordObject(base).valid, true);
  assert.equal(validateRunRecordObject({ ...base, startedAt: '2026-02-30T05:00:00.000Z' }).valid, false);
  assert.equal(validateRunRecordObject({ ...base, startedAt: '2024-02-29T05:00:00.000Z' }).valid, true);
  assert.equal(validateRunRecordObject({ ...base, measurement: { ...base.measurement, windowEndsAt: '2026-02-28T05:04:00.000Z' } }).valid, false);
  assert.equal(validateRunRecordObject({ ...base, measurement: { status: 'pending', windowEndsAt: '2026-02-28T05:02:00.000Z' } }).valid, true);
});

test('portable standard counters are non-negative integers while generic metrics may be signed', () => {
  const base = {
    schemaVersion: 1, runId: 'counter-contract', scenario: 'metrics', result: 'succeeded',
    startedAt: '2026-07-14T05:00:00.000Z', durationMs: 1,
    checks: [{ name: 'contract', result: 'pass' }], metrics: { outcome_delta: -0.25, input_tokens: 2, cached_input_tokens: 1 },
  };
  assert.equal(validateRunRecordObject(base).valid, true);
  assert.equal(validateRunRecordObject({ ...base, metrics: { ...base.metrics, input_tokens: -1 } }).valid, false);
  assert.equal(validateRunRecordObject({ ...base, metrics: { ...base.metrics, cached_input_tokens: 3 } }).valid, false);
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

  await writeFile(path.join(root, 'run.json'), JSON.stringify({
    schemaVersion: 1, runId: 'run-002', scenario: 'happy-path', result: 'succeeded',
    startedAt: '2026-07-14T05:00:00.000Z', durationMs: 1,
    checks: [{ name: 'contract', result: 'pass' }], metrics: {},
    measurement: { status: 'met', verifiedAt: '2026-07-14T05:00:00.000Z', summary: 'Verified.', metricNames: null },
  }));
  const malformedMetrics = await executeCli(['validate-run', '--file', 'run.json'], { cwd: root });
  assert.equal(malformedMetrics.exitCode, EXIT_CODES.VALIDATION_FAILED);
  assert.ok(malformedMetrics.diagnostics.some((item) => item.path === '$.measurement.metricNames'));
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

test('init rejects escaping template-directory symlinks before creating any files', async () => {
  for (const [type, link] of [['skills', 'skills'], ['loop', 'evals'], ['docs', 'docs']]) {
    const root = await temporaryDirectory();
    const project = path.join(root, 'project');
    const outside = path.join(root, 'outside');
    await mkdir(project);
    await mkdir(outside);
    await symlink(outside, path.join(project, link), 'dir');
    const result = await initProject(type, 'project', { cwd: root });
    assert.equal(result.ok, false, type);
    assert.equal(result.exitCode, EXIT_CODES.UNSAFE_PATH, type);
    assert.deepEqual(await readdir(outside), [], type);
    assert.deepEqual(await readdir(project), [link], type);
  }
});

test('init preflights non-directory template ancestors before creating any files', async () => {
  const root = await temporaryDirectory();
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'skills'), 'owner file\n');
  const result = await initProject('skills', 'project', { cwd: root });
  assert.equal(result.exitCode, EXIT_CODES.INIT_CONFLICT);
  assert.equal(await readFile(path.join(project, 'skills'), 'utf8'), 'owner file\n');
  assert.deepEqual(await readdir(project), ['skills']);
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
