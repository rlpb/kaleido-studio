import { useState } from 'react';
import { bridge, type KeyState } from '../lib/api';
import Icon from '../components/Icon';
import { useT } from '../lib/i18n';

interface Props {
  keyState: KeyState | null;
  onSaved: () => Promise<void>;
  push: (text: string, tone?: 'info' | 'ok' | 'error') => void;
}

/**
 * The whole first run: paste a key, it gets verified against OpenRouter and
 * stored encrypted. Nothing else is asked; everything after this is discovered
 * from the API.
 */
export default function Onboarding({ keyState, onSaved, push }: Props) {
  const t = useT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    keyState?.configured && !keyState.valid ? (keyState.error ?? null) : null,
  );

  const submit = async () => {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.key.set(key);
      if (!result.valid) {
        setError(result.error ?? t('onboarding.rejected'));
        return;
      }
      if (!result.encrypted) {
        push(t('onboarding.plaintext'), 'info');
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
        <div className="onboarding-head">
          <div className="brand-mark lg" />
          <div>
            <h1>Kaleido Studio</h1>
            <p className="faint">{t('onboarding.tagline')}</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="apikey">{t('onboarding.keyLabel')}</label>
          <div className="input-with-icon">
            <Icon name="key" />
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
          </div>
          <div className="help">
            {t('onboarding.keyHelp')}
          </div>
        </div>

        {error && (
          <div className="banner banner-danger">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}

        <button className="btn btn-primary btn-lg" onClick={() => void submit()} disabled={busy || !value.trim()}>
          {busy ? <span className="spin" /> : <Icon name="sparkle" />}
          {busy ? t('onboarding.verifying') : t('onboarding.enter')}
        </button>

        <ol className="steps">
          <li>
            {t('onboarding.step1')}{' '}
            <span className="link" onClick={() => void bridge.app.openExternal('https://openrouter.ai/keys')}>
              {t('onboarding.step1link')}
            </span>
          </li>
          <li>{t('onboarding.step2')}</li>
          <li>{t('onboarding.step3')}</li>
        </ol>
      </div>
    </div>
  );
}
