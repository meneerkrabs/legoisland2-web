// z50LTC: the original's people / pepswitc code run in the x86 interpreter as an ORACLE for the port (tools/tests/m5-audit-z50LTC-emu.mjs).
// Native: People update FUN_00839e20 / pre-render FUN_0083a292, pepswitc FUN_0083ab7b / 0083a9e0 / 0083aa48 / 0083aa8d, the sound loader FUN_00839560, matrices, atan2 / sqrt (CRT).
// Host (records the calls): variables, animation instances (the port's AnimInstance), emitters, letterbox, sounds, the ground alignment FUN_00429e00, allocation.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43af16, 0x43ae1e, 0x43cec0];
export const G = { TOGGLE: 0x5d5f6dc, TIMER: 0x5d5f6e0, CAND: 0x9daa80, CAND_DIST: 0x8ae330, PEPPER: 0x9da5d0, KEYS: 0x983840, NAME: 0x5d4df1c, ROLE: 0x5d4dfec };

export class LtcEmu {
  /** recs [{name, m, flags}], anims Map(record index -> AnimInstance of the oracle's own world) */
  constructor(pe, recs, anims) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.vars = new Map();
    this.log = [];
    this.letterbox = 0;
    this.anims = new Map();
    const L = this;
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w16(a + 0x60, r.flags);
      const an = anims.get(i);
      if (an) { const p = this.alloc(16); mem.w32(a + 8, p); this.anims.set(p, an); }
    });
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); logf(`var ${c.arg(0)} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0); });
    H.set(0x4433f0, (c) => { logf(`snd ${c.arg(0)}`); c.eax = 0; });
    H.set(0x45f750, (c) => { L.letterbox = c.arg(0); logf(`bars ${c.arg(0)}`); c.eax = 0; });
    H.set(0x44ea60, (c) => { logf(`tw ${c.arg(0) - 0x1000} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x442a20, (c) => { logf(`paul ${c.arg(0) & 0xfff} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x442a00, (c) => { c.eax = 0; });
    H.set(0x444480, (c) => { c.eax = 0; });
    H.set(0x429e00, (c) => { logf('align'); c.eax = 0; });
    const ident = this.alloc(64 * 20); for (let k = 0; k < 20; k++) { mem.wf32(ident + k * 64, 1); mem.wf32(ident + k * 64 + 20, 1); mem.wf32(ident + k * 64 + 40, 1); mem.wf32(ident + k * 64 + 60, 1); }
    H.set(0x43bc58, (c) => { c.eax = ident + c.arg(1) * 64; });
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    cpu.exec = [[0x838c2f, 0x858d30], [0x51e19c, 0x51f400], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { logf(`unhooked_${addr.toString(16)}`); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }
  loadSounds() { this.cpu.call(0x839560, []); }
  /** a People node (0xb8 bytes, row index at +0x14, emitter handles tagged by the row) */
  makePerson(row) {
    const n = this.alloc(0xb8), mem = this.cpu.mem;
    mem.w32(n + 0x14, row); mem.w32(n + 0x18, 0x1000 + row); mem.w32(n + 0x1c, 0x2000 + row); mem.w32(n + 0x20, 0x3000 + row);
    return n;
  }
  makePepSwitch(recIndex) { return this.cpu.call(0x83ab7b, [this.recPtr(recIndex), 0, 0, 0x5e, 0, 0]); }
}

/** the box portal (StartCSM.c FUN_0051ea3c / update FUN_0051e5ab) as the room builds it: block {half 16 24 16, orVar 0, orBits 0, table 0, target 2, face + spin, key 0, icon 0} */
LtcEmu.prototype.makePortal = function (recIndex, a) {
  const mem = this.cpu.mem, b = this.alloc(0x30);
  a.half.forEach((v, k) => mem.wf32(b + 4 * k, v));
  mem.w32(b + 0xc, a.orVar); mem.w32(b + 0x10, a.orBits); mem.w16(b + 0x14, a.table); mem.w16(b + 0x18, a.target);
  mem.w8(b + 0x1a, a.faceCamera ? 1 : 0); mem.w8(b + 0x1b, a.spin ? 1 : 0); mem.w32(b + 0x1c, a.keyMask); mem.w32(b + 0x20, a.iconBits);
  this.portal = this.cpu.call(0x51ea3c, [this.recPtr(recIndex), b, 0, 2, 1, 1]);
  return this.portal;
};
