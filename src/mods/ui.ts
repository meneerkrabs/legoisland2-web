// The "Mods" section of the start screen: import (.zip, a picked or dropped folder, loose files), list with enable / disable, order and remove, which archive members a
// mod replaces and, for patch mods, which patches can have an effect in this port. Mods apply at the next "Spelen". Dutch UI text like the rest of the start screen.
import { importPicked, targetOf } from './manage.ts';
import type { ImportProgress, PickedFile } from './manage.ts';
import { openModStore } from './store.ts';
import type { InstalledMod, ModStore } from './store.ts';
import { EffectMap, reportPatches } from './effects.ts';
import type { PatchRow } from './effects.ts';
import { loadPatches } from './store.ts';
import { ModLayer } from './overlay.ts';
import { CATALOGUE, THREADS, addFromCatalogue, addable, cleanTemp } from './catalogue.ts';
import type { CatalogueEntry } from './catalogue.ts';
import { setUnrarWasmUrl } from './rar.ts';
import unrarWasm from 'node-unrar-js/esm/js/unrar.wasm?url';

setUnrarWasmUrl(unrarWasm);

export interface ModsUiHost {
  /** the game's executable when it can be had without a download (own ISO, dev copy, a stored download); else null */
  exe(): Promise<Uint8Array | null>;
  error(e: unknown): void;
}
export interface ModsSection {
  element: HTMLDetailsElement;
  /** import what the user dropped on the page */
  importPicked(items: PickedFile[]): Promise<void>;
}

const EFFECT_KEY = 'le2-mod-effects';
const MARK = { works: 'effect', maybe: 'onzeker', ignored: 'genegeerd' } as const;
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

type Cache = Record<string, { exe: number; rows: PatchRow[] }>;
const readCache = (): Cache => { try { return JSON.parse(localStorage.getItem(EFFECT_KEY) ?? '{}') as Cache; } catch { return {}; } };
const writeCache = (c: Cache) => { try { localStorage.setItem(EFFECT_KEY, JSON.stringify(c)); } catch { /* ignore */ } };
/** remember the effect report of a mod (the game start calls this with the executable it really read) */
export function saveEffects(modId: string, exeSize: number, rows: PatchRow[]) { const c = readCache(); c[modId] = { exe: exeSize, rows }; writeCache(c); }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  n.append(...kids);
  return n;
};

/** files dropped on the page (also whole folders: `webkitGetAsEntry`) as picked files with their relative paths */
export async function collectDropped(dt: DataTransfer): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  const entries = [...dt.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?(): FileSystemEntry | null }).webkitGetAsEntry?.() ?? null);
  const files = [...dt.files];
  if (!entries.some((e) => e?.isDirectory)) return files.map((f) => ({ path: f.name, file: f }));
  const walk = async (e: FileSystemEntry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ path: prefix + e.name, file: f });
    } else if (e.isDirectory) {
      const r = (e as FileSystemDirectoryEntry).createReader();
      for (;;) { // readEntries returns at most ~100 entries per call
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => r.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      }
    }
  };
  for (const e of entries) if (e) await walk(e, '');
  return out;
}

export async function createModsSection(host: ModsUiHost): Promise<ModsSection> {
  const store: ModStore = await openModStore();
  const list = el('div', { className: 'bdb-modlist' });
  const status = el('div', { className: 'note bdb-modstatus', style: 'margin:.4rem 0' });
  const bar = el('div', { className: 'bdb-loading-bar' });
  const track = el('div', { className: 'bdb-loading-track', style: 'width:min(60vw,26rem);display:none;margin:.4rem auto' }, bar);
  const summary = el('summary', { textContent: 'Mods' });
  const details = el('details', { className: 'note bdb-mods' }, summary);
  let effects: Promise<EffectMap | null> | null = null;
  const effectMap = () => (effects ??= host.exe().then((b) => (b ? new EffectMap(b) : null)).catch(() => null));

  const stop = el('button', { textContent: 'Stoppen', style: 'display:none;margin:0 auto .4rem', title: 'Breek het downloaden of importeren af (er blijft niets half achter)' });
  let abort: AbortController | null = null;
  stop.onclick = () => abort?.abort();
  const progress = (p: ImportProgress) => {
    track.style.display = '';
    bar.style.width = `${p.total ? Math.min(100, (100 * p.done) / p.total) : 100}%`;
    status.textContent = p.label === 'Klaar' ? '' : `${p.phase === 'download' ? 'Downloaden' : 'Importeren'}… ${p.label} (${mb(p.done)} van ${mb(p.total)})`;
  };
  let importing = false;
  const busy = (on: boolean) => { importing = on; abort = on ? new AbortController() : null; stop.style.display = on ? 'block' : 'none'; details.classList.toggle('bdb-busy', on); if (on) status.textContent = 'Bezig…'; else track.style.display = 'none'; };
  const doImport = async (items: PickedFile[]) => {
    if (importing || !items.length) return;
    busy(true);
    try {
      const res = await importPicked(items, store, progress, abort!.signal);
      status.textContent = [res.added.length ? `${res.added.length === 1 ? 'Mod' : `${res.added.length} mods`} toegevoegd: ${res.added.map((m) => m.title).join(', ')}. Geldt bij de volgende keer Spelen.` : '', ...res.errors].filter(Boolean).join('\n');
    } catch (e) { host.error(e); } finally { busy(false); await render(); }
  };
  const doAdd = async (entry: CatalogueEntry) => {
    if (importing) return;
    if (entry.size > 100e6 && !confirm(`"${entry.title}" downloadt ${mb(entry.size)} van de bron en neemt ${mb(entry.unpacked)} in beslag in de opslag van je browser. Dit duurt een paar minuten. Doorgaan?`)) return;
    busy(true);
    try {
      const res = await addFromCatalogue(entry, store, { progress, signal: abort!.signal });
      status.textContent = res.errors.length
        ? `"${entry.title}" is niet toegevoegd: ${res.errors.join(' ')}`
        : `"${entry.title}" toegevoegd${res.added.length > 1 ? ` (${res.added.join(', ')})` : ''}. Hij staat nu in de lijst hieronder en geldt bij de volgende keer Spelen.`;
    } catch (e) { host.error(e); } finally { busy(false); await render(); }
  };

  const zipInput = el('input', { type: 'file', accept: '.zip,.rar,.txt', multiple: true, hidden: true });
  zipInput.onchange = () => { void doImport([...(zipInput.files ?? [])].map((f) => ({ path: f.name, file: f }))); zipInput.value = ''; };
  const dirInput = el('input', { type: 'file', multiple: true, hidden: true });
  dirInput.webkitdirectory = true;
  dirInput.onchange = () => { void doImport([...(dirInput.files ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))); dirInput.value = ''; };

  async function render() {
    const mods = await store.list();
    const active = mods.filter((m) => m.enabled);
    summary.textContent = mods.length ? `Mods (${active.length} van ${mods.length} aan)` : 'Mods';
    // which enabled mod is overruled by a later one
    const layer = new ModLayer(active.map((m) => ({ id: m.id, title: m.title, files: m.files.map((f) => ({ path: f.path, size: f.size, read: async () => new Uint8Array(0) })), patches: [] })));
    const lost = new Map<string, number>();
    for (const sh of layer.shadowed) lost.set(sh.modTitle, (lost.get(sh.modTitle) ?? 0) + 1);
    const em = mods.some((m) => m.patches.length) ? await effectMap() : null;
    const cache = readCache();
    list.replaceChildren(...mods.map((m, i) => row(m, i, mods.length, lost.get(m.title) ?? 0, em, cache)));
    if (!mods.length) list.replaceChildren(el('div', { className: 'note', textContent: 'Nog geen mods.' }));
    renderCatalogue(mods);
  }

  // ---- the catalogue (src/mods/catalogue.ts)
  const catBox = el('div', { className: 'bdb-catlist' });
  const link = (t: { label: string; url: string }) => el('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', textContent: t.label });
  const fitText = { nl: 'Nederlandse versie', data: 'alle versies', other: 'niet de Nederlandse' } as const;
  function catEntry(e: CatalogueEntry, mods: InstalledMod[]): HTMLElement {
    const have = mods.filter((m) => m.origin?.catalog === e.id);
    const can = addable(e);
    const btn = el('button', { textContent: have.length ? 'Opnieuw toevoegen' : 'Toevoegen', title: have.length ? 'Download opnieuw van de bron en vervang de toegevoegde mod' : 'Download deze mod van de bron en voeg hem toe aan de lijst (hij wordt niet vanzelf aangezet voor een spel dat al loopt)' });
    btn.onclick = () => { void doAdd(e); };
    const meta = e.status === 'dead' ? [] : [
      e.size ? `Download: ${mb(e.size)}${e.unpacked > e.size * 1.5 ? `, neemt ${mb(e.unpacked)} in beslag in je browser` : ''}` : '',
      `Bron: ${e.host}`,
    ].filter(Boolean);
    return el('div', { className: `bdb-catentry${e.status === 'dead' || e.fit === 'other' ? ' off' : ''}` },
      el('div', { className: 'bdb-cathead' }, el('b', { textContent: e.title }), el('span', { textContent: ` door ${e.authors.join('; ')}` }),
        el('span', { className: 'bdb-modbtns' }, ...(can ? [have.length ? el('span', { className: 'note', textContent: 'toegevoegd ✓ ' }) : '', btn] : []))),
      el('div', { className: 'bdb-moddesc', textContent: e.description }),
      e.status === 'dead' ? el('div', { className: 'bdb-warn', textContent: e.portNote }) : el('div', { className: 'bdb-catmeta' }, meta.join(' · ')),
      ...(e.status === 'dead' ? [] : [
        el('div', { className: e.fit === 'other' ? 'bdb-warn' : 'bdb-catmeta' }, el('b', { textContent: `Taalversie: ${fitText[e.fit]}. ` }), e.fitNote),
        el('div', { className: 'bdb-catmeta', textContent: `In de port: ${e.portNote}` }),
      ]),
      el('div', { className: 'bdb-catmeta' }, 'Bron en discussie: ', link(e.thread)));
  }
  function renderCatalogue(mods: InstalledMod[]) {
    const group = (title: string, es: CatalogueEntry[], open: boolean) => es.length ? el('details', { open }, el('summary', { textContent: title }), ...es.map((e) => catEntry(e, mods))) : '';
    catBox.replaceChildren(
      ...CATALOGUE.filter(addable).map((e) => catEntry(e, mods)),
      group('Voor andere taalversies: werken niet op de Nederlandse versie', CATALOGUE.filter((e) => e.status === 'live' && e.fit === 'other'), false),
      group('Niet meer beschikbaar bij de bron', CATALOGUE.filter((e) => e.status === 'dead'), false));
  }
  const catalogue = el('details', { className: 'bdb-cat' },
    el('summary', { textContent: 'Mod-catalogus: bekende mods met één klik toevoegen' }),
    el('div', { className: 'note', textContent: 'Deze mods zijn gemaakt door de genoemde makers en staan niet op deze website: bij "Toevoegen" haalt je browser ze rechtstreeks op bij de plek waar de maker ze publiceerde (MEGA, Rock Raiders United, GitHub, archive.org; die laatste drie via een tussenserver die alleen doorgeeft). Niets staat vanzelf aan: een toegevoegde mod komt in de lijst hieronder, als elke andere mod. Alle eer aan de makers; de links gaan naar hun oorspronkelijke topics.' }),
    catBox,
    el('div', { className: 'note', textContent: 'De voorbeeldmods van de LI2 Mod Manager (Debug Mode, Skipable Intros, Windowed Mode, Force Command Line) staan er niet bij: de port heeft daar eigen opties voor (Debugmenu, Introfilms overslaan; een venster is er altijd). ' },
      el('a', { href: THREADS.manager.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'LI2 Mod Manager' }), '.'));

  function row(m: InstalledMod, i: number, n: number, lostFiles: number, em: EffectMap | null, cache: Cache): HTMLElement {
    const byTarget = new Map<string, number>();
    let bytes = 0;
    for (const f of m.files) { byTarget.set(targetOf(f.path), (byTarget.get(targetOf(f.path)) ?? 0) + 1); bytes += f.size; }
    const check = el('input', { type: 'checkbox', checked: m.enabled, title: 'Aan of uit voor de volgende keer Spelen' });
    check.onchange = async () => { await store.setEnabled(m.id, check.checked); await render(); };
    const btn = (text: string, title: string, fn: () => void, disabled = false) => el('button', { textContent: text, title, disabled, onclick: fn });
    const parts: (Node | string)[] = [];
    if (m.files.length) {
      parts.push(el('div', { textContent: `Vervangt of voegt toe: ${m.files.length} bestand${m.files.length === 1 ? '' : 'en'} (${mb(bytes)}) in ${[...byTarget].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, c]) => `${t} (${c})`).join(', ')}${byTarget.size > 8 ? ', ...' : ''}.` }));
      if (lostFiles) parts.push(el('div', { className: 'bdb-warn', textContent: `${lostFiles} van deze bestanden worden overschreven door een mod lager in de lijst.` }));
      const shown = m.files.slice(0, 300);
      parts.push(el('details', {}, el('summary', { textContent: 'Bestanden' }), el('pre', { textContent: shown.map((f) => `${f.path}  (${mb(f.size)})`).join('\n') + (m.files.length > shown.length ? `\n... en ${m.files.length - shown.length} meer` : '') })));
    }
    if (m.patches.length) parts.push(patchBlock(m, em, cache));
    for (const w of m.warnings) parts.push(el('div', { className: 'bdb-warn', textContent: w }));
    if (m.origin) parts.push(el('div', { className: 'bdb-catmeta' }, 'Uit de catalogus. Bron en discussie: ', link({ label: m.origin.label, url: m.origin.url })));
    return el('div', { className: `bdb-mod${m.enabled ? '' : ' off'}` },
      el('div', { className: 'bdb-modhead' }, check, el('b', { textContent: m.title }), el('span', { textContent: m.author ? ` door ${m.author}` : '' }),
        el('span', { className: 'bdb-modbtns' },
          btn('↑', 'Eerder in de lijst (verliest van de mods eronder)', async () => { await store.move(m.id, -1); await render(); }, i === 0),
          btn('↓', 'Later in de lijst (wint van de mods erboven)', async () => { await store.move(m.id, 1); await render(); }, i === n - 1),
          btn('✕', 'Verwijderen', async () => { if (confirm(`"${m.title}" verwijderen?`)) { await store.remove(m.id); await render(); } }))),
      m.description ? el('div', { className: 'bdb-moddesc', textContent: m.description }) : '',
      ...parts);
  }

  function patchBlock(m: InstalledMod, em: EffectMap | null, cache: Cache): HTMLElement {
    let rows: PatchRow[] | null = null;
    if (em) { rows = reportPatches(em, loadPatches(m.patches)); saveEffects(m.id, em.pe.data.length, rows); }
    else if (cache[m.id]) rows = cache[m.id].rows;
    const n = (e: string) => rows?.filter((r) => r.effect === e).length ?? 0;
    const head = rows
      ? `${m.patches.length} patch${m.patches.length === 1 ? '' : 'es'} van het programma: ${n('works')} met effect, ${n('maybe')} onzeker, ${n('ignored')} genegeerd.`
      : `${m.patches.length} patch${m.patches.length === 1 ? '' : 'es'} van het programma. Welke effect hebben, zie je hier zodra het spel beschikbaar is (na het eerste keer spelen).`;
    return el('details', { open: !!rows && rows.some((r) => r.effect !== 'works') }, el('summary', { textContent: head }),
      ...(rows ?? []).map((r) => el('div', { className: `bdb-patch bdb-${r.effect}` }, el('b', { textContent: `[${MARK[r.effect]}] ` }), el('code', { textContent: r.text }), ` ${r.note}`)));
  }

  details.append(
    catalogue,
    el('div', { className: 'note', textContent: 'Importeer een mod in het formaat van de LI2 Mod Manager: een .zip of .rar, of een map met info.txt, patch.txt en/of _data (bestanden die archiefbestanden vervangen). Je kunt een bestand of map ook op deze pagina slepen. Grote pakketten (zoals de HD Texture Pack, 2 GB) worden bestand voor bestand bewaard. Een RAR-bestand met een wachtwoord, uit meerdere delen, of een groot RAR 5-bestand "solid" kan niet worden gelezen: pak het dan eerst uit en kies de map.' }),
    el('div', { className: 'books' },
      el('button', { textContent: 'Mod kiezen (.zip of .rar)…', onclick: () => zipInput.click() }),
      el('button', { textContent: 'Map kiezen…', onclick: () => dirInput.click() })),
    el('hr'),
    track, stop, status, list,
    ...(store.persistent ? [] : [el('div', { className: 'bdb-warn', textContent: 'Deze browser kan de mods niet bewaren: ze gelden alleen zolang dit venster openstaat.' })]),
    el('div', { className: 'note', textContent: 'Mods gelden bij de volgende keer Spelen. Bovenaan de lijst laadt eerst; als twee mods hetzelfde bestand vervangen, wint de onderste.' }),
    zipInput, dirInput);
  void cleanTemp();   // a cut-off download of an earlier visit
  await render();
  return { element: details, importPicked: doImport };
}
