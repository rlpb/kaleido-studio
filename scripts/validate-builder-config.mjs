/**
 * Validates electron-builder.yml against the schema electron-builder itself
 * ships, before a packaging run rather than during one.
 *
 * electron-builder validates the config as its first step, so an unknown key
 * fails every platform at once, minutes into CI, with a message that names the
 * section but not the key. This check is the same validation, offline, in a
 * second, and it names the key.
 *
 * Run with: npm run check:config
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const schema = require('app-builder-lib/scheme.json');

/**
 * Minimal YAML reader for the subset this config uses: two-space nesting,
 * `key: value`, `- item`, and inline `[a, b]` lists. Pulling a YAML parser in
 * as a dependency for one config file would be the heavier option.
 */
function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const content = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (content.startsWith('- ')) {
      const item = content.slice(2).trim();
      if (!Array.isArray(parent.__list)) parent.__list = [];
      if (item.includes(': ')) {
        const entry = {};
        const [key, ...rest] = item.split(': ');
        entry[key.trim()] = coerce(rest.join(': ').trim());
        parent.__list.push(entry);
        stack.push({ indent, node: entry });
      } else {
        parent.__list.push(coerce(item));
      }
      continue;
    }

    const separator = content.indexOf(':');
    if (separator === -1) continue;
    const key = content.slice(0, separator).trim();
    const value = content.slice(separator + 1).trim();

    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = coerce(value);
    }
  }

  return normalise(root);
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => coerce(v.trim()))
      .filter((v) => v !== '');
  }
  return value.replace(/^['"]|['"]$/g, '');
}

/** Turns the `__list` marker back into a plain array. */
function normalise(node) {
  if (Array.isArray(node) || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node.__list)) return node.__list.map(normalise);
  const out = {};
  for (const [key, value] of Object.entries(node)) out[key] = normalise(value);
  return out;
}

const config = parseYaml(readFileSync('electron-builder.yml', 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false, verbose: false });
const validate = ajv.compile(schema);

if (validate(config)) {
  console.log('electron-builder.yml valido secondo lo schema di app-builder-lib');
  process.exit(0);
}

console.error('electron-builder.yml non valido:\n');
for (const error of validate.errors ?? []) {
  const where = error.instancePath || '(radice)';
  const extra = error.params?.additionalProperty ? ` -> chiave sconosciuta "${error.params.additionalProperty}"` : '';
  console.error(`  ${where} ${error.message}${extra}`);
}
console.error('');
process.exit(1);
