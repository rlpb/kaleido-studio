/**
 * Shared contract between the Electron main process and the renderer.
 * Field names mirror the OpenRouter OpenAPI spec so nothing is translated twice.
 */

/** A studio mode is a preset over one OpenRouter endpoint plus a model filter. */
export type ModeId =
  | 'image'
  | 'image-edit'
  | 'video'
  | 'video-from-image'
  | 'video-upscale'
  | 'speech'
  | 'transcribe'
  | 'audio';

export type Endpoint = 'images' | 'videos' | 'speech' | 'transcriptions' | 'chat';

export type MediaKind = 'image' | 'video' | 'audio' | 'text';

export interface ModeDef {
  id: ModeId;
  label: string;
  hint: string;
  endpoint: Endpoint;
  outputKind: MediaKind;
  /** Requires at least one input asset before the run button unlocks. */
  needsInput: false | { kind: MediaKind; label: string; min: number; max: number };
}

/** One tunable exposed by a model, normalised from three different capability shapes. */
export type ParamSpec =
  | { key: string; label: string; kind: 'enum'; values: string[]; default?: string; help?: string }
  | { key: string; label: string; kind: 'int'; min: number; max: number; default?: number; help?: string }
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; default?: number; help?: string }
  | { key: string; label: string; kind: 'bool'; default?: boolean; help?: string }
  | { key: string; label: string; kind: 'text'; placeholder?: string; default?: string; help?: string };

/** How a model bills, normalised across the per-token and per-second schemes. */
export interface PriceModel {
  /** USD per second of output video, keyed by resolution ("default" when flat). */
  perVideoSecond?: Record<string, number>;
  /** USD per output image token. An image costs this times its token count. */
  perImageToken?: number;
  /** USD per input token (prompt). */
  perInputToken?: number;
  /** USD per output token. */
  perOutputToken?: number;
  /** USD per input audio token. */
  perAudioInputToken?: number;
  /** USD per output audio token. */
  perAudioOutputToken?: number;
  free: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  vendor: string;
  description: string;
  created: number;
  inputModalities: string[];
  outputModalities: string[];
  params: ParamSpec[];
  voices: string[];
  price: PriceModel;
  /** Max reference images accepted, 0 when the model cannot take any. */
  maxReferences: number;
  supportsFrameImages: boolean;
  isUpscaler: boolean;
}

export interface Catalog {
  fetchedAt: number;
  models: Record<ModeId, ModelInfo[]>;
}

export interface JobRequest {
  mode: ModeId;
  modelId: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  /** Absolute paths of local input files, or http(s) URLs. */
  inputs: string[];
  /** How many separate jobs to enqueue with this exact configuration. */
  batch: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface JobOutput {
  path: string;
  kind: MediaKind;
  mediaType: string;
  /** Populated for transcription jobs. */
  text?: string;
}

export interface Job {
  id: string;
  mode: ModeId;
  modelId: string;
  modelName: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  inputs: string[];
  status: JobStatus;
  progress: string;
  createdAt: number;
  finishedAt?: number;
  cost?: number;
  error?: string;
  outputs: JobOutput[];
}

export interface LibraryItem {
  id: string;
  jobId: string;
  mode: ModeId;
  modelId: string;
  modelName: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  kind: MediaKind;
  path: string;
  mediaType: string;
  text?: string;
  cost?: number;
  createdAt: number;
  favorite: boolean;
  tags: string[];
}

export interface Settings {
  hasKey: boolean;
  theme: 'dark' | 'light' | 'system';
  language: string;
  libraryPath: string;
  favoriteModels: string[];
  lastMode: ModeId;
  lastModelByMode: Partial<Record<ModeId, string>>;
  /** Real observed cost per model+shape, used for honest estimates. */
  observedCosts: Record<string, number>;
  spendTotal: number;
  concurrency: number;
}

export interface KeyStatus {
  valid: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  limitRemaining?: number | null;
  isFreeTier?: boolean;
  error?: string;
}

export interface Preset {
  id: string;
  name: string;
  mode: ModeId;
  modelId: string;
  prompt: string;
  params: Record<string, string | number | boolean>;
  createdAt: number;
}
