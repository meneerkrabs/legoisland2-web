// z03PPH: the original's house nodes run in the x86 interpreter as an ORACLE for the port (tools/tests/m5-audit-z03PPH-emu.mjs): PeppHse (constructor 0x5408c4, update 0x54042d with
// 0x5401e0 / 0x5402ac, camera 0x540733), the door (0x540db1 / 0x540b96), the trophies (0x54116c / 0x5413c4), the trophy browser (0x541b79 / 0x5414b0 / 0x5419dc), the map view
// (0x541f94 / 0x541c98 / 0x541e71), PeppComp's position and camera (0x53ff69 / 0x53ffa1), FUN_0053fed3 and the sound loader FUN_0053e7c0. The computer MENU (0x53fbc0, the UI engine) is
// not run: the host leaves the computer by writing var 0x5e. The engine is a host table that records its calls.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43af16, 0x43ae1e, 0x43cec0];
export const G = { LEAVE: 0x5d587b0, DOOR: 0x5d587ac, ICON: 0x5d4e144, CAM: 0x9da5e8, KEYS: 0x983840, T1: 0x5d4dd7c, T2: 0x5d4de4c, T3: 0x5d4df1c };

export class PphEmu {
  constructor(pe, recs) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.vars = new Map();
    this.log = [];
    const L = this;
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w16(a + 0x60, r.flags);
    });
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); c.eax = 0; });
    H.set(0x443580, (c) => { c.eax = c.arg(0); });
    H.set(0x4435a0, (c) => { logf(`snd ${c.arg(0)}`); c.eax = 0; });
    H.set(0x4201aa, (c) => { logf('menuReset'); c.eax = 0; });
    H.set(0x43cc5c, (c) => { c.eax = 0; });
    H.set(0x439788, (c) => { c.eax = c.arg(1); });
    H.set(0x40a3b0, (c) => { c.eax = 0; });
    cpu.exec = [[0x53d7da, 0x5498f5], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { logf(`unhooked_${addr.toString(16)}`); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }
  block(words) { const p = this.alloc(32); words.forEach((w, k) => this.cpu.mem.w32(p + 4 * k, w >>> 0)); return p; }
  /** run a constructor the way the attach does: (record, argument block, node 0, var, mask, value) */
  construct(addr, rec, words = [0, 0, 0, 0]) { return this.cpu.call(addr, [this.recPtr(rec), this.block(words), 0, 2, 0, 0]); }
  /** a controller whose first node is `node` (record + 0x5c) */
  setNode(rec, node) { const c = this.alloc(0x40); this.cpu.mem.w32(c, node); this.cpu.mem.w32(this.recPtr(rec) + 0x5c, c); }
}
