# Contributing

## Communication

Use the [shared cross-project writing standard](https://github.com/mehul0810/agent-skills/blob/main/shared/references/github-communication-protocol.md). Explicit repository or upstream formats take precedence; preserve their required fields.

Commit subjects, PR titles and issue titles default to:

```text
type(scope): plain-language summary
```

Use a lowercase purpose such as `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore` or `revert`, and a stable area as scope. Aim for 72 characters without a final period. Commit/PR titles describe the actual change; issues describe the observed problem or requested outcome without inventing a diagnosis.

Scale the body to the artifact: summary, context, changes/scope, validation/evidence, risks and next action, then links. Substantive commits include the reason or non-obvious constraint and checks/gaps after a blank line; typo-only commits can use just a subject. PRs and issues retain every required field in this repository's templates, not merely their headings.

Distinguish `Passed`, `Failed`, `Blocked` and `Not run`, identifying the command, environment and tested revision/artifact. Keep local, CI, packaged, editor/browser and production proof separate. Proposed tests are not completed validation.

For owner-managed project tasks under the standing owner policy, do not make macOS VoiceOver or voice-over narration verification a completion gate unless the owner explicitly requests it. Record those checks as excluded by owner direction, never as passed; do not substitute another screen reader to recreate the waived gate. Preserve other applicable accessibility and safety checks, including keyboard/focus, semantics, labels, contrast, captions and automated checks. Do not infer assistive-technology compatibility, verified narration or WCAG conformance from this exclusion.

Reviews put actionable findings first. Handoffs retain evidence, blockers and the exact next action. Release notes use audience-facing outcomes, not commit prefixes or unverified shipped claims. Avoid duplicate progress comments, private data and invented attribution.

Do not rename historical titles/messages, rewrite commits, edit others' drafts or override generated titles solely for consistency. Formatting grants no posting, merge, release or deployment authority.

## Validation And Publication

Run the checks documented in this repository's `AGENTS.md` and testing documentation. Follow its branch and approval policy; writing conventions do not change those gates. Report unrun checks and material limitations rather than implying success.
