import path from 'node:path';
import { lstat, mkdir, unlink, writeFile } from 'node:fs/promises';
import { EXIT_CODES } from './constants.js';
import { diagnostic, failureResult, HarnessError } from './errors.js';
import { resolveCliPath } from './path-safety.js';

const TYPES = new Set(['skills', 'loop', 'docs']);

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function template(type) {
  const shared = {
    'evals/scenarios.md': '# Happy path\n\nExpected: pass\n',
  };

  if (type === 'skills') {
    return {
      ...shared,
      'README.md': '# Agent project\n',
      'skills/example/SKILL.md': '# Example Skill\n\n## Purpose\n\nHandle one bounded task.\n',
      'agent-harness.config.json': json({
        schemaVersion: 1,
        projectRoot: '.',
        requiredFiles: ['README.md', 'skills/example/SKILL.md'],
        requiredPhrases: [{ file: 'skills/example/SKILL.md', phrases: ['## Purpose'] }],
        skillBudgets: { defaultMaxWords: 200, files: ['skills/example/SKILL.md'], overrides: {} },
        routeBudgets: [{ name: 'default', maxWords: 250, files: ['skills/example/SKILL.md'] }],
        scenarios: [{ name: 'happy-path', file: 'evals/scenarios.md', requiredPhrases: ['Expected: pass'] }],
        behaviorBaselines: [],
      }),
    };
  }

  if (type === 'loop') {
    return {
      ...shared,
      'README.md': '# Agent project\n',
      'LOOP.md': '# Loop Contract\n\n## Stop condition\n\nStop after the acceptance checks pass.\n',
      'agent-harness.config.json': json({
        schemaVersion: 1,
        projectRoot: '.',
        requiredFiles: ['README.md', 'LOOP.md'],
        requiredPhrases: [{ file: 'LOOP.md', phrases: ['## Stop condition'] }],
        routeBudgets: [{ name: 'loop', maxWords: 250, files: ['LOOP.md'] }],
        scenarios: [{ name: 'happy-path', file: 'evals/scenarios.md', requiredPhrases: ['Expected: pass'] }],
        behaviorBaselines: [],
      }),
    };
  }

  return {
    ...shared,
    'README.md': '# Agent project\n',
    'docs/overview.md': '# Overview\n\n## Scope\n\nDocument the supported workflow.\n',
    'agent-harness.config.json': json({
      schemaVersion: 1,
      projectRoot: '.',
      requiredFiles: ['README.md', 'docs/overview.md'],
      requiredPhrases: [{ file: 'docs/overview.md', phrases: ['## Scope'] }],
      routeBudgets: [{ name: 'docs', maxWords: 250, files: ['README.md', 'docs/overview.md'] }],
      scenarios: [{ name: 'happy-path', file: 'evals/scenarios.md', requiredPhrases: ['Expected: pass'] }],
      behaviorBaselines: [],
    }),
  };
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function initProject(type, directory, { cwd = process.cwd() } = {}) {
  const command = 'init';
  try {
    if (!TYPES.has(type)) {
      throw new HarnessError('Init type must be skills, loop, or docs.', { code: 'USAGE_ERROR' });
    }
    const target = await resolveCliPath(cwd, directory, { allowDot: true });
    const files = template(type);
    const conflicts = [];

    for (const relativePath of Object.keys(files)) {
      const destination = path.join(target, relativePath);
      if (await exists(destination)) conflicts.push(relativePath);
    }

    if (conflicts.length > 0) {
      return {
        ok: false,
        command,
        exitCode: EXIT_CODES.INIT_CONFLICT,
        diagnostics: conflicts.map((file) => diagnostic('INIT_CONFLICT', 'Refusing to overwrite existing file.', { path: file })),
      };
    }

    const created = [];
    try {
      for (const [relativePath, content] of Object.entries(files)) {
        const destination = path.join(target, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, { encoding: 'utf8', flag: 'wx' });
        created.push(destination);
      }
    } catch (error) {
      await Promise.all(created.map((file) => unlink(file).catch(() => {})));
      if (error?.code === 'EEXIST') {
        return {
          ok: false,
          command,
          exitCode: EXIT_CODES.INIT_CONFLICT,
          diagnostics: [diagnostic('INIT_CONFLICT', 'A destination file appeared during initialization; created files were rolled back.')],
        };
      }
      throw error;
    }

    return {
      ok: true,
      command,
      exitCode: EXIT_CODES.OK,
      diagnostics: [],
      summary: { type, directory: target, filesCreated: Object.keys(files) },
    };
  } catch (error) {
    return failureResult(command, error);
  }
}
