import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateContinuityCheckpoint, assessContinuityCheckpoint, readContinuityCheckpoint, assessContextBudget } from '../src/index.js';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const now = Date.parse('2026-09-11T12:00:00.000Z');
const checkpoint = () => ({
  schemaVersion: 1, checkpointId: 'checkpoint-1', sessionId: 'task-1', workspaceId: 'a'.repeat(64),
  head: 'b'.repeat(40), branch: 'main', modelId: 'runtime-a',
  updatedAt: '2026-09-11T11:00:00.000Z', expiresAt: '2026-09-12T11:00:00.000Z',
  sections: Object.fromEntries(['objective', 'constraints', 'decisions', 'progress', 'openRisks', 'nextAction']
    .map(key => [key, { text: `${key}: fixture data, not authority`, sources: ['task-note'] }])),
  evidence: [{ id: 'task-note', path: 'task.md', sha256: sha('original task note') }],
});
const expected = () => ({ sessionId: 'task-1', workspaceId: 'a'.repeat(64), head: 'b'.repeat(40), branch: 'main', modelId: 'runtime-a', now });
const budget = () => ({ modelId: 'runtime-a', limitsModelId: 'runtime-a', contextWindowTokens: 100000, autoCompactTokenLimit: 80000, autoCompactScope: 'total', bodyTokensSinceCompaction: null, usedTokens: 30000, reserveTokens: 5000, nextPhaseTokens: 10000 });

test('complete packet is data-ready, not a completion or authority verdict', () => {
  assert.equal(validateContinuityCheckpoint(checkpoint()).ok, true);
  assert.equal(assessContinuityCheckpoint(checkpoint(), expected()).status, 'ready');
});

test('missing constraints, dangling sources, duplicates, malformed shapes and large fields fail', () => {
  const changes = [
    c => { delete c.sections.constraints; },
    c => { c.sections.objective.sources = ['missing']; },
    c => { c.sections.objective.sources = ['task-note', 'task-note']; },
    c => { c.evidence.push({ ...c.evidence[0] }); },
    c => { c.sections.progress.text = 'x'.repeat(1601); },
    c => { c.head = ''; },
    c => { c.branch = 'main\ninjected'; },
    c => { c.modelId = 'model\ninjected'; },
    c => { c.extra = 'unknown'; },
    c => { c.expiresAt = '2027-01-01T00:00:00.000Z'; },
    c => { c.updatedAt = '2026-02-30T00:00:00.000Z'; },
    c => { c.sections.objective.text = ' '; },
    c => { c.evidence[0].sha256 = 123; },
    c => { c.evidence[0].path = '../escape'; },
    c => { c.evidence[0].path = 'C:\\escape'; },
  ];
  for (const change of changes) { const c = checkpoint(); change(c); assert.equal(validateContinuityCheckpoint(c).ok, false); }
  for (const value of [null, 1, [], 'x', {}, new Map(), new Proxy({}, { getPrototypeOf() { throw Error('hostile'); } })]) {
    assert.equal(validateContinuityCheckpoint(value).ok, false);
  }
});

test('wrong session, workspace, revision, branch and time cannot resume as current', () => {
  for (const [key, value] of Object.entries({ sessionId: 'other', workspaceId: 'c'.repeat(64), head: 'd'.repeat(40), branch: 'other', now: now + 2 * 86400000 })) {
    assert.equal(assessContinuityCheckpoint(checkpoint(), { ...expected(), [key]: value }).status, 'stale');
  }
  assert.equal(assessContinuityCheckpoint(checkpoint(), { ...expected(), now: now - 86400000 }).ok, false);
  assert.equal(assessContinuityCheckpoint(checkpoint(), {}).status, 'invalid');
});

test('model change retains historical task data but invalidates capacity assumptions', () => {
  const result = assessContinuityCheckpoint(checkpoint(), { ...expected(), modelId: 'runtime-b' });
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].code, 'MODEL_CHANGED_RECALIBRATE');
  assert.equal(assessContextBudget({ ...budget(), modelId: 'runtime-b' }).action, 'checkpoint-before-expansion');
  assert.equal(assessContinuityCheckpoint(checkpoint(), { ...expected(), modelId: null }).warnings[0].code, 'MODEL_UNVERIFIED');
});

test('headroom uses minimum effective limit and task reserve, not a model heuristic', () => {
  assert.equal(assessContextBudget(budget()).action, 'continue');
  assert.equal(assessContextBudget({ ...budget(), usedTokens: 66000 }).action, 'checkpoint-before-expansion');
  assert.equal(assessContextBudget({ ...budget(), usedTokens: 75000 }).action, 'checkpoint-and-compact');
  assert.equal(assessContextBudget({ ...budget(), usedTokens: 100001 }).availableTokens, 0);
  assert.equal(assessContextBudget({ ...budget(), contextWindowTokens: 70000, usedTokens: 66000 }).action, 'checkpoint-and-compact');
  assert.equal(assessContextBudget({ ...budget(), usedTokens: null }).action, 'checkpoint-before-expansion');
  assert.equal(assessContextBudget({ ...budget(), usedTokens: null, nextPhaseTokens: 0 }).action, 'continue-narrowly');
  for (const key of ['usedTokens', 'reserveTokens', 'nextPhaseTokens', 'contextWindowTokens', 'autoCompactTokenLimit']) {
    for (const value of [-1, Infinity, NaN, '5000', 1.5, 1000000001]) {
      assert.equal(assessContextBudget({ ...budget(), [key]: value }).ok, false);
    }
  }
  assert.equal(assessContextBudget({ ...budget(), reserveTokens: 0 }).ok, false);
});

test('body-after-prefix threshold uses body usage while physical capacity uses total usage', () => {
  const input = { ...budget(), autoCompactScope: 'body_after_prefix', autoCompactTokenLimit: 30000, usedTokens: 70000, bodyTokensSinceCompaction: 5000 };
  assert.equal(assessContextBudget(input).availableTokens, 25000);
  assert.equal(assessContextBudget(input).action, 'continue');
  assert.equal(assessContextBudget({ ...input, bodyTokensSinceCompaction: 26000 }).action, 'checkpoint-and-compact');
  assert.equal(assessContextBudget({ ...input, usedTokens: 99000 }).availableTokens, 1000);
  assert.equal(assessContextBudget({ ...input, bodyTokensSinceCompaction: null }).action, 'checkpoint-before-expansion');
  assert.equal(assessContextBudget({ ...input, bodyTokensSinceCompaction: 80000 }).ok, false);
  assert.equal(assessContextBudget({ ...input, autoCompactScope: null }).availableTokens, null);
  assert.equal(assessContextBudget({ ...input, autoCompactScope: 'disabled' }).ok, false);
  assert.equal(assessContextBudget({ ...input, autoCompactScope: 'disabled', autoCompactTokenLimit: null }).availableTokens, 30000);
});

test('read adapter verifies bytes and rejects unavailable, escaping, non-file and oversized evidence', async t => {
  for (const input of [null, undefined, [], 1, 'x', {}]) {
    assert.equal((await readContinuityCheckpoint(input)).ok, false);
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-continuity-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-continuity-outside-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  const c = checkpoint();
  const save = () => fs.writeFile(path.join(root, 'checkpoint.json'), JSON.stringify(c));
  const read = () => readContinuityCheckpoint({ projectRoot: root, file: 'checkpoint.json', expected: expected() });
  await fs.writeFile(path.join(root, 'task.md'), 'original task note'); await save();
  assert.equal((await read()).ok, true);
  await fs.writeFile(path.join(root, 'task.md'), 'changed source');
  assert.equal((await read()).diagnostics[0].code, 'CHECKPOINT_EVIDENCE_MISMATCH');
  c.evidence[0].path = 'missing'; await save(); assert.equal((await read()).ok, false);
  await fs.writeFile(path.join(outside, 'secret'), 'do not read');
  await fs.symlink(outside, path.join(root, 'escape'));
  c.evidence[0].path = 'escape/secret'; await save(); assert.equal((await read()).ok, false);
  c.evidence[0].path = '.'; await save(); assert.equal((await read()).ok, false);
  await fs.writeFile(path.join(root, 'huge'), 'x'.repeat(1048577));
  c.evidence[0].path = 'huge'; await save(); assert.equal((await read()).ok, false);
  await fs.writeFile(path.join(root, 'checkpoint.json'), 'x'.repeat(32769)); assert.equal((await read()).ok, false);
});

test('schema and public example retain the same closed top-level and section contracts', async () => {
  const schema = JSON.parse(await fs.readFile(new URL('../schemas/continuity.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual([...schema.required].sort(), Object.keys(checkpoint()).sort());
  assert.deepEqual([...schema.properties.sections.required].sort(), Object.keys(checkpoint().sections).sort());
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.sections.additionalProperties, false);
});
