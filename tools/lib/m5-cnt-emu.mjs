// z36CNT (M5 audit): the original's centrifuge code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m5-audit-z36CNT-emu.mjs).
// Native from the user's own executable: the TRAI constructor FUN_007b20a8 and its update FUN_007b0c6e (with FUN_007b0401 windows / lights, FUN_007aff48 / FUN_007aff9f monitor
// ranges, FUN_007af902 pitch), Bob's FUN_007b2836 / FUN_007b24a2, the matrix helpers, the C runtime. Hosted: animation instances (the port's AnimInstance), sounds, speech, game
// variables, rand() (FUN_0085daf0: a scripted 15 bit source; FUN_004388ae runs natively), FUN_0043b76a's advance by `rate * DAT_008b1718` (the port's AnimInstance). Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43af16, 0x43ae1e, 0x43cec0, 0x43a8bb, 0x43ad29];

export class CntEmu {
  /** @param recs the 20 records ({ name, m, flags }), @param anims Map(record index -> AnimInstance), @param o { rand(): int 0 .. 32767, vars: Map, dt } */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x10000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = []; this.nodes = {}; this.anims = new Map(); this.unhooked = new Map(); this.speechIds = [];
    this.rand = o.rand; this.vars = o.vars; this.dt = o.dt ?? 1;
    cpu.cw = 0x7f;      // the executable runs the x87 in 24-bit precision (Direct3D 7): every + - * / rounds to float32
    mem.wf32(0x8b1718, this.dt); mem.wf32(0x8b171c, 1 / this.dt);
    mem.w32(0x983800, recs.length); mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w32(a + 4, 0x40000000 + i * 0x100);
      mem.w16(a + 0x60, r.flags);
      const an = anims.get(i);
      if (an) { const p = this.alloc(16); mem.w32(a + 8, p); this.anims.set(p, an); }
      // the model's attachment table (FUN_0043e910 writes `*(model + 0xc) + 0xc + slot * 0x10`)
      const model = this.alloc(0x40), att = this.alloc(0x100); mem.w32(model + 0xc, att);
    });
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    const L = this;
    H.set(0x43e910, (c) => { c.eax = 0; });      // FUN_0043e910: attaches the visor matrix to the model (the port keeps it in the renderer)
    H.set(0x433d38, (c) => { const p = L.alloc(c.arg(0)); L.nodes[c.arg(0)] = p; c.eax = p; });
    H.set(0x85daf0, (c) => { c.eax = L.rand(); });
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4435a0, (c) => { logf(`p ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x443600, (c) => { logf(`r ${c.arg(0) & 0xfffff} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); logf(`setVar ${c.arg(0)} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) & 0xff, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1), L.dt) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    // FUN_0043b92a(anim, speed): 2 when `(float)(1.0 + frame + speed * DAT_008b1718)` (each operation float32) exceeds the clip's frame count (asm 0x43b949 .. 0x43b979)
    H.set(0x43b92a, (c) => { const a = inst(c); const f = Math.fround; c.eax = a && f(f(1 + a.frame) + f(c.argf(1) * f(L.dt))) > a.frameCount ? 2 : 0; });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
    cpu.exec = [[0x7ae867, 0x7b6081], [0x4388ae, 0x4388e7], CRT];       // FUN_0043b92a (the clip end test, hosted below: it reads the engine's animation instance) and FUN_004388ae natively
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }
  /** DAT_008b1718 / DAT_008b171c for the next tick */
  setDt(dt) { this.dt = dt; this.cpu.mem.wf32(0x8b1718, dt); this.cpu.mem.wf32(0x8b171c, Math.fround(1 / dt)); }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  /** Bob's constructor (record 0), then the machine's (record 18), as the set-up attaches them */
  construct() {
    const cpu = this.cpu;
    cpu.call(0x7af780, []);           // FUN_007af780: the zone's sound loads
    cpu.steps = 0;
    cpu.call(0x7b2836, [this.recPtr(0), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.bob = this.nodes[0x24];
    cpu.call(0x7b20a8, [this.recPtr(18), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.trai = this.nodes[0x19c];
    return [this.bob, this.trai];
  }
  /**
   * the draw hook FUN_007b1a1b (the placement of the arm, chair, weight and Pepper at the node's angle / power): the draw / material calls are hosted as no-ops, the matrix helpers run
   * natively; returns the matrix of the last (real) copy of the arm, the other three are left in their records
   */
  place(angle, power) {
    const mem = this.cpu.mem;
    mem.wf32(this.trai + 0x110, angle); mem.wf32(this.trai + 0x114, power);
    this.arm = null;
    /** the hook's draw calls in order: { model: record index, m: matrix (16 float bit patterns), mode, alpha (the last FUN_0043ebe0 value of that model) }, and the shadow polygons { shadow: 15 floats } */
    this.draws = [];
    const alphaOf = new Map();
    const bits = (a, n) => { const o = []; for (let k = 0; k < n; k++) o.push(mem.u32 ? mem.u32(a + 4 * k) : mem.f32(a + 4 * k)); return o; };
    const H = this.cpu.hooks;
    for (const a of [0x43f180, 0x43f1a0, 0x416ad7, 0x4092fd, 0x416885]) H.set(a, (c) => { c.eax = 0; });
    // FUN_0043ebe0(model, 3, &alpha, 0): the model's alpha
    H.set(0x43ebe0, (c) => { alphaOf.set((c.arg(0) - 0x40000000) / 0x100, mem.f32(c.arg(2))); c.eax = 0; });
    // FUN_0087dd20(shadow, 2, points, 0) (the hook's own calls; FUN_0043ebe0 is hosted above and does not reach it)
    H.set(0x87dd20, (c) => { this.draws.push({ shadow: Array.from({ length: 15 }, (_, k) => mem.f32(c.arg(2) + 4 * k)) }); c.eax = 0; });
    // FUN_0043f160(model, 0, matrix, part, mode) as the code leaves its stack: the draw of a copy
    H.set(0x43f160, (c) => {
      const model = (c.arg(0) - 0x40000000) / 0x100;
      const m = Array.from({ length: 16 }, (_, k) => mem.f32(c.arg(2) + 4 * k));
      this.draws.push({ model, m, mode: c.arg(4), alpha: alphaOf.get(model) });
      if (model === 18) this.arm = m;
      c.eax = 0;
    });
    this.cpu.steps = 0;
    const cw = this.cpu.cw; this.cpu.cw = 0x7f;   // Direct3D leaves the x87 in 24-bit precision
    try { this.cpu.call(0x7b1a1b, [this.recPtr(18), this.trai], { maxSteps: 5_000_000 }); } finally { this.cpu.cw = cw; }
    return this.arm;
  }
  /** one tick: the buttons that went down, Bob's update (record 0), then the machine's (record 18) */
  tick(pressed) {
    this.log = [];
    this.cpu.mem.w32(0x983840, pressed);
    this.cpu.steps = 0;
    this.cpu.call(0x7b24a2, [this.recPtr(0), this.bob], { maxSteps: 5_000_000 });
    this.cpu.call(0x7b0c6e, [this.recPtr(18), this.trai], { maxSteps: 5_000_000 });
    return this.log;
  }
}
