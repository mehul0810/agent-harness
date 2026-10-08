# Testing

Use Node.js 24 from `.nvmrc` and test-only Ajv 8.20.0.

```bash
npm ci
npm test
npm run check
git diff --check
```

`npm run check` validates unit tests, checked-in examples, the compatibility manifest, and this repository's own harness configuration. Hosted CI is not required; local validation is the normal gate.
