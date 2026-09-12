import crypto from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { assertPortableRelativePath, resolveProjectFile } from './path-safety.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const HEAD = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SECTIONS = ['objective', 'constraints', 'decisions', 'progress', 'openRisks', 'nextAction'];
const KEYS = ['schemaVersion', 'checkpointId', 'sessionId', 'workspaceId', 'head', 'branch', 'modelId', 'updatedAt', 'expiresAt', 'sections', 'evidence'];
const issue = (code, path) => ({ code, path, severity: 'error' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
const shape = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const model = value => value === null || (typeof value === 'string' && MODEL.test(value));

/** Validate bounded task data. Valid shape does not confer authority or factual truth. */
export function validateContinuityCheckpoint(value) {
  const diagnostics = [];
  try {
    if (!shape(value, KEYS)) return { ok: false, diagnostics: [issue('CHECKPOINT_SHAPE', '$')] };
    if (value.schemaVersion !== 1) diagnostics.push(issue('CHECKPOINT_VERSION', 'schemaVersion'));
    for (const key of ['checkpointId', 'sessionId']) {
      if (typeof value[key] !== 'string' || !ID.test(value[key])) diagnostics.push(issue('CHECKPOINT_ID', key));
    }
    if (typeof value.workspaceId !== 'string' || !HASH.test(value.workspaceId)) diagnostics.push(issue('CHECKPOINT_WORKSPACE', 'workspaceId'));
    if (typeof value.head !== 'string' || !HEAD.test(value.head)) diagnostics.push(issue('CHECKPOINT_HEAD', 'head'));
    if (!text(value.branch, 200) || /[\r\n]/u.test(value.branch)) diagnostics.push(issue('CHECKPOINT_BRANCH', 'branch'));
    if (!model(value.modelId)) diagnostics.push(issue('CHECKPOINT_MODEL', 'modelId'));
    if (!timestamp(value.updatedAt) || !timestamp(value.expiresAt)
      || Date.parse(value.expiresAt) <= Date.parse(value.updatedAt)
      || Date.parse(value.expiresAt) - Date.parse(value.updatedAt) > 7 * 86400000) {
      diagnostics.push(issue('CHECKPOINT_TIME', 'expiresAt'));
    }
    const ids = new Set();
    if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > 24) {
      diagnostics.push(issue('CHECKPOINT_EVIDENCE', 'evidence'));
    } else {
      for (const [index, item] of value.evidence.entries()) {
        const at = `evidence.${index}`;
        if (!shape(item, ['id', 'path', 'sha256']) || typeof item.id !== 'string' || !ID.test(item.id)
          || typeof item.sha256 !== 'string' || !HASH.test(item.sha256) || !text(item.path, 512)) {
          diagnostics.push(issue('CHECKPOINT_EVIDENCE', at));
          continue;
        }
        if (ids.has(item.id)) diagnostics.push(issue('CHECKPOINT_DUPLICATE', at));
        ids.add(item.id);
        try { assertPortableRelativePath(item.path, 'Evidence'); }
        catch { diagnostics.push(issue('CHECKPOINT_PATH', at)); }
      }
    }
    if (!shape(value.sections, SECTIONS)) diagnostics.push(issue('CHECKPOINT_SECTIONS', 'sections'));
    else for (const key of SECTIONS) {
      const part = value.sections[key];
      if (!shape(part, ['text', 'sources']) || !text(part.text, 1600) || !Array.isArray(part.sources)
        || part.sources.length < 1 || part.sources.length > 8
        || part.sources.some(id => !ids.has(id)) || new Set(part.sources).size !== part.sources.length) {
        diagnostics.push(issue('CHECKPOINT_SECTION', `sections.${key}`));
      }
    }
    if (Buffer.byteLength(JSON.stringify(value)) > 32768) diagnostics.push(issue('CHECKPOINT_SIZE', '$'));
    return { ok: diagnostics.length === 0, diagnostics };
  } catch {
    return { ok: false, diagnostics: [issue('CHECKPOINT_SHAPE', '$')] };
  }
}

/** Match current caller-observed identity; never accept cached identity as current. */
export function assessContinuityCheckpoint(value, expected) {
  const result = validateContinuityCheckpoint(value);
  if (!result.ok) return { ...result, status: 'invalid', warnings: [] };
  try {
    if (!shape(expected, ['sessionId', 'workspaceId', 'head', 'branch', 'modelId', 'now'])
      || typeof expected.sessionId !== 'string' || !ID.test(expected.sessionId)
      || typeof expected.workspaceId !== 'string' || !HASH.test(expected.workspaceId)
      || typeof expected.head !== 'string' || !HEAD.test(expected.head)
      || !text(expected.branch, 200) || !model(expected.modelId) || !Number.isSafeInteger(expected.now) || expected.now < 0) {
      return { ok: false, status: 'invalid', diagnostics: [issue('CHECKPOINT_OBSERVATION', '$')], warnings: [] };
    }
    const diagnostics = [];
    for (const key of ['sessionId', 'workspaceId', 'head', 'branch']) {
      if (value[key] !== expected[key]) diagnostics.push(issue('CHECKPOINT_IDENTITY_MISMATCH', key));
    }
    if (expected.now >= Date.parse(value.expiresAt) || expected.now < Date.parse(value.updatedAt)) {
      diagnostics.push(issue('CHECKPOINT_STALE', 'expiresAt'));
    }
    const warnings = [];
    if (value.modelId === null || expected.modelId === null) warnings.push({ code: 'MODEL_UNVERIFIED' });
    else if (value.modelId !== expected.modelId) warnings.push({ code: 'MODEL_CHANGED_RECALIBRATE' });
    return { ok: diagnostics.length === 0, status: diagnostics.length ? 'stale' : 'ready', diagnostics, warnings };
  } catch {
    return { ok: false, status: 'invalid', diagnostics: [issue('CHECKPOINT_OBSERVATION', '$')], warnings: [] };
  }
}

async function readBounded(root, relative, limit) {
  const file = await resolveProjectFile(root, relative);
  if (!file.exists) throw Object.assign(new Error('unavailable'), { code: 'ENOENT' });
  if (!file.isFile) throw new Error('unavailable');
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new Error('not bounded file');
    const buffer = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > limit) throw new Error('oversized');
    return buffer.subarray(0, used);
  } finally { await handle.close(); }
}

/** Read-only adapter; no transcript access, shell, network, or checkpoint writes. */
export async function readContinuityCheckpoint(input) {
  return readCheckpoint(input, false);
}

/** Historical retrieval never changes the strict current-state or approval verdict. */
export async function readContinuityRecovery(input) {
  return readCheckpoint(input, true);
}

async function readCheckpoint(input, recovery) {
  let checkpointRead = false;
  try {
    if (!shape(input, ['projectRoot', 'file', 'expected'])) throw new Error('invalid input');
    const { projectRoot, file, expected } = input;
    const root = await realpath(projectRoot);
    const value = JSON.parse((await readBounded(root, file, 32768)).toString('utf8'));
    checkpointRead = true;
    const result = assessContinuityCheckpoint(value, expected);
    const historical = recovery && result.status === 'stale'
      && value.sessionId === expected.sessionId && value.workspaceId === expected.workspaceId
      && expected.now >= Date.parse(value.updatedAt)
      && result.diagnostics.every(d => d.code === 'CHECKPOINT_STALE'
        || (d.code === 'CHECKPOINT_IDENTITY_MISMATCH' && ['head', 'branch'].includes(d.path)));
    if (!result.ok && !historical) return result;
    let total = 0;
    for (const item of value.evidence) {
      const bytes = await readBounded(root, item.path, 1048576);
      total += bytes.length;
      if (total > 8388608 || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
        return { ok: false, status: 'stale', diagnostics: [issue('CHECKPOINT_EVIDENCE_MISMATCH', 'evidence')], warnings: [] };
      }
    }
    if (historical) return { ...result, ok: false, status: 'historical', retrievable: true };
    return recovery ? { ...result, retrievable: true } : result;
  } catch (error) {
    if (recovery && !checkpointRead && error?.code === 'ENOENT') {
      return { ok: false, status: 'absent', retrievable: false, diagnostics: [issue('CHECKPOINT_ABSENT', '$')], warnings: [] };
    }
    return { ok: false, status: 'invalid', diagnostics: [issue('CHECKPOINT_UNAVAILABLE', '$')], warnings: [] };
  }
}

/** Headroom policy uses effective model-bound observations, never model-name heuristics. */
export function assessContextBudget(input) {
  try {
    const keys = ['modelId', 'limitsModelId', 'contextWindowTokens', 'autoCompactTokenLimit', 'autoCompactScope', 'bodyTokensSinceCompaction', 'usedTokens', 'reserveTokens', 'nextPhaseTokens'];
    const integer = (value, min) => Number.isSafeInteger(value) && value >= min && value <= 1000000000;
    if (!shape(input, keys) || !model(input.modelId) || !model(input.limitsModelId)
      || !integer(input.reserveTokens, 1) || !integer(input.nextPhaseTokens, 0)
      || (input.contextWindowTokens !== null && !integer(input.contextWindowTokens, 1))
      || (input.autoCompactTokenLimit !== null && !integer(input.autoCompactTokenLimit, 1))
      || ![null, 'total', 'body_after_prefix', 'disabled'].includes(input.autoCompactScope)
      || (input.autoCompactScope === 'disabled' && input.autoCompactTokenLimit !== null)
      || (input.bodyTokensSinceCompaction !== null && !integer(input.bodyTokensSinceCompaction, 0))
      || (input.bodyTokensSinceCompaction !== null && input.usedTokens !== null && input.bodyTokensSinceCompaction > input.usedTokens)
      || (input.usedTokens !== null && !integer(input.usedTokens, 0))) {
      return { ok: false, action: 'invalid', diagnostics: [issue('CONTEXT_BUDGET_INVALID', '$')] };
    }
    if (input.modelId === null || input.modelId !== input.limitsModelId || input.contextWindowTokens === null || input.usedTokens === null
      || input.autoCompactScope === null
      || (input.autoCompactScope !== 'disabled' && input.autoCompactTokenLimit === null)
      || (input.autoCompactScope === 'body_after_prefix' && input.bodyTokensSinceCompaction === null)) {
      return { ok: true, action: input.nextPhaseTokens ? 'checkpoint-before-expansion' : 'continue-narrowly', reason: 'unverified-model-or-telemetry', availableTokens: null };
    }
    const windowHeadroom = input.contextWindowTokens - input.usedTokens;
    const compactHeadroom = input.autoCompactScope === 'disabled' ? windowHeadroom
      : input.autoCompactTokenLimit - (input.autoCompactScope === 'total' ? input.usedTokens : input.bodyTokensSinceCompaction);
    const availableTokens = Math.max(0, Math.min(windowHeadroom, compactHeadroom));
    const action = availableTokens <= input.reserveTokens ? 'checkpoint-and-compact'
      : availableTokens <= input.reserveTokens + input.nextPhaseTokens ? 'checkpoint-before-expansion' : 'continue';
    return { ok: true, action, reason: 'effective-headroom', availableTokens };
  } catch {
    return { ok: false, action: 'invalid', diagnostics: [issue('CONTEXT_BUDGET_INVALID', '$')] };
  }
}
