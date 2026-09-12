import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readContinuityRecovery, readContinuityCheckpoint } from '../src/continuity.js';

test('historical recovery preserves integrity without conferring current-state authority', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const hash = s => crypto.createHash('sha256').update(s).digest('hex');
  const value = { schemaVersion: 1, checkpointId: 'test', sessionId: 'test', workspaceId: hash(root), head: 'a'.repeat(40), branch: 'main', modelId: null, updatedAt: '2026-09-11T00:00:00.000Z', expiresAt: '2026-09-12T00:00:00.000Z', sections: Object.fromEntries(['objective','constraints','decisions','progress','openRisks','nextAction'].map(k => [k, { text: k, sources: ['source'] }])), evidence: [{ id: 'source', path: 'source.md', sha256: hash('private') }] };
  const expected = { sessionId: value.sessionId, workspaceId: value.workspaceId, head: value.head, branch: value.branch, modelId: null, now: Date.parse(value.updatedAt) + 1000 };
  const input = { projectRoot: root, file: 'checkpoint.json', expected };
  assert.equal((await readContinuityRecovery(input)).status, 'absent');
  await fs.writeFile(path.join(root, 'checkpoint.json'), JSON.stringify(value));
  await fs.writeFile(path.join(root, 'source.md'), 'private');
  assert.equal((await readContinuityRecovery(input)).ok, true);
  for (const changes of [{ head: 'b'.repeat(40) }, { branch: 'other' }, { now: Date.parse(value.expiresAt) + 1 }]) {
    const changed = { ...input, expected: { ...expected, ...changes } };
    const result = await readContinuityRecovery(changed);
    assert.equal(result.status, 'historical'); assert.equal(result.ok, false); assert.equal(result.retrievable, true);
    assert.equal((await readContinuityCheckpoint(changed)).status, 'stale');
  }
  for (const changes of [{ sessionId: 'other' }, { workspaceId: 'b'.repeat(64) }, { now: 0 }]) assert.notEqual((await readContinuityRecovery({ ...input, expected: { ...expected, ...changes } })).retrievable, true);
  expected.head = 'b'.repeat(40);
  await fs.writeFile(path.join(root, 'source.md'), 'tampered');
  assert.notEqual((await readContinuityRecovery(input)).retrievable, true);
  await fs.unlink(path.join(root, 'source.md'));
  assert.notEqual((await readContinuityRecovery(input)).status, 'absent');
  assert.equal((await readContinuityRecovery(null)).ok, false);
});
