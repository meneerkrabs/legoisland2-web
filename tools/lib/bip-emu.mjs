// z22BIP: the original's node code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m6-z22BIP.mjs).
// The functions of the zone (0x706bee .. 0x710400), the C runtime and a few pure engine functions (matrix builders, the path object, the node-list helper) run
// natively from the user's executable; everything else (sound, speech, input, collision sweeps, variables, allocation) is a host function that records its call.
// Nothing of the executable is stored here, only addresses.
import { createGameCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
/** pure engine functions executed natively */
const NATIVE = [
  0x4239d9,                                   // first node of a controller
  0x438890, 0x4388ae,                         // srand / random float
  0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43af16, 0x43ae1e, 0x43cec0,   // matrices, vectors
  0x445660, 0x445680, 0x4458d0, 0x4458f0, 0x445970, 0x447550, 0x446af0, 0x4466f0, 0x447800, 0x4478d0, 0x447280, 0x4456e0, 0x446fd0,   // the path object
];
const f32bits = (f) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, f, true); return d.getUint32(0, true); };

export class BipEmu {
  /**
   * @param pe the executable
   * @param spline a BipSpline (points are copied into the emulated path object)
   * @param recs [{ name, x, y, z, ctrl?: { node: number } }] the record array (record i at RECORDS_BASE + i * 0x68)
   */
  constructor(pe, spline, recs) {
    const cpu = (this.cpu = createGameCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.vars = new Map();
    this.log = [];                 // { fn, args }
    this.buttons = 0;
    this.sweep = () => 0;          // (rec, from[3], delta[3]) -> record index or -1
    this.tick = 0;
    const L = this;
    // ---- records
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      const m = r.m ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, r.x ?? 0, r.y ?? 0, r.z ?? 0, 1];
      m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w16(a + 0x60, 2);
    });
    // ---- hosts
    const H = cpu.hooks;
    const rec = (name, fn) => H.set(fn, (c) => { L.log.push({ name, args: [c.arg(0), c.arg(1), c.arg(2), c.arg(3)] }); c.eax = 0; });
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = L.vars.get(c.arg(0)) ?? 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); L.log.push({ name: 'setVar', args: [c.arg(0), c.arg(1) | 0] }); c.eax = 0; });
    H.set(0x4376f9, (c) => { const b = c.arg(1); mem.w32(b, L.buttons); mem.w32(b + 4, 0); mem.w32(b + 8, 0); c.eax = L.buttons; });
    H.set(0x435c91, (c) => { c.eax = Math.trunc((L.tc ?? L.tick) * 1000 / 30); });   // GetTickCount - start: `tc` = the world's tick count
    H.set(0x441270, (c) => {
      const from = [0, 1, 2].map((k) => mem.f32(c.arg(1) + 4 * k)), delta = [0, 1, 2].map((k) => mem.f32(c.arg(2) + 4 * k));
      const i = L.sweep(c.arg(0), from, delta);
      L.log.push({ name: 'sweep', args: [c.arg(0), ...from, ...delta, i] });
      c.eax = i >= 0 ? RECORDS_BASE + i * REC : 0;
    });
    H.set(0x439bf8, (c) => { L.log.push({ name: 'speech', args: [pe.cstr(c.arg(1))] }); mem.w32(c.arg(2), 1); c.eax = 0; });
    H.set(0x435a11, (c) => { c.eax = 0; });
    // FUN_00890290: _strnicmp(a, b, n)
    H.set(0x890290, (c) => {
      let r = 0;
      for (let k = 0; k < c.arg(2); k++) {
        let x = mem.r8(c.arg(0) + k), y = mem.r8(c.arg(1) + k);
        if (x === 0 || y === 0) break;
        if (x > 0x40 && x < 0x5b) x += 0x20; if (y > 0x40 && y < 0x5b) y += 0x20;
        if (x !== y) { r = x < y ? -1 : 1; break; }
      }
      c.eax = r;
    });
    for (const [fn, nm] of [[0x4435a0, 'play'], [0x4435b0, 'stop'], [0x4434b0, 'stop3d'], [0x443600, 'rate'], [0x442a20, 'particle'], [0x442a40, 'particle2'], [0x422b50, 'camInit'], [0x43b6a3, 'animStart'], [0x444480, 'drawRec'], [0x4440d0, 'drawScale'], [0x444500, 'underwater'], [0x43f1a0, 'drawMesh']]) rec(nm, fn);
    H.set(0x4433f0, (c) => { L.log.push({ name: 'play3d', args: [c.arg(0), ...[0, 1, 2].map((k) => mem.f32(c.arg(1) + 4 * k))] }); c.eax = 0; });
    H.set(0x43b76a, (c) => { c.eax = 0; });
    H.set(0x85ac00, (c) => { c.eax = 0; });      // sprintf of a debug string (csplane)
    cpu.exec = [[0x706bee, 0x710400], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.log.push({ name: `unhooked_${addr.toString(16)}`, args: [] }); c.eax = 0; };
    // ---- the path object (FUN_00445340's wrapper + curve): DAT_009e586c = array of wrappers, handle 0 in DAT_05d5cc14 / DAT_05cb58a8
    const n = spline.n;
    const ptsP = this.alloc(n * 12);
    for (let i = 0; i < n * 3; i++) mem.wf32(ptsP + i * 4, spline.pts[i]);
    const curve = this.alloc(0x30);
    mem.w32(curve, 0x892268); mem.w32(curve + 8, n); mem.w32(curve + 0x14, n); mem.w32(curve + 0x18, ptsP);
    cpu.regs[1] = curve; cpu.call(0x447280, []);
    const wrapper = this.alloc(0x28); mem.w32(wrapper + 0x24, curve);
    const table = this.alloc(4); mem.w32(table, wrapper);
    mem.w32(0x9e586c, table); mem.w32(0x9e5870, 1);
    mem.w32(0x5d5cc14, 0); mem.w32(0x5cb58a8, 0);
    this.curve = curve;
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  /** a controller whose first node is `node` (record + 0x5c) */
  setNode(recIndex, node) { const c = this.alloc(0x40); this.cpu.mem.w32(c, node); this.cpu.mem.w32(this.recPtr(recIndex) + 0x5c, c); return c; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }
  /** the flight node: FUN_0070b7b2 as the original calls it (record, argument block {mesh, model}, new node, var 0xfa, mask 2, value 2) */
  makePlane(recIndex) {
    const arg = this.alloc(16);
    this.cpu.mem.w32(arg, 0x1111); this.cpu.mem.w32(arg + 4, 0x2222);
    this.cpu.call(0x70b7b2, [this.recPtr(recIndex), arg, 0, 0xfa, 2, 2]);
    this.plane = this.cpu.mem.u32(0x5d5d040);
    return this.plane;
  }
  /** one tick of the flight node's update: FUN_00709fac(record, node) */
  flightTick(recIndex) { this.tick++; this.cpu.steps = 0; return this.cpu.call(0x709fac, [this.recPtr(recIndex), this.plane], { maxSteps: 5_000_000 }); }
}

// ---- files and nodes: the constructors of Takeoff / Landing / the rope targets read `.SRC` files through the engine's file functions
BipEmu.prototype.hostFiles = function (files) {
  // files: Map(lowercase file name -> Uint8Array); FUN_00435843(path, mode, source, line) opens, FUN_00435350(dst, size, count, handle) reads, FUN_004358e9 closes
  const L = this, mem = this.cpu.mem, H = this.cpu.hooks;
  const open = new Map();
  let next = 0x30000000;
  H.set(0x435843, (c) => {
    const name = mem.cstr(c.arg(0)).split(/[\\/]/).pop().toLowerCase();
    const data = files.get(name);
    if (!data) { c.eax = 0; return; }
    open.set(next, { data, pos: 0 }); c.eax = next; next += 4;
  });
  H.set(0x435350, (c) => {
    const f = open.get(c.arg(3)); const n = c.arg(1) * c.arg(2);
    if (!f) { c.eax = 0; return; }
    for (let i = 0; i < n; i++) mem.w8(c.arg(0) + i, f.data[f.pos + i] ?? 0);
    f.pos += n; c.eax = c.arg(2);
  });
  H.set(0x4358e9, (c) => { open.delete(c.arg(0)); c.eax = 0; });
  void L;
};
/** an argument block of 32-bit words (strings are written to the heap and replaced by their address) */
BipEmu.prototype.block = function (words) {
  const mem = this.cpu.mem;
  const p = this.alloc(Math.max(16, words.length * 4));
  words.forEach((w, i) => {
    if (typeof w === 'string') { const sp = this.alloc(w.length + 1); for (let k = 0; k < w.length; k++) mem.w8(sp + k, w.charCodeAt(k)); mem.w8(sp + w.length, 0); mem.w32(p + 4 * i, sp); }
    else mem.w32(p + 4 * i, w >>> 0);
  });
  return p;
};
/** run a node constructor (record, argument block, node 0, var, mask, value) on a record; returns the node pointer */
BipEmu.prototype.construct = function (ctor, recIndex, arg, gate) {
  const [v, m, val] = gate ?? [2, 1, 1];
  return this.cpu.call(ctor, [this.recPtr(recIndex), arg, 0, v, m, val]);
};
/** a controller of record `recIndex` whose node list is [nodes...] (each node's +0x10 points to the next; the controller's first word is the first node) */
BipEmu.prototype.chain = function (recIndex, nodes) {
  const mem = this.cpu.mem;
  const c = this.alloc(0x40); mem.w32(c, nodes[0]);
  nodes.forEach((n, i) => mem.w32(n + 0x10, nodes[i + 1] ?? 0));
  mem.w32(this.recPtr(recIndex) + 0x5c, c);
  return c;
};
export { f32bits };

// ---- animation instances: the clip / frame functions of the engine (FUN_0043b6a3 start, 0043b76a advance, 0043b73f frame, 0043b753 length, 0043b64d seek) are hosted
// with the port's AnimInstance (src/game/anim.ts): `anims` maps the animation pointer of a record (record + 8) to an instance
BipEmu.prototype.hostAnims = function () {
  const L = this, mem = this.cpu.mem, H = this.cpu.hooks;
  this.anims = new Map();
  const inst = (c) => L.anims.get(c.arg(0));
  H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
  H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
  H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
  H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
  H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
  void mem;
};
/** give record `recIndex` an animation (a pointer of its own in the record's +8 field) */
BipEmu.prototype.setAnim = function (recIndex, instance) {
  const p = this.alloc(16);
  this.cpu.mem.w32(this.recPtr(recIndex) + 8, p);
  this.anims.set(p, instance);
  return p;
};
