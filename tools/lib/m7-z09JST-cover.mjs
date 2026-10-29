// z09JST (WP-VERIFY coverage): a scenario runner around the existing oracle (tools/lib/jst-emu.mjs) that adds what the first oracle test (tools/tests/m6-z09JST-emu.mjs) lacks:
//   * the frame step as a parameter: DAT_008b1718 = dt and DAT_008b171c = 1 / dt are written into the emulated image before the constructor and every tick, the hosted engine
//     advance FUN_0043b76a multiplies by that dt (src/game/anim.ts `advance(rate, dt)`, like the engine function at 0x43b76a: `rate * DAT_008b1718 + frame`), GetTickCount (0x435c91)
//     counts dt * 1000 / 30 ms per tick; the port gets the same dt through `world.dt` (-> `JoustDuel.dt`, `MfigMan.dt`, the Flag / Anims nodes);
//   * state injection (both sides get the same node field written between two ticks: the states 0xd, 0x15, 0x1c, 0x1d that no code of the executable sets, see docs/re/m6/z09JST.md);
//   * preset game variables (0x18 / 0xcb: "only raised" rule) and a compare of the variable writes;
//   * instruction coverage of the original (the `trace` hook of `cpu.call`): the set of executed addresses of the zone's code, per scenario and over all;
//   * a tighter tolerance (1e-5 relative to max(1, |value|), float32 noise) than the first test (2e-3).
// Nothing of the executable is stored here, only addresses.
import { loadZone, loadExe } from './engine-load.mjs';
import { JstEmu } from './jst-emu.mjs';
import '../../src/zones/z09JST.ts';
import { startDuel, giveAnimations, INTRO_CAMERA, applyRestart, rememberRestart } from '../../src/zones/z09jst/rig.ts';
import { MsvcRng } from '../../src/zones/z09jst/duel.ts';
import { START_CLIPS } from '../../src/zones/z09jst/consts.ts';
import { RIG_OF } from '../../src/zones/z09jst/consts.ts';
import { popupLines, finalLines } from '../../src/zones/z09jst/screens.ts';

export const REC_BASE = 0x10000000;
/** the code ranges whose executed instructions are counted (the zone, mfigman, the camera lives in the second one) */
export const ZONE_RANGES = [[0x5cd0d0, 0x5d4b60], [0x5f2bb0, 0x5f3f60]];
/** a bitmap of the executed instruction addresses of the zone's code ranges (a Set was too slow for the trace hook) */
export class Cov {
  constructor() { this.a = new Uint8Array(0x5d4b60 - 0x5cd0d0); this.b = new Uint8Array(0x5f3f60 - 0x5f2bb0); }
  add(x) { if (x < 0x5d4b60) { if (x >= 0x5cd0d0) this.a[x - 0x5cd0d0] = 1; } else if (x >= 0x5f2bb0 && x < 0x5f3f60) this.b[x - 0x5f2bb0] = 1; }
  has(x) { return x < 0x5d4b60 ? x >= 0x5cd0d0 && this.a[x - 0x5cd0d0] === 1 : x >= 0x5f2bb0 && x < 0x5f3f60 && this.b[x - 0x5f2bb0] === 1; }
  /** executed instructions with lo <= address < hi */
  count(lo, hi) { let n = 0; for (let x = lo; x < hi; x++) if (this.has(x)) n++; return n; }
}

/** the original's node record (DAT_05d5b0a8): offset, kind, name of the field in the port's `JoustDuel` (ints are compared exactly, floats within the tolerance) */
export const NODE_FIELDS = [
  [0x3c, 'i', 'steer'], [0x44, 'i', 'level'], [0x48, 'i', 'variant'], [0x4c, 'i', 'state'], [0x58, 'i', 'hitsP'], [0x5c, 'i', 'hitsE'], [0xf8, 'i', 'bonusSpeed'], [0xfc, 'i', 'precision'],
  [0x100, 'i', 'camMode'], [0x108, 'i', 'score'], [0x10c, 'i', 'roundPts'], [0x110, 'i', 'medal'], [0x118, 'i', 'popup'], [0xd0, 'i', 'toggle'],
  [0x40, 'f', 'ang'], [0xc0, 'f', 'r0'], [0xc4, 'f', 'r1'], [0xc8, 'f', 'speed'], [0xcc, 'f', 'rider'], [0xd4, 'f', 'step'], [0xd8, 'f', 'decay'], [0xdc, 'f', 'splineRate'], [0xe0, 'f', 'splineT'],
  [0xec, 'f', 'aimX'], [0xf0, 'f', 'aimY'], [0xf4, 'f', 'aimSq'], [0x114, 'f', 'aimStep'],
  [0x54, 'b32', 'splineMade'], [0x50, 'b8', 'ready'], [0x51, 'b8', 'reticle'],
];
const VEC_FIELDS = [[0x60, 'pPos'], [0x6c, 'pRot'], [0x78, 'ePos'], [0x84, 'eRot'], [0x90, 'camA'], [0x9c, 'camB'], [0xa8, 'camEye'], [0xb4, 'camTgt']];

/** the oracle with a settable dt, the tick-count clock at that dt, coverage and a `tick` that takes the injection hook */
export class JstCoverEmu extends JstEmu {
  constructor(pe, recs, anims, o) {
    super(pe, recs, anims, o);
    this.dt = o.dt ?? 1;
    this.cov = o.cov ?? new Cov();
    const L = this, H = this.cpu.hooks, mem = this.cpu.mem;
    // the engine's advance (FUN_0043b76a): frame = float32(rate * DAT_008b1718 + frame): the port's AnimInstance with the dt of the test
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1), L.dt) : 0; });
    // GetTickCount: one tick = dt * 1000 / 30 ms (the port's variant roll uses the same formula)
    H.set(0x435c91, (c) => { c.eax = Math.trunc(L.ticks * 1000 * L.dt / 30); });
    this.setDt();
    this.mem = mem;
  }
  setDt() { const mem = this.cpu.mem; mem.wf32(0x8b1718, this.dt); mem.wf32(0x8b171c, 1 / this.dt); }
  trace() { const cov = this.cov; return (cc, at) => cov.add(at); }
  construct() {
    this.setDt();
    this.cpu.steps = 0;
    this.cpu.call(0x5d1f64, [this.recPtr(4), 0, 0, 2, 1, 1], { maxSteps: 5_000_000, trace: this.trace() });
    this.node = this.cpu.mem.u32(0x5d5b0a8);
    this.curve = this.curve ?? 0;
    return this.node;
  }
  loadSounds() { this.cpu.call(0x5d24b0, [], { trace: this.trace() }); this.cpu.call(0x5d4add, [], { trace: this.trace() }); }
  /** the restart of the zone: FUN_00423532 calls the constructor with the existing node (DAT_008adc74 = 0), which takes the else branch (re-init of the two managers) */
  reinit() {
    this.setDt();
    this.cpu.steps = 0;
    this.cpu.call(0x5d1f64, [this.recPtr(4), 0, this.node, 2, 1, 1], { maxSteps: 5_000_000, trace: this.trace() });
  }
  tick(held, pressed, stickX = 0, stickY = 0) {
    this.ticks++;
    this.log = [];
    this.texts = [];
    const mem = this.cpu.mem, tr = this.trace();
    this.setDt();
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x98384c, stickX | 0); mem.w32(0x983850, stickY | 0);
    this.cpu.steps = 0;
    this.cpu.call(0x5ce506, [this.recPtr(4), this.node], { maxSteps: 5_000_000, trace: tr });
    for (const i of [5, 6, 7, 8, 9, 10]) this.cpu.call(0x5d3d90, [this.recPtr(i), 0], { trace: tr });
    for (const i of [19, 20, 21, 22, 25, 26, 27, 28]) this.cpu.call(0x5d3b80, [this.recPtr(i), 0], { trace: tr });
    return this.log;
  }
}

/** the lines the original's FUN_005ce506 emits as effects -> the port's effect names (as in tools/tests/m6-z09JST-emu.mjs) */
function fxNames(log) {
  const out = [];
  let mud2 = 0, mud1 = 0;
  for (const l of log) {
    const m = /^fx (\d+) (\d)$/.exec(l);
    if (!m) continue;
    const h = +m[1], mode = +m[2];
    if (h === 0) out.push('botexpl01');
    else if (mode === 2) { if (++mud2 % 8 === 0) out.push('orsemud1'); }
    else if (mode === 1) { if (++mud1 % 8 === 0) out.push('emitters-off'); }
  }
  return out;
}

export const TOL = 1e-5;
/** the level the previous port duel ended with (what `rememberRestart` stores when the zone is left) */
function rememberRestartFrom(prevDuel) { rememberRestart(prevDuel); }
const F32 = new Float32Array(1);
const isBits = (a, b) => { F32[0] = a; const x = new Uint32Array(F32.buffer)[0]; F32[0] = b; return x === new Uint32Array(F32.buffer)[0]; };

/** the oracle on a world of its own (records, animations built like the port's), sounds loaded and the constructor run; the intro camera written like FUN_005ce1c6 does */
export function buildOracle(ctx, pe, { dt = 1, rng, cov, vars = {} }) {
  const L2 = loadZone(ctx, 'z09JST');
  giveAnimations(L2.world, L2.archive);
  const anims = new Map();
  for (const i of Object.keys(RIG_OF)) anims.set(+i, L2.world.records[+i].anim);
  const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
  const emu = new JstCoverEmu(pe, recs, anims, { rng, dt, cov });
  for (const [id, v] of Object.entries(vars)) emu.vars.set(+id, v | 0);
  emu.loadSounds();
  emu.construct();
  for (let k = 0; k < 6; k++) emu.cpu.mem.wf32(0x9da5e8 + 4 * k, INTRO_CAMERA[k]);
  return { emu, anims, world: L2.world };
}

/**
 * one differential scenario.
 * o: { label, seed, dt, keys(duel, tick) -> buttons, stick(duel, tick) -> [x, y] (DAT_0098384c / DAT_00983850, default none), maxTicks, stop(duel), mkRng(seed), vars: { id: value } (both sides), cov: Set,
 *      afterTick(n, S) (may inject), beforeTick(n, S), dtPort (sensitivity check only), tol }
 * S (injection API): { d (port duel), W (world), emu, node, n, setField(name, v), state(v), setClips(who, row), setMode(who, m), setRec(i, k, v) } each writes BOTH sides
 * returns { checked, failures[], states: Set (states whose code ran), stateTicks, ticks, panels, worst, exact, floats, unhooked, d, emu, S, result }
 */
export function runScenario(ctx, o) {
  const failures = [];
  const pe = loadExe(ctx.dataRoot);
  const label = o.label, dt = o.dt ?? 1, tol = o.tol ?? TOL;
  /** `dtPort`: the port gets another dt than the original (the sensitivity check of the test: this must fail) */
  const dtP = o.dtPort ?? dt;
  const mkRng = o.mkRng;
  let checked = 0;
  const fail = (m) => { if (failures.length < 12) failures.push(`${label}: ${m}`); };
  // ---- the port
  const L = loadZone(ctx, 'z09JST');
  const plog = [], vlog = [];
  const snd = {
    play2D: (i) => plog.push(`p2 ${i}`), stop2D: (i) => plog.push(`s2 ${i}`), rate: (i, h) => plog.push(`r ${i} ${h}`),
    play3D: (i, p) => plog.push(`p3 ${i} ${[0, 1, 2].map((k) => p[k].toFixed(2)).join(',')}`),
  };
  const effects = [];
  // restartOf: the zone restarts in place: the oracle is the previous scenario's emulator (constructor else branch) and the port a rebuilt zone with the carried-over state
  const prev = o.restartOf ?? null;
  const rngO = prev ? prev.rngO : mkRng(o.seed);
  const rngP = prev ? Object.assign(new MsvcRng(0), { seed: rngO.seed }) : mkRng(o.seed);
  const W = L.world;
  W.dt = dtP;
  for (const [id, v] of Object.entries(o.vars ?? {})) W.vars.set(+id, v);
  if (prev) for (const id of [0x18, 0xcb]) W.vars.set(id, prev.emu.vars.get(id) ?? 0);
  const ovs = W.vars.set.bind(W.vars);
  W.vars.set = (i, v) => { vlog.push(`setVar ${i} ${v | 0}`); ovs(i, v); };
  const S0 = startDuel({ world: W, archive: L.archive, pe, sound: snd, say: (a, b) => plog.push(`say ${a}${b ? `+${b}` : ''}`), stopSpeech: () => plog.push('stop'), rng: rngP, onGear: () => {} });
  const og = S0.gear.set.bind(S0.gear);
  S0.gear.set = (r, s, on) => { plog.push(`gear ${r}:${s}:${on ? 'on' : 'off'}`); og(r, s, on); };
  S0.duel.onEffect = (n) => effects.push(n);
  plog.length = 0; vlog.length = 0;
  const d = S0.duel;
  if (prev) { rememberRestartFrom(prev.d); if (!o.noCarry) applyRestart(d, 1); }
  // ---- the oracle
  let emu, anims;
  if (prev) {
    ({ emu, anims } = prev);
    emu.ticks = 0; emu.dt = dt; emu.rng = rngO; emu.cov = o.cov ?? emu.cov; emu.log = []; emu.texts = [];
    o.beforeReinit?.(emu);
    emu.reinit();
    o.afterReinit?.(emu);
    emu.cpu.mem.w32(0x5d5ae9c, 0);                                                                  // the zone loop (FUN_005cd33d 0x5cd62b) clears the result when it starts
    for (const [list, clip] of START_CLIPS) for (const i of list) anims.get(i)?.start(clip, 0);     // FUN_005cdb60 (the attach, run again by the restart) starts these clips
    const mem0 = emu.cpu.mem;
    for (let k = 0; k < 6; k++) mem0.wf32(0x9da5e8 + 4 * k, INTRO_CAMERA[k]);
  } else ({ emu, anims } = buildOracle(ctx, pe, { dt, rng: rngO, cov: o.cov, vars: o.vars }));
  const mem = emu.cpu.mem, node = emu.node;
  const rd = (off, kind) => (kind === 'f' ? mem.f32(node + off) : kind === 'b8' ? (mem.r8(node + off) ? 1 : 0) : kind === 'b32' ? (mem.r32(node + off) ? 1 : 0) : mem.r32(node + off) | 0);
  const pv = (name, kind) => (kind === 'f' ? d[name] : kind === 'i' ? d[name] : d[name] ? 1 : 0);

  const worst = {}; let floats = 0, exact = 0;
  /** the compare of one value: `key` (a precomputed name) + `sub` (index, only formatted on a failure); tolerance relative to max(1, |original|), 0 = exact */
  const cmp = (tick, key, sub, orig, port, t = tol) => {
    checked++;
    if (orig === port) { if (t !== 0) { floats++; exact++; } return; }
    const dd = Math.abs(orig - port);
    if (t !== 0) { floats++; if (isBits(orig, port)) exact++; }
    const rel = dd / Math.max(1, Math.abs(orig));
    if (rel > (worst[key] ?? 0)) worst[key] = rel;
    if (!(rel <= t)) fail(`tick ${tick} ${key}${sub === null ? '' : `[${sub}]`}: original ${orig} port ${port} (state ${d.state.toString(16)}, port ticks ${d.ticks})`);
  };
  const recAddr = (i) => REC_BASE + i * 0x68;
  const NF = NODE_FIELDS.map(([off, kind, name]) => [off, kind, name, `node+0x${off.toString(16)} ${name}`, kind === 'f' ? tol : 0]);
  const VF = VEC_FIELDS.map(([off, name]) => [off, name, `node+0x${off.toString(16)} ${name}`]);
  const RK = Array.from({ length: 30 }, (_, i) => [`rec${i}.m`, `rec${i}.flag2`, `rec${i}.clip`, `rec${i}.frame`]);
  const compare = (tick) => {
    for (const [off, kind, name, key, t] of NF) cmp(tick, key, null, rd(off, kind), pv(name, kind), t);
    for (const [off, name, key] of VF) for (let k = 0; k < 3; k++) cmp(tick, key, k, mem.f32(node + off + 4 * k), d[name][k]);
    cmp(tick, 'gauge', null, mem.f32(0x5d4e138), d.gauge); cmp(tick, 'result', null, mem.r32(0x5d5ae9c), d.result, 0);
    for (let k = 0; k < 6; k++) cmp(tick, 'camera', k, mem.f32(0x9da5e8 + 4 * k), W.camera.c[k]);
    for (let i = 0; i < 30; i++) {
      const pr = W.records[i], a = recAddr(i), rk = RK[i];
      for (let k = 0; k < 16; k++) cmp(tick, rk[0], k, mem.f32(a + 0xc + 4 * k), pr.m[k]);
      cmp(tick, rk[1], null, mem.r16(a + 0x60) & 2, pr.flags & 2, 0);
      const an = anims.get(i);
      if (an && pr.anim) { cmp(tick, rk[2], null, an.clip, pr.anim.clip, 0); cmp(tick, rk[3], null, an.frame, pr.anim.frame); }
    }
    cmp(tick, 'player.mode', null, mem.r32(mem.u32(0x5d5b284) + 8), d.player.mode, 0); cmp(tick, 'enemy.mode', null, mem.r32(mem.u32(0x5d5b288) + 8), d.enemy.mode, 0);
    for (let k = 0; k < 4; k++) cmp(tick, 'player.clip', k, mem.r32(mem.u32(0x5d5b284) + 0x30 + 4 * k), d.player.clip[k], 0);
    for (let k = 0; k < 3; k++) cmp(tick, 'enemy.clip', k, mem.r32(mem.u32(0x5d5b288) + 0x30 + 4 * k), d.enemy.clip[k], 0);
  };
  if (!prev) compare(-1);          // after a restart the records still hold the last tournament's facing until the first tick (the spectators turn every tick)
  // ---- the injection API (both sides get the same write between two ticks)
  const mgrOf = (who) => mem.u32(who === 'player' ? 0x5d5b284 : 0x5d5b288);
  const S = {
    d, W, emu, node, n: 0, cmpNow: () => compare(S.n),
    f: (name) => { const e = NODE_FIELDS.find((x) => x[2] === name); return rd(e[0], e[1]); },
    setField: (name, v) => {
      const e = NODE_FIELDS.find((x) => x[2] === name);
      if (!e) throw new Error(`no node field ${name}`);
      if (e[1] === 'f') { mem.wf32(node + e[0], v); d[name] = Math.fround(v); }
      else if (e[1] === 'i') { mem.w32(node + e[0], v | 0); d[name] = v | 0; }
      else if (e[1] === 'b8') { mem.w8(node + e[0], v ? 1 : 0); d[name] = !!v; }
      else { mem.w32(node + e[0], v ? 1 : 0); d[name] = !!v; }
    },
    state: (v) => S.setField('state', v),
    /** FUN_005f3c66(manager, row) / FUN_005f3d6a(manager, mode) and the port's MfigMan calls */
    setClips: (who, row) => { emu.cpu.call(0x5f3c66, [mgrOf(who), row]); d[who].setClips(row); },
    setMode: (who, m) => { emu.cpu.call(0x5f3d6a, [mgrOf(who), m]); d[who].setMode(m); },
    /** a float of a record's matrix on both sides (m[12..14] = x y z) */
    setRec: (i, k, v) => { mem.wf32(recAddr(i) + 0xc + 4 * k, v); W.records[i].m[k] = v; },
    /** a game variable on both sides */
    setVar: (id, v) => { emu.vars.set(id, v | 0); ovs(id, v); },
  };
  const rest = (log) => log.filter((l) => !l.startsWith('fx ') && !l.startsWith('fxm ') && !l.startsWith('setVar'));
  const states = new Set();
  const stateTicks = new Map();
  let n = 0, panels = 0, post = 0, stopped = false;
  const maxTicks = o.maxTicks ?? 3000;
  const stop = o.stop ?? ((x) => x.result !== 0);
  for (; n < maxTicks; n++) {
    S.n = n;
    o.beforeTick?.(n, S);
    const k = o.keys(d, n);
    const [sx, sy] = o.stick ? o.stick(d, n) : [0, 0];
    const pre = { state: d.state, popup: d.popup, bonusSpeed: d.bonusSpeed, precision: d.precision, roundPts: d.roundPts, medal: d.medal, score: d.score };
    W.input.setVirtual(k);
    plog.length = 0; effects.length = 0; vlog.length = 0;
    W.dt = dtP;
    // the port's input mapper has no stick: the JSTGame node's `stick` is the hook for it
    S0.node.stick = [sx, sy];
    W.tick();
    const olog = emu.tick(W.input.held, W.input.pressed, sx, sy);
    states.add(pre.state);
    stateTicks.set(pre.state, (stateTicks.get(pre.state) ?? 0) + 1);
    {
      const want = pre.state === 0x21 ? popupLines(pre) : pre.state === 0x23 ? finalLines(pre) : [];
      const got = emu.texts.filter((x) => !x.panel);
      checked++;
      const A = want.map((l) => `${l.table} ${l.text} ${l.y} ${l.wrap}`).join('|'), B = got.map((l) => `${l.table} ${l.text} ${l.x === 320 ? '' : `x${l.x} `}${l.y} ${l.wrap}`).join('|');
      if (A !== B) fail(`tick ${n} panel texts (state ${pre.state.toString(16)} popup ${pre.popup.toString(16)}): port [${A}] original [${B}]`);
      const np = emu.texts.filter((x) => x.panel).length, wantPanel = want.length > 0 ? 1 : 0;
      checked++;
      if (np !== wantPanel) fail(`tick ${n}: ${np} panels drawn, expected ${wantPanel} (state ${pre.state.toString(16)} popup ${pre.popup.toString(16)})`);
      if (np) panels++;
    }
    compare(n);
    const a = rest(olog), b = plog.slice();
    checked++;
    if (a.join('|') !== b.join('|')) fail(`tick ${n} calls differ: original [${a.join(' ; ')}] port [${b.join(' ; ')}]`);
    checked++;
    if (fxNames(olog).join() !== effects.join()) fail(`tick ${n} effects: original ${fxNames(olog)} port ${effects}`);
    checked++;
    const ov = olog.filter((l) => l.startsWith('setVar'));
    if (ov.join('|') !== vlog.join('|')) fail(`tick ${n} variable writes: original [${ov}] port [${vlog}]`);
    if (failures.length >= 12) break;
    o.afterTick?.(n, S);
    if (!stopped && stop(d)) stopped = true;
    if (stopped && post++ >= 6) { n++; break; }          // a few ticks more after the stop condition (it latches)
  }
  for (const id of [0x18, 0xcb]) { checked++; if ((emu.vars.get(id) ?? 0) !== (W.vars.get(id) | 0)) fail(`variable ${id.toString(16)}: original ${emu.vars.get(id) ?? 0} port ${W.vars.get(id)}`); }
  const unh = [...emu.unhooked.entries()].map(([x, c]) => `0x${x.toString(16)}x${c}`).join(' ');
  return { checked, failures, states, stateTicks, ticks: n, panels, worst, floats, exact, unhooked: unh, d, emu, anims, rngO, S, result: d.result };
}
