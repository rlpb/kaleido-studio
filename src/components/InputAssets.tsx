import { useState } from 'react';
import { bridge } from '../lib/api';
import type { MediaKind } from '../lib/types';

interface Props {
  kind: MediaKind;
  label: string;
  min: number;
  max: number;
  files: string[];
  onChange: (files: string[]) => void;
  /** Labels the first two slots as opening and closing frame. */
  frameMode?: boolean;
}

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** File chooser plus drop target for the assets a mode needs as input. */
export default function InputAssets({ kind, label, min, max, files, onChange, frameMode }: Props) {
  const [over, setOver] = useState(false);

  const add = (paths: string[]) => {
    const merged = [...files];
    for (const path of paths) {
      if (!merged.includes(path) && merged.length < max) merged.push(path);
    }
    onChange(merged);
  };

  const pick = async () => {
    const picked = await bridge.files.pick(kind === 'text' ? 'image' : kind, max > 1);
    if (picked.length) add(picked);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setOver(false);
    const paths: string[] = [];
    for (const file of Array.from(event.dataTransfer.files)) {
      try {
        const path = bridge.files.pathFor(file);
        if (path) paths.push(path);
      } catch {
        // A drop from outside the filesystem has no path; ignore that item.
      }
    }
    if (paths.length) add(paths);
  };

  return (
    <div className="field">
      <label>
        {label} {min > 0 && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>

      {files.length > 0 && (
        <div className="thumbs">
          {files.map((path, index) => (
            <div className="thumb" key={path}>
              {kind === 'image' && <img src={bridge.mediaUrl(path)} alt={basename(path)} />}
              {kind === 'video' && <video src={bridge.mediaUrl(path)} muted />}
              {kind === 'audio' && <div className="file-glyph">♪</div>}
              <button className="remove" title="Rimuovi" onClick={() => onChange(files.filter((f) => f !== path))}>
                ×
              </button>
              {frameMode && <div className="badge">{index === 0 ? 'primo' : 'ultimo'}</div>}
              {!frameMode && <div className="badge">{basename(path).slice(0, 9)}</div>}
            </div>
          ))}
        </div>
      )}

      {files.length < max && (
        <div
          className={`dropzone${over ? ' over' : ''}`}
          onClick={() => void pick()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          Trascina qui {max > 1 ? 'i file' : 'il file'} oppure clicca per sceglier{max > 1 ? 'li' : 'lo'}
          {frameMode && files.length === 1 && ' (il secondo diventa il fotogramma finale)'}
        </div>
      )}

      {files.length >= min && files.length > 0 && (
        <div className="help">
          {files.length} file selezionat{files.length === 1 ? 'o' : 'i'}
          {max > files.length ? `, fino a ${max}` : ''}
        </div>
      )}
    </div>
  );
}
