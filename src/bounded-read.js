import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { HarnessError } from './errors.js';

export const FILE_LIMITS = Object.freeze({
  configuration: 1024 * 1024,
  runRecord: 256 * 1024,
  projectFile: 32 * 1024 * 1024,
});

/** Read a previously-resolved path without blocking on special files or buffering unbounded input. */
export async function readRegularFile(filePath, limit, label = 'File') {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) throw new HarnessError(`${label} is not a regular file.`, { code: 'FILE_NOT_REGULAR', path: filePath });
    if (info.size > limit) throw new HarnessError(`${label} exceeds the ${limit}-byte limit.`, { code: 'FILE_TOO_LARGE', path: filePath });

    let buffer = Buffer.allocUnsafe(Math.min(limit + 1, Math.max(info.size, Math.min(limit + 1, 64 * 1024))));
    let used = 0;
    while (true) {
      if (used === buffer.length) {
        if (used > limit) throw new HarnessError(`${label} exceeds the ${limit}-byte limit.`, { code: 'FILE_TOO_LARGE', path: filePath });
        const capacity = Math.min(limit + 1, Math.max(buffer.length * 2, used + 1));
        const expanded = Buffer.allocUnsafe(capacity);
        buffer.copy(expanded, 0, 0, used);
        buffer = expanded;
      }
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
      if (used > limit) throw new HarnessError(`${label} exceeds the ${limit}-byte limit.`, { code: 'FILE_TOO_LARGE', path: filePath });
    }
    return buffer.subarray(0, used);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(`${label} could not be read.`, { code: 'FILE_UNREADABLE', path: filePath });
  } finally {
    await handle?.close();
  }
}
