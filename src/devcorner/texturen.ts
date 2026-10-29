// Section 7 "Galerij: texturen en HUD": the zone textures in no texture list (151), the overlay leftovers no executable string names (105), the island's never-drawn objective
// pointer and colour bars, the HUD sprite indices zone code never sets (research table of unused.md 8.5) and the unused menu / loading-screen pictures.
// The two big lists are computed AT RUN TIME from the user's own archives (gallery-unused.ts: the research method); the HUD-per-zone indices are the research table (they are
// literal writes of the decompile that the port does not expose), labelled as such. Thumbnails are decoded on demand (IntersectionObserver) with the repo's TGA / WIB decoders
// into a 2D canvas; a click zooms to the real size. For `.wib` (animated / atlas) textures frame 0 of the playback order is shown, the zoom can step through the frames.
// Port extension (nothing of this exists in the original).
import type { DevCorner } from './corner.ts';
import type { SectionDef, SectionView } from './types.ts';
import { btn, filterBox, h, note } from './ui.ts';
import { loadGallery } from './gallery-load.ts';
import type { Gallery } from './gallery-load.ts';
import { decodePic, topDown } from './gallery-pic.ts';
import type { Pic } from './gallery-pic.ts';
import { ensureGalleryStyle } from './gallery-style.ts';

/** research numbers of unused.md 7.3 */
const RESEARCH = { unlisted: 151, leftovers: 105 };

/**
 * unused.md 8.5 "Unused per zone": HUD sprite indices (`Overlays/<ZONE>/Text<nnn>`) that the literal writes to the HUD globals of the zone code never use. RESEARCH TABLE, not
 * computed: zone code that draws its own quads can still use an index (UNCERTAIN). z02LGI (8-11) has its own block below.
 */
const HUD_UNUSED: { zone: string; dir: string; idx: number[]; why: string }[] = [
  { zone: 'z08BKD', dir: 'z08bkd', idx: [0, 3], why: '0 = rode balk, 3 = pijl' },
  { zone: 'z21FSH', dir: 'Z21FSH', idx: [0, 8, 9, 10, 11], why: '0 = pijl, 8-11 = klokwijzers' },
  { zone: 'z15SSH', dir: 'z15ssh', idx: [0], why: '0 = richtkruis "TARGET"' },
  { zone: 'z28HAT', dir: 'z28hat', idx: [1], why: '1 = leeg blauw vierkant' },
  { zone: 'z27TRX', dir: 'z27TRX', idx: [2], why: '2' },
  { zone: 'z09JST', dir: 'Z09jst', idx: [4, 5, 6, 7], why: '4-7 = schild- en balsprites, waarschijnlijk in de wereld getekend (onzeker)' },
  { zone: 'z38PAR', dir: 'Z38PAR', idx: [1, 2, 3, 4, 5, 6, 7, 13], why: '1-7 en 13' },
  { zone: 'z40aPO', dir: 'Z40APO', idx: [1, 2, 3, 4, 5, 6, 7, 13], why: '1-7 en 13' },
  { zone: 'z10RGB', dir: 'z10rgb', idx: [0], why: '0 = markering die nooit wordt gezet' },
  { zone: 'z50LTC', dir: 'Z50LTC', idx: [1, 2, 3, 4, 5], why: 'pictogrammen 1-5: niets zet var 0xc' },
];
/** unused.md 6 / 8.5: the island's objective arrow and gauge bars (Overlays/Z02LGI text008..011), never drawn although the objective logic still runs */
const ISLAND_HUD: { idx: number; name: string }[] = [{ idx: 8, name: 'Pointer (gele pijl in een blauwe tegel)' }, { idx: 9, name: 'REDBAR' }, { idx: 10, name: 'GreenBar' }, { idx: 11, name: 'YellowBar' }];

interface Cell {
  archive: string;
  /** member path (original case) or null when it is not in the archive */
  path: string | null;
  label: string;
  sub: string;
  group: string;
  el?: HTMLElement;
  th?: HTMLElement;
  pic?: Pic | null;
  state: 'new' | 'queued' | 'done' | 'err';
}

const pad3 = (n: number) => String(n).padStart(3, '0');

class TexView {
  readonly el: HTMLElement;
  private c: DevCorner;
  private g: Gallery | null = null;
  private status: HTMLElement;
  private sum: HTMLElement;
  private body: HTMLElement;
  private cells: Cell[] = [];
  private obs: IntersectionObserver | null = null;
  private queue: Cell[] = [];
  private working = false;
  private zoomEl: HTMLElement | null = null;
  private q = '';

  constructor(c: DevCorner) {
    this.c = c;
    ensureGalleryStyle();
    this.status = h('p', { className: 'dc-note', textContent: 'berekenen ...' });
    this.sum = h('div', { className: 'dg-sum' });
    this.body = h('div', {});
    const filter = filterBox('filter: zone, id, naam (bv. z60, clock, bar)', (q) => { this.q = q; this.apply(); });
    this.el = h('div', {}, this.status, this.sum, h('div', { className: 'dc-bar' }, filter, note('Klik op een plaatje = op ware grootte. Plaatjes worden pas gelezen als ze in beeld komen.')), this.body);
    void this.init();
  }

  private async init() {
    try { this.g = await loadGallery(this.c, (s) => { if (!this.g) this.status.textContent = s || 'klaar'; }); }
    catch (e) { this.status.textContent = `Kon de lijsten niet berekenen: ${e instanceof Error ? e.message : e}`; console.error(e); return; }
    this.status.textContent = '';
    this.obs = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const cell = (e.target as HTMLElement & { _cell?: Cell })._cell; if (cell) this.enqueue(cell); } }, { rootMargin: '200px' });
    await this.render();
  }

  private memberOf(archive: string, rel: string): string | null {
    const a = this.g!.listings.find((l) => l.name === archive);
    return a?.find(rel)?.path ?? null;
  }

  private async render() {
    const g = this.g!;
    const cmp = (n: number, r: number) => h('span', { className: n === r ? 'ok' : 'diff', textContent: n === r ? `${n} (gelijk aan onderzoek)` : `${n} (onderzoek: ${r}, verschil ${n - r})` });
    this.sum.replaceChildren(h('div', {}, 'Zonetexturen in geen texturenlijst: ', cmp(g.textures.unlisted.length, RESEARCH.unlisted), '   Overlay-restanten: ', cmp(g.textures.leftovers.length, RESEARCH.leftovers)));

    // 1. unlisted zone textures, per zone
    const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
    const unl: Cell[] = [...g.textures.unlisted].sort((a, b) => natural(a.archive, b.archive) || a.id - b.id).map((t) => ({ archive: t.archive, path: t.path, label: `${t.archive} ${pad3(t.id)}${t.ext === 'wib' ? ' (wib)' : ''}`, sub: 'in lijst: nee', group: t.archive, state: 'new' }));
    this.block('Zonetexturen die in geen texturenlijst staan', `${unl.length}`, 'Geen mesh kan ze tonen (sommige gezichtsbladen worden misschien tijdens het spel door het gezichtensysteem toegewezen: lage zekerheid).', unl, true);

    // 2. island objective arrow + bars
    const isl: Cell[] = ISLAND_HUD.map((s) => {
      const p = this.memberOf('Overlays', `Z02LGI/Text${pad3(s.idx)}.tga`);
      return { archive: 'Overlays', path: p, label: `Z02LGI text${pad3(s.idx)}`, sub: s.name, group: 'eiland', state: 'new' as const };
    });
    this.block('Eilandpijl en kleurbalken (nooit getekend)', '4', 'De HUD van het eiland zet alleen de pictogrammen 0-7 en 0xc-0x10; de doelpijl en de drie balken worden nooit getekend, hoewel de doellogica (FUN_00424270) wel draait (unused.md 1.1 nr. 6).', isl, false);

    // 3. HUD sprites per zone (research table)
    const hud: Cell[] = [];
    for (const z of HUD_UNUSED) {
      for (const i of z.idx) {
        const p = this.memberOf('Overlays', `${z.dir}/Text${pad3(i)}.tga`) ?? this.memberOf('Overlays', `${z.dir}/Text${pad3(i)}.wib`);
        hud.push({ archive: 'Overlays', path: p, label: `${z.zone} sprite ${i}`, sub: z.why, group: z.zone, state: p ? 'new' : 'err' });
      }
    }
    this.block('Ongebruikte HUD-sprites per zone', `${hud.length}`, 'Onderzoekstabel (unused.md 8.5: letterlijke schrijfacties naar de HUD-variabelen in de zonecode), NIET uitgerekend en bij benadering: een zone die zelf quads tekent kan een index toch gebruiken. Op index getoond uit Overlays/<ZONE>/Text<nnn>.', hud, true);

    // 4. overlay leftovers, per folder
    const lef: Cell[] = [...g.textures.leftovers].sort((a, b) => natural(a.archive + '/' + a.path, b.archive + '/' + b.path)).map((t) => {
      const parts = t.path.split('/');
      return { archive: t.archive, path: t.path, label: parts[parts.length - 1], sub: `${t.archive}/${parts.slice(0, -1).join('/')}`, group: `${t.archive}/${parts.slice(0, -1).join('/')}`, state: 'new' as const };
    });
    this.block('Overlay-restanten (door geen exe-tekst genoemd)', `${lef.length}`, 'Bronbestanden van de artiesten (Save/, Originals/), Text007old, kopieen van Sea0 en OldLoadingScreen.', lef, true);

    // 5. menu / loading screen leftovers
    const misc: Cell[] = [];
    const og = this.memberOf('GENERICBITS', 'Backdrop/OldLoadingScreen.tga');
    misc.push({ archive: 'GENERICBITS', path: og, label: 'OldLoadingScreen.tga', sub: 'oud laadscherm (niet in het exe-bestand)', group: 'misc', state: og ? 'new' : 'err' });
    for (const a of g.listings) for (const e of a.entries) if (/\.tgaback$/i.test(e.path)) misc.push({ archive: a.name, path: e.path, label: e.path.split('/').pop()!, sub: `${a.name}/${e.path}: reservekopie van een tga`, group: 'misc', state: 'new' });
    for (const i of [2, 68, 69, 70, 71]) {
      const p = this.memberOf('menu', `mOverlays/Text${pad3(i)}.tga`);
      misc.push({ archive: 'menu', path: p, label: `menu mOverlays text${pad3(i)}`, sub: i === 2 ? 'pijl in rode ring (lijkt een muiscursor), nooit getekend' : 'pc-monitor / geheugenchip, nooit getekend', group: 'misc', state: p ? 'new' : 'err' });
    }
    this.block('Menu en laadscherm: nooit getekend', `${misc.length}`, 'unused.md 8.5: OldLoadingScreen, Text000.tgaback (z39ASB), mOverlays Text002 en Text068-071.', misc, false);
    this.apply();
  }

  private block(title: string, count: string, blurb: string, cells: Cell[], byGroup: boolean) {
    const det = h('details', { className: 'dg-block' }, h('summary', {}, `${title} `, h('span', { className: 'dc-badge info', textContent: count })), note(blurb)) as HTMLDetailsElement;
    det.open = cells.length <= 24 || title.startsWith('Zonetex');
    const groups = new Map<string, Cell[]>();
    for (const c of cells) (groups.get(byGroup ? c.group : 'x') ?? groups.set(byGroup ? c.group : 'x', []).get(byGroup ? c.group : 'x')!).push(c);
    for (const [k, list] of groups) {
      if (byGroup) det.append(h('div', { className: 'dg-gh', textContent: `${k}  (${list.length})` }));
      const grid = h('div', { className: 'dg-grid' });
      for (const c of list) grid.append(this.cellEl(c));
      det.append(grid);
    }
    this.body.append(det);
    this.cells.push(...cells);
  }

  private cellEl(c: Cell): HTMLElement {
    const th = h('div', { className: 'th', textContent: c.path ? '...' : 'ontbreekt' });
    const el = h('div', { className: 'dg-cell', dataset: { q: `${c.label} ${c.sub} ${c.archive} ${c.path ?? ''}`.toLowerCase() } }, th, h('div', { className: 'lb' }, c.label, h('i', { textContent: c.sub })));
    (el as HTMLElement & { _cell?: Cell })._cell = c;
    el.onclick = () => void this.zoom(c);
    c.el = el; c.th = th;
    if (c.path) this.obs?.observe(el);
    return el;
  }

  private apply() {
    const words = this.q.split(/\s+/).filter(Boolean);
    for (const c of this.cells) if (c.el) c.el.hidden = words.length > 0 && !words.every((w) => (c.el!.dataset.q ?? '').includes(w));
  }

  // ---------------------------------------------------------------------------------------------------------------- thumbnails

  private enqueue(c: Cell) {
    if (c.state !== 'new' || !c.path) return;
    c.state = 'queued';
    this.queue.push(c);
    void this.pump();
  }

  private async pump() {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        // the newest queued cells are the ones now in view: they go first
        const c = this.queue.pop()!;
        await this.loadPic(c).then(() => this.paint(c), (e) => { c.state = 'err'; if (c.th) c.th.textContent = 'fout'; console.warn('gallery texture', c.label, e); });
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally { this.working = false; }
  }

  private async loadPic(c: Cell): Promise<Pic> {
    if (c.pic) return c.pic;
    const arch = await this.c.sh.data.archive(c.archive);
    c.pic = decodePic(c.path!, arch.read(c.path!));
    return c.pic;
  }

  private paint(c: Cell) {
    const pic = c.pic;
    if (!pic || !c.th) return;
    const t = topDown(pic, pic.sequence[0] ?? 0, 128);
    const cv = h('canvas', { width: t.w, height: t.h });
    cv.getContext('2d')!.putImageData(new ImageData(t.rgba, t.w, t.h), 0, 0);
    c.th.replaceChildren(cv);
    c.th.title = `${pic.w} x ${pic.h}${pic.kind === 'wib' ? `, wib: ${pic.frames.length} beelden` : ''}`;
    c.state = 'done';
  }

  // ---------------------------------------------------------------------------------------------------------------- zoom

  private async zoom(c: Cell) {
    if (!c.path) return;
    let pic: Pic;
    try { pic = await this.loadPic(c); } catch (e) { this.c.toast(`kon ${c.label} niet lezen: ${e instanceof Error ? e.message : e}`); return; }
    this.closeZoom();
    let frame = pic.sequence[0] ?? 0;
    const cv = h('canvas', {});
    const info = h('span', {});
    const draw = () => {
      const t = topDown(pic, frame, 0);
      cv.width = t.w; cv.height = t.h;
      cv.getContext('2d')!.putImageData(new ImageData(t.rgba, t.w, t.h), 0, 0);
      info.textContent = `${c.archive}/${c.path}   ${pic.w} x ${pic.h}   ${pic.kind === 'wib' ? `wib, beeld ${frame + 1}/${pic.frames.length}` : 'tga'}   ${c.sub}`;
    };
    draw();
    const bar = h('div', { className: 'bar' }, btn('Sluiten (Esc)', () => this.closeZoom()), pic.kind === 'wib' && pic.frames.length > 1 ? btn('< beeld', () => { frame = (frame + pic.frames.length - 1) % pic.frames.length; draw(); }) : null,
      pic.kind === 'wib' && pic.frames.length > 1 ? btn('beeld >', () => { frame = (frame + 1) % pic.frames.length; draw(); }) : null, info);
    const z = h('div', { className: 'dg-zoom', tabIndex: -1 }, bar, h('div', { className: 'pic' }, cv));
    z.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Escape' || e.code === 'Backquote') { e.preventDefault(); this.closeZoom(); } });
    z.addEventListener('click', (e) => { if (e.target === z || (e.target as HTMLElement).classList.contains('pic')) this.closeZoom(); });
    this.c.root.append(z);
    this.zoomEl = z;
    z.focus();
  }
  private closeZoom() { this.zoomEl?.remove(); this.zoomEl = null; }

  hide() { this.closeZoom(); }
}

export const section: SectionDef = {
  id: 'texturen', title: 'Galerij: texturen en HUD',
  blurb: 'De 151 zonetexturen die in geen lijst staan, 105 overlay-restanten, de nooit getekende HUD-sprites en menu-plaatjes. De lijsten worden uit je eigen speldata berekend.',
  build(c: DevCorner): SectionView {
    const v = new TexView(c);
    return { el: v.el, hide: () => v.hide() };
  },
};

