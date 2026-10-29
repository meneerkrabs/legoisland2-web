// Ontwikkelaarshoek, sections 8 and 9: the DOM pieces around the jukebox (player bar, play buttons) and a paged list for the long tables (1,800 speech rows, 2,400 text lines).
import { audio } from '../engine/audio.ts';
import type { DevCorner } from './corner.ts';
import { Jukebox, sourceKey } from './audio-player.ts';
import type { JbSource } from './audio-player.ts';
import { h, btn } from './ui.ts';

/** the one jukebox of the corner (also on `window.__jukebox` for the browser checks) */
export function jukeboxOf(c: DevCorner): Jukebox {
  return c.store('jukebox', () => {
    const jb = new Jukebox(audio.ctx, audio.master, c.sh.files);
    (globalThis as unknown as { __jukebox?: Jukebox }).__jukebox = jb;
    return jb;
  });
}

/** per source key: the last error (a row of a clip that cannot be played shows it) */
const errors = new Map<string, string>();

/** a play / stop button for a source; keeps itself in step with the jukebox through `syncPlayers` */
export function playBtn(jb: Jukebox, src: JbSource, disabled = ''): HTMLButtonElement {
  const key = sourceKey(src);
  const b = btn('Speel', () => {
    if (jb.isPlaying(src)) { jb.stop(); return; }
    void jb.play(src).then(() => { if (jb.state.key === key && jb.state.phase === 'error') errors.set(key, jb.state.error); else errors.delete(key); }).then(() => syncPlayers(jb));
  }, disabled || `speel ${src.label}`);
  b.dataset.jbkey = key;
  if (disabled) { b.disabled = true; b.classList.add('off'); }
  return b;
}

/** the error text cell of a row */
export function playStatus(src: JbSource): HTMLSpanElement {
  const key = sourceKey(src);
  const s = h('span', { className: 'dc-jb-row', textContent: errors.get(key) ?? '' });
  s.dataset.jbstatus = key;
  return s;
}

/** refresh every play button and status cell inside the document: playing -> `Stop` (red), the others `Speel` */
export function syncPlayers(jb: Jukebox, root: ParentNode = document) {
  const st = jb.state;
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-jbkey]')) {
    if (b.disabled) continue;
    const on = jb.playing && st.key === b.dataset.jbkey;
    const t = on ? 'Stop' : 'Speel';
    if (b.textContent !== t) b.textContent = t;
    b.classList.toggle('red', on);
  }
  for (const s of root.querySelectorAll<HTMLElement>('span[data-jbstatus]')) {
    const e = st.phase === 'error' && st.key === s.dataset.jbstatus ? st.error : errors.get(s.dataset.jbstatus ?? '') ?? '';
    if (s.textContent !== e) s.textContent = e;
    s.classList.toggle('bad', !!e);
  }
}

/** the player bar at the top of a section: stop button, state line (`data-phase`), progress */
export function playerBar(jb: Jukebox): { el: HTMLElement; update(): void } {
  const line = h('span', { className: 'dc-jb-state', textContent: jb.describe() });
  const prog = h('span', { className: 'dc-jb-prog' }, h('i', {}));
  const el = h('div', { className: 'dc-bar dc-jb' }, btn('Stop', () => jb.stop(), 'stop het afspelen', 'red'), line, prog);
  const update = () => {
    line.textContent = jb.describe();
    line.dataset.phase = jb.state.phase;
    line.dataset.kind = jb.state.kind;
    const d = jb.state.duration, e = jb.elapsed();
    (prog.firstElementChild as HTMLElement).style.width = d > 0 && jb.state.phase === 'playing' ? `${Math.min(100, (e / d) * 100)}%` : jb.state.phase === 'playing' ? '100%' : '0%';
    syncPlayers(jb);
  };
  jb.onChange.push(update);
  update();
  return { el, update };
}

// ---------------------------------------------------------------------------------------------------------------- paged list

export interface ListCol<T> { head: string; cell(t: T): Node | string | null; cls?: string }

/** a table that shows the first `pageSize` rows of a (filtered) list and a "meer" button: 2,000 rows with buttons are too heavy to build at once */
export class PagedList<T> {
  readonly el: HTMLElement;
  private body: HTMLTableSectionElement;
  private more: HTMLButtonElement;
  private count: HTMLElement;
  private items: T[] = [];
  private shown = 0;
  private cols: ListCol<T>[];
  private pageSize: number;
  private rowClass?: (t: T) => string;
  private empty: string;
  constructor(cols: ListCol<T>[], pageSize = 150, rowClass?: (t: T) => string, empty = 'Niets gevonden.') {
    this.cols = cols; this.pageSize = pageSize; this.rowClass = rowClass; this.empty = empty;
    const t = h('table', { className: 'dc-table' });
    const tr = h('tr', {});
    for (const c of cols) tr.append(h('th', { textContent: c.head }));
    t.append(h('thead', {}, tr));
    this.body = h('tbody', {});
    t.append(this.body);
    this.more = btn('meer tonen', () => this.page(), 'toon de volgende rijen');
    this.count = h('div', { className: 'dc-note' });
    this.el = h('div', {}, this.count, t, h('div', { className: 'dc-bar' }, this.more));
  }
  /** show a new list (from the start) */
  setItems(items: T[]) {
    this.items = items;
    this.shown = 0;
    this.body.replaceChildren();
    this.page();
  }
  get total() { return this.items.length; }
  get visible() { return this.shown; }
  private page() {
    const end = Math.min(this.items.length, this.shown + this.pageSize);
    const frag = document.createDocumentFragment();
    for (; this.shown < end; this.shown++) {
      const it = this.items[this.shown];
      const tr = h('tr', { className: this.rowClass?.(it) ?? '' });
      for (const c of this.cols) { const td = h('td', { className: c.cls ?? '' }); const v = c.cell(it); if (v !== null) td.append(v); tr.append(td); }
      frag.append(tr);
    }
    this.body.append(frag);
    this.more.style.display = this.shown < this.items.length ? '' : 'none';
    this.more.textContent = `meer tonen (${this.items.length - this.shown} te gaan)`;
    this.count.textContent = this.items.length === 0 ? this.empty : `${this.shown} van ${this.items.length} rijen getoond`;
  }
}
