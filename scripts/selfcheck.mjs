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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const body = await load('electron/request-body.ts', 'request-body');
const paths = await load('electron/paths.ts', 'paths');
const atomic = await load('electron/atomic-json.ts', 'atomic-json');
const media = await load('electron/media-types.ts', 'media-types');
const security = await load('electron/security.ts', 'security');

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

await check('the edit mode lists only models that edit', () => {
  // Accepting a reference image and editing one are different capabilities and
  // the catalog has no flag separating them. krea/krea-2-medium-turbo takes one
  // reference and describes itself as generation: asked to turn a cat into a dog
  // it returned a photograph of a dog, at full price, with no error anywhere.
  const edit = catalog.models['image-edit'];
  const all = catalog.models.image;
  assert.ok(edit.length > 0, 'the edit mode is empty, so the filter removed everything');
  assert.ok(edit.length < all.length, 'the filter kept every image model, so it is not filtering');
  assert.ok(
    edit.every((m) => m.editsImages && m.maxReferences > 0),
    'a model that does not edit reached the mode',
  );

  // The two models the two signals disagree on, one per direction. Dropping
  // either would mean the filter is running on one signal only.
  const mustBeOut = ['krea/krea-2-medium-turbo', 'krea/krea-2-large', 'recraft/recraft-v4-styles'];
  for (const id of mustBeOut) {
    if (all.some((m) => m.id === id)) {
      assert.ok(!edit.some((m) => m.id === id), `${id} takes references but does not edit, and is still listed`);
    }
  }
  // gpt-5-image and gemini-2.5-flash-image never say "edit" in their
  // descriptions and are unmistakably editors, so prose alone would lose them.
  const mustBeIn = ['openai/gpt-5-image', 'google/gemini-2.5-flash-image', 'openai/gpt-image-1-mini'];
  for (const id of mustBeIn) {
    if (all.some((m) => m.id === id)) {
      assert.ok(edit.some((m) => m.id === id), `${id} is an editor that the filter dropped`);
    }
  }
  console.log(`       ${edit.length} editors kept out of ${all.length} image models`);
});

console.log('\nRequest bodies');

await check('an image edit actually carries the image', async () => {
  // The failure this catches has no error: a request that quietly loses its
  // reference still returns a picture, just one with no relation to the input.
  // The shape is the one the OpenAPI spec calls ContentPartImage.
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const os = await import('node:os');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kaleido-ref-'));
  const file = path.join(dir, 'reference.png');
  // A one-pixel PNG, written as bytes so the check does not depend on any asset.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(file, png);

  const built = body.buildImageBody({
    mode: 'image-edit',
    modelId: 'openai/gpt-image-2.5-sunburst',
    prompt: 'turn the cat into a dog',
    params: {},
    inputs: [file],
    batch: 1,
  });

  assert.equal(built.model, 'openai/gpt-image-2.5-sunburst');
  assert.equal(built.prompt, 'turn the cat into a dog');
  assert.ok(Array.isArray(built.input_references), 'input_references is missing entirely');
  assert.equal(built.input_references.length, 1, 'the reference image did not reach the body');

  const part = built.input_references[0];
  assert.equal(part.type, 'image_url', `ContentPartImage.type must be "image_url", got ${part.type}`);
  assert.ok(part.image_url && typeof part.image_url.url === 'string', 'image_url.url is missing');

  const url = part.image_url.url;
  assert.ok(url.startsWith('data:image/png;base64,'), `the data URL names the wrong type: ${url.slice(0, 40)}`);
  const carried = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
  assert.ok(carried.equals(png), 'the bytes in the data URL are not the bytes of the file');

  // A run with no input must not send an empty array, which some providers
  // reject outright.
  const plain = body.buildImageBody({
    mode: 'image',
    modelId: 'x',
    prompt: 'a cat',
    params: {},
    inputs: [],
    batch: 1,
  });
  assert.equal('input_references' in plain, false, 'a plain generation sent an input_references key');
  rmSync(dir, { recursive: true, force: true });
});

await check('an unknown extension is not passed off as an image', () => {
  // A wrong media type is accepted by the endpoint and then ignored by the
  // provider, which is the same silent failure as sending nothing.
  assert.equal(body.mimeOf('a/b/photo.PNG'), 'image/png');
  assert.equal(body.mimeOf('a/b/clip.MP4'), 'video/mp4');
  assert.equal(body.mimeOf('a/b/voice.m4a'), 'audio/mp4');
  assert.equal(body.mimeOf('a/b/thing.heic'), 'application/octet-stream');
  assert.equal(body.mimeOf('a/b/noextension'), 'application/octet-stream');
});

console.log('\nTrust boundaries');

await check('a path is inside the library only when it really resolves inside', () => {
  // Each refusal sits next to an acceptance on the same root, so a function
  // that simply refused everything would fail here rather than pass. Both path
  // flavours run on every machine: the Windows rules are the ones with drives,
  // case folding and UNC roots, and CI is not Windows.
  const posix = (target) => paths.isInside('/data/lib', target, path.posix);
  assert.equal(posix('/data/lib/2026-09/a.png'), true, 'a file inside was refused');
  assert.equal(posix('/data/lib/sub/../a.png'), true, 'a path that resolves inside was refused');
  assert.equal(posix('/data/lib/..hidden'), true, '"..hidden" is a legal name and was refused');
  assert.equal(posix('/data/lib'), false, 'the root itself counted as a file inside it');
  assert.equal(posix('/data/lib-evil/a.png'), false, 'a sibling sharing the prefix counted as inside');
  assert.equal(posix('/data/lib/../etc/passwd'), false, 'a traversal counted as inside');
  assert.equal(posix('/etc/passwd'), false);

  const win = (target) => paths.isInside('C:\\Users\\me\\Kaleido\\Library', target, path.win32);
  assert.equal(win('C:\\Users\\me\\Kaleido\\Library\\2026-09\\a.png'), true, 'a Windows file inside was refused');
  assert.equal(win('c:\\users\\me\\kaleido\\library\\a.png'), true, 'Windows paths are case-insensitive');
  assert.equal(win('C:\\Users\\me\\Kaleido\\Library-old\\a.png'), false, 'a sibling counted as inside');
  assert.equal(win('D:\\Users\\me\\Kaleido\\Library\\a.png'), false, 'another drive counted as inside');
  assert.equal(win('C:\\Users\\me\\Kaleido\\Library\\..\\..\\secret.txt'), false, 'a traversal counted as inside');
  assert.equal(win('\\\\server\\share\\Library\\a.png'), false, 'a UNC path counted as inside');
});

await check('a damaged file is set aside, never read as empty', () => {
  // The config holds the encrypted API key and the library index is the only
  // record of what was generated. Both used to read a file they could not parse
  // as empty, and the next save replaced it: one bad byte from a power cut and
  // everything was gone, silently.
  const dir = mkdtempSync(path.join(tmpdir(), 'kaleido-json-'));
  const file = path.join(dir, 'config.json');
  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

  // A missing file is a first run, and is the one case that yields the fallback quietly.
  const first = atomic.readJsonOrQuarantine(file, { fresh: true }, isObject);
  assert.deepEqual(first.value, { fresh: true });
  assert.equal(first.quarantinedTo, undefined, 'a missing file was reported as damaged');

  // A write leaves the file and nothing else behind.
  atomic.writeJsonAtomic(file, { key: 'ciphertext', presets: [1, 2, 3] });
  assert.deepEqual(readdirSync(dir), ['config.json'], `a temporary file was left behind: ${readdirSync(dir)}`);
  assert.deepEqual(atomic.readJsonOrQuarantine(file, {}, isObject).value, { key: 'ciphertext', presets: [1, 2, 3] });

  // Truncated mid-write: the state a power cut leaves.
  const truncated = '{ "key": "ciphertext", "presets": [1, 2';
  writeFileSync(file, truncated);
  const damaged = atomic.readJsonOrQuarantine(file, { fresh: true }, isObject);
  assert.deepEqual(damaged.value, { fresh: true });
  assert.ok(damaged.quarantinedTo, 'a truncated file was not reported');
  assert.equal(readFileSync(damaged.quarantinedTo, 'utf8'), truncated, 'the damaged bytes were not preserved');
  assert.equal(existsSync(file), false, 'the damaged file was left where the next write would replace it');

  // The save that follows must not touch what was set aside.
  atomic.writeJsonAtomic(file, { fresh: true });
  assert.equal(readFileSync(damaged.quarantinedTo, 'utf8'), truncated, 'a later save overwrote the preserved copy');

  // Valid JSON of the wrong shape is damage too, not "an empty list".
  writeFileSync(file, '{"not":"a list"}');
  const wrong = atomic.readJsonOrQuarantine(file, [], Array.isArray);
  assert.deepEqual(wrong.value, []);
  assert.ok(wrong.quarantinedTo, 'a value of the wrong shape was accepted');

  // Unreadable is not empty. A directory where the file should be is the
  // portable way to make a read fail with something other than "not found".
  const blocked = path.join(dir, 'index.json');
  mkdirSync(blocked);
  assert.throws(() => atomic.readJsonOrQuarantine(blocked, [], Array.isArray), /Cannot read/, 'an unreadable file was treated as empty');
  rmSync(dir, { recursive: true, force: true });
});

await check('no declared media type can name an executable extension', () => {
  // The extension of a saved file came from the type the provider declared,
  // falling back to its raw subtype, so a response claiming application/bat was
  // saved as a .bat inside the library. Property, not examples: whatever the
  // type is, the file that results must be one the app is willing to open.
  const hostile = [
    ['application/bat', 'image'],
    ['application/x-msdownload', 'video'],
    ['application/exe', 'audio'],
    ['text/html', 'text'],
    ['application/javascript', 'text'],
    ['image/png; charset=utf-8', 'image'],
    ['', 'image'],
    ['../../evil', 'video'],
    ['audio/mpeg\u0000.exe', 'audio'],
  ];
  for (const [type, kind] of hostile) {
    const ext = media.extensionFor(type, kind);
    assert.ok(media.isOpenable(`saved.${ext}`), `"${type}" produced .${ext}, which the app would not open`);
    assert.ok(!/^(bat|cmd|exe|com|scr|ps1|vbs|js|sh|msi|lnk|html|htm)$/.test(ext), `"${type}" produced .${ext}`);
  }
  // The controls: the table still does its job, and the refusal is real.
  assert.equal(media.extensionFor('image/png', 'image'), 'png');
  assert.equal(media.extensionFor('audio/mpeg; codecs=mp3', 'audio'), 'mp3');
  assert.equal(media.extensionFor('video/quicktime', 'video'), 'mov');
  assert.equal(media.isOpenable('a.PNG'), true);
  for (const bad of ['a.bat', 'a.EXE', 'a.lnk', 'a.ps1', 'a.html', 'noextension']) {
    assert.equal(media.isOpenable(bad), false, `${bad} would be handed to the operating system`);
  }
});

await check('only the application\u2019s own page counts as the application', () => {
  const app = (url, dev) => security.isAppUrl(url, dev);
  // The installed page, wherever the install put it: spaces, the asar segment
  // and a hash route all occur, and refusing the real page would disable every
  // IPC call in a build that no local run exercises.
  assert.equal(app('file:///C:/Users/John%20Doe/AppData/Local/Programs/Kaleido%20Studio/resources/app.asar/dist/index.html'), true);
  assert.equal(app('file:///home/me/kaleido/dist/index.html#/library'), true);
  assert.equal(app('http://localhost:5173/', 'http://localhost:5173'), true);
  // Everything else, including the near misses.
  assert.equal(app('file:///C:/evil/index.html'), false, 'another local page counted as the application');
  assert.equal(app('file:///C:/x/dist/index.html.exe'), false);
  assert.equal(app('file:///C:/Windows/win.ini'), false);
  assert.equal(app('https://evil.example/dist/index.html'), false, 'a remote page counted as the application');
  assert.equal(app('http://localhost:5173.evil.example/', 'http://localhost:5173'), false, 'a lookalike origin counted');
  assert.equal(app('http://localhost:5173/'), false, 'the dev server counted when no dev URL was given');
  assert.equal(app('kal://local/?p=x'), false);
  assert.equal(app('not a url'), false);
  assert.equal(app(''), false);
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
