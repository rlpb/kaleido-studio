/**
 * Generates build/icon.png, the source electron-builder converts into the
 * Windows .ico and macOS .icns. Written with zlib alone so the repository does
 * not carry a binary asset or an image dependency for one 512px square.
 *
 * Run with: npm run icon
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZE = 512;
const RADIUS = 112; // corner rounding, matching a modern app tile

// Kaleidoscope wedges: the same hues the in-app brand mark uses.
const WEDGES = [
  [124, 108, 255],
  [90, 168, 255],
  [56, 212, 212],
  [126, 214, 128],
  [242, 181, 68],
  [242, 99, 95],
];

const BACKDROP = [14, 16, 24];

function insideRoundedSquare(x, y) {
  const min = 0;
  const max = SIZE - 1;
  const cx = Math.min(Math.max(x, min + RADIUS), max - RADIUS);
  const cy = Math.min(Math.max(y, min + RADIUS), max - RADIUS);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function pixel(x, y) {
  if (!insideRoundedSquare(x, y)) return [0, 0, 0, 0];

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.hypot(dx, dy);
  const outer = SIZE * 0.34;
  const inner = SIZE * 0.115;

  if (distance > outer || distance < inner) return [...BACKDROP, 255];

  // Angle to wedge. The seam is a narrow band centred on the boundary, equal on
  // both sides, so no wedge reads as a wide gradient and none as a hard edge.
  const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
  const slice = (angle / (Math.PI * 2)) * WEDGES.length;
  const index = Math.floor(slice) % WEDGES.length;
  const within = slice - Math.floor(slice);
  const seam = 0.07;

  let mix = WEDGES[index];
  if (within < seam) {
    const previous = WEDGES[(index - 1 + WEDGES.length) % WEDGES.length];
    const t = 0.5 + within / (2 * seam);
    mix = mix.map((channel, i) => Math.round(channel * t + previous[i] * (1 - t)));
  } else if (within > 1 - seam) {
    const next = WEDGES[(index + 1) % WEDGES.length];
    const t = 0.5 + (1 - within) / (2 * seam);
    mix = mix.map((channel, i) => Math.round(channel * t + next[i] * (1 - t)));
  }

  // Fade the ring edges into the backdrop for a clean silhouette.
  const edge = Math.min(outer - distance, distance - inner) / 6;
  const alpha = Math.min(1, Math.max(0, edge));
  return [
    Math.round(mix[0] * alpha + BACKDROP[0] * (1 - alpha)),
    Math.round(mix[1] * alpha + BACKDROP[1] * (1 - alpha)),
    Math.round(mix[2] * alpha + BACKDROP[2] * (1 - alpha)),
    255,
  ];
}

// --- minimal PNG writer ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
let offset = 0;
for (let y = 0; y < SIZE; y += 1) {
  raw[offset++] = 0; // filter type: none
  for (let x = 0; x < SIZE; x += 1) {
    const [r, g, b, a] = pixel(x, y);
    raw[offset++] = r;
    raw[offset++] = g;
    raw[offset++] = b;
    raw[offset++] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`build/icon.png scritto: ${SIZE}x${SIZE}, ${png.length} byte`);
