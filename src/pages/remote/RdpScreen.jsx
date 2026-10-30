import { useCallback, useEffect, useRef, useState } from 'react';
import Guacamole from 'guacamole-common-js';
import { captureKeys } from '../../lib/api.js';
import { explainGuac, refusedGuac } from '../../lib/remote.js';

// A computer's desktop over RDP (or VNC), through guacd. The dashboard joins
// the WebSocket to guacd and fills in the saved address and sign-in. The
// desktop starts the size of the panel and follows it where the computer
// allows; otherwise it's scaled to fit.
export default function RdpScreen({ target, url, attempt, wake, fit, onState }) {
  const holder = useRef(null);
  const clientRef = useRef(null);
  const [need, setNeed] = useState(null);
  const [answers, setAnswers] = useState({});

  const rescale = useCallback(() => {
    const client = clientRef.current;
    const el = holder.current;
    if (!client || !el) return;
    const display = client.getDisplay();
    const w = display.getWidth();
    const h = display.getHeight();
    if (!w || !h || !el.clientWidth) return;
    display.scale(fit ? Math.min(el.clientWidth / w, el.clientHeight / h) : 1);
  }, [fit]);

  useEffect(() => {
    const el = holder.current;
    onState({ phase: wake ? 'waking' : 'connecting' });
    setNeed(null);
    const tunnel = new Guacamole.WebSocketTunnel(url);
    // A waking computer can keep the handshake waiting for a while.
    tunnel.receiveTimeout = 60_000;
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;
    const display = client.getDisplay();
    const screen = display.getElement();
    el.replaceChildren(screen);
    display.onresize = () => rescale();

    let failed = false;
    client.onerror = (status) => {
      failed = true;
      onState({ phase: refusedGuac(status) ? 'refused' : 'failed', message: explainGuac(status, target) });
    };
    client.onstatechange = (s) => {
      if (s === Guacamole.Client.State.CONNECTED) {
        onState({
          phase: 'connected',
          session: {
            press: (sym, down) => client.sendKeyEvent(down ? 1 : 0, sym),
            snapshot: () => new Promise((resolve) => display.flatten().toBlob(resolve, 'image/png')),
            typeShift: false,
            focus: () => el.focus(),
          },
        });
        rescale();
        el.focus();
      } else if (s === Guacamole.Client.State.DISCONNECTED && !failed) {
        onState({ phase: 'failed' });
      }
    };
    // Text copied on the computer lands on this one's clipboard.
    client.onclipboard = (stream, mimetype) => {
      if (!/^text\//.test(mimetype)) return;
      const reader = new Guacamole.StringReader(stream);
      let text = '';
      reader.ontext = (t) => (text += t);
      reader.onend = () => navigator.clipboard?.writeText(text).catch(() => {});
    };
    // The computer wants a username or password that isn't saved.
    client.onrequired = (names) => {
      setNeed(names);
      onState({ phase: 'password' });
    };

    const mouse = new Guacamole.Mouse(screen);
    mouse.onEach(['mousedown', 'mousemove', 'mouseup'], (e) => client.sendMouseState(e.state, true));
    mouse.on('mouseout', () => display.showCursor(false));

    const keyboard = new Guacamole.Keyboard(el);
    keyboard.onkeydown = (sym) => client.sendKeyEvent(1, sym);
    keyboard.onkeyup = (sym) => client.sendKeyEvent(0, sym);
    const onFocus = () => captureKeys(true);
    const onBlur = () => {
      keyboard.reset();
      captureKeys(false);
    };
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);

    const q = new URLSearchParams({
      width: Math.max(640, Math.round(el.clientWidth)),
      height: Math.max(400, Math.round(el.clientHeight)),
      dpi: Math.round(96 * (window.devicePixelRatio > 1.5 ? 1.25 : 1)),
    });
    for (const type of Guacamole.AudioPlayer.getSupportedTypes()) q.append('audio', type);
    for (const type of ['image/webp', 'image/jpeg', 'image/png']) q.append('image', type);
    if (wake) q.set('wake', '1');
    client.connect(q.toString());

    return () => {
      clientRef.current = null;
      el.removeEventListener('focus', onFocus);
      el.removeEventListener('blur', onBlur);
      captureKeys(false);
      keyboard.onkeydown = keyboard.onkeyup = null;
      client.onstatechange = client.onerror = null;
      try {
        client.disconnect();
      } catch {
        // Already closed.
      }
    };
    // onState is stable; fit is applied live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, url, attempt]);

  // Follow the panel's size: rescale, and ask the computer to match it (an
  // RDP desktop that can resize does). A hidden tab has no size, so it waits.
  useEffect(() => {
    const el = holder.current;
    rescale();
    let t;
    const ro = new ResizeObserver(() => {
      rescale();
      clearTimeout(t);
      t = setTimeout(() => {
        if (fit && clientRef.current && el.clientWidth) clientRef.current.sendSize(Math.round(el.clientWidth), Math.round(el.clientHeight));
      }, 400);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [rescale, fit]);

  function answer(e) {
    e.preventDefault();
    const client = clientRef.current;
    if (!client) return;
    for (const name of need) {
      const writer = new Guacamole.StringWriter(client.createArgumentValueStream('text/plain', name));
      writer.sendText(answers[name] || '');
      writer.sendEnd();
    }
    setNeed(null);
    setAnswers({});
    onState({ phase: 'connecting' });
  }

  return (
    <div className="rc-screen-wrap">
      <div className={`rc-screen guac${fit ? '' : ' full'}`} ref={holder} tabIndex={0} />
      {need && (
        <form className="rc-over" onSubmit={answer}>
          <span className="soft">Sign in to {target.name}</span>
          {need.map((name, i) => (
            <input
              key={name}
              className="rc-input"
              type={name === 'password' ? 'password' : 'text'}
              autoFocus={i === 0}
              autoComplete="off"
              value={answers[name] || ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [name]: e.target.value }))}
              placeholder={name === 'username' ? 'Username' : name === 'password' ? 'Password' : name}
              aria-label={name}
            />
          ))}
          <button className="btn md primary">Sign in</button>
        </form>
      )}
    </div>
  );
}
