import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns } from '../src/index.js';

function fixture() {
  const run = (runId, retry_count) => ({ schemaVersion: 1, runId, scenario: 'task', result: 'succeeded', startedAt: '2026-09-08T00:00:00.000Z', durationMs: 100, checks: [{ name: 'quality', result: 'pass' }], metrics: { retry_count }, lineage: { workItemId: 'task-1', artifactPointer: 'sha256-input' }, measurement: { status: 'met', verifiedAt: '2026-09-08T00:01:00.000Z', summary: 'Verified.' } });
  return { schemaVersion: 1, baselineId: 'a', candidateId: 'b', requiredChecks: ['quality'], pairs: [{ split: 'held-out', baseline: run('a1', 1), candidate: run('b1', 3) }] };
}

test('reports held-out totals, retry regression, and unavailable telemetry without estimates', () => {
  const result = compareRuns(fixture());
  assert.equal(result.valid, true);
  assert.equal(result.splits['held-out'].qualityFloorMet, true);
  assert.deepEqual(result.splits['held-out'].metrics.retry_count, { status: 'available', baseline: 1, candidate: 3, delta: 2 });
  assert.deepEqual(result.splits['held-out'].metrics.input_tokens, { status: 'unavailable' });
  assert.equal(result.splits.train.qualityFloorMet, false);
});

test('quality regression cannot satisfy floor despite lower duration', () => {
  const input = fixture();
  input.pairs[0].candidate.durationMs = 1;
  input.pairs[0].candidate.measurement.status = 'missed';
  assert.equal(compareRuns(input).splits['held-out'].qualityFloorMet, false);
  input.pairs[0].candidate.checks = [{ name: 'other', result: 'pass' }];
  assert.equal(compareRuns(input).splits['held-out'].qualityFloorMet, false);
});

test('rejects mismatched artifacts, leakage, duplicate runs, bad telemetry and open payloads', () => {
  for (const mutate of [
    (x) => { x.pairs[0].candidate.lineage.artifactPointer = 'different'; },
    (x) => { const pair = structuredClone(x.pairs[0]); pair.split = 'train'; pair.baseline.runId = 'a2'; pair.candidate.runId = 'b2'; x.pairs.push(pair); },
    (x) => { x.pairs[0].candidate.runId = 'a1'; },
    (x) => { x.pairs[0].candidate.metrics.retry_count = -1; },
    (x) => { x.prompt = 'not allowed'; },
    (x) => { x.pairs[0].baseline.measurement.metricNames = 1; },
    (x) => { x.requiredChecks = []; },
  ]) {
    const input = fixture(); mutate(input); assert.equal(compareRuns(input).valid, false);
  }
  for (const input of [null, [], {}, { pairs: [null] }]) assert.equal(compareRuns(input).valid, false);
});
