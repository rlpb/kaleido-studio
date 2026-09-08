import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge } from '../lib/api';
import type { Catalog, Job, ModelInfo, ModeId, Preset, Settings } from '../lib/types';
import { MODE_BY_ID, PROMPT_REQUIRED } from '../lib/modes';
import { estimateCost, formatCost } from '../lib/pricing';
import ModelPicker, { priceSummary } from '../components/ModelPicker';
import CapabilityForm from '../components/CapabilityForm';
import InputAssets from '../components/InputAssets';
import { MediaCard, MediaViewer, type MediaRef } from '../components/MediaCard';

type Value = string | number | boolean;
type Push = (text: string, tone?: 'info' | 'ok' | 'error') => void;

interface Props {
  mode: ModeId;
  catalog: Catalog | null;
  catalogError: string | null;
  settings: Settings;
  jobs: Job[];
  activeJobs: number;
  push: Push;
  reloadCatalog: (force?: boolean) => Promise<void>;
  patchSettings: (changes: Partial<Settings>) => Promise<void>;
  setSettings: (settings: Settings) => void;
}

/** Seeds the form with every default the model declares. */
function defaultsFor(model: ModelInfo | undefined): Record<string, Value> {
  const values: Record<string, Value> = {};
  for (const spec of model?.params ?? []) {
    if ('default' in spec && spec.default !== undefined) values[spec.key] = spec.default;
  }
  return values;
}

export default function Studio({
  mode,
  catalog,
  catalogError,
  settings,
  jobs,
  activeJobs,
  push,
  reloadCatalog,
  patchSettings,
  setSettings,
}: Props) {
  const def = MODE_BY_ID[mode];
  const models = useMemo(() => catalog?.models[mode] ?? [], [catalog, mode]);

  const [modelId, setModelId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<Record<string, Value>>({});
  const [inputs, setInputs] = useState<string[]>([]);
  const [batch, setBatch] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewing, setViewing] = useState<MediaRef | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);

  // Pick up the model remembered for this mode, or fall back to the first one.
  useEffect(() => {
    if (!models.length) {
      setModelId(null);
      return;
    }
    const remembered = settings.lastModelByMode[mode];
    const next = models.find((m) => m.id === remembered) ?? models[0];
    setModelId(next.id);
    setParams(defaultsFor(next));
    setInputs([]);
  }, [mode, models, settings.lastModelByMode]);

  useEffect(() => {
    void bridge.presets.list().then(setPresets);
    void bridge.prompts.list().then(setHistory);
  }, []);

  const selectModel = useCallback(
    (next: ModelInfo) => {
      setModelId(next.id);
      setParams(defaultsFor(next));
      void patchSettings({ lastModelByMode: { ...settings.lastModelByMode, [mode]: next.id } });
    },
    [mode, patchSettings, settings.lastModelByMode],
  );

  const setParam = useCallback((key: string, value: Value | undefined) => {
    setParams((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  const estimate = useMemo(
    () => estimateCost(model, params, batch, settings.observedCosts),
    [model, params, batch, settings.observedCosts],
  );

  const promptNeeded = PROMPT_REQUIRED.includes(mode);
  const missingInputs = def.needsInput ? inputs.length < def.needsInput.min : false;
  const canRun = Boolean(model) && !(promptNeeded && !prompt.trim()) && !missingInputs;

  const run = useCallback(async () => {
    if (!model || !canRun) return;
    try {
      await bridge.jobs.enqueue({ mode, modelId: model.id, prompt, params, inputs, batch }, model.name);
      void bridge.prompts.list().then(setHistory);
      push(batch > 1 ? `${batch} generazioni in coda` : 'Generazione avviata', 'ok');
    } catch (err) {
      push(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [model, canRun, mode, prompt, params, inputs, batch, push]);

  // Ctrl/Cmd+Enter runs from anywhere on the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const modeJobs = useMemo(() => jobs.filter((j) => j.mode === mode), [jobs, mode]);
  const pending = modeJobs.filter((j) => j.status === 'queued' || j.status === 'running');

  const results: MediaRef[] = useMemo(
    () =>
      modeJobs
        .filter((j) => j.status === 'done')
        .flatMap((job) =>
          job.outputs.map((out, i) => ({
            id: `${job.id}-${i}`,
            path: out.path,
            kind: out.kind,
            mediaType: out.mediaType,
            text: out.text,
            prompt: job.prompt,
            modelName: job.modelName,
            cost: i === 0 ? job.cost : undefined,
            createdAt: job.finishedAt ?? job.createdAt,
          })),
        ),
    [modeJobs],
  );

  const savePreset = async () => {
    if (!model) return;
    const name = window.prompt('Nome del preset', `${def.label} · ${model.name}`);
    if (!name) return;
    setPresets(
      await bridge.presets.save({
        id: `${Date.now()}`,
        name,
        mode,
        modelId: model.id,
        prompt,
        params,
        createdAt: Date.now(),
      }),
    );
    push('Preset salvato', 'ok');
  };

  const applyPreset = (preset: Preset) => {
    const target = models.find((m) => m.id === preset.modelId);
    if (target) setModelId(target.id);
    setPrompt(preset.prompt);
    setParams(preset.params);
  };

  const modePresets = presets.filter((p) => p.mode === mode);

  return (
    <>
      <div className="topbar">
        <h1>{def.label}</h1>
        <span className="faint">{def.hint}</span>
        <div className="spacer" />
        {activeJobs > 0 && (
          <span className="chip chip-accent">
            <span className="spin" style={{ width: 10, height: 10 }} /> {activeJobs} in corso
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void reloadCatalog(true)} title="Ricarica il catalogo da OpenRouter">
          ⟳ Modelli
        </button>
      </div>

      <div className="studio">
        <div className="panel">
          {catalogError && (
            <div className="chip chip-danger" style={{ whiteSpace: 'normal' }}>
              Catalogo non caricato: {catalogError}
            </div>
          )}

          <div className="field">
            <label>Modello</label>
            {!catalog && <div className="row"><span className="spin" /> <span className="faint">Carico il catalogo…</span></div>}
            {catalog && models.length === 0 && (
              <div className="faint">Nessun modello disponibile su OpenRouter per questa modalità.</div>
            )}
            {model && (
              <button className="model-button" onClick={() => setPickerOpen(true)}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{model.name}</div>
                  <div className="sub mono">{priceSummary(model)}</div>
                </div>
                <span className="faint">▾</span>
              </button>
            )}
          </div>

          {promptNeeded || mode === 'video-from-image' || mode === 'video-upscale' ? (
            <div className="field">
              <label htmlFor="prompt">
                {mode === 'speech' ? 'Testo da leggere' : 'Prompt'}
                {promptNeeded && <span style={{ color: 'var(--danger)' }}> *</span>}
              </label>
              <textarea
                id="prompt"
                value={prompt}
                placeholder={
                  mode === 'speech'
                    ? 'Scrivi qui il testo che vuoi sentire pronunciato…'
                    : 'Descrivi cosa vuoi ottenere. Più sei specifico su soggetto, luce e inquadratura, più il risultato è controllabile.'
                }
                onChange={(e) => setPrompt(e.target.value)}
              />
              {history.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setPrompt(e.target.value);
                  }}
                >
                  <option value="">Riprendi un prompt recente…</option>
                  {history.slice(0, 30).map((entry, i) => (
                    <option key={i} value={entry}>
                      {entry.slice(0, 90)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {def.needsInput && (
            <InputAssets
              kind={def.needsInput.kind}
              label={def.needsInput.label}
              min={def.needsInput.min}
              max={def.needsInput.max}
              files={inputs}
              onChange={setInputs}
              frameMode={mode === 'video-from-image'}
            />
          )}

          <div>
            <div className="section-title">Parametri del modello</div>
            <CapabilityForm params={model?.params ?? []} values={params} onChange={setParam} />
          </div>

          {modePresets.length > 0 && (
            <div className="field">
              <label>Preset</label>
              <select
                value=""
                onChange={(e) => {
                  const preset = modePresets.find((p) => p.id === e.target.value);
                  if (preset) applyPreset(preset);
                }}
              >
                <option value="">Applica un preset…</option>
                {modePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="run-bar">
            <div className="cost-box">
              <div className="spread">
                <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Costo stimato
                </span>
                <span className={`chip ${estimate.basis === 'listino' ? 'chip-ok' : estimate.basis === 'misurato' ? 'chip-accent' : ''}`}>
                  {estimate.basis}
                </span>
              </div>
              <div className="cost-amount mono">{formatCost(estimate.total)}</div>
              <div className="help">{estimate.detail}</div>
            </div>

            <div className="row">
              <div className="field" style={{ width: 92 }}>
                <label htmlFor="batch">Quantità</label>
                <input
                  id="batch"
                  type="number"
                  min={1}
                  max={8}
                  value={batch}
                  onChange={(e) => setBatch(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
              <button className="btn btn-primary" style={{ flex: 1, marginTop: 18 }} onClick={() => void run()} disabled={!canRun}>
                Genera <span className="kbd" style={{ color: 'inherit', opacity: 0.8 }}>Ctrl ↵</span>
              </button>
            </div>

            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => void savePreset()} disabled={!model}>
                Salva preset
              </button>
              <div className="spacer" />
              {!canRun && (
                <span className="faint" style={{ fontSize: 11 }}>
                  {promptNeeded && !prompt.trim() ? 'Manca il prompt' : missingInputs ? 'Mancano i file di input' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="canvas">
          {pending.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pending.map((job) => (
                <div className="job" key={job.id}>
                  <div className="spin" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="spread">
                      <strong style={{ fontSize: 12.5 }}>{job.modelName}</strong>
                      <span className="faint mono" style={{ fontSize: 11 }}>
                        {job.progress}
                      </span>
                    </div>
                    <div className="faint" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.prompt || 'senza prompt'}
                    </div>
                    <div className="bar">
                      <span />
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => void bridge.jobs.cancel(job.id)}>
                    Annulla
                  </button>
                </div>
              ))}
            </div>
          )}

          {modeJobs.some((j) => j.status === 'error') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {modeJobs
                .filter((j) => j.status === 'error')
                .slice(0, 3)
                .map((job) => (
                  <div className="job" key={job.id} style={{ borderColor: 'var(--danger)' }}>
                    <span style={{ color: 'var(--danger)' }}>✕</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 12.5 }}>{job.modelName}</strong>
                      <div className="faint" style={{ fontSize: 11.5, whiteSpace: 'normal' }}>
                        {job.error}
                      </div>
                    </div>
                  </div>
                ))}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void bridge.jobs.clear()}>
                Pulisci gli errori
              </button>
            </div>
          )}

          {results.length === 0 && pending.length === 0 ? (
            <div className="empty">
              <div className="glyph">◍</div>
              <div>Ancora niente in questa sessione</div>
              <div style={{ fontSize: 12 }}>I risultati passati restano nella Libreria.</div>
            </div>
          ) : (
            <div className="grid">
              {results.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  push={push}
                  onOpen={setViewing}
                  onUsePrompt={setPrompt}
                  onReuse={(ref) => {
                    if (def.needsInput) setInputs([ref.path]);
                    else push('Questa modalità non accetta file in ingresso', 'info');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <ModelPicker
          models={models}
          selectedId={modelId}
          favorites={settings.favoriteModels}
          onSelect={selectModel}
          onClose={() => setPickerOpen(false)}
          onToggleFavorite={async (id) => {
            const favoriteModels = await bridge.settings.toggleFavorite(id);
            setSettings({ ...settings, favoriteModels });
          }}
        />
      )}

      {viewing && <MediaViewer item={viewing} onClose={() => setViewing(null)} push={push} />}
    </>
  );
}
