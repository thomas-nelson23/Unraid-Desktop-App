import { useEffect, useRef, useState } from 'react';
import RFB from '@novnc/novnc';
import { captureKeys } from '../../lib/api.js';

// A VM's screen with noVNC. The dashboard joins the WebSocket to the VM's
// VNC port. Reports how it's going through onState; once connected it hands
// over a session: press(keysym, down), snapshot() and typeShift (VNC needs
// Shift sent with capitals).
export default function VncScreen({ target, url, attempt, fit, quality, onState }) {
  const holder = useRef(null);
  const rfbRef = useRef(null);
  const passwordRef = useRef(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const el = holder.current;
    onState({ phase: 'connecting' });
    setNeedPassword(false);
    let rfb;
    try {
      rfb = new RFB(el, url, { wsProtocols: ['binary'], credentials: passwordRef.current ? { password: passwordRef.current } : undefined });
    } catch (err) {
      onState({ phase: 'failed', message: err.message });
      return undefined;
    }
    rfbRef.current = rfb;
    rfb.scaleViewport = fit;
    rfb.clipViewport = !fit;
    rfb.background = 'transparent';
    rfb.qualityLevel = quality.quality;
    rfb.compressionLevel = quality.compression;
    rfb.addEventListener('connect', () => {
      setNeedPassword(false);
      onState({
        phase: 'connected',
        session: {
          press: (sym, down) => rfb.sendKey(sym, null, down),
          snapshot: () => new Promise((resolve) => rfb.toBlob(resolve, 'image/png')),
          typeShift: true,
          focus: () => rfb.focus(),
        },
      });
      rfb.focus();
    });
    rfb.addEventListener('disconnect', () => onState({ phase: 'failed' }));
    rfb.addEventListener('credentialsrequired', () => {
      passwordRef.current = null;
      setNeedPassword(true);
      onState({ phase: 'password' });
    });
    rfb.addEventListener('securityfailure', (e) => {
      passwordRef.current = null;
      onState({ phase: 'refused', message: e.detail.reason || 'The VNC password was wrong.' });
    });
    rfb.addEventListener('clipboard', (e) => navigator.clipboard?.writeText(e.detail.text).catch(() => {}));
    return () => {
      rfbRef.current = null;
      captureKeys(false);
      try {
        rfb.disconnect();
      } catch {
        // Already closed.
      }
    };
    // onState is stable; fit and quality are applied live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, url, attempt]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.scaleViewport = fit;
    rfb.clipViewport = !fit;
    rfb.qualityLevel = quality.quality;
    rfb.compressionLevel = quality.compression;
  }, [fit, quality]);

  return (
    <div className="rc-screen-wrap">
      {/* While the screen has focus, the app's own shortcuts (reload, close)
          go to the VM instead. */}
      <div className={`rc-screen${fit ? '' : ' full'}`} ref={holder} onFocus={() => captureKeys(true)} onBlur={() => captureKeys(false)} />
      {needPassword && (
        <form
          className="rc-over"
          onSubmit={(e) => {
            e.preventDefault();
            passwordRef.current = password;
            rfbRef.current?.sendCredentials({ password });
            setPassword('');
            setNeedPassword(false);
          }}
        >
          <span className="soft">{target.name} has a VNC password.</span>
          <input className="rc-input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="VNC password" aria-label="VNC password" />
          <button className="btn md primary">Unlock</button>
        </form>
      )}
    </div>
  );
}
