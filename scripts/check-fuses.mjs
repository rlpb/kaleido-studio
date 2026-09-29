/**
 * Reads the Electron fuses out of the packaged executable and fails unless the
 * ones this project promises are set.
 *
 * Fuses are switches compiled into the Electron binary. They are flipped by
 * electron-builder from `electronFuses` in electron-builder.yml, but it is the
 * binary that people run, so it is the binary that is read here, never the
 * configuration: a key that electron-builder ignored, or a layout change that
 * skipped the step, leaves the config looking right and the app unprotected.
 *
 * The list below is the policy, deliberately not derived from the config. The
 * README states these guarantees, and this is where they are held to.
 *
 *   node scripts/check-fuses.mjs                    the build in ./release
 *   node scripts/check-fuses.mjs --exe <path>       a specific executable
 */
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packagedExecutable } from './lib/packaged.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENABLED = 0x31;
const DISABLED = 0x30;

/** Each promise, the fuse that keeps it, and the state it must be in. */
const POLICY = [
  [
    FuseV1Options.RunAsNode,
    DISABLED,
    'ELECTRON_RUN_AS_NODE is ignored, so the signed executable cannot be used as a general Node runtime',
  ],
  [
    FuseV1Options.EnableNodeOptionsEnvironmentVariable,
    DISABLED,
    'NODE_OPTIONS and NODE_EXTRA_CA_CERTS in the environment are ignored',
  ],
  [
    FuseV1Options.EnableNodeCliInspectArguments,
    DISABLED,
    '--inspect and its relatives are ignored, so the main process cannot be attached to from outside',
  ],
  [
    FuseV1Options.OnlyLoadAppFromAsar,
    ENABLED,
    'the application code is loaded from app.asar and from nowhere else',
  ],
  [
    FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
    ENABLED,
    'app.asar is checked against the digest embedded at build time before it is loaded',
  ],
];

const at = process.argv.indexOf('--exe');
const executable = at === -1 ? packagedExecutable(root, 'release') : path.resolve(process.argv[at + 1] ?? '');
if (!existsSync(executable)) {
  console.error(`not found: ${executable}`);
  process.exit(2);
}

const wire = await getCurrentFuseWire(executable);
console.log(`\nFuses in ${executable}`);

let failures = 0;
for (const [fuse, wanted, promise] of POLICY) {
  const name = FuseV1Options[fuse];
  const actual = wire[fuse];
  const state = actual === ENABLED ? 'on' : actual === DISABLED ? 'off' : `unknown (${actual})`;
  if (actual === wanted) {
    console.log(`  ok   ${name} is ${state}: ${promise}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name} is ${state}, expected ${wanted === ENABLED ? 'on' : 'off'}: ${promise}`);
  }
}

console.log(failures ? `\n${failures} fuse(s) not set` : '\nAll fuses set');
process.exit(failures ? 1 : 0);
