// The LEGO 3D data pack: ONE file of LDraw-derived data (fitted part geometry, tables, texture designs, set models) that may be hosted next to the game (CC BY 4.0 / CCAL 2.0 data,
// ATTRIBUTION.txt beside it). It contains nothing of the game's own pictures or meshes; the browser (or node) combines it with the player's own archives (src/mods/lego3d/gen/*).
// Layout: "LG3P" u32 version, u32 indexLength, index JSON (utf-8) = { v, built, files: { name: [offset, storedLength, rawLength, method] } }, then the blobs
// (method 0 = stored, 8 = raw deflate). Written by tools/lego3d/pack/packfile.mjs, read here (browser: DecompressionStream, node 18+: the same global).
export const PACK_VERSION = 1;
export interface PackIndex { v: number; built: string; files: Record<string, [number, number, number, number]> }

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  void w.write(data as BufferSource).then(() => w.close()).catch(() => { /* surfaces on the read side */ });
  const r = ds.readable.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export class Pack {
  readonly index: PackIndex;
  private bytes: Uint8Array;
  private base: number;
  private cache = new Map<string, Promise<Uint8Array>>();
  private constructor(bytes: Uint8Array, index: PackIndex, base: number) { this.bytes = bytes; this.index = index; this.base = base; }

  static open(bytes: Uint8Array): Pack {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12 || dv.getUint32(0, true) !== 0x5033474c) throw new Error('not a LEGO 3D pack');   // "LG3P"
    const ver = dv.getUint32(4, true), il = dv.getUint32(8, true);
    if (ver !== PACK_VERSION) throw new Error(`LEGO 3D pack version ${ver}, expected ${PACK_VERSION}`);
    const index = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + il))) as PackIndex;
    return new Pack(bytes, index, 12 + il);
  }
  /** build date + a hash of the index (names, offsets, sizes): two packs built on the same day differ */
  get version() {
    if (!this.ver) { let h = 0x811c9dc5 | 0; const j = JSON.stringify(this.index.files); for (let i = 0; i < j.length; i++) { h ^= j.charCodeAt(i); h = Math.imul(h, 0x01000193); } this.ver = `${this.index.built}-${(h >>> 0).toString(16)}`; }
    return this.ver;
  }
  private ver = '';
  has(name: string) { return name in this.index.files; }
  names(prefix = ''): string[] { return Object.keys(this.index.files).filter((n) => n.startsWith(prefix)); }
  size(name: string) { return this.index.files[name]?.[2] ?? -1; }
  /** the blob `name` (inflated once, kept) */
  get(name: string): Promise<Uint8Array> {
    let p = this.cache.get(name);
    if (!p) {
      const e = this.index.files[name];
      if (!e) return Promise.reject(new Error(`LEGO 3D pack: no "${name}"`));
      const raw = this.bytes.subarray(this.base + e[0], this.base + e[0] + e[1]);
      p = e[3] === 0 ? Promise.resolve(raw) : inflate(raw);
      this.cache.set(name, p);
    }
    return p;
  }
  async json<T>(name: string): Promise<T> { return JSON.parse(new TextDecoder().decode(await this.get(name))) as T; }
  /** let go of the inflated copies (the generators keep what they need) */
  release(prefix = '') { for (const k of [...this.cache.keys()]) if (k.startsWith(prefix)) this.cache.delete(k); }
}
