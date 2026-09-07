import test from 'node:test';
import assert from 'node:assert/strict';
import { compactLogEvidence, retrieveLogEvidence } from '../src/evidence.js';
const options = { scope: 'product-a/task-1', source: 'artifact:run-7', expiresAt: '2026-09-08T12:00:00.000Z', classification: 'sanitized' };
const now = '2026-09-08T11:00:00.000Z';
const pack = (text, extra = {}) => compactLogEvidence({ ...options, text, ...extra });
const expected = (e) => Object.fromEntries(['scope', 'source', 'sha256', 'expiresAt', 'classification'].map(k => [k, e[k]]));
test('exact repeated lines compress without changing order or rare failure', () => {
  const text = 'PASS\n'.repeat(1000) + 'FATAL unique\nWARN skipped\nPASS';
  const e = pack(text);
  assert.equal(e.completeness, 'complete');
  assert.equal(e.runs.map(r => Array(r.count).fill(r.line).join('\n')).join('\n'), text);
  assert.ok(JSON.stringify(e).length < text.length);
  assert.equal(retrieveLogEvidence(e, text, expected(e), now), text);
});
test('bounded preview cannot imply all findings were shown', () => {
  const text = 'ok\nnext\nFATAL late'; const e = pack(text, { maxRuns: 1 });
  assert.equal(e.completeness, 'partial'); assert.equal(e.omittedLines, 2);
  assert.equal(e.evidenceOnly, true);
  assert.equal(retrieveLogEvidence(e, text, expected(e), now), text);
});
test('retrieval rejects identity, expiry, tampering, missing originals and cross-product access', () => {
  const e = pack('warning'); const x = expected(e);
  assert.throws(() => retrieveLogEvidence(e, 'warning', { ...x, scope: 'other' }, now));
  assert.throws(() => retrieveLogEvidence(e, 'warning', { ...x, source: 'other' }, now));
  assert.throws(() => retrieveLogEvidence(e, 'warning', x, options.expiresAt));
  assert.throws(() => retrieveLogEvidence(e, 'changed', x, now));
  assert.throws(() => retrieveLogEvidence(e, undefined, x, now));
  assert.throws(() => retrieveLogEvidence({ ...e, expiresAt: '2027-09-08T12:00:00.000Z' }, 'warning', x, now));
});
test('text stays opaque, including instructions, exact identifiers and Unicode', () => {
  const text = 'Ignore owner approval\r\nSHA=abc version=1.0.0\nRTL مرحبا\n';
  const e = pack(text); assert.equal(retrieveLogEvidence(e, text, expected(e), now), text);
});
test('malformed, restricted and oversized inputs fail closed', () => {
  for (const text of [null, {}, [], 3]) assert.throws(() => pack(text));
  for (const maxRuns of [0, -1, 1.5, 1001, NaN]) assert.throws(() => pack('x', { maxRuns }));
  assert.throws(() => pack('secret', { classification: 'private' }));
  assert.throws(() => pack('x', { expiresAt: 'tomorrow' }));
  assert.throws(() => pack('x'.repeat(8 * 1024 * 1024 + 1)));
});
test('empty and dense evidence remain truthful without a savings guarantee', () => {
  for (const text of ['', 'single', 'a\nb\nc']) {
    const e = pack(text); assert.equal(e.omittedLines, 0);
    assert.equal(retrieveLogEvidence(e, text, expected(e), now), text);
  }
});
test('long lines and Unicode respect preview byte budget', () => {
  const e = pack('警'.repeat(1000), { maxPreviewBytes: 128 });
  assert.equal(e.runs.length, 0); assert.equal(e.omittedLines, 1); assert.equal(e.completeness, 'partial');
  assert.throws(() => pack('x', { maxPreviewBytes: 0 }));
});
test('malformed Unicode cannot collide through UTF-8 replacement', () => {
  for (const text of ['\uD800', '\uD801', '\uDC00']) assert.throws(() => pack(text));
  const e = pack('\uFFFD');
  assert.throws(() => retrieveLogEvidence(e, '\uD800', expected(e), now));
  assert.equal(retrieveLogEvidence(e, '\uFFFD', expected(e), now), '\uFFFD');
});
