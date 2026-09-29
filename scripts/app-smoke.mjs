/**
 * Starts the real application, from source or from a packaged build, in a
 * throwaway profile, and drives it through the DevTools protocol.
 *
 * Everything else in this repository tests a piece of the app in isolation. This
 * is the one check that the pieces work together in the thing that ships: the
 * window loads, the preload bridge is there, the IPC handlers answer, and the
 * handlers that act on the user's disk refuse what they were written to refuse.
 * Run against a packaged build it also catches the failure no other check can, a
 * release whose installers were built fine and whose app does not start.
 *
 *   node scripts/app-smoke.mjs                      the app from source
 *   node scripts/app-smoke.mjs --exe <path>         a packaged executable
 *   node scripts/app-smoke.mjs --packaged release   find it in electron-builder output
 *   ... -- --no-sandbox --disable-gpu               anything after -- goes to the app
 *
 * Needs Node 22 for the global WebSocket. The profile lives in a temporary
 * directory and the first check refuses to go on if the app reports any other
 * one, so a run can never touch the real configuration or library.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packagedExecutable } from './lib/packaged.mjs';

const root =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const own = dash === -1 ? argv : argv.slice(0, dash);
const passthrough = dash === -1 ? [] : argv.slice(dash + 1);
const option = (name) => {
  const at = own.indexOf(name);
  return at === -1 ? null : (own[at + 1] ?? null);
};

let executable;
let appDirArgs;
if (option('--exe')) {
  executable = path.resolve(option('--exe'));
  appDirArgs = [];
} else if (option('--packaged')) {
  executable = packagedExecutable(root, option('--packaged'));
  appDirArgs = [];
} else {
  // Resolved through the npm package, which exports the path of the binary.
  executable = createRequire(import.meta.url)('electron');
  appDirArgs = [root];
}
assert.ok(existsSync(executable), `not found: ${executable}`);
console.log(`\nApplication under test\n       ${executable}${appDirArgs.length ? ' (from source)' : ''}`);

// ---------------------------------------------------------------------------
// Process and DevTools plumbing
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return response.json();
}

async function waitForPage(port, child, output) {
  const started = Date.now();
  while (Date.now() - started < 90_000) {
    if (child.exitCode !== null) {
      throw new Error(`The application exited with code ${child.exitCode} before showing a window.\n${output().slice(-1500)}`);
    }
    try {
      const page = (await targets(port)).find((t) => t.type === 'page' && /index\.html/.test(t.url));
      if (page) return page;
    } catch {
      // The debugging port is not open yet.
    }
    await sleep(250);
  }
  throw new Error(`No application page appeared within 90s.\n${output().slice(-1500)}`);
}

function connect(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let counter = 0;
    const pending = new Map();
    const listeners = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve: done, reject: fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else done(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    });
    socket.addEventListener('error', () => reject(new Error('DevTools connection failed')));
    socket.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((done, fail) => {
            counter += 1;
            pending.set(counter, { resolve: done, reject: fail });
            socket.send(JSON.stringify({ id: counter, method, params }));
          }),
        onEvent: (listener) => listeners.push(listener),
        close: () => socket.close(),
      }),
    );
  });
}

/** One launch of the application, with the helpers a check needs. */
async function launch(profile) {
  const port = await freePort();
  const env = { ...process.env };
  // When this script runs under Electron's own Node, a child that inherited
  // this would start as a bare Node process instead of an application.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.KALEIDO_DEV;

  const child = spawn(
    executable,
    [...appDirArgs, `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, ...passthrough],
    { stdio: ['ignore', 'pipe', 'pipe'], env },
  );
  let captured = '';
  child.stdout.on('data', (chunk) => (captured += chunk));
  child.stderr.on('data', (chunk) => (captured += chunk));
  const output = () => captured;

  try {
    const page = await waitForPage(port, child, output);
    const cdp = await connect(page.webSocketDebuggerUrl);
    const problems = [];
    cdp.onEvent((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        problems.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`);
      } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        problems.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        problems.push(`log: ${message.params.entry.text} ${message.params.entry.url ?? ''}`);
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    const inPage = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        // Clipboard writes and similar calls need a user gesture to be allowed.
        userGesture: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    };
    /** Calls into the bridge and reports a rejection as data, so a check can assert on it. */
    const ipc = (expression) =>
      inPage(`(async () => { try { return { ok: true, value: await (${expression}) }; }
        catch (e) { return { ok: false, message: String((e && e.message) || e) }; } })()`);

    return {
      port,
      cdp,
      problems,
      output,
      inPage,
      ipc,
      pages: async () => (await targets(port)).filter((t) => t.type === 'page'),
      stop: () => {
        try {
          cdp.close();
        } catch {
          // Already closed.
        }
        killTree(child);
      },
    };
  } catch (err) {
    killTree(child);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

/** A one-pixel PNG, so the check does not depend on any asset. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const scratch = mkdtempSync(path.join(tmpdir(), 'kaleido-smoke-'));
const profile = path.join(scratch, 'profile');
const outside = path.join(scratch, 'outside');
mkdirSync(profile, { recursive: true });
mkdirSync(outside, { recursive: true });

const hardStop = setTimeout(() => {
  console.error('\nThe smoke test exceeded its time limit.');
  process.exit(3);
}, 240_000);

let app;
try {
  console.log('\nFirst run, empty profile');
  app = await launch(profile);

  // Before anything can write, be sure the profile is the throwaway one.
  const info = await app.ipc('kaleido.app.info()');
  assert.ok(info.ok, `the bridge did not answer: ${info.message}`);
  const reported = path.resolve(info.value.userData).toLowerCase();
  if (reported !== path.resolve(profile).toLowerCase()) {
    console.error(`REFUSING TO CONTINUE: the app reports ${info.value.userData}, not ${profile}`);
    app.stop();
    process.exit(2);
  }

  await check('the window shows the application page and it renders', async () => {
    assert.match(await app.inPage('location.href'), /\/dist\/index\.html/);
    assert.equal(await app.inPage('document.title'), 'Kaleido Studio');
    // A blank window is a failed start that still looks alive from the outside.
    const started = Date.now();
    let rendered = 0;
    while (Date.now() - started < 15_000 && !rendered) {
      rendered = await app.inPage("document.querySelector('#root')?.children.length ?? 0");
      if (!rendered) await sleep(250);
    }
    assert.ok(rendered > 0, 'the root element is still empty after 15s');
  });

  await check('the bridge is exposed and the IPC handlers answer', async () => {
    assert.equal(info.value.version, pkg.version, `the app says ${info.value.version}, package.json says ${pkg.version}`);
    assert.equal(await app.inPage('kaleido.platform'), process.platform);
    const settings = await app.ipc('kaleido.settings.get()');
    assert.ok(settings.ok && typeof settings.value === 'object', `settings:get failed: ${settings.message}`);
  });

  await check('a settings change reaches the disk whole and leaves nothing behind', async () => {
    const saved = await app.ipc("kaleido.settings.update({ theme: 'light', concurrency: 3 })");
    assert.ok(saved.ok, saved.message);
    assert.equal(saved.value.theme, 'light');
    assert.equal(saved.value.concurrency, 3);
    const config = JSON.parse(readFileSync(path.join(profile, 'config.json'), 'utf8'));
    assert.equal(config.theme, 'light');
    const leftovers = readdirSync(profile).filter((name) => name.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], `temporary files were left behind: ${leftovers}`);
  });

  await check('the settings call ignores what a setting cannot legitimately be', async () => {
    const before = (await app.ipc('kaleido.settings.get()')).value;
    const hostile = await app.ipc(
      `kaleido.settings.update({ theme: '<img src=x onerror=alert(1)>', lastMode: 'not-a-mode', concurrency: 9999,
        language: 'x'.repeat(200), favoriteModels: [1, 2], libraryPath: ${JSON.stringify(outside)} })`,
    );
    assert.ok(hostile.ok, hostile.message);
    const after = hostile.value;
    assert.equal(after.theme, before.theme, 'an unknown theme was stored');
    assert.equal(after.lastMode, before.lastMode, 'an unknown mode was stored');
    assert.equal(after.concurrency, 6, 'the concurrency was not clamped');
    assert.equal(after.language, before.language, 'an oversized language was stored');
    assert.deepEqual(after.favoriteModels, before.favoriteModels, 'a list of non-strings was stored');
    assert.equal(after.libraryPath, before.libraryPath, 'the library folder moved without the folder dialog');
  });

  const library = (await app.ipc('kaleido.settings.get()')).value.libraryPath;
  mkdirSync(library, { recursive: true });
  const insidePng = path.join(library, 'probe.png');
  const insideBat = path.join(library, 'probe.bat');
  writeFileSync(insidePng, PIXEL);
  writeFileSync(insideBat, '@echo off\r\n');
  const outsidePng = path.join(outside, 'secret.png');
  writeFileSync(outsidePng, PIXEL);

  await check('opening, revealing or copying a file outside the library is refused', async () => {
    const other = process.execPath; // a real file, outside the library, that would run if opened
    for (const call of ['open', 'reveal']) {
      const outcome = await app.ipc(`kaleido.library.${call}(${JSON.stringify(other)})`);
      assert.equal(outcome.ok, false, `library.${call} accepted a file outside the library`);
      assert.match(outcome.message, /outside the library/, `library.${call}: ${outcome.message}`);
    }
    // exportCopy opens a save dialog if it is wrongly allowed, and that would block
    // the app, so a hang is reported as the failure it is.
    const exported = await Promise.race([
      app.ipc(`kaleido.library.exportCopy(${JSON.stringify(other)})`),
      sleep(5000).then(() => ({ ok: 'hang' })),
    ]);
    assert.notEqual(exported.ok, 'hang', 'exportCopy opened a dialog for a file outside the library');
    assert.equal(exported.ok, false, 'exportCopy accepted a file outside the library');
    assert.match(exported.message, /outside the library/);
  });

  await check('a file inside the library passes containment, and an executable there is still not opened', async () => {
    // The control for the check above: this path is accepted by the containment
    // rule and stopped one step later by the extension rule, and the two
    // messages differ. A handler that refused everything would fail here.
    const outcome = await app.ipc(`kaleido.library.open(${JSON.stringify(insideBat)})`);
    assert.equal(outcome.ok, false);
    assert.match(outcome.message, /not opened from the application/, `got: ${outcome.message}`);
    assert.doesNotMatch(outcome.message, /outside the library/, 'a file inside the library was called outside it');
  });

  await check('a job cannot read a file the user did not choose', async () => {
    const request = (inputs) =>
      `kaleido.jobs.enqueue({ mode: 'image-edit', modelId: 'x/y', prompt: 'p', params: {}, inputs: ${JSON.stringify(inputs)}, batch: 1 }, 'smoke')`;
    const refused = await app.ipc(request([process.execPath]));
    assert.equal(refused.ok, false, 'a file outside the library and outside any dialog was accepted as an input');
    assert.match(refused.message, /not chosen through the application/);
    // The control: an input from the library is accepted (the job then fails on
    // the missing API key, which is the expected end of a run with no key).
    const accepted = await app.ipc(request([insidePng]));
    assert.ok(accepted.ok, `an input from the library was refused: ${accepted.message}`);
    await app.ipc('kaleido.jobs.clear()');
  });

  await check('the media protocol serves the library and refuses the rest of the disk', async () => {
    const loads = (file) =>
      app.inPage(`new Promise((resolve) => { const image = new Image();
        image.onload = () => resolve('loaded'); image.onerror = () => resolve('blocked');
        image.src = kaleido.mediaUrl(${JSON.stringify(file)}); setTimeout(() => resolve('timeout'), 6000); })`);
    assert.equal(await loads(insidePng), 'loaded', 'a library file did not load');
    assert.equal(await loads(outsidePng), 'blocked', 'a file outside the library was served');
  });

  await check('the window cannot be sent to another page', async () => {
    const elsewhere = path.join(outside, 'elsewhere.html');
    writeFileSync(elsewhere, '<title>ELSEWHERE</title>');
    const address = pathToFileURL(elsewhere).href;
    await app.inPage(`(location.assign(${JSON.stringify(address)}), 'started')`);
    await sleep(1500);
    assert.match(await app.inPage('location.href'), /\/dist\/index\.html/, 'the window navigated away from the application');
    assert.equal(await app.inPage(`window.open(${JSON.stringify(address)}) === null`), true, 'a new window was opened');
    assert.equal((await app.pages()).length, 1, 'a second page exists');
  });

  await check('the page is granted the clipboard and nothing else', async () => {
    assert.equal(
      await app.inPage("navigator.clipboard.writeText('smoke').then(() => 'written', (e) => 'refused: ' + e.name)"),
      'written',
      'copying text was refused, which breaks the copy buttons',
    );
    assert.equal(
      await app.inPage(
        "new Promise((resolve) => navigator.geolocation.getCurrentPosition(() => resolve('granted'), (e) => resolve('code ' + e.code)))",
      ),
      'code 1',
      'location was not denied',
    );
    assert.equal(await app.inPage('Notification.requestPermission()'), 'denied', 'notifications were not denied');
  });

  await check('the first run leaves the console clean', async () => {
    // The one thing the page is expected to report is the refusal provoked on
    // purpose above: Chromium logs the 403 for the file outside the library.
    const unexpected = app.problems.filter((line) => !(line.includes('403') && line.includes('secret.png')));
    assert.deepEqual(unexpected, [], `the page reported:\n${unexpected.join('\n')}`);
    assert.ok(app.problems.some((line) => line.includes('403')), 'the deliberate refusal never reached the console, so this check may not be listening');
  });

  app.stop();
  await sleep(1500);

  // -------------------------------------------------------------------------
  console.log('\nSecond run, damaged files in the profile');

  // What a power cut in the middle of a write leaves.
  const configFile = path.join(profile, 'config.json');
  const indexFile = path.join(library, 'index.json');
  const damagedConfig = '{ "theme": "light", "presets": [ {"id": "1"';
  const damagedIndex = '[ { "id": "a", "path": "x"';
  writeFileSync(configFile, damagedConfig);
  writeFileSync(indexFile, damagedIndex);

  app = await launch(profile);

  await check('the app starts on a damaged config and keeps the damaged copy', async () => {
    const settings = await app.ipc('kaleido.settings.get()');
    assert.ok(settings.ok, `settings:get failed on a damaged config: ${settings.message}`);
    const kept = readdirSync(profile).filter((name) => name.startsWith('config.json.corrupt-'));
    assert.equal(kept.length, 1, `expected one preserved copy, found ${kept.length}`);
    assert.equal(readFileSync(path.join(profile, kept[0]), 'utf8'), damagedConfig, 'the preserved copy differs from the original');
  });

  await check('a damaged library index is preserved, and the library still lists', async () => {
    const listed = await app.ipc('kaleido.library.list({})');
    assert.ok(listed.ok, `library:list failed on a damaged index: ${listed.message}`);
    assert.equal(listed.value.total, 0);
    const kept = readdirSync(library).filter((name) => name.startsWith('index.json.corrupt-'));
    assert.equal(kept.length, 1, `expected one preserved copy, found ${kept.length}`);
    assert.equal(readFileSync(path.join(library, kept[0]), 'utf8'), damagedIndex, 'the preserved copy differs from the original');
  });

  await check('the second run leaves the console clean', async () => {
    assert.deepEqual(app.problems, [], `the page reported:\n${app.problems.join('\n')}`);
  });
} catch (err) {
  failures += 1;
  console.error(`\n  FAIL ${err.message}`);
} finally {
  clearTimeout(hardStop);
  if (app) app.stop();
  await sleep(500);
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // A locked file on Windows; the folder is in the temp directory and harmless.
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
