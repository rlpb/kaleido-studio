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
const paramsLib = await load('src/lib/params.ts', 'params');

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

await check('every price the interface shows carries its currency', () => {
  // An edit once dropped the dollar sign and the summary read as a bare "9.58",
  // which is not a price. Cheap to assert, and invisible to the eye until it
  // has already shipped in a screenshot.
  const templates = {
    'picker.perVideoSecond': '{rate} / video second',
    'picker.perVideoSecondRange': '{min}-{max} / video second',
    'picker.perMillionTokens': '{rate} / M tokens',
    'picker.free': 'free',
    'picker.priceUnpublished': 'price not published',
  };
  const t = (key, vars = {}) =>
    (templates[key] ?? key).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole));

  // "free" and "price not published" are statements about billing, not amounts,
  // so only the summaries that quote a figure are held to carrying a currency.
  const notAnAmount = new Set([templates['picker.free'], templates['picker.priceUnpublished']]);
  const currency = String.fromCharCode(36);
  for (const mode of ['image', 'video']) {
    for (const model of catalog.models[mode]) {
      const summary = pricing.priceSummary(model, t);
      if (notAnAmount.has(summary)) continue;
      assert.ok(summary.includes(currency), `${model.id}: price without a currency: "${summary}"`);
    }
  }

  const video = catalog.models.video.find((m) => Object.keys(m.price.perVideoSecond ?? {}).length > 0);
  const resolution = Object.keys(video.price.perVideoSecond).find((k) => k !== 'default') ?? 'default';
  const est = pricing.estimateCost(video, { resolution, duration: 5 }, 1, {});
  assert.ok(
    String(est.detailVars?.rate ?? '').startsWith(currency),
    `the list-price detail lost its currency: ${JSON.stringify(est.detailVars)}`,
  );
});

await check('nothing is called free unless OpenRouter says so', () => {
  // google/lyria-3-pro-preview lists {"prompt":"0","completion":"0"} and then
  // bills real money per generation. All-zero pricing means the price was not
  // published, which is a different claim from free, and only the ":free"
  // suffix supports the second one.
  for (const mode of modes) {
    for (const model of catalog.models[mode]) {
      if (!model.price.free) continue;
      assert.ok(model.id.endsWith(':free'), `${model.id} is marked free without the :free suffix`);
    }
  }

  const lyria = catalog.models.audio.find((m) => m.id.startsWith('google/lyria'));
  if (lyria) {
    assert.equal(lyria.price.free, false, 'the model that bills without a listed price is marked free again');
    assert.equal(lyria.price.unpublished, true, 'its price should read as unpublished');
  }
});

await check('a rate keeps its magnitude', () => {
  // Trimming trailing zeros used to eat the integer part as well, so a model
  // billed at $100000 per million tokens displayed as $1. Whole numbers ending
  // in zero are the cases that hid it, since every price in the catalog that
  // day happened to end in something else.
  const t = (key, vars = {}) =>
    ({ 'picker.perMillionTokens': '{rate} / M tokens' })[key].replace(/\{(\w+)\}/g, (w, n) =>
      n in vars ? String(vars[n]) : w,
    );
  const model = (perImageToken) => ({
    price: { perImageToken, perVideoSecond: {}, free: false, unpublished: false },
  });

  const cases = [
    [0.1, '$100000 / M tokens'],
    [0.00005, '$50 / M tokens'],
    [0.00002, '$20 / M tokens'],
    [0.00000359, '$3.59 / M tokens'],
    [0.0000038, '$3.8 / M tokens'],
  ];
  for (const [rate, expected] of cases) {
    const actual = pricing.priceSummary(model(rate), t);
    assert.equal(actual, expected, `rate ${rate} rendered as "${actual}"`);
  }
});

await check('a rate is called per token only when the model bills per token', () => {
  // pricing.prompt carries two different units and the catalog names neither.
  // openai/gpt-4o-mini-transcribe declares a 128000-token context and lists
  // 0.00000125, which is OpenAI's published $1.25 per million tokens.
  // microsoft/mai-transcribe-2 declares no context and lists 0.1, which
  // OpenRouter's own model page labels "Audio Hours ... /hour". Reading the
  // second as a token rate displayed $0.10 per hour of audio as $100000 per
  // million tokens.
  const t = (key, vars = {}) =>
    ({
      'picker.perMillionTokens': '{rate} / M tokens',
      'picker.rateNoUnit': '{rate} / unit',
      'picker.free': 'free',
      'picker.priceUnpublished': 'price not published',
    })[key].replace(/\{(\w+)\}/g, (w, n) => (n in vars ? String(vars[n]) : w));

  let unnamed = 0;
  for (const mode of ['transcribe', 'speech']) {
    for (const model of catalog.models[mode]) {
      const summary = pricing.priceSummary(model, t);
      if (model.price.tokenBilled) continue;
      unnamed += 1;
      assert.ok(
        !summary.includes('M tokens'),
        `${model.id} bills in an unnamed unit but its price reads "${summary}"`,
      );
    }
  }
  assert.ok(unnamed > 0, 'no model exercised the unnamed-unit path, so this check proved nothing');

  const mai = catalog.models.transcribe.find((m) => m.id === 'microsoft/mai-transcribe-2');
  if (mai) {
    assert.equal(mai.price.tokenBilled, false, 'a model with no token context was marked as token billed');
    assert.equal(pricing.priceSummary(mai, t), '$0.1 / unit');
  }
  console.log(`       ${unnamed} model(s) priced in a unit the catalog does not name`);
});

await check('a duration reads correctly at every scale', () => {
  // Chosen by input class rather than by whatever a run happened to produce:
  // under ten seconds, over ten, exactly a minute, and the rounding boundary
  // that would otherwise print "1m 60s".
  const cases = [
    [0, '0.0s'],
    [340, '0.3s'],
    [3400, '3.4s'],
    [9950, '9.9s'],
    [10000, '10s'],
    [12000, '12s'],
    [59600, '1m'],
    [60000, '1m'],
    [61000, '1m 1s'],
    [119600, '2m'],
    [125000, '2m 5s'],
    [3600000, '60m'],
  ];
  for (const [ms, expected] of cases) {
    assert.equal(pricing.formatDuration(ms), expected, `${ms}ms rendered as "${pricing.formatDuration(ms)}"`);
  }
  assert.equal(pricing.formatDuration(undefined), '—');
  assert.equal(pricing.formatDuration(-1), '—');
});

await check('a zero cost reads in the chosen language', () => {
  const t = (key) => (key === 'cost.free' ? 'gratis' : key);
  assert.equal(pricing.formatCost(0, t), 'gratis');
  // Without a translator it must not fall back to an English word, which would
  // land untranslated in an interface that is otherwise fully localised.
  assert.equal(pricing.formatCost(0), '0');
  assert.equal(pricing.formatCost(0.5), '$0.5');
  assert.equal(pricing.formatCost(1.5), '$1.50');
});

await check('a knob put back where it started stops counting as changed', () => {
  // The badge on the collapsed parameter panel is a claim about the user's own
  // input, so it has to be reversible. It was not: a slider on a model that
  // declares no default rests at its minimum and a checkbox rests unticked, but
  // both were compared against the declared default, which is undefined. Moving
  // one and putting it back left a badge nothing could clear.
  const model = {
    params: [
      { key: 'creativity', label: 'Creativity', kind: 'number', min: 0, max: 10, step: 1 },
      { key: 'quality', label: 'Quality', kind: 'enum', values: ['low', 'high'], default: 'high' },
      { key: 'generate_audio', label: 'Audio', kind: 'bool' },
      { key: 'seed', label: 'Seed', kind: 'int', min: 0, max: 99 },
    ],
  };
  const count = (values) => paramsLib.countChanged(model, values);

  assert.equal(count({}), 0, 'an untouched form reported a change');
  assert.equal(count({ creativity: 0 }), 0, 'a slider returned to its minimum still counted');
  assert.equal(count({ generate_audio: false }), 0, 'a checkbox ticked and unticked still counted');
  assert.equal(count({ quality: 'high' }), 0, 'a select returned to its default still counted');
  assert.equal(count({ creativity: 4 }), 1);
  assert.equal(count({ quality: 'low', seed: 7 }), 2);
  // A key left behind by a previously selected model must not be counted.
  assert.equal(count({ resolution: '4K' }), 0, 'a key from another model inflated the count');
});

console.log('\nHTTP client');

await check('setFetch is honoured, so the injected client is the one used', async () => {
  const calls = [];
  api.setFetch(async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: { label: 'stub' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const status = await api.checkKey('stub-key');
  assert.equal(calls.length, 1, 'the injected client was never called');
  assert.ok(calls[0].endsWith('/key'), `unexpected URL: ${calls[0]}`);
  assert.equal(status.valid, true);
  assert.equal(status.label, 'stub');
});

await check('a transport failure names its cause instead of "fetch failed"', async () => {
  api.setFetch(async () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    throw err;
  });
  const status = await api.checkKey('stub-key');
  assert.equal(status.valid, false);
  assert.ok(status.error.includes('UND_ERR_SOCKET'), `cause missing from: ${status.error}`);
  assert.ok(!/^fetch failed$/.test(status.error), 'the opaque message leaked through');
});

rmSync(outDir, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} checks failed\n`);
  process.exit(1);
}
console.log('\nAll checks passed\n');
