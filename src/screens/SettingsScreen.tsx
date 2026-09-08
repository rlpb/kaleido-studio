import { useEffect, useState } from 'react';
import { bridge, type AppInfo, type KeyState } from '../lib/api';
import type { Settings } from '../lib/types';
import { formatMoney } from '../lib/pricing';
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
        push(result.error ?? 'Key rejected', 'error');
        return;
      }
      setNewKey('');
      await onKeyChanged();
      push('Key updated', 'ok');
    } finally {
      setBusy(false);
    }
  };

  const balance = keyState.credits ? Math.max(0, keyState.credits.total - keyState.credits.used) : null;

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>

      <div className="settings">
        <section className="card">
          <div className="section-title">OpenRouter account</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="value mono">{formatMoney(balance)}</div>
              <div className="label">Credit remaining</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatMoney(keyState.usage ?? 0)}</div>
              <div className="label">Usage on this key</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatMoney(settings.spendTotal)}</div>
              <div className="label">Spent from Kaleido</div>
            </div>
          </div>

          <div className="row wrap gap-top">
            <span className={`chip ${keyState.valid ? 'chip-ok' : 'chip-danger'}`}>
              {keyState.valid ? 'key valid' : 'key invalid'}
            </span>
            <span className={`chip ${keyState.encrypted ? 'chip-ok' : 'chip-warn'}`}>
              {keyState.encrypted ? 'encrypted by the OS' : 'stored in plain text'}
            </span>
            {keyState.label && <span className="chip mono">{keyState.label}</span>}
            {keyState.isFreeTier && <span className="chip chip-warn">free tier account</span>}
          </div>

          {!keyState.encrypted && (
            <div className="help gap-top">
              No operating system keychain is available on this machine, so the key sits in plain text in the
              configuration file under {info?.userData ?? 'the app data folder'}.
            </div>
          )}

          <div className="field gap-top">
            <label htmlFor="newkey">Replace the key</label>
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
                Save
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
              Remove the key from this computer
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                setSettings(await bridge.settings.resetSpend());
                push('Counter reset', 'ok');
              }}
            >
              Reset the spend counter
            </button>
          </div>
        </section>

        <section className="card">
          <div className="section-title">Appearance and behaviour</div>
          <div className="field">
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              value={settings.theme}
              onChange={async (e) =>
                setSettings(await bridge.settings.update({ theme: e.target.value as Settings['theme'] }))
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match the system</option>
            </select>
          </div>

          <div className="field gap-top">
            <label htmlFor="concurrency">Parallel generations</label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={6}
              value={settings.concurrency}
              onChange={async (e) => setSettings(await bridge.settings.update({ concurrency: Number(e.target.value) }))}
            />
            <div className="help">How many requests start at once. Raising it shortens queues and spends faster.</div>
          </div>
        </section>

        <section className="card">
          <div className="section-title">Library</div>
          <div className="field">
            <label>Folder for generated files</label>
            <div className="row">
              <input readOnly className="mono" value={settings.libraryPath} />
              <button className="btn" onClick={async () => setSettings(await bridge.settings.pickLibrary())}>
                <Icon name="folder" />
                Change
              </button>
            </div>
            <div className="help">
              Files already saved stay where they are. Moving the folder only changes where the next ones land.
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm gap-top"
            onClick={async () => {
              await bridge.prompts.clear();
              push('Prompt history cleared', 'ok');
            }}
          >
            Clear the prompt history
          </button>
        </section>

        <section className="card">
          <div className="section-title">About</div>
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
              Repository
            </button>
            <button className="btn btn-sm" onClick={() => void bridge.app.openExternal('https://openrouter.ai/docs')}>
              <Icon name="external" />
              OpenRouter docs
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
