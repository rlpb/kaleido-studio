import type { ModelInfo } from './types';

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

export interface Estimate {
  /** USD for the whole batch, or null when no honest figure can be produced. */
  total: number | null;
  /** Where the number comes from, so the UI never presents a guess as a quote. */
  basis: 'listino' | 'misurato' | 'gratis' | 'sconosciuto';
  detail: string;
}

const money = (n: number): string => (n >= 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(5)}`);

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
  if (!model) return { total: null, basis: 'sconosciuto', detail: 'Nessun modello selezionato' };

  const runs = Math.max(1, batch);
  const perSecond = model.price.perVideoSecond;

  if (perSecond && Object.keys(perSecond).length > 0) {
    const resolution = String(params.resolution ?? '');
    const rate = perSecond[resolution] ?? perSecond.default ?? Object.values(perSecond)[0];
    const duration = Number(params.duration ?? 0);
    if (rate && duration > 0) {
      const total = rate * duration * runs;
      return {
        total,
        basis: 'listino',
        detail: `${money(rate)}/s × ${duration}s${runs > 1 ? ` × ${runs}` : ''}`,
      };
    }
  }

  const observed = observedCosts[costKeyFor(model.id, params)];
  if (typeof observed === 'number') {
    return {
      total: observed * runs,
      basis: 'misurato',
      detail: `Costo reale dell'ultima generazione identica${runs > 1 ? ` × ${runs}` : ''}`,
    };
  }

  if (model.price.free) {
    return { total: 0, basis: 'gratis', detail: 'Modello senza costo a listino' };
  }

  const rate = model.price.perImageToken ?? model.price.perAudioOutputToken ?? model.price.perOutputToken;
  return {
    total: null,
    basis: 'sconosciuto',
    detail: rate
      ? `Tariffa ${money(rate)} per token di output. Il numero di token dipende dal risultato, quindi il costo esatto compare a fine generazione.`
      : 'Il costo esatto compare a fine generazione.',
  };
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value === 0) return 'gratis';
  return money(value);
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
