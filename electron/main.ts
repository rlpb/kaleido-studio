import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Catalog, JobRequest, LibraryItem, ModeId, Preset, Settings } from '../src/lib/types';
import { fetchCatalog, checkKey, getCredits } from './openrouter';
import * as store from './store';
import * as library from './library';
import { runner } from './jobs';

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
 * Serves a library file to the renderer. The URL carries the absolute path in a
 * query parameter rather than the pathname, because a POSIX path starts with a
 * slash that pathname parsing would swallow. The file is only served when it
 * really resolves inside the library folder, so a crafted path cannot read the
 * rest of the disk.
 */
function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const requested = url.searchParams.get('p');
  if (!requested) return Promise.resolve(new Response('Bad request', { status: 400 }));
  const resolved = path.resolve(requested);
  const root = path.resolve(store.getSettings().libraryPath);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return Promise.resolve(new Response('Forbidden', { status: 403 }));
  }
  return net.fetch(pathToFileURL(resolved).toString());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
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
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DEV_URL) && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

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
          label: 'Apri cartella libreria',
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
          label: 'Documentazione OpenRouter',
          click: () => void shell.openExternal('https://openrouter.ai/docs'),
        },
        {
          label: 'Repository del progetto',
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
  ipcMain.handle(channel, async (_event, ...args) => {
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
      title: 'Scegli la cartella della libreria',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.getSettings().libraryPath,
    });
    if (result.canceled || !result.filePaths[0]) return store.getSettings();
    return store.updateSettings({ libraryPath: result.filePaths[0] });
  });

  handle('jobs:enqueue', (req: JobRequest, modelName: string) => runner.enqueue(req, modelName));
  handle('jobs:list', () => runner.list());
  handle('jobs:cancel', (id: string) => {
    runner.cancel(id);
    return true;
  });
  handle('jobs:clear', () => {
    runner.clearFinished();
    return runner.list();
  });

  handle('library:list', (query: library.LibraryQuery) => library.listItems(query));
  handle('library:update', (id: string, changes: Partial<LibraryItem>) => library.updateItem(id, changes));
  handle('library:delete', (id: string) => library.deleteItem(id));
  handle('library:stats', () => library.stats());
  handle('library:prune', () => library.pruneMissing());
  handle('library:reveal', (filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });
  handle('library:open', (filePath: string) => shell.openPath(filePath));

  handle('library:export', async (filePath: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Salva una copia',
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
      image: [{ name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      video: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
      audio: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'webm'] }],
    }[kind];
    const result = await dialog.showOpenDialog({
      title: 'Scegli i file di input',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters,
    });
    return result.canceled ? [] : result.filePaths;
  });

  handle('files:mode', (mode: ModeId) => mode);
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
