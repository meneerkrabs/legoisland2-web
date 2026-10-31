// The built-in mod catalogue: the community mods for LEGO Eiland 2 that are known to be downloadable, with credits, and the code that fetches one from where its author
// published it and imports it like any other mod. NOTHING of the mods is hosted here (not in the repository, not on GitHub Pages): every source is fetched by the player's
// browser at the moment of "Toevoegen" - from MEGA directly, from RRU's file bucket / GitHub / archive.org through the byte-range relay (tools/proxy/nginx/le2-proxy.conf), and the
// "IXS-look" mod is built on the spot from the Island Xtreme Stunts disc (src/mods/ixslook.ts). Nothing is enabled automatically; an added mod is an ordinary entry of the mod list.
//
// Language fit (decided per entry, see docs/re/mods.md): the port is the Dutch build, and a patch of the executable (patch.txt) only fits the build it was made for.
//   'nl'    made for the Dutch version
//   'data'  only replaces files of the game's archives (textures, fonts, collision ...): the archive members of all language versions have the same names, so it fits
//   'other' a patch of the English / German / Italian executable. Without "original bytes" such a patch would write into the wrong place of the Dutch executable,
//           so these are listed with their credits but cannot be added ("werkt niet op de Nederlandse versie").
// A source that is dead (MEGA link blocked) is listed as 'dead': credits and thread, no button.
import { importPicked } from './manage.ts';
import type { ImportOptions, ImportProgress, PickedFile } from './manage.ts';
import { megaOpen, megaStream } from './mega.ts';
import { IXS_FILES, IXS_LOOK_FILES, buildIxsLook, readIxsBanks } from './ixslook.ts';
import type { ModStore } from './store.ts';

/** the byte-range relay (nginx on krokantekrab; CORS only for this site and the dev ports 5498 / 5499) */
export const RELAY_BASE = 'https://le2.143-47-181-190.sslip.io';

export const THREADS = {
  manager: { label: 'LI2 Mod Manager (Rock Raiders United)', url: 'https://rockraidersunited.com/topic/7381-li2-mod-manager/' },
  collection: { label: 'Mods voor alle talen (Rock Raiders United)', url: 'https://rockraidersunited.com/topic/8970-mods-collected-for-all-languages/' },
  hd: { label: 'HD Texture Pack (Rock Raiders United)', url: 'https://rockraidersunited.com/topic/8500-hd-texture-pack/' },
  ixs: { label: 'LEGO Island Xtreme Stunts (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lego_Island:_Xtreme_Stunts' },
} as const;
export type Thread = { label: string; url: string };

export type Source =
  /** a file of the relay (`/ia/...`, `/x/ore/...`, `/x/gh/...`) */
  | { kind: 'relay'; path: string; file: string }
  | { kind: 'mega'; link: string }
  | { kind: 'ixs' };

export type Fit = 'nl' | 'data' | 'other';
export type Status = 'live' | 'dead';

export interface CatalogueEntry {
  id: string;
  title: string;
  authors: string[];
  /** Dutch, one or two sentences */
  description: string;
  /** bytes that are downloaded (the IXS-look: what is read from the disc) */
  size: number;
  /** bytes it takes in the browser's storage once imported */
  unpacked: number;
  /** where it comes from, for the player ("MEGA", "ore.rockraidersunited.org (via de tussenserver)") */
  host: string;
  thread: Thread;
  fit: Fit;
  fitNote: string;
  /** what it does in this port */
  portNote: string;
  status: Status;
  source?: Source;
  /** only this mod folder of a multi-mod archive (the folder path contains it) */
  pick?: string;
}

const ore = (file: string) => `/x/ore/misc/${file}`;
const ORE = 'ore.rockraidersunited.org (via de tussenserver)';
const IA = 'archive.org (via de tussenserver)';
const GH = 'GitHub (via de tussenserver)';
const DEAD = 'Niet meer beschikbaar bij de bron: de MEGA-link van de maker is geblokkeerd of verwijderd.';
const NL = 'Gemaakt voor de Nederlandse versie.';
const DATA = 'Vervangt alleen bestanden van het spel (geen programmapatch), dus werkt in elke taalversie, ook de Nederlandse.';
const EN_ONLY = (lang: string) => `Patch voor het programma van de ${lang} versie. Werkt niet op de Nederlandse versie: de patch schrijft op adressen van het andere programma, dus de port laat hem liever weg.`;

export const CATALOGUE: CatalogueEntry[] = [
  {
    id: 'hd-texture', title: 'HD Texture Pack', authors: ['webfischi'],
    description: 'Alle 5000+ plaatjes van het spel vier keer zo scherp (opgeschaald met waifu2x). Een groot pakket: 512 MB downloaden, 2,2 GB in de opslag van je browser.',
    size: 511662626, unpacked: 2164645632, host: 'MEGA (rechtstreeks)', thread: THREADS.hd,
    fit: 'data', fitNote: `${DATA} (Volgens JappaWakka werkt het ook op de Nederlandse versie.)`,
    portNote: 'Werkt volledig: de port laadt de grotere plaatjes (met mipmaps) per zone en laat ze weer los als je de zone verlaat. Het eiland gebruikt dan ongeveer 560 MB geheugen in plaats van 180 MB.',
    status: 'live', source: { kind: 'mega', link: 'https://mega.nz/#!c4ACiQYI!ILA2jq_veMz2t1HuZeOfeszz0Mk1-38PwN_VYtVikD0' },
  },
  {
    id: 'ixs-look', title: 'IXS-look', authors: ['Silicon Dreams / LEGO Interactive (textures uit LEGO Island Xtreme Stunts, 2002)', 'deze port (idee en samenstelling)'],
    description: 'Geeft het eiland een stukje Island Xtreme Stunts: het helderblauwe IXS-zeewater, de IXS-ondergrond voor het zand en de IXS-outfits van Pepper en Infomaniac. De mod wordt bij het toevoegen in je browser gemaakt van de IXS-schijf op archive.org (er wordt maar een paar honderd kB van de schijf gelezen); niets ervan staat op deze website.',
    size: Object.values(IXS_FILES).reduce((n, f) => n + f.size, 0), unpacked: 4397273, host: 'archive.org, schijfbeeld van IXS (via de tussenserver)', thread: THREADS.ixs,
    fit: 'data', fitNote: DATA,
    portNote: `Werkt: ${IXS_LOOK_FILES} plaatjes in 20 zones worden vervangen (zee, zand, twee shirts). Het gras is er bewust niet bij: de vervangen vultegel paste niet bij de ongewijzigde randtegels.`,
    status: 'live', source: { kind: 'ixs' },
  },
  {
    id: 'island-grass', title: 'Island Grass', authors: ['Xiron'],
    description: 'Nieuwe grastexturen voor het eiland en Pepper\'s huis. Voorbeeldmod van de LI2 Mod Manager (komt uit het zipbestand van de manager, 3 MB; alleen deze mod wordt overgenomen).',
    size: 2942258, unpacked: 4_500_000, host: `${GH} (release 1.2.5 van de LI2 Mod Manager)`, thread: THREADS.manager,
    fit: 'data', fitNote: DATA, portNote: 'Werkt: vervangt 108 plaatjes van het gras (o.a. 50 in het eiland, z02LGI).',
    status: 'live', source: { kind: 'relay', path: '/x/gh/JeffRuLz/LI2-Mod-Manager/releases/download/v1.2.5/LI2.Mod.ManagerV1.2.5.zip', file: 'LI2.Mod.ManagerV1.2.5.zip' }, pick: 'mods/Island Grass',
  },
  {
    id: 'legal-tracks', title: 'Legal Tracks (Walk on Tracks)', authors: ['Xiron'],
    description: 'Je mag over de spoorlijn van het eiland lopen. Twee varianten: type 1 (pas op voor de trein, de Stationchef wil niet dat je overreden wordt) en type 2 (de stationchef geeft er niets meer om).',
    size: 628571, unpacked: 1168000, host: ORE, thread: THREADS.collection,
    fit: 'data', fitNote: `${DATA} Het bestand (land.col, 583.892 bytes) is even groot als dat van de Nederlandse versie.`,
    portNote: 'Vervangt de botsingsgegevens van het eiland (land.col); de port leest die, dus de spoorlijn wordt begaanbaar. Beide varianten komen als aparte mods in de lijst; de onderste wint.',
    status: 'live', source: { kind: 'relay', path: ore('legal_tracks_%28li2_mod_manager%29.zip'), file: 'legal_tracks.zip' },
  },
  {
    id: 'skeleton', title: 'Skeleton Mod', authors: ['Terrev'],
    description: 'Verandert alle personages in skeletten. Een RAR-bestand van 11 MB (44 MB uitgepakt) dat de gegevens van het eiland (z02LGI) vervangt.',
    size: 11490039, unpacked: 44849150, host: ORE, thread: THREADS.collection,
    fit: 'data', fitNote: 'Gemaakt voor de Engelse versie (V1) en alleen bestanden: ze komen één op één overeen met de Nederlandse (alle 2806 bestanden bestaan daar ook, 2697 zijn even groot). Niet elk detail is getest.',
    portNote: 'Vervangt modellen, animaties, botsingen en teksten van het eiland; de port leest die uit het archief, dus het effect hoort zichtbaar te zijn.',
    status: 'live', source: { kind: 'relay', path: ore('skeleton_mod_for_mod_manager.rar'), file: 'skeleton_mod_for_mod_manager.rar' },
  },
  {
    id: 'nicer-skies-nl', title: 'Nicer Skies (Nederlands)', authors: ['JappaWakka'],
    description: 'Maakt alle blauwe luchten mooier (een zachtere kleur).',
    size: 676, unpacked: 0, host: IA, thread: THREADS.collection, fit: 'nl', fitNote: NL,
    portNote: 'Werkt: alle 11 plekken zijn lucht- en mistkleuren die de port uit het programma leest; de lucht van het eiland verandert.',
    status: 'live', source: { kind: 'relay', path: '/ia/legoeiland2dutch/li2_nicer_skies_dutch.zip', file: 'li2_nicer_skies_dutch.zip' },
  },
  {
    id: 'biplane-nl', title: 'Bi-Plane Fuel Fix (Nederlands)', authors: ['Xiron', 'JappaWakka'],
    description: 'Herstelt het veel te snel leeglopen van de benzine in het tweedekkerspel. Twee varianten: beeldscherm vol en venster.',
    size: 1715, unpacked: 0, host: IA, thread: THREADS.collection, fit: 'nl', fitNote: NL,
    portNote: 'Geen effect in de port: de patch vergroot de tank, maar de port heeft de waarde vast in de code. De port rekent met vaste 60 Hz, één stap per beeld zoals het origineel op een 60 Hz-scherm: de benzine loopt dus precies zo snel leeg als daar. Je ziet dat in de lijst bij de patch.',
    status: 'live', source: { kind: 'relay', path: '/ia/legoeiland2dutch/li2_bi-plane_fuel_fix_dutch.zip', file: 'li2_bi-plane_fuel_fix_dutch.zip' },
  },
  {
    id: 'skateboard-nl', title: 'Skateboard Speed Modifier (Nederlands)', authors: ['JappaWakka'],
    description: 'Verhoogt de snelheid van het skateboard van 0,75 naar 1,15.',
    size: 724, unpacked: 0, host: IA, thread: THREADS.collection, fit: 'nl', fitNote: NL,
    portNote: 'Geen effect in de port: de topsnelheid van het skateboard staat vast in de code van de port. Je ziet dat in de lijst bij de patch.',
    status: 'live', source: { kind: 'relay', path: '/ia/legoeiland2dutch/li2_skateboard_speed_modifier_dutch.zip', file: 'li2_skateboard_speed_modifier_dutch.zip' },
  },
  // ---- other language versions: listed, not addable
  {
    id: 'nicer-skies-en', title: 'Nicer Skies + Castle Island Day (Engels)', authors: ['Xiron'],
    description: 'Mooiere luchten, en Castle Island overdag in plaats van \'s avonds.',
    size: 487358, unpacked: 787000, host: ORE, thread: THREADS.collection, fit: 'other', fitNote: EN_ONLY('Engelse'),
    portNote: 'Voor de Nederlandse versie bestaat "Nicer Skies (Nederlands)" hierboven.',
    status: 'live', source: { kind: 'relay', path: ore('li2_nicer_skies.zip'), file: 'li2_nicer_skies.zip' },
  },
  {
    id: 'biplane-en', title: 'Bi-Plane Fuel Fix (Engels, type 1 en 2; Italiaans)', authors: ['Xiron'],
    description: 'Dezelfde reparatie van het tweedekkerspel voor de Engelse en Italiaanse versies.',
    size: 1053 * 2 + 996, unpacked: 0, host: ORE, thread: THREADS.collection, fit: 'other', fitNote: EN_ONLY('Engelse en Italiaanse'),
    portNote: 'Voor de Nederlandse versie bestaat "Bi-Plane Fuel Fix (Nederlands)" hierboven (in de port zonder effect).',
    status: 'live',
  },
  {
    id: 'skateboard-other', title: 'Skateboard Speed Modifier (Engels/Spaans en Duits)', authors: ['Xiron', 'salex (Duitse versie)'],
    description: 'Hogere skateboardsnelheid voor de Engelse, Spaanse en Duitse versies.',
    size: 482 + 725, unpacked: 0, host: `${ORE}; ${GH}`, thread: THREADS.collection, fit: 'other', fitNote: EN_ONLY('Engelse, Spaanse of Duitse'),
    portNote: 'Voor de Nederlandse versie bestaat "Skateboard Speed Modifier (Nederlands)" hierboven (in de port zonder effect).',
    status: 'live',
  },
  {
    id: 'hd-font', title: 'HD Font (Engels)', authors: ['EDlTOR'],
    description: 'Het lettertype van het spel (Balloon 12 en 24) scherper, 8 keer zo groot als plaatje.',
    size: 345540, unpacked: 1245675, host: ORE, thread: THREADS.collection, fit: 'other',
    fitNote: 'Alleen bestanden, maar gemaakt voor de Engelse versie. Uitgeprobeerd in deze port: de letters staan in het plaatje anders dan in het lettertype van de Nederlandse versie, dus de menutekst wordt onleesbaar. (Voor andere talen maakte webfischi een eigen "HD Font"; die staat niet meer online, zie hieronder.)',
    portNote: 'Voor een scherper lettertype in de Nederlandse versie is er nu geen werkende mod.',
    status: 'live', source: { kind: 'relay', path: ore('hd_font_li2.zip'), file: 'hd_font_li2.zip' },
  },
  // ---- dead
  ...['HD Texture voor Castle Island Day', 'HD Font voor niet-Engelse versies', 'Island Grass HD', 'Nicer Skies (Duits)'].map((title, i): CatalogueEntry => ({
    id: `dead-${i}`, title, authors: ['webfischi'],
    description: 'Stond bij het HD Texture Pack-topic.',
    size: 0, unpacked: 0, host: 'MEGA', thread: THREADS.hd, fit: 'data', fitNote: '', portNote: DEAD, status: 'dead',
  })),
];

export const catalogueEntry = (id: string) => CATALOGUE.find((e) => e.id === id);
/** shown as the main list: can be added */
export const addable = (e: CatalogueEntry) => e.status === 'live' && e.fit !== 'other' && !!e.source;

// ------------------------------------------------------------------------------------------------------------------------ fetching

const mbs = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
export type Progress = (p: ImportProgress) => void;

/** a file of the relay as a Blob; failures say what went wrong in Dutch */
export async function fetchRelay(path: string, o: { signal?: AbortSignal; onBytes?: (n: number) => void; fetchFn?: typeof fetch; host?: string } = {}): Promise<Blob> {
  const host = o.host ?? 'de bron';
  let res: Response;
  try { res = await (o.fetchFn ?? fetch)(RELAY_BASE + path, { signal: o.signal }); } catch (e) {
    if (o.signal?.aborted) throw new Error('Afgebroken.');
    throw new Error(`Kon ${host} niet bereiken: geen internetverbinding, of de tussenserver is niet bereikbaar (${e instanceof Error ? e.message : e}).`);
  }
  if (!res.ok) throw new Error(res.status === 404 ? `${host} heeft dit bestand niet meer (fout 404): de mod is verplaatst of verwijderd.` : `${host} antwoordt met fout ${res.status}.`);
  const parts: Uint8Array[] = [];
  const reader = res.body?.getReader();
  try {
    if (!reader) parts.push(new Uint8Array(await res.arrayBuffer()));
    else for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); o.onBytes?.(value.length); }
  } catch (e) {
    if (o.signal?.aborted) throw new Error('Afgebroken.');
    throw new Error(`Het downloaden van ${host} is onderbroken (${e instanceof Error ? e.message : e}).`);
  }
  return new Blob(parts as BlobPart[]);
}

// ---- a temporary file for big downloads (OPFS when there is one, else memory)
const TMP = 'le2-tmp';
export interface TempFile { write(c: Uint8Array): Promise<void>; finish(): Promise<Blob>; discard(): Promise<void> }
export async function tempFile(): Promise<TempFile> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav?.storage?.getDirectory) {
    try {
      const dir = await (await nav.storage.getDirectory()).getDirectoryHandle(TMP, { create: true });
      const name = `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      return {
        write: (c) => w.write(c as unknown as BufferSource),
        finish: async () => { await w.close(); return (await dir.getFileHandle(name)).getFile(); },
        discard: async () => { await w.abort().catch(() => { /* closed already */ }); await dir.removeEntry(name).catch(() => { /* gone */ }); },
      };
    } catch { /* fall through to memory */ }
  }
  const parts: Uint8Array[] = [];
  return { write: async (c) => { parts.push(c); }, finish: async () => new Blob(parts as BlobPart[]), discard: async () => { parts.length = 0; } };
}
/** leftovers of a download that was cut off (tab closed): removed when the mod list opens */
export async function cleanTemp(): Promise<void> {
  try {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.storage?.getDirectory) return;
    await (await nav.storage.getDirectory()).removeEntry(TMP, { recursive: true }).catch(() => { /* none */ });
  } catch { /* ignore */ }
}

async function ensureRoom(bytes: number, store: ModStore) {
  if (!store.persistent) return;
  const est = await (globalThis as { navigator?: Navigator }).navigator?.storage?.estimate?.().catch(() => null);
  if (est?.quota && est.quota - (est.usage ?? 0) < bytes) {
    throw new Error(`Te weinig opslagruimte in deze browser: ${mbs(bytes)} nodig, ${mbs(est.quota - (est.usage ?? 0))} beschikbaar. Een privé- of tijdelijk venster heeft weinig ruimte; ruim ruimte op of gebruik een gewoon venster.`);
  }
}

export interface AddResult { added: string[]; errors: string[] }
export interface AddHooks { progress?: Progress; signal?: AbortSignal; fetchFn?: typeof fetch }

/**
 * Fetch a catalogue mod from its source and import it. Failures (offline, 404, a changed or damaged file, no room) give a Dutch message and leave nothing behind: the
 * download goes to a temporary file that is deleted again, and when any mod of the entry fails to import the ones that did are removed again.
 */
export async function addFromCatalogue(entry: CatalogueEntry, store: ModStore, hooks: AddHooks = {}): Promise<AddResult> {
  const fail = (e: unknown): AddResult => ({ added: [], errors: [e instanceof Error ? e.message : String(e)] });
  if (entry.status !== 'live' || !entry.source) return fail(new Error('Deze mod is niet meer beschikbaar bij de bron.'));
  if (!addable(entry)) return fail(new Error('Deze mod is voor een andere taalversie en werkt niet op de Nederlandse versie; hij kan daarom niet worden toegevoegd.'));
  const { signal } = hooks;
  const origin = { catalog: entry.id, url: entry.thread.url, label: entry.thread.label };
  const describe: NonNullable<ImportOptions['describe']> = (info, count) => ({ title: count === 1 ? entry.title : info.title, author: entry.authors.join(', '), description: entry.description });
  const opts: ImportOptions = { source: `catalogus:${entry.id}`, origin, describe, only: entry.pick ? (f) => f.toLowerCase().includes(entry.pick!.toLowerCase()) : undefined };
  const report = (label: string, done: number, total: number, phase: 'download' | 'import') => hooks.progress?.({ label, done, total, phase });
  let cleanup: () => Promise<void> = async () => { /* nothing */ };
  const before = new Set((await store.list()).map((m) => m.id));
  try {
    let picked: PickedFile[];
    const src = entry.source;
    if (src.kind === 'relay') {
      await ensureRoom(entry.unpacked * 1.05 + entry.size, store);
      let n = 0;
      report(`${entry.title}`, 0, entry.size, 'download');
      const blob = await fetchRelay(src.path, { signal, fetchFn: hooks.fetchFn, host: entry.host.replace(/ \(.*$/, ''), onBytes: (k) => { n += k; report(entry.title, n, entry.size, 'download'); } });
      picked = [{ path: src.file, file: blob }];
    } else if (src.kind === 'mega') {
      const f = await megaOpen(src.link, hooks.fetchFn);
      // the packed file goes to a temporary file on disk (not into memory), then it is unpacked file by file into the store
      await ensureRoom(f.size + entry.unpacked * 1.05, store);
      const tmp = await tempFile();
      cleanup = () => tmp.discard();
      let n = 0;
      const reader = megaStream(f, { signal, fetchFn: hooks.fetchFn, onBytes: (k) => { n += k; report(`${f.name} van MEGA`, n, f.size, 'download'); } }).getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; await tmp.write(value); }
      picked = [{ path: f.name, file: await tmp.finish() }];
    } else {
      report('IXS-schijf lezen', 0, entry.size, 'download');
      const url = `${RELAY_BASE}/ia/lixsrgn-1/LIXSRGN1.BIN`;
      const doFetch = hooks.fetchFn ?? fetch;
      const { banks } = await readIxsBanks(async (s, e) => {
        let res: Response;
        try { res = await doFetch(url, { headers: { Range: `bytes=${s}-${e - 1}` }, signal }); } catch { throw new Error('Kon archive.org (de IXS-schijf) niet bereiken via de tussenserver: geen internetverbinding?'); }
        if (res.status !== 206 && !(res.status === 200 && s === 0)) throw new Error(res.status === 404 ? 'De IXS-schijf staat niet meer op archive.org (fout 404).' : `archive.org (de IXS-schijf) antwoordt met fout ${res.status}.`);
        return new Uint8Array(await res.arrayBuffer());
      }, (p) => report(`IXS-schijf: ${p}`, 0, entry.size, 'download'));
      report('IXS-look maken', entry.size, entry.size, 'download');
      const mod = buildIxsLook(banks);
      const enc = new TextEncoder();
      picked = [{ path: 'IXS-look/info.txt', file: new Blob([enc.encode(mod.info)]) }, ...mod.files.map((f) => ({ path: `IXS-look/${f.path}`, file: new Blob([f.data as BlobPart]) }))];
      await ensureRoom(entry.unpacked * 1.05, store);
    }
    const res = await importPicked(picked, store, (p) => report(p.label, p.done, p.total, 'import'), signal, opts);
    if (res.errors.length || !res.added.length) {
      // all or nothing
      for (const m of res.added) await store.remove(m.id).catch(() => { /* ignore */ });
      return { added: [], errors: res.errors.length ? res.errors : ['Er is niets toegevoegd.'] };
    }
    return { added: res.added.map((m) => m.title), errors: [] };
  } catch (e) {
    // whatever was half-way in the store is gone: importPicked removes its own unfinished mod; remove anything new that did get committed
    for (const m of await store.list().catch(() => [])) if (!before.has(m.id) && m.origin?.catalog === entry.id) await store.remove(m.id).catch(() => { /* ignore */ });
    return fail(e);
  } finally {
    await cleanup().catch(() => { /* ignore */ });
  }
}
