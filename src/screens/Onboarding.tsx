import { useState } from 'react';
import { bridge, type KeyState } from '../lib/api';

interface Props {
  keyState: KeyState | null;
  onSaved: () => Promise<void>;
  push: (text: string, tone?: 'info' | 'ok' | 'error') => void;
}

/**
 * The whole first run: paste a key, it gets verified against OpenRouter and
 * stored encrypted. Nothing else is asked, everything after this is discovered
 * from the API.
 */
export default function Onboarding({ keyState, onSaved, push }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(keyState?.configured && !keyState.valid ? (keyState.error ?? null) : null);

  const submit = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.key.set(key);
      if (!result.valid) {
        setError(result.error ?? 'Chiave rifiutata da OpenRouter');
        return;
      }
      if (!result.encrypted) {
        push('Chiave salvata, ma il portachiavi di sistema non è disponibile: resta in chiaro nel file di configurazione.', 'info');
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="row">
          <div className="brand-mark" style={{ width: 34, height: 34 }} />
          <div>
            <h1>Kaleido Studio</h1>
            <div className="faint">Immagini, video, voce e trascrizioni su OpenRouter</div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="apikey">Chiave API OpenRouter</label>
          <input
            id="apikey"
            type="password"
            className="mono"
            placeholder="sk-or-v1-…"
            value={value}
            autoFocus
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <div className="help">
            Viene verificata subito e salvata cifrata col portachiavi del sistema operativo. Resta sul tuo computer, non
            passa da nessun altro server.
          </div>
        </div>

        {error && (
          <div className="chip chip-danger" style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !value.trim()}>
          {busy ? <span className="spin" /> : null}
          {busy ? 'Verifica in corso' : 'Entra'}
        </button>

        <ol className="steps">
          <li>
            Non hai una chiave?{' '}
            <span className="link" onClick={() => void bridge.app.openExternal('https://openrouter.ai/keys')}>
              Creane una su openrouter.ai/keys
            </span>
          </li>
          <li>Serve credito sull'account per i modelli a pagamento, i modelli gratuiti funzionano subito.</li>
          <li>Da qui in poi scegli solo la schermata e il modello, il resto è automatico.</li>
        </ol>
      </div>
    </div>
  );
}
