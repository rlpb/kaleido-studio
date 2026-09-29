import path from 'node:path';
import type { MediaKind } from '../src/lib/types';

/**
 * The media types the library knows how to save, and the extension each gets.
 *
 * The extension is chosen from this table and from nowhere else. It used to fall
 * back to the raw subtype of whatever media type the provider declared, so a
 * response claiming `application/bat` was saved as a .bat file inside the
 * library, one click from being run by "open in the default app". The type is
 * the provider's claim, not the app's decision, and a claim does not get to
 * name an executable extension.
 */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/pcm': 'pcm',
  'text/plain': 'txt',
};

/** What a file gets when its declared type is not in the table. */
const FALLBACK: Record<MediaKind, string> = { image: 'png', video: 'mp4', audio: 'mp3', text: 'txt' };

export function extensionFor(mediaType: string, kind: MediaKind): string {
  const clean = mediaType.split(';')[0].trim().toLowerCase();
  return EXTENSIONS[clean] ?? FALLBACK[kind];
}

const OPENABLE = new Set([...Object.values(EXTENSIONS), ...Object.values(FALLBACK)].map((ext) => `.${ext}`));

/**
 * Whether handing this file to the operating system's default handler is safe.
 * Only what the library itself can have written qualifies; anything else, an
 * executable above all, is refused however it got there.
 */
export function isOpenable(file: string): boolean {
  return OPENABLE.has(path.extname(file).toLowerCase());
}
