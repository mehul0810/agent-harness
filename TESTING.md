# Testing

Use Node.js 24 from `.nvmrc`.

```bash
npm install
npm test
npm run check
git diff --check
```

`npm run check` validates unit tests, checked-in examples, the compatibility manifest, and this repository's own harness configuration. Hosted CI is not required for routine changes; local validation is the normal gate.
