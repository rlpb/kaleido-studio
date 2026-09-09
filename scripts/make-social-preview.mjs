/**
 * Renders docs/social-preview.png, the 1280x640 card GitHub shows when a link
 * to this repository is shared.
 *
 * Electron is already a dependency and it can rasterise, so an offscreen window
 * draws the card and hands back the pixels. Nothing is captured from the
 * screen: a screen capture picks up whatever window happens to be on top, which
 * is how a banner ends up containing somebody's chat.
 *
 * Run with: npm run social
 */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 1280;
const HEIGHT = 640;

/** The wedge colours of the app mark, in order around the ring. */
const WEDGES = ['#7c6cff', '#4ea8ff', '#3ecf8e', '#f2b544', '#f2635f', '#c46cff'];

function ring(cx, cy, outer, inner) {
  return WEDGES.map((colour, i) => {
    const a0 = (i / WEDGES.length) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / WEDGES.length) * Math.PI * 2 - Math.PI / 2;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    return (
      `<path fill="${colour}" d="M ${p(outer, a0)} A ${outer} ${outer} 0 0 1 ${p(outer, a1)} ` +
      `L ${p(inner, a1)} A ${inner} ${inner} 0 0 0 ${p(inner, a0)} Z"/>`
    );
  }).join('');
}

const TILES = [
  ['Images', '#7c6cff'],
  ['Video', '#4ea8ff'],
  ['Speech', '#3ecf8e'],
  ['Transcription', '#f2b544'],
];

function html() {
  const tiles = TILES.map(
    ([label, colour], i) =>
      `<div class="tile" style="--c:${colour};--d:${i * 0}s"><span class="dot"></span>${label}</div>`,
  ).join('');
  return `<!doctype html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: radial-gradient(120% 140% at 78% 10%, #1a1f2e 0%, #0b0d12 60%);
    color: #e8ebf2;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    display: flex; align-items: center; gap: 64px; padding: 0 88px;
  }
  .mark { flex: none; filter: drop-shadow(0 18px 48px rgb(124 108 255 / 35%)); }
  h1 { font-size: 76px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .sub { font-size: 27px; color: #9aa3b8; margin-top: 20px; line-height: 1.4; max-width: 620px; }
  .tiles { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 40px; }
  .tile {
    display: flex; align-items: center; gap: 9px;
    font-size: 19px; color: #c8cede;
    padding: 9px 18px; border-radius: 999px;
    border: 1px solid #232939; background: #12151d;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .foot { position: absolute; left: 88px; bottom: 46px; font-size: 19px; color: #676f84; }
</style>
<svg class="mark" width="300" height="300" viewBox="0 0 300 300">
  ${ring(150, 150, 140, 62)}
  <circle cx="150" cy="150" r="46" fill="#0b0d12"/>
  <circle cx="150" cy="150" r="46" fill="none" stroke="#232939" stroke-width="2"/>
</svg>
<div>
  <h1>Kaleido Studio</h1>
  <div class="sub">Every kind of media, one desktop app. Built on OpenRouter, with the controls generated from the live catalog.</div>
  <div class="tiles">${tiles}</div>
</div>
<div class="foot">github.com/rlpb/kaleido-studio</div>`;
}

// Not `await app.whenReady()` at the top level: with an ESM entry point the
// ready event only fires once the module has finished evaluating, so awaiting
// it out here deadlocks the process with no output at all.
app.whenReady().then(render).catch((err) => {
  console.error(err.message);
  app.exit(1);
});

async function render() {
const win = new BrowserWindow({
  width: WIDTH,
  height: HEIGHT,
  show: false,
  // The content box is what gets captured, so it is sized rather than the frame.
  useContentSize: true,
  // Not offscreen: an offscreen window only produces frames while something
  // consumes its paint events, and capturePage on one never resolves.
  webPreferences: { sandbox: true, contextIsolation: true },
});

await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html()));
// Fonts and the gradient need one frame before the pixels are final.
await new Promise((resolve) => setTimeout(resolve, 600));

const image = await Promise.race([
  win.webContents.capturePage(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('capturePage did not return within 20s')), 20_000)),
]);
const { width, height } = image.getSize();
if (width !== WIDTH || height !== HEIGHT) {
  throw new Error(`Captured ${width}x${height}, expected ${WIDTH}x${HEIGHT}`);
}

const out = path.join(root, 'docs', 'social-preview.png');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, image.toPNG());
console.log(`docs/social-preview.png  ${width}x${height}  ${(readFileSync(out).length / 1024).toFixed(0)}KB`);

  app.quit();
}
