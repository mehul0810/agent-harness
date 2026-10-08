import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package allowlist includes public README references and routing descriptor', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const included = (file) => manifest.files.some((entry) => file === entry || file.startsWith(`${entry}/`));
  const references = [...readme.matchAll(/\]\((?:\.\/)?((?:docs|schemas|examples)\/[^)#]+)\)/gu)].map((match) => match[1]);
  for (const file of references) assert.ok(included(file), `README reference is excluded from the package: ${file}`);
  assert.ok(included('contracts/routing-policy.json'));
  assert.ok(included('docs/continuity.md'));
});
