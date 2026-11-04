import { useEffect, useState } from 'react';
import { desktop } from '../../lib/api.js';

// One fetch per file per session, shared by every place that shows it.
const fetched = new Map();
export function fetchMedia(iid, path, again = false) {
  const key = `${iid}\n${path}`;
  if (again) fetched.delete(key);
  if (!fetched.has(key)) {
    const p = desktop.hermes.file(iid, path);
    p.catch(() => fetched.delete(key));
    fetched.set(key, p);
  }
  return fetched.get(key);
}

const name = (p) => p.split('/').pop();

// A file Hermes made, fetched from its container and shown by kind: a
// picture to click open, a video or a track to play right here.
export default function MediaItem({ iid, path, kind, onOpen, compact }) {
  const [state, setState] = useState({ file: null, error: null });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!desktop?.hermes?.file || !iid) return undefined;
    let alive = true;
    setState({ file: null, error: null });
    fetchMedia(iid, path, tries > 0)
      .then((file) => alive && setState({ file, error: null }))
      .catch((err) => alive && setState({ file: null, error: err.message }));
    return () => {
      alive = false;
    };
  }, [iid, path, tries]);

  const { file, error } = state;
  const item = file ? { ...file, iid, kind: file.kind || kind } : null;
  if (error) {
    return (
      <div className={`hmedia err-box${compact ? ' compact' : ''}`}>
        <span className="mono small">{name(path)}</span>
        <span className="err small">{error}</span>
        <button className="btn md quiet" onClick={() => setTries((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!item) {
    return (
      <div className={`hmedia loading${compact ? ' compact' : ''}`}>
        <span className="led on" /> <span className="dim small">Fetching {name(path)}…</span>
      </div>
    );
  }
  return (
    <div className={`hmedia ${item.kind}${compact ? ' compact' : ''}`}>
      {item.kind === 'image' && (
        <button className="pic" onClick={() => onOpen?.(item)} title="Open">
          <img src={item.url} alt={item.name} loading="lazy" />
        </button>
      )}
      {item.kind === 'video' && <video src={item.url} controls preload="metadata" />}
      {item.kind === 'audio' && <audio src={item.url} controls preload="metadata" />}
      <div className="hmedia-cap">
        <span className="mono small" title={path}>
          {item.name}
        </span>
        {onOpen && item.kind !== 'image' && (
          <button className="linkish small" onClick={() => onOpen(item)}>
            Open
          </button>
        )}
      </div>
    </div>
  );
}
