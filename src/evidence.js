import { createHash } from 'node:crypto';

const MAX_BYTES = 8 * 1024 * 1024;
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new TypeError(`Invalid ${name}`);
}
function timestamp(value) {
  requireString(value, 'timestamp');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new TypeError('Expected canonical UTC timestamp');
  return parsed;
}
function validateText(text) {
  if (typeof text !== 'string' || !text.isWellFormed() || Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new TypeError('Invalid or oversized evidence');
}

// Pure adapter: the caller retains the original; no storage, shell, or network side effects.
export function compactLogEvidence({ text, scope, source, expiresAt, classification, maxRuns = 40, maxPreviewBytes = 16384 }) {
  validateText(text);
  requireString(scope, 'scope');
  requireString(source, 'source');
  timestamp(expiresAt);
  if (!['public', 'sanitized'].includes(classification)) throw new TypeError('Sanitize restricted evidence before reduction');
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 1000) throw new TypeError('Invalid maxRuns');
  if (!Number.isInteger(maxPreviewBytes) || maxPreviewBytes < 128 || maxPreviewBytes > 65536) throw new TypeError('Invalid preview budget');
  const lines = text.split('\n');
  const runs = [];
  let totalRuns = 0;
  let previewBytes = 0;
  let clipped = false;
  let last;
  let count = 0;
  let start = 1;
  function flush() {
    if (!count) return;
    totalRuns++;
    const run = { line: last, count, startLine: start };
    const bytes = Buffer.byteLength(JSON.stringify(run), 'utf8');
    if (runs.length >= maxRuns || previewBytes + bytes > maxPreviewBytes) clipped = true;
    if (!clipped) { runs.push(run); previewBytes += bytes; }
  }
  for (let i = 0; i < lines.length; i++) {
    if (count && lines[i] === last) count++;
    else { flush(); last = lines[i]; count = 1; start = i + 1; }
  }
  flush();
  const representedLines = runs.reduce((sum, run) => sum + run.count, 0);
  return {
    schemaVersion: 1, kind: 'log-runs', scope, source, classification, expiresAt,
    sha256: hash(text), originalBytes: Buffer.byteLength(text, 'utf8'),
    totalLines: lines.length, totalRuns, runs,
    omittedLines: lines.length - representedLines,
    completeness: representedLines === lines.length ? 'complete' : 'partial',
    evidenceOnly: true,
  };
}

export function retrieveLogEvidence(envelope, original, expected, now) {
  if (!envelope || !expected || envelope.schemaVersion !== 1 || envelope.kind !== 'log-runs') throw new TypeError('Invalid evidence envelope');
  for (const key of ['scope', 'source', 'sha256', 'expiresAt', 'classification']) {
    requireString(expected[key], key);
    if (envelope[key] !== expected[key]) throw new Error(`Evidence identity mismatch: ${key}`);
  }
  if (timestamp(now) >= timestamp(expected.expiresAt)) throw new Error('Evidence expired; reacquire source');
  if (!['public', 'sanitized'].includes(expected.classification)) throw new Error('Evidence classification rejected');
  validateText(original);
  if (hash(original) !== expected.sha256) throw new Error('Evidence unavailable or integrity mismatch');
  return original;
}
