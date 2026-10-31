// z22BIP, WP-VERIFY coverage lib (docs/re/m6/z22BIP.md "Differential test (WP-VERIFY): coverage"): scenarios that run the ORIGINAL node code of the zone in the x86 emulator
// (tools/lib/bip-emu.mjs, extended here) next to the TypeScript port at dt = 1 and dt = 0.5, tick by tick, with a coverage counter on the original's branches.
//   - dt is written into DAT_008b1718 / DAT_008b171c of the emulator and into `world.dt` of the port; the hosted animation advance (FUN_0043b76a) takes the same dt.
//   - every engine call the original makes (sounds with the real handles, speech, collision sweeps with all their arguments, particles, draw calls with the matrices)
//     is logged and compared with what the port does.
//   - tolerance 0: every compared float is bit-identical (WP-TIME float32 sweep); the Cmp class still takes a tolerance for experiments.
// Nothing of the executable is stored here, only addresses.
import { pinBipClock } from './bip-clock.mjs';
import fs from 'node:fs';
import { BipEmu, RECORDS_BASE } from './bip-emu.mjs';
import { bipFixture } from './bip-oracle.mjs';
import { AnimInstance } from '../../src/game/anim.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord } from '../../src/game/record.ts';
import { Controller } from '../../src/game/controller.ts';
import { bipRun, SOUNDS, msClock } from '../../src/zones/z22bip/run.ts';
import { PlaneNode, bananaMatrix } from '../../src/zones/z22bip/plane.ts';
import { MonkeyNode, melonMatrix } from '../../src/zones/z22bip/monkey.ts';
import { RopeSlideNode } from '../../src/zones/z22bip/props.ts';
import { B } from '../../src/game/input.ts';

export { bipFixture };
export const REC = 0x68;
const ASM = '/Users/sander/Documents/basdebeer-tools/decomp-le2/LE2.asm.txt';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// small utilities
export function lcg(seed) { let s = seed >>> 0; const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p }; }
export const f32 = Math.fround;
const hex = (n) => '0x' + n.toString(16);

export const COORD = 300;
/** a comparer with explicit tolerances: numbers (relative to max(1, |original|)), exact ints / strings, and counted KNOWN deviations */
export class Cmp {
  constructor(label, tol = 0, floor = 0) { this.label = label; this.tol = tol; this.floor = floor; this.checked = 0; this.fails = []; this.worst = new Map(); this.devs = new Map(); this.failCount = new Map(); }
  bad(t, name, text) {
    const c = (this.failCount.get(name) ?? 0) + 1; this.failCount.set(name, c);
    if (c <= 2 && this.fails.length < 24) this.fails.push(`${this.label}: tick ${t} ${name}: ${text}`);
  }
  /** a coordinate: the error of a position is relative to the size of the world the plane flies in (`COORD` units), not to the value itself (a position near 0 is a difference of large terms) */
  pos(t, name, orig, port, tol = this.tol) { this.num(t, name, orig, port, tol, COORD); }
  num(t, name, orig, port, tol = this.tol, scale = 1) {
    this.checked++;
    if (Number.isNaN(orig) && Number.isNaN(port)) return;
    const d = Math.abs(orig - port), den = Math.max(scale, Math.abs(orig)), rel = d / den;
    if (!(rel <= tol || d <= this.floor)) { this.bad(t, name, `original ${orig} port ${port} (relative ${rel.toExponential(2)} > ${tol}, absolute ${d.toExponential(2)} > ${this.floor})`); return; }
    if (rel > (this.worst.get(name) ?? 0)) this.worst.set(name, rel);
  }
  int(t, name, orig, port) { this.checked++; if (orig !== port) this.bad(t, name, `original ${orig} port ${port}`); }
  eq(t, name, orig, port) { this.checked++; const a = JSON.stringify(orig), b = JSON.stringify(port); if (a !== b) this.bad(t, name, `original ${a} port ${b}`); }
  /** an event list (arrays of [kind, ...numbers]): same kinds, same order, numbers within the tolerance */
  events(t, name, orig, port) {
    const tolOf = (row, k, v) => this.tol * Math.max(1, Math.abs(v));
    this.checked++;
    let where = orig.length === port.length ? '' : `length ${orig.length} vs ${port.length}`;
    for (let i = 0; !where && i < orig.length; i++) {
      const a = orig[i], b = port[i];
      if (a.length !== b.length) { where = `event ${i} (${a[0]}) length`; break; }
      for (let k = 0; k < a.length; k++) {
        if (typeof a[k] === 'number' && typeof b[k] === 'number') { if (!(Math.abs(a[k] - b[k]) <= Math.max(tolOf(a, k, a[k]), this.floor))) { where = `event ${i} (${a[0]}) element ${k}: ${a[k]} vs ${b[k]}`; break; } } else if (a[k] !== b[k]) { where = `event ${i} (${a[0]}) element ${k}: ${a[k]} vs ${b[k]}`; break; }
      }
    }
    if (where) this.bad(t, name, `${where}; original ${JSON.stringify(orig).slice(0, 700)} port ${JSON.stringify(port).slice(0, 700)}`);
  }
  /** a known deviation of the port (counted, with the first tick / values) */
  known(id, t, text) { const d = this.devs.get(id) ?? { n: 0, first: `tick ${t}: ${text}` }; d.n++; this.devs.set(id, d); }
  result() {
    const w = [...this.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
    const notes = [`${this.label}: ${this.checked} checks, worst relative differences ${w || 'none (bit-exact)'} (tolerance: relative ${this.tol} of max(1, |value|) (coordinates: of max(${COORD}, |value|)), or absolute ${this.floor} = 1 ulp of float32 at 500)`];
    for (const [id, d] of this.devs) notes.push(`${this.label}: KNOWN DEVIATION ${id} x${d.n}, first at ${d.first}`);
    return { checked: this.checked, failures: this.fails, notes, devs: this.devs };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// coverage of the original's code: visited instructions per function, and conditional-jump arms (taken / not taken) from the instruction stream
/** the functions of the zone that run in play (address, name); the dead ones of docs/re/m6/z22BIP.md section 2 are not in the list */
export const FUNCTIONS = [
  // [entry, name, end of the function (the next function's entry)]
  [0x70996a, 'fire', 0x709bd0], [0x70988a, 'moveBananas', 0x70996a], [0x709258, 'hitTests', 0x70988a], [0x708e17, 'progress+score', 0x708ed4], [0x7091f6, 'hudSync', 0x709258], [0x709c5f, 'boxProbe', 0x709f7f],
  [0x709fac, 'flightUpdate', 0x70b572], [0x70b58c, 'bananaDraw', 0x70b751], [0x70b7b2, 'flightCtor', 0x70bbeb],
  [0x70c014, 'takeoffUpdate', 0x70c2b4], [0x70bede, 'takeoffCamera', 0x70c014], [0x70c36b, 'takeoffCtor', 0x70c5be],
  [0x70e42c, 'landingUpdate', 0x70e7fc], [0x70e2c5, 'landingSetup', 0x70e42c], [0x70e8b0, 'landingCtor', 0x70ea22],
  [0x70fdc0, 'recoverUpdate', 0x7100b3], [0x710167, 'recoverCtor', 0x7101eb],
  [0x70db60, 'johnnyUpdate', 0x70de49], [0x70df00, 'johnnyCtor', 0x70dfcd],
  [0x70f433, 'monkeyUpdate', 0x70f6d2], [0x70f2be, 'monkeyThrow', 0x70f433], [0x70efc0, 'melons', 0x70f2be], [0x70f6ec, 'monkeyDraw', 0x70fa9a], [0x70fafb, 'monkeyCtor', 0x70fc30],
  [0x70ca17, 'rockUpdate', 0x70cda0], [0x70c998, 'rockNext', 0x70ca17], [0x70c5f0, 'rockSpawn', 0x70c774], [0x70c774, 'stones', 0x70c998], [0x70cdba, 'rockDraw', 0x70cf7a], [0x70cfd8, 'rockCtor', 0x70d0f4],
  [0x70ea60, 'ropeUpdate', 0x70ecb1], [0x70ed68, 'ropeCtor', 0x70ef88], [0x70daa6, 'canCtor', 0x70db2a], [0x70d960, 'canUpdate', 0x70d9f2], [0x70d523, 'crocCtor', 0x70d5b0], [0x70d437, 'crocUpdate', 0x70d46f],
  [0x70d6cc, 'parrotCtor', 0x70d759], [0x70d5e0, 'parrotUpdate', 0x70d618], [0x70d352, 'propCtor', 0x70d407], [0x70d140, 'propUpdate', 0x70d257], [0x70d271, 'propDraw', 0x70d2f4],
  [0x70e1ad, 'riverCtor', 0x70e270], [0x70e010, 'riverUpdate', 0x70e0ba], [0x70e0d4, 'riverDraw', 0x70e14f], [0x70fd0b, 'seabedCtor', 0x70fd85], [0x7102f9, 'pswitchCtor', 0x710400], [0x710220, 'pswitchUpdate', 0x71026a],
];
const CJ = /^(ja|jae|jb|jbe|je|jne|jg|jge|jl|jle|js|jns|jp|jnp|jc|jnc|jo|jno|jecxz)$/;

export class Coverage {
  constructor() {
    this.fns = FUNCTIONS.map(([a, n, e]) => ({ addr: a, name: n, end: e })).sort((a, b) => a.addr - b.addr);
    this.lo = this.fns[0].addr; this.hi = 0x710400;
    this.visited = new Set();
    this.arms = new Map();            // 'A>T' / 'A>N' -> hits
    this.static = null;               // Map(A -> { t, n }) conditional jumps of the functions in the list (from the decompile's listing, when it is there)
    this.prev = 0;
    this.trace = (cpu, at) => {
      if (at >= this.lo && at < this.hi) {
        this.visited.add(at);
        const s = this.static?.get(this.prev);
        if (s) { const key = at === s.t ? `${this.prev}>t` : at === s.n ? `${this.prev}>n` : null; if (key) this.arms.set(key, (this.arms.get(key) ?? 0) + 1); }
        this.prev = at;
      } else this.prev = 0;
    };
  }
  /** read the instruction listing of the functions (optional: only when the decompile's listing exists next to the repository) */
  loadStatic() {
    if (!fs.existsSync(ASM)) return false;
    const buf = fs.readFileSync(ASM);
    const from = buf.indexOf('\n00706bee:');
    if (from < 0) return false;
    const lines = buf.subarray(from + 1, from + 1 + 1400000).toString('latin1').split('\n');
    const ins = [];
    for (const l of lines) {
      const m = /^([0-9a-f]{8}): ([0-9a-f]+)\s+(\S+)\s*(.*)$/.exec(l);
      if (!m) continue;
      const a = parseInt(m[1], 16);
      if (a >= this.hi) break;
      ins.push({ a, len: m[2].length / 2, op: m[3], arg: m[4] });
    }
    this.static = new Map();
    this.insn = new Map();
    for (let i = 0; i < ins.length; i++) {
      this.insn.set(ins[i].a, ins[i].op);
      if (CJ.test(ins[i].op)) { const t = parseInt(ins[i].arg, 16); if (!Number.isNaN(t)) this.static.set(ins[i].a, { t, n: ins[i].a + ins[i].len }); }
    }
    return true;
  }
  fnOf(a) { for (const f of this.fns) if (f.addr <= a && a < f.end) return f; return null; }
  /** per function: visited instructions, and (with the listing) the conditional-jump arms taken / total, and the list of arms never taken */
  report() {
    const per = new Map(this.fns.map((f) => [f.name, { addr: f.addr, n: 0, arms: 0, armsHit: 0, missing: [] }]));
    for (const a of this.visited) { const f = this.fnOf(a); if (f) per.get(f.name).n++; }
    if (this.static) for (const [a, s] of this.static) {
      const f = this.fnOf(a); if (!f) continue; const e = per.get(f.name);
      for (const k of ['t', 'n']) { e.arms++; if (this.arms.has(`${a}>${k}`)) e.armsHit++; else e.missing.push(`${hex(a)}${k === 't' ? '>' + hex(s.t) : ' fall'}`); }
    }
    return per;
  }
  /** the arms never taken (jump address, 'taken' target / 'fall' through) of one function */
  missing(name) { return this.report().get(name)?.missing ?? []; }
  summary() {
    const rep = this.report(); const parts = [];
    let tot = 0, hit = 0;
    for (const [n, e] of rep) { if (!e.n && !e.armsHit) continue; tot += e.arms; hit += e.armsHit; parts.push(this.static ? `${n} ${e.armsHit}/${e.arms}` : `${n} ${e.n}`); }
    return { text: parts.join(', '), tot, hit };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the emulator rig: BipEmu + dt + logs of the engine calls + coverage
const SOUND_BY_ID = new Map(Object.entries(SOUNDS).map(([n, d]) => [d.id, n]));

export class Rig extends BipEmu {
  constructor(pe, spline, specs, dt, cov) {
    super(pe, spline, specs);
    this.dt = dt; this.cov = cov ?? null;
    const cpu = this.cpu, mem = cpu.mem, H = cpu.hooks;
    mem.wf32(0x8b1718, dt); mem.wf32(0x8b171c, 1 / dt);
    this.ev = [];                   // engine calls of the current tick: [kind, ...]
    this.sweepIndex = 0;            // the call number of the current tick
    this.sweepScript = () => -1;    // (tick, k) -> record index or -1
    this.tickNo = 0;
    this.msOf = () => 0;
    // the sound loads of FUN_00708640 return the sound-table id as the handle, so every later play / stop shows which sound it is
    H.set(0x443580, (c) => { c.eax = c.arg(0); });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0); });
    cpu.call(0x708640, []);
    const snd = (kind) => (c) => { this.ev.push([kind, c.arg(0)]); c.eax = 0; };
    H.set(0x4435a0, snd('play')); H.set(0x4435b0, snd('stop')); H.set(0x4434b0, snd('stop3d'));
    H.set(0x443600, (c) => { this.ev.push(['rate', c.arg(0), c.arg(1) | 0]); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); this.ev.push(['at', c.arg(0), ...(p ? [0, 1, 2].map((k) => mem.f32(p + 4 * k)) : [])]); c.eax = 0; });
    H.set(0x439bf8, (c) => { this.ev.push(['say', pe.cstr(c.arg(1))]); mem.w32(c.arg(2), 1); c.eax = 0; });
    H.set(0x442a20, (c) => { this.ev.push(['leaf']); c.eax = 0; });
    H.set(0x442a40, (c) => { c.eax = 0; });
    H.set(0x435c91, (c) => { c.eax = this.msOf(); });
    H.set(0x441270, (c) => {
      const from = [0, 1, 2].map((k) => mem.f32(c.arg(1) + 4 * k)), delta = [0, 1, 2].map((k) => mem.f32(c.arg(2) + 4 * k));
      const ign = (c.arg(0) - RECORDS_BASE) / REC;
      const i = this.sweepScript(this.tickNo, this.sweepIndex++, ign);
      this.ev.push(['sweep', ign, ...from, ...delta, c.arg(5), c.argf(6), c.argf(7)]);
      c.eax = i >= 0 ? RECORDS_BASE + i * REC : 0;
    });
    // draw calls: the mesh draw (FUN_0043f1a0) with its matrix, the draw scale (FUN_004440d0: the matrix the next record draws are scaled by) and the record draw (FUN_00444480)
    this.draws = [];
    this.scaleNow = null;
    H.set(0x43f1a0, (c) => { this.draws.push({ kind: 'mesh', model: c.arg(0), m: Array.from({ length: 16 }, (_, k) => mem.f32(c.arg(1) + 4 * k)), a2: c.arg(2), a3: c.arg(3) }); c.eax = 0; });
    H.set(0x4440d0, (c) => { this.scaleNow = c.arg(0) ? Array.from({ length: 16 }, (_, k) => mem.f32(c.arg(0) + 4 * k)) : null; c.eax = 0; });
    H.set(0x444480, (c) => { const r = (c.arg(0) - RECORDS_BASE) / REC; this.draws.push({ kind: 'rec', rec: r, scale: this.scaleNow, m: Array.from({ length: 16 }, (_, k) => mem.f32(c.arg(0) + 0xc + 4 * k)) }); c.eax = 0; });
    H.set(0x444500, (c) => { this.draws.push({ kind: 'underwater' }); c.eax = 0; });
    this.hostAnimsDt();
    this.log.length = 0; this.ev.length = 0;
  }
  /** hosted animation functions with the port's AnimInstance, the advance with this dt (FUN_0043b76a multiplies the step by DAT_008b1718) */
  hostAnimsDt() {
    const H = this.cpu.hooks;
    this.anims = new Map();
    const inst = (c) => this.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1), this.dt) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
  }
  /** the flight node's constructor, run with the coverage trace (FUN_0070b7b2 as the original calls it: record, argument block {mesh, model}, new node, var 0xfa, mask 2, value 2) */
  makePlane(recIndex) {
    const arg = this.alloc(16);
    this.cpu.mem.w32(arg, 0x1111); this.cpu.mem.w32(arg + 4, 0x2222);
    this.call(0x70b7b2, [this.recPtr(recIndex), arg, 0, 0xfa, 2, 2]);
    this.plane = this.cpu.mem.u32(0x5d5d040);
    return this.plane;
  }
  /** a node constructor (record, argument block, node 0, var, mask, value), run with the coverage trace */
  construct(ctor, recIndex, arg, gate) {
    const [v, m, val] = gate ?? [2, 1, 1];
    return this.call(ctor, [this.recPtr(recIndex), arg, 0, v, m, val]);
  }
  /** a call of an original function with the coverage trace */
  call(fn, args) { this.cpu.steps = 0; this.cov && (this.cov.prev = 0); return this.cpu.call(fn, args, { maxSteps: 8e6, trace: this.cov ? this.cov.trace : undefined }); }
  takeEv() { const e = this.ev; this.ev = []; return e; }
  takeDraws() { const d = this.draws; this.draws = []; return d; }
  w32(a, v) { this.cpu.mem.w32(a, v); }
  wf(a, v) { this.cpu.mem.wf32(a, v); }
  r32(a) { return this.cpu.mem.r32(a); }
  rf(a) { return this.cpu.mem.f32(a); }
  r8(a) { return this.cpu.mem.r8(a); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the port's side
/** a small world of records (names / positions / optional matrices): the same description builds the emulated record array and the port's */
export function makeWorld(specs, dt) {
  const w = new World();
  w.dt = dt;
  pinBipClock(w);
  w.records = specs.map((s, i) => {
    const r = new GameRecord(s.name); r.index = i;
    if (s.m) r.m.set(s.m); else { r.x = s.x ?? 0; r.y = s.y ?? 0; r.z = s.z ?? 0; r.m[0] = r.m[5] = r.m[10] = 1; }
    return r;
  });
  w.col.records = [];
  return w;
}
export const blank = (n) => Array.from({ length: n }, () => ({ name: 'XXXX', x: 0, y: -500, z: 0 }));

/** the port's sound sink: events in the same shape as the emulator's (the ids of the sound table, 2D / 3D stop by the slot's kind) */
export function recordSound(run, ev) {
  run.sound = {
    play: (n) => ev.push(['play', SOUNDS[n].id]),
    at: (n, pos) => ev.push(['at', SOUNDS[n].id, pos[0], pos[1], pos[2]]),
    stop: (n) => ev.push([SOUNDS[n].kind === '3d' ? 'stop3d' : 'stop', SOUNDS[n].id]),
    rate: (n, hz) => ev.push(['rate', SOUNDS[n].id, hz]),
  };
  run.say = (id) => { ev.push(['say', id]); run.said.push(id); return true; };
}
/** the port's collision sweep stand-in: logs the call like the emulator's host and answers from the same script */
export function scriptSweep(w, ev, script, state) {
  w.col.sweep = (ign, from, delta, mask, rad, skin) => {
    const i = script(state.tick, state.k++, ign.index);
    ev.push(['sweep', ign.index, from[0], from[1], from[2], delta[0], delta[1], delta[2], mask, rad, skin]);
    return i >= 0 ? { rec: w.records[i], point: [0, 0, 0], normal: [0, 1, 0], polygon: 0, surface: 0, t: 0 } : null;
  };
}

/** the buttons of the scenarios: seeded segments of 2 .. 24 ticks; `weights` bias the bits */
export function buttonScript(seed, opt = {}) {
  const r = lcg(seed); let left = 0, cur = 0;
  const p = { steer: 0.7, pitch: 0.7, alt: 0.5, shift: 0.18, space: 0.55, extra: 0.1, ...opt };
  return () => {
    if (left-- > 0) return cur;
    left = 2 + r.int(23); cur = 0;
    if (r.chance(p.steer)) cur |= r.pick([B.LEFT, B.RIGHT, B.LEFT, B.RIGHT, B.LEFT | B.RIGHT]);
    if (r.chance(p.pitch)) cur |= r.pick([B.UP, B.DOWN, B.DOWN, B.UP, B.UP | B.DOWN]);
    if (r.chance(p.alt)) cur |= B.ALT;
    if (r.chance(p.shift)) cur |= B.SHIFT;
    if (r.chance(p.space)) cur |= B.SPACE;
    if (r.chance(p.extra)) cur |= r.pick([B.CTRL, B.KEY1000, B.Z, B.X, B.C, B.ENTER, B.PAD9]);
    return cur;
  };
}
export { bananaMatrix, melonMatrix, msClock, AnimInstance, Controller, PlaneNode, MonkeyNode, RopeSlideNode, bipRun };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the flight node (FUN_00709fac with fire / banana move / hit tests / progress / box probe / draw) against injected states
const PL = { steer: 0x34, pitch: 0x40, thrust: 0x1c, thrustStep: 0x20, brake: 0x28, alt: 0x4c, speed: 0x60, impulse: 0x64, accel: 0x68, fuel: 0x70, heading: 0x7c, rollAngle: 0x84, headRef: 0xa0, headCorr: 0xa4 };
const PLI = { ammo: 0x6c, score: 0x74, pickFlag: 0x98 };
const GL = { clock: 0x5d5d04c, hudAmmo: 0x5d5d048, hudScore: 0x5d5d03c, randIdx: 0x5d5d02c, noAmmoSaid: 0x5d5d050, lowFuelSaid: 0x5d5ceb4 };
const CRASH = { x: 0x5d5d0b0, y: 0x5d5d0b4, z: 0x5d5d0b8, ax: 0x5d5d0c0, ay: 0x5d5d0c4, az: 0x5d5d0c8, headingPath: 0x5d5d0cc, headingNow: 0x5d5d0d0 };
const CASES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 13, 13, 13, 13, 14, 14, 15, 15, 15, 16, 17, 18, 19, 20];
export const IDX = { LAND: 0, DTR1: 70, DTH1: 71, DTR2: 72, DTH2: 73, PEPP: 74, SEPL: 75, FUEL: 76, BANP: 77, BANT: 78, MNK0: 79, MNK1: 80, PALM: 81, FUEL2: 82, BANT2: 83, BANP2: 84, DTR9: 85, XXXX: 86 };

/** one flight scenario: `ticks` ticks at `dt`, random buttons of `seed`, injected states, scripted box-probe hits; returns a Cmp result plus the port's counters */
export function flightScenario(ctx, o) {
  const { dt, seed, ticks, cov, label = `flight dt ${dt} seed ${seed}` } = o;
  const F = bipFixture(ctx), sp = F.spline;
  const rnd = lcg(seed ^ 0x5bd1e995);
  const specs = blank(90);
  const startT = o.startT ?? 0.05;
  const s0 = sp.frame(f32(startT)).m;
  const head0 = f32(Math.atan2(s0[8], s0[10]));
  specs[IDX.LAND] = { name: 'LAND' }; specs[IDX.PEPP] = { name: 'PEPP', x: s0[12], y: 24.5, z: s0[14] }; specs[IDX.SEPL] = { name: 'SEPL' };
  const tpos = (k) => { const m = sp.frame(f32(startT + 0.012 * (k + 1))).m; return [m[12], 30 + 6 * k, m[14]]; };
  const pFUEL = tpos(0), pBANT = tpos(1), pMNK0 = tpos(2), pMNK1 = tpos(3), pDTR1 = tpos(4), pDTR2 = tpos(5), pBANT2 = tpos(6), pDTR9 = tpos(7);
  const place = (i, name, p) => { specs[i] = { name, x: p[0], y: p[1], z: p[2] }; };
  place(IDX.FUEL, 'FUEL', pFUEL); place(IDX.FUEL2, 'FUEL', tpos(8)); place(IDX.BANP, 'BANP', tpos(9)); place(IDX.BANP2, 'BANP', tpos(10)); place(IDX.PALM, 'PALM', tpos(11));
  place(IDX.BANT, 'BANT', pBANT); place(IDX.BANT2, 'BANT', pBANT2);
  place(IDX.MNK0, 'MNK0', pMNK0); place(IDX.MNK1, 'MNK1', pMNK1);
  place(IDX.DTR1, 'DTR1', pDTR1); place(IDX.DTH1, 'DTH1', pDTR1); place(IDX.DTR2, 'DTR2', pDTR2); place(IDX.DTH2, 'DTH2', pDTR2); place(IDX.DTR9, 'DTR9', pDTR9);
  place(IDX.XXXX, 'WALL', [0, 0, 0]);

  // ---- the port
  const w = makeWorld(specs, dt);
  const run = bipRun(w); run.spline = sp;
  const pev = []; recordSound(run, pev);
  const node = new PlaneNode();
  const prec = w.records[IDX.PEPP];
  prec.ctrl = new Controller(); prec.ctrl.attach(node, 0);
  node.init(w);
  const mks = [IDX.MNK0, IDX.MNK1].map((i) => { const m = new MonkeyNode(3, 4); m.state = 1; w.records[i].ctrl = new Controller(); w.records[i].ctrl.attach(m, 0); return m; });
  const ropes = [IDX.DTH1, IDX.DTH2].map((i) => { const r = new RopeSlideNode(); w.records[i].ctrl = new Controller(); w.records[i].ctrl.attach(r, 0); return r; });
  run.johnny = { progress: f32(0.02), ahead: false };
  const sweepState = { tick: 0, k: 0 };
  // scripted box-probe hits: at some ticks the k-th probe of the tick hits a chosen record (the same script drives both sides)
  const hitAt = new Map();
  { const kinds = [IDX.LAND, IDX.FUEL, IDX.FUEL2, IDX.BANP, IDX.BANP2, IDX.PALM, IDX.XXXX, IDX.FUEL, IDX.PALM];
    if (!o.noHits) for (let t = 14 + rnd.int(20); t < ticks; t += 14 + rnd.int(40)) hitAt.set(t, { k: rnd.int(13), rec: rnd.pick(kinds), land: rnd.chance(0.5) }); }
  const script = (t, k, ign) => { const h = hitAt.get(t); if (!h) return -1; if (ign !== IDX.PEPP) return -1; return k === Math.min(h.k, 11) ? h.rec : -1; };
  scriptSweep(w, pev, script, sweepState);
  w.vars.set(0xfa, 2);
  node.speed = 400; node.alt = 24.5; node.heading = head0; node.headRef = head0;

  // ---- the original
  const emu = new Rig(F.pe, sp, specs, dt, cov);
  emu.sweepScript = script;
  const mn = [IDX.MNK0, IDX.MNK1].map((i) => { const a = emu.alloc(0x3a0); emu.cpu.mem.w8(a + 0x39c, 1); emu.setNode(i, a); return a; });
  const dh = [IDX.DTH1, IDX.DTH2].map((i) => { const a = emu.alloc(0x108); emu.setNode(i, a); return a; });
  const J = emu.alloc(0x104); emu.wf(J + 0x28, 0.02); emu.setNode(IDX.SEPL, J);
  const P = emu.makePlane(IDX.PEPP);
  emu.vars.set(0xfa, 2);
  emu.wf(P + 0x60, 400); emu.wf(P + 0x4c, 24.5); emu.wf(P + 0x7c, head0); emu.wf(P + 0xa0, head0);
  emu.log.length = 0; emu.takeEv();
  let msTick = 0;
  emu.msOf = () => Math.trunc(msTick * dt * 1000 / 30);
  const mem = emu.cpu.mem;
  const base = (i) => RECORDS_BASE + i * REC;

  // ---- injection helpers (the same value to both sides)
  const setF = (k, v) => { v = f32(v); node[k] = v; emu.wf(P + PL[k], v); };
  const setI = (k, v) => { node[k] = v; emu.w32(P + PLI[k], v); };
  const setB = (k, v, off) => { node[k] = !!v; mem.w8(P + off, v ? 1 : 0); };
  const putRec = (i, p) => { w.records[i].m[12] = f32(p[0]); w.records[i].m[13] = f32(p[1]); w.records[i].m[14] = f32(p[2]); for (let k = 0; k < 3; k++) emu.wf(base(i) + 0x3c + 4 * k, p[k]); };
  const injectBanana = (p) => {
    const i = node.bananas.findIndex((b) => !b.active); if (i < 0) return;
    const b = node.bananas[i], a = P + 0x118 + i * 0x6c;
    b.active = true; b.born = run.bananaClock; b.x = f32(p[0]); b.y = f32(p[1]); b.z = f32(p[2]); b.vx = b.vy = b.vz = 0; b.sx = b.sy = b.sz = 0; b.ax = b.ay = b.az = 0; b.heading = 0;
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) emu.wf(a + 4 * k, k === 0 || k === 5 || k === 10 ? 1 : 0);
    mem.w8(a + 0x50, 1); emu.w32(a + 0x4c, run.bananaClock); emu.wf(a + 0x30, p[0]); emu.wf(a + 0x34, p[1]); emu.wf(a + 0x38, p[2]);
    for (const k of [0x40, 0x44, 0x48, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68]) emu.w32(a + k, 0);
  };
  const targets = [pFUEL, pBANT, pMNK0, pMNK1, pDTR1, pDTR2, pBANT2, pDTR9];
  const mkNames = ['monkey0', 'monkey1'];
  const st = { ticks: 0, stall: 0, noFuel: 0, lowFuel: 0, alarm: 0, rolling: 0, atEnd: 0, crash: 0, injected: 0, landedResult: 0, modes: new Map(), fire: 0, emptyFire: 0, ahead: 0, hits: 0, wrap: 0 };

  // (formerly tolerance 4e-5: the heading comes from the course frame at progress + 0.01; progress is a float32 (1 ulp = 1.5e-8 .. 3e-8) and the course turns by up to 83 rad per unit of progress (see
  // the spline notes), so an ulp of difference in progress (x87 extended vs the port's doubles) moves the heading by up to 2.5e-6 rad, and the banana directions / matrices built on it; the port is bit-exact now, WP-TIME)
  const cmp = new Cmp(label, o.tol ?? 0);
  for (let i = 0; i < 40; i++) cmp.num(0, 'random table', emu.rf(0x5d5ce14 + 4 * i), run.randTable[i]);
  const buttons = o.buttons ?? buttonScript(seed, o.weights);
  let wait = 0;
  for (let t = 0; t < (o.until ?? ticks); t++) {
    sweepState.tick = t; sweepState.k = 0; emu.tickNo = t; emu.sweepIndex = 0;
    if (o.at?.[t]) o.at[t]({ setF, setI, setB, putRec, injectBanana, node, run, sp, IDX, hitAt, mks, mn, emu, P, mem, J });
    // ---- scheduled injections of states the buttons alone reach rarely
    if (t > 3 && rnd.chance(o.injectRate ?? 0.07)) {
      st.injected++;
      switch (rnd.pick(CASES)) {
        case 0: setF('fuel', rnd.pick([682500, 20 * 6825, 14.9 * 6825, 14 * 6825, 10.2 * 6825, 9.9 * 6825, 5 * 6825, 400, 0, 100 * 6825 * 1.0, 50 * 6825])); break;
        case 1: setF('speed', rnd.pick([400, 330, 321, 320, 319, 12.5, 12, 11, 5, 1.5, 1, 0.5, 0, -3])); break;
        case 2: setI('ammo', rnd.pick([1000, 0, 1, 2, 30])); break;
        case 3: setF('thrust', rnd.pick([0, 100, 160, 323.2, 323.1, 400])); break;
        case 4: if (!node.rolling) { setB('rolling', 1, 0x80); setF('rollAngle', 0); } break;
        case 5: setF('steer', rnd.pick([-3, -2.2, -2.1, 0.3, 0.7, 2.1, 2.3, -0.2, 0.01, -0.01])); break;
        case 6: setF('pitch', rnd.pick([-150, -128, -127, -7, 3, 120, 129, 150, 0.5, -0.5])); break;
        case 7: setF('alt', rnd.pick([-2, 0.3, 3, 50, 95.5, 97, 120])); break;
        case 8: setF('impulse', rnd.pick([-200, -80, -30, 50])); break;
        case 9: { const d = rnd.pick([-1.4, -0.95, -0.5, 0, 0.5, 0.95, 1.4, 3]); setF('heading', node.heading + d); break; }
        case 10: { st.wrap++; setF('headRef', node.headRef + rnd.pick([-6.5, 6.5, -3.3, 3.3, 3.0])); setF('headCorr', rnd.pick([0, 6.2831855, -6.2831855])); break; }
        case 11: { const tt = rnd.pick([0.0, 0.02, 0.3, 0.6, 0.8, 0.9, 0.945, 0.955, 0.965]); const m = sp.frame(f32(tt)).m; putRec(IDX.PEPP, [m[12] + rnd.pick([0, 15, -30]), rnd.pick([24, 60, 10]), m[14] + rnd.pick([0, 12, -20])]); break; }
        case 12: setB('landed', rnd.chance(0.5), 0x9c); setI('score', rnd.pick([0, 99, 2999, 3000, 4999, 5000, 5100, 7050, 9100, 23000])); break;
        case 13: { if (rnd.chance(0.4)) { const v = rnd.pick([37, 38, 39]); run.randIdx = v; emu.w32(GL.randIdx, v); } const p = rnd.pick(targets); const n = 1 + rnd.int(3); for (let i = 0; i < n; i++) { const r = rnd.pick([0.3, 2.5, 4.4, 5.3, 6.1, 9.2, 10.7]); const a1 = rnd.next() * 6.2832, a2 = rnd.next() * 3.1416; injectBanana([p[0] + r * Math.sin(a2) * Math.cos(a1), p[1] + r * Math.sin(a2) * Math.sin(a1), p[2] + r * Math.cos(a2)]); } break; }
        case 14: { mks.forEach((m, k) => { const s = rnd.pick([1, 1, 2, 0, 3]); m.state = s; mem.w8(mn[k] + 0x39c, s); }); break; }
        case 15: ropes.forEach((r, k) => { const h = rnd.pick([0, 1]); r.hit = h; emu.w32(dh[k] + 0x4c, h); }); break;
        case 16: { const v = f32(rnd.next()); run.johnny.progress = v; emu.wf(J + 0x28, v); break; }
        case 17: { for (const i of [IDX.FUEL, IDX.FUEL2, IDX.BANP, IDX.BANP2]) putRec(i, [specs[i].x, specs[i].y, specs[i].z]); break; }
        case 18: { const v = rnd.pick([0, 1]); run.noAmmoSaid = !!v; emu.w32(GL.noAmmoSaid, v); run.lowFuelSaid = !!rnd.pick([0]); emu.w32(GL.lowFuelSaid, 0); break; }
        case 20: { setI('score', rnd.pick([0, 40, 99])); hitAt.set(t + 1, { k: rnd.int(12), rec: IDX.LAND }); break; }
        case 19: { setI('pickFlag', rnd.pick([0, 1])); setF('brake', rnd.pick([0, 0.2, 0.4, 0.39])); break; }
      }
    }
    if (o.pre) o.pre(t, emu);
    const b = buttons();
    emu.buttons = b; w.input.setVirtual(b); w.input.update();
    const gate = w.vars.get(0xfa);
    st.modes.set(gate, (st.modes.get(gate) ?? 0) + 1);
    cmp.int(t, 'var 0xfa', emu.vars.get(0xfa) ?? 0, gate);
    if (gate !== 2) {
      // Recover / Landing are tested in the sequence: wait, then back to flying
      w.tickCount++;
      if (++wait > (gate === 4 ? 30 : 6)) { wait = 0; w.vars.set(0xfa, 2); emu.vars.set(0xfa, 2); }
      continue;
    }
    pev.length = 0; emu.takeEv(); emu.takeDraws();
    const c0 = { ...run.stats }, said0 = run.said.length, leaf0 = run.leafBursts;
    msTick = w.tickCount;
    node.update(w, prec);
    w.tickCount++;
    emu.tick = t + 1;
    // the original reads the control points at index floor(n * (progress + 0.01)) without a lower clamp: a plane far BEFORE the course start (progress < -0.01) makes it read memory in front of the
    // array (undefined behaviour of the original; in the emulator an unmapped address): the scenario ends there, the port cannot be compared
    try { emu.call(0x709fac, [emu.recPtr(IDX.PEPP), P]); } catch (e) { if (/unmapped memory/.test(String(e.message))) { st.originalReadsBeforeCourse = t; break; } throw e; }
    emu.call(0x70b58c, [emu.recPtr(IDX.PEPP), P, 0, 0]);
    st.ticks++;
    if (node.speed <= 12) st.stall++;
    if (node.fuel <= 0) st.noFuel++;
    if (run.hudFuel < 15) st.lowFuel++;
    if (run.hudFuel < 10) st.alarm++;
    if (node.rolling) st.rolling++;
    if (run.spline.atEnd) st.atEnd++;
    if (run.stats.crashes > c0.crashes) st.crash++;
    if (run.johnny.ahead) st.ahead++;
    if (node.landed && run.result) st.landedResult++;
    if (run.leafBursts > leaf0) for (let i = leaf0; i < run.leafBursts; i++) pev.push(['leaf']);
    // ---- compare
    for (const [k, off] of Object.entries(PL)) cmp.num(t, k, emu.rf(P + off), node[k]);
    for (const [k, off] of Object.entries(PLI)) cmp.int(t, k, emu.r32(P + off) | 0, node[k]);
    cmp.int(t, 'rolling', mem.r8(P + 0x80), node.rolling ? 1 : 0); cmp.int(t, 'landed', mem.r8(P + 0x9c), node.landed ? 1 : 0); cmp.int(t, 'muzzle', mem.r8(P + 0xf0c), node.muzzle);
    cmp.int(t, 'wing angles', emu.r32(P + 0x88) | emu.r32(P + 0x8c) | emu.r32(P + 0x90) | emu.r32(P + 0x94), 0);
    for (const [k, a] of Object.entries(GL)) { const e = emu.r32(a) | 0; const p = k === 'clock' ? run.bananaClock : k === 'hudAmmo' ? run.hudAmmo : k === 'hudScore' ? run.hudScore : k === 'randIdx' ? run.randIdx : k === 'noAmmoSaid' ? +run.noAmmoSaid : +run.lowFuelSaid; cmp.int(t, k, k === 'noAmmoSaid' || k === 'lowFuelSaid' ? e & 0xff : e, p); }
    cmp.num(t, 'hudFuel', emu.rf(0x5d5d028), run.hudFuel);
    cmp.int(t, 'riverNear', emu.r8(0x5d5ceb8), run.riverNear ? 1 : 0); cmp.int(t, 'result', emu.r8(0x5d5d044), run.result);
    const bb = base(IDX.PEPP);
    for (let i = 0; i < 3; i++) cmp.pos(t, 'pos' + i, emu.rf(bb + 0x3c + 4 * i), prec.m[12 + i]);
    for (let i = 0; i < 11; i++) if (i % 4 !== 3) cmp.num(t, 'matrix', emu.rf(bb + 0xc + 4 * i), prec.m[i]);
    cmp.num(t, 'rec.ry', emu.rf(bb + 0x50), prec.ry);
    for (let i = 0; i < 6; i++) cmp.pos(t, 'camera', emu.rf(0x9da5e8 + 4 * i), w.camera.c[i]);
    for (let i = 0; i < 30; i++) {
      const a = P + 0x118 + i * 0x6c, bn = node.bananas[i];
      cmp.int(t, 'banana.active', mem.r8(a + 0x50), bn.active ? 1 : 0);
      if (bn.active || mem.r8(a + 0x50)) for (const [k, off] of [['x', 0x30], ['y', 0x34], ['z', 0x38], ['vx', 0x40], ['vy', 0x44], ['vz', 0x48], ['sx', 0x54], ['sy', 0x58], ['sz', 0x5c], ['ax', 0x60], ['ay', 0x64], ['az', 0x68]]) (k.length === 1 && k >= 'x' ? cmp.pos : cmp.num).call(cmp, t, 'banana.' + k, emu.rf(a + off), bn[k]);
      if (bn.active && o.debug && Math.abs(emu.rf(a + 0x30) - bn.x) > 2e-5) o.debug(t, i, [emu.rf(a + 0x30), emu.rf(a + 0x40), emu.r32(a + 0x4c)], [bn.x, bn.vx, bn.born]);
      if (bn.active) { cmp.int(t, 'banana.born', emu.r32(a + 0x4c), bn.born); const hm = f32(Math.cos(bn.heading)); cmp.num(t, 'banana.heading', emu.rf(a), hm); }
    }
    mks.forEach((m, k) => cmp.int(t, mkNames[k] + '.state', mem.r8(mn[k] + 0x39c), m.state));
    ropes.forEach((r, k) => cmp.int(t, `rope${k}.hit`, emu.r32(dh[k] + 0x4c), r.hit));
    cmp.int(t, 'johnny.ahead', emu.r32(J + 0x38), run.johnny.ahead ? 1 : 0);
    for (const i of [IDX.FUEL, IDX.FUEL2, IDX.BANP, IDX.BANP2]) for (let k = 0; k < 3; k++) cmp.pos(t, 'pickup moved', emu.rf(base(i) + 0x3c + 4 * k), w.records[i].m[12 + k]);
    if (run.stats.crashes > c0.crashes) for (const [k, a] of Object.entries(CRASH)) cmp.pos(t, 'crash.' + k, emu.rf(a), run.crash[k]);
    // engine calls: sounds (ids), speech, particles, sweeps with their arguments, in order
    cmp.events(t, 'engine calls', emu.takeEv(), pev.slice());
    // draw: one mesh draw per active banana with its matrix; the plane record itself through the record draw
    const dr = emu.takeDraws(), bm = dr.filter((d) => d.kind === 'mesh'), act = node.bananas.filter((b) => b.active);
    cmp.int(t, 'banana draws', bm.length, act.length);
    for (let i = 0; i < Math.min(bm.length, act.length); i++) { const mm = bananaMatrix(act[i]); for (let k = 0; k < 16; k++) (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, `banana ${i} draw matrix[${k}]`, bm[i].m[k], mm[k]); cmp.int(t, 'banana draw args', bm[i].a3, 1); }
    cmp.int(t, 'plane record draws', dr.filter((d) => d.kind === 'rec' && d.rec === IDX.PEPP).length, 1);
    void said0; void c0;
    if (o.watch) o.watch(t, { node, w, emu, P, mem, run, specs, IDX });
    if (cmp.fails.length) break;
  }
  const res = cmp.result();
  res.stats = { ...st, modes: [...st.modes].map(([k, v]) => `${k}:${v}`).join(' '), score: node.score, run: { ...run.stats } };
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the whole flight: take-off -> flight (a guided pilot) -> a scripted crash -> recovery -> fuel cans -> the end of the course -> landing -> result. The constructors of the
// four nodes and of csplane run natively (they read the `.SRC` files); every tick the nodes of the current mode, Johnny, both records, the camera and every engine call are compared.
import { TakeoffNode, parseSrc } from '../../src/zones/z22bip/takeoff.ts';
import { LandingNode } from '../../src/zones/z22bip/landing.ts';
import { RecoverNode } from '../../src/zones/z22bip/recover.ts';
import { JohnnyNode } from '../../src/zones/z22bip/johnny.ts';

export function sequenceScenario(ctx, o) {
  const { dt, cov, maxTicks = 9000, label = `sequence dt ${dt}` } = o;
  const F = bipFixture(ctx), sp = F.spline;
  const specs = blank(80);
  specs[0] = { name: 'LAND' }; specs[74] = { name: 'PEPP', x: 454.549, y: -36.49, z: 197.63 }; specs[75] = { name: 'SEPL', x: 0, y: -7.5, z: 0 }; specs[76] = { name: 'FUEL' }; specs[77] = { name: 'BANP' }; specs[78] = { name: 'PALM' };
  const emu = new Rig(F.pe, sp, specs, dt, cov);
  emu.hostFiles(new Map([['runwaystart.src', F.file('source/Runwaystart.src')], ['runwayend.src', F.file('source/Runwayend.src')]]));
  const P = emu.makePlane(74);
  const Jn = emu.construct(0x70df00, 75, 0, [2, 1, 1]);
  const Tk = emu.construct(0x70c36b, 74, emu.block(['_Data\\Z22Bip\\Source\\Runwaystart.SRC']), [0xfa, 8, 8]);
  const Ld = emu.construct(0x70e8b0, 74, emu.block(['_Data\\Z22Bip\\Source\\Runwayend.SRC']), [0xfa, 16, 16]);
  const Rc = emu.construct(0x710167, 74, 0, [0xfa, 4, 4]);
  emu.chain(74, [emu.alloc(0x40), P, Rc, Tk, Ld]); emu.chain(75, [Jn]);
  emu.vars.set(0xfa, 8);
  const w = makeWorld(specs, dt);
  const run = bipRun(w); run.spline = sp;
  const pev = []; recordSound(run, pev);
  const walk = new PlaneNode(), tk = new TakeoffNode(), ld = new LandingNode(), rc = new RecoverNode(), jn = new JohnnyNode();
  const pts = (v) => ({ pos0: v[0], rot0: v[1], pos1: v[2], rot1: v[3] });
  tk.src = pts(F.src('Runwaystart.src')); ld.bind(pts(F.src('Runwayend.src')));
  walk.init(w); jn.init(w); run.takeoff = tk;
  w.vars.set(0xfa, 8);
  const prec = w.records[74], jrec = w.records[75];
  const mem = emu.cpu.mem;
  w.camera.c[1] = w.camera.c[4] = 500; emu.wf(0x9da5ec, 500); emu.wf(0x9da5f8, 500);
  const crashAt = Math.round(400 / dt), fuelEvery = Math.round(500 / dt), fuelAt = Math.round(300 / dt);
  const script = (t, k, ign) => (ign !== 74 ? -1 : k !== 0 ? -1 : t === crashAt ? 0 : t % fuelEvery === fuelAt ? 76 : t === Math.round(250 / dt) ? 78 : t === Math.round(700 / dt) ? 77 : -1);
  emu.sweepScript = script;
  const sweepState = { tick: 0, k: 0 };
  scriptSweep(w, pev, script, sweepState);
  emu.msOf = () => 0;
  const cmp = new Cmp(label);
  const f = (a) => emu.rf(a), i32 = (a) => emu.r32(a) | 0;
  const buttons = o.buttons ?? (() => 0);
  const base = RECORDS_BASE + 74 * REC, jb = RECORDS_BASE + 75 * REC;
  const st = { takeoff: 0, fly: 0, recover: 0, landing: 0, approach: 0, slide: 0, postLanding: 0, waiting: 0 };
  const modes = [];
  let t = 0, afterResult = 0, maxAhead = 0, maxAheadLanded = 0;
  for (t = 0; t < maxTicks; t++) {
    sweepState.tick = t; sweepState.k = 0; emu.tickNo = t; emu.sweepIndex = 0;
    let b = 0;
    const gate = w.vars.get(0xfa);
    if (modes[modes.length - 1] !== gate) modes.push(gate);
    if (gate === 2) {
      const t0 = sp.nearest([prec.x, prec.y, prec.z]);
      const tg = sp.sample(Math.min(0.999, t0 + 0.025));
      let e = Math.atan2(tg[0] - prec.x, tg[2] - prec.z) - walk.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      if (e > 0.04) b |= B.RIGHT; else if (e < -0.04) b |= B.LEFT;
      const want = Math.min(90, tg[1] + 14);
      if (walk.alt < want - 4) b |= B.DOWN; else if (walk.alt > want + 4) b |= B.UP;
      if (t % 40 < 12) b |= B.SPACE;
      if (run.hudFuel < 60) b |= B.ALT;
    }
    b |= buttons(t, gate);
    emu.buttons = b; w.input.setVirtual(b); w.input.update();
    pev.length = 0; emu.takeEv(); emu.takeDraws();
    const leaf0 = run.leafBursts;
    const pr = emu.recPtr(74), g = emu.vars.get(0xfa);
    emu.tick = t + 1;
    if (g & 2) { emu.msOf = () => Math.trunc(w.tickCount * dt * 1000 / 30); emu.call(0x709fac, [pr, P]); emu.call(0x70b58c, [pr, P, 0, 0]); } else if (g & 4) emu.call(0x70fdc0, [pr, Rc]); else if (g & 8) emu.call(0x70c014, [pr, Tk]); else if (g & 0x10) emu.call(0x70e42c, [pr, Ld]);
    emu.call(0x70db60, [emu.recPtr(75), Jn]);
    if (gate & 2) {
      const sv = { a: sp.idxA, b: sp.idxB, e: sp.atEnd, p: sp.progress };       // the course position the update uses for its frame: nearest + 0.01 (a probe: the spline's state is put back)
      const ta = sp.nearest([prec.x, prec.y, prec.z]) + 0.01; sp.idxA = sv.a; sp.idxB = sv.b; sp.atEnd = sv.e; sp.progress = sv.p;
      maxAhead = Math.max(maxAhead, ta); if (walk.landed) maxAheadLanded = Math.max(maxAheadLanded, ta);
      st.fly++; walk.update(w, prec);
    } else if (gate & 4) { st.recover++; rc.update(w, prec); } else if (gate & 8) { st.takeoff++; tk.update(w, prec); } else if (gate & 0x10) { st.landing++; if (ld.approach >= 1) st.approach++; else st.slide++; ld.update(w, prec); }
    if (run.leafBursts > leaf0) for (let i = leaf0; i < run.leafBursts; i++) pev.push(['leaf']);
    jn.update(w, jrec);
    w.tickCount++;
    if (walk.landed) st.postLanding++;
    if (jn.waiting) st.waiting++;
    // ---- compare
    cmp.int(t, 'takeoff.state', i32(Tk + 0x18), tk.state); cmp.num(t, 'takeoff.wait', f(Tk + 0x1c), tk.wait); cmp.num(t, 'takeoff.count', f(Tk + 0x20), tk.count);
    cmp.num(t, 'takeoff.progress', f(Tk + 0x2c), tk.progress); cmp.num(t, 'takeoff.climb', f(Tk + 0xc8), tk.climb); cmp.num(t, 'takeoff.climbSpeed', f(Tk + 0xcc), tk.climbSpeed);
    cmp.int(t, 'takeoff.propPhase', i32(Tk + 0xb4), tk.propPhase);
    cmp.num(t, 'johnny.wait', f(Jn + 0x18), jn.wait); cmp.num(t, 'johnny.waiting', f(Jn + 0x1c), jn.waiting); cmp.num(t, 'johnny.bend', f(Jn + 0x20), jn.bend);
    cmp.num(t, 'johnny.roll', f(Jn + 0x24), jn.roll); cmp.num(t, 'johnny.progress', f(Jn + 0x28), jn.progress); cmp.int(t, 'johnny.ahead', i32(Jn + 0x38), jn.ahead ? 1 : 0);
    cmp.int(t, 'landing.phase', i32(Ld + 0x18), ld.phase);
    if (ld.phase) {
      cmp.int(t, 'landing.approach', i32(Ld + 0x1c), ld.approach); cmp.int(t, 'landing.slide', i32(Ld + 0x20), ld.slide);
      for (let k = 0; k < 3; k++) { cmp.num(t, 'landing.v1', f(Ld + 0x58 + 4 * k), ld.v1[k]); cmp.num(t, 'landing.v2', f(Ld + 0x70 + 4 * k), ld.v2[k]); cmp.pos(t, 'landing.pos', f(Ld + 0x64 + 4 * k), ld.pos[k]); }
      cmp.num(t, 'landing.headingApproach', f(Ld + 0x80), ld.headingApproach); cmp.num(t, 'landing.headingSlide', f(Ld + 0x84), ld.headingSlide);
    }
    cmp.int(t, 'recover.phase', i32(Rc + 0x18), rc.phase); cmp.int(t, 'recover.ticks', i32(Rc + 0x34), rc.ticks);
    if (rc.phase) { for (let k = 0; k < 3; k++) { cmp.num(t, 'recover.vel', f(Rc + 0x1c + 4 * k), rc.vel[k]); cmp.pos(t, 'recover.pos', f(Rc + 0x28 + 4 * k), rc.pos[k]); } cmp.num(t, 'recover.turn', f(Rc + 0x3c), rc.turn); }
    for (const [k, off] of Object.entries(PL)) cmp.num(t, 'flight.' + k, f(P + off), walk[k]);
    cmp.int(t, 'flight.score', i32(P + 0x74), walk.score); cmp.int(t, 'flight.ammo', i32(P + 0x6c), walk.ammo); cmp.int(t, 'flight.landed', mem.r8(P + 0x9c), walk.landed ? 1 : 0); cmp.int(t, 'flight.rolling', mem.r8(P + 0x80), walk.rolling ? 1 : 0);
    for (let k = 0; k < 16; k++) { (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'plane matrix', f(base + 0xc + 4 * k), prec.m[k]); (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'johnny matrix', f(jb + 0xc + 4 * k), jrec.m[k]); }
    cmp.num(t, 'rec.ry', f(base + 0x50), prec.ry);
    for (let k = 0; k < 6; k++) cmp.pos(t, 'camera', f(0x9da5e8 + 4 * k), w.camera.c[k]);
    cmp.int(t, 'var 0xfa', emu.vars.get(0xfa) ?? 0, w.vars.get(0xfa)); cmp.int(t, 'result', mem.r8(0x5d5d044), run.result);
    cmp.int(t, 'randIdx', i32(0x5d5d02c), run.randIdx); cmp.int(t, 'bananaClock', i32(0x5d5d04c), run.bananaClock);
    cmp.events(t, 'engine calls', emu.takeEv(), pev.slice());
    const dr = emu.takeDraws(), act = walk.bananas.filter((x) => x.active), bm = dr.filter((d) => d.kind === 'mesh');
    if (g & 2) { cmp.int(t, 'banana draws', bm.length, act.length); for (let i = 0; i < Math.min(bm.length, act.length); i++) { const mm = bananaMatrix(act[i]); for (let k = 0; k < 16; k++) (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, `banana ${i} draw matrix[${k}]`, bm[i].m[k], mm[k]); } }
    if (cmp.fails.length) break;
    if (run.result && ++afterResult > 3) break;
  }
  const res = cmp.result();
  res.stats = { ...st, maxAhead, maxAheadLanded, ticks: t, modes: modes.join('>'), result: run.result, score: walk.score, landed: walk.landed, run: { ...run.stats } };
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// a monkey (FUN_0070f433 update, FUN_0070f2be throw, FUN_0070efc0 melons, FUN_0070f6ec draw) against a plane on a seeded path: wake / sleep, the clips, the three throws per
// loop, the melons, melon hits (a spin-out costs 100 points), banana hits (state 2 -> 3), the draw: the facing of the record, the draw scale, the melon matrices
import { RockyNode, stoneMatrix } from '../../src/zones/z22bip/rocky.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';

/** the port's draw-time step of a monkey record (`MonkeyNode.face`, called by `syncDraw` of the zone) */
const portFace = (mk, w, rec) => mk.face(rec, w.records[74]);

export function monkeyScenario(ctx, o) {
  const { dt, seed, ticks, cov, label = `monkey dt ${dt} seed ${seed}` } = o;
  const F = bipFixture(ctx), sp = F.spline, blk = F.blk('MONK');
  const rnd = lcg(seed ^ 0x2545f491);
  const MK = 30, MK2 = 31;
  const specs = blank(80);
  const m0 = [60, 45, 200];
  specs[74] = { name: 'PEPP', x: 0, y: 40, z: 0 }; specs[MK] = { name: 'MNK4', x: m0[0], y: m0[1], z: m0[2] };
  const emu = new Rig(F.pe, sp, specs, dt, cov);
  const instE = new AnimInstance(blk); emu.setAnim(MK, instE);
  const P = emu.makePlane(74);
  emu.chain(74, [emu.alloc(0x40), P]);
  emu.wf(P + 0x60, 400);
  const Mn = emu.construct(0x70fafb, MK, emu.block([4, 3, 4, 0x1111, 0x2222]), [2, 1, 1]);
  emu.chain(MK, [Mn]);
  const w = makeWorld(specs, dt);
  const run = bipRun(w); run.spline = sp;
  const pev = []; recordSound(run, pev);
  const walk = new PlaneNode(); walk.init(w); walk.speed = 400;
  const mk = new MonkeyNode(3, 4);
  const instT = new AnimInstance(blk);
  w.records[MK].anim = instT; w.records[MK].ctrl = new Controller(); w.records[MK].ctrl.attach(mk, 0);
  w.records[74].ctrl = new Controller(); w.records[74].ctrl.attach(walk, 0);
  const prec = w.records[74], mem = emu.cpu.mem;
  const putPlane = (p) => { prec.m[12] = f32(p[0]); prec.m[13] = f32(p[1]); prec.m[14] = f32(p[2]); const pb = RECORDS_BASE + 74 * REC; for (let k = 0; k < 3; k++) emu.wf(pb + 0x3c + 4 * k, p[k]); };
  const st = { awake: 0, asleep: 0, hitClip: 0, dazed: 0, throws: 0, melons: 0, melonHits: 0, slow: 0, chatter: 0, ticks: 0 };
  const cmp = new Cmp(label);
  const rb = RECORDS_BASE + MK * REC;
  // the path: a seeded random walk around the monkey that crosses the wake box (160 units) now and then
  let pos = o.hover ? [m0[0] + 50, 44, m0[2] - 60] : [m0[0] + 220, 44, m0[2] + 30], vel = [0, 0, 0];
  const planeAt = (t) => {
    if (o.hover) return pos;
    if (t % 40 === 0) {
      const a = rnd.next() * 6.2832, r = rnd.pick([20, 60, 120, 150, 158, 162, 170, 230, 70, 90, 110]); const tgt = [m0[0] + r * Math.sin(a), 30 + rnd.next() * 30, m0[2] + r * Math.cos(a)];
      vel = rnd.chance(0.35) ? [0, 0, 0] : [(tgt[0] - pos[0]) / 40, (tgt[1] - pos[1]) / 40, (tgt[2] - pos[2]) / 40];
    }
    pos = [pos[0] + vel[0], pos[1] + vel[1], pos[2] + vel[2]];
    return pos;
  };
  let prevP = pos.slice();
  const MSC = 2;
  for (let t = 0; t < ticks; t++) {
    // ---- injections (both sides): the plane's speed, its spin-out, a banana hit on the monkey
    if (t % 90 === 5) { const s = rnd.pick([400, 400, 300, 319.9, 320, 330]); walk.speed = f32(s); emu.wf(P + 0x60, s); }
    if (t % 77 === 3) { walk.rolling = false; mem.w8(P + 0x80, 0); }
    if (t % 233 === 100) { walk.rolling = true; mem.w8(P + 0x80, 1); walk.rollAngle = 0; emu.wf(P + 0x84, 0); }
    if (t % 151 === 7) { const v = rnd.pick([0, 36, 37, 38, 39]); run.randIdx = v; emu.w32(0x5d5d02c, v); }       // the table index wraps after 0x27
    if (t % 61 === 11) { const v = rnd.pick([0, 50, 99, 100, 500]); walk.score = v; emu.w32(P + 0x74, v); }      // a spin-out below 100 points clamps the score at 0
    if (t > 20 && rnd.chance(0.012)) { mk.state = 2; mem.w8(Mn + 0x39c, 2); }
    if (t > 20 && rnd.chance(0.006)) { const s = rnd.pick([0, 1, 3]); mk.state = s; mem.w8(Mn + 0x39c, s); }
    if (t % 47 === 20) {                    // a melon that is about to hit the plane (the plane of the previous tick is where the monkey's update looks)
      const i = mk.melons.findIndex((m) => !m.active), a = Mn + 0x28 + i * 0x58;
      if (i >= 0) {
        const ml = mk.melons[i], q = [prevP[0] + 1.5, prevP[1] - 2, prevP[2] + 3];
        ml.active = true; ml.born = mk.clock; ml.x = f32(q[0]); ml.y = f32(q[1]); ml.z = f32(q[2]); ml.vx = ml.vy = ml.vz = 0; ml.spin = 0;
        mem.w8(a + 0x54, 1); emu.w32(a + 0x50, mk.clock); emu.wf(a + 0x30, q[0]); emu.wf(a + 0x34, q[1]); emu.wf(a + 0x38, q[2]); for (const k of [0x40, 0x44, 0x48, 0x4c]) emu.w32(a + k, 0);
        walk.rolling = false; mem.w8(P + 0x80, 0);
        const v = rnd.pick([0, 39, 38, 37, 12]); run.randIdx = v; emu.w32(0x5d5d02c, v);
        const sc = rnd.pick([0, 40, 99, 100, 700]); walk.score = sc; emu.w32(P + 0x74, sc);
      }
    }
    putPlane(prevP);                       // the monkey's update runs before the plane's: it sees the plane of the previous tick
    emu.tickNo = t; emu.tick = t; emu.msOf = () => Math.trunc(t * dt * 1000 / 30);
    pev.length = 0; emu.takeEv(); emu.takeDraws();
    w.tickCount = t;
    emu.call(0x70f433, [emu.recPtr(MK), Mn]);
    mk.update(w, w.records[MK]);
    const cur = planeAt(t);
    putPlane(cur); prevP = cur;
    // the draw: the plane has moved
    emu.call(0x70f6ec, [emu.recPtr(MK), Mn, 0, 0]);
    portFace(mk, w, w.records[MK]);
    st.ticks++;
    if (mk.state === 1) st.awake++; else if (mk.state === 0) st.asleep++; else if (mk.state === 3) st.dazed++; else st.hitClip++;
    if (walk.speed < 320) st.slow++;
    st.melons += mk.melons.filter((m) => m.active).length;
    // ---- compare
    cmp.int(t, 'state', mem.r8(Mn + 0x39c), mk.state); cmp.int(t, 'clock', emu.r32(Mn + 0x398), mk.clock);
    cmp.num(t, 'anim frame', instE.frame, instT.frame); cmp.int(t, 'anim clip', instE.clip, instT.clip);
    for (let i = 0; i < 10; i++) {
      const m = Mn + 0x28 + i * 0x58, ml = mk.melons[i];
      cmp.int(t, 'melon.active', mem.r8(m + 0x54), ml.active ? 1 : 0);
      if (ml.active) {
        cmp.int(t, 'melon.born', emu.r32(m + 0x50), ml.born);
        for (const [k, off] of [['x', 0x30], ['y', 0x34], ['z', 0x38]]) cmp.pos(t, 'melon.' + k, emu.rf(m + off), ml[k]);
        for (const [k, off] of [['vx', 0x40], ['vy', 0x44], ['vz', 0x48], ['spin', 0x4c]]) cmp.num(t, 'melon.' + k, emu.rf(m + off), ml[k]);
      }
    }
    cmp.int(t, 'plane.rolling', mem.r8(P + 0x80), walk.rolling ? 1 : 0); cmp.int(t, 'plane.score', emu.r32(P + 0x74) | 0, walk.score); cmp.int(t, 'randIdx', emu.r32(0x5d5d02c), run.randIdx);
    cmp.events(t, 'engine calls', emu.takeEv(), pev.slice());
    // ---- the draw: the record's facing x the draw scale, the melon matrices
    const dr = emu.takeDraws();
    const sc = dr.find((d) => d.kind === 'rec');
    cmp.int(t, 'monkey record draws', dr.filter((d) => d.kind === 'rec').length, 1);
    if (sc) {
      cmp.eq(t, 'draw scale matrix (2 on the diagonal, 1 at [3][3])', sc.scale, [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
      const S = sc.scale ? [sc.scale[0], sc.scale[5], sc.scale[10]] : [1, 1, 1];
      // the original draws the record's own matrix (unit rows) through the engine's scale: the port bakes the scale into the rotation rows (translation untouched)
      const rm = w.records[MK].m;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cmp.num(t, 'effective draw matrix (record x scale)', sc.m[r * 4 + c] * S[r], rm[r * 4 + c]);
      for (let k = 0; k < 3; k++) cmp.pos(t, 'record position', sc.m[12 + k], rm[12 + k]);
      cmp.num(t, 'port drawScale', S[0], mk.drawScale);
    }
    const mm = dr.filter((d) => d.kind === 'mesh'), act = mk.melons.filter((m) => m.active);
    cmp.int(t, 'melon draws', mm.length, act.length);
    for (let i = 0; i < Math.min(mm.length, act.length); i++) { const e = melonMatrix(act[i]); for (let k = 0; k < 16; k++) (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'melon draw matrix', mm[i].m[k], e[k]); cmp.int(t, 'melon draw flag', mm[i].a3, 0); }
    void rb; void MSC; void MK2;
    if (cmp.fails.length) break;
  }
  st.melonHits = run.stats.melonHits;
  const res = cmp.result(); res.stats = st; return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// a rock monster (FUN_0070ca17 update, FUN_0070c998 next state, FUN_0070c5f0 spawn, FUN_0070c774 stones, FUN_0070cdba draw): the plane at seeded distances (attack / medium / far
// ring), bananas injected near the rock and far from it (the original's distance variable is overwritten by the bananas' distances), scripted sweep results for the stones
// (the wall, the plane, nothing), the draw: the stone matrices x the draw scale of 2
export function rockScenario(ctx, o) {
  const { dt, seed, ticks, cov, label = `rock dt ${dt} seed ${seed}` } = o;
  const F = bipFixture(ctx), sp = F.spline, blk = F.blk('ROCK');
  const rnd = lcg(seed ^ 0x6a09e667);
  const RK = 5, yaw = rnd.pick([0.3, 2.2, -1.1]);
  const specs = blank(200);
  specs[74] = { name: 'PEPP', x: 0, y: 40, z: 0 };
  specs[RK] = { name: 'ROC2', m: Array.from(buildMatrix(0, yaw, 0, 100, 30, 100)) };
  const emu = new Rig(F.pe, sp, specs, dt, cov);
  const instE = new AnimInstance(blk); emu.setAnim(RK, instE);
  const P = emu.makePlane(74);
  emu.chain(74, [emu.alloc(0x40), P]);
  const Rk = emu.construct(0x70cfd8, RK, emu.block([0, 0]), [2, 1, 1]);
  emu.chain(RK, [Rk]);
  const w = makeWorld(specs, dt);
  w.records[RK].m.set(specs[RK].m);
  const run = bipRun(w); run.spline = sp;
  const pev = []; recordSound(run, pev);
  const walk = new PlaneNode(); walk.init(w);
  const instT = new AnimInstance(blk); instT.start(3, 0);
  w.records[RK].anim = instT;
  const rk = new RockyNode(); w.records[RK].ctrl = new Controller(); w.records[RK].ctrl.attach(rk, 0);
  const prec = w.records[74], mem = emu.cpu.mem;
  // the sweep script: stone calls in index order; a hash of (tick, call) picks the plane / the wall / nothing
  const hash = (t, k) => { let h = Math.imul((seed + 1) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(t + 7, 0xc2b2ae35) ^ Math.imul(k + 3, 0x27d4eb2f); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return h >>> 0; };
  const script = (t, k) => { const h = hash(t, k) % 11; return h === 0 ? 74 : h === 1 || h === 2 ? 3 : -1; };
  emu.sweepScript = script;
  const sweepState = { tick: 0, k: 0 }; scriptSweep(w, pev, script, sweepState);
  const putPlane = (p) => { prec.m[12] = f32(p[0]); prec.m[13] = f32(p[1]); prec.m[14] = f32(p[2]); const pb = RECORDS_BASE + 74 * REC; for (let k = 0; k < 3; k++) emu.wf(pb + 0x3c + 4 * k, p[k]); };
  const rpos = [100, 30, 100];
  const st = { near: 0, medium: 0, far: 0, hit: 0, spawned: 0, stones: 0, stoneHits: 0, bananaTicks: 0, ticks: 0 };
  const cmp = new Cmp(label);
  let ring = 150, ringLeft = 0, side = 0;
  const injectBanana = (i, p) => {
    const b = walk.bananas[i], a = P + 0x118 + i * 0x6c;
    b.active = true; b.x = f32(p[0]); b.y = f32(p[1]); b.z = f32(p[2]); b.born = 0;
    mem.w8(a + 0x50, 1); emu.wf(a + 0x30, p[0]); emu.wf(a + 0x34, p[1]); emu.wf(a + 0x38, p[2]);
  };
  const clearBanana = (i) => { walk.bananas[i].active = false; mem.w8(P + 0x118 + i * 0x6c + 0x50, 0); };
  for (let t = 0; t < ticks; t++) {
    if (ringLeft-- <= 0) { ringLeft = 20 + rnd.int(90); ring = rnd.pick([20, 60, 80, 84, 86, 90, 97, 99, 110, 150, 200]); side = rnd.next() * 6.2832; }
    const d = ring, ang = yaw + (side > 3.14 ? 0 : 0.4 * Math.sin(side * 7));
    putPlane([rpos[0] + d * Math.sin(ang), 40 + 8 * Math.sin(t / 9), rpos[2] + d * Math.cos(ang)]);
    // bananas: near the rock (a hit), far (only their distance matters), cleared again
    if (t % 53 === 17 && rnd.chance(0.5)) { const i = rnd.int(30); const r = rnd.pick([2, 5, 7.5, 9, 15, 40]); const a1 = rnd.next() * 6.28; injectBanana(i, [rpos[0] + r * Math.cos(a1), rpos[1] + 2 + rnd.next() * 3, rpos[2] + r * Math.sin(a1)]); }
    if (t % 53 === 30) for (let i = 0; i < 30; i++) if (walk.bananas[i].active) clearBanana(i);
    if (t % 120 === 119) { walk.rolling = false; mem.w8(P + 0x80, 0); }
    if (t % 71 === 5) { const v = rnd.pick([0, 99, 500]); walk.score = v; emu.w32(P + 0x74, v); }
    emu.tc = t; emu.tick = t; emu.tickNo = t; emu.sweepIndex = 0; sweepState.tick = t; sweepState.k = 0; emu.msOf = () => 0;
    w.tickCount = t;
    pev.length = 0; emu.takeEv(); emu.takeDraws();
    emu.call(0x70ca17, [emu.recPtr(RK), Rk]);
    rk.update(w, w.records[RK]);
    emu.call(0x70cdba, [emu.recPtr(RK), Rk, 0, 0]);
    st.ticks++;
    if (rk.state === 1) st.near++; else if (rk.state === 2) st.medium++; else if (rk.state === 3) st.hit++; else st.far++;
    const stoneBase = emu.r32(Rk + 0x30);
    cmp.int(t, 'state', emu.r32(Rk + 0x24), rk.state); cmp.int(t, 'thrown', emu.r32(Rk + 0x34), rk.thrown ? 1 : 0);
    cmp.num(t, 'anim frame', instE.frame, instT.frame); cmp.int(t, 'anim clip', instE.clip, instT.clip);
    for (let i = 0; i < 10; i++) {
      const s = stoneBase + i * 0x3c, ps = rk.stones[i];
      cmp.int(t, 'stone.active', mem.r32(s), ps.active ? 1 : 0);
      if (ps.active) {
        st.stones++;
        cmp.int(t, 'stone.life', mem.r32(s + 0x1c), ps.life);
        for (const [n, off, v] of [['vx', 4, ps.vx], ['vy', 8, ps.vy], ['vz', 0xc, ps.vz]]) cmp.num(t, 'stone.' + n, emu.rf(s + off), v);
        for (const [n, off, v] of [['x', 0x10, ps.x], ['y', 0x14, ps.y], ['z', 0x18, ps.z]]) cmp.pos(t, 'stone.' + n, emu.rf(s + off), v);
        for (const [n, off, v] of [['ax', 0x24, ps.ax], ['ay', 0x28, ps.ay], ['az', 0x2c, ps.az], ['sx', 0x30, ps.sx], ['sy', 0x34, ps.sy], ['sz', 0x38, ps.sz]]) cmp.num(t, 'stone.' + n, emu.rf(s + off), v);
      }
    }
    cmp.int(t, 'plane.rolling', mem.r8(P + 0x80), walk.rolling ? 1 : 0); cmp.int(t, 'plane.score', emu.r32(P + 0x74) | 0, walk.score); cmp.int(t, 'randIdx', emu.r32(0x5d5d02c), run.randIdx);
    cmp.events(t, 'engine calls', emu.takeEv(), pev.slice());
    // the draw: the rock's own record draw, then one mesh draw per active stone: (Euler(angles) at the place) x the scale matrix (2 on the diagonal)
    const dr = emu.takeDraws(), mm = dr.filter((d) => d.kind === 'mesh'), act = rk.stones.filter((s) => s.active);
    cmp.int(t, 'rock record draws', dr.filter((d) => d.kind === 'rec').length, 1);
    cmp.int(t, 'stone draws', mm.length, act.length);
    for (let i = 0; i < Math.min(mm.length, act.length); i++) { const e = stoneMatrix(act[i]); for (let k = 0; k < 16; k++) (k >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'stone draw matrix', mm[i].m[k], e[k]); cmp.int(t, 'stone draw flag', mm[i].a3, 1); }
    if (cmp.fails.length) break;
  }
  st.stoneHits = run.stats.stoneHits;
  const res = cmp.result(); res.stats = st; return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the small nodes: two rope targets (FUN_0070ed68 / FUN_0070ea60, `DTHn.SRC`), a fuel can (FUN_0070daa6 / FUN_0070d960), a crocodile and a parrot (clips 1 / 3, advance by dt), the
// three propellers (FUN_0070d352 / FUN_0070d140 / FUN_0070d271), the river (FUN_0070e1ad / FUN_0070e010 / FUN_0070e0d4: sounds, the texture scroll by dt), the sea bed and PSwitch
import { RopeSlideNode as RopeN, JerryCanNode, AnimPropNode, PropsNode, RiverNode, SeaBedNode, PSwitchNode, RIVER } from '../../src/zones/z22bip/props.ts';

export function propsScenario(ctx, o) {
  const { dt, seed, ticks, cov, label = `props dt ${dt} seed ${seed}` } = o;
  const F = bipFixture(ctx), sp = F.spline;
  const rnd = lcg(seed ^ 0x3c6ef372);
  const specs = blank(120);
  const A1 = 90, B1 = 91, C1 = 92, A2 = 93, B2 = 94, C2 = 95, JC = 96, CR = 97, PA = 98, RV = 99, SB = 100, PS = 101, PR = 76;
  const mats = (i) => Array.from(buildMatrix(0.3 * i, 0.2 + i, 0.1 * i, -165 + i, 85, 70 + i));
  specs[A1] = { name: 'DTH1', x: -165, y: 85, z: 70 }; specs[B1] = { name: 'SLD1', m: mats(1) }; specs[C1] = { name: 'DTR1', m: mats(2) };
  specs[A2] = { name: 'DTH3', x: -160.9, y: 115, z: 956 }; specs[B2] = { name: 'SLD3', m: mats(3) }; specs[C2] = { name: 'DTR3', m: mats(4) };
  specs[JC] = { name: 'FUEL', m: Array.from(buildMatrix(0, 0.5, 0, 10, 20, 30)) }; specs[CR] = { name: 'CRC1' }; specs[PA] = { name: 'PRT1' };
  specs[RV] = { name: 'RIVR' }; specs[SB] = { name: 'SEAB' }; specs[PS] = { name: 'PEPS' }; specs[PR] = { name: 'PROP' };
  specs[74] = { name: 'PEPP', m: Array.from(buildMatrix(0.1, 0.7, 0, 100, 50, 20)) };
  specs[75] = { name: 'SEPL', m: Array.from(buildMatrix(0.0, 2.2, 0.3, -30, 20, 70)) };
  const emu = new Rig(F.pe, sp, specs, dt, cov);
  emu.hostFiles(new Map([['dth1.src', F.file('source/DTH1.src')], ['dth3.src', F.file('source/DTH3.src')]]));
  const scrolls = [];
  emu.cpu.hooks.set(0x43ebe0, (c) => { scrolls.push(emu.rf(c.arg(3))); c.eax = 0; });
  const croc = F.blk('CROC'), prrt = F.blk('PRRT');
  const instC = new AnimInstance(croc), instP = new AnimInstance(prrt);
  emu.setAnim(CR, instC); emu.setAnim(PA, instP);
  const rope = (a, b, c, file) => emu.construct(0x70ed68, a, emu.block([`_Data\\Z22Bip\\Source\\${file}`, 0, 0, 0, 0, 0, 0, 100, 10, emu.recPtr(b), emu.recPtr(c)]), [2, 1, 1]);
  const Rp1 = rope(A1, B1, C1, 'DTH1.SRC'), Rp2 = rope(A2, B2, C2, 'DTH3.SRC');
  emu.chain(A1, [Rp1]); emu.chain(A2, [Rp2]);
  const Jc = emu.construct(0x70daa6, JC, 0, [2, 1, 1]); emu.chain(JC, [Jc]);
  const Ac = emu.construct(0x70d523, CR, 0, [2, 1, 1]); emu.chain(CR, [Ac]);
  const Pa = emu.construct(0x70d6cc, PA, 0, [2, 1, 1]); emu.chain(PA, [Pa]);
  const angles = emu.alloc(36), offsets = emu.alloc(36), owners = emu.alloc(12), pmats = emu.alloc(3 * 64);
  const off = [[0.085, -0.026, 6.795], [-7.375, 2.179, 3.06], [7.392, 2.179, 3.06]];
  off.forEach((p, i) => p.forEach((v, k) => emu.wf(offsets + i * 12 + k * 4, v)));
  [74, 75, 75].forEach((r, i) => emu.w32(owners + i * 4, emu.recPtr(r)));
  const Pp = emu.construct(0x70d352, PR, emu.block([3, angles, offsets, owners, pmats]), [2, 1, 1]); emu.chain(PR, [Pp]);
  const Rv = emu.construct(0x70e1ad, RV, 0, [2, 1, 1]); emu.chain(RV, [Rv]);
  const Sb = emu.construct(0x70fd0b, SB, 0, [2, 1, 1]); emu.chain(SB, [Sb]);
  emu.vars.set(0xfa, 0);
  const Ps = emu.construct(0x7102f9, PS, 0, [2, 1, 1]); emu.chain(PS, [Ps]);
  const cmp = new Cmp(label);
  cmp.int(0, 'PSwitch constructor: variable 0xfa', emu.vars.get(0xfa), 8);
  const sbUpd = F.pe.u32(0x9325b0), psUpd = F.pe.u32(0x932650), rvUpd = F.pe.u32(0x932380);
  cmp.int(0, 'vtable slot 0: sea bed / PSwitch / river update', [sbUpd, psUpd, rvUpd].join(), [0x70fc30, 0x710220, 0x70e010].join());

  // ---- the port
  const w = makeWorld(specs, dt);
  w.records.forEach((r, i) => { if (specs[i].m) r.m.set(specs[i].m); });
  const run = bipRun(w); run.spline = sp;
  const pev = []; recordSound(run, pev);
  const pts = (v) => ({ pos0: v[0], rot0: v[1], pos1: v[2], rot1: v[3] });
  const ropeN = [[A1, B1, C1, 'DTH1.src'], [A2, B2, C2, 'DTH3.src']].map(([a, b, c, f]) => { const r = new RopeN(); r.bind(pts(F.src(f)), w.records[b], w.records[c]); w.records[a].ctrl = new Controller(); w.records[a].ctrl.attach(r, 0); return r; });
  const can = new JerryCanNode(); w.records[JC].ctrl = new Controller(); w.records[JC].ctrl.attach(can, 0);
  const crocN = new AnimPropNode(1), parN = new AnimPropNode(3);
  w.records[CR].anim = new AnimInstance(croc); w.records[CR].ctrl = new Controller(); w.records[CR].ctrl.attach(crocN, 0);
  w.records[PA].anim = new AnimInstance(prrt); w.records[PA].ctrl = new Controller(); w.records[PA].ctrl.attach(parN, 0);
  const pn = new PropsNode(); pn.owners = [74, 75, 75]; pn.offsets = off; pn.angles = [0, 0, 0];
  w.records[PR].ctrl = new Controller(); w.records[PR].ctrl.attach(pn, 0);
  const riv = new RiverNode(); const pscrolls = []; riv.scroll = (_r, dv) => pscrolls.push(dv);
  w.records[RV].ctrl = new Controller(); w.records[RV].ctrl.attach(riv, 0);
  const sb = new SeaBedNode(), ps = new PSwitchNode();
  const mem = emu.cpu.mem;
  const recM = (i, k) => emu.rf(RECORDS_BASE + i * REC + 0xc + 4 * k);
  const st = { ticks: 0, ropeMoving: 0, ropeWaiting: 0, ropeTurning: 0, ropeHits: 0, riverNear: 0, riverFar: 0 };
  for (let t = 0; t < ticks; t++) {
    ropeN.forEach((r, k) => { if (t > 5 && rnd.chance(0.012)) { r.hit = 1; mem.w32((k ? Rp2 : Rp1) + 0x4c, 1); st.ropeHits++; } });
    if (t % 13 === 0) { const v = rnd.pick([0, 1]); run.riverNear = !!v; mem.w8(0x5d5ceb8, v); }
    if (t % 5 === 0) { // the plane and Johnny move (the propellers follow their owners)
      for (const [i, m] of [[74, buildMatrix(0.1 * rnd.next(), 6 * rnd.next(), 0.3 * rnd.next(), 300 * rnd.next(), 60 * rnd.next(), 300 * rnd.next())], [75, buildMatrix(0.2 * rnd.next(), 6 * rnd.next(), 0.2 * rnd.next(), 300 * rnd.next(), 60 * rnd.next(), 300 * rnd.next())]]) { w.records[i].m.set(m); for (let k = 0; k < 16; k++) emu.wf(RECORDS_BASE + i * REC + 0xc + 4 * k, w.records[i].m[k]); }
    }
    emu.tc = t; emu.tick = t; emu.tickNo = t; emu.msOf = () => 0; w.tickCount = t;
    pev.length = 0; emu.takeEv(); emu.takeDraws(); scrolls.length = 0; pscrolls.length = 0;
    const rets = [];
    for (const [fn, rec, node] of [[0x70ea60, A1, Rp1], [0x70ea60, A2, Rp2], [0x70d960, JC, Jc], [0x70d437, CR, Ac], [0x70d5e0, PA, Pa], [0x70d140, PR, Pp], [0x70e010, RV, Rv], [sbUpd, SB, Sb], [psUpd, PS, Ps]]) rets.push(emu.call(fn, [emu.recPtr(rec), node]) >>> 0);
    const prets = [...ropeN.map((r) => r.update()), can.update(w, w.records[JC]), crocN.update(w, w.records[CR]), parN.update(w, w.records[PA]), pn.update(w), riv.update(w, w.records[RV]), sb.update(), ps.update()];
    emu.call(0x70e0d4, [emu.recPtr(RV), Rv, 0, 0]);
    emu.call(0x70d271, [emu.recPtr(PR), Pp, 0, 0]);
    emu.call(0x70fc64, [emu.recPtr(SB), Sb, 0, 0]);
    st.ticks++;
    // ---- compare
    ropeN.forEach((r, k) => {
      const R = k ? Rp2 : Rp1;
      cmp.int(t, `rope${k}.moving`, emu.r32(R + 0x48), r.moving); cmp.int(t, `rope${k}.hit`, emu.r32(R + 0x4c), r.hit); cmp.int(t, `rope${k}.step`, emu.r32(R + 0x58), r.step);
      cmp.int(t, `rope${k}.wait`, emu.r32(R + 0x5c), r.waitLeft); cmp.num(t, `rope${k}.turn`, emu.rf(R + 0x64), r.turn);
      for (let q = 0; q < 3; q++) cmp.pos(t, `rope${k}.position`, emu.rf(R + 0x30 + 4 * q), r.cur[q]);
      for (const i of k ? [B2, C2] : [B1, C1]) for (let q = 0; q < 16; q++) cmp.num(t, 'rope partner matrix', recM(i, q), w.records[i].m[q]);
      if (r.moving === 1 && r.hit === 0) st.ropeMoving++; else if (r.moving === 0) st.ropeWaiting++; else st.ropeTurning++;
    });
    for (let q = 0; q < 16; q++) cmp.num(t, 'fuel can matrix', recM(JC, q), w.records[JC].m[q]);
    cmp.num(t, 'croc frame', instC.frame, w.records[CR].anim.frame); cmp.int(t, 'croc clip', instC.clip, w.records[CR].anim.clip);
    cmp.num(t, 'parrot frame', instP.frame, w.records[PA].anim.frame); cmp.int(t, 'parrot clip', instP.clip, w.records[PA].anim.clip);
    for (let i = 0; i < 3; i++) for (let q = 0; q < 16; q++) (q >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'propeller matrix', emu.rf(pmats + i * 64 + 4 * q), pn.matrices[i][q]);
    cmp.eq(t, 'update return values (1 = stop, 2 = continue)', rets, prets);
    cmp.events(t, 'engine calls', emu.takeEv(), pev.slice());
    if (run.riverNear) st.riverNear++; else st.riverFar++;
    // ---- the draws: the river's texture scroll step (dt x -0.01), the propeller draws (the PROP record drawn three times with the propeller matrices), the sea bed's underwater plane
    cmp.eq(t, 'river scroll step', scrolls.map((v) => Math.fround(v)), pscrolls.map((v) => Math.fround(v)));
    const dr = emu.takeDraws(), recDraws = dr.filter((d) => d.kind === 'rec' && d.rec === PR);
    cmp.int(t, 'propeller draws', recDraws.length, 3);
    for (let i = 0; i < Math.min(3, recDraws.length); i++) for (let q = 0; q < 16; q++) (q >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'propeller draw matrix', recDraws[i].m[q], pn.matrices[i][q]);
    cmp.int(t, 'sea bed draws the underwater plane (port: not drawn)', dr.filter((d) => d.kind === 'underwater').length, 1);
    if (cmp.fails.length) break;
  }
  const res = cmp.result(); res.stats = st; res.riverScroll = RIVER.SCROLL; return res;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// the course (FUN_00447280 planes, FUN_00446af0 frame, FUN_00447550 nearest point): dt does not enter, but the flight's heading, the camera and Johnny
// are built on it, so it is compared with the same explicit tolerances, including the frames just past the end (t up to 1 + 1 / n, where the indices are clamped)
export function splineScenario(ctx, o = {}) {
  const { label = 'spline' } = o;
  const F = bipFixture(ctx), sp = F.spline;
  const emu = new Rig(F.pe, sp, [{ name: 'XXXX' }], 1, o.cov);
  const cmp = new Cmp(label);
  const mem = emu.cpu.mem, curve = emu.curve, cpu = emu.cpu;
  const planesP = mem.u32(curve + 4);
  for (let i = 0; i < sp.n * 4; i++) cmp.pos(0, 'plane', mem.f32(planesP + i * 4), sp.planes[i]);
  const matP = emu.alloc(64), posP = emu.alloc(16);
  const u32 = (f) => new Uint32Array(new Float32Array([f]).buffer)[0];
  const lim = 0.9995;         // from t = 0.9997 the frame is ill-conditioned (the tangent goes to 0), at t >= 1 the original reads control points past the array: the flights never get there
  let k = 0;
  for (let i = 0; i <= 500; i++) {
    const t = Math.fround(i === 500 ? lim : (i / 500) * lim);
    cpu.regs[1] = curve; cpu.call(0x446af0, [matP, posP, u32(t)]);
    const my = sp.frame(t);
    for (let q = 0; q < 16; q++) (q >= 12 ? cmp.pos : cmp.num).call(cmp, t, 'frame', mem.f32(matP + q * 4), my.m[q]);
    for (let q = 0; q < 3; q++) cmp.num(t, 'normal', mem.f32(posP + q * 4), my.normal[q]);
    k++;
  }
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const q = emu.alloc(16);
  let atEndN = 0;
  for (let n = 0; n < 1500; n++) {
    // points around the course: random control point + an offset, and a few far away
    const pi = n % 3 === 0 ? sp.n - 1 - Math.floor(rnd() * 6) : Math.floor(rnd() * sp.n), far = n % 20 === 0 ? 800 : 60;
    const pos = [sp.pts[pi * 3] + (rnd() - 0.5) * far, sp.pts[pi * 3 + 1] + (rnd() - 0.5) * far * 0.5, sp.pts[pi * 3 + 2] + (rnd() - 0.5) * far].map(Math.fround);
    for (let i = 0; i < 3; i++) mem.wf32(q + i * 4, pos[i]);
    cpu.regs[1] = curve; cpu.call(0x447550, [q]);
    const t = sp.nearest(pos);
    cmp.num(n, 'progress', mem.f32(curve + 0x1c), t);
    cmp.int(n, 'idxA', mem.r32(curve + 0x28), sp.idxA); cmp.int(n, 'idxB', mem.r32(curve + 0x2c), sp.idxB); cmp.int(n, 'atEnd', mem.r8(curve + 0x24) ? 1 : 0, sp.atEnd ? 1 : 0);
    if (sp.atEnd) atEndN++;
    if (cmp.fails.length) break;
  }
  let turn = 0, prevH = null;
  for (let i = 0; i <= 20000; i++) { const m = sp.frame(0.9 * i / 20000).m, h = Math.atan2(m[8], m[10]); if (prevH !== null) { let d = h - prevH; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; turn = Math.max(turn, Math.abs(d) / (0.9 / 20000)); } prevH = h; }
  const res = cmp.result(); res.stats = { frames: k, nearestQueries: 1500, atEnd: atEndN, maxTurnRatePerProgress: +turn.toFixed(1) }; return res;
}
