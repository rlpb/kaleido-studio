import { useMemo, useState } from 'react';
import type { ModelInfo } from '../lib/types';

interface Props {
  models: ModelInfo[];
  selectedId: string | null;
  favorites: string[];
  onSelect: (model: ModelInfo) => void;
  onToggleFavorite: (modelId: string) => void;
  onClose: () => void;
}

type Sort = 'recenti' | 'prezzo' | 'nome';

/** A one-line price summary, using whatever billing scheme the model has. */
export function priceSummary(model: ModelInfo): string {
  const seconds = model.price.perVideoSecond;
  if (seconds && Object.keys(seconds).length) {
    const rates = Object.values(seconds);
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    return min === max ? `$${min}/s di video` : `$${min}–${max}/s di video`;
  }
  if (model.price.perImageToken) return `$${model.price.perImageToken} / token immagine`;
  if (model.price.perAudioOutputToken) return `$${model.price.perAudioOutputToken} / token audio`;
  if (model.price.perInputToken) return `$${model.price.perInputToken} / token input`;
  return 'gratis';
}

function cheapness(model: ModelInfo): number {
  const seconds = model.price.perVideoSecond;
  if (seconds && Object.keys(seconds).length) return Math.min(...Object.values(seconds));
  return model.price.perImageToken ?? model.price.perAudioOutputToken ?? model.price.perInputToken ?? 0;
}

export default function ModelPicker({ models, selectedId, favorites, onSelect, onToggleFavorite, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recenti');
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = models.filter((m) => {
      if (onlyFavorites && !favorites.includes(m.id)) return false;
      if (!needle) return true;
      return (
        m.name.toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle) ||
        m.description.toLowerCase().includes(needle)
      );
    });
    const sorted = [...filtered];
    if (sort === 'nome') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'prezzo') sorted.sort((a, b) => cheapness(a) - cheapness(b));
    else sorted.sort((a, b) => b.created - a.created);
    // Favourites float to the top whatever the sort is.
    return sorted.sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  }, [models, query, sort, onlyFavorites, favorites]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="spread">
            <strong>Scegli il modello</strong>
            <span className="faint">
              {visible.length} di {models.length}
            </span>
          </div>
          <div className="toolbar">
            <input
              type="search"
              placeholder="Cerca per nome, autore o descrizione…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="recenti">Più recenti</option>
              <option value="prezzo">Più economici</option>
              <option value="nome">Nome</option>
            </select>
            <label className="switch">
              <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
              <span className="muted">Solo preferiti</span>
            </label>
          </div>
        </div>

        <div className="modal-body">
          {visible.length === 0 && (
            <div className="empty">
              <div className="glyph">◌</div>
              <div>Nessun modello corrisponde alla ricerca</div>
            </div>
          )}
          {visible.map((model) => (
            <div key={model.id} className={`model-row${model.id === selectedId ? ' selected' : ''}`}>
              <button
                style={{ textAlign: 'left', minWidth: 0 }}
                onClick={() => {
                  onSelect(model);
                  onClose();
                }}
              >
                <div className="row" style={{ gap: 7 }}>
                  <strong>{model.name}</strong>
                  <span className="chip">{model.vendor}</span>
                </div>
                <div className="mono faint" style={{ fontSize: 11 }}>
                  {model.id}
                </div>
                {model.description && <div className="desc">{model.description}</div>}
              </button>
              <span className="chip mono">{priceSummary(model)}</span>
              <button
                className={`star${favorites.includes(model.id) ? ' on' : ''}`}
                title={favorites.includes(model.id) ? 'Togli dai preferiti' : 'Aggiungi ai preferiti'}
                onClick={() => onToggleFavorite(model.id)}
              >
                ★
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
