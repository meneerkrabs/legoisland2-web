// WP-VERIFY: the shared base of the whole-zone oracles (tools/lib/m7-z40aPO-emu.mjs, m7-z38PAR-emu.mjs, m7-z39ASB-emu.mjs). One CPU (src/formats/x86emu.ts) runs the original's zone code
// from the user's executable (addresses only are stored here); the engine is a host table:
//   * records at RECORDS_BASE (0x68 bytes each) mirrored from an ORACLE world (the port's loaded scene); a write observer marks the records the original moved (`dirty` for the collision
//     sync, `touched` for the comparison);
//   * dt as a parameter: DAT_008b1718 = dt, DAT_008b171c = 1 / dt;
//   * collision queries (FUN_00441270 sweep, FUN_00441ac0 probe, FUN_00442a70 ground ray / shadow, FUN_00442570 box of a record) answered by the port's `CollisionWorld` over the oracle world
//     whose records are copied from the ORIGINAL's memory before every query (the collision engine is not the subject, the original's state is the truth);
//   * the animation advance (FUN_0043b76a, rate * dt), start / clip / frame by the port's `AnimInstance` (not the subject), Pepper's pose for the pack bone (FUN_0043bc22);
//   * sounds with identity: every FUN_004433b0 / FUN_00443580 load returns a handle of its own, the log names the global FUN_xxx stored it in;
//   * speech (FUN_00439bf8 / FUN_00435a11), game variables, rand (FUN_004388ae), particles (calls logged), sprintf of the HUD.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
export const REC = 0x68;
export const CRT = [0x858d30, 0x873e00];
/** pure engine functions executed natively: matrices / vectors / box-segment test / strncmp is hosted */
export const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43ad29, 0x43af16, 0x43ae1e, 0x43cec0, 0x43cfee, 0x43b022, 0x43a742, 0x43d5ec, 0x43b00b];
const F32 = new Float32Array(1);
export const fr = (v) => { F32[0] = v; return F32[0]; };

export function sprintf(fmt, args) {
  let ai = 0, out = '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    let j = i + 1, zero = false, w = '';
    if (fmt[j] === '0') { zero = true; j++; }
    while (/\d/.test(fmt[j])) w += fmt[j++];
    const t = fmt[j];
    if (t === '%') { out += '%'; i = j; continue; }
    if (t === 'd') { let s = String(args[ai++] | 0); if (w) s = s.padStart(+w, zero ? '0' : ' '); out += s; i = j; continue; }
    throw new Error(`sprintf: unsupported format ${fmt}`);
  }
  return out;
}

export class ZoneEmu {
  /**
   * @param pe the executable
   * @param oracle { records (the oracle world's records), world, anims: Map<recordIndex, AnimInstance>, pepperIndex }
   * @param o { rng: { range(x) }, dt, parts(i), shadow(rec, size, lift) -> 15 floats | null, exec: [[lo, hi]], soundAddr: { name: address }, nodeRecords }
   */
  constructor(pe, oracle, o) {
    const cpu = (this.cpu = createCpu(pe));
    cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the game runs the x87 in 24-bit precision (D3D7; docs/re/engine-m1.md 8.1)
    const mem = cpu.mem;
    const recs = oracle.records;
    this.pe = pe; this.o = o; this.oracle = oracle; this.dt = o.dt; this.nodeRecords = o.nodeRecords ?? {};
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = []; this.fx = [];
    this.ticks = 0;
    this.unhooked = new Map();
    this.speechIds = [];
    this.partBufs = new Map();
    this.nodes = {};
    this.emitters = 0;
    const L = this;
    // ---- records
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => this.putRecord(i, r, true));
    mem.wf32(0x8b1718, o.dt); mem.wf32(0x8b171c, 1 / o.dt);
    this.dirty = new Set(); this.touched = new Set();
    mem.wlo = RECORDS_BASE; mem.whi = RECORDS_BASE + recs.length * REC;
    mem.onWrite = (a) => { const i = ((a - RECORDS_BASE) / REC) | 0; this.dirty.add(i); this.touched.add(i); };
    // ---- animation instances: pointer -> AnimInstance (record + 8)
    this.anims = new Map(); this.animRec = new Map();
    this.animPtr = 0;
    for (const [i, a] of oracle.anims) { const p = this.alloc(16); if (i === oracle.pepperIndex) this.animPtr = p; this.anims.set(p, a); this.animRec.set(p, i); mem.w32(RECORDS_BASE + i * REC + 8, p); }
    // ---- hosts
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    this.vars = new Map();
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) | 0); logf(`setVar ${c.arg(0)} ${c.arg(1) | 0}`); c.eax = 0; });
    // `rng.int()` (the scripted rand(), 0 .. 32767): FUN_004388ae runs natively on top of the hooked FUN_0085daf0; `rng.range(x)` (older callers): FUN_004388ae itself is hooked
    if (L.o.rng.int) H.set(0x85daf0, (c) => { c.eax = L.o.rng.int(); });
    else H.set(0x4388ae, (c) => { c.fpush(L.o.rng.range(c.argf(0))); });
    // sounds: every load gets a handle of its own, named by the global the zone's loader stored it in
    this.loads = []; this.handleName = new Map(); this.loadId = new Map();
    let nh = 0x1000;
    const load = (kind) => (c) => { const h = nh++; L.loads.push({ h, id: c.arg(0), kind }); L.loadId.set(h, c.arg(0)); c.eax = h; };
    H.set(0x4359d5, (c) => { c.eax = 0; });
    H.set(0x4433b0, load('3d')); H.set(0x443580, load('2d'));
    const nm = (h) => L.handleName.get(h) ?? (L.loadId.has(h) ? `#${L.loadId.get(h)}` : `h${h.toString(16)}`);
    H.set(0x4435a0, (c) => { logf(`p2 ${nm(c.arg(0))}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s2 ${nm(c.arg(0))}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${nm(c.arg(0))} ${[0, 1, 2].map((k) => fr(mem.f32(p + 4 * k)))}`); c.eax = 0; });
    H.set(0x4434b0, (c) => { logf(`s3 ${nm(c.arg(0))}`); c.eax = 0; });
    H.set(0x443600, (c) => { logf(`r ${nm(c.arg(0))} ${c.arg(1) | 0}`); c.eax = 0; });
    // speech
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    H.set(0x435b07, (c) => { logf('stop'); c.eax = 0; });
    // particles (only their calls are logged: the port has none)
    H.set(0x4429e0, (c) => { L.fx.push('emit expl'); c.eax = 0x100 + L.emitters++; });
    H.set(0x442960, (c) => { L.fx.push('emit'); c.eax = 0x100 + L.emitters++; });
    H.set(0x4429a0, (c) => { L.fx.push('emit2'); c.eax = 0x100 + L.emitters++; });
    H.set(0x442a50, (c) => { L.fx.push('fx50'); c.eax = 0; });
    H.set(0x442a20, (c) => { L.fx.push(`fx ${c.arg(0) - 0x100} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x442a00, (c) => { L.fx.push(`mat ${c.arg(0) - 0x100}`); c.eax = 0; });
    // animation: FUN_0043b6a3 start, 0043b76a advance (rate * dt), 0043b73f frame, 0043b72b clip, 0043b753 frame count, 0043b64d seek (the port's AnimInstance)
    const inst = (c) => L.anims.get(c.arg(0)) ?? null;
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; logf(`clip ${L.animRec.get(c.arg(0))} ${c.arg(1) | 0}`); });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1), L.dt) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
    // the pose (FUN_0043bc22 / 0043bc58): the port's AnimInstance pose of the current frame (a host choice, see the tests); identity for instances without a rig
    const poseBufs = new Map();
    const poseOf = (ptr) => {
      const a = L.anims.get(ptr);
      let b = poseBufs.get(ptr);
      if (!b) { b = L.alloc(64 * 64); poseBufs.set(ptr, b); for (let i = 0; i < 64; i++) for (let k = 0; k < 4; k++) mem.wf32(b + i * 64 + k * 20, 1); }
      const p = a?.pose(1);
      if (p) for (let i = 0; i < p.length && i < 64 * 16; i++) mem.wf32(b + 4 * i, p[i]);
      return b;
    };
    H.set(0x43bc22, (c) => { c.eax = poseOf(c.arg(0)); });
    H.set(0x43bc58, (c) => { c.eax = poseOf(c.arg(0)) + c.arg(1) * 0x40; });
    // draw-pass services that only matter for the picture
    for (const a of [0x40ccce, 0x40cc4d, 0x43ebe0, 0x444480, 0x44ea60, 0x435c91, 0x4432c0]) H.set(a, (c) => { c.eax = 0; });
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
    // collision (the port's code over the oracle world whose records mirror this memory)
    const vec = (a) => [0, 1, 2].map((k) => mem.f32(a + 4 * k));
    const put3 = (p, v) => { for (let k = 0; k < 3; k++) mem.wf32(p + 4 * k, v[k]); };
    const world = oracle.world;
    // FUN_00441270(rec, &pos, &delta, &normal, &point, mask, radius, skin) -> hit record or 0
    H.set(0x441270, (c) => {
      L.sync();
      const hit = world.col.sweep(recs[(c.arg(0) - RECORDS_BASE) / REC], vec(c.arg(1)), vec(c.arg(2)), c.arg(5), c.argf(6), c.argf(7));
      if (process.env.ZEMU_TRACE) console.log('sweep', recs[(c.arg(0) - RECORDS_BASE) / REC].name, vec(c.arg(1)), vec(c.arg(2)), c.argf(6), hit ? hit.rec.name : '-');
      if (!hit) { c.eax = 0; return; }
      put3(c.arg(3), hit.normal); put3(c.arg(4), hit.point);
      c.eax = RECORDS_BASE + hit.rec.index * REC;
    });
    // FUN_00441ac0(rec, &pos, &delta, &normal, &point, mask): the probe (a ray: radius 0.01, skin 0)
    H.set(0x441ac0, (c) => {
      L.sync();
      const rec = recs[(c.arg(0) - RECORDS_BASE) / REC];
      const hit = world.col.probe ? world.col.probe(rec, vec(c.arg(1)), vec(c.arg(2)), c.arg(5)) : world.col.sweep(rec, vec(c.arg(1)), vec(c.arg(2)), c.arg(5), 0.01, 0);
      if (!hit) { c.eax = 0; return; }
      put3(c.arg(3), hit.normal); put3(c.arg(4), hit.point);
      c.eax = RECORDS_BASE + hit.rec.index * REC;
    });
    // FUN_00442570(rec, &centre, &halfExtents): the collision box of the record (the zone's segment-box tests run natively on it)
    H.set(0x442570, (c) => {
      const rec = recs[(c.arg(0) - RECORDS_BASE) / REC];
      const col = rec.colObj?.col;
      for (let k = 0; k < 3; k++) { mem.wf32(c.arg(1) + 4 * k, col ? col.center[k] : 0); mem.wf32(c.arg(2) + 4 * k, col ? col.halfExtents[k] : 0); }
      c.eax = 0;
    });
    // FUN_00442a70(rec, ground record, size, lift, &points, 0): the ground ray / blob shadow points (the port's computation on the oracle world)
    H.set(0x442a70, (c) => {
      L.sync();
      const pts = L.o.shadow(recs[(c.arg(0) - RECORDS_BASE) / REC], c.argf(2), c.argf(3));
      if (process.env.ZEMU_TRACE) { const r = recs[(c.arg(0) - RECORDS_BASE) / REC]; console.log('ground', r.name, r.x, r.y, r.z, 'arg1', recs[(c.arg(1) - RECORDS_BASE) / REC].name, pts && pts[4]); }
      if (!pts) { c.eax = 0; return; }
      for (let i = 0; i < 15; i++) mem.wf32(c.arg(4) + 4 * i, pts[i]);
      c.eax = 1;
    });
    // sprintf of the HUD text
    H.set(0x85ac00, (c) => {
      const s = sprintf(mem.cstr(c.arg(1)), [c.arg(2), c.arg(3), c.arg(4)]);
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    H.set(0x46055f, (c) => { c.eax = 0; });
    // atan2(y, x): the CRT version loads an 80 bit constant (not modelled by the interpreter): two doubles on the stack, the result in st0
    H.set(0x85d640, (c) => { const sp = c.regs[4]; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
    cpu.exec = [...o.exec, CRT, ...(o.rng.int ? [[0x4388ae, 0x4388e7]] : [])];
    for (const a of [...NATIVE, ...(o.native ?? [])]) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }

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

  /** copy the records the original moved (and their flags) into the oracle world's records before a collision query */
  sync() {
    const mem = this.cpu.mem, recs = this.oracle.records;
    for (const i of this.dirty) {
      const a = RECORDS_BASE + i * REC, r = recs[i];
      for (let k = 0; k < 16; k++) r.m[k] = mem.f32(a + 0xc + 4 * k);
      r.rx = mem.f32(a + 0x4c); r.ry = mem.f32(a + 0x50); r.rz = mem.f32(a + 0x54);
      r.flags = (r.flags & ~0xffff) | mem.r16(a + 0x60);
    }
    this.dirty.clear();
  }

  /** run the zone's sound loader (`addr`) and name the handles by the globals they were stored in (`this.o.soundAddr`) */
  loadSounds(addr) {
    this.cpu.call(addr, []);
    for (const [name, a] of Object.entries(this.o.soundAddr ?? {})) this.handleName.set(this.cpu.mem.r32(a), name);
  }

  /** the node constructor as FUN_00423532 calls it: (record, 0, node 0, var 2, mask 1, value 1) -> the node */
  construct1(rec, ctor) {
    this.cpu.steps = 0;
    const node = this.cpu.call(ctor, [this.recPtr(rec), 0, 0, 2, 1, 1], { maxSteps: 20_000_000 });
    this.cpu.mem.w32(node + 8, 0xfffffffe);
    return node;
  }
  /** the update / draw slots of a node's vtable (FUN_0042226e: `(**(code **)node[1])(record, node, controller, var)`) */
  updateFn(node) { return this.cpu.mem.r32(this.cpu.mem.r32(node + 4)); }
  drawFn(node) { return this.cpu.mem.r32(this.cpu.mem.r32(node + 4) + 12); }
  callNode(rec, node, fn) { this.cpu.steps = 0; this.cpu.call(fn, [this.recPtr(rec), node, 0, 2], { maxSteps: 5_000_000 }); }

  /** run a block of a function from its middle on a prepared frame, until the watch on `stopAt` (the loop's mode blocks); `frame` = [[ebp offset, value]] */
  runBlock(start, stopAt, frame) {
    const cpu = this.cpu, mem = cpu.mem, STOP = { stop: true };
    const ebp = 0x7ff00000 - 0x2000;
    for (let o = -0x180; o < 0; o += 4) mem.w32(ebp + o, 0);
    for (const [o, v] of frame) mem.w32(ebp + o, v);
    cpu.regs[5] = ebp; cpu.regs[4] = ebp - 0x200;
    cpu.watches.set(stopAt, () => { throw STOP; });
    cpu.invalidate();
    cpu.steps = 0;
    try { cpu.call(start, [], { maxSteps: 2_000_000 }); } catch (e) { if (e !== STOP) throw e; }
    cpu.frames.length = 0; cpu.top = 0; cpu.regs[4] = ebp - 0x200;
    cpu.watches.delete(stopAt); cpu.invalidate();
    return ebp;
  }
}
