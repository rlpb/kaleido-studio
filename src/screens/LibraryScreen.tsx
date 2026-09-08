import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../lib/api';
import type { LibraryItem, MediaKind, ModeId } from '../lib/types';
import { MODES } from '../lib/modes';
import { formatBytes, formatCost } from '../lib/pricing';
import { MediaCard } from '../components/MediaCard';
import MediaViewer from '../components/MediaViewer';
import Icon from '../components/Icon';

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
  const [viewing, setViewing] = useState<number | null>(null);
  const [stats, setStats] = useState<{
    count: number;
    byKind: Record<string, number>;
    totalCost: number;
    bytes: number;
  } | null>(null);

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
        <h1>Library</h1>
        <span className="faint">
          {total} item{total === 1 ? '' : 's'}
          {stats && total !== stats.count ? ` of ${stats.count}` : ''}
        </span>
        <div className="spacer" />
        <button
          className="btn btn-ghost btn-sm"
          title="Drops index entries whose file was deleted outside the app"
          onClick={async () => {
            const removed = await bridge.library.prune();
            push(removed ? `${removed} orphaned entries removed` : 'No orphaned entries', 'ok');
            void load();
          }}
        >
          <Icon name="refresh" />
          Clean index
        </button>
      </div>

      <div className="canvas">
        {stats && (
          <div className="stat-grid">
            <div className="stat">
              <div className="value mono">{stats.count}</div>
              <div className="label">Files</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatCost(stats.totalCost)}</div>
              <div className="label">Cumulative cost</div>
            </div>
            <div className="stat">
              <div className="value mono">{formatBytes(stats.bytes)}</div>
              <div className="label">Disk usage</div>
            </div>
            <div className="stat">
              <div className="value mono">
                {stats.byKind.image ?? 0}/{stats.byKind.video ?? 0}/{stats.byKind.audio ?? 0}
              </div>
              <div className="label">Images / video / audio</div>
            </div>
          </div>
        )}

        <div className="toolbar">
          <div className="input-with-icon">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search prompts, models, transcripts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value as ModeId | 'all')}>
            <option value="all">All modes</option>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as MediaKind | 'all')}>
            <option value="all">All types</option>
            <option value="image">Images</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="text">Text</option>
          </select>
          <label className="switch">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
            <span className="muted">Favourites only</span>
          </label>
        </div>

        {items.length === 0 ? (
          <div className="empty">
            <Icon name="library" size={30} />
            <div>Nothing here yet</div>
          </div>
        ) : (
          <>
            <div className="grid">
              {items.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  push={push}
                  onOpen={(ref) => setViewing(items.findIndex((i) => i.id === ref.id))}
                  onToggleFavorite={async (ref) => {
                    await bridge.library.update(ref.id, { favorite: !ref.favorite });
                    void load();
                  }}
                  onUsePrompt={(prompt) => {
                    void navigator.clipboard.writeText(prompt);
                    push('Prompt copied to the clipboard', 'ok');
                  }}
                  onDelete={async (ref) => {
                    await bridge.library.remove(ref.id);
                    push('Item deleted', 'ok');
                    void load();
                  }}
                />
              ))}
            </div>
            {items.length < total && (
              <button className="btn self-center" onClick={() => setLimit((l) => l + PAGE)}>
                Load {Math.min(PAGE, total - items.length)} more
              </button>
            )}
          </>
        )}
      </div>

      {viewing !== null && viewing >= 0 && (
        <MediaViewer items={items} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} push={push} />
      )}
    </>
  );
}
