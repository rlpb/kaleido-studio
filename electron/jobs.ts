import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { Job, JobRequest, LibraryItem, MediaKind, ModeId } from '../src/lib/types';
import { MODE_BY_ID } from '../src/lib/modes';
import { costKeyFor } from '../src/lib/pricing';
import * as api from './openrouter';
import { getKey, getSettings, pushPrompt, recordCost } from './store';
import { saveOutput } from './library';
import {
  buildChatAudioBody,
  buildImageBody,
  buildSpeechBody,
  buildTranscriptionBody,
  buildVideoBody,
} from './request-body';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

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

  /**
   * Sends the whole list, for changes a per-job update cannot express.
   * Removing a job emits nothing on the job:update channel, so without this the
   * renderer keeps showing entries the runner has already dropped.
   */
  private broadcast(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('job:list', this.list());
    }
  }

  clearFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') this.jobs.delete(id);
    }
    this.broadcast();
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'error') return;
    this.cancelled.add(id);
    this.queue = this.queue.filter((q) => q !== id);
    this.emit({ ...job, status: 'cancelled', progressKey: 'progress.cancelled', finishedAt: Date.now() });
  }

  /**
   * Re-runs a finished job with the identical configuration. Transport failures
   * are retried on purpose rather than automatically: a socket that died after
   * the request was accepted may already have been billed, so repeating the
   * spend stays the user's decision.
   */
  retry(id: string): Job | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    this.jobs.delete(id);
    this.cancelled.delete(id);
    this.broadcast();
    const [created] = this.enqueue(
      { mode: job.mode, modelId: job.modelId, prompt: job.prompt, params: job.params, inputs: job.inputs, batch: 1 },
      job.modelName,
    );
    return created ?? null;
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
        progressKey: 'progress.queued',
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
      this.emit({ ...job, status: 'error', progressKey: 'progress.failed', error: 'No API key configured', finishedAt: Date.now() });
      return;
    }

    // Timed from here, not from enqueue: waiting in the queue is not the model
    // taking its time, and a batch of eight would otherwise report the last one
    // as having taken as long as the whole batch.
    this.emit({ ...job, status: 'running', progressKey: 'progress.sending', startedAt: Date.now() });
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
        progressKey: 'progress.done',
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
        progressKey: 'progress.failed',
        finishedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private progress(id: string, key: Job['progressKey'], vars?: Job['progressVars']): void {
    const job = this.jobs.get(id);
    if (job) this.emit({ ...job, progressKey: key, progressVars: vars });
  }

  private store(job: Job, kind: MediaKind, mediaType: string, bytes: Buffer, cost?: number, text?: string): LibraryItem {
    // Read back from the map rather than from the captured job: startedAt is
    // stamped on the emitted copy, and the argument here predates it.
    const startedAt = this.jobs.get(job.id)?.startedAt;
    return saveOutput({
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      // Recorded so a result that ignored its reference can be told apart from a
      // run that never carried one.
      inputs: job.inputs,
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
      if (!result.images.length) throw new Error('The model returned no images');
      // A multi-image response bills once, so the cost rides on the first file.
      return result.images.map((img, i) =>
        this.store(job, 'image', img.mediaType, Buffer.from(img.base64, 'base64'), i === 0 ? result.cost : undefined),
      );
    }

    if (endpoint === 'videos') {
      const handle = await api.createVideo(key, buildVideoBody(req));
      this.progress(job.id, 'progress.working');
      const started = Date.now();
      let poll = await api.pollVideo(key, handle.id);

      while (poll.status === 'pending' || poll.status === 'in_progress') {
        if (this.cancelled.has(job.id)) return [];
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          throw new Error('Timed out: the provider did not finish the video within 20 minutes');
        }
        const elapsed = Math.round((Date.now() - started) / 1000);
        this.progress(job.id, 'progress.workingFor', { seconds: elapsed });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        poll = await api.pollVideo(key, handle.id);
      }

      if (poll.status === 'failed') throw new Error(poll.error ?? 'Video generation failed');

      this.progress(job.id, 'progress.downloading');
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
    if (!result.audio) throw new Error(result.text || 'The model returned no audio')
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
