/**
 * Draws the real interface against a stand-in backend, and either inspects it or
 * photographs it.
 *
 *   electron scripts/ui/harness.mjs smoke     every screen, in every language and both themes
 *   electron scripts/ui/harness.mjs shots     the README screenshots, into docs/
 *
 * The renderer is the built one in dist/, unchanged. Only the preload is swapped
 * for scripts/ui/stub-api.ts, which the compiler holds to the real bridge
 * interface. Nothing here needs an API key. The model catalog is the live public
 * one, so the screens are drawn with the models and prices that exist today.
 *
 * Screenshots are taken with capturePage, which reads the page's own pixels. A
 * capture of the screen takes whatever window is on top of the app, which is how
 * an earlier set came to show a real account balance.
 */
import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const task = process.argv.includes('shots') ? 'shots' : 'smoke';

// Must be registered before the app is ready, with the same privileges as the
// real one, or images served through it would not load in the harness.
protocol.registerSchemesAsPrivileged([
  { scheme: 'kal', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALL_LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt', 'ru'];
// `--langs=en,it` limits a run to those languages, for quick iteration.
const only = process.argv.find((arg) => arg.startsWith('--langs='))?.slice('--langs='.length).split(',');
const LANGS = only ? ALL_LANGS.filter((lang) => only.includes(lang)) : ALL_LANGS;
const TRACE = process.argv.includes('--trace');
// `--dump=600` reports the first 600 characters of the text each check compared,
// so a check that finds nothing can be told apart from one that saw nothing.
const DUMP = Number(process.argv.find((arg) => arg.startsWith('--dump='))?.slice('--dump='.length) ?? 0);
const trace = (label, since) => TRACE && console.log(`    ${String(Date.now() - since).padStart(5)}ms  ${label}`);
const THEMES = ['light', 'dark'];
// The order of the eight modes in the sidebar, then Library and Settings.
const MODES = ['image', 'image-edit', 'video', 'video-from-image', 'video-upscale', 'speech', 'audio', 'transcribe'];
const NAV_LIBRARY = MODES.length;
const NAV_SETTINGS = MODES.length + 1;

// ---------------------------------------------------------------------------
// Generated assets: a real PNG, so nothing depends on a file in the repository
// ---------------------------------------------------------------------------

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A width x height PNG filled by `colour(x, y) -> [r, g, b]`. */
function makePng(width, height, colour) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) row.set(colour(x, y), 1 + x * 3);
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The scenario state the stub answers from
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(path.join(tmpdir(), 'kaleido-ui-'));
// Electron keeps a profile of its own even for a script, and Chromium stores the
// zoom level of a page in it. A run that zoomed once (as an earlier attempt at
// sharper screenshots did) then rendered every later run zoomed too, and the
// screenshots came out enlarged and cropped. A throwaway profile per run cannot
// carry anything over.
app.setPath('userData', path.join(scratch, 'profile'));
const libraryDir = path.join(scratch, 'library');
mkdirSync(libraryDir, { recursive: true });
const pngA = path.join(libraryDir, 'a.png');
const pngB = path.join(libraryDir, 'b.png');
const textA = path.join(libraryDir, 'c.txt');
writeFileSync(pngA, makePng(320, 240, (x, y) => [40 + (x % 200), 90 + (y % 120), 200 - (x % 100)]));
writeFileSync(pngB, makePng(240, 320, (x, y) => [220 - (y % 150), 70 + (x % 150), 120 + (y % 90)]));
writeFileSync(textA, 'Transcript of an example recording.');

const state = { settings: null, keyState: null, jobs: [], library: [], prompts: [], presets: [], catalog: null };

function baseSettings(overrides = {}) {
  return {
    hasKey: true,
    theme: 'light',
    language: 'en',
    libraryPath: libraryDir,
    favoriteModels: [],
    lastMode: 'image',
    lastModelByMode: {},
    observedCosts: {},
    spendTotal: 0,
    concurrency: 2,
    ...overrides,
  };
}

/** Enough jobs to draw every card the studio can show. */
function jobsFor(mode) {
  const now = Date.now();
  const base = { mode, modelId: 'vendor/model', modelName: 'Vendor: Example model', prompt: 'An example prompt', params: {}, inputs: [] };
  return [
    { ...base, id: 'running', status: 'running', progressKey: 'progress.workingFor', progressVars: { seconds: 12 }, createdAt: now - 12000, startedAt: now - 12000, outputs: [] },
    { ...base, id: 'failed', status: 'error', progressKey: 'progress.failed', error: 'The connection was cut after about a minute.', createdAt: now - 9000, finishedAt: now - 8000, outputs: [] },
    {
      ...base,
      id: 'done',
      status: 'done',
      progressKey: 'progress.done',
      createdAt: now - 6000,
      startedAt: now - 5000,
      finishedAt: now - 1600,
      cost: 0.0421,
      outputs: [{ path: pngA, kind: 'image', mediaType: 'image/png' }],
    },
  ];
}

function libraryItems() {
  const item = (id, kind, file, extra = {}) => ({
    id,
    jobId: id,
    mode: kind === 'text' ? 'transcribe' : 'image',
    modelId: 'vendor/model',
    modelName: 'Vendor: Example model',
    prompt: kind === 'text' ? '' : 'An example prompt',
    params: {},
    kind,
    path: file,
    mediaType: kind === 'text' ? 'text/plain' : 'image/png',
    cost: 0.0312,
    durationMs: 4200,
    createdAt: Date.now() - 3600_000,
    favorite: false,
    tags: [],
    ...extra,
  });
  return [
    item('lib-1', 'image', pngA, { favorite: true }),
    item('lib-2', 'image', pngB),
    item('lib-3', 'text', textA, { text: 'Transcript of an example recording.' }),
  ];
}

const handlers = {
  'key.status': () => state.keyState,
  'key.set': () => ({ ...state.keyState }),
  'key.clear': () => true,
  'catalog.get': () => state.catalog,
  'settings.get': () => state.settings,
  'settings.update': (changes) => Object.assign(state.settings, changes),
  'settings.toggleFavorite': (id) => {
    const set = new Set(state.settings.favoriteModels);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    state.settings.favoriteModels = [...set];
    return state.settings.favoriteModels;
  },
  'settings.resetSpend': () => state.settings,
  'settings.pickLibrary': () => state.settings,
  'jobs.enqueue': () => [],
  'jobs.list': () => state.jobs,
  'jobs.cancel': () => true,
  'jobs.retry': () => null,
  'jobs.clear': () => [],
  'library.list': () => ({ items: state.library, total: state.library.length }),
  'library.update': () => null,
  'library.remove': () => true,
  'library.stats': () => ({ count: state.library.length, byKind: { image: 2, text: 1 }, totalCost: 0.0936, bytes: 51200 }),
  'library.prune': () => 0,
  'library.reveal': () => true,
  'library.open': () => '',
  'library.exportCopy': () => null,
  'presets.list': () => state.presets,
  'presets.save': () => state.presets,
  'presets.remove': () => state.presets,
  'prompts.list': () => state.prompts,
  'prompts.clear': () => [],
  'files.pick': () => [],
  'window.setTheme': () => true,
  'app.info': () => ({ version: pkg.version, platform: 'win32', electron: process.versions.electron, userData: '(harness)' }),
  'app.openExternal': () => true,
};

// ---------------------------------------------------------------------------
// Loading the repository's own code
// ---------------------------------------------------------------------------

async function bundle(entry, name, extra = {}) {
  const outfile = path.join(scratch, name);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    external: ['electron'],
    ...extra,
  });
  return outfile;
}

const load = async (entry, name) => import(pathToFileURL(await bundle(entry, `${name}.mjs`, { format: 'esm' })).href);

// ---------------------------------------------------------------------------
// The inspection that runs inside the page
// ---------------------------------------------------------------------------

/** Executed in the renderer. Everything it needs arrives as the argument. */
function inspectPage({ keys, leaks, dump }) {
  const problems = [];
  // The interface's own words. Model names, ids and descriptions come from the
  // catalog in English by design, and a description saying "reference images"
  // is not an untranslated label, so what the catalog supplies is taken out
  // before anything is compared.
  //
  // Hidden for the length of one read and put back, rather than removed from a
  // copy: textContent runs adjacent elements together ("sconosciutoundefined"),
  // which hides every word boundary, and only innerText keeps them apart.
  const catalogNodes = [...document.querySelectorAll('.model-row, .model-button, .viewer-title, .media-meta .ellipsis, .job strong')];
  const previous = catalogNodes.map((node) => node.style.display);
  catalogNodes.forEach((node) => (node.style.display = 'none'));
  const text = document.body.innerText;
  catalogNodes.forEach((node, index) => (node.style.display = previous[index]));

  const attributes = [];
  for (const element of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const name of ['placeholder', 'title', 'aria-label', 'alt']) {
      const value = element.getAttribute(name);
      if (value) attributes.push(value);
    }
  }
  // Compared without regard to case: many labels are set in capitals by the
  // stylesheet, and innerText returns them the way they are drawn.
  const visible = `${text}\n${attributes.join('\n')}`.toLowerCase();

  // The shell clips its content instead of scrolling it, so the document never
  // grows wider than the window and measuring it says nothing. What matters is
  // whether a piece of the interface sticks out of the window, or is cut off
  // inside its own box.
  const describe = (element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/).join('.') : ''}`;
  const seenOutside = new Set();
  const seenClipped = new Set();
  for (const element of document.querySelectorAll('body *')) {
    if (['SELECT', 'OPTION', 'INPUT', 'TEXTAREA', 'svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline'].includes(element.tagName)) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;

    if ((box.right > window.innerWidth + 1 || box.left < -1) && !seenOutside.has(describe(element))) {
      seenOutside.add(describe(element));
      problems.push(`${describe(element)} sticks out of the window`);
    }
    const hidesOverflow = style.overflowX === 'hidden' || style.overflowX === 'clip';
    const words = (element.innerText || '').trim();
    if (words && element.scrollWidth > element.clientWidth + 1 && !seenClipped.has(describe(element))) {
      if (hidesOverflow && style.textOverflow !== 'ellipsis') {
        seenClipped.add(describe(element));
        problems.push(`text is cut off in ${describe(element)}: "${words.slice(0, 40)}"`);
      } else if (style.whiteSpace === 'nowrap' && style.overflowX === 'visible') {
        seenClipped.add(describe(element));
        problems.push(`text spills out of ${describe(element)}: "${words.slice(0, 40)}"`);
      }
    }
  }
  for (const key of keys) {
    if (visible.includes(key.toLowerCase())) problems.push(`an untranslated key is showing: ${key}`);
  }
  for (const phrase of leaks) {
    if (visible.includes(phrase.toLowerCase())) problems.push(`English is showing in another language: "${phrase}"`);
  }
  const junk = visible.match(/\bundefined\b|\bnan\b|\[object object\]|\bnull\b/);
  if (junk) problems.push(`"${junk[0]}" is showing in the interface`);
  if (dump) problems.push(`the text the check sees: ${visible.replace(/\s+/g, ' ').slice(0, dump)}`);

  for (const button of document.querySelectorAll('button')) {
    const name = (button.innerText || button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();
    if (!name) problems.push(`a button has no accessible name: ${button.outerHTML.slice(0, 90)}`);
  }
  for (const overlay of document.querySelectorAll('.modal, .viewer')) {
    if (overlay.getAttribute('role') !== 'dialog' || overlay.getAttribute('aria-modal') !== 'true') {
      problems.push(`an overlay is not declared as a dialog: ${overlay.className}`);
    }
    if (!overlay.getAttribute('aria-label')) problems.push(`a dialog has no name: ${overlay.className}`);
  }
  for (const image of document.querySelectorAll('img')) {
    if (image.getAttribute('alt') === null) problems.push(`an image has no alt attribute: ${image.outerHTML.slice(0, 90)}`);
  }
  for (const control of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    const labelled =
      control.getAttribute('aria-label') ||
      control.closest('label') ||
      (control.id && document.querySelector(`label[for="${control.id}"]`)) ||
      control.getAttribute('placeholder') ||
      control.getAttribute('title');
    if (!labelled) problems.push(`a form control has no label: ${control.outerHTML.slice(0, 90)}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Driving the window
// ---------------------------------------------------------------------------

let win;
const consoleProblems = [];

async function createWindow(platform, theme) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: theme === 'light' ? '#f5f6f9' : '#0b0d12',
    webPreferences: {
      preload: path.join(scratch, 'stub-preload.cjs'),
      additionalArguments: [`--stub-platform=${platform}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // The window is never shown. A hidden page has its animation frames
      // throttled to a crawl, and every settle() below waits for two of them.
      backgroundThrottling: false,
    },
  });
  win.webContents.on('console-message', (...args) => {
    // Electron passes an event object in current versions and positional
    // arguments in older ones.
    const first = args[0];
    const level = first?.level ?? args[1];
    const message = first?.message ?? args[2];
    if (level === 'error' || level === 3) consoleProblems.push(String(message));
  });
  win.webContents.on('render-process-gone', (_event, details) => consoleProblems.push(`the renderer process died: ${details.reason}`));
}

const page = (code) => win.webContents.executeJavaScript(code, true);

async function waitFor(code, what, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page(code)) return;
    await sleep(60);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function boot({ settings, keyState, jobs = [], library = [] }) {
  state.settings = baseSettings(settings);
  state.keyState = keyState;
  state.jobs = jobs;
  state.library = library;
  await win.loadFile(path.join(root, 'dist', 'index.html'));
  win.webContents.setZoomFactor(1);
  await waitFor("document.querySelector('#root')?.children.length > 0", 'the interface to render');
  await sleep(250);
}

async function settle() {
  // Timers, not animation frames: the window is never shown, so no frame is ever
  // composed and requestAnimationFrame takes about two seconds to fire. Layout
  // does not need a frame; reading a size in the page computes it on demand.
  await sleep(140);
  await page('new Promise((resolve) => setTimeout(resolve, 30))');
}

const VALID_KEY = { valid: true, configured: true, encrypted: true, credits: null, limitRemaining: null };
const NO_KEY = { valid: false, configured: false, encrypted: false };

// ---------------------------------------------------------------------------
// smoke
// ---------------------------------------------------------------------------

async function smoke(dictionaries) {
  const en = dictionaries.en;
  const keys = Object.keys(en);
  const found = new Map();
  let scenarios = 0;

  const record = (scenario, problems) => {
    scenarios += 1;
    for (const problem of problems) {
      const entry = found.get(problem) ?? { count: 0, first: scenario };
      entry.count += 1;
      found.set(problem, entry);
    }
    const errors = consoleProblems.splice(0);
    for (const message of errors) {
      const entry = found.get(`console error: ${message}`) ?? { count: 0, first: scenario };
      entry.count += 1;
      found.set(`console error: ${message}`, entry);
    }
  };

  for (const lang of LANGS) {
    // English strings that another language has translated, long enough to be
    // unmistakable: one of them showing up means something was left untranslated.
    const dictionary = dictionaries[lang];
    const leaks = lang === 'en' ? [] : keys.filter((k) => dictionary[k] !== en[k] && en[k].length >= 14 && !en[k].includes('{')).map((k) => en[k]);

    for (const theme of THEMES) {
      const args = { keys, leaks, dump: DUMP };
      const inspect = () => page(`(${inspectPage.toString()})(${JSON.stringify(args)})`);
      const tag = (screen) => `${lang}/${theme}/${screen}`;
      const clickNav = (index) => page(`document.querySelectorAll('.nav-item')[${index}].click()`);

      // The first-run screen.
      let t0 = Date.now();
      await boot({ settings: { language: lang, theme }, keyState: NO_KEY });
      trace(`${tag('onboarding')} boot`, t0);
      await settle();
      t0 = Date.now();
      record(tag('onboarding'), await inspect());
      trace(`${tag('onboarding')} inspect`, t0);

      // Every studio mode, with the parameters open so their labels are drawn.
      t0 = Date.now();
      await boot({ settings: { language: lang, theme }, keyState: VALID_KEY, jobs: jobsFor('image'), library: libraryItems() });
      await waitFor("document.querySelector('.nav-count')?.textContent", 'the catalog');
      trace(`${tag('studio')} boot and catalog`, t0);
      for (let index = 0; index < MODES.length; index += 1) {
        state.jobs = jobsFor(MODES[index]);
        t0 = Date.now();
        await clickNav(index);
        await settle();
        trace(`${tag(MODES[index])} click and settle`, t0);
        t0 = Date.now();
        await page("document.querySelector('details.params:not([open]) summary')?.click()");
        await settle();
        trace(`${tag(MODES[index])} open params`, t0);
        t0 = Date.now();
        record(tag(MODES[index]), await inspect());
        trace(`${tag(MODES[index])} inspect`, t0);
      }

      // The model picker, and the viewer over a finished result.
      await clickNav(0);
      await settle();
      await page("document.querySelector('.model-button')?.click()");
      await settle();
      const picker = await inspect();
      // A dialog that only the mouse can close traps everyone else.
      await page("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      await settle();
      if (await page("document.querySelector('.modal') !== null")) picker.push('the model picker did not close with Escape');
      record(tag('model-picker'), picker);

      await page("document.querySelector('.media-frame')?.click()");
      await settle();
      const viewer = await inspect();
      await page("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
      await settle();
      if (await page("document.querySelector('.viewer') !== null")) viewer.push('the viewer did not close with Escape');
      record(tag('viewer'), viewer);

      await clickNav(NAV_LIBRARY);
      await settle();
      record(tag('library'), await inspect());
      await clickNav(NAV_SETTINGS);
      await settle();
      record(tag('settings'), await inspect());
    }
    process.stdout.write(`  ${lang}: done\n`);
  }

  // The stylesheet has a branch per platform.
  for (const platform of ['darwin', 'linux']) {
    for (const theme of THEMES) {
      await win.close();
      await createWindow(platform, theme);
      await boot({ settings: { language: 'en', theme }, keyState: VALID_KEY, jobs: jobsFor('image') });
      await waitFor("document.querySelector('.nav-count')?.textContent", 'the catalog');
      await settle();
      const args = { keys, leaks: [] };
      record(`${platform}/${theme}/image`, await page(`(${inspectPage.toString()})(${JSON.stringify(args)})`));
    }
  }

  console.log(`\n${scenarios} screens drawn`);
  if (!found.size) {
    console.log('  ok   no problems');
    return 0;
  }
  for (const [problem, { count, first }] of found) {
    console.error(`  FAIL ${problem}\n       ${count} time(s), first at ${first}`);
  }
  console.error(`\n${found.size} distinct problem(s)`);
  return 1;
}

// ---------------------------------------------------------------------------
// shots
// ---------------------------------------------------------------------------

async function capture(file) {
  const target = path.join(root, 'docs', file);
  // A window that is never shown hands back the last frame it painted, which can
  // be the splash screen or the state before the last change. Asking for a frame
  // and throwing it away makes the one that is kept current.
  win.webContents.invalidate();
  await win.webContents.capturePage();
  await sleep(200);
  const image = await win.webContents.capturePage();
  writeFileSync(target, image.toPNG());
  const { width, height } = image.getSize();
  console.log(`  docs/${file}  ${width}x${height}  ${(readFileSync(target).length / 1024).toFixed(0)}KB`);
}

async function shots() {

  // 1440x900, the size the README shows them at with room to spare. Drawing them
  // at twice the pixels was tried and does not work here: device emulation
  // crashes a window that is never shown, and a bigger window cannot exceed the
  // display, which would lay the interface out narrower than it is.
  const prompt = 'A ceramic teapot on a wooden table, soft morning light, 35mm photograph';
  const typePrompt = () =>
    page(`(() => {
      const box = document.querySelector('#prompt');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      set.call(box, ${JSON.stringify(prompt)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.blur();
    })()`);

  // The first model in the catalog is the newest, which is often one nobody has
  // priced yet, and a README that opens on "price not published" shows the worst
  // case first. These are well-known models that publish a price; the first one
  // present in the catalog for the mode is used, and a run says which.
  const PREFERRED = [
    'openai/gpt-image-2.5-sunburst',
    'openai/gpt-image-2',
    'google/gemini-3-pro-image',
    'black-forest-labs/flux.2-pro',
    'bytedance-seed/seedream-5-0-pro',
  ];
  const showcase = (mode) => {
    const list = state.catalog.models[mode];
    const chosen = PREFERRED.map((id) => list.find((m) => m.id === id)).find(Boolean) ?? list.find((m) => !m.price.unpublished && !m.price.free) ?? list[0];
    console.log(`  ${mode}: ${chosen.id}`);
    return { [mode]: chosen.id };
  };

  for (const [mode, file] of [
    ['image', 'screenshot-studio.png'],
    ['image-edit', 'screenshot-edit.png'],
  ]) {
    await boot({
      settings: { language: 'en', theme: 'light', lastMode: mode, lastModelByMode: showcase(mode) },
      keyState: VALID_KEY,
    });
    await waitFor("document.querySelector('.nav-count')?.textContent", 'the catalog');
    await typePrompt();
    await settle();
    await capture(file);
  }

  // The picker, searched for a family, which is how it is actually used and shows
  // the live price beside each model.
  await boot({
    settings: { language: 'en', theme: 'light', lastMode: 'image', lastModelByMode: showcase('image') },
    keyState: VALID_KEY,
  });
  await waitFor("document.querySelector('.nav-count')?.textContent", 'the catalog');
  await page("document.querySelector('.model-button')?.click()");
  await settle();
  await page(`(() => {
    const box = document.querySelector('input[type=search]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(box, 'gpt');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.blur();
  })()`);
  await settle();
  await capture('screenshot-models.png');
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  ipcMain.handle('stub', (_event, name, ...args) => {
    const handler = handlers[name];
    if (!handler) throw new Error(`the stub has no handler for ${name}`);
    return handler(...args);
  });

  await bundle('scripts/ui/stub-api.ts', 'stub-preload.cjs', { format: 'cjs' });
  const { fetchCatalog } = await load('electron/openrouter.ts', 'openrouter');
  const { hardenSession } = await load('electron/security.ts', 'security');
  const dictionaries = {};
  // All of them, whatever --langs asks to draw: English is the reference every
  // other language is compared against.
  for (const lang of ALL_LANGS) dictionaries[lang] = (await load(`src/lib/locales/${lang}.ts`, `locale-${lang}`)).default;

  const { isInside } = await load('electron/paths.ts', 'paths');
  hardenSession(session.defaultSession);
  protocol.handle('kal', (request) => {
    const requested = path.resolve(new URL(request.url).searchParams.get('p') ?? '');
    // Only what the harness generated, by the same rule as the real handler.
    if (!isInside(scratch, requested)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(requested).toString());
  });

  process.stdout.write('Reading the live model catalog... ');
  state.catalog = await fetchCatalog(null);
  console.log(Object.entries(state.catalog.models).map(([mode, list]) => `${mode}=${list.length}`).join(' '));

  await createWindow(task === 'shots' ? 'screenshot' : 'win32', 'light');
  const code = task === 'shots' ? await shots() : await smoke(dictionaries);
  return code;
}

app.whenReady().then(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (err) {
    console.error(`\nFAIL ${err.stack ?? err.message}`);
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // A file still open on Windows; the folder is in the temp directory.
    }
    app.exit(code);
  }
});
