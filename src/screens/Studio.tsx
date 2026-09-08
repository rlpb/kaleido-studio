import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge } from '../lib/api';
import type { Catalog, Job, ModelInfo, ModeId, Preset, Settings } from '../lib/types';
import { MODE_BY_ID, PROMPT_REQUIRED } from '../lib/modes';
import { estimateCost, formatCost, priceSummary } from '../lib/pricing';
import ModelPicker from '../components/ModelPicker';
import CapabilityForm from '../components/CapabilityForm';
import InputAssets from '../components/InputAssets';
import { MediaCard, MediaViewer, type MediaRef } from '../components/MediaCard';
import Icon from '../components/Icon';

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

const BASIS_TONE: Record<string, string> = {
  'list price': 'chip-ok',
  measured: 'chip-accent',
  free: 'chip-ok',
  unknown: '',
};

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
  const promptUseful = promptNeeded || mode === 'video-from-image' || mode === 'video-upscale';
  const missingInputs = def.needsInput ? inputs.length < def.needsInput.min : false;
  const canRun = Boolean(model) && !(promptNeeded && !prompt.trim()) && !missingInputs;

  const run = useCallback(async () => {
    if (!model || !canRun) return;
    try {
      await bridge.jobs.enqueue({ mode, modelId: model.id, prompt, params, inputs, batch }, model.name);
      void bridge.prompts.list().then(setHistory);
      push(batch > 1 ? `${batch} runs queued` : 'Generation started', 'ok');
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
  const failed = modeJobs.filter((j) => j.status === 'error');

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
    const name = window.prompt('Preset name', `${def.label} · ${model.name}`);
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
    push('Preset saved', 'ok');
  };

  const modePresets = presets.filter((p) => p.mode === mode);

  return (
    <>
      <div className="topbar">
        <h1>{def.label}</h1>
        <span className="faint ellipsis">{def.hint}</span>
        <div className="spacer" />
        {activeJobs > 0 && (
          <span className="chip chip-accent">
            <span className="spin sm" /> {activeJobs} running
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void reloadCatalog(true)} title="Reload the catalog from OpenRouter">
          <Icon name="refresh" />
          Models
        </button>
      </div>

      <div className="studio">
        <div className="panel">
          <div className="panel-scroll">
          {catalogError && (
            <div className="banner banner-danger">
              <Icon name="alert" />
              <span>Catalog not loaded: {catalogError}</span>
            </div>
          )}

          <div className="field">
            <label>Model</label>
            {!catalog && (
              <div className="row">
                <span className="spin" /> <span className="faint">Loading the catalog…</span>
              </div>
            )}
            {catalog && models.length === 0 && (
              <div className="faint">OpenRouter currently offers no model for this mode.</div>
            )}
            {model && (
              <button className="model-button" onClick={() => setPickerOpen(true)}>
                <div className="model-button-text">
                  <div className="name">{model.name}</div>
                  <div className="sub mono">{priceSummary(model)}</div>
                </div>
                <Icon name="chevronDown" />
              </button>
            )}
          </div>

          {promptUseful && (
            <div className="field">
              <label htmlFor="prompt">
                {mode === 'speech' ? 'Text to speak' : 'Prompt'}
                {promptNeeded && <span className="required"> *</span>}
              </label>
              <textarea
                id="prompt"
                value={prompt}
                placeholder={
                  mode === 'speech'
                    ? 'Type the text you want spoken aloud…'
                    : 'Describe what you want. The more specific about subject, light and framing, the more control you get.'
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
                  <option value="">Reuse a recent prompt…</option>
                  {history.slice(0, 30).map((entry, i) => (
                    <option key={i} value={entry}>
                      {entry.slice(0, 90)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

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
            <div className="section-title">Model parameters</div>
            <CapabilityForm params={model?.params ?? []} values={params} onChange={setParam} />
          </div>

          {modePresets.length > 0 && (
            <div className="field">
              <label>Presets</label>
              <select
                value=""
                onChange={(e) => {
                  const preset = modePresets.find((p) => p.id === e.target.value);
                  if (!preset) return;
                  const target = models.find((m) => m.id === preset.modelId);
                  if (target) setModelId(target.id);
                  setPrompt(preset.prompt);
                  setParams(preset.params);
                }}
              >
                <option value="">Apply a preset…</option>
                {modePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          </div>

          <div className="run-bar">
            <div className="cost-box">
              <div className="spread">
                <span className="cost-label">Estimated cost</span>
                <span className={`chip ${BASIS_TONE[estimate.basis] ?? ''}`}>{estimate.basis}</span>
              </div>
              <div className="cost-amount mono">{formatCost(estimate.total)}</div>
              <div className="help">{estimate.detail}</div>
            </div>

            <div className="row">
              <div className="field batch">
                <label htmlFor="batch">Count</label>
                <input
                  id="batch"
                  type="number"
                  min={1}
                  max={8}
                  value={batch}
                  onChange={(e) => setBatch(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
              <button className="btn btn-primary btn-run" onClick={() => void run()} disabled={!canRun}>
                <Icon name="sparkle" />
                Generate
                <span className="kbd inverse">Ctrl ↵</span>
              </button>
            </div>

            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => void savePreset()} disabled={!model}>
                Save preset
              </button>
              <div className="spacer" />
              {!canRun && (
                <span className="faint tiny">
                  {promptNeeded && !prompt.trim() ? 'Prompt missing' : missingInputs ? 'Input files missing' : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="canvas">
          {pending.length > 0 && (
            <div className="stack">
              {pending.map((job) => (
                <div className="job" key={job.id}>
                  <div className="spin" />
                  <div className="job-body">
                    <div className="spread">
                      <strong className="small">{job.modelName}</strong>
                      <span className="faint mono tiny">{job.progress}</span>
                    </div>
                    <div className="faint tiny ellipsis">{job.prompt || 'no prompt'}</div>
                    <div className="bar">
                      <span />
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => void bridge.jobs.cancel(job.id)}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          )}

          {failed.length > 0 && (
            <div className="stack">
              {failed.slice(0, 3).map((job) => (
                <div className="job job-error" key={job.id}>
                  <Icon name="alert" />
                  <div className="job-body">
                    <strong className="small">{job.modelName}</strong>
                    <div className="faint small wrap-text">{job.error}</div>
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    title="Copy the error"
                    onClick={() => {
                      void navigator.clipboard.writeText(job.error ?? '');
                      push('Error copied', 'ok');
                    }}
                  >
                    <Icon name="copy" />
                  </button>
                  <button className="btn btn-sm" title="Run it again unchanged" onClick={() => void bridge.jobs.retry(job.id)}>
                    <Icon name="refresh" />
                    Retry
                  </button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm self-start" onClick={() => void bridge.jobs.clear()}>
                Clear errors
              </button>
            </div>
          )}

          {results.length === 0 && pending.length === 0 ? (
            <div className="empty">
              <Icon name={def.outputKind === 'video' ? 'video' : def.outputKind === 'audio' ? 'music' : 'image'} size={30} />
              <div>Nothing generated in this session yet</div>
              <div className="tiny">Earlier results stay in the Library.</div>
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
                    else push('This mode takes no input files', 'info');
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
