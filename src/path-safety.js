import path from 'node:path';
import { lstat, realpath, stat } from 'node:fs/promises';
import { EXIT_CODES } from './constants.js';
import { HarnessError } from './errors.js';

function hasTraversal(value) {
  return value.replaceAll('\\', '/').split('/').includes('..');
}

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveThroughExistingAncestor(candidate) {
  let current = candidate;
  const suffix = [];

  while (true) {
    try {
      const resolvedAncestor = await realpath(current);
      return path.join(resolvedAncestor, ...suffix);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

export function assertPortableRelativePath(value, label, { allowDot = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new HarnessError(`${label} must be a non-empty relative path.`, {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: value,
    });
  }

  if (value.includes('\\')) {
    throw new HarnessError(`${label} must use forward slashes.`, {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: value,
    });
  }

  if (path.isAbsolute(value) || isWindowsAbsolute(value) || hasTraversal(value)) {
    throw new HarnessError(`${label} must stay within the project root.`, {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: value,
    });
  }

  const normalized = path.posix.normalize(value);
  if ((!allowDot && normalized === '.') || normalized.startsWith('../')) {
    throw new HarnessError(`${label} must identify a path within the project root.`, {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: value,
    });
  }

  return normalized;
}

export async function resolveProjectRoot(configDirectory, configuredRoot) {
  const relativeRoot = assertPortableRelativePath(configuredRoot, 'projectRoot', { allowDot: true });
  const lexicalRoot = path.resolve(configDirectory, relativeRoot);

  let root;
  try {
    root = await realpath(lexicalRoot);
    const rootStats = await stat(root);
    if (!rootStats.isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    throw new HarnessError('Configured project root is not an accessible directory.', {
      code: 'PROJECT_ROOT_INVALID',
      path: configuredRoot,
    });
  }

  return root;
}

export async function resolveProjectFile(projectRoot, configuredPath) {
  const relativePath = assertPortableRelativePath(configuredPath, 'Configured file path');
  const lexicalPath = path.resolve(projectRoot, relativePath);
  if (!isWithin(projectRoot, lexicalPath)) {
    throw new HarnessError('Configured file path escapes the project root.', {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: configuredPath,
    });
  }

  try {
    const linkStats = await lstat(lexicalPath);
    const resolvedPath = await realpath(lexicalPath);
    if (!isWithin(projectRoot, resolvedPath)) {
      throw new HarnessError('Configured file resolves outside the project root.', {
        code: 'UNSAFE_PATH',
        exitCode: EXIT_CODES.UNSAFE_PATH,
        path: configuredPath,
      });
    }

    const fileStats = linkStats.isSymbolicLink() ? await stat(resolvedPath) : linkStats;
    return { exists: true, isFile: fileStats.isFile(), path: resolvedPath, relativePath };
  } catch (error) {
    if (error instanceof HarnessError) {
      throw error;
    }
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      const resolvedMissingPath = await resolveThroughExistingAncestor(lexicalPath);
      if (!isWithin(projectRoot, resolvedMissingPath)) {
        throw new HarnessError('Configured file resolves outside the project root.', {
          code: 'UNSAFE_PATH',
          exitCode: EXIT_CODES.UNSAFE_PATH,
          path: configuredPath,
        });
      }
      return { exists: false, isFile: false, path: resolvedMissingPath, relativePath };
    }
    throw new HarnessError('Configured file could not be inspected.', {
      code: 'FILE_UNREADABLE',
      path: configuredPath,
    });
  }
}

export async function resolveCliPath(root, input, { allowDot = false, mustExist = false } = {}) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0') || hasTraversal(input)) {
    throw new HarnessError('Path must stay within the current working directory.', {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: input,
    });
  }

  const realRoot = await realpath(root);
  const candidate = path.resolve(realRoot, input);
  if (!isWithin(realRoot, candidate) || (!allowDot && candidate === realRoot)) {
    throw new HarnessError('Path must stay within the current working directory.', {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: input,
    });
  }

  if (!mustExist) {
    const resolvedCandidate = await resolveThroughExistingAncestor(candidate);
    if (!isWithin(realRoot, resolvedCandidate)) {
      throw new HarnessError('Path resolves outside the current working directory.', {
        code: 'UNSAFE_PATH',
        exitCode: EXIT_CODES.UNSAFE_PATH,
        path: input,
      });
    }
    return resolvedCandidate;
  }

  let resolved;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new HarnessError('File does not exist or is not accessible.', {
      code: 'FILE_MISSING',
      path: input,
    });
  }

  if (!isWithin(realRoot, resolved)) {
    throw new HarnessError('Path resolves outside the current working directory.', {
      code: 'UNSAFE_PATH',
      exitCode: EXIT_CODES.UNSAFE_PATH,
      path: input,
    });
  }

  return resolved;
}
