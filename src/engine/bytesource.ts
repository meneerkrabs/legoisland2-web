// Random access over bytes that may not all be here yet. `IsoVfs` and `InstallShieldCab` read through this instead of
// plain Blobs, so the same code works on a local file, on a download that is still growing (archive.org sends whole files
// only, no byte ranges) and on HTTP range requests through a CORS proxy.

export interface ByteSource {
  readonly size: number;
  /** Bytes [start, end); end is clamped to `size`. Waits until the range is there. */
  read(start: number, end: number): Promise<Uint8Array>;
  /** Good size for sequential reads (bigger for sources where a request is expensive). */
  readonly preferredChunk?: number;
  /** True when `read(start, end)` will not have to wait (bytes are local). */
  has?(start: number, end: number): boolean;
  /** Resolves when [start, end) is local (fetching it when that is possible without waiting for other data). */
  prefetch?(start: number, end: number): Promise<void>;
}

export const blobSource = (blob: Blob): ByteSource => ({
  size: blob.size,
  async read(start, end) {
    return new Uint8Array(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer());
  },
  has: () => true,
  prefetch: () => Promise.resolve(),
});

export const toSource = (x: Blob | ByteSource): ByteSource => (x instanceof Blob ? blobSource(x) : x);

/** A window [offset, offset + length) of another source (a file inside an ISO). */
export function sliceSource(src: ByteSource, offset: number, length: number): ByteSource {
  return {
    size: length,
    preferredChunk: src.preferredChunk,
    read: (s, e) => src.read(offset + s, offset + Math.min(e, length)),
    has: (s, e) => src.has?.(offset + s, offset + Math.min(e, length)) ?? true,
    prefetch: (s, e) => src.prefetch?.(offset + s, offset + Math.min(e, length)) ?? Promise.resolve(),
  };
}

/** Overall loading state of the game data (bytes), for progress UI. */
export class LoadState {
  done = 0;
  total = 0;
  error: unknown = null;
  private listeners = new Set<() => void>();
  constructor(total = 0, done = 0) {
    this.total = total;
    this.done = done;
  }
  get complete() { return this.total > 0 && this.done >= this.total; }
  get fraction() { return this.total ? Math.min(1, this.done / this.total) : 1; }
  update(done: number, total = this.total) {
    this.done = done;
    this.total = total;
    this.emit();
  }
  add(done: number, total = 0) {
    this.done += done;
    this.total += total;
    this.emit();
  }
  fail(e: unknown) {
    this.error = e;
    this.emit();
  }
  emit() {
    for (const f of [...this.listeners]) f();
  }
  /** Calls `fn` on every change; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const FLUSH = 8 << 20;

/**
 * A file that is being downloaded as one sequential stream: `append()` the chunks in order; a `read()` resolves as soon as
 * its range has arrived. Memory: chunks are folded into a Blob every 8 MB (the browser may keep that on disk), so the
 * data is not held twice; `finish(file)` swaps in the persisted copy (an OPFS file) as the backing store.
 */
export class GrowingSource implements ByteSource {
  readonly size: number;
  readonly preferredChunk = 4 << 20;
  received = 0;
  private backing: Blob = new Blob([]);
  private backingLen = 0;
  private tail: Uint8Array[] = [];
  private tailLen = 0;
  private waiters: { end: number; resolve: () => void; reject: (e: unknown) => void }[] = [];
  private failure: unknown = null;
  private onData: (() => void) | null;

  constructor(size: number, onData?: () => void) {
    this.size = size;
    this.onData = onData ?? null;
  }

  append(chunk: Uint8Array) {
    const n = Math.min(chunk.length, this.size - this.received);
    if (n <= 0) return;
    this.tail.push(n === chunk.length ? chunk : chunk.subarray(0, n));
    this.tailLen += n;
    this.received += n;
    if (this.tailLen >= FLUSH) this.fold();
    this.waiters = this.waiters.filter((w) => {
      if (w.end > this.received) return true;
      w.resolve();
      return false;
    });
    this.onData?.();
  }

  private fold() {
    this.backing = new Blob([this.backing, ...(this.tail as BlobPart[])]);
    this.backingLen += this.tailLen;
    this.tail = [];
    this.tailLen = 0;
  }

  /** The download is complete and stored: `file` (same bytes) becomes the backing store, the memory copy goes away. */
  finish(file: Blob) {
    this.backing = file;
    this.backingLen = this.size;
    this.tail = [];
    this.tailLen = 0;
  }

  fail(e: unknown) {
    this.failure = e;
    for (const w of this.waiters) w.reject(e);
    this.waiters = [];
  }

  has(start: number, end: number) {
    return Math.min(end, this.size) <= this.received;
  }

  prefetch(start: number, end: number): Promise<void> {
    const e = Math.min(end, this.size);
    if (e <= this.received) return Promise.resolve();
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.waiters.push({ end: e, resolve, reject }));
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    end = Math.min(end, this.size);
    await this.prefetch(start, end);
    const out = new Uint8Array(Math.max(0, end - start));
    // snapshot: appends may fold the tail into the backing blob while we await
    const backing = this.backing;
    const backingLen = this.backingLen;
    const tail = this.tail;
    if (start < backingLen) {
      const e = Math.min(end, backingLen);
      out.set(new Uint8Array(await backing.slice(start, e).arrayBuffer()), 0);
    }
    if (end > backingLen) {
      let pos = backingLen;
      for (const c of tail) {
        const cs = pos;
        const ce = pos + c.length;
        pos = ce;
        if (ce <= start || cs >= end) continue;
        const from = Math.max(start, cs);
        const to = Math.min(end, ce);
        out.set(c.subarray(from - cs, to - cs), from - start);
      }
    }
    return out;
  }
}

/** Run `fn` on each item with at most `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
