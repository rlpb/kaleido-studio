import type { ModeDef, ModeId } from './types';

/**
 * The eight studio modes. Each one pins an OpenRouter endpoint and the shape of
 * input it needs; everything else about a run comes from the model's own
 * capability metadata.
 */
export const MODES: ModeDef[] = [
  {
    id: 'image',
    label: 'Images',
    hint: 'Generate images from a text description',
    endpoint: 'images',
    outputKind: 'image',
    needsInput: false,
  },
  {
    id: 'image-edit',
    label: 'Edit images',
    hint: 'Start from one or more images and transform them with a prompt',
    endpoint: 'images',
    outputKind: 'image',
    needsInput: { kind: 'image', label: 'Reference images', min: 1, max: 10 },
  },
  {
    id: 'video',
    label: 'Text to video',
    hint: 'Generate a video from a prompt alone',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: false,
  },
  {
    id: 'video-from-image',
    label: 'Image to video',
    hint: 'Animate an opening frame, and optionally a closing one',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: { kind: 'image', label: 'Frames', min: 1, max: 2 },
  },
  {
    id: 'video-upscale',
    label: 'Upscale video',
    hint: 'Raise the resolution and detail of an existing video',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: { kind: 'video', label: 'Source video', min: 1, max: 1 },
  },
  {
    id: 'speech',
    label: 'Speech',
    hint: 'Turn text into spoken audio with a selectable voice',
    endpoint: 'speech',
    outputKind: 'audio',
    needsInput: false,
  },
  {
    id: 'audio',
    label: 'Music and audio',
    hint: 'Generate music or sound effects from a description',
    endpoint: 'chat',
    outputKind: 'audio',
    needsInput: false,
  },
  {
    id: 'transcribe',
    label: 'Transcription',
    hint: 'Turn an audio file into text, with optional timestamps',
    endpoint: 'transcriptions',
    outputKind: 'text',
    needsInput: { kind: 'audio', label: 'Audio file', min: 1, max: 1 },
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

/** The prompt is the payload for these modes, so an empty one is a hard stop. */
export const PROMPT_REQUIRED: ModeId[] = ['image', 'image-edit', 'video', 'speech', 'audio'];
