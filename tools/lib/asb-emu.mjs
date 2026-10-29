// z39ASB: the original's shuttle node (constructor FUN_007b96a0, update FUN_007b82dd with the hit test FUN_007b7f68, the layout FUN_007b9917 and the asteroid motion
// FUN_007b91b9) run in the x86 interpreter as an ORACLE for the port's `AsteroidBelt` (tools/tests/m5-audit-z39ASB-emu.mjs). The zone's code and the C runtime run natively;
// the engine is a host table that records sound / speech calls. Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43ad29, 0x43af16, 0x43ae1e, 0x43cec0, 0x43cc5c, 0x43b022, 0x43a742, 0x422b50];

export class AsbEmu {
  /** @param recs the zone's records ({ name, m, rx, ry, rz, flags }); o = { rng: { range(x) }, dummy: { range(x) } (the rand() calls of the hit test: tick-scaled in the original, not comparable) } */
  constructor(pe, recs, o) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    this.pe = pe; this.o = o;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE; this.vars = new Map([[0x59, 26]]); this.log = []; this.ticks = 0; this.speech = [];
    const L = this;
    mem.w32(0x983800, recs.length); mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => this.putRecord(i, r, true));
    const H = cpu.hooks, logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); c.eax = 0; });
    H.set(0x435c91, (c) => { c.eax = Math.trunc(L.ticks * 1000 / 30); });
    // FUN_004388ae(range): the hit test's calls (from FUN_007b7f68) draw from a dummy source
    H.set(0x4388ae, (c) => { const ra = c.retAddr; const src = ra >= 0x7b7f68 && ra < 0x7b82dd ? L.o.dummy : L.o.rng; c.fpush(src.range(c.argf(0))); });
    H.set(0x7b780c, (c) => { c.eax = 0; });            // the 50 random star positions that nothing reads (its rand calls are not part of the sequence)
    for (const a of [0x4435a0, 0x4435b0, 0x4434b0, 0x443600, 0x4433f0, 0x442a20, 0x443230, 0x438518, 0x4359d5, 0x443580, 0x4433b0, 0x435b07, 0x435a11, 0x439bf8]) H.set(a, (c) => { c.eax = 0; });
    H.set(0x4435a0, (c) => { logf(`p2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4434b0, (c) => { logf(`s3 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { logf(`p3 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); mem.w32(c.arg(2), L.speech.push(id)); c.eax = 0; });
    H.set(0x435a11, (c) => { logf(`say ${L.speech[c.arg(0) - 1]}`); c.eax = 0; });
    H.set(0x85ac00, (c) => {
      const f = mem.cstr(c.arg(1)), m = /^%(\d*)d/.exec(f);
      const t = m ? String(c.arg(2) | 0).padStart(+m[1] || 0, ' ') : '?';
      for (let i = 0; i < t.length; i++) mem.w8(c.arg(0) + i, t.charCodeAt(i));
      mem.w8(c.arg(0) + t.length, 0); c.eax = t.length;
    });
    cpu.exec = [[0x7b5bf6, 0x7cf87a], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked ??= new Map(); L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  putRecord(i, r, first = false) {
    const mem = this.cpu.mem, a = RECORDS_BASE + i * REC;
    if (first) { for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20); mem.w32(a + 4, 0x40000000 + i * 0x100); }
    for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, r.m[k]);
    mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz); mem.w16(a + 0x60, r.flags);
  }
  /** FUN_007b6ff2 (the AST* table) then the constructor as the attach calls it */
  construct() {
    this.cpu.steps = 0;
    this.cpu.call(0x7b6c20, [], { maxSteps: 5_000_000 });      // the sound loads (slots = ids)
    this.cpu.call(0x7b73a8, [], { maxSteps: 5_000_000 });      // the HUD set-up (tints white, icons)
    this.cpu.call(0x7b6ff2, [0xcccccccc, 0xcccccccc], { maxSteps: 5_000_000 });
    this.node = this.cpu.call(0x7b96a0, [this.recPtr(1), 0, 0, 2, 1, 1], { maxSteps: 20_000_000 });
    return this.node;
  }
  tick(held) {
    this.ticks++; this.log = [];
    this.cpu.mem.w32(0x98383c, held); this.cpu.mem.w32(0x983840, 0);
    this.cpu.steps = 0;
    this.cpu.call(0x7b82dd, [this.recPtr(1), this.node], { maxSteps: 20_000_000 });
    return this.log;
  }
}
