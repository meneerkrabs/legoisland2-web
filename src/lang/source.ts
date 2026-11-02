// Where a language pack's files come from (docs/re/language.md), tried in this order:
//   1. a disc the player gave this session: an English CD folder / an installed English game folder (picked on the start screen; kept in memory only)
//   2. an English ISO the player added (kept in this browser's OPFS as `isos/le2-en.iso`, like the Dutch one is as `le2.iso`)
//   3. the dev copy in public/data/le2-en (dev server only, like public/data/le2)
//   4. archive.org through the range relay (the same relay and the same way as the Dutch ISO, library.ts `rangeFiles`): the disc's directory and cabinet header are read, then only the
//      members of the language are fetched, on demand, in blocks that Cache Storage keeps: the message tables and fonts (~0.5 MB) at once, the speech clips (32 MB in all) as the game
//      asks for them. Without the relay there is no route (the cabinet is not readable without ranges short of downloading 340 MB), and the game stays Dutch.
// Nothing here ever blocks the game: `openLanguage` is given a time limit and a failure is reported as a notice while the Dutch data plays on.
import { InstallShieldCab } from '../engine/installshield.ts';
import { IsoVfs } from '../engine/vfs.ts';
import { CachedSource, HttpRangeSource } from '../engine/rangesource.ts';
import { FileSet, cabFileRefs, locateCabDir } from '../files.ts';
import type { FileRef, GameFiles, Progress } from '../files.ts';
import { isoFiles, proxyBase, proxyUrl } from '../library.ts';
import { LanguageFiles, isPackEdition, langWarmPaths } from './pack.ts';
import type { LangPack } from './pack.ts';

export type LangOrigin = 'cd' | 'iso' | 'dev' | 'archive';
export interface OpenedLanguage { files: LanguageFiles; origin: LangOrigin }

/** the disc's language files are missing from the folder / ISO the player gave: shown as such */
export class LanguageUnavailable extends Error {}

// ---- 1. the session's own disc (a CD folder): in memory only
let sessionDisc: GameFiles | null = null;
export const setSessionLanguageDisc = (f: GameFiles | null) => { sessionDisc = f; };
export const sessionLanguageDisc = () => sessionDisc;

// ---- 2. an own ISO in OPFS
const opfsIsos = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('isos', { create: true });
const EN_ISO = 'le2-en.iso';

export async function storedLanguageIso(): Promise<File | null> {
  try { return await (await (await opfsIsos()).getFileHandle(EN_ISO)).getFile(); } catch { return null; }
}
export async function removeLanguageIso() {
  try { await (await opfsIsos()).removeEntry(EN_ISO); } catch { /* nothing stored */ }
}
export async function languageIsoHandle(): Promise<FileSystemFileHandle> {
  return (await opfsIsos()).getFileHandle(EN_ISO, { create: true });
}

// ---- 3. dev: public/data/le2-en (listed by vite.config.ts at /__le2/manifest-en.json)
async function devFiles(): Promise<GameFiles | null> {
  if (!import.meta.env.DEV) return null;
  const res = await fetch(`${import.meta.env.BASE_URL}__le2/manifest-en.json`).catch(() => null);
  if (!res?.ok || !res.headers.get('content-type')?.includes('json')) return null;
  const m = (await res.json()) as { files: { path: string; size: number }[] };
  if (!m.files.length) return null;
  const base = `${import.meta.env.BASE_URL}data/le2-en/`;
  const refs: FileRef[] = m.files.map((f) => ({
    path: f.path,
    size: f.size,
    read: async () => {
      const r = await fetch(base + f.path.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) throw new Error(`${f.path}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  }));
  return new FileSet('dev', refs, async () => null);
}

// ---- 4. archive.org through the relay
export async function rangeLanguageFiles(proxy: string, pack: LangPack, onProgress?: Progress): Promise<GameFiles> {
  let lastErr: unknown;
  for (const item of pack.items) {
    try {
      onProgress?.(0, 1, 'Taalbestanden zoeken…');
      const url = proxyUrl(proxy, item);
      let size = item.size;
      let cached = new CachedSource(new HttpRangeSource(url, size), `le2-range-${item.item}`);
      void cached.prefetch(0, 64 << 10).catch(() => {});
      void cached.prefetch(size - (512 << 10), size).catch(() => {});   // the directory records sit at the end of the disc
      const real = await HttpRangeSource.probe(url);
      if (real !== size) { console.warn(`ISO ${item.item}: ${real} bytes, verwacht ${size}`); size = real; cached = new CachedSource(new HttpRangeSource(url, size), `le2-range-${item.item}`); }
      const iso = await IsoVfs.open(cached);
      const dir = locateCabDir(iso.list());
      if (dir === null) throw new Error('geen cabinet in de ISO');
      const cab = await InstallShieldCab.open(iso.source(`${dir}data1.hdr`), [iso.source(`${dir}data1.cab`), iso.source(`${dir}data2.cab`)]);
      const fs = new FileSet('archive', cabFileRefs(cab), async () => null, cached.loading);
      if (!isPackEdition(fs.list(), pack)) throw new Error(`geen map sounds/speech/${pack.dir} op deze schijf`);
      fs.route = 'range';
      void fs.ready(langWarmPaths(pack)).catch((e) => console.warn('taal voorladen mislukt', e));
      return fs;
    } catch (e) {
      lastErr = e;
      console.warn(`taalpakket via ${proxy} (${item.item}) mislukt`, e);
    }
  }
  throw lastErr;
}

/** a disc the player gave (CD folder, ISO): is it the pack's edition? */
function checked(files: GameFiles, pack: LangPack): GameFiles {
  if (!isPackEdition(files.list(), pack)) throw new LanguageUnavailable(`Dit is niet de ${pack.label}-versie van het spel (er is geen map sounds/speech/${pack.dir}).`);
  return files;
}

/**
 * Open the language pack's files and lay them over `base`. Resolves with the wrapped files and where they came from, or rejects (the caller keeps the Dutch files and says so).
 * `timeoutMs`: the relay route gives up after this long (default 30 s) so a slow or blocked relay never holds the game back.
 */
export async function openLanguage(base: GameFiles, pack: LangPack, onProgress?: Progress, timeoutMs = 30000): Promise<OpenedLanguage> {
  // `?langsource=archive` skips the local routes (tests of the relay route)
  const only = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('langsource') : null;
  const find = async (): Promise<{ files: GameFiles; origin: LangOrigin }> => {
    if (only !== 'archive') return findLocal();
    return findRemote();
  };
  const findLocal = async (): Promise<{ files: GameFiles; origin: LangOrigin }> => {
    if (sessionDisc) return { files: checked(sessionDisc, pack), origin: 'cd' };
    const iso = await storedLanguageIso();
    if (iso) return { files: checked(await isoFiles(iso, 'iso', onProgress), pack), origin: 'iso' };
    const dev = await devFiles();
    if (dev) return { files: checked(dev, pack), origin: 'dev' };
    return findRemote();
  };
  const findRemote = async (): Promise<{ files: GameFiles; origin: LangOrigin }> => {
    const proxy = proxyBase();
    if (!proxy) throw new LanguageUnavailable('De taal komt van je eigen ISO of cd (kies die bij "Eigen cd of ISO gebruiken"), of van archive.org via de tussenserver; die staat nu uit.');
    return { files: await rangeLanguageFiles(proxy, pack, onProgress), origin: 'archive' };
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new LanguageUnavailable('archive.org via de tussenserver antwoordde niet op tijd.')), timeoutMs); });
  const work = find();
  work.catch(() => { /* (the race below reports it; a failure after the time limit must not be an unhandled rejection) */ });
  let got: Awaited<typeof work>;
  try { got = await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
  const files = new LanguageFiles(base, got.files, pack);
  if (files.replaced < 1000) throw new LanguageUnavailable(`Het taalpakket is onvolledig (${files.replaced} bestanden).`);
  return { files, origin: got.origin };
}

/**
 * Where the pack would come from if the game started now (the start screen's note), without opening anything: the session's CD, an own ISO, the dev copy, the relay, or null (no route).
 * `proxy` says whether the relay route is configured.
 */
export async function languageRoute(): Promise<LangOrigin | null> {
  if (sessionDisc) return 'cd';
  if (await storedLanguageIso()) return 'iso';
  if (await devFiles().then((f) => !!f, () => false)) return 'dev';
  return proxyBase() ? 'archive' : null;
}
