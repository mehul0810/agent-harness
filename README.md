# Agent Harness

`@mehul0810/agent-harness` is a dependency-free Node.js CLI and library for validating agent project files, deterministic word budgets, scenario inventories, and sanitized evaluation run records.

## Requirements

- Node.js 24 from `.nvmrc`
- JSON configuration

## CLI

Install it as a development dependency or run the local binary. Use `main` for evaluation only; committed consumers should replace it with an exact commit SHA. Published package releases can use the package name directly later.

```sh
npm install --save-dev github:mehul0810/agent-harness#main
npx agent-harness validate --config agent-harness.config.json
npx agent-harness validate-run --file evals/run.json
npx agent-harness init --type skills --dir packages/new-skills
```

Add `--json` to any command for a single JSON result on stdout or stderr. `--help` and `--version` are also available.

`init` supports `skills`, `loop`, and `docs`. It creates a small, immediately valid scaffold and refuses the entire operation when any destination file already exists.

## Configuration

```json
{
  "$schema": "./node_modules/@mehul0810/agent-harness/schemas/config.schema.json",
  "schemaVersion": 1,
  "projectRoot": ".",
  "requiredFiles": ["README.md", "skills/review/SKILL.md"],
  "requiredPhrases": [
    { "file": "README.md", "phrases": ["## Validation"] }
  ],
  "skillBudgets": {
    "defaultMaxWords": 2000,
    "files": ["skills/review/SKILL.md"],
    "overrides": { "skills/review/SKILL.md": 2500 }
  },
  "routeBudgets": [
    {
      "name": "review-route",
      "maxWords": 3500,
      "warningPercent": 85,
      "files": ["README.md", "skills/review/SKILL.md"]
    }
  ],
  "scenarios": [
    {
      "name": "review-success",
      "file": "evals/scenarios.md",
      "requiredPhrases": ["Expected: pass"]
    }
  ],
  "behaviorBaselines": []
}
```

All sections except `schemaVersion` and `projectRoot` are optional. Word counts are deterministic and whitespace-delimited. A file passes when its count is equal to its limit. Route counts are the sum of their listed files. An optional `warningPercent` from 1 to 100 emits a non-failing route warning at or above that utilization.

`scenarios` remain lightweight inventory checks. Use [behavior baselines](./docs/behavior-baselines.md) for a source-bound behavioral claim: they verify deterministic source and scenario digests, the exact sanitized run record, required passing checks, measured outcome, lineage, freshness, and optional telemetry ceilings.

Paths in configuration are portable forward-slash paths relative to the configured project root. Absolute paths, traversal, and symlinks that resolve outside that root are rejected. The CLI performs no shell execution or network access. Only `init` mutates files.

See complete [skills](./examples/skills/agent-harness.config.json), [loop](./examples/loop/agent-harness.config.json), and [docs](./examples/docs/agent-harness.config.json) examples.

## Run Records

Run records intentionally exclude prompts, model output, secrets, model identifiers, and product policy. The closed schema accepts identity, outcome, timing, checks, numeric metrics, optional tags, sanitized lineage pointers, and measurement status:

```sh
agent-harness validate-run --file examples/run-record/run.json
```

Use lineage to connect an observation, decision, action, verification, learning candidate, and durable artifact without copying their payloads. Use `measurement.status` plus named numeric metrics to record whether the expected outcome was met after its verification window. See [run-record.schema.json](./schemas/run-record.schema.json) and the [example run](./examples/run-record/run.json).
Successful run records require at least one check and every recorded check must pass. Pending measurements require a verification window; closed measurements require a timestamp and evidence summary.
Use the [portable metric names](./docs/run-record-metrics.md) when the host reports token or tool telemetry. Never estimate unavailable values.

## Library

```js
import {
  countWords,
  initProject,
  validateConfigObject,
  validateProject,
  validateRunFile,
  validateRunRecordObject,
} from '@mehul0810/agent-harness';
```

Every operation returns an object with `ok`, `exitCode`, and `diagnostics`. Project and run-file validation are asynchronous; object contract validation and word counting are synchronous.

## Exit Codes

| Code | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Validation failed |
| `2` | Invalid input, schema, or usage |
| `3` | Unsafe path |
| `4` | Init would overwrite a file |
| `70` | Unexpected internal error |

## Development

```sh
npm test
npm run check
```

`npm run check` runs the test suite, validates every checked-in example through the public API, checks the compatibility manifest, and validates this repository with its own CLI. Local validation is the normal gate; scoped validated repository changes publish directly to `main`, while a PR is an explicit review exception.
