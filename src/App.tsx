import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge, type KeyState } from './lib/api';
import type { Catalog, Job, ModeId, Settings } from './lib/types';
import { MODES } from './lib/modes';
import { formatMoney } from './lib/pricing';
import { I18nContext, closestLang, isLang, translator, type Lang } from './lib/i18n';
import Icon, { type IconName } from './components/Icon';
import Onboarding from './screens/Onboarding';
import Studio from './screens/Studio';
import LibraryScreen from './screens/LibraryScreen';
import SettingsScreen from './screens/SettingsScreen';
import { ToastStack, useToasts } from './components/Toasts';

type Route = { kind: 'studio'; mode: ModeId } | { kind: 'library' } | { kind: 'settings' };

const MODE_ICONS: Record<ModeId, IconName> = {
  image: 'image',
  'image-edit': 'imageEdit',
  video: 'video',
  'video-from-image': 'imageToVideo',
  'video-upscale': 'upscale',
  speech: 'speech',
  audio: 'music',
  transcribe: 'transcript',
};

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyState, setKeyState] = useState<KeyState | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [route, setRoute] = useState<Route>({ kind: 'studio', mode: 'image' });
  const [booting, setBooting] = useState(true);
  const { toasts, push, dismiss } = useToasts();

  // The stored value can be a full locale such as "it-IT" on first run, so it
  // is narrowed to a language the app actually ships.
  const lang: Lang = isLang(settings?.language) ? settings.language : closestLang(settings?.language);
  const t = useMemo(() => translator(lang), [lang]);
  const i18n = useMemo(() => ({ lang, t }), [lang, t]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, k] = await Promise.all([bridge.settings.get(), bridge.key.status()]);
        if (cancelled) return;
        setSettings(s);
        setKeyState(k);
        setRoute({ kind: 'studio', mode: s.lastMode });
      } catch (err) {
        push(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [push]);

  // --- theme --------------------------------------------------------------
  useEffect(() => {
    if (!settings) return;
    const apply = () => {
      const theme =
        settings.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : settings.theme;
      document.documentElement.dataset.theme = theme;
    };
    apply();
    if (settings.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings]);

  // --- catalog ------------------------------------------------------------
  const loadCatalog = useCallback(async (force = false) => {
    setCatalogError(null);
    try {
      setCatalog(await bridge.catalog.get(force));
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (keyState?.valid) void loadCatalog();
  }, [keyState?.valid, loadCatalog]);

  // --- jobs ---------------------------------------------------------------
  useEffect(() => {
    void bridge.jobs.list().then(setJobs);
    // Removals arrive as a whole list, since a per-job event cannot say "gone".
    const stopList = bridge.jobs.onList(setJobs);
    const stopUpdate = bridge.jobs.onUpdate((job) => {
      setJobs((current) => {
        const next = current.filter((j) => j.id !== job.id);
        return [job, ...next].sort((a, b) => b.createdAt - a.createdAt);
      });
      if (job.status === 'error') push(`${job.modelName}: ${job.error ?? 'failed'}`, 'error');
    });
    return () => {
      stopList();
      stopUpdate();
    };
  }, [push]);

  // Refresh the balance whenever spending actually happened.
  const finishedCount = useMemo(() => jobs.filter((j) => j.status === 'done').length, [jobs]);
  useEffect(() => {
    if (!finishedCount || !keyState?.valid) return;
    void bridge.key.status().then(setKeyState).catch(() => undefined);
    void bridge.settings.get().then(setSettings).catch(() => undefined);
  }, [finishedCount, keyState?.valid]);

  const patchSettings = useCallback(async (changes: Partial<Settings>) => {
    setSettings(await bridge.settings.update(changes));
  }, []);

  const onKeySaved = useCallback(async () => {
    const [s, k] = await Promise.all([bridge.settings.get(), bridge.key.status()]);
    setSettings(s);
    setKeyState(k);
    void loadCatalog(true);
  }, [loadCatalog]);

  if (booting) {
    return (
      <div className="onboarding">
        <div className="row">
          <div className="spin" />
          <span className="muted">{t('app.starting')}</span>
        </div>
      </div>
    );
  }

  if (!keyState?.valid) {
    return (
      <I18nContext.Provider value={i18n}>
        <Onboarding keyState={keyState} onSaved={onKeySaved} push={push} />
        <ToastStack toasts={toasts} dismiss={dismiss} />
      </I18nContext.Provider>
    );
  }

  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const balance = keyState.credits
    ? Math.max(0, keyState.credits.total - keyState.credits.used)
    : (keyState.limitRemaining ?? null);

  return (
    <I18nContext.Provider value={i18n}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark" />
            <div className="brand-text">
              <div className="brand-name">Kaleido</div>
              <div className="brand-sub">{t('app.subtitle')}</div>
            </div>
          </div>

          <div className="section-title">{t('nav.generate')}</div>
          {MODES.map((mode) => {
            const count = catalog?.models[mode.id]?.length ?? 0;
            const active = route.kind === 'studio' && route.mode === mode.id;
            return (
              <button
                key={mode.id}
                className={`nav-item${active ? ' active' : ''}`}
                onClick={() => {
                  setRoute({ kind: 'studio', mode: mode.id });
                  void patchSettings({ lastMode: mode.id });
                }}
                title={t(`mode.${mode.id}.hint`)}
                disabled={catalog !== null && count === 0}
              >
                <Icon name={MODE_ICONS[mode.id]} />
                <span className="nav-label">{t(`mode.${mode.id}.label`)}</span>
                <span className="nav-count">{catalog ? count : ''}</span>
              </button>
            );
          })}

          <div className="sidebar-foot">
            <button
              className={`nav-item${route.kind === 'library' ? ' active' : ''}`}
              onClick={() => setRoute({ kind: 'library' })}
            >
              <Icon name="library" />
              <span className="nav-label">{t('nav.library')}</span>
            </button>
            <button
              className={`nav-item${route.kind === 'settings' ? ' active' : ''}`}
              onClick={() => setRoute({ kind: 'settings' })}
            >
              <Icon name="settings" />
              <span className="nav-label">{t('nav.settings')}</span>
            </button>

            <div className="balance">
              <div className="spread">
                <span className="faint">{t('nav.credit')}</span>
                <span className="mono">{formatMoney(balance)}</span>
              </div>
              <div className="spread">
                <span className="faint">{t('nav.spentHere')}</span>
                <span className="mono">{formatMoney(settings?.spendTotal ?? 0)}</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="main">
          {route.kind === 'studio' && settings && (
            <Studio
              mode={route.mode}
              catalog={catalog}
              catalogError={catalogError}
              settings={settings}
              jobs={jobs}
              activeJobs={activeJobs}
              push={push}
              reloadCatalog={loadCatalog}
              patchSettings={patchSettings}
              setSettings={setSettings}
            />
          )}
          {route.kind === 'library' && <LibraryScreen push={push} />}
          {route.kind === 'settings' && settings && (
            <SettingsScreen
              settings={settings}
              keyState={keyState}
              setSettings={setSettings}
              onKeyChanged={onKeySaved}
              push={push}
            />
          )}
        </div>

        <ToastStack toasts={toasts} dismiss={dismiss} />
      </div>
    </I18nContext.Provider>
  );
}
