import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from '../../lib/api.js';
import { ago } from '../../lib/format.js';
import { load, save } from '../../lib/store.js';
import { madeBy } from '../../lib/ai.js';
import Chat, { Notice } from './Chat.jsx';

const MAX_INLINE = 5 * 1024 * 1024; // pictures up to this size also go to Hermes to look at
const KIND_LABEL = { all: 'All', image: 'Pictures', video: 'Video', audio: 'Audio' };

const readDataUrl = (file) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });

// ComfyUI's address, set here or in Settings.
export function ComfySetup({ onSaved, compact }) {
  const [url, setUrl] = useState('');
  const [saved, setSaved] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    desktop?.comfy?.get().then((x) => {
      setSaved(x.url);
      setUrl(x.url);
    });
  }, []);
  if (!desktop?.comfy) return null;
  const testIt = async () => {
    setErr(null);
    setMsg(null);
    try {
      const r = await desktop.comfy.test(url);
      setMsg(`ComfyUI answered${r.version ? ` (v${r.version})` : ''}${r.device ? ` on ${r.device}` : ''}.`);
    } catch (e) {
      setErr(e.message);
    }
  };
  const saveIt = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const r = await desktop.comfy.save(url);
      setSaved(r.url);
      setMsg(r.url ? 'Saved.' : 'Cleared.');
      onSaved?.(r.url);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <form className={compact ? 'form' : 'card settings-card form'} onSubmit={saveIt}>
      {!compact && (
        <div className="card-head">
          <h3 className="h4">ComfyUI</h3>
          <span className="eyebrow">{saved || 'Not set'}</span>
        </div>
      )}
      <p className="soft small">The Studio sends your files into ComfyUI's input folder and shows what it makes. Its address is usually Cubecrusher's IP with port 8188.</p>
      <label className="field">
        <span className="eyebrow">ComfyUI address</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://10.1.1.3:8188" />
      </label>
      <div className="chips">
        <button type="button" className="btn md" onClick={testIt} disabled={!url.trim()}>
          Test
        </button>
        <button className="btn md primary">Save</button>
      </div>
      {msg && <p className="ok small">{msg}</p>}
      {err && <p className="err small">{err}</p>}
    </form>
  );
}

function Tile({ item, onOpen }) {
  return (
    <button className={`tile ${item.kind}`} onClick={() => onOpen(item)} title={item.prompt || item.filename}>
      {item.kind === 'image' && <img src={item.url} alt={item.prompt || item.filename} loading="lazy" />}
      {item.kind === 'video' && <video src={item.url} muted preload="metadata" />}
      {(item.kind === 'audio' || item.kind === 'file') && (
        <span className="wave" aria-hidden="true">
          {item.kind === 'audio' ? '♪' : '▤'}
        </span>
      )}
      <span className="cap">
        <span>{item.filename}</span>
        {item.at && <small>{ago(item.at)}</small>}
      </span>
    </button>
  );
}

// One file, big, with what can be done with it.
function Viewer({ item, onClose, onUse, onSave }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="viewer" role="dialog" aria-label={item.filename} onClick={onClose}>
      <div className="viewer-box" onClick={(e) => e.stopPropagation()}>
        {item.kind === 'image' && <img src={item.url} alt={item.prompt || item.filename} />}
        {item.kind === 'video' && <video src={item.url} controls autoPlay loop />}
        {item.kind === 'audio' && <audio src={item.url} controls autoPlay />}
        <div className="viewer-meta">
          <div>
            <b>{item.filename}</b>
            {item.prompt && <p className="soft small">{item.prompt}</p>}
            <p className="dim small">
              {item.type === 'input' ? 'Uploaded' : 'Made by ComfyUI'}
              {item.at ? ` · ${ago(item.at)}` : ''}
            </p>
          </div>
          <div className="chips">
            <button className="btn md primary" onClick={() => onUse(item)}>
              Use as input
            </button>
            <button className="btn md" onClick={() => onSave(item)}>
              Save…
            </button>
            <button className="btn md quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Studio: a chat with Hermes for making pictures, video and music through
// ComfyUI, with files going in and the results coming back beside it.
export default function Studio({ instance, instances, onSwitch, visible }) {
  const comfy = desktop?.comfy;
  const [url, setUrl] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [gallery, setGallery] = useState({ items: [], error: null });
  const [queue, setQueue] = useState(null);
  const [uploads, setUploads] = useState(() => load('studioUploads', []));
  const [sends, setSends] = useState(() => load('studioSends', []));
  const [view, setView] = useState('made');
  const [kind, setKind] = useState('all');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [current, setCurrent] = useState(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);

  useEffect(() => {
    comfy?.get().then((x) => setUrl(x.url || ''));
  }, [comfy]);

  const refresh = useCallback(async () => {
    if (!comfy || !url) return;
    try {
      const [items, q] = await Promise.all([comfy.gallery({ max: 96 }), comfy.queue().catch(() => null)]);
      setGallery({ items, error: null });
      setQueue(q);
    } catch (e) {
      setGallery((g) => ({ items: g.items, error: e.message }));
    }
  }, [comfy, url]);

  // Watch ComfyUI while the Studio is open: often while it's working, now and then otherwise.
  const working = queue && queue.running + queue.pending > 0;
  useEffect(() => {
    if (!visible) return undefined;
    refresh();
    const t = setInterval(refresh, working ? 3000 : 15000);
    return () => clearInterval(t);
  }, [refresh, visible, working]);

  const addFiles = async (files) => {
    if (!comfy || !url) return setErr("Set ComfyUI's address first, on the right.");
    setErr(null);
    for (const file of files) {
      setBusy(`Uploading ${file.name}…`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const up = await comfy.upload({ name: file.name, bytes, mime: file.type });
        const dataUrl = up.kind === 'image' && file.size <= MAX_INLINE && /png|jpe?g|gif|webp/.test(file.type) ? await readDataUrl(file) : null;
        setAttachments((a) => [...a.filter((x) => x.filename !== up.filename), { ...up, dataUrl }]);
        setUploads((u) => {
          const next = [{ ...up, id: `in:${up.subfolder}/${up.filename}` }, ...u.filter((x) => x.filename !== up.filename)].slice(0, 100);
          save('studioUploads', next);
          return next;
        });
      } catch (e) {
        setErr(e.message);
      }
    }
    setBusy(null);
  };

  const use = async (item) => {
    setOpen(null);
    setErr(null);
    try {
      let file = item;
      if (item.type !== 'input') {
        setBusy(`Copying ${item.filename} into ComfyUI's input folder…`);
        file = await comfy.reuse(item);
      }
      setAttachments((a) => [...a.filter((x) => x.filename !== file.filename), { ...file, dataUrl: null }]);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(null);
  };
  const saveFile = async (item) => {
    try {
      await comfy.download(item);
    } catch (e) {
      setErr(e.message);
    }
  };

  const onSent = useCallback((sid) => {
    setCurrent(sid);
    setSends((s) => {
      const next = [...s, { sid, at: Date.now() }].slice(-300);
      save('studioSends', next);
      return next;
    });
  }, []);
  const onTurnDone = useCallback(() => refresh(), [refresh]);

  const bySession = useMemo(() => madeBy(gallery.items, sends), [gallery.items, sends]);
  const mine = current ? bySession[current] || [] : [];

  const drop = {
    onDragOver: (e) => {
      if ([...e.dataTransfer.types].includes('Files')) {
        e.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    },
    className: `card convo${dragging ? ' dragging' : ''}`,
  };

  if (!desktop?.hermes) return <Notice what="Studio" text="The Studio works in the desktop app." />;

  const source = view === 'made' ? gallery.items : view === 'chat' ? mine : uploads;
  const items = source.filter((i) => kind === 'all' || i.kind === kind);

  const side = (
    <section className="card media">
      <div className="card-head">
        <h3 className="h4">Media</h3>
        {queue && (
          <span className="pill" style={{ '--k': working ? 'var(--cyan)' : 'var(--text-dim)' }}>
            <span className={`led${working ? ' on' : ''}`} />
            {working ? `${queue.running} running · ${queue.pending} waiting` : 'ComfyUI idle'}
          </span>
        )}
      </div>
      {url === '' && <ComfySetup compact onSaved={setUrl} />}
      {url && (
        <>
          <div className="seg" role="tablist">
            {[
              ['made', 'Made'],
              ['chat', 'This chat'],
              ['uploads', 'Uploaded'],
            ].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'checked' : undefined} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="chips kinds">
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <button key={k} className={`chip sm${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
          {gallery.error && <p className="err small">{gallery.error}</p>}
          <div className="tiles">
            {items.map((i) => (
              <Tile key={i.id || i.url} item={i} onOpen={setOpen} />
            ))}
          </div>
          {items.length === 0 && (
            <p className="dim small">{view === 'uploads' ? 'Nothing uploaded from this app yet. Drop files on the chat.' : view === 'chat' ? 'Nothing made for this chat yet.' : 'ComfyUI has nothing in its history yet.'}</p>
          )}
        </>
      )}
    </section>
  );

  return (
    <>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        accept="image/*,audio/*,video/*"
        onChange={(e) => {
          addFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      <Chat
        mode="studio"
        instance={instance}
        instances={instances}
        onSwitch={onSwitch}
        attachments={attachments}
        onAttachments={setAttachments}
        onSent={onSent}
        onTurnDone={onTurnDone}
        onCurrent={setCurrent}
        drop={drop}
        onPickFiles={() => picker.current?.click()}
        side={side}
        extra={
          <>
            {(busy || err) && <p className={err ? 'err small' : 'dim small'}>{err || busy}</p>}
            {mine.length > 0 && (
              <div className="made-strip">
                <span className="eyebrow c">Made for this chat</span>
                <div className="tiles row">
                  {mine.slice(0, 8).map((i) => (
                    <Tile key={i.id} item={i} onOpen={setOpen} />
                  ))}
                </div>
              </div>
            )}
          </>
        }
      />
      {open && <Viewer item={open} onClose={() => setOpen(null)} onUse={use} onSave={saveFile} />}
    </>
  );
}
