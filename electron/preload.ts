import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Job } from '../src/lib/types';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Unwraps the main-process envelope so callers see a value or an exception. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>;
  if (!res.ok) throw new Error(res.error ?? 'The operation failed');
  return res.data as T;
}

const api = {
  key: {
    set: (key: string) => call<any>('key:set', key),
    status: () => call<any>('key:status'),
    clear: () => call<boolean>('key:clear'),
  },
  catalog: {
    get: (force = false) => call<any>('catalog:get', force),
  },
  settings: {
    get: () => call<any>('settings:get'),
    update: (changes: unknown) => call<any>('settings:update', changes),
    toggleFavorite: (modelId: string) => call<string[]>('settings:favorite', modelId),
    resetSpend: () => call<any>('settings:resetSpend'),
    pickLibrary: () => call<any>('settings:pickLibrary'),
  },
  jobs: {
    enqueue: (req: unknown, modelName: string) => call<Job[]>('jobs:enqueue', req, modelName),
    list: () => call<Job[]>('jobs:list'),
    cancel: (id: string) => call<boolean>('jobs:cancel', id),
    retry: (id: string) => call<Job | null>('jobs:retry', id),
    clear: () => call<Job[]>('jobs:clear'),
    onList: (handler: (jobs: Job[]) => void) => {
      const listener = (_e: unknown, jobs: Job[]) => handler(jobs);
      ipcRenderer.on('job:list', listener);
      return () => ipcRenderer.removeListener('job:list', listener);
    },
    onUpdate: (handler: (job: Job) => void) => {
      const listener = (_e: unknown, job: Job) => handler(job);
      ipcRenderer.on('job:update', listener);
      return () => ipcRenderer.removeListener('job:update', listener);
    },
  },
  library: {
    list: (query: unknown) => call<any>('library:list', query),
    update: (id: string, changes: unknown) => call<any>('library:update', id, changes),
    remove: (id: string) => call<boolean>('library:delete', id),
    stats: () => call<any>('library:stats'),
    prune: () => call<number>('library:prune'),
    reveal: (path: string) => call<boolean>('library:reveal', path),
    open: (path: string) => call<string>('library:open', path),
    exportCopy: (path: string) => call<string | null>('library:export', path),
  },
  presets: {
    list: () => call<any[]>('presets:list'),
    save: (preset: unknown) => call<any[]>('presets:save', preset),
    remove: (id: string) => call<any[]>('presets:delete', id),
  },
  prompts: {
    list: () => call<string[]>('prompts:list'),
    clear: () => call<string[]>('prompts:clear'),
  },
  files: {
    pick: (kind: 'image' | 'video' | 'audio', multiple: boolean) => call<string[]>('files:pick', kind, multiple),
    /** Electron removed File.path, so a dropped file is resolved here instead. */
    pathFor: (file: File) => webUtils.getPathForFile(file),
  },
  app: {
    info: () => call<any>('app:info'),
    openExternal: (url: string) => call<boolean>('app:openExternal', url),
  },
  /** Builds a URL the renderer can put in <img>/<video>/<audio> for a library file. */
  mediaUrl: (absolutePath: string) => `kal://local/?p=${encodeURIComponent(absolutePath)}`,
};

contextBridge.exposeInMainWorld('kaleido', api);

export type KaleidoApi = typeof api;
