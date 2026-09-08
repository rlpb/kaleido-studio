/**
 * End-to-end check of the parts that can silently go wrong without the UI
 * noticing: the live OpenRouter catalog still has the shape the normaliser
 * expects, and the cost estimator only quotes numbers it can defend.
 *
 * Run with: npm run check
 * Needs network access. No API key required: the catalog routes are public.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(path.join(tmpdir(), 'kaleido-check-'));
let failures = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok   ${name}`))
    .catch((err) => {
      failures += 1;
      console.error(`  FAIL ${name}\n       ${err.message}`);
    });
}

async function load(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

const api = await load('electron/openrouter.ts', 'openrouter');
const pricing = await load('src/lib/pricing.ts', 'pricing');

console.log('\nOpenRouter catalog');
const catalog = await api.fetchCatalog(null);
const modes = ['image', 'image-edit', 'video', 'video-from-image', 'video-upscale', 'speech', 'transcribe', 'audio'];

await check('every mode has at least one model', () => {
  for (const mode of modes) {
    const list = catalog.models[mode];
    assert.ok(Array.isArray(list), `${mode} is not an array`);
    assert.ok(list.length > 0, `${mode} is empty: the API changed shape`);
  }
  console.log('       ' + modes.map((m) => `${m}=${catalog.models[m].length}`).join(' '));
});

await check('every ParamSpec is usable by a form', () => {
  for (const mode of modes) {
    for (const model of catalog.models[mode]) {
      for (const spec of model.params) {
        assert.ok(spec.key && spec.label, `${model.id}: spec without key or label`);
        if (spec.kind === 'enum') {
          assert.ok(Array.isArray(spec.values) && spec.values.length > 0, `${model.id}.${spec.key}: empty enum`);
          assert.ok(
            spec.values.every((v) => typeof v === 'string'),
            `${model.id}.${spec.key}: non-string values`,
          );
        }
        if (spec.kind === 'int' || spec.kind === 'number') {
          assert.ok(Number.isFinite(spec.min) && Number.isFinite(spec.max), `${model.id}.${spec.key}: non-numeric range`);
          assert.ok(spec.min <= spec.max, `${model.id}.${spec.key}: min greater than max`);
        }
      }
    }
  }
});

await check('video models expose a duration and a per-second rate', () => {
  const withRate = catalog.models.video.filter((m) => Object.keys(m.price.perVideoSecond ?? {}).length > 0);
  assert.ok(withRate.length > 0, 'no video model has recognised pricing_skus');
  const withDuration = catalog.models.video.filter((m) => m.params.some((p) => p.key === 'duration'));
  assert.ok(withDuration.length > 0, 'no video model exposes a duration');
});

await check('image models expose at least one parameter', () => {
  const withParams = catalog.models.image.filter((m) => m.params.length > 0);
  assert.ok(withParams.length > 0, 'no image model has recognised supported_parameters');
});

await check('the image editing mode only holds models that take references', () => {
  for (const model of catalog.models['image-edit']) {
    assert.ok(model.maxReferences > 0, `${model.id} is in image-edit but takes no references`);
  }
});

await check('TTS voices come from the catalog', () => {
  const withVoices = catalog.models.speech.filter((m) => m.params.some((p) => p.key === 'voice'));
  assert.ok(withVoices.length > 0, 'no speech model exposes selectable voices');
});

console.log('\nCost estimates');

await check('video is estimated from the list price, not guessed', () => {
  const model = catalog.models.video.find((m) => Object.keys(m.price.perVideoSecond ?? {}).length > 0);
  const resolution = Object.keys(model.price.perVideoSecond).find((k) => k !== 'default') ?? 'default';
  const rate = model.price.perVideoSecond[resolution];
  const est = pricing.estimateCost(model, { resolution, duration: 5 }, 2, {});
  assert.equal(est.basis, 'list price');
  assert.ok(Math.abs(est.total - rate * 5 * 2) < 1e-9, `expected ${rate * 5 * 2}, got ${est.total}`);
});

await check('with no data it invents no figure', () => {
  const model = catalog.models.image.find((m) => !m.price.free);
  const est = pricing.estimateCost(model, { aspect_ratio: '1:1' }, 1, {});
  assert.equal(est.total, null, 'it produced a number it could not know');
  assert.equal(est.basis, 'unknown');
});

await check('an already observed cost becomes the estimate', () => {
  const model = catalog.models.image.find((m) => !m.price.free);
  const params = { aspect_ratio: '1:1', resolution: '1K' };
  const key = pricing.costKeyFor(model.id, params);
  const est = pricing.estimateCost(model, params, 3, { [key]: 0.04 });
  assert.equal(est.basis, 'measured');
  assert.ok(Math.abs(est.total - 0.12) < 1e-9);
});

await check('the cost signature ignores parameters that do not move the price', () => {
  const a = pricing.costKeyFor('x/y', { resolution: '2K', seed: 1 });
  const b = pricing.costKeyFor('x/y', { resolution: '2K', seed: 999 });
  assert.equal(a, b);
  assert.notEqual(a, pricing.costKeyFor('x/y', { resolution: '4K', seed: 1 }));
});

rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} checks failed\n`);
  process.exit(1);
}
console.log('\nAll checks passed\n');
