# Behavior Baselines

Use `behaviorBaselines` when phrase inventory is insufficient and a behavior claim needs source-bound evaluation evidence. A baseline binds four things:

1. Exact source files and their deterministic SHA-256 digest.
2. One scenario ID, a `full-contract-v2` digest scope, all complete scenario source files, an explicit fixture-file list, and their digest.
3. A sanitized run record whose filename equals its `runId`.
4. Exact passing checks, measured outcome, lineage, freshness, and optional telemetry ceilings.

The source digest processes sorted relative paths as `path`, NUL, byte length, NUL, raw bytes, NUL. The `full-contract-v2` scenario digest starts with the scope and scenario ID, then hashes the `scenario` and `fixture` groups separately. Within each group it processes sorted relative paths as `path`, NUL, byte length, NUL, raw bytes, NUL. Scenario files are hashed in full, not just selected lines; fixture inputs are hashed in full and must be listed in `fixtureFiles`. Changing either list or any byte in a listed file makes the approved digest stale. Anchor-only baseline records are rejected; migrate them by reviewing the complete scenario and fixtures, then generating new evidence and refreshing all tested digests.

Evidence passes only when current and tested source/scenario digests agree, the run-record byte digest agrees, all and only required checks pass, `metrics.checks_passed` equals the check count, `lineage.verificationId` equals `runId`, `lineage.artifactPointer` exists, and `measurement.status` is `met`. Optional `maxAgeDays`, tags, absolute metric ceilings, and baseline-plus-regression ceilings provide bounded freshness and runtime cost gates.

Keep run records sanitized. Store evidence pointers and numeric metrics, never prompts, model output, secrets, private payloads, or product data. A baseline proves the recorded scenario at the recorded source state; it does not replace product-specific live proof.
