// The on-screen touch layer ("Touchbesturing"): a D-pad and the action keys of the original as buttons on top of the game, for phones and tablets.
// It adds nothing to the game: every button is one of the LOGICAL button bits of the input mapper (src/game/input.ts: 1 Left, 2 Right, 4 Up, 8 Down, 0x10 Ctrl, 0x20 Alt, 0x40 Shift, 0x80 Space,
// 0x1000 `<>`, 0x2000 Z, 0x4000 X, 0x8000 C, 0x10000 Enter, Esc = pause) or one of the two mouse buttons the chase camera reads for zooming (left = out, right = in), so the menus (which the
// original steers with the same bits), the pause menu, the dialog pages and the mini-games see exactly what a keyboard gives them. The key bindings of the options page do not matter: these are the
// logical bits, not keys.
//
// Sampling: the input mapper reads its devices once per simulation tick (docs/re/input.md: a key that is pressed and released between two ticks is not seen), so a tap is held until the mapper
// has sampled it three times and at least 70 ms (the same rule as tools/browse.mjs `key`); a finger that stays down is held as long as it is down.
// Layout (docs/re/touch.md): portrait = the buttons in the free strip under the 4:3 picture (the picture is moved to the top), landscape with room beside the picture = in the side margins,
// otherwise (widescreen, a 4:3 tablet) over the picture, kept clear of the HUD corners and semi-transparent. Safe-area insets (notch, home bar) are respected; the buttons can be hidden.
import { B } from '../game/input.ts';
import type { InputMapper } from '../game/input.ts';
import { currentPrefs, storePrefs } from '../display.ts';
import type { TouchMode } from '../display.ts';
import { audio } from '../engine/audio.ts';

export interface TouchHost { input: InputMapper; wrap: HTMLElement; canvas: HTMLCanvasElement }

/** is this a device whose main input is a finger (the "auto" choice of the start screen) */
export function touchPrimary(win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: { maxTouchPoints?: number } } = globalThis as never): boolean {
  try {
    const mm = win.matchMedia?.bind(win);
    if (mm) {
      if (mm('(pointer: coarse)').matches) return true;
      if (mm('(any-pointer: coarse)').matches && !mm('(hover: hover)').matches) return true;
    }
    return (win.navigator?.maxTouchPoints ?? 0) > 0 && !mm?.('(hover: hover)').matches;
  } catch { return false; }
}
export const touchWanted = (mode: TouchMode): boolean => mode === 'on' || (mode === 'auto' && touchPrimary());

/** a held state that outlives a short tap until the mapper has sampled it (see the header) */
class Latch {
  on = false; t = -1e9; n = 0;
  set(on: boolean, samples: number) { if (on && !this.on) { this.t = performance.now(); this.n = samples; } this.on = on; }
  held(samples: number): boolean {
    if (this.on) return true;
    const age = performance.now() - this.t;
    return age < 70 || (samples < this.n + 4 && age < 600);
  }
}

interface ButtonDef { id: string; label: string; sub: string; bit?: number; mouse?: number; title: string; cls?: string }
const ACTIONS: ButtonDef[] = [
  { id: 'alt', label: 'Alt', sub: 'sprong', bit: B.ALT, title: 'Alt: springen (rem in een voertuig)' },
  { id: 'shift', label: 'Shift', sub: 'actie', bit: B.SHIFT, title: 'Shift: praten, gebruiken, pizza' },
  { id: 'space', label: 'Spatie', sub: 'gas', bit: B.SPACE, title: 'Spatiebalk: gooien, gas geven' },
  { id: 'ctrl', label: 'Ctrl', sub: 'in/uit', bit: B.CTRL, title: 'Ctrl: in- en uitstappen' },
  { id: 'enter', label: 'Enter', sub: 'ok', bit: B.ENTER, title: 'Enter: kiezen in menu\'s', cls: 'tc-ok' },
  { id: 'esc', label: 'Esc', sub: 'pauze', bit: B.ESC, title: 'Esc: pauzemenu, terug', cls: 'tc-esc' },
];
const CAMERA: ButtonDef[] = [
  { id: 'camleft', label: '◀', sub: '<', bit: B.KEY1000, title: 'Camera naar links (toets <)' },
  { id: 'camup', label: '▲', sub: 'X', bit: B.X, title: 'Camera omhoog (toets X)' },
  { id: 'camright', label: '▶', sub: 'Z', bit: B.Z, title: 'Camera naar rechts (toets Z)' },
  { id: 'zoomout', label: '−', sub: 'uit', mouse: 1, title: 'Camera verder weg (linkermuisknop)' },
  { id: 'camdown', label: '▼', sub: 'C', bit: B.C, title: 'Camera omlaag (toets C)' },
  { id: 'zoomin', label: '+', sub: 'in', mouse: 2, title: 'Camera dichterbij (rechtermuisknop)' },
];

const CSS = `
.sh-root.tc-on, .sh-root.tc-on * { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.sh-root.tc-top { align-items: flex-start; }
.tc-root { position: absolute; inset: 0; pointer-events: none; z-index: 5; font: 600 12px/1 system-ui, -apple-system, sans-serif; color: #fff; }
.tc-root.tc-off { display: none; }
.tc-root > * { position: absolute; }
.tc-btn, .tc-pad, .tc-tab { pointer-events: auto; box-sizing: border-box; cursor: default; }
.tc-btn { width: var(--u); height: var(--u); border-radius: calc(var(--u) * .28); background: rgba(24, 40, 14, .5); border: 2px solid rgba(232, 200, 114, .65); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; transition: background .06s; }
.tc-btn b { font-size: calc(var(--u) * .27); font-weight: 700; }
.tc-btn i { font-size: calc(var(--u) * .17); font-style: normal; opacity: .75; }
.tc-btn.on { background: rgba(232, 200, 114, .8); color: #1c2a12; border-color: #fff; }
.tc-act { display: grid; grid-template-columns: repeat(2, var(--u)); grid-auto-rows: var(--u); gap: calc(var(--u) * .1); }
.tc-act .tc-ok, .tc-act .tc-esc { background: rgba(40, 24, 14, .5); }
.tc-act .tc-ok.on, .tc-act .tc-esc.on { background: rgba(232, 200, 114, .8); }
.tc-cam { display: grid; grid-template-columns: repeat(3, calc(var(--u) * .8)); grid-auto-rows: calc(var(--u) * .8); gap: calc(var(--u) * .08); }
.tc-cam .tc-btn { width: calc(var(--u) * .8); height: calc(var(--u) * .8); border-radius: calc(var(--u) * .22); border-color: rgba(160, 200, 255, .6); background: rgba(14, 24, 44, .5); }
.tc-cam .tc-btn b { font-size: calc(var(--u) * .24); }
.tc-cam .tc-btn.on { background: rgba(160, 200, 255, .8); color: #0e1a2c; }
.tc-pad { width: calc(var(--u) * 3); height: calc(var(--u) * 3); border-radius: 50%; background: radial-gradient(rgba(24, 40, 14, .35) 0 30%, rgba(24, 40, 14, .55) 31% 100%); border: 2px solid rgba(232, 200, 114, .65); }
.tc-pad s { position: absolute; width: 0; height: 0; border: calc(var(--u) * .3) solid transparent; opacity: .55; }
.tc-pad s.u { left: 50%; top: calc(var(--u) * .1); margin-left: calc(var(--u) * -.3); border-bottom: calc(var(--u) * .42) solid #e8c872; border-top-width: 0; }
.tc-pad s.d { left: 50%; bottom: calc(var(--u) * .1); margin-left: calc(var(--u) * -.3); border-top: calc(var(--u) * .42) solid #e8c872; border-bottom-width: 0; }
.tc-pad s.l { top: 50%; left: calc(var(--u) * .1); margin-top: calc(var(--u) * -.3); border-right: calc(var(--u) * .42) solid #e8c872; border-left-width: 0; }
.tc-pad s.r { top: 50%; right: calc(var(--u) * .1); margin-top: calc(var(--u) * -.3); border-left: calc(var(--u) * .42) solid #e8c872; border-right-width: 0; }
.tc-pad s.on { opacity: 1; filter: drop-shadow(0 0 6px #fff); }
.tc-pad .tc-knob { position: absolute; width: calc(var(--u) * 1.0); height: calc(var(--u) * 1.0); border-radius: 50%; left: 50%; top: 50%; margin: calc(var(--u) * -.5) 0 0 calc(var(--u) * -.5); background: rgba(232, 200, 114, .35); border: 2px solid rgba(232, 200, 114, .7); }
.tc-pill { display: flex; gap: calc(var(--u) * .1); }
.tc-pill .tc-btn { width: calc(var(--u) * .7); height: calc(var(--u) * .7); border-radius: calc(var(--u) * .2); border-color: rgba(255, 255, 255, .45); background: rgba(0, 0, 0, .45); }
.tc-pill .tc-btn b { font-size: calc(var(--u) * .3); }
.tc-tab { position: absolute; width: calc(var(--u) * .8); height: calc(var(--u) * .8); border-radius: calc(var(--u) * .2); background: rgba(0, 0, 0, .45); border: 2px solid rgba(255, 255, 255, .45); display: none; align-items: center; justify-content: center; font-size: calc(var(--u) * .3); font-weight: 700; }
.tc-root.tc-hidden > :not(.tc-tab) { display: none; }
.tc-root.tc-hidden .tc-tab { display: flex; }
`;

export class TouchControls {
  private host: TouchHost;
  private root: HTMLDivElement;
  private style: HTMLStyleElement;
  private latches = new Map<string, Latch>();
  private defs = new Map<string, ButtonDef>();
  private els = new Map<string, HTMLElement>();
  private pad: HTMLDivElement;
  private padPointer = -1;
  private groups: { pad: HTMLElement; act: HTMLElement; cam: HTMLElement; pill: HTMLElement; tab: HTMLElement };
  private hidden: boolean;
  private offMovie = false;
  private timer = 0;
  private fsBtn: HTMLElement;
  private cleanups: (() => void)[] = [];
  /** the layout in use (tests / debugging): 'strip' | 'side' | 'overlay' */
  mode: 'strip' | 'side' | 'overlay' = 'overlay';

  constructor(host: TouchHost) {
    this.host = host;
    this.hidden = currentPrefs().touchHidden;
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement('div');
    this.root.className = 'tc-root';
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());

    const mk = (d: ButtonDef): HTMLElement => {
      const b = document.createElement('div');
      b.className = `tc-btn ${d.cls ?? ''}`.trim();
      b.title = d.title; b.setAttribute('role', 'button'); b.setAttribute('aria-label', d.title);
      const l = document.createElement('b'), s = document.createElement('i');
      l.textContent = d.label; s.textContent = d.sub;
      b.append(l, s);
      this.defs.set(d.id, d); this.latches.set(d.id, new Latch()); this.els.set(d.id, b);
      this.bindButton(b, d.id);
      return b;
    };
    const act = el('div', 'tc-act'); for (const d of ACTIONS) act.appendChild(mk(d));
    const cam = el('div', 'tc-cam'); for (const d of CAMERA) cam.appendChild(mk(d));
    this.pad = el('div', 'tc-pad') as HTMLDivElement;
    for (const c of ['u', 'd', 'l', 'r']) { this.pad.appendChild(el('s', c)); this.latches.set(`dir-${c}`, new Latch()); }
    this.pad.appendChild(el('div', 'tc-knob'));
    this.bindPad();

    const pill = el('div', 'tc-pill');
    const hide = el('div', 'tc-btn'); hide.title = 'Knoppen verbergen'; hide.setAttribute('aria-label', 'Knoppen verbergen'); hide.innerHTML = '<b>✕</b>';
    this.fsBtn = el('div', 'tc-btn'); this.fsBtn.title = 'Beeldvullend'; this.fsBtn.setAttribute('aria-label', 'Beeldvullend'); this.fsBtn.innerHTML = '<b>⛶</b>';
    pill.append(hide, this.fsBtn);
    const tab = el('div', 'tc-tab'); tab.title = 'Knoppen tonen'; tab.setAttribute('aria-label', 'Knoppen tonen'); tab.innerHTML = '<b>🎮</b>';
    this.tap(hide, () => this.setHidden(true));
    this.tap(tab, () => this.setHidden(false));
    this.tap(this.fsBtn, () => this.toggleFullscreen());
    const fsOk = typeof document !== 'undefined' && !!(document.documentElement.requestFullscreen || (document.documentElement as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);
    if (!fsOk) this.fsBtn.style.display = 'none';

    this.groups = { pad: this.pad, act, cam, pill, tab };
    this.root.append(this.pad, act, cam, pill, tab);
    host.wrap.appendChild(this.root);
    host.wrap.classList.add('tc-on');
    host.input.touch = { sample: (n) => this.sample(n) };

    // no page gestures (pinch zoom of Safari, rubber banding) while playing
    const stop = (e: Event) => e.preventDefault();
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) { document.addEventListener(t, stop); this.cleanups.push(() => document.removeEventListener(t, stop)); }
    host.wrap.addEventListener('touchmove', stop, { passive: false });
    this.cleanups.push(() => host.wrap.removeEventListener('touchmove', stop));
    const relayout = () => { this.layout(); setTimeout(() => this.layout(), 250); };
    addEventListener('resize', relayout); addEventListener('orientationchange', relayout);
    window.visualViewport?.addEventListener('resize', relayout);
    this.cleanups.push(() => { removeEventListener('resize', relayout); removeEventListener('orientationchange', relayout); window.visualViewport?.removeEventListener('resize', relayout); });
    // the movies (their own full-screen layer, a tap skips them) and the key-less screens: the buttons go away while a movie plays
    this.timer = window.setInterval(() => {
      const m = !!document.querySelector('.le2-movie');
      if (m !== this.offMovie) { this.offMovie = m; this.root.classList.toggle('tc-off', m); if (m) this.releaseAll(); }
    }, 250);
    this.applyHidden();
    this.layout();
  }

  // ---------------------------------------------------------------------------------------------------------------------- input

  /** the mapper's per-tick question */
  sample(n: number): { bits: number; mouse: number } {
    let bits = 0, mouse = 0;
    for (const [id, l] of this.latches) {
      if (!l.held(n)) continue;
      if (id.startsWith('dir-')) bits |= id === 'dir-l' ? B.LEFT : id === 'dir-r' ? B.RIGHT : id === 'dir-u' ? B.UP : B.DOWN;
      else { const d = this.defs.get(id)!; if (d.bit) bits |= d.bit; if (d.mouse) mouse |= d.mouse; }
    }
    return { bits, mouse };
  }
  private n() { return this.host.input.updates; }

  private tap(e: HTMLElement, fn: () => void) {
    e.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    e.addEventListener('pointerup', (ev) => { ev.preventDefault(); this.unlock(); fn(); });
  }
  private unlock() { void audio.unlock().catch(() => { /* ignore */ }); }

  private bindButton(b: HTMLElement, id: string) {
    const l = this.latches.get(id)!;
    const end = (e: PointerEvent) => { l.set(false, this.n()); b.classList.remove('on'); if (e.type === 'pointerup') this.unlock(); };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      l.set(true, this.n()); b.classList.add('on');
      try { navigator.vibrate?.(8); } catch { /* ignore */ }
    });
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }

  private bindPad() {
    const p = this.pad;
    const update = (e: PointerEvent) => {
      const r = p.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = e.clientX - cx, dy = e.clientY - cy, len = Math.hypot(dx, dy);
      let u = false, d = false, l = false, rr = false;
      if (len > r.width * 0.09) {
        const nx = dx / len, ny = dy / len;
        rr = nx > 0.38; l = nx < -0.38; d = ny > 0.38; u = ny < -0.38;
      }
      this.setDirs(u, d, l, rr);
      const k = p.querySelector('.tc-knob') as HTMLElement, m = Math.min(len, r.width * 0.3);
      k.style.transform = len > 0 ? `translate(${(dx / len) * m}px, ${(dy / len) * m}px)` : '';
    };
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.padPointer >= 0) return;
      this.padPointer = e.pointerId;
      try { p.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      update(e);
      try { navigator.vibrate?.(8); } catch { /* ignore */ }
    });
    p.addEventListener('pointermove', (e) => { if (e.pointerId === this.padPointer) update(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.padPointer) return;
      this.padPointer = -1; this.setDirs(false, false, false, false);
      (p.querySelector('.tc-knob') as HTMLElement).style.transform = '';
      if (e.type === 'pointerup') this.unlock();
    };
    p.addEventListener('pointerup', end); p.addEventListener('pointercancel', end); p.addEventListener('lostpointercapture', end);
  }
  private setDirs(u: boolean, d: boolean, l: boolean, r: boolean) {
    const n = this.n();
    for (const [c, v] of [['u', u], ['d', d], ['l', l], ['r', r]] as [string, boolean][]) {
      this.latches.get(`dir-${c}`)!.set(v, n);
      this.pad.querySelector(`s.${c}`)!.classList.toggle('on', v);
    }
  }
  private releaseAll() {
    const n = this.n();
    for (const l of this.latches.values()) l.set(false, n);
    for (const e of this.els.values()) e.classList.remove('on');
    this.padPointer = -1; this.setDirs(false, false, false, false);
  }

  // ---------------------------------------------------------------------------------------------------------------------- show / hide

  get visible() { return !this.hidden; }
  setHidden(h: boolean) {
    this.hidden = h;
    storePrefs({ touchHidden: h });
    if (h) this.releaseAll();
    this.applyHidden();
    this.layout();
  }
  private applyHidden() { this.root.classList.toggle('tc-hidden', this.hidden); }
  private toggleFullscreen() {
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (document.fullscreenElement || d.webkitFullscreenElement) { void (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.()); }
      else { const r = de.requestFullscreen?.() ?? de.webkitRequestFullscreen?.(); if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => { /* refused */ }); }
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------------------------------------------------- layout

  private safe() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    this.host.wrap.appendChild(probe);
    const cs = getComputedStyle(probe);
    const o = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    probe.remove();
    return o;
  }

  /** place the groups for the current window and picture; called at every resize (Shell.fitCanvas) */
  layout() {
    const W = innerWidth, H = innerHeight, sf = this.safe();
    const cw = parseFloat(this.host.canvas.style.width) || W, ch = parseFloat(this.host.canvas.style.height) || H;
    const g = this.groups;
    const base = Math.max(40, Math.min(78, Math.min(W, H) * 0.125));
    const portrait = H > W * 1.1;
    const sizes = (u: number) => ({ pad: 3 * u, actW: 2.1 * u, actH: 3.2 * u, camW: 2.56 * u, camH: 1.68 * u, pill: 1.5 * u });
    const place = (e: HTMLElement, x: number, y: number) => { e.style.left = `${Math.round(x)}px`; e.style.top = `${Math.round(y)}px`; };
    const setU = (u: number) => this.root.style.setProperty('--u', `${Math.round(u)}px`);
    const centered = this.hidden;   // hidden buttons: the picture is centred again
    let mode: 'strip' | 'side' | 'overlay' = 'overlay';
    let u = base;
    // 1. portrait: a compact panel at the bottom (camera row right above the action block); the picture is centred in the space above it
    const blockOf = (uu: number) => { const z = sizes(uu); return 0.35 * uu + z.actH + 0.2 * uu + z.camH + 0.35 * uu; };
    let blockH = 0;
    if (portrait && !this.hidden) {
      const free = H - sf.t - sf.b - ch;
      for (let uu = base; uu >= 40 && cw <= W; uu -= 2) if (free >= blockOf(uu)) { mode = 'strip'; u = uu; blockH = blockOf(uu); break; }
    }
    // 2. landscape: the margins beside the 4:3 picture
    const ml = (W - cw) / 2;
    if (mode === 'overlay' && !portrait && !this.hidden) {
      const room = Math.min(ml - sf.l, ml - sf.r) - 6;
      const su = Math.min(base, room / 3.1);
      const s = sizes(su);
      if (su >= 34 && H - sf.t - sf.b >= s.pad + s.camH + su * 0.8) { mode = 'side'; u = su; }
    }
    this.mode = mode;
    void centered;
    this.host.wrap.style.paddingTop = mode === 'strip' ? `${sf.t}px` : '';
    this.host.wrap.style.paddingBottom = mode === 'strip' ? `${blockH + sf.b}px` : '';
    setU(u);
    const s = sizes(u);
    const pad = g.pad, act = g.act, cam = g.cam, pill = g.pill, tab = g.tab;
    place(tab, sf.l + 8, H - sf.b - u * 0.8 - 8);
    if (this.hidden) return;
    if (mode === 'strip') {
      const bottom = H - sf.b - 0.35 * u, spare = Math.max(0, (W - sf.l - sf.r - s.pad - s.actW - 0.7 * u) * 0.12);
      const padX = sf.l + 0.35 * u + spare, actX = W - sf.r - 0.35 * u - s.actW - spare;
      place(pad, padX, bottom - s.pad);
      place(act, actX, bottom - s.actH);
      const camTop = bottom - s.actH - 0.2 * u - s.camH;
      place(cam, actX + s.actW - s.camW, camTop);
      place(pill, padX, camTop + (s.camH - 0.7 * u) / 2);
    } else if (mode === 'side') {
      const lx = sf.l + (ml - sf.l - s.pad) / 2;
      const rightX = W - ml + (ml - sf.r - s.actW) / 2;
      place(pad, lx, H - sf.b - 0.3 * u - s.pad);
      place(cam, sf.l + (ml - sf.l - s.camW) / 2, sf.t + 0.3 * u);
      place(act, rightX, H - sf.b - 0.3 * u - s.actH);
      place(pill, W - ml + (ml - sf.r - s.pill) / 2, sf.t + 0.3 * u);
    } else {
      // over the picture: the HUD sits in the left 10 % / right 17 % of the picture (icon column, gauge) and in the top corners
      const left = Math.max(sf.l + 0.35 * u, Math.min(0.11 * W, 0.11 * cw) + (W - cw) / 2);
      const right = Math.max(sf.r + 0.35 * u, Math.min(0.17 * W, 0.17 * cw) + (W - cw) / 2);
      const bottom = H - sf.b - 0.3 * u;
      place(pad, left, bottom - s.pad);
      place(act, W - right - s.actW, bottom - s.actH);
      place(cam, left, Math.max(sf.t + 0.3 * u, bottom - s.pad - 0.15 * u - s.camH));
      // (below the right HUD icon: the top centre holds the score)
      place(pill, W - right + 0.17 * cw - s.pill + (right - 0.17 * cw) * 0 - Math.max(0.35 * u, 0), Math.max(sf.t, (H - ch) / 2) + 0.15 * ch + 4);
    }
  }

  destroy() {
    clearInterval(this.timer);
    for (const c of this.cleanups) c();
    this.host.input.touch = null;
    this.host.wrap.classList.remove('tc-on', 'tc-top');
    this.host.wrap.style.paddingTop = ''; this.host.wrap.style.paddingBottom = '';
    this.root.remove(); this.style.remove();
  }
}

function el(tag: string, cls: string): HTMLElement { const e = document.createElement(tag); e.className = cls; return e; }

/** the Shell creates the layer when the preference asks for it (touch-first device with "auto", or "aan") */
export function installTouch(host: TouchHost): TouchControls | null {
  const mode = currentPrefs().touch;
  if (!touchWanted(mode)) return null;
  return new TouchControls(host);
}
