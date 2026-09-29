import { app, safeStorage } from 'electron';
import path from 'node:path';
import type { ModeId, Preset, Settings } from '../src/lib/types';
import { MODE_BY_ID } from '../src/lib/modes';
import { readJsonOrQuarantine, writeJsonAtomic } from './atomic-json';

const CONFIG_FILE = 'config.json';

interface StoredConfig {
  /** Base64 of the OS-encrypted key, or the plain key when encryption is unavailable. */
  key?: string;
  keyEncrypted?: boolean;
  theme: Settings['theme'];
  language: Settings['language'];
  libraryPath?: string;
  favoriteModels: string[];
  lastMode: ModeId;
  lastModelByMode: Partial<Record<ModeId, string>>;
  observedCosts: Record<string, number>;
  spendTotal: number;
  concurrency: number;
  presets: Preset[];
  promptHistory: string[];
}

const DEFAULTS: StoredConfig = {
  theme: 'dark',
  language: '',
  favoriteModels: [],
  lastMode: 'image',
  lastModelByMode: {},
  observedCosts: {},
  spendTotal: 0,
  concurrency: 2,
  presets: [],
  promptHistory: [],
};

let cache: StoredConfig | null = null;

function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function defaultLibraryPath(): string {
  return path.join(app.getPath('userData'), 'Library');
}

/** First run follows the operating system, rather than assuming English. */
function systemLanguage(): string {
  try {
    return app.getLocale() || 'en';
  } catch {
    return 'en';
  }
}

const isConfig = (value: unknown): value is Partial<StoredConfig> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function load(): StoredConfig {
  if (cache) return cache;
  // A missing file is the first run. One that exists and cannot be parsed is
  // moved aside instead of being read as empty: this file holds the encrypted
  // API key, the presets and the prompt history, and the next save would
  // otherwise replace all of it with defaults.
  const { value, quarantinedTo } = readJsonOrQuarantine<Partial<StoredConfig>>(configPath(), {}, isConfig);
  if (quarantinedTo) console.error(`config was unreadable, kept as ${quarantinedTo}`);
  cache = { ...DEFAULTS, ...value };
  return cache;
}

function save(next: StoredConfig): void {
  writeJsonAtomic(configPath(), next);
  cache = next;
}

function patch(changes: Partial<StoredConfig>): StoredConfig {
  const next = { ...load(), ...changes };
  save(next);
  return next;
}

// ---------------------------------------------------------------------------
// API key
// ---------------------------------------------------------------------------

/**
 * The key is encrypted with the OS keychain when one is available. On a Linux
 * box without a keyring, safeStorage silently degrades, so the fallback is
 * recorded explicitly and surfaced in the UI rather than pretending it was
 * encrypted.
 */
export function setKey(key: string): { encrypted: boolean } {
  const trimmed = key.trim();
  if (!trimmed) {
    patch({ key: undefined, keyEncrypted: undefined });
    return { encrypted: false };
  }
  if (safeStorage.isEncryptionAvailable()) {
    patch({ key: safeStorage.encryptString(trimmed).toString('base64'), keyEncrypted: true });
    return { encrypted: true };
  }
  patch({ key: trimmed, keyEncrypted: false });
  return { encrypted: false };
}

export function getKey(): string | null {
  const cfg = load();
  if (!cfg.key) return null;
  if (!cfg.keyEncrypted) return cfg.key;
  try {
    return safeStorage.decryptString(Buffer.from(cfg.key, 'base64'));
  } catch {
    // Happens when the OS keychain changed since the key was stored.
    return null;
  }
}

export function keyIsEncrypted(): boolean {
  return load().keyEncrypted === true;
}

export function clearKey(): void {
  patch({ key: undefined, keyEncrypted: undefined });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSettings(): Settings {
  const cfg = load();
  return {
    hasKey: Boolean(cfg.key),
    theme: cfg.theme,
    language: cfg.language || systemLanguage(),
    libraryPath: cfg.libraryPath ?? defaultLibraryPath(),
    favoriteModels: cfg.favoriteModels,
    lastMode: cfg.lastMode,
    lastModelByMode: cfg.lastModelByMode,
    observedCosts: cfg.observedCosts,
    spendTotal: cfg.spendTotal,
    concurrency: cfg.concurrency,
  };
}

/**
 * What the renderer may change through the general settings call.
 *
 * Each field is checked against what it can legitimately be, because this is
 * the boundary where a request stops being code this project wrote. The library
 * folder is deliberately not among them: it decides where files get written, so
 * it changes only through the folder dialog, in `setLibraryPath` below.
 */
export function updateSettings(changes: Partial<Settings>): Settings {
  const allowed: Partial<StoredConfig> = {};
  if (changes.theme === 'dark' || changes.theme === 'light' || changes.theme === 'system') allowed.theme = changes.theme;
  if (typeof changes.language === 'string' && changes.language.length <= 16) allowed.language = changes.language;
  if (Array.isArray(changes.favoriteModels) && changes.favoriteModels.every((m) => typeof m === 'string')) {
    allowed.favoriteModels = changes.favoriteModels;
  }
  if (typeof changes.lastMode === 'string' && changes.lastMode in MODE_BY_ID) allowed.lastMode = changes.lastMode;
  if (changes.lastModelByMode && typeof changes.lastModelByMode === 'object') {
    allowed.lastModelByMode = Object.fromEntries(
      Object.entries(changes.lastModelByMode).filter(([mode, id]) => mode in MODE_BY_ID && typeof id === 'string'),
    );
  }
  if (typeof changes.concurrency === 'number' && Number.isFinite(changes.concurrency)) {
    allowed.concurrency = Math.min(6, Math.max(1, Math.round(changes.concurrency)));
  }
  patch(allowed);
  return getSettings();
}

/** Called only with the result of the folder dialog this process opened. */
export function setLibraryPath(folder: string): Settings {
  patch({ libraryPath: folder });
  return getSettings();
}

export function toggleFavoriteModel(modelId: string): string[] {
  const cfg = load();
  const set = new Set(cfg.favoriteModels);
  if (set.has(modelId)) set.delete(modelId);
  else set.add(modelId);
  return patch({ favoriteModels: [...set] }).favoriteModels;
}

/**
 * Records what a run actually cost so the next estimate for the same shape is a
 * measurement rather than a guess. Keyed by model plus the parameters that move
 * the price.
 */
export function recordCost(costKey: string, cost: number): void {
  const cfg = load();
  patch({
    observedCosts: { ...cfg.observedCosts, [costKey]: cost },
    spendTotal: Number((cfg.spendTotal + cost).toFixed(6)),
  });
}

export function resetSpend(): void {
  patch({ spendTotal: 0 });
}

// ---------------------------------------------------------------------------
// Presets and prompt history
// ---------------------------------------------------------------------------

export function getPresets(): Preset[] {
  return load().presets;
}

export function savePreset(preset: Preset): Preset[] {
  const presets = load().presets.filter((p) => p.id !== preset.id);
  return patch({ presets: [preset, ...presets].slice(0, 200) }).presets;
}

export function deletePreset(id: string): Preset[] {
  return patch({ presets: load().presets.filter((p) => p.id !== id) }).presets;
}

export function getPromptHistory(): string[] {
  return load().promptHistory;
}

export function pushPrompt(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return load().promptHistory;
  const history = [trimmed, ...load().promptHistory.filter((p) => p !== trimmed)].slice(0, 100);
  return patch({ promptHistory: history }).promptHistory;
}

export function clearPromptHistory(): string[] {
  return patch({ promptHistory: [] }).promptHistory;
}
