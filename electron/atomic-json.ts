import fs from 'node:fs';
import path from 'node:path';

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Renames over the destination, retrying briefly when Windows says no.
 *
 * An antivirus scanner or the search indexer can hold a freshly written file
 * for a few milliseconds, and rename then fails with EPERM although nothing is
 * wrong. ponytail: this blocks the calling thread for up to ~150ms in that
 * case, which a config write can afford; an async version buys nothing here.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 5 || !TRANSIENT.has(code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

/**
 * Writes JSON so that a reader finds the old file or the new one, never half of
 * one. A crash or a power cut in the middle of a plain writeFileSync leaves a
 * truncated file, and everything below treats a file it cannot parse as gone.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(temp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    // Without this the rename can reach the disk before the data does.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    renameWithRetry(temp, file);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

export interface ReadResult<T> {
  value: T;
  /** Where an unreadable file was moved, when it had to be. */
  quarantinedTo?: string;
}

/**
 * Reads JSON without ever turning a damaged file into an empty one.
 *
 * A missing file is a first run and yields the fallback. A file that exists but
 * does not parse, or parses into the wrong shape, is moved aside under a name
 * that says so, and the fallback is returned. Moving rather than ignoring is the
 * point: the caller's next save would otherwise overwrite the only copy of the
 * user's API key, presets or library index with defaults. A file that cannot be
 * read at all (locked, unreachable) throws, for the same reason: "unreadable" is
 * not "empty", and only the second may be replaced.
 */
export function readJsonOrQuarantine<T>(
  file: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): ReadResult<T> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { value: fallback };
    throw new Error(`Cannot read ${file}: ${(err as Error).message}`);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isValid(parsed)) return { value: parsed };
  } catch {
    // Falls through to the quarantine below, same as valid JSON of the wrong shape.
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${file}.corrupt-${stamp}`;
  // If this rename fails the error propagates, which is safer than proceeding.
  fs.renameSync(file, aside);
  return { value: fallback, quarantinedTo: aside };
}
