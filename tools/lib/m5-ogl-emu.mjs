// M5 / z40OGL oracle: the ORIGINAL's PeppSwit.c code (the seven constructors 0x7e4f9c 0x7e539e 0x7e5ea7 0x7e61e9 0x7e6498 0x7e69a2 0x7e6bb2, their update / pre-render / draw handlers and the node
// framework's passes FUN_0042226e / FUN_004225c5 / FUN_0042271b) runs in the x86 interpreter (src/formats/x86emu.ts) next to the port, tick by tick, on the same buttons
// (the technique of tools/lib/m7-isl-veh-emu.mjs, which this builds on). Native: the framework (0x422000 ..), the zone code of z40OGL (0x7e2000 .. 0x7e9000), the shared hub code
// of the decor / look machinery (0x41fd00 .. 0x421500, 0x811000 .. 0x811700), the matrix helpers. Hosted (not the subject): the allocator (debug heap: 0xCD filled), game variables, sounds
// (logged with the sound id behind the handle token), collision (the port's CollisionWorld over a mirror of the original's records), the animation instances (the port's AnimInstance), render calls.
// The memory is seeded with the pages the emulated set-up left (src/formats/emusetup.ts: the zone's sound handle globals, the waypoint maps, the dictionaries).
import { IslEmu, RECORDS_BASE, REC, fr, VAR_ARRAY, VAR_COUNT } from './m7-isl-veh-emu.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';
import { waypoints } from '../../src/game/walker.ts';
import { loadOgl } from './m5-ogl-load.mjs';
import { loadExe } from './engine-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { decorStore } from '../../src/island/decor.ts';

export { RECORDS_BASE, REC, fr, VAR_ARRAY, VAR_COUNT };
export const OGL_EXEC = [[0x7e2000, 0x7e9000], [0x811000, 0x811700], [0x41fd00, 0x421500], [0x461000, 0x466600]];
export const CTORS = { PEPPSWIT: 0x7e4f9c, VOID: 0x7e539e, SLUG: 0x7e5ea7, ROBOT: 0x7e61e9, STAR: 0x7e6498, CITIZEN: 0x7e69a2, HOLO: 0x7e6bb2 };
export const B = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80, ENTER: 0x10000 };
export const KEYS = { [B.LEFT]: 'ArrowLeft', [B.RIGHT]: 'ArrowRight', [B.UP]: 'ArrowUp', [B.DOWN]: 'ArrowDown', [B.CTRL]: 'ControlLeft', [B.ALT]: 'AltLeft', [B.SHIFT]: 'ShiftLeft', [B.SPACE]: 'Space', [B.ENTER]: 'Enter' };

/** a small deterministic generator in [0, 1) (the same sequence feeds the original's rand() and the port's injected source) */
export class Lcg {
  constructor(seed) { this.s = seed >>> 0; this.n = 0; }
  next() { this.n++; this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
}

export class OglEmu extends IslEmu {
  /** @param H a loadOgl world (the ORACLE world: collision mirror, animation instances, the set-up's memory) */
  constructor(pe, H, o) {
    super(pe, { world: H.world, pepper: H.pepper, vars: H.vars, profile: { island: H.emu } }, o);
    const cpu = this.cpu, mem = cpu.mem;
    cpu.cw = process.env.M5_CW ? Number(process.env.M5_CW) : 0x7f;          // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/rendering.md 13 / FPU precision): every arithmetic result rounds to a float
    cpu.exec.push(...OGL_EXEC);
    for (const a of [0x462be9, 0x4630c0, 0x43cf57, 0x443cb0, 0x442d60, 0x4095a1]) cpu.native.add(a);       // waypoint node position / map loader, the length-returning normalise, the far plane and the fog state getters
    this.H = H;
    // the debug heap: new blocks are filled with 0xCD (the original's allocator is the debug CRT's malloc)
    this.cpu.hooks.set(0x433d38, (c) => { const n = c.arg(0), p = this.alloc(n); for (let i = 0; i < n; i++) mem.w8(p + i, 0xcd); c.eax = p; });
    // the sound handles of the emulated set-up are tokens (0x5a000000 + n): name them by the sound id behind them
    for (const h of H.emu.soundHandles) if (h.kind !== 'music') this.loadId.set(H.emu.mem.r32(h.addr) >>> 0, h.id);
    this.sndLog = [];
    const nm = (h) => this.loadId.has(h) ? `#${this.loadId.get(h)}` : `h${h.toString(16)}`;
    const L = this, hk = this.cpu.hooks, M = mem, lg = (s) => this.log.push(s);
    hk.set(0x4435a0, (c) => { lg(`p2 ${nm(c.arg(0))}`); c.eax = 0; });
    hk.set(0x4435b0, (c) => { lg(`s ${nm(c.arg(0))}`); c.eax = 0; });
    hk.set(0x4434b0, (c) => { lg(`s ${nm(c.arg(0))}`); c.eax = 0; });
    hk.set(0x4433f0, (c) => { const p = c.arg(1); lg(`p3 ${nm(c.arg(0))} ${[0, 1, 2].map((k) => fr(M.f32(p + 4 * k))).join(' ')}`); c.eax = 0; });
    // FUN_00444550(rec, mask, mode): the render mode (the port's ctx.partMode)
    hk.set(0x444550, (c) => { lg(`mode ${(c.arg(0) - RECORDS_BASE) / REC} ${c.arg(1)} ${c.arg(2)}`); c.eax = 0; });
    // FUN_00442d50(on): the fog switch (FUN_00409563 stores DAT_00983e10 after the Direct3D call, which is not modelled)
    hk.set(0x442d50, (c) => { mem.w32(0x983e10, c.arg(0)); c.eax = 0; });
    // FUN_00422b50(camera, matrix, preset): the camera set-up of the original is native (framework range); nothing to host
  }

  /** the original's controller of a record: node pointers in list order */
  nodesOf(rec) {
    const mem = this.cpu.mem, c = mem.r32(this.recPtr(rec) + 0x5c);
    const out = [];
    if (!c) return out;
    for (let p = mem.r32(c); p; p = mem.r32(p + 0x10)) out.push(p);
    return out;
  }
  /** the `ran` mask of a record's controller (c[2]: bit k = the k-th node ran this frame) */
  ranMask(rec) { const c = this.cpu.mem.r32(this.recPtr(rec) + 0x5c); return c ? this.cpu.mem.r32(c + 8) : 0; }
  ctrlDist(rec) { const c = this.cpu.mem.r32(this.recPtr(rec) + 0x5c); return c ? this.cpu.mem.f32(c + 0x18) : 0; }
}

/**
 * The duel: two hub worlds (the port's and the oracle's collision mirror) of the same story node. `o.kinds`: the port node kinds that stay (the others are dropped from the port world),
 * `o.ctors`: the original's constructors attached natively (the emulated set-up's attach list, filtered), `o.records`: (name, index) => bool, the records whose nodes stay.
 */
export class OglDuel {
  constructor(ctx, o = {}) {
    this.o = o;
    this.pe = loadExe(ctx.dataRoot);
    decorStore.blob = null;       // the stored decor is process-wide (the game state): every duel starts from a new game
    this.P = loadOgl(ctx, { node: o.node ?? 64, vars: o.vars });
    this.O = loadOgl(ctx, { node: o.node ?? 64, vars: o.vars });
    const P = this.P, W = P.world;
    this.rngP = new Lcg(o.seed ?? 12345); this.rngO = new Lcg(o.seed ?? 12345);
    setIslandRandom(() => this.rngP.next());
    const kinds = new Set(o.kinds ?? []);
    this.keep = (r) => (o.records ? o.records(r.name, r.index) : true);
    for (const r of W.records) {
      if (!r.ctrl) continue;
      if (!this.keep(r)) { r.ctrl = null; continue; }
      r.ctrl.nodes = r.ctrl.nodes.filter((n) => kinds.has(n.kind));
      if (!r.ctrl.nodes.length) r.ctrl = null;
    }
    // the port world's recording sinks
    this.dt = o.dt ?? 1;
    W.dt = this.dt; W.externalInput = true;
    this.prevHeld = 0;
    this.emu = new OglEmu(this.pe, this.O, { dt: this.dt, rng: { range: (m) => this.rngO.next() * m } });
    const emu = this.emu;
    // FUN_004388ae(max) runs NATIVELY (float32 at the 24-bit x87); only the C runtime's rand() (FUN_0085daf0) is the scripted source shared with the port (`floor(v * 32768)` of the [0, 1) value)
    emu.cpu.exec.push([0x4388ae, 0x4388e7]);
    emu.cpu.hooks.delete(0x4388ae);
    emu.cpu.hooks.set(0x85daf0, (c) => { c.eax = Math.floor(this.rngO.next() * 32768) & 0x7fff; });
    emu.setFocus(this.O.pepper.index);
    const ctors = new Set(o.ctors ?? []);
    // the controllers the set-up gave the records (flags), then the constructors in the set-up's order
    for (const a of this.O.emu.attaches) {
      if (!ctors.has(a.ctor) || !a.hasController) continue;
      const rec = this.O.world.records[a.record];
      if (!this.keep(rec)) continue;
      emu.attach(a);
    }
    // record flag 1 = "in the view frustum" (set by the draw pass; FUN_004201f0 only finds records that have it): every record counts as seen on both sides
    for (const H of [this.P, this.O]) for (const r of H.world.records) r.flags |= 1;
    for (let i = 0; i < this.O.world.records.length; i++) { const a = RECORDS_BASE + i * REC; emu.cpu.mem.w16(a + 0x60, emu.cpu.mem.r16(a + 0x60) | 1); }
    this.t = 0; this.nfail = 0; this.checked = 0; this.failures = o.failures ?? []; this.worst = new Map(); this.label = o.label ?? '';
    // initial camera / frame counter
    for (let k = 0; k < 6; k++) emu.cpu.mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]);
    emu.cpu.mem.w32(0x9da5cc, W.frame);
  }

  fail(msg) { this.nfail++; if (this.failures.length < (this.o.maxFail ?? 40)) this.failures.push(msg); else if (this.failures.length === (this.o.maxFail ?? 40)) this.failures.push('... more failures'); }
  cmp(label, orig, port, tol = 1e-5) {
    this.checked++;
    const d = Math.abs(orig - port);
    if (d > (this.worst.get(label) ?? 0)) this.worst.set(label, d);
    if (!(d <= tol * Math.max(1, Math.abs(orig)))) this.fail(`${this.label} t${this.t} ${label}: original ${orig} port ${port}`);
  }
  eq(label, orig, port) { this.checked++; if (orig !== port) this.fail(`${this.label} t${this.t} ${label}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); }

  /** put a record at a place / yaw in both worlds */
  place(index, x, y, z, ry = 0) {
    for (const H of [this.P, this.O]) { const r = H.world.records[index]; r.setEuler(0, ry, 0, x, y, z); r.rx = 0; r.ry = ry; r.rz = 0; }
    this.emu.putRecord(index, this.O.world.records[index]);
    this.emu.sync();
  }
  setVar(i, v) { this.emu.cpu.mem.w32(VAR_ARRAY + 4 * i, v >>> 0); this.P.world.vars.set(i, v); }
  getVar(i) { return this.P.world.vars.get(i) | 0; }

  /** one tick on both sides with the buttons `held` (bit mask) */
  tick(held = 0) {
    const W = this.P.world;
    const pressed = (held ^ this.prevHeld) & held;
    this.prevHeld = held;
    W.input.held = held; W.input.pressed = pressed; W.input.prevHeld = held & ~pressed;
    this.P.log.length = 0;
    this.olog = this.emu.passes(held, pressed, { draw: false });
    W.tick();
    this.t++;
  }

  // ---- comparisons
  /** a record against the original's memory: matrix, Euler angles, flags */
  rec(i, flagMask = 0xffff, tol = 1e-5) {
    const mem = this.emu.cpu.mem, a = RECORDS_BASE + i * REC, r = this.P.world.records[i];
    for (let k = 0; k < 16; k++) this.cmp(`${r.name}.m[${k}]`, mem.f32(a + 0xc + 4 * k), r.m[k], tol);
    this.cmp(`${r.name}.rx`, mem.f32(a + 0x4c), r.rx, tol); this.cmp(`${r.name}.ry`, mem.f32(a + 0x50), r.ry, tol); this.cmp(`${r.name}.rz`, mem.f32(a + 0x54), r.rz, tol);
    this.eq(`${r.name}.flags`, mem.r16(a + 0x60) & flagMask, r.flags & flagMask);
  }
  anim(i) {
    const r = this.P.world.records[i], o = this.O.world.records[i];
    if (!r.anim || !o.anim) return;
    this.eq(`${r.name}.clip`, o.anim.clip, r.anim.clip);
    this.cmp(`${r.name}.frame`, o.anim.frame, r.anim.frame, 1e-5);
  }
  vars(skip = []) {
    const mem = this.emu.cpu.mem, W = this.P.world.vars;
    for (let i = 3; i < VAR_COUNT; i++) { if (skip.includes(i)) continue; this.eq(`var ${i}`, mem.r32(VAR_ARRAY + 4 * i) | 0, W.get(i) | 0); }
  }
  camera(tol = 1e-5) {
    const mem = this.emu.cpu.mem, c = this.P.world.camera.c;
    for (let k = 0; k < 6; k++) this.cmp(`camera[${k}]`, mem.f32(0x9da5e8 + 4 * k), Math.fround(c[k]), tol);
  }
  globals() {
    const mem = this.emu.cpu.mem, W = this.P.world;
    this.eq('mailbox (DAT_008ae088)', mem.r32(0x8ae088) & 0xff, W.pep.mailbox & 0xff);
    const cur = mem.r32(0x9daa80);
    this.eq('DAT_009daa80', cur ? (cur - RECORDS_BASE) / REC : -1, vehicles(W).current ? vehicles(W).current.index : -1);
    this.eq('DAT_05d58009 (skate reset)', mem.r8(0x5d58009), vehicles(W).skateReset);
    this.eq('frame counter', mem.r32(0x9da5cc), W.frame);
  }
  /**
   * the sound / render-mode calls of this tick, original vs port (`p2 #id`, `p3 #id x y z`, `s #id`, `mode r m n`): the sequence and the ids are exact, the positions of the 3D sounds
   * agree to `tol` (relative; kept as a tolerance only for the sound positions: the sequence and ids are exact)
   */
  calls(tol = 2e-6) {
    const re = /^(p2|p3|s|mode) /;
    // the constructor's own render modes (records 104 .. 121 = the decor templates) are made at the attach in the original and at the first tick in the port: compared in the decor test
    const skip = (l) => { const a = l.split(' '); return a[0] === 'mode' && +a[1] >= 104 && +a[1] <= 121 && a[3] === '1'; };
    const o = this.olog.filter((l) => re.test(l) && !skip(l)), p = this.P.log.filter((l) => re.test(l) && !skip(l));
    this.checked++;
    if (o.length !== p.length) { this.fail(`${this.label} t${this.t} calls: original ${o.join(' | ')} port ${p.join(' | ')}`); return; }
    for (let k = 0; k < o.length; k++) {
      if (o[k] === p[k]) continue;
      const a = o[k].split(' '), b = p[k].split(' ');
      let ok = a.length === b.length && a[0] === 'p3' && a[1] === b[1];
      for (let q = 2; ok && q < a.length; q++) if (!(Math.abs(+a[q] - +b[q]) <= tol * Math.max(1, Math.abs(+a[q])))) ok = false;
      if (!ok) { this.fail(`${this.label} t${this.t} call ${k}: original "${o[k]}" port "${p[k]}"`); return; }
    }
  }
  /** the ran bits of a record's controller */
  ran(i) {
    const r = this.P.world.records[i];
    let mask = 0;
    (r.ctrl?.ran ?? []).forEach((v, k) => { if (v) mask |= 1 << k; });
    this.eq(`${r.name} ran mask`, this.emu.ranMask(i) & 0xffff, mask);
  }
}
