/**
 * The icon set, drawn as inline SVG on a 24-unit grid.
 *
 * These used to be Unicode glyphs. Glyph coverage differs per platform and per
 * installed font, so the same character rendered as a different shape, a
 * different weight, or a fallback box depending on the machine. Paths render
 * identically everywhere and inherit `currentColor`.
 */

export type IconName =
  | 'image'
  | 'imageEdit'
  | 'video'
  | 'imageToVideo'
  | 'upscale'
  | 'speech'
  | 'music'
  | 'transcript'
  | 'library'
  | 'settings'
  | 'search'
  | 'star'
  | 'download'
  | 'folder'
  | 'reuse'
  | 'copy'
  | 'trash'
  | 'close'
  | 'chevronDown'
  | 'refresh'
  | 'dice'
  | 'sparkle'
  | 'plus'
  | 'check'
  | 'alert'
  | 'external'
  | 'key'
  | 'wallet'
  | 'play'
  | 'clock';

/** Stroked paths, drawn on a 24×24 viewBox. */
const PATHS: Record<IconName, string> = {
  image: 'M3 5.5h18v13H3zM3 15l4.5-4.5 4 4M14 12l2.5-2.5L21 14M15.5 8.5h.01',
  imageEdit: 'M20.5 12.5V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2H12M3.5 16l4-4 3.5 3.5M21.4 3.6a1.9 1.9 0 0 1 0 2.7L16.5 11l-3 .8.8-3 4.9-4.9a1.9 1.9 0 0 1 2.7 0z',
  video: 'M3 6.5h12v11H3zM15 10.5l6-3.5v10l-6-3.5z',
  imageToVideo: 'M3 5.5h8v8H3zM3 11l2.5-2.5 2 2M13.5 12h7M18 9.5l2.5 2.5-2.5 2.5M9 17.5h11.5v3H9z',
  upscale: 'M4 9V4.5h5M20 15v4.5h-5M20 9V4.5h-5M4 15v4.5h5M9.5 9.5h5v5h-5z',
  speech: 'M12 3.5a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0v-5a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3',
  music: 'M9 18V6.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  transcript: 'M5 3.5h9l5 5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1zM14 3.5v5h5M7.5 13h9M7.5 16.5h6',
  library: 'M3.5 4.5h6v15h-6zM12 4.5h3v15h-3zM17.2 5l3.3.9-3.6 13.6-3.3-.9z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 13H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 6.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3.9z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20.5 20.5L16 16',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z',
  download: 'M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4.5 19.5h15',
  folder: 'M3.5 6.5a1 1 0 0 1 1-1h4l2 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1z',
  reuse: 'M20 11a8 8 0 1 0-2.3 6.1M20 5.5V11h-5.5',
  copy: 'M9.5 9.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM5.5 15.5h-1a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  trash: 'M4.5 6.5h15M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7M6.5 6.5l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8l.8-12.2',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6.5 9.5l5.5 5.5 5.5-5.5',
  refresh: 'M20.5 5.5v5h-5M3.5 18.5v-5h5M4.6 10a8 8 0 0 1 13.1-3l2.8 2.5M19.4 14a8 8 0 0 1-13.1 3l-2.8-2.5',
  dice: 'M4.5 5.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  sparkle: 'M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  plus: 'M12 5.5v13M5.5 12h13',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 8.5v5M12 17h.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
  external: 'M14.5 4.5h5v5M19.5 4.5L11 13M17.5 13.5v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h5',
  key: 'M15.5 3.5a5 5 0 1 0-4.4 7.4l.6 0L3.5 19v2h3v-2h2v-2h2v-2.2l1.5-1.5a5 5 0 0 0 3.5-8.6zM16.5 7.5h.01',
  wallet: 'M3.5 7.5a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v1M3.5 7.5v10a1 1 0 0 0 1 1h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-15M17 13h.01',
  play: 'M8 5.5l11 6.5-11 6.5z',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 1.8',
};

/** Filled icons read better than stroked ones at small sizes. */
const FILLED: Partial<Record<IconName, boolean>> = { star: true, play: true };

interface Props {
  name: IconName;
  size?: number;
  /** Renders the filled variant, for toggled states such as a favourite. */
  filled?: boolean;
  className?: string;
}

export default function Icon({ name, size = 16, filled, className }: Props) {
  const solid = filled ?? false;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid && FILLED[name] ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
