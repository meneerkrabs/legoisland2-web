// z18MMP (WP-VERIFY, tools/tests/m7-z18MMP-cover.mjs, docs/re/m6/z18MMP.md "Differential test (WP-VERIFY): coverage"): the harness of the m6 differential test
// (tools/lib/m6-z18MMP-emu.mjs: the ORIGINAL update functions of the 12 node kinds run natively in the x86 emulation over one update pass of the 137 records, engine services hosted),
// extended with: dt (DAT_008b1718 / _DAT_008b171c written before every pass, the hosted animation advance uses `world.dt`), a settable GetTickCount (`H.tickMs`: the clock the
// original's mummy-hit sound variant `ftol(FUN_004388ae(tick)) % 3` reads), the rats' ground probe run NATIVELY (FUN_00427014 request + the controller pass FUN_00427233 after the
// update pass, with the ground height FUN_0043cd62 hosted by the port's collision world), a log of the random draws (argument, value), and an instruction-address coverage set
// (`opts.cov`: every executed instruction address of every call).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';
import { REC } from '../../src/zones/z18mmp/consts.ts';
import { RB, NB, CB, AB, MB, NREC, f32, snapshotWorld, restoreWorld } from './m6-z18MMP-emu.mjs';
export { RB, NB, CB, AB, MB, NREC, f32, snapshotWorld, restoreWorld };
const NODE_SIZE = 0x100;
/** the set of executed instruction addresses (a byte map over the .text section: much cheaper than a `Set` for a trace hook that runs per instruction) */
export class CovSet {
  constructor() { this.buf = new Uint8Array(0x600000); }
  add(a) { this.buf[a - 0x400000] = 1; }
  has(a) { return this.buf[a - 0x400000] === 1; }
  merge(o) { for (let i = 0; i < this.buf.length; i++) if (o.buf[i]) this.buf[i] = 1; }
  get size() { let n = 0; for (let i = 0; i < this.buf.length; i++) n += this.buf[i]; return n; }
}
export const UPDATE = { mmpWalk: 0x6a4fd0, mmpCamera: 0x6ac810, mmpMummy: 0x6aa600, mmpKey: 0x6aa070, mmpPage: 0x6a9cc0, mmpRock: 0x6a9930, mmpPillar: 0x6a95d5, mmpDebris: 0x6a9280,
  mmpTorch: 0x6a8cf0, mmpSpider: 0x6a8a40, mmpRat: 0x6a8350, mmpCoffin: 0x6aadf6 };
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const bitsOf = (v) => { F32[0] = v; return U32[0]; };

export function createMmpHarness(ctx, G, opts = {}) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = 0x7f;      // the original runs the x87 in 24-bit precision (Direct3D 7 leaves single precision): every + - * / sqrt rounds to float32
  const mem = cpu.mem;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NODE_SIZE], [CB, NREC * 0x80], [AB, NREC * 0x40], [MB, 0x10000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const rs = G.rs, w = G.w, sh = G.sh;
  const recPtr = (r) => RB + r.index * 0x68;
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const H = { cpu, mem, G, log: [], handles: new Map(), music: new Map(), tokens: new Map(), randCalls: 0, rands: [], sweeps: [], unhooked: new Set(), tickMs: 3, busy: new Set(), cov: opts.cov ?? null, probes: 0 };

  // ---- the logs of the hosted services (comparable with the port's recorder)
  const push = (e) => H.log.push(e);
  const hid = (h) => H.handles.get(h);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  // sound handles: FUN_006a4a60 run natively gives every DAT_05d5bfxx a handle; the hooked loaders hand out numbers that map to the sound id
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '2d' }); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '3d' }); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { const h = hid(c.arg(0)); push(['2d', h?.id]); });
  hook(0x4435b0, (c) => { const h = hid(c.arg(0)); push(['stop2d', h?.id]); });
  hook(0x4433f0, (c) => { const h = hid(c.arg(0)), p = c.arg(1); push(['3d', h?.id, mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), c.arg(0)]); });      // (the handle number is the 6th element)
  hook(0x4434b0, (c) => { const h = hid(c.arg(0)); push(['stop3d', h?.id]); });
  hook(0x4433c0, (c) => { cpu.eax = H.busy.has(c.arg(0)) ? 0 : 1; });      // FUN_004433c0(handle): 1 = idle (the sound is not playing), 0 = busy (H.busy: handle numbers)
  hook(0x4432c0, (c) => { push(['music', H.music.get(c.arg(0))]); });
  hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { const a = H.tokens.get(c.arg(0)), b = c.arg(1) === 0xffffffff ? null : H.tokens.get(c.arg(1)); push(['say', a, b]); });
  hook(0x44ea60, () => {}); hook(0x442a00, () => {}); hook(0x442a50, () => {}); hook(0x442960, () => { cpu.eax = 0; });
  hook(0x444480, () => {});
  hook(0x435c91, () => { cpu.eax = H.tickMs; });      // GetTickCount - base (FUN_00435c91): the original draws ftol(FUN_004388ae(tick)) % 3; with tick = 3 it is the port's int(3)
  // the game variables
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { w.vars.set(c.arg(0), c.arg(1) | 0); });
  hook(0x41761b, (c) => { w.vars.or(c.arg(0), c.arg(1) | 0); });
  hook(0x41766c, (c) => { w.vars.andNot(c.arg(0), c.arg(1) | 0); });
  // random numbers: FUN_004388ae(x) = rand / 32767 * x, from the port's own source (its state is restored before the port runs)
  hook(0x4388ae, (c) => { H.randCalls++; const a = c.argf(0), v = a <= 0 ? 0 : sh.rng.float(a); H.rands.push([a, v]); c.fpush(v); });
  // animation instances: the pointer is AB + record index * 0x40
  const animOf = (ptr) => rs[(ptr - AB) / 0x40].anim;
  hook(0x43b6a3, (c) => { animOf(c.arg(0)).start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), w.dt); });
  hook(0x43b72b, (c) => { c.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  hook(0x43b92a, (c) => { const a = animOf(c.arg(0)); c.eax = a.frameCount < c.argf(1) * w.dt + 1.0 + a.frame ? 2 : 0; });
  // the collision sweep FUN_00441270(ignore, from, delta, outNormal, outPoint, mask, radius, skin) over the port's world
  hook(0x441270, (c) => {
    // the records the nodes before this one in the pass already moved (the mirror in emulated memory is the truth)
    for (const r of rs) { const p = recPtr(r); for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); }
    const ig = recOf(c.arg(0)), f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = w.col.sweep(ig, f, d, c.arg(5), c.argf(6), c.argf(7));
    H.sweeps.push({ ig: ig?.index, f, d, mask: c.arg(5), radius: c.argf(6), skin: c.argf(7), hit: h ? { normal: [...h.normal], point: [...h.point], rec: h.rec.index } : null });
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    c.eax = recPtr(h.rec);
  });
  // atan2(y, x): the CRT version loads an 80 bit constant (not modelled by the interpreter)
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  // the ground height FUN_0043cd62(&pos, 4.0) of the probe pass: the port's collision world (verified by tools/tests/m7-walk-col.mjs; not the subject here)
  hook(0x43cd62, (c) => { const p = c.arg(0); H.probes++; c.fpush(w.col.terrainHeight(mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), c.argf(1))); });
  hook(0x441ac0, () => { throw new Error('z18MMP emu: FUN_00441ac0 (probe sweep) is not expected'); });
  // the controller probe request of the rats (FUN_00427014) and the probe pass FUN_00427233 (run after the update pass, as in the loop FUN_006a26a8) execute natively
  cpu.exec = [[0x6a2000, 0x6ad000], [0x858d30, 0x873e00], [0x42373e, 0x423760], [0x43a4a1, 0x43a8e0], [0x43cec0, 0x43cf57], [0x427014, 0x427070], [0x427233, 0x4277d0]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z18MMP emu: unhooked call to 0x${a.toString(16)}`); };
  cpu.invalidate();
  if (H.cov) { const run0 = cpu.run.bind(cpu), cov = H.cov; cpu.run = (o = {}) => run0({ ...o, trace: (cc, at) => { cov.add(at); o.trace?.(cc, at); } }); }

  // the sound-handle globals of FUN_006a4a60 (run natively: the hooked loaders hand out the handles)
  cpu.call(0x6a4a60, []);
  // the music handles: DAT_05d5bee8 (Z18MMP), 05d5bef4 (Z18MMPPre), 05d5beac (Hotep), 05d5be70 (Z28HAT)
  for (const [a, k] of [[0x5d5bee8, 'Z18MMP'], [0x5d5bef4, 'Z18MMPPre'], [0x5d5beac, 'Hotep'], [0x5d5be70, 'Z28HAT']]) { mem.w32(a, 0x5000 + a); H.music.set(0x5000 + a, k); }
  mem.w32(0x5d5be74, 0x1234);

  // ---- mirrors: records, controllers, nodes, globals, camera, input
  const mirrorRecords = () => {
    for (const r of rs) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, r.colObj ? 1 : 0);
      mem.w32(p + 0x5c, r.ctrl ? CB + r.index * 0x80 : 0);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
      if (r.ctrl) { mem.w32(CB + r.index * 0x80 + 0xc, 6); }
    }
  };
  const readRec = (r) => {
    const p = recPtr(r);
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) };
  };
  const ptrOf = (r) => (r ? recPtr(r) : 0);
  const NODE = {
    mmpWalk: {
      write(n, m, p) { m.w8(p + 0x18, n.cur); m.w8(p + 0x19, n.playing); m.w8(p + 0x1a, n.hold); m.wf32(p + 0x1c, n.vx); m.wf32(p + 0x20, n.vy); m.wf32(p + 0x24, n.vz); m.w8(p + 0x28, n.state); m.w32(p + 0x2c, n.coffinBit); m.w32(p + 0x30, ptrOf(n.hitRec)); m.w32(p + 0x34, ptrOf(n.symRec)); m.w32(p + 0x3c, n.preMusic ? 1 : 0); },
      read(m, p) { return { cur: m.r8(p + 0x18), playing: m.r8(p + 0x19), hold: (m.r8(p + 0x1a) << 24) >> 24, vx: m.f32(p + 0x1c), vy: m.f32(p + 0x20), vz: m.f32(p + 0x24), state: m.r8(p + 0x28), coffinBit: m.u32(p + 0x2c), hit: m.u32(p + 0x30), sym: m.u32(p + 0x34), pre: m.u32(p + 0x3c) }; },
      ts(n) { return { cur: n.cur, playing: n.playing, hold: n.hold, vx: n.vx, vy: n.vy, vz: n.vz, state: n.state, coffinBit: n.coffinBit, hit: ptrOf(n.hitRec), sym: ptrOf(n.symRec), pre: n.preMusic ? 1 : 0 }; },
    },
    mmpCamera: { write() {}, read() { return {}; }, ts() { return {}; } },
    mmpMummy: {
      write(n, m, p) { for (let i = 0; i < 3; i++) { m.wf32(p + 0x18 + 4 * i, n.home[i]); m.wf32(p + 0x24 + 4 * i, n.target[i]); } },
      read(m, p) { return { home: [0, 1, 2].map((i) => m.f32(p + 0x18 + 4 * i)), target: [0, 1, 2].map((i) => m.f32(p + 0x24 + 4 * i)) }; },
      ts(n) { return { home: [...n.home], target: [...n.target] }; },
    },
    mmpKey: {
      write(n, m, p) { for (let i = 0; i < 3; i++) m.wf32(p + 0x18 + 4 * i, n.home[i]); m.w8(p + 0x28, n.doorOpen ? 1 : 0); },
      read(m, p) { return { home: [0, 1, 2].map((i) => m.f32(p + 0x18 + 4 * i)), door: m.r8(p + 0x28) }; },
      ts(n) { return { home: [...n.home], door: n.doorOpen ? 1 : 0 }; },
    },
    mmpPage: { write(n, m, p) { m.w32(p + 0x18, n.started ? 1 : 0); }, read(m, p) { return { started: m.u32(p + 0x18) }; }, ts(n) { return { started: n.started ? 1 : 0 }; } },
    mmpRock: {
      write(n, m, p) { m.wf32(p + 0x18, n.vy); for (let i = 0; i < 3; i++) m.wf32(p + 0x1c + 4 * i, n.home[i]); m.w8(p + 0x28, n.musicStarted ? 1 : 0); },
      read(m, p) { return { vy: m.f32(p + 0x18), home: [0, 1, 2].map((i) => m.f32(p + 0x1c + 4 * i)), music: m.r8(p + 0x28) }; },
      ts(n) { return { vy: n.vy, home: [...n.home], music: n.musicStarted ? 1 : 0 }; },
    },
    mmpPillar: { write(n, m, p) { m.w32(p + 0x18, n.state); }, read(m, p) { return { state: m.u32(p + 0x18) }; }, ts(n) { return { state: n.state }; } },
    mmpDebris: { write() {}, read() { return {}; }, ts() { return {}; } },
    mmpTorch: { write() {}, read() { return {}; }, ts() { return {}; } },
    mmpSpider: { write(n, m, p) { m.w32(p + 0x18, n.state); }, read(m, p) { return { state: m.u32(p + 0x18) }; }, ts(n) { return { state: n.state }; } },
    mmpRat: {
      write(n, m, p) { for (let i = 0; i < 3; i++) m.wf32(p + 0x14 + 4 * i, n.home[i]); m.wf32(p + 0x20, n.turnFor); m.w32(p + 0x24, n.mode); m.wf32(p + 0x28, n.timer); m.w32(p + 0x2c, n.cycles); m.wf32(p + 0x30, n.turn); },
      read(m, p) { return { home: [0, 1, 2].map((i) => m.f32(p + 0x14 + 4 * i)), turnFor: m.f32(p + 0x20), mode: m.r32(p + 0x24), timer: m.f32(p + 0x28), cycles: m.r32(p + 0x2c), turn: m.f32(p + 0x30) }; },
      ts(n) { return { home: [...n.home], turnFor: n.turnFor, mode: n.mode, timer: n.timer, cycles: n.cycles, turn: n.turn }; },
    },
    mmpCoffin: {
      write(n, m, p) { m.w32(p + 0x18, n.bit); m.w32(p + 0x1c, n.partner); m.w8(p + 0x20, n.n); m.w8(p + 0x21, n.counter); m.w8(p + 0x22, n.state); m.wf32(p + 0x24, n.dist); m.w32(p + 0x28, recPtr(rs[REC.COFFIN[n.n]])); },
      read(m, p) { return { bit: m.u32(p + 0x18), partner: m.u32(p + 0x1c), n: m.r8(p + 0x20), counter: m.r8(p + 0x21), state: m.r8(p + 0x22) }; },
      ts(n) { return { bit: n.bit, partner: n.partner, n: n.n, counter: n.counter, state: n.state }; },
    },
  };
  H.NODE = NODE;
  const GL = {
    write() {
      mem.wf32(0x5d5bef0, sh.danger); mem.w32(0x5d5beb0, sh.seconds); mem.w32(0x5d5bff8, sh.stopClock ? 1 : 0); mem.w32(0x5d5beec, sh.warnNext);
      mem.w8(0x5d5be6c, sh.puzzleMusicArmed ? 1 : 0); mem.wf32(0x5d5c008, sh.poof);
      mem.w8(0x5d5bff4, sh.stepWrap ? 1 : 0); mem.w32(0x5d5bffc, sh.stepPhase); mem.w32(0x5d5c000, sh.stepRr);
      for (let n = 0; n < 12; n++) { mem.w32(0x5d5c010 + n * 8, recPtr(rs[REC.MUMMY_OF[n]])); mem.w8(0x5d5c014 + n * 8, sh.track[n]); mem.w8(0x5d5c015 + n * 8, 0); }
    },
    read() {
      return { danger: mem.f32(0x5d5bef0), seconds: mem.r32(0x5d5beb0), stopClock: mem.u32(0x5d5bff8), warn: mem.u32(0x5d5beec), armed: mem.r8(0x5d5be6c), poof: mem.f32(0x5d5c008),
        stepWrap: mem.r8(0x5d5bff4), stepPhase: mem.r32(0x5d5bffc), stepRr: mem.r32(0x5d5c000), track: Array.from({ length: 12 }, (_, n) => mem.r8(0x5d5c014 + n * 8)) };
    },
    ts() {
      return { danger: sh.danger, seconds: sh.seconds, stopClock: sh.stopClock ? 1 : 0, warn: sh.warnNext, armed: sh.puzzleMusicArmed ? 1 : 0, poof: sh.poof, stepWrap: sh.stepWrap ? 1 : 0, stepPhase: sh.stepPhase, stepRr: sh.stepRr, track: [...sh.track] };
    },
  };
  H.GL = GL;
  const camAt = 0x9da5e8;
  const mirrorCamera = () => { for (let i = 0; i < 18; i++) mem.wf32(camAt + 4 * i, w.camera.c[i]); };
  const readCamera = () => Array.from({ length: 18 }, (_, i) => mem.f32(camAt + 4 * i));

  /** one update pass in the original, from the port's current state (the port's own objects change through the hosted services: snapshot / restore around it) */
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
  H.emuPass = (keysHeld) => {
    H.log.length = 0; H.randCalls = 0; H.rands.length = 0; H.sweeps.length = 0;
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);      // DAT_008b1718 = dt, _DAT_008b171c = 1 / dt
    mirrorRecords(); GL.write(); mirrorCamera();
    const held = keysHeld, pressed = keysHeld & ~w.input.held;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x983848, held);
    const focus = rs[REC.PEPPER];
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || !c.enabled) continue;
      const fx = mem.f32(recPtr(focus) + 0x3c), fz = mem.f32(recPtr(focus) + 0x44), rx = mem.f32(recPtr(r) + 0x3c), rz = mem.f32(recPtr(r) + 0x44);
      mem.wf32(CB + r.index * 0x80 + 0x18, f32((rx - fx) * (rx - fx) + (rz - fz) * (rz - fz)));
      for (const n of c.nodes) {
        if (!w.vars.gate(n.var, n.mask, n.value)) continue;
        const addr = UPDATE[n.kind];
        const np = NB + r.index * NODE_SIZE;
        NODE[n.kind].write(n, mem, np);
        cpu.steps = 0;
        try { cpu.call(addr, [recPtr(r), np, CB + r.index * 0x80, w.vars.get(n.var)], { maxSteps: 2000000 }); }
        catch (e) { e.message += ` [record ${r.index} ${r.name} ${n.kind}: m ${Array.from(r.m).map((v) => +v.toFixed(3))} rx/ry/rz ${r.rx} ${r.ry} ${r.rz}]`; throw e; }
        n.__emu = NODE[n.kind].read(mem, np);
        break;
      }
    }
    // the controller probe pass (FUN_00427233(records, count)): the rats' ground probes
    cpu.steps = 0;
    cpu.call(0x427233, [RB, NREC], { maxSteps: 2000000 });
    // the draw pass: the camera node's hook FUN_006ac844(rec, ?, ?, &camera)
    const cam = rs[0].ctrl?.nodes.find((n) => n.kind === 'mmpCamera');
    cpu.steps = 0;
    if (cam) cpu.call(0x6ac844, [recPtr(rs[0]), 0, 0, camAt]);
    return { recs: rs.map(readRec), globals: GL.read(), camera: readCamera(), log: H.log.slice(), rand: H.randCalls };
  };
  H.readNode = (n) => n.__emu;
  H.tsState = () => ({ recs: rs.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff })), globals: GL.ts(), camera: Array.from(w.camera.c) });
  return H;
}


// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// static code map and coverage: every instruction reachable from a function's entry by recursive descent (jcc / jmp targets, jump tables `jmp [table + reg * 4]` read from the
// image while the entries stay inside the function), the function ending at the next function start; `coverage` counts the executed instruction addresses (the emulator's
// trace hook, `opts.cov`) per function

import { decode } from '../../src/formats/x86.ts';

/** the set of instruction addresses of the function at `start` (ending before `end`) and the list of its basic-block leaders */
export function codeMap(pe, start, end) {
  const buf = pe.slice(start, end - start + 16);
  const ins = new Map(), leaders = new Set([start]), work = [start];
  const ret = (i) => i.op === 0xc3 || i.op === 0xc2;
  while (work.length) {
    let a = work.pop();
    while (a >= start && a < end && !ins.has(a)) {
      const i = decode(buf, a - start, a);
      if (!i) break;
      ins.set(a, i);
      const cond = (i.op >= 0x70 && i.op <= 0x7f) || (i.op >= 0x0f80 && i.op <= 0x0f8f) || (i.op >= 0xe0 && i.op <= 0xe3);
      const jmp = i.op === 0xe9 || i.op === 0xeb;
      if (cond || jmp) { if (i.rel >= start && i.rel < end) { leaders.add(i.rel); work.push(i.rel); } if (cond) leaders.add(a + i.len); }
      if (i.op === 0xff && i.mod !== 3 && i.reg === 4 && i.index >= 0 && i.base < 0) {
        for (let t = i.disp >>> 0; ; t += 4) { const v = pe.u32(t); if (v < start || v >= end) break; leaders.add(v); work.push(v); }
        break;
      }
      if (ret(i) || jmp || i.op === 0xcc) break;
      a += i.len;
    }
  }
  return { ins, leaders };
}

/** per function: instructions executed / reachable, and the basic blocks (leaders) never entered */
export function coverage(pe, cov, funcs) {
  const out = [];
  for (const [name, start, end] of funcs) {
    const { ins, leaders } = codeMap(pe, start, end);
    let hit = 0;
    for (const a of ins.keys()) if (cov.has(a)) hit++;
    const missed = [...leaders].filter((a) => ins.has(a) && !cov.has(a)).sort((x, y) => x - y);
    out.push({ name, start, end, total: ins.size, hit, missed });
  }
  return out;
}

/** the functions of the zone that run in an update pass (entry, end = the next function's start) */
export const ZONE_FUNCS = [
  ['walk Pepper FUN_006a4fd0', 0x6a4fd0, 0x6a7f37], ['footsteps FUN_006a7f37', 0x6a7f37, 0x6a8142], ['rat FUN_006a8350', 0x6a8350, 0x6a8827], ['spider FUN_006a8a40', 0x6a8a40, 0x6a8b6b],
  ['torch FUN_006a8cf0', 0x6a8cf0, 0x6a8f24], ['stones FUN_006a9280', 0x6a9280, 0x6a93d7], ['column sound FUN_006a9540', 0x6a9540, 0x6a95d5], ['pillar FUN_006a95d5', 0x6a95d5, 0x6a97b9],
  ['boulder FUN_006a9930', 0x6a9930, 0x6a9bd2], ['page FUN_006a9cc0', 0x6a9cc0, 0x6a9f87], ['key FUN_006aa070', 0x6aa070, 0x6aa4b1], ['mummy FUN_006aa600', 0x6aa600, 0x6aaa86],
  ['coffin sounds FUN_006aad6a / 006aadb0', 0x6aad6a, 0x6aadf6], ['coffin FUN_006aadf6', 0x6aadf6, 0x6abf47], ['coffin lookups FUN_006ac310..006ac699', 0x6ac310, 0x6ac810],
  ['camera FUN_006ac810 / 006ac844', 0x6ac810, 0x6aca97],
];
