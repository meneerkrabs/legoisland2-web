// Loading DirectMusic assets (segment + its styles + DLS collections) through a path -> bytes callback.
import { parseSegment, parseStyle } from './format.ts';
import type { DmSegment, DmStyle } from './format.ts';
import { parseDls } from './dls.ts';
import type { DlsCollection } from './dls.ts';
import type { DmSegmentAssets } from './sequencer.ts';

/** Reads a file below `_data/sounds/DirectMusic/` (case-insensitive path, '/' separated, e.g. "menu/Menu.sgt"). */
export type DmReadFile = (path: string) => Promise<Uint8Array>;

export interface DmLoadedSegment extends DmSegmentAssets {
  /** DLS collections by lower-case file name, plus the primary one under the key "" */
  dls: Map<string, DlsCollection>;
  dir: string;
}

const dlsCache = new WeakMap<DmReadFile, Map<string, Promise<DlsCollection>>>();
const styleCache = new WeakMap<DmReadFile, Map<string, Promise<DmStyle>>>();

function cached<T>(map: WeakMap<DmReadFile, Map<string, Promise<T>>>, read: DmReadFile, path: string, parse: (b: Uint8Array) => T): Promise<T> {
  let m = map.get(read);
  if (!m) { m = new Map(); map.set(read, m); }
  const k = path.toLowerCase();
  let p = m.get(k);
  if (!p) { p = read(path).then(parse); m.set(k, p); }
  return p;
}

export const loadDlsFile = (read: DmReadFile, path: string) => cached(dlsCache, read, path, parseDls);
export const loadStyleFile = (read: DmReadFile, path: string) => cached(styleCache, read, path, parseStyle);

/**
 * Load a segment from `dir` (e.g. "menu") with all the styles it names and the DLS collection `dlsFile` (the music table's `dls` field;
 * band entries that name some other .dls - stale authoring names such as "DLS Collection1.dls" - fall back to it).
 */
export async function loadSegment(read: DmReadFile, dir: string, segFile: string, dlsFile: string): Promise<DmLoadedSegment> {
  const seg: DmSegment = parseSegment(await read(`${dir}/${segFile}`));
  const styles = new Map<string, DmStyle>();
  const names = new Set<string>();
  for (const e of seg.styles) names.add(e.ref.file);
  await Promise.all([...names].map(async (n) => {
    try { styles.set(n.toLowerCase(), await loadStyleFile(read, `${dir}/${n}`)); } catch { /* missing style: that part of the segment stays silent */ }
  }));
  const dls = new Map<string, DlsCollection>();
  const primary = await loadDlsFile(read, `${dir}/${dlsFile}`);
  dls.set('', primary);
  dls.set(dlsFile.toLowerCase(), primary);
  const others = new Set<string>();
  const bandRefs = [...seg.bands.map((b) => b.band), ...[...styles.values()].flatMap((s) => s.bands)];
  for (const b of bandRefs) for (const i of b.instruments) if (i.ref && i.ref.file && !dls.has(i.ref.file.toLowerCase())) others.add(i.ref.file);
  await Promise.all([...others].map(async (n) => {
    try { dls.set(n.toLowerCase(), await loadDlsFile(read, `${dir}/${n}`)); } catch { dls.set(n.toLowerCase(), primary); }
  }));
  return { seg, styles, dls, dir };
}
