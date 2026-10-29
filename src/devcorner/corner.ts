// The Ontwikkelaarshoek: the overlay (12 sections as tabs), the key that opens it, the per-run hooks and the state the sections share. One instance per Shell (`cornerOf`).
// UI choice: an HTML overlay and not the game's own 2D layer: the sections show lists of hundreds of rows (319 game variables, 805 meshes, 1,800 voice clips), search boxes,
// number fields and a WebGL turntable, none of which the game's 8-row menu engine can do. The pages of the original's own debug menus (the hidden "Debug" item,
// page 17, pages 25 / 26) are NOT re-drawn: they run in the game's own menu engine (section "Springen" opens them).
// Key: ` (the grave accent key, DIK 0x29): not in the original's key table 0x8aeb20, refused by the key page's capture (DAT_008aef08 lists it), and used by nothing in the port.
import type { Shell } from '../shell/shell.ts';
import { SECTIONS } from './sections.ts';
import type { RunCtx, RunHook, SectionDef, SectionView } from './types.ts';
import { CSS } from './style.ts';
import { h } from './ui.ts';

/** the key that opens / closes the corner */
export const DEV_KEY = 'Backquote';

const corners = new WeakMap<Shell, DevCorner>();
/** the corner of a shell (created on first use) */
export function cornerOf(sh: Shell): DevCorner {
  let c = corners.get(sh);
  if (!c) { c = new DevCorner(sh); corners.set(sh, c); }
  return c;
}

/** what playzone.ts / frontend.ts call: every member is cheap while the corner is closed and nothing is active */
export class RunHandle {
  private hooks: RunHook[] = [];
  private readonly c: DevCorner;
  readonly run: RunCtx;
  constructor(c: DevCorner, run: RunCtx) { this.c = c; this.run = run; }
  add(h: RunHook | null) { if (h) this.hooks.push(h); }
  /** right after `sh.input.update()`: true = skip this tick (the corner is open and pauses the game) */
  tick(): boolean {
    for (const k of this.hooks) k.tick?.();
    return this.c.isOpen && this.c.pause;
  }
  afterSim() { for (const k of this.hooks) k.afterSim?.(); }
  storyLeave(): boolean { let r = false; for (const k of this.hooks) if (k.storyLeave?.()) r = true; return r; }
  /** render interpolation: a paused game is drawn at its last tick (no sweeping between the last two) */
  alpha(a: number): number { return this.c.isOpen && this.c.pause ? 1 : a; }
  draw3d: NonNullable<RunHook['draw3d']> = (r, eye, vp) => { for (const k of this.hooks) k.draw3d?.(r, eye, vp); };
  hasDraw3d() { return this.hooks.some((k) => k.draw3d); }
  destroy() { for (const k of this.hooks) k.destroy?.(); this.hooks = []; this.c.detach(this); }
}

export class DevCorner {
  readonly sh: Shell;
  /** the zone / front end that is running now */
  run: RunCtx | null = null;
  handle: RunHandle | null = null;
  /** the game stands still while the corner is open (header check box); off = the panel docks at the side and the game runs on */
  pause = true;
  /** a page of the front end's menu to open when the front end starts (set by the sections when they leave a zone for it) */
  pendingFrontPage: number | null = null;
  /** open the corner as soon as a run attaches (the start screen's button) */
  openOnStart = false;
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;
  private where: HTMLSpanElement;
  private msg: HTMLSpanElement;
  private hint: HTMLDivElement;
  private views = new Map<string, SectionView>();
  private current = -1;
  private timer = 0;
  private store_ = new Map<string, unknown>();
  private status_ = new Map<string, string>();
  private msgTimer = 0;
  private keyOn = false;
  readonly sections: SectionDef[] = SECTIONS;

  constructor(sh: Shell) {
    this.sh = sh;
    if (!document.getElementById('dc-style')) document.head.append(h('style', { id: 'dc-style', textContent: CSS }));
    this.tabs = h('div', { className: 'dc-tabs' });
    this.body = h('div', { className: 'dc-body' });
    this.where = h('span', { className: 'dc-where' });
    this.msg = h('span', { className: 'dc-msg' });
    const pauseBox = h('input', { type: 'checkbox', checked: this.pause });
    pauseBox.onchange = () => { this.pause = pauseBox.checked; this.root.classList.toggle('side', !this.pause); };
    this.panel = h('div', { className: 'dc-panel', tabIndex: -1 },
      h('div', { className: 'dc-head' }, h('span', { className: 'dc-title', textContent: 'Ontwikkelaarshoek' }), this.where, h('span', { className: 'dc-sp' }),
        h('label', { title: 'Uit: het paneel zit aan de zijkant en het spel loopt door' }, pauseBox, ' spel pauzeren'),
        h('button', { className: 'dc-btn', textContent: 'Sluiten (`)', type: 'button', onclick: () => this.close() })),
      h('div', { className: 'dc-main' }, this.tabs, this.body),
      h('div', { className: 'dc-foot' }, h('span', {}, h('b', { textContent: '`' }), ' sluit / opent'), h('span', {}, h('b', { textContent: 'PgUp / PgDn' }), ' vorige / volgende onderdeel'), h('span', {}, h('b', { textContent: 'Esc' }), ' sluit'), this.msg));
    this.root = h('div', { className: 'dc-root' }, this.panel);
    this.root.addEventListener('keydown', (e) => this.rootKey(e));   // the game must not see the keys typed in the panel (bubbling: before the input mapper's window listener)
    this.root.addEventListener('keypress', (e) => e.stopPropagation());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.sections.forEach((s, i) => {
      const t = h('button', { className: 'dc-tab', type: 'button', onclick: () => this.select(i), title: s.blurb ?? '' }, h('span', { className: 'n', textContent: String(i + 1) }), s.title);
      this.tabs.append(t);
    });
    sh.wrap.append(this.root);
    this.hint = h('div', { className: 'dc-badge-hint' });
    sh.wrap.append(this.hint);
    this.updateHint();
    this.installKey();
  }

  // ------------------------------------------------------------------------------------------------------------------ shared state

  /** state that lives as long as the shell (toggles of a section, caches): `corner.store('camera', () => ({ free: false }))` */
  store<T>(key: string, init: () => T): T {
    if (!this.store_.has(key)) this.store_.set(key, init());
    return this.store_.get(key) as T;
  }
  /** a short line in the status badge (bottom left) while a toggle is on; '' removes it */
  status(key: string, text: string) { if (text) this.status_.set(key, text); else this.status_.delete(key); this.updateHint(); }
  private updateHint() {
    this.hint.textContent = ['` = Ontwikkelaarshoek', ...this.status_.values()].join('\n');
  }
  /** a message in the footer (a few seconds) */
  toast(text: string) {
    this.msg.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => { this.msg.textContent = ''; }, 5000);
  }

  // ------------------------------------------------------------------------------------------------------------------ open / close

  get isOpen(): boolean { return this.root.classList.contains('open'); }
  open(section?: number | string) {
    this.root.classList.add('open');
    this.root.classList.toggle('side', !this.pause);
    if (typeof section === 'string') { const i = this.sections.findIndex((s) => s.id === section); if (i >= 0) section = i; }
    void this.select(typeof section === 'number' ? section : this.current >= 0 ? this.current : 0);
    this.panel.focus();
    this.timer = window.setInterval(() => this.views.get(this.sections[this.current]?.id)?.refresh?.(), 100);
    this.sh.input.setVirtual(0);
  }
  close() {
    this.root.classList.remove('open');
    clearInterval(this.timer);
    this.views.get(this.sections[this.current]?.id)?.hide?.();
    const a = document.activeElement as HTMLElement | null;
    if (a && this.root.contains(a)) a.blur();
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  async select(i: number) {
    if (i < 0 || i >= this.sections.length) return;
    const def = this.sections[i];
    if (this.current >= 0) this.views.get(this.sections[this.current].id)?.hide?.();
    this.current = i;
    [...this.tabs.children].forEach((t, k) => t.classList.toggle('on', k === i));
    let v = this.views.get(def.id);
    if (!v) {
      try { v = await def.build(this); } catch (e) { console.error('devcorner section', def.id, e); v = { el: h('div', { className: 'dc-note', textContent: `Dit onderdeel kon niet worden gebouwd: ${e instanceof Error ? e.message : e}` }) }; }
      this.views.set(def.id, v);
    }
    if (this.current !== i) return;   // another tab was chosen while this one was building
    const wrap = h('div', { className: 'dc-section' }, h('h2', { textContent: `${i + 1}. ${def.title}` }), def.blurb ? h('p', { className: 'dc-blurb', textContent: def.blurb }) : null, v.el);
    this.body.replaceChildren(wrap);
    v.show?.();
  }

  private rootKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.code === DEV_KEY || e.code === 'Escape') { e.preventDefault(); this.close(); return; }
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (e.code === 'PageDown' && !typing) { e.preventDefault(); void this.select((this.current + 1) % this.sections.length); }
    if (e.code === 'PageUp' && !typing) { e.preventDefault(); void this.select((this.current + this.sections.length - 1) % this.sections.length); }
  }

  private installKey() {
    if (this.keyOn) return;
    this.keyOn = true;
    // capture phase on the window: the key never reaches the input mapper (the cheat detector would see it as a key press)
    addEventListener('keydown', (e) => {
      if (e.code !== DEV_KEY || e.repeat) return;
      if (this.root.contains(e.target as Node)) return;   // handled by the root
      e.preventDefault(); e.stopPropagation();
      this.toggle();
    }, true);
    addEventListener('keyup', (e) => { if (e.code === DEV_KEY) e.stopPropagation(); }, true);
  }

  // ------------------------------------------------------------------------------------------------------------------ runs (zone / front end)

  /** a zone or the front end starts: the sections install their hooks; the returned handle is what the loop calls */
  attach(run: RunCtx): RunHandle {
    this.run = run;
    const hd = new RunHandle(this, run);
    for (const s of this.sections) {
      try { hd.add(s.attach?.(this, run) ?? null); } catch (e) { console.error('devcorner attach', s.id, e); }
    }
    this.handle = hd;
    this.where.textContent = run.kind === 'front' ? 'hoofdmenu' : `${run.info.id} (zone ${run.info.index}), verhaalpunt ${run.sh.vars.get(0x58)}`;
    if (this.openOnStart) { this.openOnStart = false; this.open(); }
    if (this.isOpen) void this.select(this.current >= 0 ? this.current : 0);
    return hd;
  }
  detach(hd: RunHandle) {
    if (this.handle !== hd) return;
    this.handle = null; this.run = null;
    this.close();
  }
}
