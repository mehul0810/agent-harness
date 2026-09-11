import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateProject, validateRunFile } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configs = ['skills', 'loop', 'docs'].map((type) => path.join(root, 'examples', type, 'agent-harness.config.json'));
const compatibility = JSON.parse(await readFile(path.join(root, 'contracts', 'compatibility.json'), 'utf8'));
const packageManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

if (compatibility.nodeMajor !== 24 || packageManifest.engines?.node !== '>=24 <25') {
  throw new Error('Compatibility and package Node requirements must remain on the active Node 24 line.');
}
if (compatibility.configSchemaVersion !== 1 || compatibility.runRecordSchemaVersion !== 1) {
  throw new Error('Compatibility schema versions do not match the current contracts.');
}
if (compatibility.runtimeDependencies !== 0 || Object.keys(packageManifest.dependencies ?? {}).length !== 0) {
  throw new Error('The harness must remain dependency-free at runtime.');
}
if (compatibility.publicationPolicy !== 'direct_main_after_validation') {
  throw new Error('Compatibility must preserve direct-main publication after validation.');
}

for (const schema of ['config.schema.json', 'run-record.schema.json', 'continuity.schema.json']) {
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
