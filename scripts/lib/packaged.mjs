import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Executables that sit next to the application in a Linux build and are not it. */
const HELPERS = new Set(['chrome-sandbox', 'chrome_crashpad_handler', 'chrome-sandbox.exe']);

/**
 * electron-builder names the Linux executable from the product or the package,
 * and which one depends on its version and configuration. A name guessed once
 * and never checked would send CI looking for a file that is not there, so the
 * expected names are tried first and the folder is searched as a fallback.
 */
function linuxExecutable(dir) {
  for (const name of ['kaleido-studio', 'Kaleido Studio']) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  if (!existsSync(dir)) return null;
  const executables = readdirSync(dir).filter((entry) => {
    const full = path.join(dir, entry);
    return !HELPERS.has(entry) && !entry.includes('.') && statSync(full).isFile() && (statSync(full).mode & 0o111) !== 0;
  });
  return executables.length === 1 ? path.join(dir, executables[0]) : null;
}

/**
 * The unpacked application electron-builder leaves behind for this machine.
 *
 * Shared by the smoke test and the fuse check, so both look at the same file
 * and a change to the output layout breaks them together rather than one of
 * them quietly checking something else.
 */
export function packagedExecutable(root, releaseDir, productName = 'Kaleido Studio') {
  const dir = path.resolve(root, releaseDir);
  const arm = process.arch === 'arm64';
  const candidates =
    process.platform === 'win32'
      ? [path.join(dir, arm ? 'win-arm64-unpacked' : 'win-unpacked', `${productName}.exe`)]
      : process.platform === 'darwin'
        ? [path.join(dir, arm ? 'mac-arm64' : 'mac', `${productName}.app`, 'Contents', 'MacOS', productName)]
        : [linuxExecutable(path.join(dir, arm ? 'linux-arm64-unpacked' : 'linux-unpacked'))].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    const listing = existsSync(dir) ? readdirSync(dir).join(', ') : `(${dir} does not exist)`;
    throw new Error(`No packaged executable found. Looked for:\n  ${candidates.join('\n  ')}\nThe folder holds: ${listing}`);
  }
  return found;
}
