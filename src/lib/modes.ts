import type { ModeDef, ModeId } from './types';

/**
 * The eight studio modes. Each one pins an OpenRouter endpoint and the shape of
 * input it needs; everything else about a run comes from the model's own
 * capability metadata.
 */
export const MODES: ModeDef[] = [
  {
    id: 'image',
    label: 'Immagini',
    hint: 'Genera immagini da una descrizione testuale',
    endpoint: 'images',
    outputKind: 'image',
    needsInput: false,
  },
  {
    id: 'image-edit',
    label: 'Modifica immagini',
    hint: 'Parti da una o più immagini e trasformale col prompt',
    endpoint: 'images',
    outputKind: 'image',
    needsInput: { kind: 'image', label: 'Immagini di riferimento', min: 1, max: 10 },
  },
  {
    id: 'video',
    label: 'Video da testo',
    hint: 'Genera un video partendo solo dal prompt',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: false,
  },
  {
    id: 'video-from-image',
    label: 'Video da immagine',
    hint: 'Anima un fotogramma iniziale, e volendo anche finale',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: { kind: 'image', label: 'Fotogrammi', min: 1, max: 2 },
  },
  {
    id: 'video-upscale',
    label: 'Migliora video',
    hint: 'Alza risoluzione e dettaglio di un video esistente',
    endpoint: 'videos',
    outputKind: 'video',
    needsInput: { kind: 'video', label: 'Video di partenza', min: 1, max: 1 },
  },
  {
    id: 'speech',
    label: 'Voce',
    hint: 'Trasforma il testo in parlato, con voce selezionabile',
    endpoint: 'speech',
    outputKind: 'audio',
    needsInput: false,
  },
  {
    id: 'audio',
    label: 'Musica e audio',
    hint: 'Genera musica o effetti sonori da una descrizione',
    endpoint: 'chat',
    outputKind: 'audio',
    needsInput: false,
  },
  {
    id: 'transcribe',
    label: 'Trascrizione',
    hint: 'Converti un file audio in testo, con timestamp opzionali',
    endpoint: 'transcriptions',
    outputKind: 'text',
    needsInput: { kind: 'audio', label: 'File audio', min: 1, max: 1 },
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

/** The prompt is the payload for these modes, so an empty one is a hard stop. */
export const PROMPT_REQUIRED: ModeId[] = ['image', 'image-edit', 'video', 'speech', 'audio'];
