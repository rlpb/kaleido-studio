import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryItem, MediaKind, ModeId } from '../src/lib/types';
import { getSettings } from './store';

const INDEX_FILE = 'index.json';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/pcm': 'pcm',
  'text/plain': 'txt',
};

function extensionFor(mediaType: string, kind: MediaKind): string {
  const clean = mediaType.split(';')[0].trim().toLowerCase();
  if (EXTENSIONS[clean]) return EXTENSIONS[clean];
  const guess = clean.split('/')[1];
  if (guess && /^[a-z0-9]+$/.test(guess)) return guess;
  return kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'txt';
}

function root(): string {
  const dir = getSettings().libraryPath;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(): string {
  return path.join(root(), INDEX_FILE);
}

function readIndex(): LibraryItem[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    return Array.isArray(parsed) ? (parsed as LibraryItem[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(items: LibraryItem[]): void {
  fs.mkdirSync(root(), { recursive: true });
  fs.writeFileSync(indexPath(), JSON.stringify(items, null, 2), 'utf8');
}

export interface SaveInput {
  jobId: string;
  mode: ModeId;
  modelId: string;
  modelName: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  kind: MediaKind;
  mediaType: string;
  bytes: Buffer;
  text?: string;
  cost?: number;
  durationMs?: number;
}

/** Writes one output to disk and prepends it to the index. */
export function saveOutput(input: SaveInput): LibraryItem {
  const id = randomUUID();
  const stamp = new Date();
  const folder = path.join(root(), `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}`);
  fs.mkdirSync(folder, { recursive: true });

  const file = path.join(folder, `${id}.${extensionFor(input.mediaType, input.kind)}`);
  fs.writeFileSync(file, input.bytes);

  const item: LibraryItem = {
    id,
    jobId: input.jobId,
    mode: input.mode,
    modelId: input.modelId,
    modelName: input.modelName,
    prompt: input.prompt,
    params: input.params,
    kind: input.kind,
    path: file,
    mediaType: input.mediaType,
    text: input.text,
    cost: input.cost,
    durationMs: input.durationMs,
    createdAt: stamp.getTime(),
    favorite: false,
    tags: [],
  };
  writeIndex([item, ...readIndex()]);
  return item;
}

export interface LibraryQuery {
  search?: string;
  mode?: ModeId | 'all';
  kind?: MediaKind | 'all';
  favoritesOnly?: boolean;
  limit?: number;
  offset?: number;
}

export function listItems(query: LibraryQuery = {}): { items: LibraryItem[]; total: number } {
  const { search = '', mode = 'all', kind = 'all', favoritesOnly = false, limit = 60, offset = 0 } = query;
  const needle = search.trim().toLowerCase();

  const filtered = readIndex().filter((item) => {
    if (mode !== 'all' && item.mode !== mode) return false;
    if (kind !== 'all' && item.kind !== kind) return false;
    if (favoritesOnly && !item.favorite) return false;
    if (!needle) return true;
    return (
      item.prompt.toLowerCase().includes(needle) ||
      item.modelName.toLowerCase().includes(needle) ||
      item.modelId.toLowerCase().includes(needle) ||
      item.tags.some((t) => t.toLowerCase().includes(needle)) ||
      (item.text ?? '').toLowerCase().includes(needle)
    );
  });

  return { items: filtered.slice(offset, offset + limit), total: filtered.length };
}

export function updateItem(id: string, changes: Partial<Pick<LibraryItem, 'favorite' | 'tags'>>): LibraryItem | null {
  const items = readIndex();
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...changes };
  writeIndex(items);
  return items[index];
}

/** Removes the index entry, and the file with it unless the caller keeps it. */
export function deleteItem(id: string, deleteFile = true): boolean {
  const items = readIndex();
  const item = items.find((i) => i.id === id);
  if (!item) return false;
  if (deleteFile) {
    try {
      fs.unlinkSync(item.path);
    } catch {
      // An already-missing file is not a reason to keep a dead index entry.
    }
  }
  writeIndex(items.filter((i) => i.id !== id));
  return true;
}

export function stats(): { count: number; byKind: Record<string, number>; totalCost: number; bytes: number } {
  const items = readIndex();
  const byKind: Record<string, number> = {};
  let totalCost = 0;
  let bytes = 0;
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    totalCost += item.cost ?? 0;
    try {
      bytes += fs.statSync(item.path).size;
    } catch {
      // Counting skips files the user removed outside the app.
    }
  }
  return { count: items.length, byKind, totalCost: Number(totalCost.toFixed(6)), bytes };
}

/** Drops index entries whose file no longer exists. Returns how many went. */
export function pruneMissing(): number {
  const items = readIndex();
  const kept = items.filter((i) => fs.existsSync(i.path));
  if (kept.length !== items.length) writeIndex(kept);
  return items.length - kept.length;
}
