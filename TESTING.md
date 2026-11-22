# Testing

Use Node.js 24 from `.nvmrc` and test-only Ajv 8.20.0.

```bash
npm ci
npm run check
git diff --check
```

The full local gate includes unit tests, examples, compatibility and self-validation. Use `npm test` for unit-only iterations. Hosted CI is supplemental.
