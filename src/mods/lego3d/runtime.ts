// LEGO 3D at run time (docs/re/lego3d.md section 8): loads the data pack, runs the generators over an archive the game just opened and puts the result into it
// (`Archive.override`, in memory only), and caches the generated members per archive in the browser's private file store (OPFS) so a later visit only reads them back.
// Never blocks or breaks play: every failure leaves the archive as the player's own files have it, and a pack that is not there in time simply is not used.
import type { Archive } from '../../formats/archive.ts';
import { Pack } from './pack.ts';
import { generateArchive, GEN_VERSION } from './gen/index.ts';

export const CACHE_NAME = 'le2-lego3d';          // Cache Storage: the downloaded pack
export const OPFS_DIR = 'le2-lego3d';            // OPFS: generated members per archive

/** what a run did, for the start screen / tests / the headless scenes (`window.__lego3d`) */
export interface Lego3dReport { archives: Record<string, { files: number; bytes: number; cached: boolean; ms: number; by: Record<string, number> }>; failed: string[]; pack: string }

/** fingerprint of an archive's member list (names + sizes, replacements included): the cache is valid only for the same input */
export function fingerprint(a: Archive): string {
  let h = 0x811c9dc5 | 0;
  for (const e of a.entries) {
    const s = `${e.path}:${e.size}|`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16) + '-' + a.entries.length;
}

/** generated members <-> one blob: u32 count, then { u16 nameLength, name, u32 length, bytes }..., deflated */
async function pipe(data: Uint8Array, s: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = s.writable.getWriter();
  void w.write(data as BufferSource).then(() => w.close()).catch(() => { /* surfaces on the read side */ });
  const r = s.readable.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export async function packFiles(files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const enc = new TextEncoder(), names = [...files.keys()].map((k) => enc.encode(k));
  let size = 4;
  for (const [i, b] of [...files.values()].entries()) size += 2 + names[i].length + 4 + b.length;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  dv.setUint32(0, files.size, true);
  let p = 4;
  for (const [i, b] of [...files.values()].entries()) { dv.setUint16(p, names[i].length, true); out.set(names[i], p + 2); p += 2 + names[i].length; dv.setUint32(p, b.length, true); out.set(b, p + 4); p += 4 + b.length; }
  return pipe(out, new CompressionStream('deflate-raw'));
}
export async function unpackFiles(blob: Uint8Array): Promise<Map<string, Uint8Array>> {
  const raw = await pipe(blob, new DecompressionStream('deflate-raw')), dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength), dec = new TextDecoder(), out = new Map<string, Uint8Array>();
  const n = dv.getUint32(0, true);
  let p = 4;
  for (let i = 0; i < n; i++) { const nl = dv.getUint16(p, true), name = dec.decode(raw.subarray(p + 2, p + 2 + nl)); p += 2 + nl; const l = dv.getUint32(p, true); out.set(name, raw.subarray(p + 4, p + 4 + l)); p += 4 + l; }
  if (p !== raw.length) throw new Error('cache blob length');
  return out;
}

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try { const root = await (globalThis.navigator as Navigator).storage?.getDirectory?.(); return root ? await root.getDirectoryHandle(OPFS_DIR, { create: true }) : null; } catch { return null; }
}

export class Lego3dRuntime {
  readonly report: Lego3dReport = { archives: {}, failed: [], pack: '' };
  private pack: Promise<Pack | null> | null = null;
  private url: string;
  /** generator switches (`?lego3d=chars,-studs`), empty = all */
  readonly options: string[];
  /** use the persistent cache of generated members (tests switch it off) */
  cache = true;

  constructor(packUrl: string, options: string[] = []) { this.url = packUrl; this.options = options; }

  /** the pack, from Cache Storage or the network (null if it cannot be had) */
  load(): Promise<Pack | null> {
    return this.pack ??= (async () => {
      try {
        let bytes: Uint8Array | null = null;
        const cs = (globalThis as { caches?: CacheStorage }).caches;
        const c = cs ? await cs.open(CACHE_NAME).catch(() => null) : null;
        const hit = await c?.match(this.url).catch(() => undefined);
        if (hit) bytes = new Uint8Array(await hit.arrayBuffer());
        if (!bytes) {
          const res = await fetch(this.url);
          if (!res.ok) throw new Error(`pack HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          bytes = new Uint8Array(buf);
          void c?.put(this.url, new Response(buf.slice(0))).catch(() => { /* no room: fetched again next time */ });
        }
        const p = Pack.open(bytes);
        this.report.pack = p.version;
        return p;
      } catch (e) { console.warn('LEGO 3D: pack niet geladen', e); return null; }
    })();
  }
  /** resolves true when the pack is usable within `ms` (the game starts without it otherwise) */
  async ready(ms = 8000): Promise<boolean> {
    return (await Promise.race([this.load(), new Promise<null>((r) => setTimeout(() => r(null), ms))])) !== null;
  }

  /** generate (or read back from the cache) the replacement members of `archive` and put them in. Never throws. */
  async apply(name: string, archive: Archive, other: (n: string) => Promise<Archive | null> = async () => null): Promise<void> {
    const t0 = Date.now();
    try {
      const pack = await this.load();
      if (!pack) return;
      const key = `g${GEN_VERSION}.${pack.version}.${fingerprint(archive)}.${this.options.join('+') || 'all'}`;
      let files: Map<string, Uint8Array> | null = null, by: Record<string, number> = {}, cached = false;
      const dir = this.cache ? await opfsDir() : null;
      const fname = `${name.toLowerCase()}.l3d`;
      if (dir) {
        try {
          const f = await (await dir.getFileHandle(fname)).getFile(), buf = new Uint8Array(await f.arrayBuffer());
          const klen = new DataView(buf.buffer, buf.byteOffset).getUint16(0, true);
          if (new TextDecoder().decode(buf.subarray(2, 2 + klen)) === key) { files = await unpackFiles(buf.subarray(2 + klen)); cached = true; }
        } catch { /* not cached */ }
      }
      if (!files) {
        const r = await generateArchive(pack, name, archive, other, this.options);
        files = r.files;
        for (const g of r.by.values()) by[g] = (by[g] ?? 0) + 1;
        if (dir && files.size) {
          try {
            const kb = new TextEncoder().encode(key), blob = await packFiles(files), out = new Uint8Array(2 + kb.length + blob.length);
            new DataView(out.buffer).setUint16(0, kb.length, true); out.set(kb, 2); out.set(blob, 2 + kb.length);
            const w = await (await dir.getFileHandle(fname, { create: true })).createWritable();
            await w.write(out as BufferSource); await w.close();
          } catch { /* no room / no OPFS: generated again next time */ }
        }
        if (r.log.length) console.info(`LEGO 3D ${name}: ${r.log.slice(0, 5).join('; ')}`);
      }
      let bytes = 0;
      for (const [m, b] of files) { archive.override(m, b); bytes += b.length; }
      if (files.size) this.report.archives[name] = { files: files.size, bytes, cached, ms: Date.now() - t0, by };
    } catch (e) {
      this.report.failed.push(name);
      console.warn(`LEGO 3D: ${name} niet gegenereerd, het origineel blijft`, e);
    }
    (globalThis as { __lego3d?: unknown }).__lego3d = this.report;
  }
}

/** removes what LEGO 3D keeps in the browser (the cached pack and the generated members) */
export async function removeLego3dCache(): Promise<void> {
  try { await (globalThis as { caches?: CacheStorage }).caches?.delete(CACHE_NAME); } catch { /* none */ }
  try { const root = await (globalThis.navigator as Navigator).storage?.getDirectory?.(); await root?.removeEntry(OPFS_DIR, { recursive: true }); } catch { /* none */ }
}
