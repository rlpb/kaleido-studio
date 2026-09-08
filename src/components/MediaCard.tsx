import { useEffect } from 'react';
import { bridge } from '../lib/api';
import type { MediaKind } from '../lib/types';
import { formatCost } from '../lib/pricing';

export interface MediaRef {
  id: string;
  path: string;
  kind: MediaKind;
  mediaType: string;
  prompt: string;
  modelName: string;
  text?: string;
  cost?: number;
  createdAt: number;
  favorite?: boolean;
}

interface CardProps {
  item: MediaRef;
  onOpen: (item: MediaRef) => void;
  onReuse?: (item: MediaRef) => void;
  onUsePrompt?: (prompt: string) => void;
  onToggleFavorite?: (item: MediaRef) => void;
  onDelete?: (item: MediaRef) => void;
  push: (text: string, tone?: 'info' | 'ok' | 'error') => void;
}

const timeOf = (ms: number) => new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });

export function MediaCard({ item, onOpen, onReuse, onUsePrompt, onToggleFavorite, onDelete, push }: CardProps) {
  const url = bridge.mediaUrl(item.path);

  return (
    <div className="media-card">
      <div className="media-frame" onClick={() => onOpen(item)}>
        {item.kind === 'image' && <img src={url} alt={item.prompt || 'immagine generata'} loading="lazy" />}
        {item.kind === 'video' && <video src={url} muted loop playsInline onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />}
        {item.kind === 'audio' && (
          <div style={{ display: 'grid', gap: 10, placeItems: 'center', width: '100%', padding: 14 }}>
            <div style={{ fontSize: 26 }}>♪</div>
            <audio src={url} controls style={{ width: '100%' }} onClick={(e) => e.stopPropagation()} />
          </div>
        )}
        {item.kind === 'text' && <div className="text-preview">{(item.text ?? '').slice(0, 400) || 'Trascrizione vuota'}</div>}
      </div>

      <div className="media-meta">
        <div className="prompt" title={item.prompt}>
          {item.prompt || <span className="faint">senza prompt</span>}
        </div>
        <div className="spread faint" style={{ fontSize: 11 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.modelName}</span>
          <span className="mono">{item.cost !== undefined ? formatCost(item.cost) : ''}</span>
        </div>
        <div className="faint" style={{ fontSize: 10.5 }}>
          {timeOf(item.createdAt)}
        </div>

        <div className="media-actions">
          {onToggleFavorite && (
            <button
              className={`btn btn-ghost btn-sm${item.favorite ? ' star on' : ''}`}
              title="Preferito"
              onClick={() => onToggleFavorite(item)}
            >
              {item.favorite ? '★' : '☆'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            title="Salva una copia altrove"
            onClick={async () => {
              const saved = await bridge.library.exportCopy(item.path);
              if (saved) push('Copia salvata', 'ok');
            }}
          >
            ⭳
          </button>
          <button className="btn btn-ghost btn-sm" title="Mostra nella cartella" onClick={() => void bridge.library.reveal(item.path)}>
            ⌸
          </button>
          {onReuse && (item.kind === 'image' || item.kind === 'video') && (
            <button className="btn btn-ghost btn-sm" title="Usa come input" onClick={() => onReuse(item)}>
              ↻
            </button>
          )}
          {onUsePrompt && item.prompt && (
            <button className="btn btn-ghost btn-sm" title="Riusa il prompt" onClick={() => onUsePrompt(item.prompt)}>
              ⎘
            </button>
          )}
          {item.kind === 'text' && (
            <button
              className="btn btn-ghost btn-sm"
              title="Copia il testo"
              onClick={() => {
                void navigator.clipboard.writeText(item.text ?? '');
                push('Testo copiato', 'ok');
              }}
            >
              ✎
            </button>
          )}
          <div className="spacer" />
          {onDelete && (
            <button className="btn btn-danger btn-sm" title="Elimina" onClick={() => onDelete(item)}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ViewerProps {
  item: MediaRef;
  onClose: () => void;
  push: (text: string, tone?: 'info' | 'ok' | 'error') => void;
}

export function MediaViewer({ item, onClose, push }: ViewerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = bridge.mediaUrl(item.path);

  return (
    <div className="viewer">
      <div className="viewer-head">
        <strong>{item.modelName}</strong>
        <span className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.prompt}
        </span>
        <div className="spacer" />
        <button
          className="btn btn-sm"
          onClick={async () => {
            const saved = await bridge.library.exportCopy(item.path);
            if (saved) push('Copia salvata', 'ok');
          }}
        >
          Salva copia
        </button>
        <button className="btn btn-sm" onClick={() => void bridge.library.open(item.path)}>
          Apri fuori
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          Chiudi <span className="kbd">Esc</span>
        </button>
      </div>
      <div className="viewer-body">
        {item.kind === 'image' && <img src={url} alt={item.prompt} />}
        {item.kind === 'video' && <video src={url} controls autoPlay loop />}
        {item.kind === 'audio' && <audio src={url} controls autoPlay style={{ width: 'min(620px, 90vw)' }} />}
        {item.kind === 'text' && <pre>{item.text}</pre>}
      </div>
    </div>
  );
}
