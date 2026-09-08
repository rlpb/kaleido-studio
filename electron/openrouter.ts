import type { Catalog, KeyStatus, ModelInfo, ModeId, ParamSpec, PriceModel } from '../src/lib/types';

const BASE = 'https://openrouter.ai/api/v1';
const APP_HEADERS = {
  'HTTP-Referer': 'https://github.com/rlpb/kaleido-studio',
  'X-Title': 'Kaleido Studio',
};

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

function headers(key: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...APP_HEADERS, ...extra };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

/**
 * OpenRouter reports some failures as {error:{message,code}} in the body, so the
 * payload is inspected even when the HTTP status looks fine.
 */
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new OpenRouterError(res.ok ? 'Risposta non in formato JSON' : text.slice(0, 400), res.status);
    }
  }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ?? body?.detail ?? res.statusText ?? 'Richiesta fallita';
    throw new OpenRouterError(String(msg), res.status, body?.error?.code);
  }
  return body;
}

async function get(path: string, key: string | null): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(key) });
  return readJson(res);
}

async function post(path: string, key: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return readJson(res);
}

/** Posts to an endpoint that answers with raw bytes, such as speech synthesis. */
async function postBytes(path: string, key: string, body: unknown): Promise<{ bytes: Buffer; mediaType: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const mediaType = res.headers.get('content-type') ?? 'application/octet-stream';
  if (!res.ok || mediaType.includes('application/json')) {
    const text = await res.text();
    let msg = text.slice(0, 400);
    try {
      msg = JSON.parse(text)?.error?.message ?? msg;
    } catch {
      /* the raw text is the best message available */
    }
    throw new OpenRouterError(String(msg), res.ok ? 502 : res.status);
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), mediaType };
}

export async function getBytes(url: string, key: string): Promise<{ bytes: Buffer; mediaType: string }> {
  const res = await fetch(url, { headers: headers(key) });
  if (!res.ok) throw new OpenRouterError(`Download fallito (${res.status})`, res.status);
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    mediaType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

// ---------------------------------------------------------------------------
// Key and balance
// ---------------------------------------------------------------------------

export async function checkKey(key: string): Promise<KeyStatus> {
  try {
    const body = await get('/key', key);
    const d = body?.data ?? {};
    return {
      valid: true,
      label: d.label,
      usage: typeof d.usage === 'number' ? d.usage : undefined,
      limit: d.limit ?? null,
      limitRemaining: d.limit_remaining ?? null,
      isFreeTier: Boolean(d.is_free_tier),
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getCredits(key: string): Promise<{ total: number; used: number } | null> {
  try {
    const body = await get('/credits', key);
    const d = body?.data ?? {};
    return { total: Number(d.total_credits ?? 0), used: Number(d.total_usage ?? 0) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Capability normalisation
// ---------------------------------------------------------------------------

const PARAM_LABELS: Record<string, string> = {
  aspect_ratio: 'Formato',
  resolution: 'Risoluzione',
  size: 'Dimensioni',
  quality: 'Qualità',
  output_format: 'Formato file',
  output_compression: 'Compressione',
  background: 'Sfondo',
  n: 'Immagini per richiesta',
  seed: 'Seed',
  duration: 'Durata (secondi)',
  generate_audio: 'Genera audio',
  upscale_factor: 'Fattore di ingrandimento',
  creativity: 'Creatività',
  voice: 'Voce',
  speed: 'Velocità',
  response_format: 'Formato risposta',
  language: 'Lingua',
  temperature: 'Temperatura',
  word_timestamps: 'Timestamp per parola',
};

const label = (key: string) => PARAM_LABELS[key] ?? key.replace(/_/g, ' ');

/** Keys handled by dedicated UI, never rendered as a generic control. */
const NOT_A_FORM_FIELD = new Set([
  'input_references',
  'stream',
  'user',
  'provider',
  'prompt',
  'model',
  'callback_url',
]);

function priceFromModelEntry(pricing: Record<string, string> | undefined): PriceModel {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const price: PriceModel = {
    perInputToken: num(pricing?.prompt),
    perOutputToken: num(pricing?.completion),
    perImageToken: num(pricing?.image_output),
    perAudioInputToken: num(pricing?.audio),
    perAudioOutputToken: num(pricing?.audio_output),
    free: false,
  };
  price.free = !price.perInputToken && !price.perOutputToken && !price.perImageToken && !price.perAudioOutputToken;
  return price;
}

function vendorOf(id: string): string {
  const slug = id.split('/')[0] ?? '';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Turns the typed `supported_parameters` map of /images/models into form fields. */
function imageParams(sp: Record<string, any> | undefined): { params: ParamSpec[]; maxReferences: number } {
  const params: ParamSpec[] = [];
  let maxReferences = 0;
  for (const [key, spec] of Object.entries(sp ?? {})) {
    if (key === 'input_references') {
      maxReferences = Number(spec?.max ?? 0);
      continue;
    }
    if (NOT_A_FORM_FIELD.has(key)) continue;
    if (spec?.type === 'enum' && Array.isArray(spec.values)) {
      params.push({ key, label: label(key), kind: 'enum', values: spec.values.map(String) });
    } else if (spec?.type === 'range') {
      params.push({ key, label: label(key), kind: 'int', min: Number(spec.min ?? 0), max: Number(spec.max ?? 1) });
    } else if (spec?.type === 'boolean') {
      params.push({ key, label: label(key), kind: 'bool' });
    }
  }
  const order = ['aspect_ratio', 'resolution', 'size', 'quality', 'n', 'output_format', 'background'];
  params.sort((a, b) => {
    const ia = order.indexOf(a.key);
    const ib = order.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return { params, maxReferences };
}

/** Turns the flat capability flags of /videos/models into form fields. */
function videoParams(entry: any): ParamSpec[] {
  const params: ParamSpec[] = [];
  const pushEnum = (key: string, values: unknown[] | null | undefined) => {
    if (Array.isArray(values) && values.length) {
      params.push({
        key,
        label: label(key),
        kind: 'enum',
        values: values.map(String),
        default: String(values[0]),
      });
    }
  };
  pushEnum('resolution', entry.supported_resolutions);
  pushEnum('aspect_ratio', entry.supported_aspect_ratios);
  pushEnum('size', entry.supported_sizes);
  if (Array.isArray(entry.supported_durations) && entry.supported_durations.length) {
    const durations = [...entry.supported_durations].map(Number).sort((a: number, b: number) => a - b);
    params.push({
      key: 'duration',
      label: label('duration'),
      kind: 'enum',
      values: durations.map(String),
      default: String(durations[0]),
      help: 'Il costo cresce in proporzione alla durata.',
    });
  }
  if (entry.generate_audio) {
    params.push({ key: 'generate_audio', label: label('generate_audio'), kind: 'bool', default: true });
  }
  if (entry.upscale_factor) {
    params.push({
      key: 'upscale_factor',
      label: label('upscale_factor'),
      kind: 'number',
      min: 1,
      max: Number(entry.upscale_factor) || 4,
      step: 0.5,
      default: Number(entry.upscale_factor) || 2,
    });
  }
  if (entry.creativity !== null && entry.creativity !== undefined) {
    params.push({ key: 'creativity', label: label('creativity'), kind: 'int', min: 0, max: 10, default: 0 });
  }
  if (entry.seed) {
    params.push({
      key: 'seed',
      label: label('seed'),
      kind: 'int',
      min: 0,
      max: 2147483647,
      help: 'Stesso seed e stesso prompt danno lo stesso risultato.',
    });
  }
  return params;
}

function videoPrice(skus: Record<string, string> | undefined): PriceModel {
  const perVideoSecond: Record<string, number> = {};
  for (const [sku, value] of Object.entries(skus ?? {})) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (sku === 'duration_seconds') perVideoSecond.default = n;
    else if (sku.startsWith('duration_seconds_')) perVideoSecond[sku.slice('duration_seconds_'.length)] = n;
  }
  return { perVideoSecond, free: Object.keys(perVideoSecond).length === 0 };
}

function speechParams(entry: any): ParamSpec[] {
  const params: ParamSpec[] = [];
  const voices: string[] = Array.isArray(entry.supported_voices) ? entry.supported_voices : [];
  if (voices.length) {
    params.push({ key: 'voice', label: label('voice'), kind: 'enum', values: voices, default: voices[0] });
  }
  params.push({
    key: 'response_format',
    label: label('response_format'),
    kind: 'enum',
    values: ['mp3', 'pcm'],
    default: 'mp3',
  });
  params.push({
    key: 'speed',
    label: label('speed'),
    kind: 'number',
    min: 0.25,
    max: 4,
    step: 0.05,
    default: 1,
    help: 'Applicata solo dai modelli che la supportano, altrimenti ignorata.',
  });
  return params;
}

function transcribeParams(): ParamSpec[] {
  return [
    {
      key: 'language',
      label: label('language'),
      kind: 'text',
      placeholder: 'it, en, ja… (vuoto = rilevamento automatico)',
    },
    {
      key: 'response_format',
      label: label('response_format'),
      kind: 'enum',
      values: ['json', 'verbose_json'],
      default: 'json',
    },
    {
      key: 'word_timestamps',
      label: label('word_timestamps'),
      kind: 'bool',
      default: false,
      help: 'Richiede il formato verbose_json e un provider compatibile OpenAI.',
    },
    { key: 'temperature', label: label('temperature'), kind: 'number', min: 0, max: 1, step: 0.05, default: 0 },
  ];
}

type ModelCore = Omit<ModelInfo, 'params' | 'price' | 'maxReferences' | 'supportsFrameImages' | 'isUpscaler'>;

function baseModel(entry: any): ModelCore {
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    vendor: vendorOf(entry.id),
    description: String(entry.description ?? '').trim(),
    created: Number(entry.created ?? 0),
    inputModalities: entry.architecture?.input_modalities ?? [],
    outputModalities: entry.architecture?.output_modalities ?? [],
    voices: Array.isArray(entry.supported_voices) ? entry.supported_voices : [],
  };
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

async function listByModality(modality: string, key: string | null): Promise<any[]> {
  const body = await get(`/models?output_modalities=${encodeURIComponent(modality)}`, key);
  return Array.isArray(body?.data) ? body.data : [];
}

/**
 * Builds the per-mode model lists. Pricing lives on /models while the typed
 * capability data lives on the per-endpoint model routes, so the two are joined
 * by model id.
 */
export async function fetchCatalog(key: string | null): Promise<Catalog> {
  const [imagePricing, videoMeta, speech, transcription, audio, imageCaps, videoCaps] = await Promise.all([
    listByModality('image', key),
    listByModality('video', key),
    listByModality('speech', key),
    listByModality('transcription', key),
    listByModality('audio', key),
    get('/images/models', key).then((b) => (Array.isArray(b?.data) ? b.data : [])),
    get('/videos/models', key).then((b) => (Array.isArray(b?.data) ? b.data : [])),
  ]);

  const imagePriceById = new Map<string, any>(imagePricing.map((m: any) => [m.id, m]));
  const videoMetaById = new Map<string, any>(videoMeta.map((m: any) => [m.id, m]));

  const images: ModelInfo[] = imageCaps.map((entry: any) => {
    const priced = imagePriceById.get(entry.id);
    const { params, maxReferences } = imageParams(entry.supported_parameters);
    return {
      ...baseModel({ ...entry, architecture: entry.architecture ?? priced?.architecture }),
      params,
      price: priceFromModelEntry(priced?.pricing),
      maxReferences,
      supportsFrameImages: false,
      isUpscaler: false,
    };
  });

  const videos: ModelInfo[] = videoCaps.map((entry: any) => {
    const meta = videoMetaById.get(entry.id);
    return {
      ...baseModel({ ...entry, architecture: meta?.architecture ?? entry.architecture }),
      params: videoParams(entry),
      price: videoPrice(entry.pricing_skus),
      maxReferences: 4,
      supportsFrameImages: Array.isArray(entry.supported_frame_images) && entry.supported_frame_images.length > 0,
      isUpscaler: entry.upscale_factor !== null && entry.upscale_factor !== undefined,
    };
  });

  const simple = (entries: any[], params: (e: any) => ParamSpec[]): ModelInfo[] =>
    entries.map((entry: any) => ({
      ...baseModel(entry),
      params: params(entry),
      price: priceFromModelEntry(entry.pricing),
      maxReferences: 0,
      supportsFrameImages: false,
      isUpscaler: false,
    }));

  const models: Record<ModeId, ModelInfo[]> = {
    image: images,
    'image-edit': images.filter((m) => m.maxReferences > 0 && m.inputModalities.includes('image')),
    video: videos.filter((m) => !m.isUpscaler),
    'video-from-image': videos.filter((m) => m.supportsFrameImages && !m.isUpscaler),
    'video-upscale': videos.filter((m) => m.isUpscaler),
    speech: simple(speech, speechParams),
    transcribe: simple(transcription, transcribeParams),
    audio: simple(audio, () => []),
  };

  return { fetchedAt: Date.now(), models };
}

// ---------------------------------------------------------------------------
// Generation calls
// ---------------------------------------------------------------------------

export interface ImageResult {
  images: { base64: string; mediaType: string }[];
  cost?: number;
}

export async function createImages(key: string, body: Record<string, unknown>): Promise<ImageResult> {
  const res = await post('/images', key, body);
  const data = Array.isArray(res?.data) ? res.data : [];
  return {
    images: data
      .filter((d: any) => typeof d?.b64_json === 'string')
      .map((d: any) => ({ base64: d.b64_json as string, mediaType: d.media_type ?? 'image/png' })),
    cost: typeof res?.usage?.cost === 'number' ? res.usage.cost : undefined,
  };
}

export async function createVideo(key: string, body: Record<string, unknown>): Promise<{ id: string; status: string }> {
  const res = await post('/videos', key, body);
  if (!res?.id) throw new OpenRouterError('Il servizio non ha restituito un id di lavorazione', 502);
  return { id: String(res.id), status: String(res.status ?? 'pending') };
}

export interface VideoPoll {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  urls: string[];
  cost?: number;
  error?: string;
}

export async function pollVideo(key: string, jobId: string): Promise<VideoPoll> {
  const res = await get(`/videos/${encodeURIComponent(jobId)}`, key);
  return {
    status: String(res?.status ?? 'pending') as VideoPoll['status'],
    urls: Array.isArray(res?.unsigned_urls) ? res.unsigned_urls.map(String) : [],
    cost: typeof res?.usage?.cost === 'number' ? res.usage.cost : undefined,
    error: typeof res?.error === 'string' ? res.error : res?.error?.message,
  };
}

export async function fetchVideoContent(
  key: string,
  jobId: string,
  index: number,
): Promise<{ bytes: Buffer; mediaType: string }> {
  return getBytes(`${BASE}/videos/${encodeURIComponent(jobId)}/content?index=${index}`, key);
}

export async function createSpeech(
  key: string,
  body: Record<string, unknown>,
): Promise<{ bytes: Buffer; mediaType: string }> {
  return postBytes('/audio/speech', key, body);
}

export interface TranscriptionResult {
  text: string;
  raw: unknown;
  cost?: number;
}

export async function createTranscription(key: string, body: Record<string, unknown>): Promise<TranscriptionResult> {
  const res = await post('/audio/transcriptions', key, body);
  return {
    text: String(res?.text ?? ''),
    raw: res,
    cost: typeof res?.usage?.cost === 'number' ? res.usage.cost : undefined,
  };
}

export interface ChatAudioResult {
  audio?: { base64: string; format: string };
  text: string;
  cost?: number;
}

/** Music and sound-effect models are served through chat completions. */
export async function createChatAudio(key: string, body: Record<string, unknown>): Promise<ChatAudioResult> {
  const res = await post('/chat/completions', key, body);
  const message = res?.choices?.[0]?.message ?? {};
  return {
    audio: message.audio?.data
      ? { base64: String(message.audio.data), format: String(message.audio.format ?? 'mp3') }
      : undefined,
    text: typeof message.content === 'string' ? message.content : '',
    cost: typeof res?.usage?.cost === 'number' ? res.usage.cost : undefined,
  };
}
