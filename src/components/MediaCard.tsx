import { bridge } from '../lib/api';
import type { MediaKind } from '../lib/types';
import { formatCost, formatDuration } from '../lib/pricing';
import Icon from './Icon';
import { useT } from '../lib/i18n';

export interface MediaRef {
  id: string;
  path: string;
  kind: MediaKind;
  mediaType: string;
  prompt: string;
  modelName: string;
  text?: string;
  cost?: number;
  durationMs?: number;
  createdAt: number;
  favorite?: boolean;
}

type Push = (text: string, tone?: 'info' | 'ok' | 'error') => void;

interface CardProps {
  item: MediaRef;
  onOpen: (item: MediaRef) => void;
  onReuse?: (item: MediaRef) => void;
  onUsePrompt?: (prompt: string) => void;
  onToggleFavorite?: (item: MediaRef) => void;
  onDelete?: (item: MediaRef) => void;
  push: Push;
}

const timeOf = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function MediaCard({ item, onOpen, onReuse, onUsePrompt, onToggleFavorite, onDelete, push }: CardProps) {
  const t = useT();
  const url = bridge.mediaUrl(item.path);

  return (
    <div className="media-card">
      <div className="media-frame" onClick={() => onOpen(item)}>
        {item.kind === 'image' && <img src={url} alt={item.prompt || 'generated image'} loading="lazy" />}
        {item.kind === 'video' && (
          <>
            <video
              src={url}
              muted
              loop
              playsInline
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
            <span className="frame-badge">
              <Icon name="play" size={12} filled />
            </span>
          </>
        )}
        {item.kind === 'audio' && (
          <div className="audio-frame" onClick={(e) => e.stopPropagation()}>
            <Icon name="music" size={26} />
            <audio src={url} controls />
          </div>
        )}
        {item.kind === 'text' && (
          <div className="text-preview">{(item.text ?? '').slice(0, 420) || t('card.emptyTranscription')}</div>
        )}
      </div>

      <div className="media-meta">
        <div className="prompt" title={item.prompt}>
          {item.prompt || <span className="faint">{t('card.noPrompt')}</span>}
        </div>
        <div className="spread faint tiny">
          <span className="ellipsis">{item.modelName}</span>
          {item.cost !== undefined && <span className="mono">{formatCost(item.cost, t)}</span>}
        </div>
        <div className="spread faint tiny">
          <span>{timeOf(item.createdAt)}</span>
          {item.durationMs !== undefined && (
            <span className="mono" title={t('card.generationTime')}>
              <Icon name="clock" size={11} /> {formatDuration(item.durationMs)}
            </span>
          )}
        </div>

        <div className="media-actions">
          {onToggleFavorite && (
            <button
              className={`btn btn-ghost btn-icon${item.favorite ? ' is-favourite' : ''}`}
              title={t('card.favourite')}
              onClick={() => onToggleFavorite(item)}
            >
              <Icon name="star" filled={item.favorite} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon"
            title={t('card.saveCopy')}
            onClick={async () => {
              const saved = await bridge.library.exportCopy(item.path);
              if (saved) push(t('card.copySaved'), 'ok');
            }}
          >
            <Icon name="download" />
          </button>
          <button
            className="btn btn-ghost btn-icon"
            title={t('card.showInFolder')}
            onClick={() => void bridge.library.reveal(item.path)}
          >
            <Icon name="folder" />
          </button>
          {onReuse && (item.kind === 'image' || item.kind === 'video') && (
            <button className="btn btn-ghost btn-icon" title={t('card.useAsInput')} onClick={() => onReuse(item)}>
              <Icon name="reuse" />
            </button>
          )}
          {onUsePrompt && item.prompt && (
            <button className="btn btn-ghost btn-icon" title={t('card.reusePrompt')} onClick={() => onUsePrompt(item.prompt)}>
              <Icon name="copy" />
            </button>
          )}
          {item.kind === 'text' && (
            <button
              className="btn btn-ghost btn-icon"
              title={t('card.copyText')}
              onClick={() => {
                void navigator.clipboard.writeText(item.text ?? '');
                push(t('card.textCopied'), 'ok');
              }}
            >
              <Icon name="copy" />
            </button>
          )}
          <div className="spacer" />
          {onDelete && (
            <button className="btn btn-ghost btn-icon danger" title={t('card.delete')} onClick={() => onDelete(item)}>
              <Icon name="trash" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
