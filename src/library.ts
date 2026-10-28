// Where the game files come from: an ISO the user supplied (kept in the browser's Origin Private File System), a CD
// folder picked in the browser, dev copies in public/data/le2/, or — by default — the ISO on archive.org.
//
// The game lives inside an InstallShield cabinet on the CD (`LEGO Eiland 2/data1.hdr`, `data1.cab`, `data2.cab`).
// archive.org serves single files out of the ISO with CORS (view_archive.php) but without byte ranges, so the three
// cabinet files (~342 MB) are downloaded once as whole files and kept in OPFS; after that every game file is read
// (and decompressed) out of the cabinet on demand. The four movies are plain MPEG files on the CD and are streamed
// from archive.org when they play.
//
// Two Dutch ISOs of the game exist on archive.org with the same layout and byte-identical cabinet files:
//   legoeiland2dutch / "LEGO Eiland 2 De Wraak van Dondersteen (Dutch).iso" (450 813 952 bytes)
//   legoeiland2      / "LEGO Eiland 2.iso" (448 049 152 bytes; older mastering, different timestamps/manual only)
// The first is the default, the second the fallback when the first fails.

import { InstallShieldCab } from './engine/installshield.ts';
import { IsoVfs } from './engine/vfs.ts';
import { GrowingSource, LoadState, blobSource, sliceSource, type ByteSource } from './engine/bytesource.ts';
import { CachedSource, HttpRangeSource } from './engine/rangesource.ts';
import {
  blobMedia, CAB_FILES, CAB_TOTAL, cabFileRefs, fetchMedia, FileSet, locateCabDir, locateInstalledDir, movieInfo, sourceMedia,
  type FileRef, type GameFiles, type MediaFile, type Progress,
} from './files.ts';

export const GAME_TITLE = 'LEGO Eiland 2: De Wraak van Dondersteen';

export const ARCHIVE_ITEMS = [
  { item: 'legoeiland2dutch', iso: 'LEGO Eiland 2 De Wraak van Dondersteen (Dutch).iso' },
  { item: 'legoeiland2', iso: 'LEGO Eiland 2.iso' },
];
export const ARCHIVE_PAGE = `https://archive.org/details/${ARCHIVE_ITEMS[0].item}`;
/** The folder on the CD that holds the cabinet and the movies. */
const CD_DIR = 'LEGO Eiland 2';

export type Source = 'iso' | 'dev' | 'archive';
export interface Library {
  source: Source;
  /** The archive.org files are already stored in this browser (no download needed). */
  cached: boolean;
  open: (onProgress?: Progress) => Promise<GameFiles>;
  /** A CORS proxy for HTTP range requests is configured (first start fetches only what is needed). */
  proxy?: boolean;
}

const opfs = async () => navigator.storage.getDirectory();
const opfsDir = async (name: string) => (await opfs()).getDirectoryHandle(name, { create: true });

export const archiveUrl = (item: { item: string; iso: string }, path: string) =>
  `https://archive.org/download/${item.item}/${encodeURIComponent(item.iso)}/${path.split('/').map(encodeURIComponent).join('%2F')}`;

// ---- picking the source

export async function availableSource(): Promise<Library> {
  try {
    const h = await (await opfsDir('isos')).getFileHandle('le2.iso').catch(() => null);
    if (h) return { source: 'iso', cached: true, open: async (p) => isoFiles(await h.getFile(), 'iso', p) };
  } catch (e) {
    console.warn('OPFS niet beschikbaar', e);
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('source') !== 'archive') {
    const dev = await devManifest();
    if (dev) return { source: 'dev', cached: true, open: async () => devFiles(dev) };
  }
  const cached = !!(await storedArchive());
  return { source: 'archive', cached, proxy: !!proxyBase(), open: (p) => archiveFiles(p) };
}

// ---- ISO (own) and CD folder

/** The game from an ISO: find the cabinet folder, open the cabinet over lazily read slices of the ISO. */
export async function isoFiles(iso: Blob, source: 'iso' | 'cd' = 'iso', onProgress?: Progress): Promise<GameFiles> {
  const vfs = await IsoVfs.open(iso);
  const paths = vfs.list();
  const dir = locateCabDir(paths);
  if (dir === null) throw new Error('Geen InstallShield-cabinet (data1.hdr, data1.cab, data2.cab) gevonden in deze ISO.');
  onProgress?.(0, 1, 'Spelbestanden lezen…');
  const cab = await InstallShieldCab.open(vfs.file(`${dir}data1.hdr`), [vfs.file(`${dir}data1.cab`), vfs.file(`${dir}data2.cab`)]);
  const moviePaths = new Map(paths.map((p) => [p.toLowerCase(), p]));
  const movie = async (name: string): Promise<MediaFile | null> => {
    const info = movieInfo(name);
    if (!info) return null;
    // normally "<dir>Movies/<file>"; otherwise any file with that name
    const p = moviePaths.get(`${dir}movies/${info.file}`.toLowerCase()) ?? paths.find((x) => x.toLowerCase().endsWith(`/${info.file.toLowerCase()}`));
    return p ? blobMedia(vfs.file(p)) : null;
  };
  onProgress?.(1, 1);
  return new FileSet(source, cabFileRefs(cab), movie);
}

/** A CD folder picked with <input webkitdirectory> (the CD root, the `LEGO Eiland 2` folder, or an installed game folder). */
export async function cdFolder(files: Iterable<[string, Blob]>, onProgress?: Progress): Promise<GameFiles> {
  const map = new Map<string, { path: string; blob: Blob }>();
  for (const [p, b] of files) {
    const path = p.replace(/\\/g, '/');
    map.set(path.toLowerCase(), { path, blob: b });
  }
  const paths = [...map.values()].map((v) => v.path);
  const get = (p: string) => map.get(p.toLowerCase())?.blob;
  const dir = locateCabDir(paths);
  if (dir !== null) {
    onProgress?.(0, 1, 'Spelbestanden lezen…');
    const cab = await InstallShieldCab.open(get(`${dir}data1.hdr`)!, [get(`${dir}data1.cab`)!, get(`${dir}data2.cab`)!]);
    onProgress?.(1, 1);
    return new FileSet('cd', cabFileRefs(cab), async (name) => {
      const info = movieInfo(name);
      const b = info && (get(`${dir}Movies/${info.file}`) ?? paths.map((x) => (x.toLowerCase().endsWith(`/${info.file.toLowerCase()}`) ? get(x) : undefined)).find(Boolean));
      return b ? blobMedia(b) : null;
    });
  }
  const installed = locateInstalledDir(paths);
  if (installed !== null) {
    // an installed game folder: plain files (the movies are not part of the installation, so there are none)
    const refs: FileRef[] = [];
    for (const v of map.values()) {
      if (v.path.toLowerCase().startsWith(installed.toLowerCase())) {
        refs.push({ path: v.path.slice(installed.length), size: v.blob.size, read: async () => new Uint8Array(await v.blob.arrayBuffer()) });
      }
    }
    return new FileSet('cd', refs, async (name) => {
      const info = movieInfo(name);
      const b = info && paths.map((x) => (x.toLowerCase().endsWith(`/${info.file.toLowerCase()}`) ? get(x) : undefined)).find(Boolean);
      return b ? blobMedia(b) : null;
    });
  }
  throw new Error('Geen LEGO Eiland 2-cd gevonden in deze map (verwacht de cd-map met "LEGO Eiland 2/data1.hdr", of een geïnstalleerde spelmap).');
}

/** Store an ISO the user picked (after checking it is the LEGO Eiland 2 CD). */
export async function addIso(file: Blob, onProgress?: (fraction: number) => void): Promise<void> {
  const iso = await IsoVfs.open(file);
  if (locateCabDir(iso.list()) === null) throw new Error('Deze ISO is niet de cd van LEGO Eiland 2 (data1.hdr, data1.cab en data2.cab ontbreken).');
  const h = await (await opfsDir('isos')).getFileHandle('le2.iso', { create: true });
  const w = await h.createWritable();
  const CHUNK = 8 << 20;
  try {
    for (let o = 0; o < file.size; o += CHUNK) {
      await w.write(await file.slice(o, o + CHUNK).arrayBuffer());
      onProgress?.(Math.min(1, (o + CHUNK) / file.size));
    }
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}

export async function removeIso() {
  await (await opfsDir('isos')).removeEntry('le2.iso').catch(() => {});
}

// ---- dev: public/data/le2 (the extracted Game folder) and public/data/le2-movies, listed by the dev server (vite.config.ts)

interface DevManifest {
  base: string;
  files: { path: string; size: number }[];
  movies: Record<string, number>;
}

async function devManifest(): Promise<DevManifest | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}__le2/manifest.json`).catch(() => null);
  if (!res?.ok || !res.headers.get('content-type')?.includes('json')) return null;
  const m = (await res.json()) as { files: { path: string; size: number }[]; movies: Record<string, number> };
  if (!m.files.length) return null;
  return { base: `${import.meta.env.BASE_URL}data/`, ...m };
}

function devFiles(m: DevManifest): GameFiles {
  const refs: FileRef[] = m.files.map((f) => ({
    path: f.path,
    size: f.size,
    read: async () => {
      const res = await fetch(`${m.base}le2/${f.path.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) throw new Error(`${f.path}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  }));
  return new FileSet('dev', refs, async (name) => {
    const info = movieInfo(name);
    if (info && info.file in m.movies) return fetchMedia(`${m.base}le2-movies/${info.file}`, m.movies[info.file]);
    return info ? archiveMovie(info) : null; // no local movies: stream them from archive.org
  });
}

// ---- archive.org
//
// Two routes, both persisted in this browser so that a second visit needs no network for the game files:
//  1. range route (when a CORS proxy is configured, see `proxyBase`; configured by default): the ISO is read by HTTP Range through the proxy;
//     only the bytes that are needed are fetched (block cache in Cache Storage). A first start needs tens of MB.
//  2. progressive route (default): data1.hdr + data1.cab (0.8 MB) are fetched, then data2.cab (342 MB, whole file, no ranges)
//     starts downloading and `GameFiles` is returned at once; `read()` of a file waits until its bytes have arrived and
//     `ready()` / `loading` tell the shell how far the download is. The download is stored in OPFS while it runs.

/**
 * The CORS range proxy in front of archive.org's ISOs, empty = none. Two styles:
 *  - a template with `{item}` and `{iso}` (the ISO's file name, URL-encoded), e.g. an nginx relay: `https://host/ia/{item}/{iso}`
 *  - a plain URL: tools/proxy/le2-cors-proxy.php, called as `<url>?url=<encoded archive.org ISO URL>`
 * Override with `?proxy=<url or template>` (`?proxy=off` forces the progressive download) or localStorage key `le2-proxy`.
 */
export const PROXY_BASE = 'https://le2.143-47-181-190.sslip.io/ia/{item}/{iso}';

export function proxyUrl(proxy: string, item: { item: string; iso: string }): string {
  if (proxy.includes('{item}')) return proxy.replace('{item}', item.item).replace('{iso}', encodeURIComponent(item.iso));
  const isoUrl = `https://archive.org/download/${item.item}/${encodeURIComponent(item.iso)}`;
  return `${proxy}${proxy.includes('?') ? '&' : '?'}url=${encodeURIComponent(isoUrl)}`;
}

export function proxyBase(): string {
  try {
    const q = new URLSearchParams(location.search).get('proxy');
    if (q !== null) return q === 'off' ? '' : q;
    const l = localStorage.getItem('le2-proxy');
    return l === null ? PROXY_BASE : l === 'off' ? '' : l;
  } catch {
    return PROXY_BASE;
  }
}

/** Files every start needs (EXE, shared archives, front end, the island = first zone of a new game); fetched ahead on the range route. */
const WARM_PATHS = ['LEGO eiland 2.exe', ...['Bricks', 'BrickMorph', 'Fonts', 'GENERICBITS', 'menu', 'messages', 'Overlays', 'SwapText', 'Shadow', 'z60FRE', 'z02LGI']
  .flatMap((n) => [`_data/${n}.bod`, `_data/${n}.bob`])];

const ISO_SIZES: Record<string, number> = { legoeiland2dutch: 450813952, legoeiland2: 448049152 };

async function rangeFiles(proxy: string, onProgress?: Progress): Promise<GameFiles> {
  let lastErr: unknown;
  for (const item of ARCHIVE_ITEMS) {
    try {
      onProgress?.(0, 1, 'Verbinden met archive.org…');
      const url = proxyUrl(proxy, item);
      // Latency per request is high (~2 s through the relay), so overlap what is predictable: while the first byte tells us
      // the size, already fetch the volume descriptors (start) and where the directory records sit (end of the disc).
      let size = ISO_SIZES[item.item] ?? 0;
      let inner = new HttpRangeSource(url, size);
      let cached = new CachedSource(inner, `le2-range-${item.item}`);
      if (size) {
        const guess = cached;
        void guess.prefetch(0, 64 << 10).catch(() => {});
        void guess.prefetch(size - (512 << 10), size).catch(() => {});
      }
      const real = await HttpRangeSource.probe(url);
      if (real !== size) {
        console.warn(`ISO ${item.item}: ${real} bytes, verwacht ${size}`);
        size = real;
        inner = new HttpRangeSource(url, size);
        cached = new CachedSource(inner, `le2-range-${item.item}`);
      }
      const iso = await IsoVfs.open(cached);
      const paths = iso.list();
      const dir = locateCabDir(paths);
      if (dir === null) throw new Error('geen cabinet in de ISO');
      const cab = await InstallShieldCab.open(iso.source(`${dir}data1.hdr`), [iso.source(`${dir}data1.cab`), iso.source(`${dir}data2.cab`)]);
      const movie = async (name: string): Promise<MediaFile | null> => {
        const info = movieInfo(name);
        const e = info && iso.stat(`${dir}Movies/${info.file}`);
        // movies bypass the block cache (streamed once, in 4 MB ranges) and have their own request queue, so they do not
        // wait behind the game data being fetched
        return e ? sourceMedia(sliceSource(new HttpRangeSource(url, size), e.lba * 2048, e.size), 4 << 20) : null;
      };
      const fs = new FileSet('archive', cabFileRefs(cab), movie, cached.loading);
      fs.route = 'range';
      // fetch what every start needs ahead, in parallel (after the header, so that requests on the critical path are not
      // queued behind this): neighbouring files in the cabinet become one request
      void fs.ready(WARM_PATHS).catch((e) => console.warn('voorladen mislukt', e));
      return fs;
    } catch (e) {
      lastErr = e;
      console.warn(`range-route via ${proxy} (${item.item}) mislukt`, e);
    }
  }
  throw lastErr;
}

interface Sink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<Blob>;
  abort(): Promise<void>;
}

async function opfsSink(dir: FileSystemDirectoryHandle, name: string): Promise<Sink> {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  return {
    write: (c) => w.write(c as Uint8Array<ArrayBuffer>),
    close: async () => {
      await w.close();
      return h.getFile();
    },
    abort: () => w.abort().catch(() => {}),
  };
}

function memSink(): Sink {
  const parts: Uint8Array[] = [];
  return {
    write: async (c) => { parts.push(c); },
    close: async () => new Blob(parts as BlobPart[]),
    abort: async () => { parts.length = 0; },
  };
}

interface Archive {
  item: { item: string; iso: string };
  sources: ByteSource[]; // hdr, cab1, cab2
  loading: LoadState | null; // null: complete and local
}

/** The archive of this session (a download in progress, or the stored files), shared by every open(). */
let session: Promise<Archive> | null = null;

async function storedArchive(): Promise<Archive | null> {
  try {
    const dir = await opfsDir('le2-archive');
    const marker = await (await dir.getFileHandle('complete.json')).getFile().then((f) => f.text()).catch(() => null);
    if (!marker) return null;
    const info = JSON.parse(marker) as { item: string };
    const item = ARCHIVE_ITEMS.find((i) => i.item === info.item);
    if (!item) return null;
    const sources: ByteSource[] = [];
    for (const f of CAB_FILES) {
      const file = await (await dir.getFileHandle(f.name)).getFile();
      if (file.size !== f.size) return null;
      sources.push(blobSource(file));
    }
    return { item, sources, loading: null };
  } catch {
    return null;
  }
}

/** True when the game files are already stored in this browser (a start needs no download). */
export async function archiveStored(): Promise<boolean> {
  return !!(await storedArchive());
}

export async function removeArchiveCache() {
  session = null;
  try { await (await opfs()).removeEntry('le2-archive', { recursive: true }); } catch { /* nothing stored */ }
  if ('caches' in globalThis) for (const k of await caches.keys()) if (k.startsWith('le2-range-')) await caches.delete(k);
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function downloadSmall(url: string, expected: number, sink: Sink): Promise<Blob> {
  const res = await fetchOk(url);
  const reader = res.body!.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > expected) throw new Error('groter dan verwacht');
    await sink.write(value);
  }
  if (got !== expected) throw new Error(`onvolledig (${got} van ${expected} bytes)`);
  return sink.close();
}

/**
 * Stream data2.cab into `growing` (and into OPFS). A broken connection restarts the download and skips what we already
 * have (archive.org has no ranges, but the bytes are the same), up to three times.
 */
async function pumpData2(first: ReadableStreamDefaultReader<Uint8Array>, growing: GrowingSource, loading: LoadState, dir: FileSystemDirectoryHandle | null, item: { item: string }) {
  const total = CAB_FILES[2].size;
  let sink: Sink | null = null;
  try { sink = dir ? await opfsSink(dir, CAB_FILES[2].name) : null; } catch (e) { console.warn('OPFS-schrijven mislukt, de download blijft alleen in het geheugen', e); }
  const persist = async (chunk: Uint8Array) => {
    if (!sink) return;
    try { await sink.write(chunk); } catch (e) { console.warn('OPFS-schrijven mislukt', e); void sink.abort(); sink = null; }
  };
  let reader = first;
  let skip = 0;
  let lastErr: unknown = null;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          let chunk = value;
          if (skip > 0) { // restarted download: drop the bytes we have already
            const n = Math.min(skip, chunk.length);
            skip -= n;
            chunk = chunk.subarray(n);
            if (!chunk.length) continue;
          }
          growing.append(chunk);
          await persist(chunk);
        }
        if (growing.received !== total) throw new Error(`onvolledig (${growing.received} van ${total} bytes)`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`download data2.cab onderbroken bij ${growing.received} bytes (poging ${attempt + 1})`, e);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        try {
          reader = (await fetchOk(archiveUrl(ARCHIVE_ITEMS.find((i) => i.item === item.item)!, `${CD_DIR}/${CAB_FILES[2].name}`))).body!.getReader();
          skip = growing.received;
        } catch (e2) { lastErr = e2; }
      }
    }
    if (lastErr) throw lastErr;
    if (sink) {
      const file = await sink.close();
      sink = null;
      growing.finish(file);
      try {
        const h = await dir!.getFileHandle('complete.json', { create: true });
        const w = await h.createWritable();
        await w.write(JSON.stringify({ item: item.item, time: Date.now() }));
        await w.close();
      } catch (e) { console.warn('kon de download niet als compleet markeren', e); }
    }
    loading.update(total, total);
  } catch (e) {
    growing.fail(e);
    loading.fail(e);
    void sink?.abort();
  }
}

async function startProgressive(onProgress?: Progress): Promise<Archive> {
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await opfsDir('le2-archive');
    await dir.removeEntry('complete.json').catch(() => {});
  } catch (e) {
    console.warn('OPFS niet beschikbaar: de bestanden worden alleen voor deze sessie bewaard', e);
  }
  let lastErr: unknown;
  for (const item of ARCHIVE_ITEMS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const small: Blob[] = [];
        let done = 0;
        for (const f of CAB_FILES.slice(0, 2)) {
          const sink = dir ? await opfsSink(dir, f.name).catch(() => memSink()) : memSink();
          try { small.push(await downloadSmall(archiveUrl(item, `${CD_DIR}/${f.name}`), f.size, sink)); } catch (e) { await sink.abort(); throw e; }
          done += f.size;
          onProgress?.(done, CAB_FILES[0].size + CAB_FILES[1].size, f.name);
        }
        // the header must parse before the big download starts
        await InstallShieldCab.open(small[0], [small[1]]);
        const res = await fetchOk(archiveUrl(item, `${CD_DIR}/${CAB_FILES[2].name}`));
        const reader = res.body!.getReader();
        const loading = new LoadState(CAB_TOTAL, done);
        const growing = new GrowingSource(CAB_FILES[2].size, () => loading.update(done + growing.received));
        void pumpData2(reader, growing, loading, dir, item);
        return { item, sources: [blobSource(small[0]), blobSource(small[1]), growing], loading };
      } catch (e) {
        lastErr = e;
        console.warn(`archive.org ${item.item} (poging ${attempt + 1}) mislukt`, e);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Downloaden van archive.org is mislukt: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

async function archiveFiles(onProgress?: Progress): Promise<GameFiles> {
  const proxy = proxyBase();
  if (proxy) {
    try { return await rangeFiles(proxy, onProgress); } catch (e) { console.warn('range-route mislukt, terug naar de gewone download', e); }
  }
  session ??= (async () => (await storedArchive()) ?? startProgressive(onProgress))().catch((e) => { session = null; throw e; });
  const a = await session;
  const cab = await InstallShieldCab.open(a.sources[0], [a.sources[1], a.sources[2]]);
  const fs = new FileSet('archive', cabFileRefs(cab), async (name) => {
    const info = movieInfo(name);
    return info ? archiveMovie(info, a.item) : null;
  }, a.loading);
  fs.route = a.loading ? 'progressive' : 'stored';
  return fs;
}

function archiveMovie(info: { file: string; size: number }, item = ARCHIVE_ITEMS[0]): MediaFile {
  return fetchMedia(archiveUrl(item, `${CD_DIR}/Movies/${info.file}`), info.size);
}
