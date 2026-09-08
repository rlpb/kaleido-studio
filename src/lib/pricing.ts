import type { ModelInfo } from './types';
import type { Dict } from './locales/en';

type Translate = (key: keyof Dict, vars?: Record<string, string | number>) => string;

type Params = Record<string, string | number | boolean>;

/** The parameters that actually move the price, in a stable order. */
const SHAPE_KEYS = ['resolution', 'aspect_ratio', 'size', 'quality', 'duration', 'generate_audio', 'output_format'];

/**
 * A stable signature for "this model run with this shape". Two runs sharing a
 * signature cost the same, so an observed cost from one is a real measurement
 * for the next.
 */
export function costKeyFor(modelId: string, params: Params): string {
  const parts = SHAPE_KEYS.filter((k) => params[k] !== undefined && params[k] !== '').map((k) => `${k}=${params[k]}`);
  return [modelId, ...parts].join('|');
}

export type EstimateBasis = 'list price' | 'measured' | 'free' | 'unknown';

export interface Estimate {
  /** USD for the whole batch, or null when no honest figure can be produced. */
  total: number | null;
  /** Where the number comes from, so the UI never presents a guess as a quote.
   *  Kept as a stable identifier; the interface translates it for display. */
  basis: EstimateBasis;
  /** The explanation as a key plus values, so it can be shown in any language. */
  detailKey: keyof Dict;
  detailVars?: Record<string, string | number>;
}

/** Trims a rate to the digits that carry meaning, without scientific notation. */
function significant(value: number, digits = 3): string {
  if (value === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.min(10, Math.max(0, digits - 1 - magnitude));
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

/**
 * Per-token rates run to fifteen decimal places, which is unreadable. Every
 * provider quotes them per million tokens, so that is how they are shown.
 */
export function formatRate(perUnit: number, unit: string): string {
  if (unit === 'token') return `$${significant(perUnit * 1_000_000)} / M tokens`;
  return `$${significant(perUnit)} / ${unit}`;
}

/** One line describing how a model bills, whatever scheme it uses. */
export function priceSummary(model: ModelInfo, t: Translate): string {
  const seconds = model.price.perVideoSecond;
  if (seconds && Object.keys(seconds).length) {
    const rates = Object.values(seconds);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    return min === max
      ? t('picker.perVideoSecond', { rate: `${significant(min)}` })
      : t('picker.perVideoSecondRange', { min: `${significant(min)}`, max: `${significant(max)}` });
  }
  const perToken = model.price.perImageToken ?? model.price.perAudioOutputToken ?? model.price.perInputToken;
  if (perToken) return t('picker.perMillionTokens', { rate: `${significant(perToken * 1_000_000)}` });
  return t('picker.free');
}

/** Lower is cheaper. Used to sort the model list by price. */
export function cheapness(model: ModelInfo): number {
  const seconds = model.price.perVideoSecond;
  if (seconds && Object.keys(seconds).length) return Math.min(...Object.values(seconds));
  return model.price.perImageToken ?? model.price.perAudioOutputToken ?? model.price.perInputToken ?? 0;
}

/**
 * Video is billed per second of output, which the catalog states exactly, so its
 * estimate is arithmetic. Every other modality is billed per token, and the
 * token count is not knowable before the run, so the only honest figure is what
 * the same shape actually cost last time.
 */
export function estimateCost(
  model: ModelInfo | undefined,
  params: Params,
  batch: number,
  observedCosts: Record<string, number>,
): Estimate {
  if (!model) return { total: null, basis: 'unknown', detailKey: 'cost.noModel' };

  const runs = Math.max(1, batch);
  const perSecond = model.price.perVideoSecond;

  if (perSecond && Object.keys(perSecond).length > 0) {
    const resolution = String(params.resolution ?? '');
    const rate = perSecond[resolution] ?? perSecond.default ?? Object.values(perSecond)[0];
    const duration = Number(params.duration ?? 0);
    if (rate && duration > 0) {
      return {
        total: rate * duration * runs,
        basis: 'list price',
        detailKey: 'cost.listPrice',
        detailVars: { rate: `${significant(rate)}`, duration, runs },
      };
    }
  }

  const observed = observedCosts[costKeyFor(model.id, params)];
  if (typeof observed === 'number') {
    return {
      total: observed * runs,
      basis: 'measured',
      detailKey: runs > 1 ? 'cost.measuredBatch' : 'cost.measured',
      detailVars: { n: runs },
    };
  }

  if (model.price.free) {
    return { total: 0, basis: 'free', detailKey: 'cost.noListPrice' };
  }

  const rate = model.price.perImageToken ?? model.price.perAudioOutputToken ?? model.price.perOutputToken;
  return rate
    ? {
        total: null,
        basis: 'unknown',
        detailKey: 'cost.rate',
        detailVars: { rate: formatRate(rate, 'token') },
      }
    : { total: null, basis: 'unknown', detailKey: 'cost.unknown' };
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return 'free';
  if (value < 0.001) return `<$0.001`;
  if (value < 1) return `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${value.toFixed(2)}`;
}

/** Like formatCost, but a zero balance reads as money, not as a free model. */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  // Small amounts need more places, but never as trailing zeros: $0.1200 reads
  // like a precision the number does not have.
  const text = value > 0 && value < 1 ? value.toFixed(4).replace(/0+$/, '') : value.toFixed(2);
  return `$${text.replace(/\.$/, '')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
