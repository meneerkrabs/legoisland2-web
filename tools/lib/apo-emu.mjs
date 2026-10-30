// z40aPO: the original's pilot node (constructor FUN_007d53af, update FUN_007d3187) run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port
// (tools/tests/m5-audit-z40aPO-emu.mjs). The zone's code (0x7cf129 .. 0x7e22b0: the pilot, the sound loader FUN_007d0cb0), the C runtime and the pure matrix helpers run natively from the
// user's own executable. The engine is a host table: the animation instance of Pepper is the port's `AnimInstance` (both sides animate the same rig), the collision calls
// (FUN_00441270 sweep, FUN_00442a70 ground probe, FUN_007d3050 segment vs rock-monster box) are answered by the port's collision code on the same record state (the oracle
// verifies the pilot's decisions and arithmetic, not the collision engine), sounds / speech / particles only record their calls. Nothing of the executable is stored here.
import { createGameCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
/** pure engine functions executed natively: matrices / vectors */
const NATIVE = [
  0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43ad29, 0x43af16, 0x43ae1e, 0x43cec0, 0x43cfee, 0x43b022, 0x43a742, 0x43d5ec,
];

export class ApoEmu {
  /**
   * @param pe the executable
   * @param recs the records of the oracle's own world ({ name, m, rx, ry, rz, flags, index })
   * @param anims Map(record index -> AnimInstance of the oracle's own world): PEPP and the three rock monsters
   * @param o { rng: { range(x) }, parts(i), proxy: { recs, sweep, box, shadow } }: the collision calls are answered by the port's collision code on a proxy world whose
   *          records are synchronised from this memory at every call (so the oracle's nodes see their own record state)
   */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createGameCpu(pe));
    const mem = cpu.mem;
    this.pe = pe; this.recs = recs; this.o = o;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.vars = new Map();
    this.log = [];
    this.held = 0; this.pressed = 0;
    this.ticks = 0;
    this.unhooked = new Map();
    this.speechIds = [];
    this.partBufs = new Map();
    const L = this;
    // ---- records
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => this.putRecord(i, r, true));
    this.anims = new Map();
    for (const [i, a] of anims) { const p = this.alloc(16); mem.w32(RECORDS_BASE + i * REC + 8, p); this.anims.set(p, a); }
    // ---- hosts
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); logf(`setVar ${c.arg(0)} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x4388ae, (c) => { c.fpush(L.o.rng.range(c.argf(0))); });
    // sounds
    H.set(0x4359d5, (c) => { c.eax = 0; });
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x4435a0, (c) => { logf(`p2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s2 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${c.arg(0) & 0xfffff} ${[0, 1, 2].map((k) => Math.fround(mem.f32(p + 4 * k)).toFixed(2)).join(',')}`); c.eax = 0; });
    H.set(0x4434b0, (c) => { logf(`s3 ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x443600, (c) => { logf(`r ${c.arg(0) & 0xfffff} ${c.arg(1) | 0}`); c.eax = 0; });
    // speech
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    H.set(0x435b07, (c) => { logf('stop'); c.eax = 0; });
    // particles
    let em = 0;
    H.set(0x4429e0, (c) => { c.eax = 0x100 + em++; });
    H.set(0x442960, (c) => { c.eax = 0x100 + em++; });
    H.set(0x442a20, (c) => { logf(`fx ${c.arg(0) - 0x100} ${c.arg(1)}`); c.eax = 0; });
    // Pepper's animation (the port's AnimInstance): FUN_0043b6a3 start, 0043b76a advance, 0043b73f frame, 0043b72b clip
    const inst = (c) => L.anims.get(c.arg(0)) ?? null;
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; logf(`clip ${c.arg(1) | 0}`); });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    // the pose: FUN_0043bc22(anim) = the bone matrices of the instance (the port's AnimInstance.pose), FUN_0043bc58(anim, bone) one of them
    const poseBufs = new Map();
    const poseOf = (ptr) => {
      const a = L.anims.get(ptr);
      let b = poseBufs.get(ptr);
      if (!b) { b = L.alloc(64 * 64); poseBufs.set(ptr, b); }
      const p = a?.pose(1);
      if (p) for (let i = 0; i < p.length; i++) mem.wf32(b + i * 4, p[i]);
      return b;
    };
    H.set(0x43bc22, (c) => { c.eax = poseOf(c.arg(0)); });
    H.set(0x43bc58, (c) => { c.eax = poseOf(c.arg(0)) + c.arg(1) * 0x40; });
    // the shadow patch draw of the wing's hook: FUN_0040ccce / 0040cc4d (render state), FUN_0043ebe0 (vertices), FUN_00444480 (draw) only matter for the picture
    H.set(0x40ccce, (c) => { c.eax = 0; });
    H.set(0x40cc4d, (c) => { c.eax = 0; });
    H.set(0x43ebe0, (c) => { c.eax = 0; });
    H.set(0x444480, (c) => { c.eax = 0; });
    H.set(0x442a00, (c) => { c.eax = 0; });
    // FUN_0043ea60(model, k): the k-th sub-object matrix of the record's model (tokens: record i + 4 = 0x40000000 + i * 0x100); the buffers start as the mesh's MATL matrices
    H.set(0x43ea60, (c) => {
      const tok = c.arg(0), k = c.arg(1) | 0;
      const idx = ((tok - 0x40000000) / 0x100) | 0;
      let buf = L.partBufs.get(idx);
      if (!buf) {
        const init = L.o.parts?.(idx) ?? [];
        buf = L.alloc(0x40 * Math.max(4, init.length));
        init.forEach((m, j) => { for (let q = 0; q < 16; q++) mem.wf32(buf + j * 0x40 + q * 4, m[q]); });
        L.partBufs.set(idx, buf);
      }
      c.eax = buf + k * 0x40;
    });
    // strncmp(record name / string, pattern, n)
    H.set(0x890290, (c) => {
      const a = c.arg(0), b = c.arg(1), n = c.arg(2);
      for (let i = 0; i < n; i++) { const x = mem.r8(a + i), y = mem.r8(b + i); if (x !== y) { c.eax = x < y ? 0xffffffff : 1; return; } if (x === 0) break; }
      c.eax = 0;
    });
    // collision (the port's code on the same record state): FUN_00441270(rec, &pos, &delta, &normal, &point, mask, radius, skin) -> hit record or 0
    const proxy = () => { L.syncProxy(); return L.o.proxy; };
    H.set(0x441270, (c) => {
      const p = c.arg(1), d = c.arg(2);
      const px = proxy();
      const rec = px.recs[(c.arg(0) - RECORDS_BASE) / REC];
      const hit = px.sweep(rec, [0, 1, 2].map((k) => mem.f32(p + 4 * k)), [0, 1, 2].map((k) => mem.f32(d + 4 * k)), c.arg(5), c.argf(6), c.argf(7));
      if (!hit) { c.eax = 0; return; }
      for (let k = 0; k < 3; k++) { mem.wf32(c.arg(3) + 4 * k, hit.normal[k]); mem.wf32(c.arg(4) + 4 * k, hit.point[k]); }
      c.eax = RECORDS_BASE + hit.rec.index * REC;
    });
    // FUN_00442570(rec, &centre, &half extents): the box of the record's collision object (the port's parsed .col box)
    H.set(0x442570, (c) => {
      const col = L.o.proxy.recs[(c.arg(0) - RECORDS_BASE) / REC].colObj?.col;
      if (col) for (let k = 0; k < 3; k++) { mem.wf32(c.arg(1) + 4 * k, col.center[k]); mem.wf32(c.arg(2) + 4 * k, col.halfExtents[k]); }
      c.eax = 0;
    });
    // FUN_007d3050(rec, &prev, &cur, &point, &normal): the segment against the rock monster's box (the port's code, unless `nativeBox`: then the original's own code runs)
    if (!o.nativeBox) H.set(0x7d3050, (c) => {
      const px = proxy();
      const rec = px.recs[(c.arg(0) - RECORDS_BASE) / REC];
      const a = c.arg(1), b = c.arg(2);
      const point = [0, 0, 0], normal = [0, 0, 0];
      const hit = px.box(rec, [0, 1, 2].map((k) => mem.f32(a + 4 * k)), [0, 1, 2].map((k) => mem.f32(b + 4 * k)), point, normal);
      if (hit) for (let k = 0; k < 3; k++) { mem.wf32(c.arg(3) + 4 * k, point[k]); mem.wf32(c.arg(4) + 4 * k, normal[k]); }
      c.eax = hit ? 1 : 0;
    });
    // FUN_00442a70(rec, ground record, 2.0, 0.4, &points, 0): the blob shadow points under the wing record (the port's computation)
    H.set(0x442a70, (c) => {
      const px = proxy();
      const rec = px.recs[(c.arg(0) - RECORDS_BASE) / REC];
      const pts = px.shadow(rec, c.argf(2), c.argf(3));
      if (!pts) { c.eax = 0; return; }
      for (let i = 0; i < 15; i++) mem.wf32(c.arg(4) + 4 * i, pts[i]);
      c.eax = 1;
    });
    // sprintf(dest, "%d", value) of the HUD score; FUN_0046055f (the standard HUD draw) does nothing here
    H.set(0x85ac00, (c) => {
      const f = mem.cstr(c.arg(1)), m = /^%(\d*)d$/.exec(f);
      const t = m ? String(c.arg(2) | 0).padStart(+m[1] || 0, ' ') : '?';
      for (let i = 0; i < t.length; i++) mem.w8(c.arg(0) + i, t.charCodeAt(i));
      mem.w8(c.arg(0) + t.length, 0);
      c.eax = t.length;
    });
    H.set(0x46055f, (c) => { c.eax = 0; });
    cpu.exec = [[0x7cf129, 0x7e22b0], CRT];
    if (o.nativeBox) cpu.hooks.delete?.(0x7d3050);
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  /** copy the record matrices / flags of this memory into the proxy world (the collision code reads them) */
  syncProxy() {
    const mem = this.cpu.mem;
    this.o.proxy.recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 16; k++) r.m[k] = mem.f32(a + 0xc + 4 * k);
      r.flags = mem.r16(a + 0x60);
    });
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }

  /** write record i (name, matrix, euler angles, flags); `first` also writes the model token */
  putRecord(i, r, first = false) {
    const mem = this.cpu.mem, a = RECORDS_BASE + i * REC;
    if (first) {
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      mem.w32(a + 4, 0x40000000 + i * 0x100);
    }
    for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, r.m[k]);
    mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
    mem.w16(a + 0x60, r.flags);
  }

  /** FUN_007d0cb0: the sound loads of the zone */
  loadSounds() { this.cpu.call(0x7d0cb0, []); }
  /** the constructors as FUN_007d0839 attaches them (record, argument 0, node 0, var 2, mask 1, value 1): pilot (PEPP 6), wing (PARA 79), rock monsters (ROC1 7), brickbots (BBT0 69), asteroids (RKA1 86), sky (SKY1 0) */
  construct() {
    const call = (fn, rec) => { this.cpu.steps = 0; return this.cpu.call(fn, [this.recPtr(rec), 0, 0, 2, 1, 1], { maxSteps: 20_000_000 }); };
    this.node = call(0x7d53af, 6);
    this.wing = call(0x7d2fae, 79);
    this.rocks = call(0x7d2bf2, 7);
    this.bots = call(0x7d2650, 69);
    this.asteroids = call(0x7d1778, 86);
    this.sky = call(0x7d1429, 0);
    return this.node;
  }
  /** one tick: the buttons, then the update pass in record order (pilot, rock monsters, brickbots, asteroids; the wing and the sky have no update) */
  tick(held, pressed = 0) {
    this.ticks++;
    this.log = [];
    const mem = this.cpu.mem;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed);
    const run = (fn, rec, node) => { this.cpu.steps = 0; this.cpu.call(fn, [this.recPtr(rec), node], { maxSteps: 20_000_000 }); };
    run(0x7d3187, 6, this.node);
    run(0x7d28e0, 7, this.rocks);
    run(0x7d19e0, 69, this.bots);
    run(0x7d14b0, 86, this.asteroids);
    return this.log;
  }
  /** the draw pass: the wing's hook FUN_007d2dd8 (matrix from Pepper's bone, scale, the shadow patch flags) */
  draw() {
    this.cpu.steps = 0;
    this.cpu.call(0x7d2dd8, [this.recPtr(79), this.wing, 0, 0], { maxSteps: 5_000_000 });
  }
  /** FUN_007d0f00: the HUD state of the tick (mode 2 of the loop calls it after the update pass) */
  hud() {
    this.cpu.steps = 0;
    this.cpu.call(0x7d0f00, [], { maxSteps: 5_000_000 });
  }
}
