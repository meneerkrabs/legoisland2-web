// The HD Texture Pack read ON DEMAND from archive.org (the item `lego-island-2-hd-textures`, webfischi's own upload: "HD Texture.zip", 709 MB, deflate, 5032 texture files in
// `HD Texture/_data/<archive>/...`), through the byte-range relay (tools/proxy/nginx/le2-proxy.conf). Instead of downloading the pack and storing 2.2 GB up front (src/mods/hd.ts,
// MEGA), only the archives (zones) the player visits are fetched: the zip's central directory (1.2 MB, one request) once, then per archive the ranges that hold its members
// (src/mods/hdfill.ts, in a worker: neighbours merged into requests of at most 6 MB, inflated, CRC-checked), stored per archive in OPFS `le2-hd/<archive>/` with `done.json` written LAST
// (a cut-off fetch leaves no `done.json` and is removed). An archive that is complete in the cache replaces its members like a mod's `_data/<archive>/...` files (`overrides`, called by
// `ModdedFiles.archiveOverrides`); one that is not complete is fetched in the background (a zone gets a few seconds' grace, `prepare`) and the zone plays with the original textures
// until the next visit. What is decided for an archive stays the same for a zone visit (`newZone` forgets it at the zone change), so a zone never switches textures halfway.
import { RELAY_BASE } from './catalogue.ts';
import { HdRemoteError, isQuota, rangeFetch, readRange, sleep } from './hdnet.ts';
import { HdFiller, lockName } from './hdfill.ts';
import type { FillMsg, FillReq, IndexFile, Manifest } from './hdfill.ts';
import { listZip } from './zip.ts';
import type { ZipEntry, ZipSource } from './zip.ts';

export { HdRemoteError };
export const HD_ITEM = 'lego-island-2-hd-textures';
export const HD_ZIP = 'HD Texture.zip';
const PREFIX = 'HD Texture/';
const DIR = 'le2-hd';
const INDEX = 'index.json';
/** how long a zone that is being entered waits for its textures before it starts with the original ones */
export const GRACE_MS = 4000;
/** archives that are fetched ahead once the game runs: the island (the main play area), then the shared ones for the next visit, then Pepper's house */
export const PRIORITY = ['z02LGI', 'Overlays', 'menu', 'GENERICBITS', 'SwapText', 'Shadow', 'z03PPH'];
/** archives that stay loaded for the whole session (not released at a zone change): their textures can only change at the next page load */
const SHARED = /^(?!z\d\d)/i;
/** the front end (menu) is shown at every start and is not worth a wait: it never holds a zone back, and is fetched after the archives of PRIORITY */
const NO_GRACE = /^z60fre$/i;

export const hdZipUrl = (relay = relayBase()) => `${relay}/ia/${HD_ITEM}/${encodeURIComponent(HD_ZIP)}`;
/** the relay (nginx on krokantekrab); `?relay=<base>` points a test at another one */
export function relayBase(): string {
  try { return new URLSearchParams(globalThis.location?.search ?? '').get('relay') ?? RELAY_BASE; } catch { return RELAY_BASE; }
}

// ------------------------------------------------------------------------------------------------------------------------ the remote zip

/** the first read takes the end of the file: 1.5 MB holds the whole central directory (1.2 MB for this pack), so the index costs ONE request */
const TAIL = 3 << 19;

/** the zip's size (Content-Range of a read of the last bytes) and a ZipSource over it; the end of the file is kept in memory */
export async function openRemoteZip(url = hdZipUrl(), opts: { signal?: AbortSignal; fetchFn?: typeof fetch } = {}): Promise<ZipSource> {
  const res = await rangeFetch(url, 0, -TAIL, opts.signal, opts.fetchFn);
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
  if (!m) throw new HdRemoteError('archive.org gaf de grootte van de HD-textures niet door.');
  const size = Number(m[1]);
  const tail = new Uint8Array(await res.arrayBuffer());
  const tailStart = size - tail.length;
  return { size, read: async (s, e) => (s >= tailStart ? tail.subarray(s - tailStart, e - tailStart) : readRange(url, s, e, opts.signal, opts.fetchFn)) };
}

// ------------------------------------------------------------------------------------------------------------------------ the index

interface IndexJson { v: 1; size: number; files: IndexFile[] }
/** the members of the pack: `_data/<archive>/<member>` paths (no folders, no `__MACOSX`, no `.DS_Store`) */
function buildIndex(entries: ZipEntry[]): IndexFile[] {
  const out: IndexFile[] = [];
  for (const e of entries) {
    if (e.dir || !e.name.startsWith(PREFIX + '_data/')) continue;
    const p = e.name.slice(PREFIX.length);
    if (p.split('/').length < 3 || /(^|\/)\.DS_Store$/.test(p)) continue;
    out.push({ p, s: e.size, c: e.csize, o: e.offset, m: e.method, r: e.crc, f: e.flags });
  }
  return out;
}
const archiveOf = (p: string) => p.split('/')[1];

// ------------------------------------------------------------------------------------------------------------------------ OPFS helpers (main thread: index, manifests, reading)

async function root(create: boolean): Promise<FileSystemDirectoryHandle> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav?.storage?.getDirectory) throw new HdRemoteError('Deze browser kan de HD-textures niet bewaren (geen bestandsopslag beschikbaar).');
  return (await nav.storage.getDirectory()).getDirectoryHandle(DIR, { create });
}
async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()) as T; } catch { return null; }
}
async function writeJson(dir: FileSystemDirectoryHandle, name: string, v: unknown) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(JSON.stringify(v));
  await w.close();
}
async function heldLocks(): Promise<Set<string>> {
  try { return new Set(((await (globalThis as { navigator?: Navigator }).navigator?.locks?.query?.())?.held ?? []).map((l) => l.name ?? '')); } catch { return new Set(); }
}

export interface LazyProgress { /** archives being fetched right now */ active: string[]; /** compressed bytes of the running fetches that are in */ done: number; total: number }

/** the fetching side: a dedicated worker (the game's thread stays free), or the same code in this thread when no worker can be made */
interface Fetcher { fill(req: FillReq): void; urgent(k: string, on: boolean): void; cancel(k?: string): void }
function makeFetcher(onMsg: (m: FillMsg) => void, fetchFn?: typeof fetch): Fetcher {
  if (!fetchFn && typeof Worker !== 'undefined') {
    try {
      const w = new Worker(new URL('./hdworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<FillMsg>) => onMsg(e.data);
      w.onerror = (e) => { e.preventDefault(); console.warn('hd: de HD-werker faalde', e.message); };
      return { fill: (req) => w.postMessage({ t: 'fill', req }), urgent: (k, on) => w.postMessage({ t: 'urgent', k, on }), cancel: (k) => w.postMessage({ t: 'cancel', k }) };
    } catch (e) { console.info('hd: geen werker, ophalen in dit venster', e); }
  }
  const f = new HdFiller(onMsg, fetchFn);
  return { fill: (req) => { void f.fill(req); }, urgent: (k, on) => f.setUrgent(k, on), cancel: (k) => f.cancel(k) };
}

export class HdLazy {
  /** members per archive (lower-case key), sorted by offset */
  private byArchive = new Map<string, { name: string; files: IndexFile[] }>();
  /** archives complete in the cache, with their manifest */
  private complete = new Map<string, Manifest>();
  private inflight = new Map<string, { promise: Promise<void>; res: () => void; rej: (e: unknown) => void }>();
  private decided = new Map<string, boolean>();
  private listeners = new Set<(p: LazyProgress) => void>();
  private prog = new Map<string, { done: number; total: number }>();
  private url: string;
  private size: number;
  private fetcher: Fetcher | null = null;
  /** set when a fetch failed for good (quota, relay gone): nothing more is fetched this session */
  failed: HdRemoteError | null = null;
  fetchFn: typeof fetch | undefined;

  private constructor(url: string, index: IndexJson) {
    this.url = url;
    this.size = index.size;
    const by = new Map<string, { name: string; files: IndexFile[] }>();
    for (const f of index.files) { const a = archiveOf(f.p), k = a.toLowerCase(); (by.get(k) ?? (by.set(k, { name: a, files: [] }), by.get(k)!)).files.push(f); }
    for (const v of by.values()) v.files.sort((a, b) => a.o - b.o);
    this.byArchive = by;
  }

  /** open from what is in the cache (no network); null when the pack was never fetched here */
  static async openCached(url = hdZipUrl()): Promise<HdLazy | null> {
    try {
      const dir = await root(false);
      const idx = await readJson<IndexJson>(dir, INDEX);
      if (!idx || idx.v !== 1) return null;
      const lazy = new HdLazy(url, idx);
      await lazy.scan(dir);
      return lazy;
    } catch { return null; }
  }
  /** open for a first fetch: reads the zip's central directory from the relay (one request) and keeps the index in the cache */
  static async openRemote(url = hdZipUrl(), opts: { signal?: AbortSignal; fetchFn?: typeof fetch } = {}): Promise<HdLazy> {
    const cached = await HdLazy.openCached(url);
    if (cached) { cached.fetchFn = opts.fetchFn; return cached; }
    const remote = await openRemoteZip(url, opts);
    const entries = await listZip(remote);
    const idx: IndexJson = { v: 1, size: remote.size, files: buildIndex(entries) };
    if (!idx.files.length) throw new HdRemoteError('De HD-textures op archive.org hebben een onverwachte indeling.');
    try { await writeJson(await root(true), INDEX, idx); } catch (e) { const err = new HdRemoteError('De HD-textures kunnen niet in je browser worden bewaard.'); err.quota = isQuota(e); throw err; }
    const lazy = new HdLazy(url, idx);
    lazy.fetchFn = opts.fetchFn;
    return lazy;
  }

  private async scan(dir: FileSystemDirectoryHandle) {
    const held = await heldLocks();
    for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (h.kind !== 'directory') continue;
      const mf = await readJson<Manifest>(h as FileSystemDirectoryHandle, 'done.json');
      if (mf && mf.v === 2) this.complete.set(name.toLowerCase(), mf);
      else if (!held.has(lockName(name.toLowerCase()))) await dir.removeEntry(name, { recursive: true }).catch(() => { /* gone */ });   // a cut-off fetch of an earlier visit (no done.json), unless another tab is fetching it now
    }
  }

  // ---- what is where
  has(archive: string) { return this.byArchive.has(archive.toLowerCase()); }
  isComplete(archive: string) { return this.complete.has(archive.toLowerCase()); }
  archives(): string[] { return [...this.byArchive.values()].map((v) => v.name); }
  /** compressed bytes of an archive's members (what a fetch downloads) */
  downloadSize(archive: string) { return (this.byArchive.get(archive.toLowerCase())?.files ?? []).reduce((n, f) => n + f.c, 0); }
  stats() {
    let bytes = 0, n = 0;
    for (const m of this.complete.values()) { n++; for (const f of m.files) bytes += f.size; }
    return { completeArchives: n, totalArchives: this.byArchive.size, storedBytes: bytes };
  }

  // ---- what the game asks for
  /** `ArchiveOverride`s for `archive` as `GameData` wants them; empty unless this zone visit decided for the pack (`prepare`) and the archive is complete */
  overrides(archive: string) {
    const k = archive.toLowerCase(), mf = this.complete.get(k);
    if (!mf || this.decided.get(k) !== true) return [];
    return mf.files.map((f) => ({
      path: f.path.split('/').slice(2).join('/'), size: f.size,
      load: () => this.readFile(k, f.key, f.off, f.size),
    }));
  }
  /** called before a zone archive's overrides are applied: starts the fetch when the archive is not cached yet and waits `grace` ms for it */
  async prepare(archive: string, grace = SHARED.test(archive) || NO_GRACE.test(archive) ? 0 : GRACE_MS): Promise<void> {
    const k = archive.toLowerCase();
    if (this.decided.has(k)) return;
    if (!this.byArchive.has(k)) { this.decided.set(k, false); return; }
    if (!this.complete.has(k) && !this.failed) {
      const fetching = this.ensure(archive).catch(() => { /* reported through `failed` */ });
      if (grace > 0) {
        this.fetcher?.urgent(k, true);   // while a zone waits for its textures its requests go before the background ones
        await Promise.race([fetching, sleep(grace)]);
        this.fetcher?.urgent(k, false);
      }
    }
    this.decided.set(k, this.complete.has(k));
  }
  /** a zone ended: the zone archives decide again at their next visit; the shared ones keep what they have */
  newZone() {
    for (const k of [...this.decided.keys()]) if (!SHARED.test(this.byArchive.get(k)?.name ?? k)) this.decided.delete(k);
    for (const id of [...this.packs.keys()]) if (!SHARED.test(this.byArchive.get(id.split('/')[0])?.name ?? id)) this.packs.delete(id);
  }

  /** a pack file is read whole, once (a zone's textures are applied member after member: one read per member would cost a hop of the busy main thread each); members are views of it */
  private packs = new Map<string, Promise<Uint8Array>>();
  async readFile(k: string, pack: string, off: number, size: number): Promise<Uint8Array> {
    const id = `${k}/${pack}`;
    let f = this.packs.get(id);
    if (!f) { f = (async () => {
        const file = await (await (await root(false)).getDirectoryHandle(this.byArchive.get(k)?.name ?? k)).getFileHandle(pack).then((h) => h.getFile());
        return new Uint8Array(await file.arrayBuffer());
      })(); this.packs.set(id, f); }
    try { return (await f).subarray(off, off + size); } catch (e) { this.packs.delete(id); throw e; }
  }

  // ---- fetching
  subscribe(fn: (p: LazyProgress) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() {
    let done = 0, total = 0;
    for (const p of this.prog.values()) { done += p.done; total += p.total; }
    const p: LazyProgress = { active: [...this.prog.keys()], done, total };
    for (const l of [...this.listeners]) l(p);
  }

  private onMsg(m: FillMsg) {
    const job = this.inflight.get(m.k);
    if (m.t === 'progress') { this.prog.set(m.k, { done: m.done, total: m.total }); this.emit(); return; }
    this.prog.delete(m.k);
    this.inflight.delete(m.k);
    if (m.t === 'done') {
      if (m.manifest) this.complete.set(m.k, m.manifest);
      job?.res();
    } else {
      const err = new HdRemoteError(m.message);
      err.quota = m.quota;
      if (!m.aborted) this.failed = err;
      job?.rej(err);
    }
    this.emit();
  }

  /** fetch an archive into the cache (once; concurrent callers share it) */
  ensure(archive: string): Promise<void> {
    const k = archive.toLowerCase();
    if (this.complete.has(k)) return Promise.resolve();
    if (this.failed) return Promise.reject(this.failed);
    const have = this.inflight.get(k);
    if (have) return have.promise;
    const info = this.byArchive.get(k);
    if (!info) return Promise.reject(new HdRemoteError(`${k} zit niet in de HD-textures.`));
    let res!: () => void, rej!: (e: unknown) => void;
    const promise = new Promise<void>((a, b) => { res = a; rej = b; });
    promise.catch(() => { /* callers handle it */ });
    this.inflight.set(k, { promise, res, rej });
    this.prog.set(k, { done: 0, total: info.files.reduce((n, f) => n + f.c, 0) });
    this.emit();
    this.fetcher ??= makeFetcher((m) => this.onMsg(m), this.fetchFn);
    this.fetcher.fill({ k, name: info.name, url: this.url, size: this.size, files: info.files, priority: PRIORITY.map((a) => a.toLowerCase()) });
    return promise;
  }

  /** stop everything that is being fetched (the half-written archives are removed by their own fetch) */
  cancel() { this.fetcher?.cancel(); }

  /** delete the whole cache (about 2 GB when everything was visited) */
  static async removeAll() {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    try { await (await nav?.storage?.getDirectory())?.removeEntry(DIR, { recursive: true }); } catch { /* none */ }
  }
}
