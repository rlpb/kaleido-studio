import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Catalog, JobRequest, LibraryItem, Preset, Settings } from '../src/lib/types';
import { fetchCatalog, checkKey, getCredits, setFetch } from './openrouter';
import * as store from './store';
import * as library from './library';
import { runner } from './jobs';
import { isOpenable } from './media-types';
import { isInside } from './paths';
import { hardenSession, isAppUrl, isTrustedSender } from './security';

const IS_DEV = process.env.KALEIDO_DEV === '1';
const DEV_URL = 'http://localhost:5173';
const CATALOG_TTL_MS = 30 * 60 * 1000;
const MEDIA_SCHEME = 'kal';

let mainWindow: BrowserWindow | null = null;
let catalogCache: Catalog | null = null;

// A custom scheme is the only way to show library files while keeping
// webSecurity on and the renderer sandboxed.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/**
 * Files outside the library that the user picked as inputs, so their thumbnails
 * can be shown without opening the whole disk to the renderer.
 *
 * A path only lands here through a file dialog this process opened, or through
 * `webUtils.getPathForFile` on a file genuinely dropped on the window. The
 * renderer never gets to name a path itself, which is the property the library
 * containment below exists to protect.
 */
const previewable = new Set<string>();
const PREVIEWABLE_LIMIT = 2000;

export function allowPreview(input: string): void {
  const resolved = path.resolve(input);
  if (previewable.has(resolved)) return;
  // Bounded so a long session cannot grow it without limit; the oldest entry
  // goes, and a thumbnail that stops loading is the worst that can happen.
  if (previewable.size >= PREVIEWABLE_LIMIT) {
    const oldest = previewable.values().next().value;
    if (oldest) previewable.delete(oldest);
  }
  previewable.add(resolved);
}

function libraryRoot(): string {
  return path.resolve(store.getSettings().libraryPath);
}

/**
 * The file a library call is allowed to act on, or an error.
 *
 * These handlers take a path from the renderer and hand it to the operating
 * system: open, reveal, copy. A path is only honoured while it resolves inside
 * the library folder, which is where every file the app produced lives.
 */
function requireLibraryFile(filePath: unknown): string {
  if (typeof filePath !== 'string' || !filePath) throw new Error('No file was given.');
  if (!isInside(libraryRoot(), filePath)) throw new Error('That file is outside the library folder.');
  return path.resolve(filePath);
}

/**
 * Whether a job may read this input. A remote URL is passed to the provider as
 * it is; a local path must be a file the user chose through a dialog or dropped
 * on the window, or one the library holds. Anything else would let the renderer
 * name any file on the disk and have it uploaded to the provider.
 */
function isAllowedInput(input: unknown): boolean {
  if (typeof input !== 'string' || !input) return false;
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return true;
  const resolved = path.resolve(input);
  return previewable.has(resolved) || isInside(libraryRoot(), resolved);
}

/**
 * Serves a file to the renderer. The URL carries the absolute path in a query
 * parameter rather than the pathname, because a POSIX path starts with a slash
 * that pathname parsing would swallow.
 *
 * Two things are servable and nothing else: files inside the library folder, and
 * files the user explicitly chose as inputs. Reference images live wherever the
 * user keeps them, so without the second rule their thumbnails were refused and
 * the tile rendered its alt text over the picture instead.
 */
function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get('p');
  if (!requested) return Promise.resolve(new Response('Bad request', { status: 400 }));
  const resolved = path.resolve(requested);
  if (!isInside(libraryRoot(), resolved) && !previewable.has(resolved)) {
    return Promise.resolve(new Response('Forbidden', { status: 403 }));
  }
  return net.fetch(pathToFileURL(resolved).toString());
}

/** Matches the .topbar height in the stylesheet, so the controls line up. */
const TOP_BAR_HEIGHT = 50;

/**
 * The overlay is painted by the system, not by CSS, so it has to be told the
 * theme separately and repainted whenever the theme changes. These values are
 * the --surface and --text-muted tokens for each theme.
 */
function overlayColours(theme: 'dark' | 'light'): { color: string; symbolColor: string } {
  return theme === 'light'
    ? { color: '#ffffff', symbolColor: '#545c70' }
    : { color: '#12151d', symbolColor: '#9aa3b8' };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    // The menu stays reachable with Alt but does not frame the app by default.
    autoHideMenuBar: true,
    // One bar instead of two: the window controls are drawn over the app's own
    // top bar rather than in a separate system strip above it. The overlay
    // keeps the native buttons, so snapping, maximise and the system menu all
    // behave exactly as Windows expects.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 17 } }
      : { titleBarOverlay: { ...overlayColours('dark'), height: TOP_BAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Anything that tries to open a window goes to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window shows this application's own page and nothing else. Any other
  // destination, a redirect included, is refused, and a web link opens in the
  // system browser instead. It used to accept every file:// URL, which let the
  // window be pointed at any local page while the preload stayed attached.
  const keepOnAppPage = (event: Electron.Event, url: string) => {
    if (isAppUrl(url, IS_DEV ? DEV_URL : undefined)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  };
  mainWindow.webContents.on('will-navigate', keepOnAppPage);
  mainWindow.webContents.on('will-redirect', keepOnAppPage);

  runner.attach(mainWindow);

  if (IS_DEV) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open library folder',
          click: () => void shell.openPath(store.getSettings().libraryPath),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'OpenRouter documentation',
          click: () => void shell.openExternal('https://openrouter.ai/docs'),
        },
        {
          label: 'Project repository',
          click: () => void shell.openExternal('https://github.com/rlpb/kaleido-studio'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, ...args) => {
    // Every handler acts on the disk or on the API key, so each one answers the
    // application's own page and nothing else.
    if (!isTrustedSender(event, mainWindow, IS_DEV ? DEV_URL : undefined)) {
      return { ok: false, error: 'Refused: the request did not come from the application window.' };
    }
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function registerIpc(): void {
  handle('key:set', async (key: string) => {
    const status = await checkKey(key);
    if (!status.valid) return { ...status, encrypted: false };
    const { encrypted } = store.setKey(key);
    catalogCache = null;
    return { ...status, encrypted };
  });

  handle('key:status', async () => {
    const key = store.getKey();
    if (!key) return { valid: false, encrypted: false, configured: false };
    const status = await checkKey(key);
    const credits = status.valid ? await getCredits(key) : null;
    return { ...status, encrypted: store.keyIsEncrypted(), configured: true, credits };
  });

  handle('key:clear', () => {
    store.clearKey();
    catalogCache = null;
    return true;
  });

  handle('catalog:get', async (force = false) => {
    if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) return catalogCache;
    catalogCache = await fetchCatalog(store.getKey());
    return catalogCache;
  });

  handle('settings:get', () => store.getSettings());
  handle('settings:update', (changes: Partial<Settings>) => store.updateSettings(changes));
  handle('settings:favorite', (modelId: string) => store.toggleFavoriteModel(modelId));
  handle('settings:resetSpend', () => {
    store.resetSpend();
    return store.getSettings();
  });

  handle('settings:pickLibrary', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose the library folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.getSettings().libraryPath,
    });
    if (result.canceled || !result.filePaths[0]) return store.getSettings();
    return store.setLibraryPath(result.filePaths[0]);
  });

  handle('jobs:enqueue', (req: JobRequest, modelName: string) => {
    const inputs = Array.isArray(req?.inputs) ? req.inputs : [];
    const refused = inputs.find((input) => !isAllowedInput(input));
    if (refused !== undefined) throw new Error('One of the input files was not chosen through the application.');
    return runner.enqueue(req, modelName);
  });
  handle('jobs:list', () => runner.list());
  handle('jobs:cancel', (id: string) => {
    runner.cancel(id);
    return true;
  });
  handle('jobs:retry', (id: string) => runner.retry(id));
  handle('jobs:clear', () => {
    runner.clearFinished();
    return runner.list();
  });

  handle('library:list', (query: library.LibraryQuery) => library.listItems(query));
  handle('library:update', (id: string, changes: Partial<LibraryItem>) => library.updateItem(id, changes));
  handle('library:delete', (id: string) => library.deleteItem(id));
  handle('library:stats', () => library.stats());
  handle('library:prune', () => library.pruneMissing());
  /**
   * Opens the folder holding a file.
   *
   * `shell.showItemInFolder` selects the file, which is nicer, but it returns
   * nothing at all: when it fails the only sign is an Explorer error dialog the
   * app cannot catch, explain or replace. `shell.openPath` returns the failure
   * as a string, so a problem reaches the user as an in-app message. Selecting
   * the file is worth less than knowing whether the action worked.
   */
  handle('library:reveal', async (requested: string) => {
    const filePath = requireLibraryFile(requested);
    const folder = path.dirname(filePath);
    if (!fs.existsSync(filePath)) {
      if (!fs.existsSync(folder)) throw new Error(`Neither the file nor its folder exist any more: ${filePath}`);
      const missing = await shell.openPath(folder);
      if (missing) throw new Error(missing);
      throw new Error(`The file is no longer there, opened ${folder} instead.`);
    }
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return true;
  });
  // shell.openPath runs whatever the file is, so it is only ever given a media
  // file from inside the library. An executable there would be one click from
  // being launched, and the extension of a saved file used to come from a type
  // the provider declared (see media-types.ts).
  handle('library:open', (requested: string) => {
    const filePath = requireLibraryFile(requested);
    if (!isOpenable(filePath)) throw new Error('This kind of file is not opened from the application.');
    return shell.openPath(filePath);
  });

  handle('library:export', async (requested: string) => {
    const filePath = requireLibraryFile(requested);
    const result = await dialog.showSaveDialog({
      title: 'Save a copy',
      defaultPath: path.basename(filePath),
    });
    if (result.canceled || !result.filePath) return null;
    fs.copyFileSync(filePath, result.filePath);
    return result.filePath;
  });

  handle('presets:list', () => store.getPresets());
  handle('presets:save', (preset: Preset) => store.savePreset(preset));
  handle('presets:delete', (id: string) => store.deletePreset(id));

  handle('prompts:list', () => store.getPromptHistory());
  handle('prompts:clear', () => store.clearPromptHistory());

  handle('files:pick', async (kind: 'image' | 'video' | 'audio', multiple: boolean) => {
    const filters: Electron.FileFilter[] = {
      image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      video: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
      audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'webm'] }],
    }[kind];
    const result = await dialog.showOpenDialog({
      title: 'Choose the input files',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters,
    });
    if (result.canceled) return [];
    // Chosen through a dialog this process opened, so their thumbnails may load.
    for (const picked of result.filePaths) allowPreview(picked);
    return result.filePaths;
  });

  // Called by the preload once webUtils has resolved a genuinely dropped file.
  // Not exposed to the renderer as a general call: it can only be reached with a
  // real File object, which is what keeps it from becoming a path oracle.
  handle('files:allowPreview', (input: string) => {
    if (typeof input === 'string' && input) allowPreview(input);
    return true;
  });

  handle('window:theme', (theme) => {
    // Windows and Linux paint the caption buttons themselves, so a theme change
    // has to be handed to them or the strip stays the previous colour.
    if (process.platform === 'darwin' || !mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.setTitleBarOverlay({ ...overlayColours(theme === 'light' ? 'light' : 'dark'), height: TOP_BAR_HEIGHT });
    return true;
  });

  handle('app:openExternal', (url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return true;
  });
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    userData: app.getPath('userData'),
  }));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // Chromium's network stack rather than Node's: system proxy and certificate
    // store, and TCP keep-alive on the socket that waits out a generation.
    setFetch((url, init) => net.fetch(url, init));
    // Before any window exists, so the policy is in force for the first load.
    hardenSession(session.defaultSession);
    protocol.handle(MEDIA_SCHEME, serveMedia);
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
