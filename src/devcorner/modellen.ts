// Section 6 "Galerij: modellen": the meshes no loader table and no executable string names (805 meshes + 787 .col, unused.md 7.1), the meshes the loader loads but no model uses
// (z60FRE 359, z41MAP 9, z23DIP 1), the 47 bricks no brick model uses and the 5 brick-model files never loaded (unused.md 7.2), in a turntable viewer.
// ALL lists are computed at run time from the user's own data (gallery-unused.ts: the research method; totals are compared with the research numbers on screen).
// Port extension (nothing of this exists in the original). The turntable has its own canvas and its own Renderer (gallery-turntable.ts); lights are the renderer's defaults,
// so the look is approximate. Textures: only when the same mesh file name is also in another zone's model table (then that zone's texture list is used), else flat group colours.
import type { DevCorner } from './corner.ts';
import type { SectionDef, SectionView } from './types.ts';
import { badge, btn, bytes, f1, filterBox, h, note } from './ui.ts';
import { loadGallery } from './gallery-load.ts';
import type { Gallery } from './gallery-load.ts';
import { borrowTextures, computeBricks } from './gallery-unused.ts';
import { meshInfo } from './gallery-pic.ts';
import type { MeshInfo } from './gallery-pic.ts';
import { Turntable, wireOfTriangles } from './gallery-turntable.ts';
import type { TurnSubject } from './gallery-turntable.ts';
import { ensureGalleryStyle } from './gallery-style.ts';
import { parseCol, extractTriangles } from '../formats/col.ts';
import { BrickLibrary, brickPaletteUv } from '../formats/bricks.ts';
import type { BrickLod } from '../formats/bricks.ts';
import { Brick } from '../fx/bricks/sim.ts';
import type { Msh } from '../formats/msh.ts';
import type { TexGpu } from '../render/renderer.ts';

/** the numbers of docs/re/unused.md 7.1 / 7.2 (research, offline); shown next to the run-time totals */
const RESEARCH = { meshes: 805, cols: 787, unwired: { z60FRE: 359, z41MAP: 9, z23DIP: 1 } as Record<string, number>, bricks: 47, brickModels: 5 };

type Kind = 'mesh' | 'col' | 'brick' | 'brickmodel';
interface Item {
  id: string;
  kind: Kind;
  /** list section: never loaded / loaded but unwired / only a .col / brick / brick model */
  sec: 'never' | 'unwired' | 'colonly' | 'brick' | 'brickmodel';
  /** the archive (zone) the file is in, or the group label for bricks */
  archive: string;
  path: string;
  name: string;
  size: number;
  col: string | null;
  info?: MeshInfo;
  /** brick type index (kind brick) */
  brick?: number;
  row?: HTMLElement;
  badges?: HTMLElement;
}

const SECTION_TITLE: Record<Item['sec'], string> = {
  never: 'Nooit geladen: geen lader en geen exe-tekst noemt de mesh',
  unwired: 'Geladen maar niet gebruikt: in de laadtabel van de zone, maar in geen enkel model',
  colonly: 'Alleen een .col zonder naam (de mesh zelf wordt wel geladen)',
  brick: 'Ongebruikte stenen: in brickset.txt, maar in geen enkel bouwmodel',
  brickmodel: 'Bouwmodellen (BrickMorph) die geen exe-tekst noemt',
};

const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

function buildItems(g: Gallery): Item[] {
  const out: Item[] = [];
  for (const e of g.models.never) out.push({ id: `n:${e.archive}/${e.path}`, kind: 'mesh', sec: 'never', archive: e.archive, path: e.path, name: e.name, size: e.size, col: e.col });
  for (const e of g.models.unwired) out.push({ id: `u:${e.archive}/${e.path}`, kind: 'mesh', sec: 'unwired', archive: e.archive, path: e.path, name: e.name, size: e.size, col: e.col });
  for (const e of g.models.colOnly) out.push({ id: `c:${e.archive}/${e.path}`, kind: 'col', sec: 'colonly', archive: e.archive, path: e.path, name: e.name, size: e.size, col: e.path });
  const order = { never: 0, unwired: 1, colonly: 2, brick: 3, brickmodel: 4 };
  out.sort((a, b) => order[a.sec] - order[b.sec] || natural(a.archive, b.archive) || natural(a.name, b.name));
  return out;
}

class ModelsView {
  readonly el: HTMLElement;
  private c: DevCorner;
  private g: Gallery | null = null;
  private items: Item[] = [];
  private byRow = new Map<HTMLElement, Item>();
  private list: HTMLElement;
  private sum: HTMLElement;
  private status: HTMLElement;
  private info: HTMLElement;
  private canvas: HTMLCanvasElement;
  private tt: Turntable | null = null;
  private fail = '';
  private sel: Item | null = null;
  private token = 0;
  private countEl: HTMLElement;
  private shownCount = 0;
  private q = '';
  private onlyStub = false; private onlyEmpty = false; private onlyCol = false;
  private flat = false;
  private colourSel: HTMLSelectElement;
  private colourBar: HTMLElement;
  private lib: BrickLibrary | null = null;
  private libP: Promise<BrickLibrary> | null = null;
  private subs = new Map<Item['sec'], HTMLElement>();
  private groups = new Map<string, { det: HTMLDetailsElement; body: HTMLElement; count: HTMLElement; items: Item[] }>();
  private colCache = new Map<string, Float32Array | null>();
  private readAllBtn: HTMLButtonElement;
  private reading = false;
  private colBtn: HTMLButtonElement;
  private autoBtn: HTMLButtonElement;

  constructor(c: DevCorner) {
    this.c = c;
    ensureGalleryStyle();
    this.status = h('p', { className: 'dc-note', textContent: 'berekenen ...' });
    this.sum = h('div', { className: 'dg-sum' });
    this.countEl = h('span', { className: 'dc-note' });
    this.list = h('div', { className: 'dg-list', tabIndex: 0 });
    this.info = h('div', { className: 'dg-info' });
    this.canvas = h('canvas', { className: 'dg-canvas', tabIndex: 0, width: 520, height: 390, title: 'Slepen = draaien, wiel = zoom, links/rechts = vorige/volgende, dubbelklik = draaien aan/uit' });
    this.colourSel = h('select', { className: 'dc-select' });
    this.colourSel.onchange = () => { if (this.sel) void this.show(this.sel); };
    this.colourBar = h('div', { className: 'dc-bar', style: 'display:none' }, h('span', { textContent: 'steenkleur ' }), this.colourSel);
    const filter = filterBox('filter: naam, zone, pad (bv. boulder, z27, stub)', (q) => { this.q = q; this.apply(); });
    const flatChk = h('input', { type: 'checkbox' });
    flatChk.onchange = () => { this.flat = flatChk.checked; if (this.sel) void this.show(this.sel); };
    const mkChk = (text: string, title: string, set: (v: boolean) => void) => {
      const i = h('input', { type: 'checkbox' });
      i.onchange = () => { set(i.checked); this.apply(); };
      return h('label', { className: 'dc-check', title }, i, ` ${text}`);
    };
    this.readAllBtn = btn('Archieven inlezen (stub / leeg bepalen)', () => void this.readAll(), 'Leest de zone-archieven met ongeladen modellen en telt de driehoeken van elke mesh (ca. 300 MB uit de speldata, alleen in het geheugen)');
    this.colBtn = btn('Toon .col', () => this.toggleCol(), 'Ctrl+klik op een rij of deze knop: de botsingsmesh (.col) als draadmodel');
    this.autoBtn = btn('Draaien: aan', () => { if (this.tt) { this.tt.auto = !this.tt.auto; this.autoBtn.textContent = `Draaien: ${this.tt.auto ? 'aan' : 'uit'}`; } });
    const boxChk = h('input', { type: 'checkbox', checked: true });
    boxChk.onchange = () => { if (this.tt) this.tt.showBox = boxChk.checked; };
    const cullChk = h('input', { type: 'checkbox' });
    cullChk.onchange = () => { if (this.tt) this.tt.cull = !cullChk.checked; };
    this.el = h('div', {},
      this.status, this.sum,
      h('div', { className: 'dg-wrap' },
        h('div', { className: 'dg-left' },
          h('div', { className: 'dc-bar' }, filter,
            mkChk('stub', 'alleen de 12-driehoeks eenheidsblokjes (1 x 1 x 1), na het inlezen', (v) => { this.onlyStub = v; }),
            mkChk('leeg', 'alleen meshes met 0 driehoeken, na het inlezen', (v) => { this.onlyEmpty = v; }),
            mkChk('met .col', 'alleen meshes met een .col-bestand ernaast', (v) => { this.onlyCol = v; })),
          h('div', { className: 'dc-bar' }, this.readAllBtn, this.countEl),
          this.list),
        h('div', { className: 'dg-view' },
          this.canvas,
          h('div', { className: 'dc-bar' },
            btn('< Vorige', () => this.step(-1), 'Links'), btn('Volgende >', () => this.step(1), 'Rechts'), this.autoBtn, this.colBtn,
            h('label', { className: 'dc-check', title: 'groepskleuren in plaats van de textuurlijst van een andere zone' }, flatChk, ' vlak'),
            h('label', { className: 'dc-check' }, boxChk, ' kader'),
            h('label', { className: 'dc-check', title: 'beide kanten van elke driehoek tekenen' }, cullChk, ' dubbelzijdig')),
          this.colourBar,
          this.info,
          note('Slepen = draaien, wiel = zoom, Links / Rechts = vorige / volgende, Ctrl+klik of de knop toont de .col. Verlichting en kleur zijn bij benadering.'))));
    this.el.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'ArrowRight') { e.preventDefault(); this.step(1); } else if (e.code === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
    });
    void this.init();
  }

  // ---------------------------------------------------------------------------------------------------------------- data

  private async init() {
    try {
      this.g = await loadGallery(this.c, (s) => { if (!this.g) this.status.textContent = s || 'klaar'; });
    } catch (e) { this.status.textContent = `Kon de lijsten niet berekenen: ${e instanceof Error ? e.message : e}`; console.error(e); return; }
    const g = this.g;
    this.status.textContent = '';
    this.items = buildItems(g);
    this.renderSummary();
    await this.renderList();
    void this.addBricks();
  }

  private renderSummary() {
    const g = this.g!;
    const cmp = (n: number, r: number) => h('span', { className: n === r ? 'ok' : 'diff', textContent: n === r ? `${n} (gelijk aan onderzoek)` : `${n} (onderzoek: ${r}, verschil ${n - r})` });
    const un = (z: string) => g.models.unwired.filter((e) => e.archive === z).length;
    this.sum.replaceChildren(
      h('div', {}, 'Nooit geladen meshes: ', cmp(g.models.never.length, RESEARCH.meshes), '   .col: ', cmp(g.models.neverCol.length, RESEARCH.cols)),
      h('div', {}, 'Geladen maar niet gebruikt: ', ...(['z60FRE', 'z41MAP', 'z23DIP'] as const).flatMap((z) => [`${z} `, cmp(un(z), RESEARCH.unwired[z]), '   ']),
        `(van ${g.models.loaded.z60FRE ?? '?'} geladen meshes in z60FRE)`),
      h('div', { id: 'dg-brick-sum' }, 'Stenen: laden ...'));
  }

  private groupFor(it: Item): { det: HTMLDetailsElement; body: HTMLElement; count: HTMLElement; items: Item[] } {
    const key = `${it.sec}|${it.archive}`;
    let gr = this.groups.get(key);
    if (!gr) {
      const count = h('span', { className: 'n' });
      const body = h('div', {});
      const det = h('details', { className: 'dg-group' }, h('summary', {}, it.sec === 'brick' || it.sec === 'brickmodel' ? it.archive : it.archive, count), body) as HTMLDetailsElement;
      gr = { det, body, count, items: [] };
      this.groups.set(key, gr);
    }
    return gr;
  }

  private async renderList() {
    // section headings, then one <details> per archive; rows are made in chunks so the tab opens at once
    this.list.replaceChildren();
    let lastSec = '';
    const mkRow = (it: Item): HTMLElement => {
      const badges = h('span', {});
      const row = h('div', { className: 'dg-row', title: it.kind === 'brick' ? it.name : `${it.archive}/${it.path}`, dataset: { q: `${it.archive} ${it.name} ${it.path}`.toLowerCase() } },
        h('span', { className: 'nm', textContent: it.name }), badges, h('span', { className: 'sz', textContent: it.size ? bytes(it.size) : '' }));
      row.tabIndex = -1;
      row.onclick = (e) => { void this.select(it, e.ctrlKey || e.metaKey); };
      row.oncontextmenu = (e) => { e.preventDefault(); void this.select(it, true); };   // Ctrl+click on a Mac arrives as a context-menu event
      it.row = row; it.badges = badges;
      this.byRow.set(row, it);
      this.fillBadges(it);
      return row;
    };
    const frag: { it: Item; gr: ReturnType<ModelsView['groupFor']> }[] = [];
    for (const it of this.items) {
      const gr = this.groupFor(it);
      if (it.sec !== lastSec) { lastSec = it.sec; const sub = h('div', { className: 'dg-sub', textContent: SECTION_TITLE[it.sec] }); this.subs.set(it.sec, sub); this.list.append(sub); }
      if (!gr.det.isConnected) this.list.append(gr.det);
      gr.items.push(it);
      frag.push({ it, gr });
    }
    const first = [...this.groups.values()].find((g) => g.items[0]?.sec === 'never');
    if (first) first.det.open = true;
    for (let i = 0; i < frag.length; i++) {
      frag[i].gr.body.append(mkRow(frag[i].it));
      if (i % 150 === 149) { await new Promise((r) => setTimeout(r, 0)); if (!this.el.isConnected && !this.list.isConnected) { /* the tab was left: keep going, cheap */ } }
    }
    for (const gr of this.groups.values()) gr.count.textContent = `${gr.items.length}`;
    this.apply();
  }

  private async addBricks() {
    const sumEl = this.el.querySelector('#dg-brick-sum') as HTMLElement | null;
    try {
      const lib = await this.getLib();
      const b = computeBricks(lib);
      const extra: Item[] = [];
      for (const u of b.unused) extra.push({ id: `b:${u.index}`, kind: 'brick', sec: 'brick', archive: 'Stenen (Bricks/lods)', path: `lods/${u.name}_lod1.msh`, name: u.name, size: 0, col: null, brick: u.index });
      for (const f of this.g!.brickModels) extra.push({ id: `m:${f}`, kind: 'brickmodel', sec: 'brickmodel', archive: 'Bouwmodellen (BrickMorph)', path: f, name: f, size: 0, col: null });
      this.items.push(...extra);
      const cmp = (n: number, r: number) => h('span', { className: n === r ? 'ok' : 'diff', textContent: n === r ? `${n} (gelijk aan onderzoek)` : `${n} (onderzoek: ${r}, verschil ${n - r})` });
      sumEl?.replaceChildren('Stenen die geen bouwmodel gebruikt: ', cmp(b.unused.length, RESEARCH.bricks), ` van ${b.total} in brickset.txt (${b.used.size} gebruikt door ${b.modelFiles} modellen)   Bouwmodellen nooit geladen: `, cmp(this.g!.brickModels.length, RESEARCH.brickModels));
      // colour choices (the brick colour dictionary of the executable)
      const names = [...lib.dicts.colours].sort((x, y) => x[1] - y[1]);
      this.colourSel.replaceChildren(...names.map(([n, i]) => h('option', { value: String(i), textContent: `${n} (${i})` })));
      const red = names.find(([n]) => n === 'RED');
      if (red) this.colourSel.value = String(red[1]);
      // append the rows
      for (const it of extra) {
        const gr = this.groupFor(it);
        if (!gr.det.isConnected) {
          if (!this.subs.has(it.sec)) { const sub = h('div', { className: 'dg-sub', textContent: SECTION_TITLE[it.sec] }); this.subs.set(it.sec, sub); this.list.append(sub); }
          this.list.append(gr.det);
        }
        gr.items.push(it);
        const badges = h('span', {});
        const row = h('div', { className: 'dg-row', title: it.name, dataset: { q: `${it.archive} ${it.name}`.toLowerCase() } }, h('span', { className: 'nm', textContent: it.name }), badges);
        row.tabIndex = -1;
        row.onclick = (e) => { void this.select(it, e.ctrlKey || e.metaKey); };
        row.oncontextmenu = (e) => { e.preventDefault(); void this.select(it, true); };
        it.row = row; it.badges = badges;
        this.byRow.set(row, it);
        gr.body.append(row);
        gr.count.textContent = `${gr.items.length}`;
      }
      this.apply();
    } catch (e) { sumEl && (sumEl.textContent = `Stenen: niet te lezen (${e instanceof Error ? e.message : e})`); console.warn('gallery bricks', e); }
  }

  private getLib(): Promise<BrickLibrary> {
    return (this.libP ??= (async () => {
      const d = this.c.sh.data;
      const [bricks, morph] = await Promise.all([d.archive('Bricks'), d.archive('BrickMorph')]);
      this.lib = new BrickLibrary(this.c.sh.pe, bricks, morph);
      return this.lib;
    })());
  }

  private fillBadges(it: Item) {
    if (!it.badges) return;
    const b = it.badges;
    b.replaceChildren();
    if (it.info?.stub) b.append(badge('stub', 'warn'));
    if (it.info?.empty) b.append(badge('leeg', 'red'));
    if (it.col) b.append(badge('.col', ''));
    if (it.info) b.append(h('span', { className: 'sz', textContent: `${it.info.tris} drh` }));
    if (it.row) it.row.dataset.q = `${it.archive} ${it.name} ${it.path}${it.info?.stub ? ' stub' : ''}${it.info?.empty ? ' leeg' : ''}`.toLowerCase();
  }

  // ---------------------------------------------------------------------------------------------------------------- filter and navigation

  private visible(it: Item): boolean {
    if (this.q) { const hay = it.row?.dataset.q ?? ''; if (!this.q.split(/\s+/).every((w) => hay.includes(w))) return false; }   // every word must occur ("z27 lava")
    if (this.onlyStub && !it.info?.stub) return false;
    if (this.onlyEmpty && !it.info?.empty) return false;
    if (this.onlyCol && !it.col) return false;
    return true;
  }
  private apply() {
    const active = !!(this.q || this.onlyStub || this.onlyEmpty || this.onlyCol);
    let n = 0;
    const secShown = new Set<Item['sec']>();
    for (const gr of this.groups.values()) {
      let c = 0;
      for (const it of gr.items) { const v = this.visible(it); if (it.row) it.row.hidden = !v; if (v) c++; }
      gr.count.textContent = active ? `${c} van ${gr.items.length}` : `${gr.items.length}`;
      gr.det.hidden = active && c === 0;
      if (c > 0 && gr.items[0]) secShown.add(gr.items[0].sec);
      if (active && c > 0 && c <= 40) gr.det.open = true;
      n += c;
    }
    for (const [sec, el] of this.subs) el.hidden = active && !secShown.has(sec);
    this.countEl.textContent = active ? `${n} zichtbaar` : '';
  }

  private ordered(): Item[] {
    const out: Item[] = [];
    for (const gr of this.groups.values()) for (const it of gr.items) if (this.visible(it)) out.push(it);
    return out;
  }
  private step(d: number) {
    const o = this.ordered();
    if (!o.length) return;
    const i = this.sel ? o.indexOf(this.sel) : -1;
    const next = o[i < 0 ? (d > 0 ? 0 : o.length - 1) : (i + d + o.length) % o.length];
    void this.select(next, false);
  }

  private async select(it: Item, ctrl: boolean) {
    this.sel?.row?.classList.remove('sel');
    this.sel = it;
    it.row?.classList.add('sel');
    const gr = [...this.groups.values()].find((g) => g.items.includes(it));
    if (gr) gr.det.open = true;
    it.row?.scrollIntoView({ block: 'nearest' });
    it.row?.focus({ preventScroll: true });   // the arrow keys keep working from the list
    if (ctrl && this.tt) { this.tt.showLines = true; this.colBtn.textContent = 'Verberg .col'; }
    await this.show(it);
  }

  private toggleCol() {
    if (!this.tt) return;
    this.tt.showLines = !this.tt.showLines;
    this.colBtn.textContent = this.tt.showLines ? 'Verberg .col' : 'Toon .col';
    if (this.sel) void this.show(this.sel);
  }

  // ---------------------------------------------------------------------------------------------------------------- inlezen (stub / leeg)

  private async readAll() {
    if (this.reading) return;
    this.reading = true;
    this.readAllBtn.disabled = true;
    const zones = [...new Set(this.items.filter((i) => i.kind === 'mesh').map((i) => i.archive))];
    let k = 0;
    for (const z of zones) {
      this.readAllBtn.textContent = `inlezen ${z} (${++k}/${zones.length}) ...`;
      try { await this.fillInfo(z); } catch (e) { console.warn('gallery read', z, e); }
      await new Promise((r) => setTimeout(r, 0));
    }
    this.readAllBtn.textContent = 'Archieven inlezen (stub / leeg bepalen)';
    this.readAllBtn.disabled = false;
    this.reading = false;
    const stubs = this.items.filter((i) => i.info?.stub).length, empt = this.items.filter((i) => i.info?.empty).length;
    this.c.toast(`${stubs} stubs (12 driehoeken, 1 x 1 x 1) en ${empt} lege meshes gevonden`);
    this.apply();
  }

  private async fillInfo(zone: string) {
    const arch = await this.c.sh.data.archive(zone);
    for (const it of this.items) {
      if (it.archive !== zone || it.kind !== 'mesh' || it.info) continue;
      try { it.info = meshInfo(arch.read(it.path)); } catch { /* damaged / unreadable mesh: no badge */ }
      this.fillBadges(it);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- viewer

  private mkInfo(lines: (string | Node)[][]) {
    this.info.replaceChildren(...lines.map((l) => h('div', {}, ...l)));
  }

  private async show(it: Item) {
    if (!this.tt) return;
    const tok = ++this.token;
    this.mkInfo([[h('b', { textContent: it.name }), '  laden ...']]);
    this.colourBar.style.display = it.kind === 'brick' ? '' : 'none';
    try {
      let subject: TurnSubject | null = null;
      const lines: (string | Node)[][] = [];
      if (it.kind === 'mesh' || it.kind === 'col') {
        const arch = await this.c.sh.data.archive(it.archive);
        if (tok !== this.token) return;
        const r = this.tt.renderer;
        if (++this.shownCount % 60 === 0) this.tt.clearCaches();
        const mesh = it.kind === 'mesh' ? r.mesh(arch, it.path) : null;
        if (it.kind === 'mesh' && !mesh) throw new Error('mesh niet te lezen');
        if (mesh && !it.info) { try { it.info = meshInfo(arch.read(it.path)); this.fillBadges(it); } catch { /* keep going */ } }
        subject = { mesh, texOf: undefined };
        // textures: the same mesh file name in another zone's model table
        let texLine: string | Node = 'geen: vlakke groepskleuren';
        if (mesh && !this.flat) {
          const cands = borrowTextures(this.g!.tables, it.archive, `${it.name}.msh`);
          if (cands.length) {
            const pick = cands[0];
            const ta = await this.c.sh.data.archive(pick.zone);
            if (tok !== this.token) return;
            const ids = pick.texList;
            subject.texOf = (gi: number): TexGpu | null => { const id = ids[gi] ?? -1; return id >= 0 ? r.texture(ta, id) : null; };
            texLine = `lijst van ${pick.zone} (zelfde meshnaam in de modeltabel), ids ${ids.filter((x) => x >= 0).slice(0, 12).join(' ')}${ids.length > 12 ? ' ...' : ''}${cands.length > 1 ? `; nog ${cands.length - 1} andere lijst(en)` : ''}`;
          }
        }
        // collision
        const colPath = it.col;
        let colLine: string | Node = it.col ? it.col : 'geen .col naast de mesh';
        if (colPath) {
          const key = `${it.archive}/${colPath}`;
          if (!this.colCache.has(key)) {
            let w: Float32Array | null = null;
            try { const col = parseCol(arch.read(colPath)); w = col.hasPolys ? wireOfTriangles(extractTriangles(col).positions) : null; } catch (e) { console.warn('gallery col', key, e); }
            this.colCache.set(key, w);
          }
          const w = this.colCache.get(key) ?? null;
          subject.lines = w;
          colLine = `${colPath}: ${w ? `${w.length / 18} driehoeken` : 'NCOL (leeg) of onleesbaar'}`;
          if (!mesh && w) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < w.length; i++) { const k = i % 3; if (w[i] < mn[k]) mn[k] = w[i]; if (w[i] > mx[k]) mx[k] = w[i]; } subject.min = mn; subject.max = mx; this.tt.showLines = true; }
        }
        const inf = it.info;
        lines.push([h('b', { textContent: it.name }), `  (${it.sec === 'unwired' ? 'geladen, in geen model' : it.sec === 'colonly' ? 'alleen .col' : 'nooit geladen'})  `, ...(inf?.stub ? [badge('stub', 'warn')] : []), ...(inf?.empty ? [badge('leeg', 'red')] : [])]);
        lines.push([`${it.archive}/${it.path}  ${bytes(it.size)}`]);
        if (mesh) {
          const m = mesh;
          lines.push([h('b', { textContent: 'driehoeken ' }), `${m.triangles}  `, h('b', { textContent: 'hoekpunten ' }), `${m.msh.vertexCount}  `, h('b', { textContent: 'groepen ' }), `${m.groups.length}`]);
          lines.push([h('b', { textContent: 'grenzen ' }), `${f1(m.max[0] - m.min[0])} x ${f1(m.max[1] - m.min[1])} x ${f1(m.max[2] - m.min[2])}  (min ${m.min.map(f1).join(', ')} / max ${m.max.map(f1).join(', ')})`]);
          if (m.msh.svwl) lines.push(['skinned mesh (met botgewichten): hier in de ruststand van de vertices, dus mogelijk vervormd']);
        }
        lines.push([h('b', { textContent: 'texturen ' }), texLine]);
        lines.push([h('b', { textContent: 'collision ' }), colLine]);
      } else if (it.kind === 'brick') {
        const lib = await this.getLib();
        if (tok !== this.token) return;
        const r = this.tt.renderer;
        const t = lib.types[it.brick!];
        const colour = +this.colourSel.value;
        const lod = t ? lib.meshOf(t, 0) : null;
        if (!t || !lod) throw new Error('geen LOD-mesh');
        const msh = brickMsh([{ lod, colour, colour2: colour, split: lib.splitOf(t, 0), local: null }], lib);
        const mesh = r.uploadMesh(msh);
        const tex = r.texture(lib.bricks, 0, '');
        subject = { mesh, texOf: () => tex };
        lines.push([h('b', { textContent: it.name }), '  (steen die geen bouwmodel gebruikt)']);
        lines.push([`Bricks/lods/${it.name}_lod*.msh  LOD-bestanden: ${[0, 1, 2].filter((l) => t.lodMask & (1 << l)).map((l) => l).join(', ')} (LOD 0 getoond)`]);
        lines.push([h('b', { textContent: 'driehoeken ' }), `${lod.indices.length / 3}  `, h('b', { textContent: 'hoekpunten ' }), `${lod.vertexCount}`]);
        lines.push([`steenkleur uit de kleurtabel van het exe-bestand (${this.colourSel.selectedOptions[0]?.textContent ?? ''}); symmetrie ${t.sym.join(' ')}`]);
      } else {
        const lib = await this.getLib();
        if (tok !== this.token) return;
        const r = this.tt.renderer;
        const md = lib.model(it.path);
        if (!md) throw new Error('bouwmodel niet te lezen');
        const parts: BrickPart[] = [];
        for (const b of md.bricks) {
          const t = lib.types[b.type];
          const lod = t ? lib.meshOf(t, 0) : null;
          if (!t || !lod) continue;
          const brick = new Brick(b, t);
          parts.push({ lod, colour: b.colour, colour2: b.colour2 >= 0 ? b.colour2 : b.colour, split: lib.splitOf(t, 0), local: brick.local });
        }
        if (!parts.length) throw new Error('dit bestand heeft een ouder formaat (BRICK_ORIENT_nnn, andere steennamen): de lader van het spel (FUN_0044d570) leest er geen enkele steen uit, dus er valt niets te bouwen');
        const msh = brickMsh(parts, lib);
        const mesh = r.uploadMesh(msh);
        const tex = r.texture(lib.bricks, 0, '');
        subject = { mesh, texOf: () => tex };
        lines.push([h('b', { textContent: it.name }), '  (bouwmodel dat geen exe-tekst noemt)']);
        lines.push([`BrickMorph/${it.path}  "${md.name}"  ${md.bricks.length} stenen, ${md.layers} lagen, middelpuntmodus ${md.centreMode}`]);
        lines.push([h('b', { textContent: 'driehoeken ' }), `${msh.indices.length / 3}  `, h('b', { textContent: 'hoekpunten ' }), `${msh.vertexCount}`]);
        lines.push(['de stenen staan in hun rustpositie (de matrix van FUN_0044d330 zonder animatie), LOD 0, kleuren uit het bestand']);
      }
      if (tok !== this.token) return;
      this.tt.setSubject(subject);
      this.mkInfo(lines);
    } catch (e) {
      if (tok !== this.token) return;
      this.tt.setSubject(null);
      this.mkInfo([[h('b', { textContent: it.name }), `  kon niet worden getoond: ${e instanceof Error ? e.message : e}`]]);
      console.warn('gallery show', it.name, e);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- lifecycle

  show_() {
    if (!this.tt && !this.fail) {
      try {
        this.tt = new Turntable(this.canvas);
        this.tt.showLines = false;
      } catch (e) { this.fail = `WebGL2 niet beschikbaar voor de draaitafel: ${e instanceof Error ? e.message : e}`; this.mkInfo([[this.fail]]); }
    }
    this.tt?.start();
    if (this.sel && this.tt && !this.tt.subject) void this.show(this.sel);
  }
  hide_() { this.tt?.stop(); }
}

interface BrickPart { lod: BrickLod; colour: number; colour2: number; split: number; local: Float32Array | null }

/** a Msh of brick meshes: one group per brick (indices relative to the group), the palette cell of its colour as the texture coordinate (the game's way: Effects.c FUN_00886be0) */
function brickMsh(parts: BrickPart[], lib: BrickLibrary): Msh {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.lod.vertexCount; ni += p.lod.indices.length; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), indices = new Uint16Array(ni);
  const groups: Msh['groups'] = [];
  let vo = 0, io = 0;
  for (const p of parts) {
    const l = p.lod, m = p.local;
    const uv1 = brickPaletteUv(lib.pe, p.colour), uv2 = brickPaletteUv(lib.pe, p.colour2);
    for (let i = 0; i < l.vertexCount; i++) {
      const x = l.positions[i * 3], y = l.positions[i * 3 + 1], z = l.positions[i * 3 + 2], nx = l.normals[i * 3], ny = l.normals[i * 3 + 1], nz = l.normals[i * 3 + 2];
      const o = (vo + i) * 3;
      if (m) {
        positions[o] = x * m[0] + y * m[4] + z * m[8] + m[12]; positions[o + 1] = x * m[1] + y * m[5] + z * m[9] + m[13]; positions[o + 2] = x * m[2] + y * m[6] + z * m[10] + m[14];
        normals[o] = nx * m[0] + ny * m[4] + nz * m[8]; normals[o + 1] = nx * m[1] + ny * m[5] + nz * m[9]; normals[o + 2] = nx * m[2] + ny * m[6] + nz * m[10];
      } else { positions[o] = x; positions[o + 1] = y; positions[o + 2] = z; normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz; }
      const uv = i < p.split ? uv1 : uv2;
      uvs[(vo + i) * 2] = uv[0]; uvs[(vo + i) * 2 + 1] = uv[1];
    }
    indices.set(p.lod.indices, io);
    groups.push({ flags: 0, indexCount: l.indices.length, firstVertex: vo, vertexCount: l.vertexCount, firstIndex: io });
    vo += l.vertexCount; io += l.indices.length;
  }
  return { vertexCount: nv, positions, colors: new Uint32Array(nv).fill(0xffffffff), uvs, uvs2: new Float32Array(nv * 2), normals, indices, groups, gtom: null, matl: null, svwl: null };
}

export const section: SectionDef = {
  id: 'modellen', title: 'Galerij: modellen',
  blurb: 'Meshes die het spel nooit laadt (805 + 787 .col), geladen maar ongebruikte meshes, ongebruikte stenen en bouwmodellen. Alles wordt bij het openen uit je eigen speldata berekend.',
  build(c: DevCorner): SectionView {
    const v = new ModelsView(c);
    return { el: v.el, show: () => v.show_(), hide: () => v.hide_() };
  },
};

