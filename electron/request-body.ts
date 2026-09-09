/**
 * Turns a JobRequest into the body each OpenRouter endpoint expects.
 *
 * Kept out of the runner so the shapes can be exercised without Electron: a
 * malformed body produces a plausible result rather than an error, which is the
 * hardest kind of defect to notice from the outside.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { JobRequest } from '../src/lib/types';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

export function mimeOf(file: string): string {
  return MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** Local paths become data URLs; anything already remote is passed through. */
export function toUrl(input: string): string {
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return input;
  const bytes = fs.readFileSync(input);
  return `data:${mimeOf(input)};base64,${bytes.toString('base64')}`;
}

function audioPartOf(input: string): { data: string; format: string } {
  const bytes = fs.readFileSync(input);
  const format = path.extname(input).slice(1).toLowerCase() || 'wav';
  return { data: bytes.toString('base64'), format };
}

/** Drops empty strings so an untouched optional field is never sent. */
function clean(params: Record<string, string | number | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === undefined || value === null) continue;
    out[key] = value;
  }
  return out;
}

const asInt = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export function buildImageBody(req: JobRequest): Record<string, unknown> {
  const p = clean(req.params);
  const body: Record<string, unknown> = { model: req.modelId, prompt: req.prompt };
  for (const key of ['aspect_ratio', 'resolution', 'size', 'quality', 'output_format', 'background']) {
    if (p[key] !== undefined) body[key] = p[key];
  }
  if (p.n !== undefined) body.n = asInt(p.n);
  if (p.output_compression !== undefined) body.output_compression = asInt(p.output_compression);
  if (p.seed !== undefined) body.seed = asInt(p.seed);
  if (req.inputs.length) {
    body.input_references = req.inputs.map((input) => ({
      type: 'image_url',
      image_url: { url: toUrl(input) },
    }));
  }
  return body;
}

export function buildVideoBody(req: JobRequest): Record<string, unknown> {
  const p = clean(req.params);
  const body: Record<string, unknown> = { model: req.modelId };
  if (req.prompt.trim()) body.prompt = req.prompt;
  for (const key of ['resolution', 'aspect_ratio', 'size']) {
    if (p[key] !== undefined) body[key] = p[key];
  }
  if (p.duration !== undefined) body.duration = asInt(p.duration);
  if (p.seed !== undefined) body.seed = asInt(p.seed);
  if (p.creativity !== undefined) body.creativity = asInt(p.creativity);
  if (p.upscale_factor !== undefined) body.upscale_factor = Number(p.upscale_factor);
  if (p.generate_audio !== undefined) body.generate_audio = Boolean(p.generate_audio);

  if (req.mode === 'video-from-image' && req.inputs.length) {
    // First selected image is the opening frame, an optional second closes it.
    body.frame_images = req.inputs.slice(0, 2).map((input, i) => ({
      type: 'image_url',
      image_url: { url: toUrl(input) },
      frame_type: i === 0 ? 'first_frame' : 'last_frame',
    }));
  } else if (req.inputs.length) {
    body.input_references = req.inputs.map((input) => {
      const isVideo = mimeOf(input).startsWith('video/');
      return isVideo
        ? { type: 'video_url', video_url: { url: toUrl(input) } }
        : { type: 'image_url', image_url: { url: toUrl(input) } };
    });
  }
  return body;
}

export function buildSpeechBody(req: JobRequest): Record<string, unknown> {
  const p = clean(req.params);
  const body: Record<string, unknown> = { model: req.modelId, input: req.prompt };
  if (p.voice !== undefined) body.voice = p.voice;
  if (p.response_format !== undefined) body.response_format = p.response_format;
  if (p.speed !== undefined && Number(p.speed) !== 1) body.speed = Number(p.speed);
  if (req.inputs.length) {
    // A voice sample enables stateless cloning on models that support it.
    body.input_references = [{ type: 'input_audio', input_audio: { data: toUrl(req.inputs[0]) } }];
  }
  return body;
}

export function buildTranscriptionBody(req: JobRequest): Record<string, unknown> {
  const p = clean(req.params);
  const wantsWords = p.word_timestamps === true;
  const body: Record<string, unknown> = {
    model: req.modelId,
    input_audio: audioPartOf(req.inputs[0]),
  };
  if (p.language) body.language = p.language;
  if (p.temperature !== undefined) body.temperature = Number(p.temperature);
  // Word timestamps only exist inside verbose_json, so asking for them selects it.
  const format = wantsWords ? 'verbose_json' : (p.response_format as string | undefined);
  if (format) body.response_format = format;
  if (wantsWords) body.timestamp_granularities = ['segment', 'word'];
  return body;
}

export function buildChatAudioBody(req: JobRequest): Record<string, unknown> {
  return {
    model: req.modelId,
    modalities: ['text', 'audio'],
    messages: [{ role: 'user', content: req.prompt }],
  };
}
