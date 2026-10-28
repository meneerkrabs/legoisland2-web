// The game's files, wherever they come from. Whatever the source, the API is the same: paths in the *installed* layout
// (what the original installer put in the game folder: `_data/z02LGI.bob`, `LEGO eiland 2.exe`, ...), looked up
// case-insensitively (the EXE asks for `_data\Bricks.bob`, `_Data\sounds\...`), plus the four movies from the CD.

import type { CabEntry, InstallShieldCab } from './engine/installshield.ts';
import { LoadState, pool, type ByteSource } from './engine/bytesource.ts';

export interface MediaFile {
  size: number;
  /** The bytes as they arrive (movies are played while they stream in). */
  stream(): ReadableStream<Uint8Array>;
}

export type SourceKind = 'iso' | 'cd' | 'dev' | 'archive';

/** Progress while data is read/downloaded (bytes); `label` names the file. */
export type Progress = (done: number, total: number, label?: string) => void;

export interface GameFiles {
  readonly source: SourceKind;
  /** Where the bytes come from: 'range' (HTTP ranges via the proxy), 'progressive' (archive.org download in progress), 'stored' (OPFS), ... */
  readonly route?: string;
  /** Installed-layout paths with forward slashes and their original case (`_data/sounds/z02LGI/x.wav`). */
  list(): string[];
  has(path: string): boolean;
  /** Size in bytes, -1 when the file does not exist. */
  size(path: string): number;
  /** Read a whole file; throws when it does not exist. `path` may use `\` or `/` and any case. */
  read(path: string): Promise<Uint8Array>;
  /** Sum of all file sizes. */
  totalSize(): number;
  /**
   * True when `read(path)` will not have to wait: the file's bytes are local. On the first visit from archive.org the data
   * arrives as one sequential download, so files late in the cabinet are not there yet (see `ready`).
   */
  loaded(path: string): boolean;
  /**
   * Resolves when all `paths` are loaded. Over the progressive archive.org download this waits for the download to reach
   * them; over the range route it fetches exactly those files; everywhere else it resolves at once. Unknown paths are
   * ignored. Use it before starting a zone and show a loading card while it is pending (`loading` has the progress).
   */
  ready(paths: Iterable<string>): Promise<void>;
  /**
   * Loading state of the game data, or null when everything is local: `done`/`total` bytes, `fraction`, `complete`,
   * `error`, and `subscribe(fn)` (returns the unsubscribe function) to follow it.
   */
  readonly loading: LoadState | null;
  /** One of the movies on the CD (`SdLogo`, `LegoSoftware`, `IntroFmv`, `outroFmv`; any case, `.mpg` optional), or null. */
  movie(name: string): Promise<MediaFile | null>;
}

/** The movies in `LEGO Eiland 2/Movies/` on the CD (names as on the disc: archive.org is case-sensitive). */
export const MOVIES: Record<string, { file: string; size: number }> = {
  sdlogo: { file: 'SdLogo.mpg', size: 6021124 },
  legosoftware: { file: 'LegoSoftware.mpg', size: 6502404 },
  introfmv: { file: 'IntroFmv.mpg', size: 21997572 },
  outrofmv: { file: 'outroFmv.mpg', size: 23234564 },
};

/** The intro sequence of the original game, in order. */
export const INTRO_MOVIES = ['SdLogo', 'LegoSoftware', 'IntroFmv'];

export function movieInfo(name: string) {
  return MOVIES[name.replace(/\.mpg$/i, '').toLowerCase()] ?? null;
}

/** The three cabinet files that hold the game (names and sizes are identical on both Dutch ISOs on archive.org). */
export const CAB_FILES = [
  { name: 'data1.hdr', size: 316414 },
  { name: 'data1.cab', size: 444906 },
  { name: 'data2.cab', size: 341851148 },
];
export const CAB_TOTAL = CAB_FILES.reduce((n, f) => n + f.size, 0);

/** The install group of the cabinet that holds the game folder. */
export const GAME_GROUP = 'Game';

export const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\/+/, '').toLowerCase();

export const blobMedia = (blob: Blob): MediaFile => ({ size: blob.size, stream: () => blob.stream() as ReadableStream<Uint8Array> });

/** A `fetch` as a lazily started stream (the request begins at the first read). */
export function fetchMedia(url: string, size: number): MediaFile {
  return {
    size,
    stream: () => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      return new ReadableStream<Uint8Array>({
        async pull(ctl) {
          if (!reader) {
            const res = await fetch(url);
            if (!res.ok || !res.body) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
            reader = res.body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) ctl.close();
          else ctl.enqueue(value);
        },
        cancel() {
          void reader?.cancel();
        },
      });
    },
  };
}

export interface FileRef {
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
  /** Default: always local. */
  loaded?(): boolean;
  ready?(): Promise<void>;
  /** Where the bytes are in a byte source (neighbouring files are fetched with one request in `GameFiles.ready`). */
  extent?: { src: ByteSource; start: number; end: number };
}

/** A movie from a byte source (ISO / HTTP range): streamed in `chunk`-sized reads. */
export function sourceMedia(src: ByteSource, chunk = 2 << 20): MediaFile {
  return {
    size: src.size,
    stream: () => {
      let pos = 0;
      let next: Promise<Uint8Array> | null = null;
      const fetchAt = (o: number) => src.read(o, Math.min(src.size, o + chunk));
      return new ReadableStream<Uint8Array>({
        async pull(ctl) {
          if (pos >= src.size) return ctl.close();
          const cur = next ?? fetchAt(pos);
          next = pos + chunk < src.size ? fetchAt(pos + chunk) : null; // read ahead: one chunk in flight while this one plays
          next?.catch(() => {});
          const b = await cur;
          pos += b.length;
          ctl.enqueue(b);
        },
      });
    },
  };
}

/** A set of files with case-insensitive lookup (every source builds one of these). */
export class FileSet implements GameFiles {
  readonly source: SourceKind;
  private files = new Map<string, FileRef>();
  private total = 0;
  private movieFn: (name: string) => Promise<MediaFile | null>;
  readonly loading: LoadState | null;
  route?: string;

  constructor(source: SourceKind, files: FileRef[], movie: (name: string) => Promise<MediaFile | null>, loading: LoadState | null = null) {
    this.source = source;
    this.loading = loading;
    this.movieFn = movie;
    for (const f of files) {
      this.files.set(normalizePath(f.path), f);
      this.total += f.size;
    }
  }

  list() { return [...this.files.values()].map((f) => f.path); }
  has(path: string) { return this.files.has(normalizePath(path)); }
  size(path: string) { return this.files.get(normalizePath(path))?.size ?? -1; }
  totalSize() { return this.total; }
  loaded(path: string) {
    const f = this.files.get(normalizePath(path));
    return !f || (f.loaded?.() ?? true);
  }
  async ready(paths: Iterable<string>) {
    const todo = [...paths].map((p) => this.files.get(normalizePath(p))).filter((f): f is FileRef => !!f && !(f.loaded?.() ?? true));
    // files with an extent in the same source: merge neighbours (gap up to 512 KB) into one prefetch
    const withExt = todo.filter((f) => f.extent).sort((a, b) => (a.extent!.src === b.extent!.src ? a.extent!.start - b.extent!.start : 0));
    const jobs: (() => Promise<void>)[] = todo.filter((f) => !f.extent).map((f) => () => f.ready?.() ?? Promise.resolve());
    let cur: { src: ByteSource; start: number; end: number } | null = null;
    const flush = () => { if (cur) { const c = cur; jobs.push(() => c.src.prefetch?.(c.start, c.end) ?? Promise.resolve()); } cur = null; };
    for (const f of withExt) {
      const x = f.extent!;
      if (cur && cur.src === x.src && x.start - cur.end <= (512 << 10)) cur.end = Math.max(cur.end, x.end);
      else { flush(); cur = { ...x }; }
    }
    flush();
    await pool(jobs, 8, (j) => j());
  }
  read(path: string) {
    const f = this.files.get(normalizePath(path));
    if (!f) return Promise.reject(new Error(`Bestand niet gevonden: ${path}`));
    const trace = (globalThis as { __le2Trace?: { path: string; at: number; ms: number; size: number; waited: boolean }[] }).__le2Trace;
    if (!trace) return f.read();
    const at = performance.now();
    const waited = !(f.loaded?.() ?? true);
    const pending = ((trace as unknown as { pending?: Map<string, number> }).pending ??= new Map());
    pending.set(f.path, Math.round(at));
    return f.read().then((b) => { pending.delete(f.path); trace.push({ path: f.path, at: Math.round(at), ms: Math.round(performance.now() - at), size: f.size, waited }); return b; });
  }
  movie(name: string) {
    return this.movieFn(name);
  }
}

/** The files of the cabinet's Game group in their installed layout. */
export function cabFileRefs(cab: InstallShieldCab): FileRef[] {
  return cab.files(GAME_GROUP).map((e: CabEntry) => ({
    path: e.path,
    size: e.size,
    read: () => cab.read(e),
    loaded: () => cab.loaded(e),
    ready: () => cab.ready(e),
    extent: (() => { const x = cab.extent(e); return x ? { src: cab.volumeSource(x.volume), start: x.start, end: x.end } : undefined; })(),
  }));
}

/** The files of a CD / ISO listing: find the folder with data1.hdr + data1.cab + data2.cab. Returns its prefix, or null. */
export function locateCabDir(paths: Iterable<string>): string | null {
  const lower = new Map<string, string>();
  for (const p of paths) lower.set(p.replace(/\\/g, '/').toLowerCase(), p.replace(/\\/g, '/'));
  for (const [lp, p] of lower) {
    if (lp !== 'data1.hdr' && !lp.endsWith('/data1.hdr')) continue;
    const dir = p.slice(0, p.length - 'data1.hdr'.length); // "" or "LEGO Eiland 2/"
    const d = dir.toLowerCase();
    if (lower.has(d + 'data1.cab') && lower.has(d + 'data2.cab')) return dir;
  }
  return null;
}

/** Whether a listing is an installed game folder (`LEGO eiland 2.exe` next to `_data/`): returns the folder prefix. */
export function locateInstalledDir(paths: Iterable<string>): string | null {
  let exe: string | null = null;
  const dataDirs = new Set<string>();
  for (const raw of paths) {
    const p = raw.replace(/\\/g, '/');
    const lp = p.toLowerCase();
    if (lp === 'lego eiland 2.exe' || lp.endsWith('/lego eiland 2.exe')) exe = p.slice(0, p.length - 'lego eiland 2.exe'.length);
    const i = lp.indexOf('_data/');
    if (i === 0 || (i > 0 && lp[i - 1] === '/')) dataDirs.add(lp.slice(0, i));
  }
  return exe !== null && dataDirs.has(exe.toLowerCase()) ? exe : null;
}
