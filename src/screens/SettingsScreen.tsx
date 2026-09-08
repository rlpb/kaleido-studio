import { useEffect, useState } from 'react';
import { bridge, type AppInfo, type KeyState } from '../lib/api';
import type { Settings } from '../lib/types';
import { formatMoney } from '../lib/pricing';
import { LANGUAGES, useT } from '../lib/i18n';
import Icon from '../components/Icon';

type Push = (text: string, tone?: 'info' | 'ok' | 'error') => void;

interface Props {
  settings: Settings;
  keyState: KeyState;
  setSettings: (settings: Settings) => void;
  onKeyChanged: () => Promise<void>;
  push: Push;
}

export default function SettingsScreen({ settings, keyState, setSettings, onKeyChanged, push }: Props) {
  const t = useT();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge.app.info().then(setInfo);
  }, []);

  const replaceKey = async () => {
    if (!newKey.trim()) return;
    setBusy(true);
    try {
      const result = await bridge.key.set(newKey.trim());
      if (!result.valid) {
        push(result.error ?? t('settings.keyRejected'), 'error');
        return;
      }
      setNewKey('');
      await onKeyChanged();
      push(t('settings.keyUpdated'), 'ok');
    } finally {
      setBusy(false);
    }
  };

  const balance = keyState.credits ? Math.max(0, keyState.credits.total - keyState.credits.used) : null;
  const currentLang = LANGUAGES.find((l) => l.code === settings.language)?.code ?? 'en';

  return (
    <>
      <div className="topbar">
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="settings">
        <section className="card">
          <div className="section-title">{t('settings.account')}</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="value mono">{formatMoney(balance)}</div>
              <div className="label">{t('settings.creditRemaining')}</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatMoney(keyState.usage ?? 0)}</div>
              <div className="label">{t('settings.usageOnKey')}</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatMoney(settings.spendTotal)}</div>
              <div className="label">{t('settings.spentFromApp')}</div>
            </div>
          </div>

          <div className="row wrap gap-top">
            <span className={`chip ${keyState.valid ? 'chip-ok' : 'chip-danger'}`}>
              {keyState.valid ? t('settings.keyValid') : t('settings.keyInvalid')}
            </span>
            <span className={`chip ${keyState.encrypted ? 'chip-ok' : 'chip-warn'}`}>
              {keyState.encrypted ? t('settings.encrypted') : t('settings.plaintext')}
            </span>
            {keyState.label && <span className="chip mono">{keyState.label}</span>}
            {keyState.isFreeTier && <span className="chip chip-warn">{t('settings.freeTier')}</span>}
          </div>

          {!keyState.encrypted && (
            <div className="help gap-top">{t('settings.noKeychain', { path: info?.userData ?? '' })}</div>
          )}

          <div className="field gap-top">
            <label htmlFor="newkey">{t('settings.replaceKey')}</label>
            <div className="row">
              <div className="input-with-icon grow">
                <Icon name="key" />
                <input
                  id="newkey"
                  type="password"
                  className="mono"
                  placeholder="sk-or-v1-…"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
              </div>
              <button className="btn" onClick={() => void replaceKey()} disabled={busy || !newKey.trim()}>
                {t('settings.save')}
              </button>
            </div>
          </div>

          <div className="row gap-top">
            <button
              className="btn btn-ghost btn-sm danger"
              onClick={async () => {
                await bridge.key.clear();
                await onKeyChanged();
              }}
            >
              <Icon name="trash" />
              {t('settings.removeKey')}
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                setSettings(await bridge.settings.resetSpend());
                push(t('settings.counterReset'), 'ok');
              }}
            >
              {t('settings.resetSpend')}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="section-title">{t('settings.appearance')}</div>

          <div className="field">
            <label htmlFor="language">{t('settings.language')}</label>
            <select
              id="language"
              value={currentLang}
              onChange={async (e) => setSettings(await bridge.settings.update({ language: e.target.value }))}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <div className="help">{t('settings.languageHelp')}</div>
          </div>

          <div className="field gap-top">
            <label htmlFor="theme">{t('settings.theme')}</label>
            <select
              id="theme"
              value={settings.theme}
              onChange={async (e) =>
                setSettings(await bridge.settings.update({ theme: e.target.value as Settings['theme'] }))
              }
            >
              <option value="dark">{t('settings.themeDark')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="system">{t('settings.themeSystem')}</option>
            </select>
          </div>

          <div className="field gap-top">
            <label htmlFor="concurrency">{t('settings.concurrency')}</label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={6}
              value={settings.concurrency}
              onChange={async (e) => setSettings(await bridge.settings.update({ concurrency: Number(e.target.value) }))}
            />
            <div className="help">{t('settings.concurrencyHelp')}</div>
          </div>
        </section>

        <section className="card">
          <div className="section-title">{t('settings.library')}</div>
          <div className="field">
            <label>{t('settings.libraryFolder')}</label>
            <div className="row">
              <input readOnly className="mono" value={settings.libraryPath} />
              <button className="btn" onClick={async () => setSettings(await bridge.settings.pickLibrary())}>
                <Icon name="folder" />
                {t('settings.change')}
              </button>
            </div>
            <div className="help">{t('settings.libraryHelp')}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm gap-top"
            onClick={async () => {
              await bridge.prompts.clear();
              push(t('settings.promptsCleared'), 'ok');
            }}
          >
            {t('settings.clearPrompts')}
          </button>
        </section>

        <section className="card">
          <div className="section-title">{t('settings.about')}</div>
          <div className="mono faint about">
            <div>Kaleido Studio {info?.version}</div>
            <div>
              Electron {info?.electron} · {info?.platform}
            </div>
            <div>{info?.userData}</div>
          </div>
          <div className="row gap-top">
            <button
              className="btn btn-sm"
              onClick={() => void bridge.app.openExternal('https://github.com/rlpb/kaleido-studio')}
            >
              <Icon name="external" />
              {t('settings.repository')}
            </button>
            <button className="btn btn-sm" onClick={() => void bridge.app.openExternal('https://openrouter.ai/docs')}>
              <Icon name="external" />
              {t('settings.docs')}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
