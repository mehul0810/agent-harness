# Repository Guidance

## Scope

- Keep this package dependency-free at runtime and compatible with Node.js 20 or newer.
- Keep configuration and run-record contracts deterministic, closed, and versioned.
- Preserve the documented exit codes and structured diagnostic shape.

## Safety

- Never add shell execution, network access, dynamic code loading, or mutation outside explicit `init` operations.
- Resolve configured paths inside the configured project root and verify symlink targets.
- `init` must preflight all destinations and must never overwrite existing files.

## Changes

- Add focused `node:test` coverage for behavior changes and boundary conditions.
- Keep JSON schemas aligned with the internal validators.
- Run `npm test` and `npm run check` before handing off changes.
- Do not commit, push, create releases, or add remotes unless explicitly requested.
