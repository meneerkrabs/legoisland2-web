// The ORIGINAL collision sweep FUN_00441270 run in the x86 interpreter on records the caller describes (gaps S5, tests m4-s5-colshapes): the collision objects are laid out in the
// emulated memory exactly as the loaders FUN_0043f370 (polygons) / FUN_0043f700 (header only) build them from the `.col` file, the records are the 0x68-byte structs the sweep reads
// (name, matrix +0x0c, flags +0x60, collision object +0x58). Pure math: the CRT and the matrix / collision functions execute natively.
import { createGameCpu } from '../../src/formats/x86emu.ts';

const HEAP = 0x20000000, RECS = 0x10000000;

export class ColOracle {
  constructor(pe) {
    this.cpu = createGameCpu(pe); this.mem = this.cpu.mem;
    this.mem.addRegion({ lo: HEAP, hi: HEAP + 0x4000000, name: 'heap' });
    this.mem.addRegion({ lo: RECS, hi: RECS + 0x20000, name: 'records' });
    this.heap = HEAP;
    this.cpu.exec = [[0x43a000, 0x43e000], [0x43f000, 0x442000], [0x858d30, 0x873e00]];
    this.cpu.fallback = (a) => { throw new Error('collision oracle: call to 0x' + a.toString(16)); };
    this.cpu.hooks.set(0x85abc0, () => {});   // __chkesp
    this.cpu.hooks.set(0x433d38, (c) => { c.eax = this.alloc(c.arg(0)); });
    this.visited = 0;
  }
  alloc(n) { const p = this.heap; this.heap = (this.heap + Math.max(4, n) + 15) & ~15; return p; }
  static bits(f) { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f, true); return b.getUint32(0, true); }
  /** a collision object from the bytes of a `.col` file; `headerOnly` = FUN_0043f700 (count 0), else FUN_0043f370 */
  collisionObject(buf, headerOnly) {
    const { mem } = this;
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const o = this.alloc(100);
    for (let i = 0; i < 100; i += 4) mem.w32(o + i, 0);
    for (let k = 0; k < 28; k += 4) mem.w32(o + 12 + k, dv.getUint32(4 + k, true));   // centre, half extents, radius
    mem.w32(o + 0x58, mem.u32(o + 0x18)); mem.w32(o + 0x5c, mem.u32(o + 0x1c)); mem.w32(o + 0x60, mem.u32(o + 0x20));
    if (headerOnly || String.fromCharCode(...buf.subarray(32, 36)) !== 'COLP') return o;
    let p = 36;
    const n = dv.getUint32(p, true); p += 4;
    mem.w32(o, n);
    const polys = this.alloc(n * 0x58); for (let i = 0; i < n * 0x58; i++) mem.w8(polys + i, buf[p + i]); p += n * 0x58;
    mem.w32(o + 4, polys);
    p += 4;                                                                  // GRDP
    const m = dv.getUint32(p, true); p += 4; mem.w32(o + 0x28, m);
    const list = this.alloc(m * 4); for (let i = 0; i < m * 4; i++) mem.w8(list + i, buf[p + i]); p += m * 4; mem.w32(o + 0x2c, list);
    p += 4;                                                                  // GRDC
    for (let k = 0; k < 3; k++) mem.w32(o + 0x3c + 4 * k, dv.getUint32(p + 4 * k, true)); p += 12;
    for (let k = 0; k < 3; k++) mem.w32(o + 0x30 + 4 * k, dv.getUint32(p + 4 * k, true)); p += 12;
    const cells = mem.u32(o + 0x3c) * mem.u32(o + 0x40) * mem.u32(o + 0x44);
    const cb = this.alloc(cells * 8); for (let i = 0; i < cells * 8; i++) mem.w8(cb + i, buf[p + i]);
    mem.w32(o + 0x48, cb);
    // the visited-polygon stamps (DAT_009dec20, DAT_009debbc entries) and their counter (DAT_008b1a88)
    if (n > mem.u32(0x9debbc)) { mem.w32(0x9debbc, n); mem.w32(0x9dec20, this.alloc(n * 4)); }
    mem.w32(0x8b1a88, 1);
    return o;
  }
  /** records: { name, m: 16 floats (row-vector matrix, translation in 12..14), flags, col: object address | 0 } */
  records(list) {
    const { mem } = this;
    mem.w32(0x983800, list.length); mem.w32(0x983804, RECS); mem.w32(0x9dec1c, 0);
    list.forEach((r, i) => {
      const a = RECS + i * 0x68;
      for (let k = 0; k < 4; k++) mem.w8(a + k, (r.name || 'XXXX').charCodeAt(k));
      for (let k = 0; k < 16; k++) mem.w32(a + 0xc + 4 * k, ColOracle.bits(r.m[k]));
      mem.w16(a + 0x60, r.flags ?? 2);
      mem.w32(a + 0x58, r.col ?? 0);
    });
  }
  /** FUN_00441270(rec[pep], from, delta, normal*, point*, mask, radius, skin) */
  sweep(pep, from, delta, mask, radius, skin) {
    const { mem, cpu } = this;
    const f = this.alloc(12), d = this.alloc(12), n = this.alloc(12), p = this.alloc(12);
    from.forEach((v, k) => mem.w32(f + 4 * k, ColOracle.bits(v)));
    delta.forEach((v, k) => mem.w32(d + 4 * k, ColOracle.bits(v)));
    const r = cpu.call(0x441270, [RECS + pep * 0x68, f, d, n, p, mask, ColOracle.bits(radius), ColOracle.bits(skin)]);
    return r ? { rec: ((r >>> 0) - RECS) / 0x68, point: [0, 1, 2].map((k) => mem.f32(p + 4 * k)), normal: [0, 1, 2].map((k) => mem.f32(n + 4 * k)) } : null;
  }
}
