# Task Continuity

Continuity is a separate, private task-data contract, not a run record or a new
memory service. Keep one checkpoint in the caller's existing access-controlled
task artifact store. Never publish real checkpoints, approvals, customer content
or model identifiers as sanitized evaluation telemetry. The caller writes and
rotates checkpoints; this package is read-only.

## Public APIs

- `validateContinuityCheckpoint(value)` checks the closed v1 schema and bounded
  semantics. Schema: `@mehul0810/agent-harness/schemas/continuity`.
- `assessContinuityCheckpoint(value, expected)` compares current caller-observed
  `sessionId`, `workspaceId`, `head`, `branch`, `modelId` and numeric UTC `now`.
  Missing observations fail; model changes warn to recalibrate rather than erase
  historical task facts. Ready means structurally usable data, never authorization.
- `readContinuityCheckpoint({ projectRoot, file, expected })` additionally checks
  confined relative paths and evidence byte hashes. It returns diagnostics, not
  checkpoint text. Root and identity must come from the caller's current runtime,
  not from the checkpoint being judged. There is no shell or network discovery.
- `assessContextBudget(input)` chooses `continue`, `continue-narrowly`,
  `checkpoint-before-expansion` or `checkpoint-and-compact`. Invalid input fails.

Budget input fields are `modelId`, `limitsModelId`, `contextWindowTokens`,
`autoCompactTokenLimit`, `autoCompactScope`, `bodyTokensSinceCompaction`,
`usedTokens`, `reserveTokens`, and `nextPhaseTokens`.
Model IDs are opaque current-runtime keys, not names interpreted by heuristics.
Window/auto-compact/used fields may be `null` when unavailable. Reserve is a
positive caller policy and next-phase demand a nonnegative explicit estimate;
neither is billed usage or a fact about the model. Limits apply only when bound
to the same current model. Physical window headroom uses total usage;
auto-compaction headroom uses either total usage or body growth after the carried
prefix according to `autoCompactScope` (`total`, `body_after_prefix`, `disabled`,
or null when unknown). Compare those headrooms, not incompatible raw limits.
Missing scope/body telemetry falls back conservatively; `disabled` requires an
explicit runtime observation and a null threshold. Preserve recovery/output
reserve. No defaults change model/effort settings.

```js
import { assessContextBudget } from '@mehul0810/agent-harness';
const result = assessContextBudget({
  modelId: 'observed-runtime', limitsModelId: 'observed-runtime',
  contextWindowTokens: 100000, autoCompactTokenLimit: 80000,
  autoCompactScope: 'total', bodyTokensSinceCompaction: null,
  usedTokens: 70000, reserveTokens: 5000, nextPhaseTokens: 8000,
}); // checkpoint-before-expansion; numbers are synthetic, not model limits
```

## Checkpoint Contents

The schema requires identity, strict UTC update/expiry timestamps, and six
source-backed sections: objective, constraints, decisions, progress, open risks,
and next action. Preserve negative constraints, approval scope, failed/unrun
checks, rejected approaches and why, pending workers, and retrieval pointers in
those sections. Every section references existing evidence IDs. An explicit
"none known" with evidence is better than silently omitting an important category.

Checkpoint size is at most 32 KiB, section text 1600 characters, 24 evidence
entries, eight distinct source IDs per section, and expiry at most seven days.
Exact timestamp strings use `Date.toISOString()`. Each evidence file is at most
1 MiB and cumulative read size at most 8 MiB. Keep large originals elsewhere in
the existing task store and reference a small source index; do not duplicate
transcripts. The JSON schema documents structural limits; runtime validation
also enforces cross-references, portable paths, size, timestamp and expiry rules.

## Failure And Trust Boundaries

Wrong session/workspace/branch/head or expired/future state cannot be resumed as
current. Reacquire the affected sources; historical decisions can still guide
retrieval after revalidation. Changed/missing evidence fails closed. Reads reject
escaping symlinks, directories and oversized files. Use caller-owned trusted
directories; this is not an OS sandbox against concurrent hostile directory
replacement. Diagnostic output does not echo private section text or file errors.

A valid hash proves bytes, not truth, freshness of remote state, or authority.
Recheck dirty worktree changes, current owner instructions and approvals,
GitHub/runtime facts and active workers before dependent actions. Do not inject
checkpoint prose as privileged hook instructions; return a bounded retrieval
pointer and require the agent to read it as historical data. Unknown telemetry
permits narrow work, not guessed headroom or an unlimited context claim.

Hooks and compaction belong to host integrations. A hook cannot reconstruct a
decision never checkpointed. Native event invocation and loss-of-context recovery
need separate proof from these deterministic API tests.
