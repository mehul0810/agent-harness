# Repository Guidance

## Scope

- Keep this package dependency-free at runtime and pinned to the active Node.js 24 line.
- Keep configuration and run-record contracts deterministic, closed, portable, and versioned.
- Preserve documented exit codes and structured diagnostics.

## Safety

- Add no shell execution, network access, dynamic code loading, or mutation outside explicit `init` operations.
- Resolve configured paths inside the project root and verify symlink targets.
- `init` preflights every destination and never overwrites an existing file.
- Run records contain sanitized outcomes and numeric metrics, never prompts, completions, model identifiers, secrets, or product payloads.

## Workflow

- Start with `git status --short --branch`, `origin/main`, and open review exceptions.
- Add focused `node:test` coverage for behavior and boundary changes; keep JSON schemas aligned with internal validators.
- Run `npm test`, `npm run check`, and `git diff --check` locally.
- Keep validated changes in small local commits; push only when explicitly requested. Branch choice is separate; preserve upstream review and protection requirements.
- Do not publish packages/releases without owner approval; see [contribution guidance](CONTRIBUTING.md).
