import path from 'node:path';
import { EXIT_CODES, VERSION } from './constants.js';
import { failureResult, HarnessError } from './errors.js';
import { initProject } from './init.js';
import { validateProject, validateRunFile } from './validate.js';

const HELP = `agent-harness ${VERSION}

Usage:
  agent-harness validate --config <path> [--json]
  agent-harness validate-run --file <path> [--json]
  agent-harness init --type <skills|loop|docs> --dir <path> [--json]

Exit codes:
  0 success
  1 validation failed
  2 invalid input or usage
  3 unsafe path
  4 init conflict
  70 internal error`;

function usageFailure(message) {
  return failureResult('usage', new HarnessError(message, { code: 'USAGE_ERROR' }));
}

function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith('--') || !allowed.has(name)) {
      throw new HarnessError(`Unknown option: ${name}`, { code: 'USAGE_ERROR' });
    }
    if (options[name] !== undefined) {
      throw new HarnessError(`Option may only be provided once: ${name}`, { code: 'USAGE_ERROR' });
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new HarnessError(`Option requires a value: ${name}`, { code: 'USAGE_ERROR' });
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function requireOptions(options, names) {
  for (const name of names) {
    if (options[name] === undefined) {
      throw new HarnessError(`Missing required option: ${name}`, { code: 'USAGE_ERROR' });
    }
  }
}

export async function executeCli(argv, { cwd = process.cwd() } = {}) {
  const json = argv.includes('--json');
  const args = argv.filter((argument) => argument !== '--json');
  const command = args[0];

  if (command === '--help' || command === '-h') {
    return { ok: true, command: 'help', exitCode: EXIT_CODES.OK, diagnostics: [], text: HELP, json };
  }
  if (command === '--version' || command === '-v') {
    return { ok: true, command: 'version', exitCode: EXIT_CODES.OK, diagnostics: [], text: VERSION, json };
  }
  if (!command) return { ...usageFailure('A command is required.'), text: HELP, json };

  try {
    if (command === 'validate') {
      const options = parseOptions(args.slice(1), new Set(['--config']));
      requireOptions(options, ['--config']);
      return { ...(await validateProject(path.resolve(cwd, options['--config']))), json };
    }

    if (command === 'validate-run') {
      const options = parseOptions(args.slice(1), new Set(['--file']));
      requireOptions(options, ['--file']);
      return { ...(await validateRunFile(options['--file'], { cwd })), json };
    }

    if (command === 'init') {
      const options = parseOptions(args.slice(1), new Set(['--type', '--dir']));
      requireOptions(options, ['--type', '--dir']);
      return { ...(await initProject(options['--type'], options['--dir'], { cwd })), json };
    }

    return { ...usageFailure(`Unknown command: ${command}`), text: HELP, json };
  } catch (error) {
    return { ...failureResult(command, error), json };
  }
}

export function formatCliResult(result) {
  if (result.json) {
    const { json, text, ...output } = result;
    if (text) output.output = text;
    return `${JSON.stringify(output)}\n`;
  }

  if (result.text) return `${result.text}\n`;
  if (result.ok) {
    if (result.command === 'validate') {
      const { filesChecked, scenariosChecked } = result.summary;
      return `OK: ${filesChecked} files and ${scenariosChecked} scenarios validated.\n`;
    }
    if (result.command === 'validate-run') {
      return `OK: run ${result.summary.runId} is valid.\n`;
    }
    if (result.command === 'init') {
      return `OK: created ${result.summary.filesCreated.length} files in ${result.summary.directory}.\n`;
    }
    return 'OK\n';
  }

  return `${result.diagnostics.map((item) => {
    const location = item.path ? ` [${item.path}]` : '';
    return `ERROR ${item.code}${location}: ${item.message}`;
  }).join('\n')}\n`;
}

export { HELP };
