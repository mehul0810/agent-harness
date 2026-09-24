# Run-record metrics

Run records are sanitized evidence, not prompt or model transcripts. Record a metric only when the host or tool reports it; omit unavailable values rather than estimating them.

Preferred portable names:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `context_tokens_peak`
- `tool_calls`
- `retry_count`
- `checks_passed`

Metrics must be finite numbers. Do not store prompts, completions, model identifiers, secrets, product payloads, user content, cost-account identifiers, or hidden reasoning. Use `tags` for a non-sensitive capability class or route only when it aids comparison.

Compare like-for-like scenarios. Token reduction does not count as an improvement when correctness, proof, safety, or task completion regresses.

## Paired efficiency comparison

The library exports `compareRuns({ schemaVersion: 1, baselineId, candidateId, requiredChecks, pairs })`.
Each pair is `{ split: 'train' | 'held-out', baseline: runRecord, candidate: runRecord }`.
Variant IDs are opaque experiment aliases, not model names or prompts. Keep the mapping in the experiment owner's private system.

Predeclare the required quality checks and reserve unseen tasks before tuning. Both records must share `scenario`, `lineage.workItemId`, and `lineage.artifactPointer` (an immutable input artifact identifier, not the generated output). Identities cannot repeat across pairs or splits; run IDs cannot be reused. This detects declared identity overlap, not semantic leakage or dishonest labels: the benchmark owner must ensure held-out tasks were not used in prompt/model selection.

Reports keep train and held-out totals separate. A quality floor passes only when every baseline and candidate run succeeded, met its measured outcome, and passed every required check. Numeric differences remain descriptive even when this floor fails; they are not improvement claims. No statistical significance, automatic rollout, or composite efficiency score is inferred.

Record full-task duration and host-measured counters, including retrieval, verification, and all retries; do not submit only the successful final attempt. Set `durationScope` to `full_task` only when `durationMs` covers that whole task. Use `partial_observation_window` or `shared_batch_interval` for narrower or shared timings; duration comparisons exclude those scopes and unscoped legacy records. Reports compare eligible `durationMs` and the portable token/tool/retry metrics above, with candidate-minus-baseline deltas. A metric absent or ineligible on either side of any pair is explicitly `unavailable` for that split, never zero or a partial total. Word counts cannot stand in for token/cost savings. Cached input tokens are reported separately, not added to input tokens; context peak values report the maximum per variant across the split, not a sum. Cached input tokens cannot exceed total input tokens when both are present. Duplicate check names and any failed check in a succeeded run are rejected. Interpret fewer tokens alongside retries, latency, and quality, not in isolation.
