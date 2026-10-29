// z42BRP (Brickster's palace): the ORIGINAL zone code (0x81fd64 .. 0x827700) run in the x86 emulation against the port (tools/tests/m7-z42BRP-emu.mjs, docs/re/m6/z42BRP.md
// section "Differential test (WP-VERIFY)").
// Native from the user's own executable: the set-up FUN_00820f4e (attaches: the six constructors FUN_0082714a / 00823f08 / 008224ba / 00826516 / 00825378 / 00824a02 in the
// original order), the sound loader FUN_00820b70, the six update functions (FUN_00826b40 Brickster, 00822ba8 side run, 00821704 roof, 00825850 tower parts, 00824c80 floor,
// 008243e5 bots) with their helpers, the camera helper FUN_00422c7e / 00422b50, the matrix builders and the C runtime (sin / cos / fmod / strncmp / memcpy).
// Hosted engine services (NOT the subject here): game variables, the animation instances (the port's AnimInstance of the oracle's own world, advanced by `rate * dt` like
// FUN_0043b76a), the collision queries (the port's CollisionWorld of the oracle world over the records the emulated code moved: FUN_00441270 sweep and FUN_00441b10 ray),
// sounds / speech / letterbox / cutscene (logs), the random numbers (a scripted sequence the port draws too), the clocks (GetTickCount, FUN_00435cbb: scripted from the tick
// counter), particles (no-ops). Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe, loadZone } from './engine-load.mjs';
import { bindRigs, stateOf, prepareWorld, BrpState, CTOR } from '../../src/zones/z42BRP/nodes.ts';
import { statefulRng, capture, restore } from '../../src/zones/z42BRP/bot.ts';
import { REC, VAR } from '../../src/zones/z42BRP/rules.ts';

export const RB = 0x30000000, CB = 0x31000000, AB = 0x32000000, HB = 0x33000000, MB = 0x34000000;
export const NREC = 96;
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

/** the node functions: [update address] */
export const UPDATE = { pepbrp: 0x822ba8, peptop: 0x821704, bottop: 0x8243e5, zonetop: 0x824c80, zonebrp: 0x825850, brickst: 0x826b40 };
const KIND_OF_CTOR = { [CTOR.PEPBRP]: 'pepbrp', [CTOR.PEPTOP]: 'peptop', [CTOR.BOTTOP]: 'bottop', [CTOR.ZONETOP]: 'zonetop', [CTOR.ZONEBRP]: 'zonebrp', [CTOR.BRICKST]: 'brickst' };

/** the scripted cutscene both sides use (FUN_0045c40c starts it when var 0xb == 0, FUN_0045c432 asks): active for `len` ticks */
export class ScriptedCutscene {
  constructor(len = 60) { this.len = len; this.left = 0; this.starts = 0; }
  start(w) { if (w.vars.get(VAR.STARTED_FROM_MENU) !== 0) return false; this.left = this.len; this.starts++; return true; }
  active() { return this.left > 0; }
  /** once per tick, before the nodes (the zone loop's FUN_0045c402) */
  tick() { if (this.left > 0) this.left--; }
}

/**
 * Builds the oracle: port world P (prepared by `prepareWorld`) and the emulation over a second world O (only used as the host of animation / collision / variables).
 * opts: { seed, dt, cutsceneTicks, startedFromMenu }
 */
export function createBrpOracle(ctx, opts = {}) {
  const seed = opts.seed ?? 1, dt = opts.dt ?? 1;
  const pe = loadExe(ctx.dataRoot);

  // ------------------------------------------------------------ the port side
  const LP = loadZone(ctx, 'z42BRP', { subgame: 29 });
  const P = LP.world; P.externalInput = true; P.dt = dt;
  const cutP = new ScriptedCutscene(opts.cutsceneTicks ?? 60);
  P.vars.set(VAR.STARTED_FROM_MENU, opts.startedFromMenu ?? 0);
  const logP = [], vP = [], vO = [];
  const rngP = statefulRng(seed * 7919 + 13);
  // the port's recorder: sounds / speech / letterbox / cutscene in one ordered list (compared with the original's)
  const S0 = stateOf(P);
  S0.env = {
    rng: Object.defineProperty(() => { P.__rand++; return rngP(); }, 'state', { get: () => rngP.state, set: (v) => { rngP.state = v; } }),
    ms: () => Math.floor(100000 + S0.clock() * (1000 / 60)),
    sfx: (id) => logP.push(['2d', id]),
    sfx3: (id, pos, voice = 0) => { logP.push(['3d', id, f32(pos[0]), f32(pos[1]), f32(pos[2])]); vP.push([id, voice]); },
    say: (a, b, stop) => { if (stop) logP.push(['stopspeech']); logP.push(['say', a, b ?? null]); },
    letterbox: (on) => logP.push(['letterbox', on ? 1 : 0]),
    startCutscene: () => { const ok = cutP.start(P); logP.push(['cutscene', ok ? 1 : 0]); return ok; },
    cutsceneActive: () => cutP.active(),
  };
  P.__rand = 0;
  // construction: prepareWorld runs the six constructors (lazy init) in the port's order; the log of the constructors is compared too
  prepareWorld(P, LP.archive);
  const S = S0;

  // ------------------------------------------------------------ the oracle world (host of the engine services)
  const LO = loadZone(ctx, 'z42BRP', { subgame: 29 });
  const O = LO.world; O.externalInput = true; O.dt = dt;
  bindRigs(O, LO.archive);
  O.vars.set(VAR.STARTED_FROM_MENU, opts.startedFromMenu ?? 0);
  const cutO = new ScriptedCutscene(opts.cutsceneTicks ?? 60);
  const rngO = statefulRng(seed * 7919 + 13);
  const rs = O.records;

  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;     // the executable runs the x87 in 24-bit precision (Direct3D 7, control word 0x7f): every + - * / sqrt rounds to float32
  const mem = cpu.mem;
  for (const [lo, n] of [[RB, NREC * 0x68], [CB, NREC * 0x80], [AB, NREC * 0x40], [HB, 0x40000], [MB, 0x10000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const recPtr = (r) => RB + (typeof r === 'number' ? r : r.index) * 0x68;
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const E = { vO, vP, dt, cpu, mem, O, P, S, pe, log: [], handles: new Map(), nodes: [], rand: 0, unhooked: new Map(), ticks: 0, rets: {}, fx: 0, listener: 0, stats: {} };
  const push = (e) => E.log.push(e);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  let heap = HB;
  const alloc = (n) => { const p = heap; heap += (n + 15) & ~15; return p; };

  // ---- the clocks: GetTickCount-based, scripted from the tick counter (the game clock FUN_00435cbb counts 1/60 s; one tick of step dt is 2 * dt of them)
  const clock = () => Math.trunc(E.ticks * 2 * dt);
  hook(0x435cbb, () => { cpu.eax = clock(); });
  hook(0x435c91, () => { cpu.eax = Math.floor(100000 + clock() * (1000 / 60)); });
  // ---- game variables
  hook(0x417575, (c) => { c.eax = O.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { O.vars.set(c.arg(0), c.arg(1) | 0); });
  // ---- random numbers: FUN_004388ae(x) = rand / 32767 * x, from the scripted sequence
  hook(0x4388ae, (c) => { E.rand++; c.fpush(rngO() * c.argf(0)); });
  // ---- allocation of the nodes (the constructors call FUN_00433d38(size, ...))
  hook(0x433d38, (c) => { E.lastAlloc = alloc(c.arg(0)); c.eax = E.lastAlloc; });
  hook(0x433d60, () => {});
  // ---- sounds: the loader (FUN_00820b70, native) hands every DAT_05d5f5xx a handle; the handle names the sound table id
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; E.handles.set(h, { id: c.arg(0), kind: '2d' }); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; E.handles.set(h, { id: c.arg(0), kind: '3d' }); c.eax = h; });
  hook(0x4435a0, (c) => { push(['2d', E.handles.get(c.arg(0))?.id]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['3d', E.handles.get(c.arg(0))?.id, mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); E.vO.push([E.handles.get(c.arg(0))?.id, c.arg(0)]); });
  hook(0x4434d0, () => { E.listener++; });
  hook(0x442a20, () => { E.fx++; });
  hook(0x442960, () => { cpu.eax = 0x6000 + E.fx++; });
  hook(0x444480, () => {}); hook(0x4359d5, () => {}); hook(0x43cc5c, () => {}); hook(0x41f17c, () => {});
  hook(0x442d90, () => {}); hook(0x4238b7, (c) => { mem.w32(c.arg(0) + 0xc, c.arg(1)); });
  // ---- speech
  const tokens = new Map();
  hook(0x439bf8, (c) => { const tok = 0x7000 + tokens.size; tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { const a = tokens.get(c.arg(0)), b = c.arg(1) === 0xffffffff ? null : tokens.get(c.arg(1)); push(['say', a ?? null, b ?? null]); });
  hook(0x435b07, () => { push(['stopspeech']); });
  hook(0x45f750, (c) => { push(['letterbox', c.arg(0) & 0xff ? 1 : 0]); });
  hook(0x438518, () => { E.stats.fade = (E.stats.fade ?? 0) + 1; });
  // ---- the cutscene (FUN_0045c40c(0) starts the end cutscene when var 0xb == 0; FUN_0045c432 asks)
  hook(0x45c40c, () => { push(['cutscene', cutO.start(O) ? 1 : 0]); });
  hook(0x45c432, () => { cpu.eax = cutO.active() ? 1 : 0; });
  // ---- walkers of the cutscene actors (the constructors of Pepper and Brickster): handles only
  hook(0x462d4f, () => { cpu.eax = 0x7777; });
  for (const a of [0x462206, 0x461ad6, 0x462324, 0x4623aa, 0x4623cd, 0x462436, 0x4625d7]) hook(a, () => {});
  // ---- animation instances (pointer = AB + record * 0x40): the port's AnimInstance of the oracle world; FUN_0043b76a advances by rate * DAT_008b1718
  const animOf = (ptr) => rs[(ptr - AB) / 0x40].anim;
  hook(0x43b6a3, (c) => { E.animLog?.push(['start', (c.arg(0) - AB) / 0x40, c.arg(1) | 0, c.argf(2), cpu.callAt.toString(16)]); animOf(c.arg(0)).start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { E.animLog?.push(['advance', (c.arg(0) - AB) / 0x40, c.argf(1), cpu.callAt.toString(16)]); cpu.eax = animOf(c.arg(0)).advance(c.argf(1), O.dt); });
  hook(0x43b72b, (c) => { cpu.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // FUN_0043bc58(anim, bone): the bone matrix of the renderer (only the particle emitter reads the copy): an identity block
  const IDENT = MB + 0x100;
  hook(0x43bc58, () => { cpu.eax = IDENT; });
  // ---- collision: FUN_00441270(ignore, from, delta, outNormal, outPoint, mask, radius, skin) and FUN_00441b10(rec, rayStruct, 0) over the port's world
  const syncRecords = () => {
    for (const r of rs) { const p = recPtr(r); for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); }
  };
  hook(0x441270, (c) => {
    syncRecords();
    const ig = recOf(c.arg(0)), f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = O.col.sweep(ig, f, d, c.arg(5), c.argf(6), c.argf(7));
    E.sweepLog?.push(['O', ig?.index, f, d, c.arg(5), c.argf(6), c.argf(7), h ? [h.rec.index, h.point, h.normal] : null]);
    E.stats.sweeps = (E.stats.sweeps ?? 0) + 1;
    if (!h) { cpu.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    cpu.eax = recPtr(h.rec);
  });
  hook(0x441b10, (c) => {
    syncRecords();
    const rec = recOf(c.arg(0)), s = c.arg(1);
    const o = mem.u32(s), dl = mem.u32(s + 4);
    const from = [0, 1, 2].map((i) => mem.f32(o + 4 * i)), delta = [0, 1, 2].map((i) => mem.f32(dl + 4 * i));
    const h = O.col.rayRecord(rec, from, delta, mem.r8(s + 0x10), mem.f32(s + 0x14), mem.f32(s + 0x18));
    E.stats.rays = (E.stats.rays ?? 0) + 1;
    cpu.eax = h ? 1 : 0;
  });
  // atan2(y, x): the CRT version loads an 80 bit constant (not modelled by the interpreter)
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  // ---- the controllers (FUN_0042382c) and the attach (FUN_00423532) run natively, creation mode and re-init mode (DAT_008adc74, FUN_004237b6); the watch logs every attach
  hook(0x443c70, () => {});
  hook(0x4238b7, (c) => { mem.w32(c.arg(0) + 0xc, c.arg(1)); });
  cpu.watches.set(0x423532, (c) => { E.attaches.push({ record: (c.arg(0) - RB) / 0x68, ctor: c.arg(1), pos: c.arg(3), var: c.arg(4), mask: c.arg(5) & 0xffff, value: c.arg(6) & 0xffff }); });
  // the HUD tables FUN_008276f0 builds when the zone restarts
  for (const a of [0x43e870, 0x43ec10]) hook(a, () => {});
  hook(0x43eaf0, () => { cpu.eax = 0x6100; });
  /** the node chains of the records (after the set-up, after a restart): [{ rec, node, kind }] in record order */
  E.rescan = () => {
    E.nodes = [];
    const KIND = Object.fromEntries(Object.entries(UPDATE).map(([k, a]) => [a, k]));
    for (const r of rs) {
      const ci = mem.u32(recPtr(r) + 0x5c);
      if (!ci) continue;
      for (let n = mem.u32(ci), pos = 0; n; n = mem.u32(n + 0x10), pos++) E.nodes.push({ rec: r, node: n, kind: KIND[mem.u32(mem.u32(n + 4))], pos });
    }
  };
  E.attaches = [];
  cpu.exec = [[0x81fce0, 0x827800], [0x858d30, 0x873e00], [0x43a340, 0x43b100], [0x422b50, 0x422d00], [0x4239d9, 0x4239e0], [0x43cec0, 0x43cf30], [0x4237b6, 0x4237c8], [0x423532, 0x423660], [0x42382c, 0x4238b7]];
  cpu.fallback = (a) => { E.unhooked.set(a, (E.unhooked.get(a) ?? 0) + 1); throw new Error(`z42BRP emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)} frames ${cpu.frames.slice(-5).map((f) => f.toString(16))}`); };
  cpu.invalidate();

  // ---- DAT_008b1718 / 1/dt: the frame step the zone code reads
  mem.wf32(0x8b1718, dt); mem.wf32(0x8b171c, 1 / dt);

  // ---- the record mirror: the scene's state; BRP's collision block (+0x58) holds the radius at +0x24 (the side run's tower circle), the others a dummy
  const colBlock = MB + 0x1000;
  mem.wf32(colBlock + 0x24, rs[REC.BRP].colObj?.radius ?? 0);
  const writeRec = (r) => {
    const p = recPtr(r);
    for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
    mem.w32(p + 4, 0);
    mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
    for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
    mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
    mem.w32(p + 0x58, r.index === REC.BRP ? colBlock : r.colObj ? colBlock + 0x100 : 0);
    mem.w32(p + 0x5c, 0);
    mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
  };
  for (const r of rs) writeRec(r);
  E.recPtr = recPtr; E.rs = rs; E.readRec = (i) => {
    const p = recPtr(i);
    return { m: Array.from({ length: 16 }, (_, k) => mem.f32(p + 0xc + 4 * k)), flags: mem.r16(p + 0x60), w62: mem.r16(p + 0x62) };
  };

  // ---- native set-up: the sound loader and FUN_00820f4e(1) (controllers, the nine attaches, var 0xfa = 1, Pepper's idle clip, the camera); with `opts.loop` the zone loop's own FUN_008212a3 does it
  if (!opts.loop) {
    cpu.steps = 0;
    cpu.call(0x820b70, [], { maxSteps: 2_000_000 });
    E.soundHandles = new Map(E.handles);
    cpu.steps = 0;
    cpu.call(0x820f4e, [1], { maxSteps: 20_000_000 });
  }
  E.rescan();
  E.afterSetup = () => { for (const r of rs) { const p = recPtr(r); for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); } };

  // ---- the update pass (FUN_0042226e over the 96 records: the chain of nodes of every controller, gated by the variable)
  const held = { v: 0, pressed: 0 };
  E.setInput = (heldMask, pressedMask) => { held.v = heldMask; held.pressed = pressedMask; };
  E.pass = () => {
    if (!E.nodes.length) E.rescan();
    E.log.length = 0; E.rand = 0; E.vO.length = 0;
    mem.w32(0x98383c, held.v); mem.w32(0x983840, held.pressed); mem.w32(0x983848, held.v); mem.w32(0x98384c, 0); mem.w32(0x983850, 0);
    if (!E.loopMode) cutO.tick();
    for (const r of rs) {
      const ci = mem.u32(recPtr(r) + 0x5c);
      if (!ci) continue;
      for (let n = mem.u32(ci); n; n = mem.u32(n + 0x10)) {
        const v = O.vars.get(mem.u32(n));
        if ((v & mem.r16(n + 0xc)) !== mem.r16(n + 0xe)) continue;
        const vt = mem.u32(n + 4), fn = mem.u32(vt);
        cpu.steps = 0;
        let res;
        try { res = cpu.call(fn, [recPtr(r), n, ci, v], { maxSteps: 5_000_000 }); }
        catch (e) { e.message += ` [record ${r.index} ${r.name} node 0x${n.toString(16)} fn 0x${fn.toString(16)}]`; throw e; }
        const k = E.nodes.find((x) => x.node === n)?.kind ?? '?';
        (E.rets[k] ??= new Set()).add(res | 0);
        E.stats[k] = (E.stats[k] ?? 0) + 1;
        if ((res | 0) === 1) break;
      }
    }
    E.ticks++;
    return E.log.slice();
  };
  E.syncO = () => { E.afterSetup(); };
  E.loopMode = !!opts.loop;

  E.node = (kind, idx = 0) => E.nodes.filter((n) => n.kind === kind)[idx];
  E.cutO = cutO; E.cutP = cutP; E.logP = logP;
  E.unconstructed = null;
  E.rngP = rngP; E.rngO = rngO;
  // ---- save / load of the whole oracle (emulated memory ranges that hold state, the oracle world's variables / animations, the port world): branching scenarios
  const RANGES = [[RB, NREC * 0x68 + 0x100], [CB, NREC * 0x80], [AB, NREC * 0x40], [MB, 0x2000], [0x5d5f400, 0x400], [0x958a00, 0x200], [0x983800, 0x80], [0x8b1700, 0x40], [0x9da5c0, 0x100]];
  E.save = () => {
    const chunks = RANGES.map(([lo, n]) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = mem.r8(lo + i); return b; });
    const hp = new Uint8Array(heap - HB); for (let i = 0; i < hp.length; i++) hp[i] = mem.r8(HB + i);
    return {
      chunks, hp, heap, ticks: E.ticks, vars: O.vars.a.slice(), rngO: rngO.state, rngP: rngP.state, cutO: cutO.left, cutP: cutP.left,
      anims: rs.map((r) => (r.anim ? { clip: r.anim.clip, frame: r.anim.frame, prevFrame: r.anim.prevFrame, prevClip: r.anim.prevClip } : null)),
      port: capture(P), tickCount: P.tickCount, camera: Float64Array.from(P.camera.c),
    };
  };
  E.load = (sv) => {
    RANGES.forEach(([lo], k) => { const b = sv.chunks[k]; for (let i = 0; i < b.length; i++) mem.w8(lo + i, b[i]); });
    for (let i = 0; i < sv.hp.length; i++) mem.w8(HB + i, sv.hp[i]);
    heap = sv.heap; E.ticks = sv.ticks; O.vars.a.set(sv.vars); rngO.state = sv.rngO; rngP.state = sv.rngP; cutO.left = sv.cutO; cutP.left = sv.cutP;
    rs.forEach((r, i) => { const a = sv.anims[i]; if (a && r.anim) Object.assign(r.anim, a); });
    restore(P, sv.port); P.tickCount = sv.tickCount; P.camera.c.set(sv.camera);
    cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate();
  };
  return E;
}

/** one tick of the port with the held buttons (the logical bits of game/input.ts): the cutscene's per-tick part, the nodes (world.tick), the zone loop's tail */
export function portTick(E, ZoneLoop, loop, heldMask) {
  const { P, S, cutP, logP } = E;
  logP.length = 0; P.__rand = 0; E.vP.length = 0;
  const i = P.input;
  i.prevHeld = i.held; i.held = heldMask; i.pressed = (heldMask ^ i.prevHeld) & heldMask;
  cutP.tick();
  P.tick();
  const banner = loop ? loop.update(P, S, cutP.active()) : 0;
  return { log: logP.slice(), banner };
}

// ------------------------------------------------------------------------------------------------ comparison of the node state: [name, offset of the original's node, type, port getter]
const V3 = (o, name, get) => [0, 1, 2].map((i) => [`${name}[${i}]`, o + 4 * i, 'f', (n) => get(n)[i]]);
export const NODEMAP = {
  pepbrp: (S) => [
    ['R', 0x14, 'f', (n) => n.R], ['angle0', 0x18, 'f', (n) => n.angle0], ['omega', 0x74, 'f', (n) => n.omega], ['angle', 0x78, 'f', (n) => n.angle], ['prevAngle', 0x7c, 'f', (n) => n.prevAngle],
    ['g', 0x5c, 'f', (n) => n.g], ...V3(0x60, 'prevPos', (n) => n.prevPos),
    ['dirFlags', 0x6c, 'u', (n) => n.dirFlags], ['prevDirFlags', 0x70, 'u', (n) => n.prevDirFlags], ['animRes', 0x88, 'b', (n) => n.animRes],
    ['air', 0x89, 'b', (n) => (n.air ? 1 : 0)], ['sw1', 0x8a, 'b', (n) => (n.sw1 ? 1 : 0)], ['sw2', 0x8b, 'b', (n) => (n.sw2 ? 1 : 0)], ['crumble', 0x8c, 'b', (n) => (n.crumble ? 1 : 0)],
    ['arc', 0x8d, 'b', (n) => (n.arc ? 1 : 0)], ['lift', 0x8e, 'b', (n) => (n.lift ? 1 : 0)], ['facing', 0x8f, 'b', (n) => n.facing], ['prevFacing', 0x90, 'b', (n) => n.prevFacing],
    ['hold', 0x94, 'f', (n) => n.hold], ['hold2', 0x98, 'f', (n) => n.hold2], ['t', 0x9c, 'f', (n) => n.t], ['y0', 0xa0, 'f', (n) => n.y0], ['yAir', 0xa4, 'f', (n) => n.yAir],
    ['v0', 0xa8, 'f', (n) => n.v0], ['vel', 0xac, 'f', (n) => n.vel],
  ],
  peptop: () => [
    ['yawUp', 0x18, 'f', (n) => n.yaw[0]], ['yawDown', 0x20, 'f', (n) => n.yaw[1]], ['yawRight', 0x24, 'f', (n) => n.yaw[2]], ['yawLeft', 0x1c, 'f', (n) => n.yaw[3]],
    ...V3(0x68, 'dirUp', (n) => n.dirs[0]), ...V3(0x74, 'dirDown', (n) => n.dirs[1]), ...V3(0x8c, 'dirRight', (n) => n.dirs[2]), ...V3(0x80, 'dirLeft', (n) => n.dirs[3]),
    ['floorY', 0x98, 'f', (n) => n.floorY], ...V3(0xa0, 'throwDir', (n) => n.throwDir), ...V3(0xac, 'startPos', (n) => n.startPos),
    ['dir', 0xb8, 'i', (n) => n.dir], ['prevDir', 0xbc, 'i', (n) => n.prevDir], ...V3(0xc0, 'step', (n) => n.step), ...V3(0xcc, 'pizzaStep', (n) => n.pizzaStep),
    ['flying', 0xd8, 'u', (n) => (n.flying ? 1 : 0)], ...V3(0xdc, 'pizzaStart', (n) => n.pizzaStart), ['hits', 0xe8, 'u', (n) => n.myHits], ['age', 0xec, 'f', (n) => n.age],
    ['spin', 0xf0, 'f', (n) => n.spin], ['fall', 0xf4, 'i', (n) => n.fall], ['animRes', 0xf8, 'u', (n) => n.animRes],
  ],
  brickst: () => [
    ...V3(0x14, 'vec0', (n) => n.vec[0]), ...V3(0x20, 'vec1', (n) => n.vec[1]), ['yawTo0', 0x2c, 'f', (n) => n.yawTo[0]], ['yawTo1', 0x30, 'f', (n) => n.yawTo[1]], ...V3(0x34, 'start', (n) => n.start),
    ['idx', 0x40, 'u', (n) => n.idx], ['timer', 0x44, 'f', (n) => n.timer], ['going', 0x48, 'u', (n) => (n.going ? 1 : 0)], ['period', 0x4c, 'f', (n) => n.period], ['seen', 0x50, 'u', (n) => n.seen],
    ['reacting', 0x54, 'u', (n) => (n.reacting ? 1 : 0)], ['animRes', 0x58, 'u', (n) => n.animRes], ['stage', 0x5c, 'b', (n) => n.stage],
  ],
  bottop: () => [
    ['baseY', 0x14, 'f', (n) => n.baseY], ...V3(0x34, 'row', (n) => n.row), ['yaw', 0x40, 'f', (n) => n.yaw], ['timer', 0x44, 'f', (n) => n.timer], ['animRes', 0x54, 'u', (n) => n.animRes], ['stage', 0x58, 'b', (n) => n.stage],
  ],
  zonetop: () => [
    ['period', 0x6b8, 'f', (n) => n.period], ['fallLen', 0x6bc, 'i', (n) => n.fallLen], ['nextRow', 0x71c, 'i', (n) => n.nextRow], ['timer', 0x720, 'f', (n) => n.timer], ['falling', 0x724, 'i', (n) => n.falling],
    ['fallTicks', 0x728, 'i', (n) => n.fallTicks], ['speed', 0x72c, 'f', (n) => n.speed], ['doorTimer', 0x730, 'f', (n) => n.doorTimer],
  ],
  zonebrp: () => [
    ['y2', 0xc0, 'f', (n) => n.y2], ['y7', 0xc8, 'f', (n) => n.y7], ['arcHi', 0xd0, 'f', (n) => n.arcHi], ['arcLo', 0xd4, 'f', (n) => n.arcLo], ['arcY', 0xd8, 'f', (n) => n.arcY], ['arcR', 0xdc, 'f', (n) => n.arcR],
    ['y3', 0x118, 'f', (n) => n.y3], ['y8', 0x11c, 'f', (n) => n.y8], ['timer', 0x1e8, 'f', (n) => n.timer], ['movingOut', 0x1ec, 'b', (n) => (n.movingOut ? 1 : 0)], ['fallSpeed', 0x1f0, 'f', (n) => n.fallSpeed],
    ['arcAngle', 0x1f4, 'f', (n) => n.arcAngle], ['arcNow', 0x1f8, 'f', (n) => n.arcNow], ['arcDir', 0x204, 'u', (n) => n.arcDir],
    ...[0, 1, 2, 3, 4, 5].flatMap((k) => V3(0x74 + 12 * k, `slider${k}start`, (n) => n.start[k])), ...[0, 1, 2, 3, 4, 5].flatMap((k) => V3(0x2c + 12 * k, `slider${k}out`, (n) => n.out[k])),
  ],
};
/** the float32 spacing at v */
export const ulp32 = (v) => { const a = Math.abs(v); return a < 1.2e-38 ? 1.4e-45 : 2 ** (Math.floor(Math.log2(a)) - 23); };
const readT = (mem, a, t) => (t === 'f' ? mem.f32(a) : t === 'u' ? mem.u32(a) : t === 'i' ? mem.r32(a) : mem.r8(a));

/** the globals of the zone (DAT_05d5f5xx) against the port's BrpState */
export const GLOBALS = [
  ['knock', 0x5d5f5b8, 'u', (S) => S.knock], ['hits', 0x5d5f5bc, 'u', (S) => S.hits], ['endState', 0x5d5f5d4, 'u', (S) => S.endState], ['endTimer', 0x5d5f5d8, 'u', (S) => S.endTimer],
  ['respawn', 0x5d5f5dc, 'u', (S) => S.respawn], ['knockTimer', 0x5d5f5e0, 'f', (S) => S.knockTimer], ['liftHit', 0x5d5f5e8, 'u', (S) => S.liftHit], ['reset5ec', 0x5d5f5ec, 'u', (S) => S.reset5ec],
  ['knockDirX', 0x5d5f5f0, 'f', (S) => S.knockDir[0]], ['knockDirY', 0x5d5f5f4, 'f', (S) => S.knockDir[1]], ['knockDirZ', 0x5d5f5f8, 'f', (S) => S.knockDir[2]],
  ['reset5fc', 0x5d5f5fc, 'u', (S) => S.reset5fc], ['reset600', 0x5d5f600, 'u', (S) => S.reset600], ['firstTop', 0x958a60, 'u', (S) => S.firstTop], ['firstRun', 0x958ad8, 'u', (S) => S.firstRun],
];

/**
 * Compare the state of the port with the original's after a tick. `tol` = relative tolerance of floats (float32 noise); returns { checks, bad[] }.
 * `skip` = names (`record N`, `node kind.field`, `global x`) that are known deviations: counted in `known`.
 */
export function compareState(E, label, o = {}) {
  const { mem, P, S } = E;
  // float32 noise: 8 ulps of the original's value plus 1e-6 absolute (matrices hold sin / cos of float32 angles: a 4e-8 residue where the port's double pi / 2 gives 6e-17)
  const ulps = o.ulps ?? 0, floor = o.floor ?? 0, res = { checks: 0, bad: [], known: [], maxUlps: 0 };
  const near = (a, b) => {
    if (a === b) return true;
    const d = Math.abs(a - b);
    if (d > ulps * ulp32(b) + floor) return false;
    res.maxUlps = Math.max(res.maxUlps, d / Math.max(1e-30, Math.abs(b)) > 1e-9 ? d / ulp32(Math.max(1, Math.abs(b))) : 0);
    return true;
  };
  const rep = (key, msg) => { (o.known?.has(key) ? res.known : res.bad).push(`${label}: ${msg}`); };
  // records: matrix + flags (+0x60, 16 bits)
  const recs = o.records ?? P.records.map((r) => r.index);
  for (const i of recs) {
    const a = E.readRec(i), p = P.records[i];
    res.checks++;
    const fm = o.flagMask ?? 0xffff;
    let same = (p.flags & fm) === (a.flags & fm), first = -1;
    if (!(o.ignoreHiddenMatrix && (a.flags & 2) === 0 && (p.flags & 2) === 0)) for (let k = 0; k < 16 && same; k++) if (!near(p.m[k], a.m[k])) { same = false; first = k; }
    if (!same) rep(`record ${i}`, `record ${i} ${p.name}: port flags ${(p.flags & 0xffff).toString(16)} m ${[...p.m].map((v) => +v.toFixed(4))}; original flags ${a.flags.toString(16)} m ${a.m.map((v) => +v.toFixed(4))}${first >= 0 ? `; element ${first}: port ${p.m[first]}, original ${a.m[first]}` : ''}`);
  }
  // nodes
  const ports = { pepbrp: S.pepbrp, peptop: S.peptop, brickst: S.brickster, zonetop: S.zonetop, zonebrp: S.zonebrp };
  for (const ent of E.nodes) {
    const pn = ent.kind === 'bottop' ? S.bots[REC.BOTS.indexOf(ent.rec.index)] : ports[ent.kind];
    if (!pn) continue;
    for (const [name, off, t, get] of NODEMAP[ent.kind](S)) {
      if (o.nodes && !o.nodes.has(ent.kind)) continue;
      const a = get(pn), b = readT(mem, ent.node + off, t);
      res.checks++;
      if (!(t === 'f' ? near(a, b) : a === b)) rep(`node ${ent.kind}.${name}`, `node ${ent.kind}${ent.kind === 'bottop' ? ent.rec.index : ''}.${name} (+0x${off.toString(16)}): port ${a}, original ${b}`);
    }
  }
  // globals, variables, camera
  const globals = o.loop ? [...GLOBALS, ['elapsed', 0x5d5f4c4, 'u', (SS) => SS.elapsed]] : GLOBALS;
  for (const [name, addr, t, get] of globals) {
    if (o.skip?.has(name)) continue;
    const a = get(S), b = readT(mem, addr, t);
    res.checks++;
    if (!(t === 'f' ? near(a, b) : a === b)) rep(`global ${name}`, `global ${name}: port ${a}, original ${b}`);
  }
  for (let v = 0; v < E.O.vars.a.length; v++) { res.checks++; if (P.vars.a[v] !== E.O.vars.a[v]) rep(`var ${v}`, `var 0x${v.toString(16)}: port ${P.vars.a[v]}, original ${E.O.vars.a[v]}`); }
  if (!o.noCamera) for (let i = 0; i < 6; i++) { res.checks++; const a = P.camera.c[i], b = mem.f32(0x9da5e8 + 4 * i); if (!near(a, b)) rep(`camera ${i}`, `camera[${i}]: port ${a}, original ${b}`); }
  // animation instances
  for (let i = 0; i < P.records.length; i++) {
    const a = P.records[i].anim, b = E.O.records[i].anim;
    if (!a || !b) continue;
    res.checks++;
    if (a.clip !== b.clip || Math.abs(a.frame - b.frame) > 1e-4) rep(`anim ${i}`, `animation of record ${i} ${P.records[i].name}: port clip ${a.clip} frame ${a.frame}, original clip ${b.clip} frame ${b.frame}`);
  }
  return res;
}

/** compare two ordered event logs (sounds, speech, letterbox, cutscene); 3D positions with a tolerance */
export function compareLogs(label, a, b, tol = 1e-3) {
  const bad = [];
  let checks = 1;
  const same = a.length === b.length && a.every((e, i) => e[0] === b[i][0] && e.slice(1).every((x, q) => (typeof x === 'number' && typeof b[i][q + 1] === 'number' ? Math.abs(x - b[i][q + 1]) <= tol * Math.max(1, Math.abs(x)) : x === b[i][q + 1])));
  if (!same) bad.push(`${label}: events: port ${JSON.stringify(a)} original ${JSON.stringify(b)}`);
  return { checks, bad };
}

// ------------------------------------------------------------------------------------------------ the zone loop FUN_0081fd64 natively
/** a thrown marker that ends the loop run */
class LoopDone extends Error {}

/**
 * Run the ORIGINAL zone loop (FUN_0081fd64: set-up FUN_008212a3, modes 0 / 1 / 9 / 2 / 10 / 4, the clock, the end sequence, the score) with the port ticking in step: the update pass
 * (FUN_0042226e) is a host function that runs the original node updates natively (`E.pass`) and one tick of the port (`ZoneLoop`); the input sampler (FUN_0081fcfd) delivers the
 * script's buttons. `script`: { held(info) -> logical button bits, onTick(info) after a mode-2 frame's update pass, onFrame(info) at the end of every frame, done(info) -> boolean }.
 * `info` = { frame, mode (the loop's `local_c` before this frame), tick, E }.
 */
export function runZoneLoop(E, loopPort, script) {
  const { cpu, mem, P, S } = E;
  const hook = (a, f) => cpu.hooks.set(a, f);
  const info = { frame: 0, mode: 0, tick: 0, E, texts: [], modes: [], held: 0, prevHeld: 0, banner: 0, help2: [] };
  E.info = info;
  const modeAt = {};
  let modePtr = 0;
  const noop = (a) => hook(a, () => {});
  for (const a of [0x45f9d2, 0x41b40e, 0x435cab, 0x435c81, 0x42207d, 0x443de0, 0x444850, 0x444ed0, 0x435b59, 0x435a07, 0x4359df, 0x437411, 0x43ec70, 0x4225c5, 0x42271b, 0x427233, 0x435a5e, 0x442930, 0x88fd0f,
    0x460a3d, 0x46055f, 0x461155, 0x443310, 0x4432c0, 0x443e40, 0x45f9a6, 0x445d20, 0x439f51, 0x43c70f, 0x444370, 0x45c310, 0x45c366, 0x45c397, 0x442900, 0x43895b, 0x4630c0, 0x831690, 0x8387c0, 0x439f47,
    0x4232a0, 0x443300, 0x45f9b0, 0x435ba8, 0x435b5e, 0x41b4af, 0x43ec80, 0x4359e4, 0x4359f3, 0x4060f0, 0x406112, 0x40979c, 0x48c7b0, 0x43455a, 0x404d14, 0x41c080, 0x442d90, 0x423ad4, 0x820f01]) noop(a);
  hook(0x43421d, () => { cpu.eax = 0x5555; }); hook(0x443290, () => { cpu.eax = 0x5556; }); hook(0x439f36, () => { cpu.eax = 0x5557; }); hook(0x439126, () => { cpu.eax = 0x5558; });
  hook(0x423f7b, () => { cpu.eax = 0; });
  hook(0x404be7, () => { cpu.eax = 0; });
  hook(0x41bd3d, () => { cpu.eax = 0; }); hook(0x41c092, () => { cpu.eax = 0; });
  // the clocks: nodes see the tick clock (like the port's S.clock()), the loop's samples a clock of one 2 * dt step per loop iteration
  hook(0x435cbb, () => {
    const from = cpu.callAt;
    cpu.eax = from >= 0x81fd64 && from < 0x820b70 ? Math.trunc(info.frame * 2 * E.dt) : Math.trunc(E.ticks * 2 * E.dt);
  });
  // text: FUN_00439c6f(table, font, text, align, ?, x, y, maxChars); sprintf for the clock and the score
  hook(0x439c6f, (c) => { info.texts.push([mem.cstr(c.arg(2)), c.arg(5), c.arg(6)]); });
  hook(0x85ac00, (c) => {
    const fmt = mem.cstr(c.arg(1));
    let ai = 2, out = '';
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      let j = i + 1, zero = false, w = '';
      if (fmt[j] === '0') { zero = true; j++; }
      while (/\d/.test(fmt[j])) w += fmt[j++];
      if (fmt[j] === 'd') { let t = String(c.arg(ai++) | 0); if (w) t = t.padStart(+w, zero ? '0' : ' '); out += t; i = j; } else throw new Error('sprintf ' + fmt);
    }
    for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
    mem.w8(c.arg(0) + out.length, 0);
    cpu.eax = out.length;
  });
  // the message pump (PeekMessageA / TranslateMessage / DispatchMessageA through the import table): no messages
  for (const [slot, bytes] of [[0x5df15a8, 20], [0x5df15ac, 4], [0x5df15b0, 4]]) hook(mem.u32(slot), (c) => { c.eax = 0; return bytes; });
  // the input sampler FUN_0081fcfd(&local_c)
  hook(0x81fcfd, (c) => {
    modePtr = c.arg(0);
    info.mode = mem.r32(modePtr);
    info.frame++;
    if (!info.modes.length || info.modes[info.modes.length - 1][1] !== info.mode) info.modes.push([info.frame, info.mode]);
    if (script.done?.(info)) throw new LoopDone();
    const held = script.held(info) | 0;
    const pressed = (held ^ info.prevHeld) & held;
    info.held = held; info.prevHeld = held;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x983848, held); mem.w32(0x98384c, 0); mem.w32(0x983850, 0);
    info.pressed = pressed;
    info.texts.length = 0; E.log.length = 0;
  });
  // the cutscene frame (FUN_0045c402) and the update pass (FUN_0042226e): the original nodes natively + one port tick
  hook(0x45c402, () => { E.cutO.tick(); });
  hook(0x42226e, () => {
    E.log.length = 0; E.rand = 0;
    E.setInput(info.held, info.pressed);
    const orig = E.pass();
    const i = P.input;
    i.prevHeld = i.held; i.held = info.held; i.pressed = (info.held ^ i.prevHeld) & info.held;
    E.cutP.tick();
    E.logP.length = 0; P.__rand = 0;
    P.tick();
    info.banner = loopPort.update(P, S, E.cutP.active()) || info.banner;
    info.tick++;
    info.orig = orig; info.port = E.logP.slice();
    script.onTick?.(info);
  });
  hook(0x435d0d, () => { script.onFrame?.(info); });
  try { cpu.steps = 0; cpu.call(0x81fd64, [], { maxSteps: 600_000_000 }); }
  catch (e) { if (!(e instanceof LoopDone) && !String(e.message).includes('LoopDone')) throw e; }
  return info;
}

/** put Pepper (side run) on the tower circle at `angle` (the node's angle, radians) standing at height y, in the original (emulated memory) and in the port, then let both settle with one tick */
export function teleportPepper(E, angle, y) {
  const { mem, S } = E;
  const F = Math.fround, node = E.node('pepbrp').node, R = S.pepbrp.R;
  const a = F(angle), x = F(F(Math.sin(a)) * R), z = F(F(Math.cos(a)) * R);
  const p = E.recPtr(90);
  mem.wf32(node + 0x78, a); mem.wf32(node + 0x7c, a); mem.wf32(node + 0x94, 0);
  mem.wf32(p + 0x3c, x); mem.wf32(p + 0x40, y); mem.wf32(p + 0x44, z);
  for (const [k, v] of [[0x60, x], [0x64, y], [0x68, z]]) mem.wf32(node + k, v);
  mem.w8(node + 0x89, 0);
  const n = S.pepbrp, r = E.P.records[90];
  n.angle = n.prevAngle = a; n.hold = 0; n.air = false; n.prevPos = [x, y, z];
  r.m[12] = x; r.m[13] = y; r.m[14] = z;
}

/** the zone's restart (the pause menu's "restart": FUN_00821428 = FUN_008276f0 (HUD tables, not modelled) + FUN_00820f4e(0): the constructors run again in their re-init branches on the existing nodes) */
export function restartOriginal(E) {
  E.cpu.steps = 0;
  E.cpu.call(0x820f4e, [0], { maxSteps: 20_000_000 });
  E.rescan();
}
