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
import {
  blobMedia, CAB_FILES, CAB_TOTAL, cabFileRefs, fetchMedia, FileSet, locateCabDir, locateInstalledDir, movieInfo,
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
  return { source: 'archive', cached, open: (p) => archiveFiles(p) };
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

// ---- archive.org: data1.hdr + data1.cab + data2.cab once, kept in OPFS

interface StoredArchive {
  item: { item: string; iso: string };
  blobs: Blob[]; // hdr, cab1, cab2
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

/** In-memory fallback when OPFS is unavailable (private browsing): the files stay for this session only. */
let sessionArchive: StoredArchive | null = null;

async function storedArchive(): Promise<StoredArchive | null> {
  if (sessionArchive) return sessionArchive;
  try {
    const dir = await opfsDir('le2-archive');
    const marker = await (await dir.getFileHandle('complete.json')).getFile().then((f) => f.text()).catch(() => null);
    if (!marker) return null;
    const info = JSON.parse(marker) as { item: string };
    const item = ARCHIVE_ITEMS.find((i) => i.item === info.item);
    if (!item) return null;
    const blobs: Blob[] = [];
    for (const f of CAB_FILES) {
      const file = await (await dir.getFileHandle(f.name)).getFile();
      if (file.size !== f.size) return null;
      blobs.push(file);
    }
    return { item, blobs };
  } catch {
    return null;
  }
}

export async function removeArchiveCache() {
  sessionArchive = null;
  try {
    await (await opfs()).removeEntry('le2-archive', { recursive: true });
  } catch { /* nothing stored */ }
}

async function downloadOne(url: string, expected: number, sink: Sink, report: (bytes: number) => void): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  let got = 0;
  let batch: Uint8Array[] = [];
  let batchLen = 0;
  const flush = async () => {
    if (!batchLen) return;
    const out = new Uint8Array(batchLen);
    let o = 0;
    for (const b of batch) { out.set(b, o); o += b.length; }
    batch = [];
    batchLen = 0;
    await sink.write(out);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (got > expected) throw new Error('groter dan verwacht');
    batch.push(value);
    batchLen += value.length;
    report(value.length);
    if (batchLen >= 4 << 20) await flush();
  }
  if (got !== expected) throw new Error(`onvolledig (${got} van ${expected} bytes)`);
  await flush();
  return sink.close();
}

async function archiveFiles(onProgress?: Progress): Promise<GameFiles> {
  let stored = await storedArchive();
  if (!stored) {
    stored = await downloadArchive(onProgress);
  }
  const cab = await InstallShieldCab.open(stored.blobs[0], [stored.blobs[1], stored.blobs[2]]);
  const item = stored.item;
  return new FileSet('archive', cabFileRefs(cab), async (name) => {
    const info = movieInfo(name);
    return info ? archiveMovie(info, item) : null;
  });
}

function archiveMovie(info: { file: string; size: number }, item = ARCHIVE_ITEMS[0]): MediaFile {
  return fetchMedia(archiveUrl(item, `${CD_DIR}/Movies/${info.file}`), info.size);
}

async function downloadArchive(onProgress?: Progress): Promise<StoredArchive> {
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await opfsDir('le2-archive');
    await dir.removeEntry('complete.json').catch(() => {});
  } catch (e) {
    console.warn('OPFS niet beschikbaar: de bestanden worden alleen voor deze sessie bewaard', e);
  }
  let lastErr: unknown;
  // no byte ranges on archive.org: a broken download can only start over (twice per item, then the other item)
  for (const item of ARCHIVE_ITEMS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let done = 0;
        const blobs: Blob[] = [];
        for (const f of CAB_FILES) {
          const sink = dir ? await opfsSink(dir, f.name).catch(() => memSink()) : memSink();
          try {
            blobs.push(await downloadOne(archiveUrl(item, `${CD_DIR}/${f.name}`), f.size, sink, (n) => {
              done += n;
              onProgress?.(done, CAB_TOTAL, f.name);
            }));
          } catch (e) {
            await sink.abort();
            throw e;
          }
        }
        // the header must parse before we declare success
        await InstallShieldCab.open(blobs[0], [blobs[1], blobs[2]]);
        const stored = { item, blobs };
        if (dir) {
          try {
            const h = await dir.getFileHandle('complete.json', { create: true });
            const w = await h.createWritable();
            await w.write(JSON.stringify({ item: item.item, time: Date.now() }));
            await w.close();
          } catch (e) {
            console.warn('kon de download niet als compleet markeren', e);
          }
        }
        // without OPFS (or when a file could only be kept in memory) the blobs live for this session only
        if (!dir || blobs.some((b) => !(b instanceof File))) sessionArchive = stored;
        return stored;
      } catch (e) {
        lastErr = e;
        console.warn(`archive.org ${item.item} (poging ${attempt + 1}) mislukt`, e);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Downloaden van archive.org is mislukt: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
