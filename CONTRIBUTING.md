# Contributing

## Communication

Use the [shared cross-project writing standard](https://github.com/mehul0810/agent-skills/blob/main/shared/references/github-communication-protocol.md). Explicit repository or upstream formats take precedence; preserve their required fields.

Inspect repository guidance, recent commits and upstream templates first. Use their format, including non-Conventional Commit formats. Only when no convention applies, commit subjects, PR titles and issue titles default to:

```text
type(scope): plain-language summary
```

Use a lowercase purpose such as `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore` or `revert`, and a stable area as scope. Aim for 72 characters without a final period. Commit/PR titles describe the actual change; issues describe the observed problem or requested outcome without inventing a diagnosis.

Scale the body to the artifact: summary, context, changes/scope, validation/evidence, risks and next action, then links. Substantive commits include the reason or non-obvious constraint and checks/gaps after a blank line; typo-only commits can use just a subject. PRs and issues retain every required field in this repository's templates, not merely their headings.

Distinguish `Passed`, `Failed`, `Blocked` and `Not run`, identifying the command, environment and tested revision/artifact. Keep local, CI, packaged, editor/browser and production proof separate. Proposed tests are not completed validation.

For owner-managed project tasks under the standing owner policy, do not make macOS VoiceOver or voice-over narration verification a completion gate unless the owner explicitly requests it. Record those checks as excluded by owner direction, never as passed; do not substitute another screen reader to recreate the waived gate. Preserve other applicable accessibility and safety checks, including keyboard/focus, semantics, labels, contrast, captions and automated checks. Do not infer assistive-technology compatibility, verified narration or WCAG conformance from this exclusion.

Reviews put actionable findings first. Handoffs retain evidence, blockers and the exact next action. Release notes use audience-facing outcomes, not commit prefixes or unverified shipped claims. Avoid duplicate progress comments, private data and invented attribution.

Do not rename historical titles/messages, rewrite commits, edit others' drafts or override generated titles solely for consistency. Formatting grants no posting, merge, release or deployment authority.

## Local Commits And Remote Delivery

Use the [shared change-delivery discipline](https://github.com/mehul0810/agent-skills/blob/29587b6450d98f87d25d171fadb586f041aea019/shared/references/change-delivery-discipline.md). Stricter owner, client or upstream restrictions still apply.

Keep authorized work in small, coherent commits after applicable checks. For owner-managed `agent-*` repositories, an applicable standing owner policy may authorize scoped, validated direct pushes to `main`; verify that it applies and never infer it from the repository name or this template. Before pushing, inspect the actual target, branch protections, workflows, integrations and downstream effects; preserve required review/checks and do not bypass protection. Such authorization excludes package/release publication, deployment, destructive actions, private-data transfer and unrelated client/project pushes. Other projects retain their applicable authorization requirements.

Client work remains push-on-request because a push may deploy. Separately, the standing no-effects exception permits an owner-authorized open-source plugin task push only after verifying that its exact destination triggers no CI, pipeline, deployment, publication or release. Unknown effects require a hold; public visibility or disabled-looking workflows are insufficient. Never disable automation or add skip directives to qualify.

A commit does not authorize a push, PR, merge, release or deployment by itself; the scoped standing authorization above is separate.

Commits, branch choice, push, PR, merge, package/release publication and deployment remain distinct actions. Verify the real downstream effects and protection state before a direct push. Ordinary CI may run, but do not infer release/deployment authority; unknown material effects require a hold. Non-agent/client work remains subject to its own applicable authorization; do not use this standing policy to push unrelated client work. Never disable automation or add skip directives to manufacture eligibility.

Run the checks documented in this repository's `AGENTS.md` and testing documentation. Report passed, failed, blocked and unrun checks separately. A valid scaffold or phrase inventory is not evidence of agent execution, native behavior, appearance or production acceptance.

Scale evidence to the task and stage: exploration can record alternatives and proof gaps; delivery requires the applicable platform checks and observable outcomes. WordPress, static sites, macOS apps and games share engineering principles, not interchangeable runtime proof. Keep lessons scoped to the platform, task and tested conditions; do not promote a local workaround into a universal rule.
