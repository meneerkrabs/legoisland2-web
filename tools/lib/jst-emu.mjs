// z09JST: the original's duel code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m6-z09JST-emu.mjs).
// The zone's code (0x5cd0d0 .. 0x5d4b60, mfigman 0x5f2bb0 .. 0x5f3f60), the C runtime and a few pure engine functions (matrix builders, the path object) run natively from the
// user's own executable; the engine (animation instances, sounds, speech, variables, allocation) is a host table that records its calls. The animation instances are the
// port's `AnimInstance` objects (the clip / frame / advance functions of the engine are hosted with them), so both sides animate the same rigs. Nothing of the executable
// is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
/** pure engine functions executed natively: matrices / vectors, the path object */
const NATIVE = [
  0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43af16, 0x43ae1e, 0x43cec0,
  0x445660, 0x445680, 0x4458d0, 0x4458f0, 0x445970, 0x447550, 0x446af0, 0x4466f0, 0x447800, 0x4478d0, 0x447280, 0x4456e0, 0x446fd0,
];

export class JstEmu {
  /**
   * @param pe the executable
   * @param recs the records ({ name, m: 16 floats, flags }), record i at RECORDS_BASE + i * 0x68
   * @param anims Map(record index -> AnimInstance of the oracle's own world)
   * @param o { rng: { range(x) }, tables: { points[][] } (the camera spline's control points are read from the executable by the original: nothing to pass) }
   */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.vars = new Map();
    /** the calls of the current tick: strings like the port's logs */
    this.log = [];
    this.held = 0; this.pressed = 0;
    this.ticks = 0;
    this.rng = o.rng;
    this.unhooked = new Map();
    this.speechIds = [];
    this.anims = new Map();
    this.poseBuf = new Map();
    const L = this;
    // ---- records
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w32(a + 4, 0x40000000 + i * 0x100);          // the model pointer: a token per record
      mem.w16(a + 0x60, r.flags);
      const an = anims.get(i);
      if (an) { const p = this.alloc(16); mem.w32(a + 8, p); this.anims.set(p, an); }
    });
    // the zone model array of the builder: DAT_00983838 + 0x20 holds a pointer (the models are tokens)
    const g = this.alloc(0x40); mem.w32(g + 0x20, 0x55550000); mem.w32(0x983838, g);
    // ---- hosts
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); logf(`setVar ${c.arg(0)} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x435c91, (c) => { c.eax = Math.trunc(L.ticks * 1000 / 30); });
    // FUN_004388ae(float range): rand() / 32767 * range as float10; the port's `range` is the same function
    H.set(0x4388ae, (c) => { c.fpush(L.rng.range(c.argf(0))); });
    // sounds: the loaders return the sound id (2D / 3D marked), the player functions log it
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x4435a0, (c) => { logf(`p2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${c.arg(0) & 0xfffff} ${[0, 1, 2].map((k) => mem.f32(p + 4 * k).toFixed(2)).join(',')}`); c.eax = 0; });
    H.set(0x443600, (c) => { logf(`r ${c.arg(0) & 0xfffff} ${c.arg(1) | 0}`); c.eax = 0; });
    // speech: FUN_00439bf8(table, "ID", &token), FUN_00435a11(a, b), FUN_00435b07 (stop)
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    H.set(0x435b07, (c) => { logf('stop'); c.eax = 0; });
    // gear: FUN_0043eaf0(modelArray, k) -> model token k, FUN_0043e930(model, child, bone, slot) attach, FUN_0043e970(model, slot) detach
    H.set(0x43eaf0, (c) => { c.eax = 0x50000000 + c.arg(1); });
    H.set(0x43e930, (c) => { logf(`gear ${((c.arg(0) - 0x40000000) / 0x100) | 0}:${c.arg(3)}:on`); c.eax = 0; });
    H.set(0x43e970, (c) => { logf(`gear ${((c.arg(0) - 0x40000000) / 0x100) | 0}:${c.arg(1)}:off`); c.eax = 0; });
    // particles: emitter handles (FUN_004429e0 / FUN_00442960 create, FUN_0044ea60(handle, mode, 1, 1) controls, FUN_00442a00 places)
    let em = 0;
    H.set(0x4429e0, (c) => { c.eax = 0x100 + em++; });
    H.set(0x442960, (c) => { c.eax = 0x100 + em++; });
    H.set(0x44ea60, (c) => { logf(`fx ${c.arg(0) - 0x100} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x442a00, (c) => { c.eax = 0; });
    // sprintf(dest, "%d" / "%5d", value): the popup numbers
    H.set(0x85ac00, (c) => {
      const f = mem.cstr(c.arg(1)), m = /^%(\d*)d$/.exec(f);
      const s = m ? String(c.arg(2) | 0).padStart(+m[1] || 0, ' ') : '?';
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    // the 2D layer: FUN_00439c6f(table, font, text, 1, 0, x, y, wrap) draws a line of text, FUN_00460a3d(0x16, 0x14, 0) the panel
    this.texts = [];
    H.set(0x439c6f, (c) => {
      const t = c.arg(0);
      this.texts.push({ table: t === 0 ? 'raw' : t === 0x7001 ? 'zone' : t === 0x7002 ? 'std' : `?${t}`, text: mem.cstr(c.arg(2)), x: c.arg(5), y: c.arg(6), wrap: c.arg(7) });
      c.eax = 0;
    });
    H.set(0x460a3d, (c) => { this.texts.push({ panel: true }); c.eax = 0; });
    mem.w32(0x5d5ae94, 0x7001); mem.w32(0x983a14, 0x7002);       // the zone table and STD.str handles (loaded by the set-up in the game)
    // animations (the port's AnimInstance): FUN_0043b6a3 start, 0043b76a advance, 0043b73f frame, 0043b72b clip, 0043b753 length, 0043b64d seek
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
    // the pose: FUN_0043ba7a(anim, root) evaluates into the anim's buffer (identity root only: model space), FUN_0043bc22 / 0043bc58 give the buffer / a bone
    const poseOf = (anim) => {
      const a = L.anims.get(anim);
      let b = L.poseBuf.get(anim);
      if (!b) { b = L.alloc(64 * 40); L.poseBuf.set(anim, b); }
      const p = a?.pose(1);
      if (p) for (let i = 0; i < p.length; i++) mem.wf32(b + i * 4, p[i]);
      return b;
    };
    H.set(0x43ba7a, (c) => { poseOf(c.arg(0)); c.eax = L.anims.get(c.arg(0))?.rig.skeleton?.boneCount ?? 0; });
    H.set(0x43bc22, (c) => { c.eax = poseOf(c.arg(0)); });
    H.set(0x43bc58, (c) => { c.eax = poseOf(c.arg(0)) + c.arg(1) * 0x40; });
    // the camera spline object: FUN_00445340(points, count, 0, 1) copies the points into a path object (the wrapper table of FUN_00445340 is built here, the curve methods run natively)
    H.set(0x445340, (c) => {
      const n = c.arg(1), src = c.arg(0);
      const ptsP = L.alloc(n * 12);
      for (let i = 0; i < n * 3; i++) mem.wf32(ptsP + i * 4, mem.f32(src + i * 4));
      const curve = L.alloc(0x30);
      mem.w32(curve, 0x892268); mem.w32(curve + 8, n); mem.w32(curve + 0x14, n); mem.w32(curve + 0x18, ptsP);
      const wrapper = L.alloc(0x28); mem.w32(wrapper + 0x24, curve);
      const table = L.alloc(4); mem.w32(table, wrapper);
      mem.w32(0x9e586c, table); mem.w32(0x9e5870, 1);
      L.curve = curve;
      c.eax = 0;
    });
    H.set(0x4455e0, (c) => { c.eax = 0; });
    // the other engine calls of the zone's nodes that do not matter here: logged as unhooked (returning 0)
    cpu.exec = [[0x5cd0d0, 0x5d4b60], [0x5f2bb0, 0x5f3f60], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }

  /** FUN_005d24b0: the zone's sounds (the loaders are hosted: handles = ids); FUN_005d4add: the 8 rows of the final tableau into DAT_05d5b190 */
  loadSounds() { this.cpu.call(0x5d24b0, []); this.cpu.call(0x5d4add, []); }
  /** the constructor FUN_005d1f64 as the attach calls it: (record 4, argument 0, node 0, var 2, mask 1, value 1) */
  construct() {
    this.cpu.steps = 0;
    this.cpu.call(0x5d1f64, [this.recPtr(4), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.node = this.cpu.mem.u32(0x5d5b0a8);
    this.curve = this.curve ?? 0;
    return this.node;
  }
  /** one tick: the buttons, then the node functions in record order (JSTGame 4, Flag 5..10, Anims 19 20 21 22 25 26 27 28; Drkk 11 does nothing) */
  tick(held, pressed) {
    this.ticks++;
    this.log = [];
    this.texts = [];
    const mem = this.cpu.mem;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed);
    this.cpu.steps = 0;
    this.cpu.call(0x5ce506, [this.recPtr(4), this.node], { maxSteps: 5_000_000 });
    for (const i of [5, 6, 7, 8, 9, 10]) this.cpu.call(0x5d3d90, [this.recPtr(i), 0]);
    for (const i of [19, 20, 21, 22, 25, 26, 27, 28]) this.cpu.call(0x5d3b80, [this.recPtr(i), 0]);
    return this.log;
  }
}
