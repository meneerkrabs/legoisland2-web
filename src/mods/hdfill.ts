// Fetching one archive of the HD pack into OPFS (`le2-hd/<archive>/`): the ranges that hold its members (neighbours merged, at most 6 MB per request), inflated and CRC-checked
// (zip.ts `entryStream`), written one after the other into `p<n>.bin` pack files, `done.json` LAST. Runs in a dedicated worker (hdworker.ts) so that neither the network handling nor the
// inflating touches the game's main thread (a busy main thread made every stream hop cost a frame); `HdFiller` is plain code and can also run on the main thread as a fallback.
// At most 4 range requests are in flight at once, in the order of a rank (a zone that waits for its textures, then the archives of PRIORITY, then the rest).
import { HdRemoteError, aborted, isQuota, readRange } from './hdnet.ts';
import { entryStream } from './zip.ts';
import type { ZipEntry, ZipSource } from './zip.ts';

export interface IndexFile { p: string; s: number; c: number; o: number; m: number; r: number; f: number }
/** the inflated members of an archive: `key` is the pack file, `off` the offset in it */
export interface Manifest { v: 2; files: { path: string; size: number; key: string; off: number }[] }
export interface FillReq { k: string; name: string; url: string; size: number; files: IndexFile[]; /** lower-case archive names in order of importance */ priority: string[] }
export type FillMsg =
  | { t: 'progress'; k: string; done: number; total: number }
  | { t: 'done'; k: string; manifest: Manifest | null; /** another tab was fetching this archive */ busy?: boolean }
  | { t: 'error'; k: string; message: string; quota: boolean; aborted: boolean };

const DIR = 'le2-hd';
export const lockName = (k: string) => `le2-hd-fill-${k}`;
const MERGE_GAP = 512 << 10, MERGE_MAX = 6 << 20, SLOTS = 4, WORKERS_PER_ARCHIVE = 4;

const toEntry = (f: IndexFile): ZipEntry => ({ name: 'HD Texture/' + f.p, size: f.s, csize: f.c, dir: false, method: f.m, crc: f.r, flags: f.f, offset: f.o });

/** write `chunks` at the end of an OPFS file: a synchronous access handle in a worker (every browser), a writable stream otherwise */
async function openSink(fh: FileSystemFileHandle): Promise<{ write(c: Uint8Array): Promise<void> | void; close(): Promise<void> | void; abort(): Promise<void> | void }> {
  const sync = (fh as unknown as { createSyncAccessHandle?: () => Promise<{ write(b: Uint8Array, o: { at: number }): number; flush(): void; close(): void; truncate(n: number): void }> }).createSyncAccessHandle;
  if (sync && typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
    const h = await sync.call(fh);
    let at = 0;
    return {
      write(c) { const n = h.write(c, { at }); if (n !== c.length) throw new HdRemoteError('De opslag van je browser is vol: de HD-textures passen er niet meer in.'); at += n; },
      close() { h.flush(); h.close(); },
      abort() { try { h.close(); } catch { /* closed */ } },
    };
  }
  const w = await fh.createWritable();
  return { write: (c) => w.write(c as unknown as BufferSource), close: () => w.close(), abort: () => w.abort().catch(() => { /* closed */ }) };
}

export class HdFiller {
  private slots = SLOTS;
  private queue: { k: string; priority: string[]; go: () => void }[] = [];
  private urgent = new Set<string>();
  private aborts = new Map<string, AbortController>();
  private post: (m: FillMsg) => void;
  private fetchFn: typeof fetch | undefined;
  constructor(post: (m: FillMsg) => void, fetchFn?: typeof fetch) { this.post = post; this.fetchFn = fetchFn; }

  setUrgent(k: string, on: boolean) { if (on) this.urgent.add(k); else this.urgent.delete(k); }
  cancel(k?: string) { for (const [key, a] of this.aborts) if (!k || key === k) a.abort(); }

  private rank(k: string, priority: string[]) { if (this.urgent.has(k)) return 0; const i = priority.indexOf(k); return i >= 0 ? 1 + i : 100; }
  private acquire(k: string, priority: string[]): Promise<() => void> {
    const release = () => {
      this.slots++;
      if (!this.queue.length) return;
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.rank(this.queue[i].k, this.queue[i].priority) < this.rank(this.queue[best].k, this.queue[best].priority)) best = i;
      const [next] = this.queue.splice(best, 1);
      this.slots--;
      next.go();
    };
    if (this.slots > 0) { this.slots--; return Promise.resolve(release); }
    return new Promise((res) => this.queue.push({ k, priority, go: () => res(release) }));
  }

  /** fetch one archive; posts progress and, at the end, `done` or `error` (never throws) */
  async fill(req: FillReq): Promise<void> {
    const { k } = req;
    if (this.aborts.has(k)) return;
    const locks = (globalThis as { navigator?: Navigator }).navigator?.locks;
    try {
      if (!locks) { await this.fillLocked(req); return; }
      let got = false;
      await locks.request(lockName(k), { ifAvailable: true }, async (lock) => { if (lock) { got = true; await this.fillLocked(req); } });
      if (!got) this.post({ t: 'done', k, manifest: null, busy: true });   // another tab is fetching it: not complete here, the zone starts without
    } catch { /* fillLocked reported it */ }
  }

  private async fillLocked(req: FillReq): Promise<void> {
    const { k, name, url, size, files, priority } = req;
    const abort = new AbortController();
    this.aborts.set(k, abort);
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    let top: FileSystemDirectoryHandle | null = null;
    try {
      top = await (await nav!.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
      await top.removeEntry(name, { recursive: true }).catch(() => { /* none */ });
      const dir = await top.getDirectoryHandle(name, { create: true });
      const total = files.reduce((n, f) => n + f.c, 0);
      let done = 0, lastPost = 0;
      const progress = (force = false) => { const t = Date.now(); if (force || t - lastPost > 200) { lastPost = t; this.post({ t: 'progress', k, done, total }); } };
      progress(true);
      const entries = files.map(toEntry);
      const groups: { from: number; to: number; items: number[] }[] = [];
      files.forEach((f, i) => {
        const g = groups[groups.length - 1], end = f.o + 30 + f.c + 1024;
        if (g && f.o - g.to <= MERGE_GAP && end - g.from <= MERGE_MAX) { g.to = Math.max(g.to, end); g.items.push(i); } else groups.push({ from: f.o, to: end, items: [i] });
      });
      let next = 0;
      const placed: Manifest['files'] = new Array(files.length);
      const worker = async () => {
        for (;;) {
          const gi = next++;
          if (gi >= groups.length || abort.signal.aborted) return;
          const g = groups[gi], to = Math.min(size, g.to);
          const free = await this.acquire(k, priority);
          let buf: Uint8Array;
          try { buf = await readRange(url, g.from, to, abort.signal, this.fetchFn); } finally { free(); }
          const win: ZipSource = { size, async read(s, e) { if (s < g.from || e > to) throw new HdRemoteError('Leesfout in de HD-textures.'); return buf.subarray(s - g.from, e - g.from); } };
          const key = `p${gi}.bin`;
          const sink = await openSink(await dir.getFileHandle(key, { create: true }));
          try {
            let at = 0;
            for (const i of g.items) {
              if (abort.signal.aborted) throw aborted();
              const start = at;
              const r = (await entryStream(win, entries[i])).getReader();
              for (;;) { const { done: end, value } = await r.read(); if (end) break; await sink.write(value); at += value.length; }
              placed[i] = { path: files[i].p, size: files[i].s, key, off: start };
              done += files[i].c;
              progress();
            }
            await sink.close();
          } catch (e) { await sink.abort(); throw e; }
        }
      };
      await Promise.all(Array.from({ length: WORKERS_PER_ARCHIVE }, worker));
      if (abort.signal.aborted) throw aborted();
      const manifest: Manifest = { v: 2, files: placed };
      const doneSink = await openSink(await dir.getFileHandle('done.json', { create: true }));
      await doneSink.write(new TextEncoder().encode(JSON.stringify(manifest)));
      await doneSink.close();
      progress(true);
      this.post({ t: 'done', k, manifest });
    } catch (e) {
      abort.abort();
      await top?.removeEntry(name, { recursive: true }).catch(() => { /* ignore */ });
      const err = e instanceof HdRemoteError ? e : null;
      const quota = isQuota(e) || !!err?.quota || /vol: de HD-textures/.test(err?.message ?? '');
      this.post({ t: 'error', k, aborted: !!err?.aborted, quota, message: quota ? 'De opslag van je browser is vol: de HD-textures passen er niet meer in.' : err ? err.message : `De HD-textures konden niet worden opgehaald (${e instanceof Error ? e.message : e}).` });
    } finally {
      this.aborts.delete(k);
    }
  }
}
