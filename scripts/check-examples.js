import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateProject, validateRunFile } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configs = ['skills', 'loop', 'docs'].map((type) => path.join(root, 'examples', type, 'agent-harness.config.json'));

for (const schema of ['config.schema.json', 'run-record.schema.json']) {
  JSON.parse(await readFile(path.join(root, 'schemas', schema), 'utf8'));
}

for (const config of configs) {
  const result = await validateProject(config);
  if (!result.ok) throw new Error(`Example failed: ${config}\n${JSON.stringify(result.diagnostics)}`);
}

const runDirectory = path.join(root, 'examples', 'run-record');
const run = await validateRunFile('run.json', { cwd: runDirectory });
if (!run.ok) throw new Error(`Run example failed:\n${JSON.stringify(run.diagnostics)}`);

process.stdout.write('Examples validated.\n');
