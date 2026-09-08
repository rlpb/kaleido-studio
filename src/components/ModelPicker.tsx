import { useMemo, useState } from 'react';
import type { ModelInfo } from '../lib/types';
import { cheapness, priceSummary } from '../lib/pricing';
import Icon from './Icon';
import { useT } from '../lib/i18n';

interface Props {
  models: ModelInfo[];
  selectedId: string | null;
  favorites: string[];
  onSelect: (model: ModelInfo) => void;
  onToggleFavorite: (modelId: string) => void;
  onClose: () => void;
}

type Sort = 'newest' | 'cheapest' | 'name';

export default function ModelPicker({ models, selectedId, favorites, onSelect, onToggleFavorite, onClose }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
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
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'cheapest') sorted.sort((a, b) => cheapness(a) - cheapness(b));
    else sorted.sort((a, b) => b.created - a.created);
    // Favourites float to the top whatever the sort is.
    return sorted.sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  }, [models, query, sort, onlyFavorites, favorites]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="spread">
            <strong>{t('picker.title')}</strong>
            <div className="row">
              <span className="faint">
                {t('picker.count', { n: visible.length, m: models.length })}
              </span>
              <button className="btn btn-ghost btn-icon" onClick={onClose} title={t('viewer.close')}>
                <Icon name="close" />
              </button>
            </div>
          </div>
          <div className="toolbar">
            <div className="input-with-icon grow">
              <Icon name="search" />
              <input
                type="search"
                placeholder={t('picker.search')}
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="newest">{t('picker.sortNewest')}</option>
              <option value="cheapest">{t('picker.sortCheapest')}</option>
              <option value="name">{t('picker.sortName')}</option>
            </select>
            <label className="switch">
              <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
              <span className="muted">{t('picker.favouritesOnly')}</span>
            </label>
          </div>
        </div>

        <div className="modal-body">
          {visible.length === 0 && (
            <div className="empty">
              <Icon name="search" size={28} />
              <div>{t('picker.noMatch')}</div>
            </div>
          )}
          {visible.map((model) => (
            <div key={model.id} className={`model-row${model.id === selectedId ? ' selected' : ''}`}>
              <button
                className="model-row-main"
                onClick={() => {
                  onSelect(model);
                  onClose();
                }}
              >
                <div className="row wrap">
                  <strong>{model.name}</strong>
                  <span className="chip">{model.vendor}</span>
                  {model.price.free && <span className="chip chip-ok">{t('picker.free')}</span>}
                </div>
                <div className="mono faint model-id">{model.id}</div>
                {model.description && <div className="desc">{model.description}</div>}
              </button>
              <span className="chip mono nowrap">{priceSummary(model, t)}</span>
              <button
                className={`btn btn-ghost btn-icon${favorites.includes(model.id) ? ' is-favourite' : ''}`}
                title={favorites.includes(model.id) ? t('picker.removeFavourite') : t('picker.addFavourite')}
                onClick={() => onToggleFavorite(model.id)}
              >
                <Icon name="star" filled={favorites.includes(model.id)} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
