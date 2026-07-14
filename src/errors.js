import { EXIT_CODES } from './constants.js';

export class HarnessError extends Error {
  constructor(message, { code = 'INVALID_INPUT', exitCode = EXIT_CODES.INVALID_INPUT, path } = {}) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.exitCode = exitCode;
    this.path = path;
  }
}

export function diagnostic(code, message, details = {}) {
  return {
    code,
    message,
    severity: 'error',
    ...details,
  };
}

export function failureResult(command, error) {
  if (error instanceof HarnessError) {
    return {
      ok: false,
      command,
      exitCode: error.exitCode,
      diagnostics: [diagnostic(error.code, error.message, error.path ? { path: error.path } : {})],
    };
  }

  return {
    ok: false,
    command,
    exitCode: EXIT_CODES.INTERNAL_ERROR,
    diagnostics: [diagnostic('INTERNAL_ERROR', 'Unexpected internal error.')],
  };
}
