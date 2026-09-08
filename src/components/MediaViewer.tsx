import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../lib/api';
import { formatCost } from '../lib/pricing';
import Icon from './Icon';
import { useT } from '../lib/i18n';
import type { MediaRef } from './MediaCard';

type Push = (text: string, tone?: 'info' | 'ok' | 'error') => void;

interface Props {
  /** Everything currently on screen, so the viewer can walk the same set. */
  items: MediaRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  push: Push;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** Pointer travel, in pixels, above which a release counts as a drag not a click. */
const DRAG_SLOP = 4;

const timeOf = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Full-screen view of one result, with the rest of the set one key away.
 *
 * Clicking anywhere closes, including on the image itself, which collides with
 * dragging a zoomed image around. The two are told apart by how far the pointer
 * travelled between press and release rather than by carving out a region, so
 * the whole surface stays clickable.
 */
export default function MediaViewer({ items, index, onIndex, onClose, push }: Props) {
  const t = useT();
  const item = items[index];
  const count = items.length;

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (count < 2) return;
      reset();
      onIndex((index + delta + count) % count);
    },
    [count, index, onIndex, reset],
  );

  // A new result always opens fitted, never inheriting the previous zoom.
  useEffect(reset, [item?.id, reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        step(-1);
      } else if (e.key === '+' || e.key === '=') setZoom((z) => clamp(z * 1.25, MIN_ZOOM, MAX_ZOOM));
      else if (e.key === '-') setZoom((z) => clamp(z / 1.25, MIN_ZOOM, MAX_ZOOM));
      else if (e.key === '0') reset();
      else if (e.key === 'Home') {
        reset();
        onIndex(0);
      } else if (e.key === 'End') {
        reset();
        onIndex(count - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step, onIndex, count, reset]);

  const zoomable = item?.kind === 'image';

  /** Zooms towards the cursor, so the pixel under it stays put. */
  const onWheel = (e: React.WheelEvent) => {
    if (!zoomable) return;
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = clamp(zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    if (next === MIN_ZOOM) {
      reset();
      return;
    }
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const ratio = next / zoom;
    setOffset((o) => ({ x: cx - (cx - o.x) * ratio, y: cy - (cy - o.y) * ratio }));
    setZoom(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (zoom > 1 && zoomable) setOffset({ x: d.ox + dx, y: d.oy + dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // The capture is already gone when the pointer left the window.
    }
    // A press that never really moved is a click, and a click closes.
    if (d && d.moved <= DRAG_SLOP) onClose();
  };

  if (!item) return null;
  const url = bridge.mediaUrl(item.path);
  const transform = `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`;

  return (
    <div className="viewer">
      <div className="viewer-head" onPointerDown={(e) => e.stopPropagation()}>
        <div className="viewer-title">
          <strong>{item.modelName}</strong>
          <span className="faint ellipsis">{item.prompt}</span>
        </div>
        <div className="spacer" />
        {count > 1 && (
          <span className="chip mono nowrap">
            {index + 1} / {count}
          </span>
        )}
        {zoomable && zoom > 1 && <span className="chip mono nowrap">{Math.round(zoom * 100)}%</span>}
        <button
          className="btn btn-sm"
          onClick={async () => {
            const saved = await bridge.library.exportCopy(item.path);
            if (saved) push(t('card.copySaved'), 'ok');
          }}
        >
          <Icon name="download" />
          {t('viewer.saveCopy')}
        </button>
        <button className="btn btn-sm" onClick={() => void bridge.library.open(item.path)}>
          <Icon name="external" />
          {t('viewer.openExternally')}
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          {t('viewer.close')} <span className="kbd">Esc</span>
        </button>
      </div>

      <div
        className={`viewer-body${zoom > 1 ? ' zoomed' : ''}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {count > 1 && (
          <button
            className="viewer-nav prev"
            title={t('viewer.previous')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => step(-1)}
          >
            <Icon name="chevronDown" size={22} />
          </button>
        )}

        <div className="viewer-stage" ref={stageRef}>
          {item.kind === 'image' && (
            <img src={url} alt={item.prompt} style={{ transform }} draggable={false} />
          )}
          {/* Media with its own controls keeps the pointer, otherwise the first
              click on play would close the viewer instead. */}
          {item.kind === 'video' && (
            <video src={url} controls autoPlay loop onPointerDown={(e) => e.stopPropagation()} />
          )}
          {item.kind === 'audio' && (
            <audio src={url} controls autoPlay className="viewer-audio" onPointerDown={(e) => e.stopPropagation()} />
          )}
          {item.kind === 'text' && <pre onPointerDown={(e) => e.stopPropagation()}>{item.text}</pre>}
        </div>

        {count > 1 && (
          <button
            className="viewer-nav next"
            title={t('viewer.next')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => step(1)}
          >
            <Icon name="chevronDown" size={22} />
          </button>
        )}
      </div>

      <div className="viewer-foot" onPointerDown={(e) => e.stopPropagation()}>
        <span className="faint tiny">{timeOf(item.createdAt)}</span>
        {item.cost !== undefined && <span className="mono tiny faint">{formatCost(item.cost)}</span>}
        {item.prompt && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(item.prompt);
              push(t('card.promptCopied'), 'ok');
            }}
          >
            <Icon name="copy" />
            {t('viewer.copyPrompt')}
          </button>
        )}
        <div className="spacer" />
        <span className="faint tiny">
          {count > 1 ? `${t('viewer.hintArrows')} · ` : ''}
          {zoomable ? `${t('viewer.hintZoom')} · ` : ''}
          {t('viewer.hintClick')}
        </span>
      </div>
    </div>
  );
}
