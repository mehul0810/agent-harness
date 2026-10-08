import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateProject } from '../src/index.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const now = Date.parse('2026-10-08T00:00:00.000Z');

async function baselineFixture(change) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-baseline-'));
  try {
    const source = 'source bytes\n';
    const scenario = 'complete scenario bytes\n';
    const sourceSha = digest(`source.md\0${Buffer.byteLength(source)}\0${source}\0`);
    const scenarioHash = createHash('sha256').update('full-contract-v2\0scenario-1\0scenario\0scenario.md\0').update(String(Buffer.byteLength(scenario))).update('\0').update(scenario).update('\0fixture\0').digest('hex');
    const run = {
      schemaVersion: 1, runId: 'run-1', scenario: 'scenario-1', result: 'succeeded',
      startedAt: '2026-10-07T00:00:00.000Z', durationMs: 1,
      checks: [{ name: 'quality', result: 'pass' }], metrics: { checks_passed: 1, input_tokens: 50 },
      tags: ['verified'], lineage: { verificationId: 'run-1', artifactPointer: 'artifact-1' },
      measurement: { status: 'met', verifiedAt: '2026-10-07T00:01:00.000Z', summary: 'Verified.' },
    };
    const runText = `${JSON.stringify(run)}\n`;
    const evidence = { runRecord: 'evals/run-1.json', runRecordSha256: digest(runText), testedSourceSha256: sourceSha, testedScenarioSha256: scenarioHash };
    const baseline = {
      name: 'baseline', sourceFiles: ['source.md'], sourceSha256: sourceSha,
      scenario: { id: 'scenario-1', sha256Scope: 'full-contract-v2', files: ['scenario.md'], fixtureFiles: [], sha256: scenarioHash },
      requiredChecks: ['quality'], requiredTags: ['verified'], maxAgeDays: 2,
      telemetryBudgets: [{ metric: 'input_tokens', required: true, max: 100 }], evidence,
    };
    const config = { schemaVersion: 1, projectRoot: '.', behaviorBaselines: [baseline] };
    change?.({ root, run, baseline, config, evidence });
    const actualRunText = `${JSON.stringify(run)}\n`;
    if (evidence.runRecordSha256 === digest(runText)) evidence.runRecordSha256 = digest(actualRunText);
    await mkdir(path.join(root, 'evals'), { recursive: true });
    await writeFile(path.join(root, 'source.md'), source);
    await writeFile(path.join(root, 'scenario.md'), scenario);
    await writeFile(path.join(root, evidence.runRecord), actualRunText);
    if (evidence.runRecord !== 'evals/run-1.json') await writeFile(path.join(root, evidence.runRecord), actualRunText);
    await writeFile(path.join(root, 'agent-harness.config.json'), `${JSON.stringify(config)}\n`);
    return { root, close: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

test('baseline rejection branches stay diagnostic and source-bound', async (t) => {
  const cases = [
    ['run bytes changed', ({ evidence }) => { evidence.runRecordSha256 = '0'.repeat(64); }, 'BEHAVIOR_RUN_DIGEST_MISMATCH'],
    ['wrong tested source', ({ evidence }) => { evidence.testedSourceSha256 = '0'.repeat(64); }, 'BEHAVIOR_EVIDENCE_STALE'],
    ['wrong tested scenario', ({ evidence }) => { evidence.testedScenarioSha256 = '0'.repeat(64); }, 'BEHAVIOR_EVIDENCE_STALE'],
    ['wrong filename id', ({ evidence }) => { evidence.runRecord = 'evals/other.json'; }, 'BEHAVIOR_RUN_ID_MISMATCH'],
    ['wrong scenario', ({ run }) => { run.scenario = 'other'; }, 'BEHAVIOR_RUN_SCENARIO_MISMATCH'],
    ['failed succeeded check', ({ run }) => { run.checks[0].result = 'fail'; }, 'BEHAVIOR_RUN_CONTRACT_INVALID'],
    ['malformed measurement metric names', ({ run }) => { run.measurement.metricNames = null; }, 'BEHAVIOR_RUN_CONTRACT_INVALID'],
    ['check count mismatch', ({ run }) => { run.metrics.checks_passed = 0; }, 'BEHAVIOR_CHECK_COUNT_INVALID'],
    ['missing tag', ({ run }) => { run.tags = []; }, 'BEHAVIOR_TAG_MISSING'],
    ['lineage incomplete', ({ run }) => { delete run.lineage.artifactPointer; }, 'BEHAVIOR_LINEAGE_INVALID'],
    ['measurement pending', ({ run }) => { run.measurement = { status: 'pending', windowEndsAt: '2026-10-07T00:02:00.000Z' }; }, 'BEHAVIOR_MEASUREMENT_UNVERIFIED'],
    ['required metric absent', ({ run, baseline }) => { delete run.metrics.input_tokens; baseline.telemetryBudgets[0].required = true; }, 'BEHAVIOR_TELEMETRY_MISSING'],
    ['absolute limit exceeded', ({ run, baseline }) => { run.metrics.input_tokens = 101; baseline.telemetryBudgets[0].max = 100; }, 'BEHAVIOR_TELEMETRY_EXCEEDED'],
    ['regression limit exceeded', ({ run, baseline }) => { run.metrics.input_tokens = 111; baseline.telemetryBudgets[0] = { metric: 'input_tokens', baseline: 100, maxRegressionPercent: 10 }; }, 'BEHAVIOR_TELEMETRY_EXCEEDED'],
    ['stale evidence', ({ run, baseline }) => { run.startedAt = '2026-10-01T00:00:00.000Z'; baseline.maxAgeDays = 2; }, 'BEHAVIOR_EVIDENCE_EXPIRED'],
  ];
  for (const [label, change, expected] of cases) {
    await t.test(label, async () => {
      const fixture = await baselineFixture(change);
      try {
        const result = await validateProject(path.join(fixture.root, 'agent-harness.config.json'), { now });
        assert.ok(result.diagnostics.some((item) => item.code === expected), JSON.stringify(result.diagnostics));
      } finally { await fixture.close(); }
    });
  }
});
