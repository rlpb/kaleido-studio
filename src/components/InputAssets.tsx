import { useState } from 'react';
import { bridge } from '../lib/api';
import type { MediaKind } from '../lib/types';
import Icon from './Icon';

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
        {label} {min > 0 && <span className="required">*</span>}
      </label>

      {files.length > 0 && (
        <div className="thumbs">
          {files.map((path, index) => (
            <div className="thumb" key={path} title={basename(path)}>
              {kind === 'image' && <img src={bridge.mediaUrl(path)} alt={basename(path)} />}
              {kind === 'video' && <video src={bridge.mediaUrl(path)} muted />}
              {kind === 'audio' && (
                <div className="file-glyph">
                  <Icon name="music" size={22} />
                </div>
              )}
              <button className="remove" title="Remove" onClick={() => onChange(files.filter((f) => f !== path))}>
                <Icon name="close" size={11} />
              </button>
              <div className="badge">{frameMode ? (index === 0 ? 'first' : 'last') : basename(path).slice(0, 10)}</div>
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
          <Icon name="plus" size={18} />
          <span>
            Drop {max > 1 ? 'files' : 'a file'} here, or click to browse
            {frameMode && files.length === 1 ? ' (the second becomes the closing frame)' : ''}
          </span>
        </div>
      )}

      {files.length > 0 && (
        <div className="help">
          {files.length} file{files.length === 1 ? '' : 's'} selected{max > files.length ? `, up to ${max}` : ''}
        </div>
      )}
    </div>
  );
}
