import { useEffect, useState } from 'react';
import { bridge, type AppInfo, type KeyState } from '../lib/api';
import type { Settings } from '../lib/types';
import { formatCost } from '../lib/pricing';

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
        push(result.error ?? 'Chiave rifiutata', 'error');
        return;
      }
      setNewKey('');
      await onKeyChanged();
      push('Chiave aggiornata', 'ok');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <h1>Impostazioni</h1>
      </div>

      <div className="settings">
        <div className="card">
          <div className="section-title">Account OpenRouter</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="value mono">
                {keyState.credits ? formatCost(Math.max(0, keyState.credits.total - keyState.credits.used)) : '—'}
              </div>
              <div className="label">Credito residuo</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatCost(keyState.usage ?? 0)}</div>
              <div className="label">Consumo della chiave</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatCost(settings.spendTotal)}</div>
              <div className="label">Speso da Kaleido</div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <span className={`chip ${keyState.valid ? 'chip-ok' : 'chip-danger'}`}>
              {keyState.valid ? 'chiave valida' : 'chiave non valida'}
            </span>
            <span className={`chip ${keyState.encrypted ? 'chip-ok' : 'chip-warn'}`}>
              {keyState.encrypted ? 'cifrata dal sistema' : 'salvata in chiaro'}
            </span>
            {keyState.label && <span className="chip mono">{keyState.label}</span>}
            {keyState.isFreeTier && <span className="chip chip-warn">account free tier</span>}
          </div>

          {!keyState.encrypted && (
            <div className="help" style={{ marginTop: 8 }}>
              Il portachiavi del sistema operativo non è disponibile su questa macchina, quindi la chiave resta in chiaro
              nel file di configurazione dentro {info?.userData ?? 'la cartella dati'}.
            </div>
          )}

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="newkey">Sostituisci la chiave</label>
            <div className="row">
              <input
                id="newkey"
                type="password"
                className="mono"
                placeholder="sk-or-v1-…"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <button className="btn" onClick={() => void replaceKey()} disabled={busy || !newKey.trim()}>
                Salva
              </button>
            </div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                await bridge.key.clear();
                await onKeyChanged();
              }}
            >
              Rimuovi la chiave da questo computer
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                setSettings(await bridge.settings.resetSpend());
                push('Contatore azzerato', 'ok');
              }}
            >
              Azzera il contatore di spesa
            </button>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Aspetto e comportamento</div>
          <div className="field">
            <label htmlFor="theme">Tema</label>
            <select
              id="theme"
              value={settings.theme}
              onChange={async (e) => setSettings(await bridge.settings.update({ theme: e.target.value as Settings['theme'] }))}
            >
              <option value="dark">Scuro</option>
              <option value="light">Chiaro</option>
              <option value="system">Come il sistema</option>
            </select>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="concurrency">Generazioni in parallelo</label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={6}
              value={settings.concurrency}
              onChange={async (e) => setSettings(await bridge.settings.update({ concurrency: Number(e.target.value) }))}
            />
            <div className="help">
              Quante richieste partono insieme. Alzarlo accorcia le code ma consuma credito più in fretta.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-title">Libreria</div>
          <div className="field">
            <label>Cartella dei file generati</label>
            <div className="row">
              <input readOnly className="mono" value={settings.libraryPath} />
              <button className="btn" onClick={async () => setSettings(await bridge.settings.pickLibrary())}>
                Cambia
              </button>
            </div>
            <div className="help">
              I file già salvati restano dove sono. Spostare la cartella cambia solo dove finiscono i prossimi.
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={async () => {
              await bridge.prompts.clear();
              push('Cronologia dei prompt svuotata', 'ok');
            }}
          >
            Svuota la cronologia dei prompt
          </button>
        </div>

        <div className="card">
          <div className="section-title">Informazioni</div>
          <div className="mono faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            <div>Kaleido Studio {info?.version}</div>
            <div>
              Electron {info?.electron} · {info?.platform}
            </div>
            <div>{info?.userData}</div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-sm" onClick={() => void bridge.app.openExternal('https://github.com/rlpb/kaleido-studio')}>
              Repository
            </button>
            <button className="btn btn-sm" onClick={() => void bridge.app.openExternal('https://openrouter.ai/docs')}>
              Documentazione OpenRouter
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
