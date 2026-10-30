// Keys for a remote screen, as X11 keysyms (VNC and Guacamole both use
// them). `press(sym, down)` is the screen's own way of sending one.

export const KEYSYM = { Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b, Delete: 0xffff, Shift: 0xffe1, Ctrl: 0xffe3, Alt: 0xffe9, Super: 0xffeb, F4: 0xffc1, PrintScreen: 0xff61 };

// Keys the computer you're at keeps for itself, or that are awkward to press.
export const COMBOS = [
  { label: 'Ctrl+Alt+Del', keys: [KEYSYM.Ctrl, KEYSYM.Alt, KEYSYM.Delete] },
  { label: 'Win', keys: [KEYSYM.Super] },
  { label: 'Alt+Tab', keys: [KEYSYM.Alt, KEYSYM.Tab] },
  { label: 'Alt+F4', keys: [KEYSYM.Alt, KEYSYM.F4] },
  { label: 'Esc', keys: [KEYSYM.Escape] },
  { label: 'Print Screen', keys: [KEYSYM.PrintScreen] },
];

export function keysymOf(ch) {
  const cp = ch.codePointAt(0);
  return cp < 0x100 ? cp : 0x01000000 | cp;
}

// Presses the keys in order, then lets go of them the other way round.
export function pressCombo(press, keys) {
  for (const k of keys) press(k, true);
  for (const k of [...keys].reverse()) press(k, false);
}

// Characters that need Shift held on a US layout.
const SHIFTED = /[A-Z~!@#$%^&*()_+{}|:"<>?]/;

// The key presses that type `text`. VNC needs Shift sent with a capital;
// guacd works it out itself.
export function keystrokes(text, { shift = false } = {}) {
  const out = [];
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    const sym = ch === '\n' ? KEYSYM.Enter : ch === '\t' ? KEYSYM.Tab : keysymOf(ch);
    out.push(shift && SHIFTED.test(ch) ? [KEYSYM.Shift, sym] : [sym]);
  }
  return out;
}

// Types text one character at a time so it lands in whatever has focus,
// with a breather so a busy guest keeps up and keeps the order.
export async function typeText(press, text, opts) {
  for (const keys of keystrokes(text, opts)) {
    pressCombo(press, keys);
    await new Promise((r) => setTimeout(r, 8));
  }
}
