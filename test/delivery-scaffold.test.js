import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeCli, EXIT_CODES, validateProject } from '../src/index.js';

const sharedFiles = [
  '.github/ISSUE_TEMPLATE/work-item.md',
  '.github/pull_request_template.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'README.md',
  'agent-harness.config.json',
  'evals/scenarios.md',
];
const typeFiles = {
  skills: 'skills/example/SKILL.md',
  loop: 'LOOP.md',
  docs: 'docs/overview.md',
};

async function snapshot(root, prefix = '') {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push([relative, 'directory']);
      result.push(...await snapshot(root, relative));
    } else {
      assert.equal(entry.isFile(), true, `Unexpected non-regular fixture entry: ${relative}`);
      result.push([relative, 'file', (await readFile(path.join(root, relative))).toString('base64')]);
    }
  }
  return result;
}

async function withDirectory(t, work) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-harness-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await work(root);
}

test('CLI init writes only the planned scaffold without repository or CI setup', async (t) => {
  for (const [type, typeFile] of Object.entries(typeFiles)) {
    await t.test(type, async (t) => withDirectory(t, async (root) => {
      await writeFile(path.join(root, 'owner-file.txt'), 'Unrelated owner content.\n');
      const result = await executeCli(['init', '--type', type, '--dir', 'project'], { cwd: root });
      assert.equal(result.ok, true, JSON.stringify(result));
      const project = path.join(root, 'project');
      const actual = (await snapshot(project)).filter((entry) => entry[1] === 'file').map(([file]) => file).sort();
      const expected = [...sharedFiles, typeFile].sort();
      assert.deepEqual(actual, expected);
      assert.deepEqual([...result.summary.filesCreated].sort(), expected);
      assert.deepEqual((await readdir(root)).sort(), ['owner-file.txt', 'project']);
      assert.equal(await readFile(path.join(root, 'owner-file.txt'), 'utf8'), 'Unrelated owner content.\n');
      assert.equal((await validateProject(path.join(project, 'agent-harness.config.json'))).ok, true);

      // These checks inspect distributed guidance, not simulated agent behavior or push authorization.
      const contributing = await readFile(path.join(project, 'CONTRIBUTING.md'), 'utf8');
      assert.match(contributing, /including non-Conventional Commit formats/u);
      assert.match(contributing, /A commit does not authorize a push, PR, merge, release or deployment/u);
      assert.match(contributing, /owner-managed `agent-\*` repositories/u);
      assert.match(contributing, /applicable standing owner policy may authorize scoped, validated direct pushes to `main`/u);
      assert.match(contributing, /never infer it from the repository name or this template/u);
      assert.match(contributing, /inspect the actual target, branch protections, workflows, integrations and downstream effects/u);
      assert.match(contributing, /unrelated client\/project pushes/u);
      assert.match(contributing, /Client work remains push-on-request because a push may deploy/u);
      assert.match(contributing, /standing no-effects exception permits an owner-authorized open-source plugin task/u);
      assert.match(contributing, /exact destination triggers no CI, pipeline, deployment, publication or release/u);
      assert.match(contributing, /Unknown effects require a hold/u);
      assert.match(contributing, /public visibility or disabled-looking workflows are insufficient/u);
      assert.match(contributing, /Never disable automation or add skip directives/u);
      assert.match(contributing, /applicable standing owner policy may authorize scoped, validated direct pushes to `main`/u);
      assert.match(contributing, /not evidence of agent execution, native behavior, appearance or production acceptance/u);
      assert.match(contributing, /change-delivery-discipline\.md/u);
    }));
  }
});

test('CLI init preserves owner-specific delivery policies and formats without partial writes', async (t) => {
  const existingFiles = [
    'AGENTS.md',
    'CONTRIBUTING.md',
    '.github/pull_request_template.md',
    '.github/ISSUE_TEMPLATE/work-item.md',
  ];
  for (const type of Object.keys(typeFiles)) {
    for (const existing of existingFiles) {
      await t.test(`${type}: ${existing}`, async (t) => withDirectory(t, async (root) => {
        const project = path.join(root, 'project');
        await mkdir(path.dirname(path.join(project, existing)), { recursive: true });
        await writeFile(path.join(project, existing), 'Owner format: [CLIENT-42] Plain title\r\nNever push without written approval.\r\n');
        await mkdir(path.join(project, 'owner-data'));
        await writeFile(path.join(project, 'owner-data/keep.bin'), Buffer.from([0, 13, 255, 10]));
        const before = await snapshot(root);
        const result = await executeCli(['init', '--type', type, '--dir', 'project'], { cwd: root });
        assert.equal(result.ok, false);
        assert.equal(result.exitCode, EXIT_CODES.INIT_CONFLICT);
        assert.deepEqual(await snapshot(root), before, 'A conflict must leave the entire tree byte-for-byte unchanged.');
      }));
    }
  }
});
