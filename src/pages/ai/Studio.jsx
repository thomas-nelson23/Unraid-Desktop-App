import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { desktop } from '../../lib/api.js';
import { ago } from '../../lib/format.js';
import { load, save } from '../../lib/store.js';
import { KIND_LABEL, addToLibrary, mediaKind } from '../../lib/media.js';
import Chat, { Notice } from './Chat.jsx';
import MediaItem from './MediaItem.jsx';

const MAX_INLINE = 5 * 1024 * 1024; // pictures up to this size also go to Hermes to look at directly
const VIEWS = [...Object.entries(KIND_LABEL), ['uploads', 'Uploads']];

const readDataUrl = (file) =>
  new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });

// One file, big, with what can be done with it.
function Viewer({ item, onClose, onUse, onSave }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="viewer" role="dialog" aria-label={item.name} onClick={onClose}>
      <div className="viewer-box" onClick={(e) => e.stopPropagation()}>
        {item.kind === 'image' && <img src={item.url} alt={item.name} />}
        {item.kind === 'video' && <video src={item.url} controls autoPlay loop />}
        {item.kind === 'audio' && <audio src={item.url} controls autoPlay />}
        <div className="viewer-meta">
          <div>
            <b>{item.name}</b>
            <p className="dim small mono">{item.path}</p>
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

// Studio: a chat with Hermes for making pictures, video and music (Hermes
// drives ComfyUI). Files go to Hermes; what Hermes hands back is fetched from
// it and kept in a library sorted into Images, Video and Music.
export default function Studio({ instances, defaultIid }) {
  const hermes = desktop?.hermes;
  const [iid, setIid] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [library, setLibrary] = useState(() => load('hermesMedia', []));
  const [uploads, setUploads] = useState(() => load('hermesUploads', []));
  const [view, setView] = useState('image');
  const [onlyChat, setOnlyChat] = useState(false);
  const [current, setCurrent] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef(null);

  const onMedia = useCallback((items) => {
    setLibrary((lib) => {
      const next = addToLibrary(lib, items);
      save('hermesMedia', next);
      return next;
    });
  }, []);

  const addFiles = async (files) => {
    if (!iid) return;
    setErr(null);
    for (const file of files) {
      setBusy(`Sending ${file.name} to Hermes…`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const up = await hermes.upload(iid, file.name, bytes);
        const kind = mediaKind(up.path) || up.kind;
        const dataUrl = kind === 'image' && file.size <= MAX_INLINE && /png|jpe?g|gif|webp/.test(file.type) ? await readDataUrl(file) : null;
        const preview = kind === 'image' ? dataUrl || URL.createObjectURL(file) : null;
        setAttachments((a) => [...a.filter((x) => x.path !== up.path), { ...up, kind, dataUrl, url: preview }]);
        setUploads((u) => {
          const next = addToLibrary(u, [{ iid, path: up.path, kind, at: Date.now() }], 200);
          save('hermesUploads', next);
          return next;
        });
      } catch (e) {
        setErr(e.message);
      }
    }
    setBusy(null);
  };

  // Anything Hermes already has (made or uploaded) is attached by its path.
  const use = (item) => {
    setOpen(null);
    setAttachments((a) => [...a.filter((x) => x.path !== item.path), { path: item.path, filename: item.name || item.path.split('/').pop(), kind: item.kind, url: item.kind === 'image' ? item.url : null }]);
  };
  const saveFile = async (item) => {
    try {
      await hermes.saveFile(item.iid, item.path);
    } catch (e) {
      setErr(e.message);
    }
  };

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

  const items = useMemo(() => {
    const src = view === 'uploads' ? uploads : library.filter((i) => i.kind === view);
    return onlyChat && view !== 'uploads' ? src.filter((i) => i.sid === current) : src;
  }, [view, uploads, library, onlyChat, current]);
  const counts = useMemo(() => {
    const c = { image: 0, video: 0, audio: 0, uploads: uploads.length };
    for (const i of library) c[i.kind] = (c[i.kind] || 0) + 1;
    return c;
  }, [library, uploads]);

  if (!hermes) return <Notice what="Studio" text="The Studio works in the desktop app." />;

  const side = (
    <section className="card media">
      <div className="card-head">
        <h3 className="h4">Media</h3>
        <label className="small soft only">
          <input type="checkbox" checked={onlyChat} onChange={(e) => setOnlyChat(e.target.checked)} disabled={view === 'uploads'} /> This chat only
        </label>
      </div>
      <div className="inst-tabs" role="tablist" aria-label="Kind">
        {VIEWS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'checked' : undefined} onClick={() => setView(id)}>
            {label} {counts[id] ? `· ${counts[id]}` : ''}
          </button>
        ))}
      </div>
      <div className={`library ${view}`}>
        {items.map((i) => (
          <div className="lib-item" key={`${i.iid}${i.path}`}>
            <MediaItem compact iid={i.iid} path={i.path} kind={i.kind} onOpen={setOpen} />
            {i.at && <small className="dim">{ago(i.at)}</small>}
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p className="dim small">
          {view === 'uploads'
            ? 'Nothing sent yet. Drop files on the chat or use Attach.'
            : `No ${KIND_LABEL[view].toLowerCase()} from Hermes yet${onlyChat ? ' in this chat' : ''}. Files Hermes names in its replies land here.`}
        </p>
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
        profileKey="studioProfile"
        defaultIid={defaultIid}
        instances={instances}
        attachments={attachments}
        onAttachments={setAttachments}
        onCurrent={setCurrent}
        onProfile={setIid}
        onMedia={onMedia}
        onOpenMedia={setOpen}
        drop={drop}
        onPickFiles={() => picker.current?.click()}
        side={side}
        extra={(busy || err) && <p className={err ? 'err small' : 'dim small'}>{err || busy}</p>}
      />
      {open && <Viewer item={open} onClose={() => setOpen(null)} onUse={use} onSave={saveFile} />}
    </>
  );
}
