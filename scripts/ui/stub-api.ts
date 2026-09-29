import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../../src/lib/api';
import type { Job } from '../../src/lib/types';

/**
 * A stand-in for the preload bridge, so the real interface can be rendered and
 * inspected without an API key, a network or the main process.
 *
 * It is typed as `Bridge`, the interface the renderer is written against, which
 * is the point of writing it in TypeScript: when a method is added to the bridge
 * and not here, `npm run typecheck` fails, so this cannot drift into rendering a
 * screen the real app would not. Every call is forwarded to the harness, which
 * holds the state for the scenario being drawn.
 */
const call = <T>(name: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke('stub', name, ...args) as Promise<T>;

const listListeners = new Set<(jobs: Job[]) => void>();
const updateListeners = new Set<(job: Job) => void>();
ipcRenderer.on('stub:jobs', (_event, jobs: Job[]) => listListeners.forEach((handler) => handler(jobs)));
ipcRenderer.on('stub:job', (_event, job: Job) => updateListeners.forEach((handler) => handler(job)));

// Which layout the stylesheet applies. "win32" and "linux" reserve room for the
// caption buttons the system draws, "darwin" for the traffic lights, and anything
// else reserves nothing, which is what a screenshot of the page itself wants.
const platform = process.argv.find((arg) => arg.startsWith('--stub-platform='))?.split('=')[1] ?? 'win32';

const api: Bridge = {
  key: {
    set: (key) => call('key.set', key),
    status: () => call('key.status'),
    clear: () => call('key.clear'),
  },
  catalog: { get: (force) => call('catalog.get', force) },
  settings: {
    get: () => call('settings.get'),
    update: (changes) => call('settings.update', changes),
    toggleFavorite: (modelId) => call('settings.toggleFavorite', modelId),
    resetSpend: () => call('settings.resetSpend'),
    pickLibrary: () => call('settings.pickLibrary'),
  },
  jobs: {
    enqueue: (request, modelName) => call('jobs.enqueue', request, modelName),
    list: () => call('jobs.list'),
    cancel: (id) => call('jobs.cancel', id),
    retry: (id) => call('jobs.retry', id),
    clear: () => call('jobs.clear'),
    onList: (handler) => {
      listListeners.add(handler);
      return () => void listListeners.delete(handler);
    },
    onUpdate: (handler) => {
      updateListeners.add(handler);
      return () => void updateListeners.delete(handler);
    },
  },
  library: {
    list: (query) => call('library.list', query),
    update: (id, changes) => call('library.update', id, changes),
    remove: (id) => call('library.remove', id),
    stats: () => call('library.stats'),
    prune: () => call('library.prune'),
    reveal: (target) => call('library.reveal', target),
    open: (target) => call('library.open', target),
    exportCopy: (target) => call('library.exportCopy', target),
  },
  presets: {
    list: () => call('presets.list'),
    save: (preset) => call('presets.save', preset),
    remove: (id) => call('presets.remove', id),
  },
  prompts: { list: () => call('prompts.list'), clear: () => call('prompts.clear') },
  files: {
    pick: (kind, multiple) => call('files.pick', kind, multiple),
    pathFor: async () => '',
  },
  window: { setTheme: (theme) => call('window.setTheme', theme) },
  platform,
  app: { info: () => call('app.info'), openExternal: (url) => call('app.openExternal', url) },
  mediaUrl: (absolutePath) => `kal://local/?p=${encodeURIComponent(absolutePath)}`,
};

contextBridge.exposeInMainWorld('kaleido', api);
