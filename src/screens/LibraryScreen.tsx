import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../lib/api';
import type { LibraryItem, MediaKind, ModeId } from '../lib/types';
import { MODES } from '../lib/modes';
import { formatBytes, formatCost } from '../lib/pricing';
import { MediaCard, MediaViewer, type MediaRef } from '../components/MediaCard';

type Push = (text: string, tone?: 'info' | 'ok' | 'error') => void;

const PAGE = 60;

export default function LibraryScreen({ push }: { push: Push }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ModeId | 'all'>('all');
  const [kind, setKind] = useState<MediaKind | 'all'>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [viewing, setViewing] = useState<MediaRef | null>(null);
  const [stats, setStats] = useState<{ count: number; byKind: Record<string, number>; totalCost: number; bytes: number } | null>(null);

  const load = useCallback(async () => {
    const result = await bridge.library.list({ search, mode, kind, favoritesOnly, limit, offset: 0 });
    setItems(result.items);
    setTotal(result.total);
    setStats(await bridge.library.stats());
  }, [search, mode, kind, favoritesOnly, limit]);

  useEffect(() => {
    // Typing filters shouldn't fire a read per keystroke.
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <div className="topbar">
        <h1>Libreria</h1>
        <span className="faint">
          {total} element{total === 1 ? 'o' : 'i'}
          {total !== stats?.count ? ` su ${stats?.count ?? 0}` : ''}
        </span>
        <div className="spacer" />
        <button
          className="btn btn-ghost btn-sm"
          title="Rimuove dall'indice i file cancellati fuori dall'app"
          onClick={async () => {
            const removed = await bridge.library.prune();
            push(removed ? `${removed} voci orfane rimosse` : 'Nessuna voce orfana', 'ok');
            void load();
          }}
        >
          Ripulisci indice
        </button>
      </div>

      <div className="canvas">
        {stats && (
          <div className="stat-grid">
            <div className="stat">
              <div className="value mono">{stats.count}</div>
              <div className="label">File totali</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatCost(stats.totalCost)}</div>
              <div className="label">Costo cumulato</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatBytes(stats.bytes)}</div>
              <div className="label">Spazio su disco</div>
            </div>
            <div className="stat">
              <div className="value mono">
                {stats.byKind.image ?? 0}/{stats.byKind.video ?? 0}/{stats.byKind.audio ?? 0}
              </div>
              <div className="label">Immagini / video / audio</div>
            </div>
          </div>
        )}

        <div className="toolbar">
          <input
            type="search"
            placeholder="Cerca nel prompt, nel modello, nel testo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={mode} onChange={(e) => setMode(e.target.value as ModeId | 'all')}>
            <option value="all">Tutte le modalità</option>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind | 'all')}>
            <option value="all">Tutti i tipi</option>
            <option value="image">Immagini</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="text">Testo</option>
          </select>
          <label className="switch">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
            <span className="muted">Solo preferiti</span>
          </label>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <div className="glyph">◫</div>
            <div>Nessun risultato</div>
          </div>
        ) : (
          <>
            <div className="grid">
              {items.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  push={push}
                  onOpen={setViewing}
                  onToggleFavorite={async (ref) => {
                    await bridge.library.update(ref.id, { favorite: !ref.favorite });
                    void load();
                  }}
                  onUsePrompt={(prompt) => {
                    void navigator.clipboard.writeText(prompt);
                    push('Prompt copiato negli appunti', 'ok');
                  }}
                  onDelete={async (ref) => {
                    await bridge.library.remove(ref.id);
                    push('Elemento eliminato', 'ok');
                    void load();
                  }}
                />
              ))}
            </div>
            {items.length < total && (
              <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setLimit((l) => l + PAGE)}>
                Carica altri {Math.min(PAGE, total - items.length)}
              </button>
            )}
          </>
        )}
      </div>

      {viewing && <MediaViewer item={viewing} onClose={() => setViewing(null)} push={push} />}
    </>
  );
}
