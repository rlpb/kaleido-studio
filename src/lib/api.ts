import type { Catalog, Job, JobRequest, LibraryItem, MediaKind, ModeId, Preset, Settings } from './types';

export interface KeyState {
  valid: boolean;
  configured: boolean;
  encrypted: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
  error?: string;
  credits?: { total: number; used: number } | null;
}

export interface LibraryQuery {
  search?: string;
  mode?: ModeId | 'all';
  kind?: MediaKind | 'all';
  favoritesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  userData: string;
}

interface Bridge {
  key: {
    set(key: string): Promise<KeyState & { encrypted: boolean }>;
    status(): Promise<KeyState>;
    clear(): Promise<boolean>;
  };
  catalog: { get(force?: boolean): Promise<Catalog> };
  settings: {
    get(): Promise<Settings>;
    update(changes: Partial<Settings>): Promise<Settings>;
    toggleFavorite(modelId: string): Promise<string[]>;
    resetSpend(): Promise<Settings>;
    pickLibrary(): Promise<Settings>;
  };
  jobs: {
    enqueue(req: JobRequest, modelName: string): Promise<Job[]>;
    list(): Promise<Job[]>;
    cancel(id: string): Promise<boolean>;
    retry(id: string): Promise<Job | null>;
    clear(): Promise<Job[]>;
    onList(handler: (jobs: Job[]) => void): () => void;
    onUpdate(handler: (job: Job) => void): () => void;
  };
  library: {
    list(query: LibraryQuery): Promise<{ items: LibraryItem[]; total: number }>;
    update(id: string, changes: Partial<LibraryItem>): Promise<LibraryItem | null>;
    remove(id: string): Promise<boolean>;
    stats(): Promise<{ count: number; byKind: Record<string, number>; totalCost: number; bytes: number }>;
    prune(): Promise<number>;
    reveal(path: string): Promise<boolean>;
    open(path: string): Promise<string>;
    exportCopy(path: string): Promise<string | null>;
  };
  presets: {
    list(): Promise<Preset[]>;
    save(preset: Preset): Promise<Preset[]>;
    remove(id: string): Promise<Preset[]>;
  };
  prompts: { list(): Promise<string[]>; clear(): Promise<string[]> };
  files: {
    pick(kind: 'image' | 'video' | 'audio', multiple: boolean): Promise<string[]>;
    pathFor(file: File): string;
  };
  window: { setTheme(theme: 'dark' | 'light'): Promise<boolean> };
  platform: string;
  app: { info(): Promise<AppInfo>; openExternal(url: string): Promise<boolean> };
  mediaUrl(absolutePath: string): string;
}

declare global {
  interface Window {
    kaleido: Bridge;
  }
}

export const bridge: Bridge = window.kaleido;
