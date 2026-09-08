import type { ParamSpec } from '../lib/types';
import Icon from './Icon';
import { useT } from '../lib/i18n';
import type { Dict } from '../lib/locales/en';

type Value = string | number | boolean;

interface Props {
  params: ParamSpec[];
  values: Record<string, Value>;
  onChange: (key: string, value: Value | undefined) => void;
}

/**
 * Renders whatever knobs the selected model declares. Nothing here is
 * hard-coded per model: the specs come straight from the OpenRouter capability
 * endpoints, so a model added tomorrow gets a correct form with no code change.
 */
export default function CapabilityForm({ params, values, onChange }: Props) {
  const t = useT();
  // Falls back to the label the API supplied when a parameter has no dictionary
  // entry, which is what happens the day a provider adds a knob nobody has seen.
  const label = (key: string, fallback: string) => {
    const translated = t(`param.${key}` as keyof Dict);
    return translated === `param.${key}` ? fallback : translated;
  };
  const placeholderFor = (key: string, fallback?: string) => {
    const translated = t(`placeholder.${key}` as keyof Dict);
    return translated === `placeholder.${key}` ? fallback : translated;
  };
  const helpFor = (key: string, fallback?: string) => {
    const translated = t(`help.${key}` as keyof Dict);
    return translated === `help.${key}` ? fallback : translated;
  };
  if (!params.length) {
    return <div className="faint">{t('studio.noParameters')}</div>;
  }

  return (
    <div className="stack">
      {params.map((spec) => {
        const current = values[spec.key];

        if (spec.kind === 'bool') {
          const checked = current === undefined ? Boolean(spec.default) : Boolean(current);
          return (
            <div className="field" key={spec.key}>
              <label className="switch plain">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(spec.key, e.target.checked)} />
                <span>{label(spec.key, spec.label)}</span>
              </label>
              {helpFor(spec.key, spec.help) && <div className="help">{helpFor(spec.key, spec.help)}</div>}
            </div>
          );
        }

        return (
          <div className="field" key={spec.key}>
            <label htmlFor={`p-${spec.key}`}>{label(spec.key, spec.label)}</label>

            {spec.kind === 'enum' && (
              <select
                id={`p-${spec.key}`}
                value={current === undefined ? (spec.default ?? '') : String(current)}
                onChange={(e) => onChange(spec.key, e.target.value === '' ? undefined : e.target.value)}
              >
                {spec.default === undefined && <option value="">{t('param.providerDefault')}</option>}
                {spec.values.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}

            {spec.kind === 'int' && (
              <div className="row">
                <input
                  id={`p-${spec.key}`}
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={1}
                  value={current === undefined ? '' : String(current)}
                  placeholder={spec.default !== undefined ? String(spec.default) : `${spec.min}–${spec.max}`}
                  onChange={(e) => onChange(spec.key, e.target.value === '' ? undefined : Number(e.target.value))}
                />
                {spec.key === 'seed' && (
                  <button
                    className="btn btn-icon"
                    title={t('param.randomSeed')}
                    onClick={() => onChange(spec.key, Math.floor(Math.random() * 2147483647))}
                  >
                    <Icon name="dice" />
                  </button>
                )}
              </div>
            )}

            {spec.kind === 'number' && (
              <div className="row">
                <input
                  id={`p-${spec.key}`}
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={Number(current ?? spec.default ?? spec.min)}
                  onChange={(e) => onChange(spec.key, Number(e.target.value))}
                />
                <span className="mono faint range-value">{Number(current ?? spec.default ?? spec.min)}</span>
              </div>
            )}

            {spec.kind === 'text' && (
              <input
                id={`p-${spec.key}`}
                type="text"
                placeholder={placeholderFor(spec.key, spec.placeholder)}
                value={current === undefined ? '' : String(current)}
                onChange={(e) => onChange(spec.key, e.target.value === '' ? undefined : e.target.value)}
              />
            )}

            {helpFor(spec.key, spec.help) && <div className="help">{helpFor(spec.key, spec.help)}</div>}
          </div>
        );
      })}
    </div>
  );
}
