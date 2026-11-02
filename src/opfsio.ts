// Writing OPFS files in every browser. `FileSystemFileHandle.createWritable()` (the stream the code was written against) exists in Chromium, Firefox and Safari 26+; older Safari has only
// `createSyncAccessHandle()`, and that one works in a worker only. `openWritable` uses createWritable when it is there (Chromium: exactly the old behaviour) and otherwise writes through a
// small helper worker that holds a synchronous access handle (a Blob URL worker: no extra build step). Same shape as the writable stream: write / close / abort.
export interface FileSink {
  write(chunk: Uint8Array | ArrayBuffer | string): Promise<void>;
  close(): Promise<void>;
  /** drops what was written (createWritable: nothing is committed; the sync fallback: the file is emptied) */
  abort(): Promise<void>;
}

type SyncHandle = { write(b: Uint8Array, o: { at: number }): number; flush(): void; close(): void; truncate(n: number): void };
type SyncFile = FileSystemFileHandle & { createSyncAccessHandle?: () => Promise<SyncHandle> };

const inWorker = () => typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined';
const bytesOf = (c: Uint8Array | ArrayBuffer | string): Uint8Array => (typeof c === 'string' ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c));
const FULL = 'De opslag van je browser is vol of niet beschikbaar.';

/** true when a file can be written here: createWritable, or a worker for a sync access handle (that method is not even visible on the main thread's handle prototype, so only a real write proves it: src/compat.ts) */
export const canWriteFiles = (): boolean => typeof FileSystemFileHandle !== 'undefined'
  && (typeof FileSystemFileHandle.prototype.createWritable === 'function' || typeof Worker !== 'undefined' || (inWorker() && typeof (FileSystemFileHandle.prototype as SyncFile).createSyncAccessHandle === 'function'));

// ---- the helper worker (main thread without createWritable)
const WORKER_CODE = `
const open = new Map();
onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.op === 'open') { const h = await m.fh.createSyncAccessHandle(); h.truncate(0); open.set(m.id, { h, at: 0 }); postMessage({ q: m.q }); }
    else if (m.op === 'write') { const s = open.get(m.id); const n = s.h.write(new Uint8Array(m.buf), { at: s.at }); if (n !== m.buf.byteLength) throw new Error('short write'); s.at += n; postMessage({ q: m.q }); }
    else { const s = open.get(m.id); open.delete(m.id); if (s) { if (m.op === 'abort') s.h.truncate(0); else s.h.flush(); s.h.close(); } postMessage({ q: m.q }); }
  } catch (err) { postMessage({ q: m.q, err: String(err && err.name || err) + ': ' + String(err && err.message || '') }); }
};`;
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { ok: () => void; fail: (e: Error) => void }>();
function helper(): Worker {
  if (worker) return worker;
  const url = URL.createObjectURL(new Blob([WORKER_CODE], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = (e: MessageEvent<{ q: number; err?: string }>) => {
    const p = pending.get(e.data.q);
    pending.delete(e.data.q);
    if (p) { if (e.data.err) p.fail(new Error(/Quota|short write/i.test(e.data.err) ? FULL : e.data.err)); else p.ok(); }
  };
  w.onerror = () => { for (const p of pending.values()) p.fail(new Error('De opslag-hulpthread van de browser faalde.')); pending.clear(); worker = null; };
  worker = w;
  return w;
}
function call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<void> {
  return new Promise((ok, fail) => { const q = ++seq; pending.set(q, { ok, fail }); helper().postMessage({ ...msg, q }, transfer); });
}

export async function openWritable(fh: FileSystemFileHandle): Promise<FileSink> {
  if (typeof (fh as { createWritable?: unknown }).createWritable === 'function') {
    const w = await fh.createWritable();
    return {
      write: (c) => w.write(c as unknown as FileSystemWriteChunkType),
      close: () => w.close(),
      abort: () => w.abort().catch(() => { /* closed already */ }),
    };
  }
  if (inWorker()) {   // already in a worker: the handle is used directly
    const sync = (fh as SyncFile).createSyncAccessHandle;
    if (typeof sync !== 'function') throw new Error('Deze browser kan geen bestanden in zijn opslag schrijven.');
    const h = await sync.call(fh);
    h.truncate(0);
    let at = 0;
    return {
      async write(c) { const b = bytesOf(c), n = h.write(b, { at }); if (n !== b.length) throw new Error(FULL); at += n; },
      async close() { h.flush(); h.close(); },
      async abort() { try { h.truncate(0); h.close(); } catch { /* closed */ } },
    };
  }
  if (typeof Worker === 'undefined') throw new Error('Deze browser kan geen bestanden in zijn opslag schrijven.');
  const id = ++seq;
  await call({ op: 'open', id, fh });
  let dead = false;
  return {
    async write(c) { const b = bytesOf(c).slice(); await call({ op: 'write', id, buf: b.buffer }, [b.buffer]); },
    async close() { if (dead) return; dead = true; await call({ op: 'close', id }); },
    async abort() { if (dead) return; dead = true; await call({ op: 'abort', id }).catch(() => { /* ignore */ }); },
  };
}

/** replace the whole file with `data` */
export async function writeWhole(fh: FileSystemFileHandle, data: Uint8Array | ArrayBuffer | string): Promise<void> {
  const w = await openWritable(fh);
  try { await w.write(data); await w.close(); } catch (e) { await w.abort(); throw e; }
}
