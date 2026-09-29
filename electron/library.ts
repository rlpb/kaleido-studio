import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryItem, MediaKind, ModeId } from '../src/lib/types';
import { getSettings } from './store';
import { readJsonOrQuarantine, writeJsonAtomic } from './atomic-json';
import { extensionFor } from './media-types';
import { isInside } from './paths';

const INDEX_FILE = 'index.json';

function root(): string {
  const dir = getSettings().libraryPath;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function indexPath(): string {
  return path.join(root(), INDEX_FILE);
}

/**
 * The index is the only record of what was generated, so a copy it cannot parse
 * is moved aside rather than treated as empty. Treating it as empty was worse
 * than it looks: the next saved result wrote a one-item index over it, and every
 * earlier entry vanished from the library while its file stayed on disk.
 */
function readIndex(): LibraryItem[] {
  const { value, quarantinedTo } = readJsonOrQuarantine<LibraryItem[]>(indexPath(), [], Array.isArray);
  if (quarantinedTo) console.error(`library index was unreadable, kept as ${quarantinedTo}`);
  return value;
}

function writeIndex(items: LibraryItem[]): void {
  writeJsonAtomic(indexPath(), items);
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
  inputs?: string[];
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
    inputs: input.inputs?.length ? input.inputs : undefined,
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
  // The path comes from the index, which is a plain file anyone can edit. A
  // deletion only follows it while it points inside the library.
  if (deleteFile && isInside(root(), item.path)) {
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
