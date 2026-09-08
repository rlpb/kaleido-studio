import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Job, JobRequest, LibraryItem, MediaKind, ModeId } from '../src/lib/types';
import { MODE_BY_ID } from '../src/lib/modes';
import { costKeyFor } from '../src/lib/pricing';
import * as api from './openrouter';
import { getKey, getSettings, pushPrompt, recordCost } from './store';
import { saveOutput } from './library';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

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

function mimeOf(file: string): string {
  return MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream';
}

/** Local paths become data URLs; anything already remote is passed through. */
function toUrl(input: string): string {
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

function buildImageBody(req: JobRequest): Record<string, unknown> {
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

function buildVideoBody(req: JobRequest): Record<string, unknown> {
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

function buildSpeechBody(req: JobRequest): Record<string, unknown> {
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

function buildTranscriptionBody(req: JobRequest): Record<string, unknown> {
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

function buildChatAudioBody(req: JobRequest): Record<string, unknown> {
  return {
    model: req.modelId,
    modalities: ['text', 'audio'],
    messages: [{ role: 'user', content: req.prompt }],
  };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

type Emit = (job: Job) => void;

export class JobRunner {
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private running = new Set<string>();
  private cancelled = new Set<string>();
  private window: BrowserWindow | null = null;

  attach(window: BrowserWindow): void {
    this.window = window;
  }

  private emit: Emit = (job) => {
    this.jobs.set(job.id, job);
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('job:update', job);
    }
  };

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') this.jobs.delete(id);
    }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'error') return;
    this.cancelled.add(id);
    this.queue = this.queue.filter((q) => q !== id);
    this.emit({ ...job, status: 'cancelled', progress: 'Annullato', finishedAt: Date.now() });
  }

  /** Enqueues one job per requested batch item and starts as many as allowed. */
  enqueue(req: JobRequest, modelName: string): Job[] {
    const created: Job[] = [];
    for (let i = 0; i < Math.max(1, req.batch); i += 1) {
      const job: Job = {
        id: randomUUID(),
        mode: req.mode,
        modelId: req.modelId,
        modelName,
        prompt: req.prompt,
        params: req.params,
        inputs: req.inputs,
        status: 'queued',
        progress: 'In coda',
        createdAt: Date.now() + i,
        outputs: [],
      };
      this.emit(job);
      this.queue.push(job.id);
      created.push(job);
    }
    if (req.prompt.trim()) pushPrompt(req.prompt);
    this.pump();
    return created;
  }

  private pump(): void {
    const limit = getSettings().concurrency;
    while (this.running.size < limit && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) break;
      if (this.cancelled.has(id)) continue;
      this.running.add(id);
      void this.run(id).finally(() => {
        this.running.delete(id);
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    const key = getKey();
    if (!key) {
      this.emit({ ...job, status: 'error', error: 'Nessuna chiave API configurata', finishedAt: Date.now() });
      return;
    }

    this.emit({ ...job, status: 'running', progress: 'Invio richiesta' });
    try {
      const req: JobRequest = {
        mode: job.mode,
        modelId: job.modelId,
        prompt: job.prompt,
        params: job.params,
        inputs: job.inputs,
        batch: 1,
      };
      const items = await this.execute(job, req, key);
      if (this.cancelled.has(id)) return;

      const cost = items.reduce((sum, item) => sum + (item.cost ?? 0), 0);
      if (cost > 0) recordCost(costKeyFor(job.modelId, job.params), cost);

      this.emit({
        ...this.jobs.get(id)!,
        status: 'done',
        progress: 'Completato',
        finishedAt: Date.now(),
        cost: cost > 0 ? cost : undefined,
        outputs: items.map((item) => ({
          path: item.path,
          kind: item.kind,
          mediaType: item.mediaType,
          text: item.text,
        })),
      });
    } catch (err) {
      if (this.cancelled.has(id)) return;
      this.emit({
        ...this.jobs.get(id)!,
        status: 'error',
        progress: 'Errore',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private progress(id: string, text: string): void {
    const job = this.jobs.get(id);
    if (job) this.emit({ ...job, progress: text });
  }

  private store(job: Job, kind: MediaKind, mediaType: string, bytes: Buffer, cost?: number, text?: string): LibraryItem {
    return saveOutput({
      jobId: job.id,
      mode: job.mode,
      modelId: job.modelId,
      modelName: job.modelName,
      prompt: job.prompt,
      params: job.params,
      kind,
      mediaType,
      bytes,
      text,
      cost,
    });
  }

  private async execute(job: Job, req: JobRequest, key: string): Promise<LibraryItem[]> {
    const endpoint = MODE_BY_ID[job.mode as ModeId].endpoint;

    if (endpoint === 'images') {
      const result = await api.createImages(key, buildImageBody(req));
      if (!result.images.length) throw new Error('Il modello non ha restituito immagini');
      // A multi-image response bills once, so the cost rides on the first file.
      return result.images.map((img, i) =>
        this.store(job, 'image', img.mediaType, Buffer.from(img.base64, 'base64'), i === 0 ? result.cost : undefined),
      );
    }

    if (endpoint === 'videos') {
      const handle = await api.createVideo(key, buildVideoBody(req));
      this.progress(job.id, 'In lavorazione sul provider');
      const started = Date.now();
      let poll = await api.pollVideo(key, handle.id);

      while (poll.status === 'pending' || poll.status === 'in_progress') {
        if (this.cancelled.has(job.id)) return [];
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          throw new Error('Tempo scaduto: il provider non ha completato il video entro 20 minuti');
        }
        const elapsed = Math.round((Date.now() - started) / 1000);
        this.progress(job.id, `In lavorazione da ${elapsed}s`);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        poll = await api.pollVideo(key, handle.id);
      }

      if (poll.status === 'failed') throw new Error(poll.error ?? 'Generazione del video fallita');

      this.progress(job.id, 'Scarico il video');
      const count = Math.max(1, poll.urls.length);
      const items: LibraryItem[] = [];
      for (let i = 0; i < count; i += 1) {
        const { bytes, mediaType } = await api.fetchVideoContent(key, handle.id, i);
        items.push(this.store(job, 'video', mediaType, bytes, i === 0 ? poll.cost : undefined));
      }
      return items;
    }

    if (endpoint === 'speech') {
      const { bytes, mediaType } = await api.createSpeech(key, buildSpeechBody(req));
      return [this.store(job, 'audio', mediaType, bytes)];
    }

    if (endpoint === 'transcriptions') {
      const result = await api.createTranscription(key, buildTranscriptionBody(req));
      const pretty =
        req.params.response_format === 'verbose_json' || req.params.word_timestamps === true
          ? JSON.stringify(result.raw, null, 2)
          : result.text;
      return [this.store(job, 'text', 'text/plain', Buffer.from(pretty, 'utf8'), result.cost, result.text)];
    }

    const result = await api.createChatAudio(key, buildChatAudioBody(req));
    if (!result.audio) throw new Error(result.text || 'Il modello non ha restituito audio');
    return [
      this.store(
        job,
        'audio',
        `audio/${result.audio.format}`,
        Buffer.from(result.audio.base64, 'base64'),
        result.cost,
        result.text || undefined,
      ),
    ];
  }
}

export const runner = new JobRunner();
