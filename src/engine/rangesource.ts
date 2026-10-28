// Reading a remote file by HTTP Range requests, with a block cache in Cache Storage so nothing is fetched twice.
// Used for the ISO on archive.org through a CORS proxy (tools/proxy/le2-cors-proxy.php): archive.org's own CORS endpoints
// ignore Range, the data node that honours it sends no CORS headers.

import { LoadState, type ByteSource } from './bytesource.ts';

/** The proxy caps one range at 32 MB. */
export const MAX_RANGE = 32 << 20;
/**
 * Measured through the relay: every request costs ~1.6 s before the first byte and throughput ramps up with the size (1 MB: 0.3 MB/s,
 * 8 MB: 1.8, 32 MB: 7), so requests are biggish (6 MB) and a handful runs in parallel.
 */
const PART = 6 << 20;
const PARALLEL = 6;

export class HttpRangeSource implements ByteSource {
  readonly size: number;
  readonly preferredChunk = 8 << 20;
  private url: string;
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(url: string, size: number) {
    this.url = url;
    this.size = size;
  }

  /** Ask for the first byte to learn the total size (and check that the server honours Range). */
  static async probe(url: string): Promise<number> {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (res.status !== 206) throw new Error(`range-proxy: HTTP ${res.status} (geen 206)`);
    const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    await res.arrayBuffer();
    if (!m) throw new Error('range-proxy: geen Content-Range (Access-Control-Expose-Headers ontbreekt?)');
    return Number(m[1]);
  }

  /** At most PARALLEL requests at a time, first come first served. */
  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= PARALLEL) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    end = Math.min(end, this.size);
    if (end - start > PART) {
      // big ranges as parallel parts
      const out = new Uint8Array(end - start);
      const parts: number[] = [];
      for (let o = start; o < end; o += PART) parts.push(o);
      await Promise.all(parts.map(async (o) => { out.set(await this.read(o, Math.min(end, o + PART)), o - start); }));
      return out;
    }
    if (end <= start) return new Uint8Array(0);
    return this.slot(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
          if (res.status !== 206) throw new Error(`range-proxy: HTTP ${res.status}`);
          const b = new Uint8Array(await res.arrayBuffer());
          if (b.length !== end - start) throw new Error(`range-proxy: ${b.length} bytes in plaats van ${end - start}`);
          return b;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
      throw lastErr;
    });
  }
}

const BLOCK = 256 << 10;
const HOT = 48; // blocks kept in memory
const RUN = 6 << 20; // one request: up to 6 MB of consecutive blocks

/** Block cache over another source: blocks of 256 KB, persisted in Cache Storage, neighbouring misses fetched in one request. */
export class CachedSource implements ByteSource {
  readonly size: number;
  readonly preferredChunk = 8 << 20;
  /** Bytes fetched from the network vs requested (for progress UI). */
  readonly loading = new LoadState();
  fetchedBytes = 0;
  private inner: ByteSource;
  private cache: Cache | null = null;
  private cacheReady: Promise<void>;
  private hot = new Map<number, Uint8Array>();
  private known = new Set<number>();
  private inflight = new Map<number, Promise<Uint8Array>>();

  constructor(inner: ByteSource, cacheName: string) {
    this.inner = inner;
    this.size = inner.size;
    this.cacheReady = 'caches' in globalThis
      ? caches.open(cacheName).then((c) => { this.cache = c; }, () => {})
      : Promise.resolve();
  }

  private key = (n: number) => `https://le2.invalid/block/${n}`;

  private remember(n: number, b: Uint8Array) {
    this.known.add(n);
    this.hot.delete(n);
    this.hot.set(n, b);
    if (this.hot.size > HOT) this.hot.delete(this.hot.keys().next().value as number);
  }

  has(start: number, end: number): boolean {
    end = Math.min(end, this.size);
    for (let b = Math.floor(start / BLOCK); b <= Math.floor((end - 1) / BLOCK); b++) if (!this.known.has(b)) return false;
    return true;
  }

  private async load(b0: number, b1: number): Promise<Uint8Array[]> {
    await this.cacheReady;
    const out: (Promise<Uint8Array> | Uint8Array | undefined)[] = [];
    const missing: number[] = [];
    for (let b = b0; b <= b1; b++) {
      const h = this.hot.get(b) ?? this.inflight.get(b);
      if (h) out[b - b0] = h;
      else missing.push(b);
    }
    if (this.cache) {
      const cache = this.cache;
      await Promise.all(missing.map(async (b) => {
        const r = await cache.match(this.key(b)).catch(() => undefined);
        if (r) {
          const u = new Uint8Array(await r.arrayBuffer());
          this.remember(b, u);
          out[b - b0] = u;
        }
      }));
    }
    // someone else may have started fetching a block while we looked in the cache: join that request
    const rest: number[] = [];
    for (const b of missing) {
      if (out[b - b0]) continue;
      const h = this.hot.get(b) ?? this.inflight.get(b);
      if (h) out[b - b0] = h;
      else rest.push(b);
    }
    // fetch what is still missing: consecutive blocks in one request (small ones, so that the first blocks of a big
    // range arrive early and the requests run in parallel)
    const maxBlocks = Math.max(1, Math.floor(RUN / BLOCK));
    for (let i = 0; i < rest.length;) {
      let j = i;
      while (j + 1 < rest.length && rest[j + 1] === rest[j] + 1 && j + 1 - i < maxBlocks) j++;
      const first = rest[i];
      const start = first * BLOCK;
      const end = Math.min(this.size, (rest[j] + 1) * BLOCK);
      this.loading.add(0, end - start);
      const run = this.inner.read(start, end).then((buf) => {
        this.fetchedBytes += buf.length;
        this.loading.add(buf.length);
        return buf;
      }, (e) => { this.loading.fail(e); throw e; });
      for (let b = rest[i]; b <= rest[j]; b++) {
        const bp = run.then((buf) => {
          const u = buf.slice((b - first) * BLOCK, Math.min(buf.length, (b - first + 1) * BLOCK));
          this.remember(b, u);
          this.cache?.put(this.key(b), new Response(u.slice())).catch(() => {});
          return u;
        });
        this.inflight.set(b, bp);
        void bp.then(() => this.inflight.delete(b), () => this.inflight.delete(b));
        out[b - b0] = bp;
      }
      i = j + 1;
    }
    return Promise.all(out as (Promise<Uint8Array> | Uint8Array)[]);
  }

  async prefetch(start: number, end: number): Promise<void> {
    end = Math.min(end, this.size);
    if (end <= start) return;
    await this.load(Math.floor(start / BLOCK), Math.floor((end - 1) / BLOCK));
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    end = Math.min(end, this.size);
    if (end <= start) return new Uint8Array(0);
    const b0 = Math.floor(start / BLOCK);
    const blocks = await this.load(b0, Math.floor((end - 1) / BLOCK));
    const out = new Uint8Array(end - start);
    blocks.forEach((blk, i) => {
      const bs = (b0 + i) * BLOCK;
      const from = Math.max(start, bs);
      const to = Math.min(end, bs + blk.length);
      if (to > from) out.set(blk.subarray(from - bs, to - bs), from - start);
    });
    return out;
  }
}
