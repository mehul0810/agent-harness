import { validateRunRecordObject } from './contracts.js';

const METRICS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'context_tokens_peak', 'tool_calls', 'retry_count'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value);

// This reports observations, not statistical significance or permission to roll out.
export function compareRuns(input) {
  const diagnostics = [];
  const reject = (path, message) => diagnostics.push({ path, message });
  const closed = (value, keys, path) => {
    if (!object(value)) { reject(path, 'Expected an object.'); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) reject(`${path}.${key}`, 'Unknown field.');
    return true;
  };
  if (!closed(input, ['schemaVersion', 'baselineId', 'candidateId', 'requiredChecks', 'pairs'], '$')) return { valid: false, diagnostics };
  if (input.schemaVersion !== 1) reject('$.schemaVersion', 'Expected 1.');
  for (const key of ['baselineId', 'candidateId']) if (!id(input[key])) reject(`$.${key}`, 'Expected an opaque portable identifier.');
  if (input.baselineId === input.candidateId) reject('$.candidateId', 'Variants must differ.');
  if (!Array.isArray(input.requiredChecks) || !input.requiredChecks.length || input.requiredChecks.some((name) => typeof name !== 'string' || !name.trim()) || new Set(input.requiredChecks).size !== input.requiredChecks.length) reject('$.requiredChecks', 'Expected distinct non-empty quality check names.');
  if (!Array.isArray(input.pairs) || !input.pairs.length) reject('$.pairs', 'Expected non-empty paired runs.');
  const identities = new Set();
  const runs = new Set();
  for (const [index, pair] of (Array.isArray(input.pairs) ? input.pairs : []).entries()) {
    const path = `$.pairs[${index}]`;
    if (!closed(pair, ['split', 'baseline', 'candidate'], path)) continue;
    if (!['train', 'held-out'].includes(pair.split)) reject(`${path}.split`, 'Expected train or held-out.');
    let validRuns = true;
    for (const variant of ['baseline', 'candidate']) {
      const run = pair[variant];
      let result;
      try { result = validateRunRecordObject(run); } catch { result = { valid: false }; }
      if (!result.valid) { reject(`${path}.${variant}`, 'Invalid run record.'); validRuns = false; continue; }
      if (runs.has(run.runId)) reject(`${path}.${variant}.runId`, 'Run cannot be reused.');
      runs.add(run.runId);
      for (const metric of METRICS) if (run.metrics[metric] !== undefined && (run.metrics[metric] < 0 || !Number.isInteger(run.metrics[metric]))) reject(`${path}.${variant}.metrics.${metric}`, 'Expected a non-negative integer count.');
      if (!run.lineage?.workItemId || !run.lineage?.artifactPointer) reject(`${path}.${variant}.lineage`, 'Task and artifact identity are required.');
    }
    if (!validRuns) continue;
    const a = pair.baseline;
    const b = pair.candidate;
    if (a.scenario !== b.scenario || a.lineage?.workItemId !== b.lineage?.workItemId || a.lineage?.artifactPointer !== b.lineage?.artifactPointer) reject(path, 'Paired task, artifact, and scenario identities must match.');
    const identity = JSON.stringify([a.scenario, a.lineage?.workItemId, a.lineage?.artifactPointer]);
    if (identities.has(identity)) reject(path, 'Task/artifact identity must be unique across all splits.');
    identities.add(identity);
  }
  if (diagnostics.length) return { valid: false, diagnostics };
  const quality = (run) => run.result === 'succeeded' && run.measurement?.status === 'met' && input.requiredChecks.every((name) => run.checks.some((check) => check.name === name && check.result === 'pass'));
  const splits = {};
  for (const split of ['train', 'held-out']) {
    const pairs = input.pairs.filter((pair) => pair.split === split);
    const metrics = {};
    for (const metric of ['durationMs', ...METRICS]) {
      const read = (run) => metric === 'durationMs' ? run.durationMs : run.metrics[metric];
      if (!pairs.length || pairs.some((pair) => read(pair.baseline) === undefined || read(pair.candidate) === undefined)) {
        metrics[metric] = { status: 'unavailable' };
        continue;
      }
      const baseline = pairs.reduce((sum, pair) => sum + read(pair.baseline), 0);
      const candidate = pairs.reduce((sum, pair) => sum + read(pair.candidate), 0);
      metrics[metric] = Number.isSafeInteger(baseline) && Number.isSafeInteger(candidate)
        ? { status: 'available', baseline, candidate, delta: candidate - baseline }
        : { status: 'unavailable' };
    }
    splits[split] = { pairs: pairs.length, qualityFloorMet: pairs.length > 0 && pairs.every((pair) => quality(pair.baseline) && quality(pair.candidate)), metrics };
  }
  return { valid: true, diagnostics, baselineId: input.baselineId, candidateId: input.candidateId, splits };
}
