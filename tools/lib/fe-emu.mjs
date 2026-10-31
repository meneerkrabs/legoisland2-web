// z60FRE (the front end stage): the original's behaviour nodes run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for src/shell/fenodes.ts
// (tools/tests/m5-audit-fe-emu.mjs): the constructors FUN_00472743 / 004729f6 / 00472c45 / 00472fd8 and the updates 004721f0 / 004728e2 / 00472adb / 00472d7d, and the
// butterfly node (ctor 004b2d44, update 004b24f8, pre-render 004b2539). The code runs natively from the user's own executable; the engine (animation instances, particle emitters,
// allocation, the random source) is a host table. The animation instances are the port's `AnimInstance` objects. Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
/** pure engine functions executed natively: matrix builders, the matrix copy, bone-matrix math */
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a742, 0x43a9e5, 0x43ab72, 0x43ad29, 0x43b00b, 0x43cec0];
export const CTORS = { pepper: 0x472743, figure: 0x4729f6, train: 0x472c45, brickster: 0x472fd8, butterfly: 0x4b2d44 };
export const UPDATES = { pepper: 0x4721f0, figure: 0x4728e2, train: 0x472adb, brickster: 0x472d7d, butterfly: 0x4b24f8 };

export class FeEmu {
  /**
   * @param pe the executable
   * @param recs the records ({ name, m: 16 floats, flags }), record i at RECORDS_BASE + i * 0x68; `models[i]` is the model token of record i (+4)
   * @param anims Map(record index -> AnimInstance of the oracle's own world), the animation pointer sits at record + 8 (the loader FUN_0047ec85 does that)
   * @param o { rng: { range(x) } }
   */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createCpu(pe));
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/engine-m1.md 8.1)
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    mem.wf32(0x8b1718, 1);   // DAT_008b1718: the step time (tests change it with setDt)
    this.log = [];
    this.rng = o.rng;
    this.unhooked = new Map();
    this.anims = new Map();
    this.nodes = new Map();
    const L = this;
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w32(a + 4, 0x40000000 + i * 0x100);
      mem.w16(a + 0x60, r.flags);
      const an = anims.get(i);
      if (an) { const p = this.alloc(16); mem.w32(a + 8, p); this.anims.set(p, an); }
    });
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x4388ae, (c) => { c.fpush(L.rng.range(c.argf(0))); });
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
    // FUN_0043b76a advances by rate * DAT_008b1718: the port's AnimInstance gets the step time the test wrote into the emulated memory (`setDt`)
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1), mem.f32(0x8b1718)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x444550, (c) => { logf(`mode ${this.recIndex(c.arg(0))} ${c.arg(1)} ${c.arg(2)}`); c.eax = 0; });
    H.set(0x4446c0, (c) => { logf(`attr ${this.recIndex(c.arg(0))} ${c.arg(1)}`); c.eax = 0; });
    // particle emitters: FUN_0044e920(name, matrix, ...) creates, FUN_0044ea00(handle, matrix) moves
    // every call is also kept in structured form (`this.fx`): the effect, the matrix (a record's live matrix `rec + 0xc` -> { rec }, else the stack local's content at the call), position,
    // rotation and gate; tools/tests/m5-audit-fe-particles.mjs compares them with the port's calls
    let em = 0;
    this.fx = [];
    const matArg = (p) => (p >= RECORDS_BASE && p < RECORDS_BASE + 0x40000 && (p - RECORDS_BASE) % REC === 0xc ? { rec: Math.floor((p - RECORDS_BASE) / REC) } : { local: Array.from({ length: 16 }, (_, k) => mem.f32(p + 4 * k)) });
    H.set(0x44e920, (c) => {
      logf(`fx create ${mem.cstr(c.arg(0))}`);
      const fl = (i) => new Float32Array(new Uint32Array([c.arg(i) >>> 0]).buffer)[0];   // a float pushed as its bits
      L.fx.push({ fn: 'start', name: mem.cstr(c.arg(0)), mat: matArg(c.arg(1)), pos: [fl(2), fl(3), fl(4)], rot: [fl(5), fl(6), fl(7)], gate: [c.arg(8) | 0, c.arg(9) | 0, c.arg(10) | 0] });
      c.eax = 0x100 + em++;
    });
    H.set(0x44ea00, (c) => { logf(`fx move ${c.arg(0) - 0x100}`); L.fx.push({ fn: 'setMatrix', handle: c.arg(0) - 0x100, mat: matArg(c.arg(1)) }); c.eax = 0; });
    // the bone matrix of the pose: a fixed identity matrix with a marker translation (the emitter position only feeds the particle emitter)
    const bone = this.alloc(64);
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => mem.wf32(bone + 4 * i, v));
    // FUN_0043bc58(anim, bone): the bone matrix of the animation instance's current pose (the port's AnimInstance of the oracle's own world; the identity when it has none)
    H.set(0x43bc58, (c) => {
      const a = inst(c), p = a?.pose?.(1), b = c.arg(1);
      if (p && p.length >= b * 16 + 16) { for (let k = 0; k < 16; k++) mem.wf32(bone + 4 * k, p[b * 16 + k]); }
      else [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].forEach((v, i) => mem.wf32(bone + 4 * i, v));
      c.eax = bone;
    });
    // the butterfly's world: record flag 1 (frustum), the model colour call FUN_0043ebe0, sound destroy
    H.set(0x43ebe0, (c) => { logf(`modelcolour ${c.arg(1)}`); c.eax = 0; });
    H.set(0x444480, (c) => { c.eax = 0; });
    // the credits scroll FUN_00471c4c (0x471c4c .. 0x471f00): the text drawing FUN_00471bd2 / FUN_0043a091 are no-ops
    H.set(0x471bd2, (c) => { c.eax = 0; });
    H.set(0x43a091, (c) => { c.eax = 0; });
    cpu.exec = [[0x4721a7, 0x4731d0], [0x4b23dc, 0x4b3000], [0x471c4c, 0x471f00], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  /** DAT_008b1718 */
  setDt(dt) { this.cpu.mem.wf32(0x8b1718, dt); }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  recIndex(p) { return Math.floor((p - RECORDS_BASE) / REC); }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }
  /** the matrix / flags / model token of a record */
  matrix(i) { const a = this.recPtr(i) + 0xc; return Array.from({ length: 16 }, (_, k) => this.f(a + 4 * k)); }
  flags(i) { return this.cpu.mem.r16(this.recPtr(i) + 0x60); }
  modelOf(i) { return (this.cpu.mem.r32(this.recPtr(i) + 4) - 0x40000000) / 0x100; }

  /** the constructor as the attach calls it (record, argument block, node 0, position 0, var 2, mask 1); returns the node pointer */
  construct(kind, rec, argBlock = 0) {
    this.cpu.steps = 0;
    this.cpu.call(CTORS[kind], [this.recPtr(rec), argBlock, 0, 0, 2, 1], { maxSteps: 5_000_000 });
    const node = this.cpu.eax;
    this.nodes.set(kind + rec, node);
    return node;
  }
  /** FUN_00472743 and friends return the node block; FUN_004b2d44 (butterfly) returns void: its block is the last allocation of 0x5c bytes */
  update(kind, rec) {
    this.log = [];
    this.cpu.steps = 0;
    this.cpu.call(UPDATES[kind], [this.recPtr(rec), this.nodes.get(kind + rec)], { maxSteps: 5_000_000 });
    return this.log;
  }
  /** the original's field of a node block */
  field(kind, rec, off) { return this.cpu.mem.r32(this.nodes.get(kind + rec) + off) | 0; }
  fieldf(kind, rec, off) { return this.f(this.nodes.get(kind + rec) + off); }
}
