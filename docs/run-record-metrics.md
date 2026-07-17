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
