import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bridge } from '../lib/api';
import type { Catalog, Job, ModelInfo, ModeId, Preset, Settings } from '../lib/types';
import { countChanged, defaultsFor } from '../lib/params';
import { MODE_BY_ID, PROMPT_REQUIRED } from '../lib/modes';
import { estimateCost, formatCost, formatDuration, priceSummary } from '../lib/pricing';
import ModelPicker from '../components/ModelPicker';
import CapabilityForm from '../components/CapabilityForm';
import InputAssets from '../components/InputAssets';
import { MediaCard, type MediaRef } from '../components/MediaCard';
import MediaViewer from '../components/MediaViewer';
import Icon from '../components/Icon';
import { useT } from '../lib/i18n';
import type { Dict } from '../lib/locales/en';

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

/** Counts up once a second so a running job shows how long it has been working. */
function Elapsed({ since }: { since?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  if (!since) return null;
  return <span className="mono tiny">{formatDuration(Date.now() - since)}</span>;
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
  const t = useT();
  const def = MODE_BY_ID[mode];
  const models = useMemo(() => catalog?.models[mode] ?? [], [catalog, mode]);

  const [modelId, setModelId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [params, setParams] = useState<Record<string, Value>>({});
  const [inputs, setInputs] = useState<string[]>([]);
  const [batch, setBatch] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);

  // Read through a ref so this effect depends on the mode and the catalog only.
  //
  // Depending on the settings object made it fire on every unrelated settings
  // write, and two of those happen while a user is working: choosing a model
  // saves lastModelByMode, and finishing a job reloads settings to refresh the
  // balance. Each one re-ran the reset below, which cleared the attached input
  // images and threw away the parameters the user had set. In Edit images that
  // turned an edit into a plain text-to-image run, so the result came back with
  // no relation to the picture that had been attached.
  const rememberedModels = useRef(settings.lastModelByMode);
  rememberedModels.current = settings.lastModelByMode;

  useEffect(() => {
    if (!models.length) {
      setModelId(null);
      return;
    }
    const next = models.find((m) => m.id === rememberedModels.current[mode]) ?? models[0];
    setModelId(next.id);
    setParams(defaultsFor(next));
    setInputs([]);
  }, [mode, models]);

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

  // How many knobs sit at something other than where they rest, so a collapsed
  // panel still says whether anything inside it was touched. Counted over the
  // model's own specs, so a leftover key from a previous model cannot inflate it.
  const changedParams = useMemo(() => countChanged(model, params), [model, params]);

  const promptNeeded = PROMPT_REQUIRED.includes(mode);
  const promptUseful = promptNeeded || mode === 'video-from-image' || mode === 'video-upscale';
  const missingInputs = def.needsInput ? inputs.length < def.needsInput.min : false;
  const canRun = Boolean(model) && !(promptNeeded && !prompt.trim()) && !missingInputs;

  const run = useCallback(async () => {
    if (!model || !canRun) return;
    try {
      await bridge.jobs.enqueue({ mode, modelId: model.id, prompt, params, inputs, batch }, model.name);
      void bridge.prompts.list().then(setHistory);
      push(batch > 1 ? t('studio.queued', { n: batch }) : t('studio.started'), 'ok');
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
            // The duration belongs to the run, not to one file of it, so every
            // output of a multi-image response carries the same figure.
            durationMs:
              job.finishedAt !== undefined && job.startedAt !== undefined ? job.finishedAt - job.startedAt : undefined,
            createdAt: job.finishedAt ?? job.createdAt,
          })),
        ),
    [modeJobs],
  );

  const savePreset = async () => {
    if (!model) return;
    const name = window.prompt(t('studio.presetName'), `${t(`mode.${mode}.label`)} · ${model.name}`);
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
    push(t('studio.presetSaved'), 'ok');
  };

  const modePresets = presets.filter((p) => p.mode === mode);

  return (
    <>
      <div className="topbar">
        <h1>{t(`mode.${mode}.label`)}</h1>
        <span className="faint ellipsis">{t(`mode.${mode}.hint`)}</span>
        <div className="spacer" />
        {activeJobs > 0 && (
          <span className="chip chip-accent">
            <span className="spin sm" /> {t('studio.running', { n: activeJobs })}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void reloadCatalog(true)} title={t('studio.reloadModelsTitle')}>
          <Icon name="refresh" />
          {t('studio.reloadModels')}
        </button>
      </div>

      <div className="studio">
        <div className="panel">
          <div className="panel-scroll">
          {catalogError && (
            <div className="banner banner-danger">
              <Icon name="alert" />
              <span>
                {t('studio.catalogFailed')} {catalogError}
              </span>
            </div>
          )}

          <div className="field">
            <label>{t('studio.model')}</label>
            {!catalog && (
              <div className="row">
                <span className="spin" /> <span className="faint">{t('studio.loadingCatalog')}</span>
              </div>
            )}
            {catalog && models.length === 0 && (
              <div className="faint">{t('studio.noModels')}</div>
            )}
            {model && (
              <button className="model-button" onClick={() => setPickerOpen(true)}>
                <div className="model-button-text">
                  <div className="name">{model.name}</div>
                  <div className="sub mono">{priceSummary(model, t)}</div>
                </div>
                <Icon name="chevronDown" />
              </button>
            )}
          </div>

          {promptUseful && (
            <div className="field">
              <label htmlFor="prompt">
                {mode === 'speech' ? t('studio.textToSpeak') : t('studio.prompt')}
                {promptNeeded && <span className="required"> *</span>}
              </label>
              <textarea
                id="prompt"
                value={prompt}
                placeholder={
                  mode === 'speech'
                    ? t('studio.speechPlaceholder')
                    : t('studio.promptPlaceholder')
                }
                onChange={(e) => setPrompt(e.target.value)}
              />
              {history.length > 0 && (
                <div className="row">
                  <select
                    className="grow"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setPrompt(e.target.value);
                    }}
                  >
                    <option value="">{t('studio.reuseRecentPrompt')}</option>
                    {history.slice(0, 30).map((entry, i) => (
                      <option key={i} value={entry}>
                        {entry.slice(0, 90)}
                      </option>
                    ))}
                  </select>
                  {/* Sits next to the list rather than in Settings, so clearing
                      it is where the thing being cleared is visible, and the
                      list on screen updates instead of going stale. */}
                  <button
                    className="btn btn-ghost btn-icon danger"
                    title={t('studio.clearHistory')}
                    onClick={async () => {
                      if (!window.confirm(t('studio.clearHistoryConfirm', { n: history.length }))) return;
                      await bridge.prompts.clear();
                      setHistory([]);
                      push(t('settings.promptsCleared'), 'ok');
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Accepting a reference image and editing one are different
              capabilities, and the catalog has no flag separating them. A model
              that only takes a style hint returns a picture unrelated to the one
              supplied, at full price, with no error anywhere. */}
          {mode === 'image-edit' && model && !model.claimsEditing && (
            <div className="banner banner-warn">
              <Icon name="alert" />
              <span>{t('studio.mayNotEdit', { n: model.maxReferences })}</span>
            </div>
          )}

          {def.needsInput && (
            <InputAssets
              kind={def.needsInput.kind}
              // Only the four modes with needsInput reach this line, and those are
              // exactly the ones with an .input key in the dictionary.
              label={t(`mode.${mode}.input` as keyof Dict)}
              min={def.needsInput.min}
              max={def.needsInput.max}
              files={inputs}
              onChange={setInputs}
              frameMode={mode === 'video-from-image'}
            />
          )}

          {/* Collapsed by default: most runs use the provider defaults, and the
              knobs are worth a click only when one of them needs changing. The
              badge keeps a closed section from hiding a setting the user made. */}
          <details className="params">
            <summary>
              <Icon name="chevronDown" />
              <span className="section-title">{t('studio.modelParameters')}</span>
              <div className="spacer" />
              {changedParams > 0 ? (
                <span className="chip chip-accent tiny">{t('studio.paramsChanged', { n: changedParams })}</span>
              ) : (
                <span className="faint tiny">{t('studio.paramsCount', { n: model?.params.length ?? 0 })}</span>
              )}
            </summary>
            <CapabilityForm params={model?.params ?? []} values={params} onChange={setParam} />
          </details>

          {modePresets.length > 0 && (
            <div className="field">
              <label>{t('studio.presets')}</label>
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
                <option value="">{t('studio.applyPreset')}</option>
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
                <span className="cost-label">{t('studio.estimatedCost')}</span>
                <span className={`chip ${BASIS_TONE[estimate.basis] ?? ''}`}>{t(`basis.${estimate.basis}`)}</span>
              </div>
              <div className="cost-amount mono">{formatCost(estimate.total, t)}</div>
              <div className="help">{t(estimate.detailKey, estimate.detailVars)}</div>
            </div>

            <div className="row">
              <div className="field batch">
                <label htmlFor="batch">{t('studio.count')}</label>
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
                {t('studio.generate')}
                <span className="kbd inverse">Ctrl ↵</span>
              </button>
            </div>

            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => void savePreset()} disabled={!model}>
                {t('studio.savePreset')}
              </button>
              <div className="spacer" />
              {!canRun && (
                <span className="faint tiny">
                  {promptNeeded && !prompt.trim() ? t('studio.promptMissing') : missingInputs ? t('studio.inputsMissing') : ''}
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
                      <span className="faint mono tiny">
                        {t(job.progressKey, job.progressVars)}
                        {job.startedAt !== undefined && (
                          <>
                            {' · '}
                            <Elapsed since={job.startedAt} />
                          </>
                        )}
                      </span>
                    </div>
                    <div className="faint tiny ellipsis">{job.prompt || t('studio.noPrompt')}</div>
                    <div className="bar">
                      <span />
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => void bridge.jobs.cancel(job.id)}>
                    {t('studio.cancel')}
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
                    title={t('studio.copyError')}
                    onClick={() => {
                      void navigator.clipboard.writeText(job.error ?? '');
                      push(t('studio.errorCopied'), 'ok');
                    }}
                  >
                    <Icon name="copy" />
                  </button>
                  <button className="btn btn-sm" title={t('studio.retryTitle')} onClick={() => void bridge.jobs.retry(job.id)}>
                    <Icon name="refresh" />
                    {t('studio.retry')}
                  </button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm self-start" onClick={() => void bridge.jobs.clear()}>
                {t('studio.clearErrors')}
              </button>
            </div>
          )}

          {results.length === 0 && pending.length === 0 ? (
            <div className="empty">
              <Icon name={def.outputKind === 'video' ? 'video' : def.outputKind === 'audio' ? 'music' : 'image'} size={30} />
              <div>{t('studio.emptyTitle')}</div>
              <div className="tiny">{t('studio.emptyHint')}</div>
            </div>
          ) : (
            <div className="grid">
              {results.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  push={push}
                  onOpen={(ref) => setViewing(results.findIndex((r) => r.id === ref.id))}
                  onUsePrompt={setPrompt}
                  onReuse={(ref) => {
                    if (def.needsInput) setInputs([ref.path]);
                    else push(t('studio.noInputMode'), 'info');
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

      {viewing !== null && viewing >= 0 && (
        <MediaViewer items={results} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} push={push} />
      )}
    </>
  );
}
