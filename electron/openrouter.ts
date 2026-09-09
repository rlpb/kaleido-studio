import type { Catalog, KeyStatus, ModelInfo, ModeId, ParamSpec, PriceModel } from '../src/lib/types';
import { keepAliveRequest, type KeepAliveResponse } from './keepalive-request';

const BASE = 'https://openrouter.ai/api/v1';
const APP_HEADERS = {
  'HTTP-Referer': 'https://github.com/rlpb/kaleido-studio',
  'X-Title': 'Kaleido Studio',
};

/** Catalog reads are quick; generation holds the connection while the model works. */
const CATALOG_TIMEOUT_MS = 60_000;
const GENERATION_TIMEOUT_MS = 10 * 60_000;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/**
 * Lets the main process swap in Electron's net.fetch, which runs on Chromium's
 * network stack: it follows the system proxy and certificate store, and enables
 * TCP keep-alive on its sockets, so a connection held open while a model works
 * is less likely to be dropped by a NAT or middlebox timeout. The default stays
 * the global fetch so this module still runs under plain Node in the checks.
 */
export function setFetch(impl: FetchLike): void {
  fetchImpl = impl;
}

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

/**
 * A transport failure, as opposed to a request the server answered and rejected.
 *
 * `fetch` reports every one of these as the same opaque "fetch failed", and puts
 * the reason that actually identifies the problem in a nested `cause`. Reporting
 * the message alone tells the user nothing and tells a bug report even less, so
 * the chain is unwound here into something nameable.
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Walks the cause chain and collects every error code and message in it. */
function describeCause(err: unknown): string {
  const parts: string[] = [];
  let current: any = err;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = current.code ?? current.errno;
    if (code) parts.push(String(code));
    else if (current.message && current.message !== 'fetch failed') parts.push(String(current.message));
    current = current.cause;
  }
  return parts.join(' <- ');
}

const NETWORK_HINTS: Record<string, string> = {
  ENOTFOUND: 'openrouter.ai could not be resolved. Check the DNS settings or the connection.',
  EAI_AGAIN: 'DNS lookup for openrouter.ai timed out. The connection may be down.',
  ECONNREFUSED: 'The connection was refused, which usually means a proxy or firewall blocked it.',
  ECONNRESET: 'The connection was closed mid-request, often by a proxy, a VPN or antivirus TLS inspection.',
  ETIMEDOUT: 'The connection timed out before the server answered.',
  EPROTO: 'The TLS handshake failed. A proxy or antivirus intercepting HTTPS is the usual cause.',
  CERT_HAS_EXPIRED: 'The TLS certificate was rejected, which points at an intercepting proxy.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The TLS certificate could not be verified, which points at an intercepting proxy.',
  UND_ERR_CONNECT_TIMEOUT: 'Opening the connection to openrouter.ai timed out.',
  UND_ERR_HEADERS_TIMEOUT: 'The server accepted the request but sent no response in time.',
  UND_ERR_SOCKET: 'The socket closed unexpectedly, often a proxy or VPN cutting the connection.',
};

function networkError(err: unknown, timeoutMs: number, elapsedMs: number): NetworkError {
  // How long the connection survived separates a request that was refused up
  // front from one that was cut while the model was still working.
  const elapsed = elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;
  if (err instanceof Error && err.name === 'TimeoutError') {
    const seconds = Math.round(timeoutMs / 1000);
    return new NetworkError(`The request timed out after ${seconds}s without a response.`, 'TimeoutError');
  }
  const detail = describeCause(err) || 'unknown cause';
  const hint = Object.keys(NETWORK_HINTS).find((code) => detail.includes(code));
  let explanation = hint ? NETWORK_HINTS[hint] : 'The request never reached OpenRouter.';

  // A connection that dies around the minute mark, while the model is still
  // working and nothing is flowing over the socket, hit a timeout somewhere on
  // the path. Which end owns that rule is not knowable from here, so both
  // candidates are named rather than one of them asserted.
  if (elapsedMs >= 50_000 && elapsedMs <= 75_000) {
    explanation =
      'The connection was cut after about a minute, while the model was still working and nothing was ' +
      'flowing over it. Requests that stay silent that long hit an idle timeout somewhere on the path. ' +
      'Two things are worth trying, in this order: pick a model that answers faster, since a provider ' +
      'slower than the gateway limit fails this way every time; and if you are on a VPN or behind a ' +
      'corporate proxy, try the same run without it.';
  }
  return new NetworkError(`${explanation} Died after ${elapsed}. (${detail})`, detail);
}

function headers(key: string | null, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...APP_HEADERS, ...extra };
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

/** Every request goes through here so no transport failure is reported bare. */
async function send(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const started = Date.now();
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw networkError(err, timeoutMs, Date.now() - started);
  }
}

/**
 * OpenRouter reports some failures as {error:{message,code}} in the body, so the
 * payload is inspected even when the HTTP status looks fine.
 */
async function readJson(res: Response): Promise<any> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // The connection can still drop while the body streams in, which is a
    // different failure from one that never got a response at all.
    throw new NetworkError(
      `The connection dropped while the response was still downloading. (${describeCause(err) || 'unknown cause'})`,
      describeCause(err),
    );
  }

  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new OpenRouterError(res.ok ? 'The response was not valid JSON.' : text.slice(0, 400), res.status);
    }
  }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ?? body?.detail ?? res.statusText ?? 'The request failed.';
    throw new OpenRouterError(String(msg), res.status, body?.error?.code);
  }
  return body;
}

async function get(path: string, key: string | null): Promise<any> {
  return readJson(await send(`${BASE}${path}`, { headers: headers(key) }, CATALOG_TIMEOUT_MS));
}

async function post(path: string, key: string, body: unknown): Promise<any> {
  const res = await send(
    `${BASE}${path}`,
    { method: 'POST', headers: headers(key, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) },
    GENERATION_TIMEOUT_MS,
  );
  return readJson(res);
}

/**
 * The same POST, on the socket-level path that emits TCP keep-alive probes.
 *
 * Reserved for the synchronous generation endpoints, the ones that stay silent
 * for as long as the model works. Catalog reads answer in under a second and
 * gain nothing from it.
 */
async function postLong(path: string, key: string, body: unknown): Promise<KeepAliveResponse> {
  const started = Date.now();
  const payload = JSON.stringify(body);
  try {
    return await keepAliveRequest(`${BASE}${path}`, {
      method: 'POST',
      headers: headers(key, {
        'Content-Type': 'application/json',
        // Declared rather than left to chunked transfer encoding. An image edit
        // carries the reference as a base64 data URL, so it is the one request
        // here that runs to megabytes, and a length the server can check beats a
        // stream it has to reassemble.
        'Content-Length': String(Buffer.byteLength(payload)),
      }),
      body: payload,
      timeoutMs: GENERATION_TIMEOUT_MS,
    });
  } catch (err) {
    throw networkError(err, GENERATION_TIMEOUT_MS, Date.now() - started);
  }
}

/** Applies the same body-and-status handling readJson does, to a raw response. */
function parseLong(res: KeepAliveResponse): any {
  const text = res.body.toString('utf8');
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new OpenRouterError(res.status < 400 ? 'The response was not valid JSON.' : text.slice(0, 400), res.status);
    }
  }
  if (res.status >= 400 || body?.error) {
    const msg = body?.error?.message ?? body?.detail ?? 'The request failed.';
    throw new OpenRouterError(String(msg), res.status, body?.error?.code);
  }
  return body;
}

export async function getBytes(url: string, key: string): Promise<{ bytes: Buffer; mediaType: string }> {
  const res = await send(url, { headers: headers(key) }, GENERATION_TIMEOUT_MS);
  if (!res.ok) throw new OpenRouterError(`Download failed (${res.status}).`, res.status);
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
  aspect_ratio: 'Aspect ratio',
  resolution: 'Resolution',
  size: 'Size',
  quality: 'Quality',
  output_format: 'File format',
  output_compression: 'Compression',
  background: 'Background',
  n: 'Images per request',
  seed: 'Seed',
  duration: 'Duration (seconds)',
  generate_audio: 'Generate audio',
  upscale_factor: 'Upscale factor',
  creativity: 'Creativity',
  voice: 'Voice',
  speed: 'Speed',
  response_format: 'Response format',
  language: 'Language',
  temperature: 'Temperature',
  word_timestamps: 'Word-level timestamps',
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

/**
 * `pricing.prompt` carries two different units and the catalog never says which.
 * A model with a token context is billed per token: openai/gpt-4o-mini-transcribe
 * declares 128000 and lists 0.00000125, which is OpenAI's published $1.25 per
 * million tokens. A model with `context_length: 0` is billed by something else
 * entirely: microsoft/mai-transcribe-2 declares 0 and lists 0.1, which
 * OpenRouter's own model page labels "Audio Hours … /hour". Reading the second
 * one as a token rate is how $0.10 per hour of audio came to be displayed as
 * $100000 per million tokens.
 *
 * No documented route publishes the unit. `/api/v1/models`, the `/endpoints`
 * route and `?include=display_pricing` all omit it; only the website's own
 * embedded JSON carries `display_pricing[].unitLabel`. So the rate is shown
 * without a unit rather than under an invented one.
 *
 * `pricing.image` is deliberately ignored for the same reason: it reads as a
 * flat per-image price on bytedance-seed/seedream-5-0-pro ($0.003) and as
 * something else entirely on google/gemini-3-pro-image ($0.000002, against a
 * real price around $0.13 an image).
 */
function priceFromModelEntry(
  pricing: Record<string, string> | undefined,
  modelId = '',
  contextLength = 0,
): PriceModel {
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const price: PriceModel = {
    unpublished: false,
    perInputToken: num(pricing?.prompt),
    perOutputToken: num(pricing?.completion),
    perImageToken: num(pricing?.image_output),
    perAudioInputToken: num(pricing?.audio),
    perAudioOutputToken: num(pricing?.audio_output),
    // Image-token fields name their own unit, so they are per token whatever the
    // context length says. Only prompt and completion need the gate.
    tokenBilled: Number(contextLength) > 0,
    free: false,
  };
  // Free is a claim about billing, and the only thing that supports it is the
  // ":free" suffix OpenRouter puts on its free tier. Everything at zero without
  // that suffix is a price the catalog did not publish, which is a different
  // statement and, as lyria-3-pro-preview shows, sometimes a paid one.
  const allZero =
    !price.perInputToken && !price.perOutputToken && !price.perImageToken && !price.perAudioOutputToken;
  price.free = modelId.endsWith(':free');
  price.unpublished = allZero && !price.free;
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
      const min = Number(spec.min ?? 0);
      const max = Number(spec.max ?? 1);
      // A range with a single admissible value is a control nobody can move.
      if (min >= max) continue;
      params.push({ key, label: label(key), kind: 'int', min, max });
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
      help: 'Cost scales directly with duration.',
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
      help: 'The same seed and prompt reproduce the same result.',
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
  const known = Object.keys(perVideoSecond).length > 0;
  // Video SKUs name their unit in the key itself, so there is no token rate to
  // qualify here.
  return { perVideoSecond, free: false, unpublished: !known, tokenBilled: false };
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
    help: 'Applied only by models that support it, ignored by the rest.',
  });
  return params;
}

function transcribeParams(): ParamSpec[] {
  return [
    {
      key: 'language',
      label: label('language'),
      kind: 'text',
      placeholder: 'en, it, ja… (empty means auto-detect)',
      // The help said the same thing right underneath; the placeholder is enough.
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
      help: 'Requires the verbose_json format and an OpenAI-compatible provider.',
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
      price: priceFromModelEntry(priced?.pricing, entry.id, priced?.context_length),
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
      price: priceFromModelEntry(entry.pricing, entry.id, entry.context_length),
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
  const res = parseLong(await postLong('/images', key, body));
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
  if (!res?.id) throw new OpenRouterError('The service returned no job id.', 502);
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
  const res = await postLong('/audio/speech', key, body);
  const mediaType = String(res.headers['content-type'] ?? 'application/octet-stream');
  if (res.status >= 400 || mediaType.includes('application/json')) {
    parseLong(res); // throws with the provider's own message
    throw new OpenRouterError('The speech endpoint returned no audio.', 502);
  }
  return { bytes: res.body, mediaType };
}

export interface TranscriptionResult {
  text: string;
  raw: unknown;
  cost?: number;
}

export async function createTranscription(key: string, body: Record<string, unknown>): Promise<TranscriptionResult> {
  const res = parseLong(await postLong('/audio/transcriptions', key, body));
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

/**
 * Music and sound-effect models are served through chat completions, and the
 * providers behind them refuse audio output unless the response is streamed:
 * a non-streamed request comes back as "Audio output requires stream: true".
 * So the stream is read here and reassembled into one file.
 *
 * Chunks are decoded before being joined rather than concatenated as base64,
 * because a base64 chunk that is not a multiple of three bytes carries padding
 * that would corrupt everything after it.
 */
export async function createChatAudio(key: string, body: Record<string, unknown>): Promise<ChatAudioResult> {
  const res = await send(
    `${BASE}/chat/completions`,
    {
      method: 'POST',
      headers: headers(key, { 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    },
    GENERATION_TIMEOUT_MS,
  );

  if (!res.ok) {
    // An error still arrives as a normal JSON body, not as an event stream.
    const text = await res.text();
    let message = text.slice(0, 400);
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {
      /* the raw text is the best message available */
    }
    throw new OpenRouterError(String(message), res.status);
  }
  if (!res.body) throw new OpenRouterError('The response carried no stream.', 502);

  const chunks: Buffer[] = [];
  let format = 'mp3';
  let text = '';
  let cost: number | undefined;
  let streamError: string | undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; keep the trailing partial one.
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      for (const line of event.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // keep-alive comments and partial frames are not fatal
        }

        if (parsed?.error) streamError = parsed.error.message ?? String(parsed.error);
        if (typeof parsed?.usage?.cost === 'number') cost = parsed.usage.cost;

        const delta = parsed?.choices?.[0]?.delta ?? {};
        if (typeof delta.content === 'string') text += delta.content;
        const audio = delta.audio ?? parsed?.choices?.[0]?.message?.audio;
        if (audio?.data) {
          chunks.push(Buffer.from(String(audio.data), 'base64'));
          if (audio.format) format = String(audio.format);
        }
        if (typeof audio?.transcript === 'string') text += audio.transcript;
      }
    }
  }

  if (streamError) throw new OpenRouterError(streamError, 502);

  const merged = Buffer.concat(chunks);
  return {
    audio: merged.length ? { base64: merged.toString('base64'), format } : undefined,
    text,
    cost,
  };
}
