# Continuity Validation

2026-09-11: local Node 24 tests passed 39/39; `npm run check` and
`git diff --check` passed. No runtime dependencies, shell/network discovery or
checkpoint writes were added.

Independent fresh-agent forward tests passed 128/128: 82 baseline cases,
23 hostile-input/evidence cases and 23 context-accounting cases. Initial
baseline result was 80/82; null/undefined reader arguments threw before the
guard. The guard was fixed and independently retested. Final runs completed
16:10:32-16:11:01 UTC. Raw synthetic reports remain in the owning task's private
artifact store, directory `continuity-forward-eval-20260911`, files
`scope-rerun-report.json`, `scope-extra-report.json`, `scope-budget-report.json`.
Host token telemetry unavailable. This is API proof, not native compaction or
semantic checkpoint completeness. Independent Ajv validation disabled formats;
strict timestamp semantics are exercised by the runtime validator tests instead.

Model-aware accounting follows the effective total/body-after-prefix distinction
documented at https://learn.chatgpt.com/docs/config-file/config-reference
(reviewed 2026-09-11). No model-family limit guesses or configuration mutations.
