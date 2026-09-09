import type { ModelInfo, ParamSpec } from './types';

export type ParamValue = string | number | boolean;

/**
 * Seeds the form with every default the model declares, and nothing else. A knob
 * the catalog says nothing about is left unset so the request omits it and the
 * provider applies its own default.
 */
export function defaultsFor(model: ModelInfo | undefined): Record<string, ParamValue> {
  const values: Record<string, ParamValue> = {};
  for (const spec of model?.params ?? []) {
    if ('default' in spec && spec.default !== undefined) values[spec.key] = spec.default;
  }
  return values;
}

/**
 * Where a control sits when nobody has touched it, which is not always the
 * declared default.
 *
 * A slider on a model that declares none rests at its minimum, and a checkbox
 * rests unticked. Moving one and putting it back stores that value, so comparing
 * against the declaration alone reports a change the user cannot undo.
 */
export function restingValue(spec: ParamSpec): ParamValue | undefined {
  if (spec.kind === 'bool') return Boolean(spec.default);
  if (spec.kind === 'number') return spec.default ?? spec.min;
  return spec.default;
}

/**
 * How many knobs sit somewhere other than where they rest, so a collapsed panel
 * can still say whether anything inside it was touched. Counted over the model's
 * own specs, so a leftover key from a previously selected model cannot inflate it.
 */
export function countChanged(model: ModelInfo | undefined, values: Record<string, ParamValue>): number {
  return (model?.params ?? []).filter((spec) => {
    const resting = restingValue(spec);
    return (values[spec.key] ?? resting) !== resting;
  }).length;
}
