import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateConfigObject, validateRunRecordObject } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default;

function canonicalUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

async function validators() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  // JSON Schema's date-time format alone is only an annotation in some validators.
  ajv.addFormat('date-time', { type: 'string', validate: canonicalUtc });
  const configSchema = JSON.parse(await readFile(path.join(root, 'schemas/config.schema.json'), 'utf8'));
  const runSchema = JSON.parse(await readFile(path.join(root, 'schemas/run-record.schema.json'), 'utf8'));
  return { config: ajv.compile(configSchema), run: ajv.compile(runSchema) };
}

const validBaseline = () => ({
  name: 'example',
  sourceFiles: ['source.md'],
  sourceSha256: 'a'.repeat(64),
  scenario: { id: 'scenario', sha256Scope: 'full-contract-v2', files: ['scenario.md'], fixtureFiles: [], sha256: 'b'.repeat(64) },
  requiredChecks: ['quality'],
  evidence: { runRecord: 'evals/run.json', runRecordSha256: 'c'.repeat(64), testedSourceSha256: 'a'.repeat(64), testedScenarioSha256: 'b'.repeat(64) },
});

const validRun = () => ({
  schemaVersion: 1,
  runId: 'run-1',
  scenario: 'scenario',
  result: 'succeeded',
  startedAt: '2024-02-29T00:00:00.000Z',
  durationMs: 10,
  checks: [{ name: 'quality', result: 'pass' }],
  metrics: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3, context_tokens_peak: 10, tool_calls: 1, retry_count: 0, outcome_delta: -0.25 },
  measurement: { status: 'met', windowEndsAt: '2024-02-29T00:02:00.000Z', verifiedAt: '2024-02-29T00:03:00.000Z', metricNames: ['outcome_delta'], summary: 'Verified.' },
});

test('Ajv 2020 schemas and public runtime validators agree on config/run boundaries', async () => {
  const schema = await validators();
  const cases = [
    ['omitted optional config arrays', { schemaVersion: 1, projectRoot: '.' }, true],
    ...['requiredFiles', 'requiredPhrases', 'routeBudgets', 'scenarios', 'behaviorBaselines'].map((key) => [
      `null ${key}`, { schemaVersion: 1, projectRoot: '.', [key]: null }, false,
    ]),
    ['null telemetry budgets', { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [{ ...validBaseline(), telemetryBudgets: null }] }, false],
    ['null optional required tags', { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [{ ...validBaseline(), requiredTags: null }] }, false],
    ['empty required tags', { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [{ ...validBaseline(), requiredTags: [] }] }, false],
    ['simultaneous telemetry ceilings', { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [{ ...validBaseline(), telemetryBudgets: [{ metric: 'input_tokens', max: 100, baseline: 50, maxRegressionPercent: 10 }] }] }, false],
    ['partial regression ceiling', { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [{ ...validBaseline(), telemetryBudgets: [{ metric: 'input_tokens', max: 100, baseline: 50 }] }] }, false],
  ];
  for (const [label, value, expected] of cases) {
    assert.equal(schema.config(value), expected, `${label}: schema ${JSON.stringify(schema.config.errors)}`);
    assert.equal(validateConfigObject(value).valid, expected, `${label}: runtime`);
  }

  const runCases = [['valid signed generic metric', validRun(), true]];
  for (const name of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'context_tokens_peak', 'tool_calls', 'retry_count']) {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      runCases.push([`${name}=${bad}`, { ...validRun(), metrics: { ...validRun().metrics, [name]: bad } }, false]);
    }
  }
  for (const metricNames of [null, 1, 'input_tokens', {}, ['not portable']]) {
    runCases.push([`malformed metricNames ${JSON.stringify(metricNames)}`, {
      ...validRun(), measurement: { ...validRun().measurement, metricNames },
    }, false]);
  }
  for (const startedAt of ['2026-02-30T00:00:00.000Z', '2026-02-28T00:00:00+00:00']) {
    runCases.push([`noncanonical timestamp ${startedAt}`, { ...validRun(), startedAt }, false]);
  }
  for (const [label, value, expected] of runCases) {
    assert.equal(schema.run(value), expected, `${label}: schema ${JSON.stringify(schema.run.errors)}`);
    assert.equal(validateRunRecordObject(value).valid, expected, `${label}: runtime`);
  }

  const pending = { ...validRun(), measurement: { status: 'pending', windowEndsAt: '2024-02-29T00:02:00.000Z' } };
  assert.equal(schema.run(pending), true);
  assert.equal(validateRunRecordObject(pending).valid, true);

  // Schema can validate timestamp shape/calendar, but cannot express ordering across these fields.
  const incompleteWindow = { ...validRun(), measurement: { ...validRun().measurement, verifiedAt: '2024-02-29T00:01:00.000Z' } };
  assert.equal(schema.run(incompleteWindow), true);
  const runtimeResult = validateRunRecordObject(incompleteWindow);
  assert.equal(runtimeResult.valid, false);
  assert.ok(runtimeResult.diagnostics.some((item) => item.path === '$.measurement.verifiedAt'));
});
