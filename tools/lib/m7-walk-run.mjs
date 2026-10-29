// M7 / WP-VERIFY: the scenario runner shared by the tools/tests/m7-walk-*.mjs oracle tests: a random key script, one tick of the port next to one tick of the original (tools/lib/m7-walk-emu.mjs),
// the comparison with explicit tolerances, and the aggregate statistics (states visited, events, maximum observed differences, branch coverage of the original's code).
import { loadZone } from './engine-load.mjs';
import { createWalkHarness, createCoverage, NODE_FIELDS } from './m7-walk-emu.mjs';
import { V } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

/** seeded random source */
export function rng(seed) { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (n) => Math.floor(f() * n); return f; }

// tolerances: the port (walk node, collision, animation) and the camera (src/game/camera.ts, bit-exact since WP-ISLAND-FIX: CAM-1 .. CAM-3 closed) are float32-faithful, so EVERYTHING is compared with tolerance 0 (bit for bit).
export const TOL = { rel: 0, rot: 0, free: 0, cam: 0 };
const DISCRETE = ['state', 'shift', 'animResult', 'hideFlag', 'landFlag', 'dirFlag', 'slideFlag', 'rampX', 'rampY', 'camRampX', 'camRampY'];

const DIRS = [[B.UP, 40], [B.UP | B.LEFT, 10], [B.UP | B.RIGHT, 10], [B.LEFT, 6], [B.RIGHT, 6], [B.DOWN, 5], [B.DOWN | B.LEFT, 2], [B.DOWN | B.RIGHT, 2], [0, 19]];
const CAMKEYS = [B.Z, B.X, B.C, B.KEY1000, B.X | B.C, B.KEY1000 | B.Z];
/** a random key script: direction segments (weights above), jump (Alt) taps, camera key segments. o: { maxSeg, jump (per tick), camera: false, dir: [[bits, weight]] } */
export function makeScript(seed, ticks, o = {}) {
  const r = rng(seed);
  const held = new Array(ticks).fill(0);
  const dirs = o.dir ?? DIRS;
  const total = dirs.reduce((a, d) => a + d[1], 0);
  let t = 0;
  while (t < ticks) {
    let k = r() * total, d = 0;
    for (const [bits, w] of dirs) { if (k < w) { d = bits; break; } k -= w; }
    const len = 2 + r.int(o.maxSeg ?? 50);
    for (let i = 0; i < len && t + i < ticks; i++) held[t + i] |= d;
    t += len;
  }
  const jp = o.jump ?? 0.02;
  for (let i = 0; i < ticks; i++) if (r() < jp) { const n = 1 + r.int(3); for (let j = 0; j < n && i + j < ticks; j++) held[i + j] |= B.ALT; i += n; }
  if (o.camera !== false) {
    t = 0;
    while (t < ticks) { t += 10 + r.int(80); if (r() < 0.3) { const k = CAMKEYS[r.int(CAMKEYS.length)], len = 1 + r.int(25); for (let i = 0; i < len && t + i < ticks; i++) held[t + i] |= k; t += len; } }
  }
  return held;
}
/** a script of constant key sets: [[bits, ticks], ...] */
export function constScript(parts) { const out = []; for (const [bits, n] of parts) for (let i = 0; i < n; i++) out.push(bits); return out; }

const COV_ENTRIES = [[0x42d514, 'walk 42d514'], [0x42a88f, 'transition 42a88f'], [0x429e00, 'tilt 429e00'], [0x42a654, 'input 42a654'], [0x42a487, 'ramp 42a487'], [0x42baf6, 'footsteps 42baf6'], [0x42c227, 'camera 42c227'], [0x42b8e8, 'camera keys 42b8e8'],
  [0x441270, 'sweep 441270'], [0x441b10, 'ray 441b10'], [0x441ac0, 'probe 441ac0'], [0x440810, 'polygon 440810'], [0x4405f0, 'cells 4405f0'], [0x43f810, 'box quick 43f810'], [0x43f9b0, 'box exact 43f9b0'], [0x43d159, 'sphere 43d159'], [0x43cd62, 'terrain 43cd62'],
  [0x4425f0, 'terrain ray 4425f0'], [0x43b6a3, 'anim start'], [0x43b76a, 'anim advance'], [0x43cec0, 'normalize 43cec0'], [0x440f30, 'box shape 440f30']];

export async function createRunner(ctx, opt = {}) {
  const R = { failures: [], notes: [], checked: 0, stats: { ticks: 0, scen: 0, states: {}, maxd: {}, sounds: 0, stops: 0, events: {}, ms: 0 }, known: {}, covered: opt.coverage !== false ? null : false };
  const MAXFAIL = opt.maxFail ?? 30;
  const bad = (msg) => { if (R.failures.length < MAXFAIL) R.failures.push(msg); else if (R.failures.length === MAXFAIL) R.failures.push('... more failures'); };
  R.bad = bad;
  const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
  R.bump = bump;
  const isCam = (m) => m.startsWith('camera') || m.startsWith('node.camStick') || m.startsWith('cache.');

  const cmpTick = (a, b, soundsA, soundsB, o) => {
    const msgs = [];
    const tolRel = o.rel ?? TOL.rel, tolRot = o.rot ?? TOL.rot;
    const st = R.stats;
    const num = (name, x, y, cls, tol) => {
      R.checked++;
      const d = Math.abs(x - y), sc = cls === 'rot' ? 1 : Math.max(1, Math.abs(y));
      if (!(d <= tol * sc)) { if (!(Number.isNaN(x) && Number.isNaN(y))) msgs.push(`${name}: original ${y}, port ${x}`); }
      else if (d / sc > (st.maxd[cls] ?? 0)) st.maxd[cls] = d / sc;
    };
    const exact = (name, x, y) => { R.checked++; if (x !== y) msgs.push(`${name}: original ${y}, port ${x}`); };
    for (const k of NODE_FIELDS) { if (DISCRETE.includes(k)) exact(`node.${k}`, a.node[k], b.node[k]); else num(`node.${k}`, a.node[k], b.node[k], 'val', tolRel); }
    exact('node.stamp', a.node.stamp, b.node.stamp);
    for (let i = 0; i < 16; i++) { if (i >= 12 && i <= 14) num(`rec.m${i}`, a.rec.m[i], b.rec.m[i], 'pos', tolRel); else if (i === 3 || i === 7 || i === 11 || i === 15) exact(`rec.m${i}`, a.rec.m[i], b.rec.m[i]); else num(`rec.m${i}`, a.rec.m[i], b.rec.m[i], 'rot', tolRot); }
    for (let i = 0; i < 3; i++) num(`rec.e${i}`, a.rec.e[i], b.rec.e[i], 'val', tolRel);
    exact('rec.flags', a.rec.flags, b.rec.flags);
    const tolCam = o.cam ?? TOL.cam;
    let camD = 0;
    for (let i = 0; i < 18; i++) camD = Math.max(camD, Math.abs(a.camera[i] - b.camera[i]));
    R.lastCamDelta = camD; R.lastVelDelta = Math.abs(a.camVel - b.camVel);
    for (let i = 0; i < 18; i++) num(`camera[${i}]`, a.camera[i], b.camera[i], 'cam', tolCam);
    num('camera.vel', a.camVel, b.camVel, 'cam', tolCam);
    for (const k of Object.keys(b.glob)) exact(`glob.${k}`, a.glob[k], b.glob[k]);
    exact('anim.clip', a.anim.clip, b.anim.clip); num('anim.frame', a.anim.frame, b.anim.frame, 'val', tolRel);
    exact('accessory.flags', a.accessoryFlags, b.accessoryFlags);
    // the global collision state (hit cache of FUN_00441b10, polygon of the last hit): record and polygon (object, index) exactly, the cached end points as floats
    exact('cache.rec', a.cache.rec, b.cache.rec); exact('cache.poly', JSON.stringify(a.cache.poly), JSON.stringify(b.cache.poly));
    if (b.cache.rec >= 0) for (let i = 0; i < 3; i++) { num(`cache.from[${i}]`, a.cache.from[i], b.cache.from[i], 'val', tolRel); num(`cache.to[${i}]`, a.cache.to[i], b.cache.to[i], 'val', tolRel); }
    R.checked++; if (JSON.stringify(soundsA) !== JSON.stringify(soundsB)) msgs.push(`sounds: original ${JSON.stringify(soundsB)}, port ${JSON.stringify(soundsA)}`);
    return msgs;
  };

  /**
   * one scenario. S: { name, zone, pos?, yaw?, subgame?, dt, held[], mouse?[], free?, setup?(L, w), cull? }
   */
  R.scenario = (S) => {
    const t0 = Date.now();
    const L = loadZone(ctx, S.zone, { pos: S.pos, yaw: S.yaw, subgame: S.subgame });
    const w = L.world;
    w.dt = S.dt;
    if (S.subgame !== undefined) w.vars.set(V.CURRENT_SUBGAME, S.subgame);
    if (S.setup) S.setup(L, w);
    const H = createWalkHarness(ctx, L, { zone: S.zone, cull: S.cull });
    if (R.covered === null) R.covered = createCoverage(H.E, COV_ENTRIES);
    if (R.covered && !S.noCoverage) H.trace = R.covered.trace;
    w.externalInput = true;
    const rec0 = L.pepper;     // the record's yaw is a float32 in the original; the set-up leaves a double
    let prev = 0;
    const sounds = []; w.sfx = { play: (id) => sounds.push(id) };
    const visited = new Set();
    let nbad = 0, lastState = -1;
    R.stats.scen++;
    const tag = `${S.name}${S.dt !== 1 ? ` dt ${S.dt}` : ''}${S.free ? ' free' : ''}`;
    for (let t = 0; t < S.held.length; t++) {
      const held = S.held[t], pressed = held & ~prev; prev = held;
      w.input.held = held; w.input.pressed = pressed; w.input.prevHeld = held;
      if (t === 0) rec0.ry = Math.fround(rec0.ry);
      // the mouse (FUN_00437ca5): S.mouse[t] = { buttons, dx, dy } for both sides, default centred
      { const m = S.mouse?.[t] ?? { buttons: 0, dx: 0, dy: 0 }; H.mouse = m; w.input.mouse = m; }
      S.inject?.(t, w, L.walk, rec0);
      if (S.free) { if (t === 0) H.pushState(); else H.cullRecords(); H.setInput(held, pressed); } else H.push(held, pressed);
      let orig;
      S.hook?.(t, 'pre', H, w);
      try { H.run(); orig = H.pull(); } catch (e) { bad(`${tag} tick ${t}: the original failed: ${e.message}`); return visited; }
      sounds.length = 0;
      S.hook?.(t, 'orig', H, w);
      w.tick();
      S.hook?.(t, 'post', H, w);
      const mine = H.portState();
      R.stats.ticks++; bump(R.stats.states, orig.node.state); visited.add(orig.node.state);
      R.stats.stops += orig.stops; R.stats.sounds += orig.sounds.length;
      if (orig.node.state !== lastState) { bump(R.stats.events, `enter 0x${orig.node.state.toString(16)}`); lastState = orig.node.state; }
      let msgs0 = cmpTick(mine, orig, sounds.slice(), orig.sounds, S.free ? { rel: TOL.free, rot: TOL.free } : {});
      const msgs = S.noCamera ? msgs0.filter((m) => !isCam(m)) : msgs0;
      if (msgs.length) {
        nbad++;
        if (nbad <= 2) bad(`${tag} tick ${t} (state 0x${orig.node.state.toString(16)}, held 0x${held.toString(16)}): ${msgs.slice(0, 5).join(' | ')}${msgs.length > 5 ? ` (+${msgs.length - 5})` : ''}`);
        if (S.free) break;
      }
    }
    H.trace = null;
    R.stats.ms += Date.now() - t0;
    return visited;
  };

  R.summary = () => {
    const st = R.stats;
    const notes = [];
    notes.push(`scenarios ${st.scen}, ticks ${st.ticks}, checks ${R.checked}, ${st.ms} ms`);
    notes.push(`states entered / ticks per state: ${Object.entries(st.states).sort((x, y) => x[0] - y[0]).map(([k, v]) => `0x${(+k).toString(16)}:${v}`).join(' ')}`);
    notes.push(`state entries: ${Object.entries(st.events).sort().map(([k, v]) => `${k.replace('enter ', '')}:${v}`).join(' ')}; sounds compared ${st.sounds}, original stop calls ${st.stops} (not compared: the port has no stop)`);
    notes.push(`tolerance 0 (bit for bit) on every compared value; max observed |diff| ${Object.keys(st.maxd).length ? JSON.stringify(st.maxd) : 'none (all equal)'}`);
    if (R.covered) { const r = R.covered.report(); notes.push(`branch outcomes of the original's code covered: ${r.covered} / ${r.total}: ${r.per.map((p) => `${p.name} ${p.covered}/${p.outcomes}`).join(', ')}`); R.cov = r; if (process.env.M7_COV_OUT) { const fs = globalThis.process.getBuiltinModule?.('node:fs'); fs?.appendFileSync(process.env.M7_COV_OUT, JSON.stringify({ covered: r.coveredList, funcs: r.funcs }) + '\n'); } }

    return notes;
  };
  return R;
}

/**
 * places on the island where the ground drops by more than 4 within 2.5 units (cliffs, the edge of the harbour): [{ x, z, h, dx, dz, drop }]; Pepper starts 4 units before the edge facing it
 * (deterministic scan of the terrain with the port's own terrain ray, which m7-walk-col proved identical to the original's)
 */
export function findLedges(ctx, zone = 'z02LGI') {
  const L = loadZone(ctx, zone), w = L.world, out = [];
  for (let x = -400; x <= 600; x += 10) for (let z = -400; z <= 400; z += 10) {
    const h0 = w.col.terrainHeight(x, 80, z, 0); if (h0 < -1e30 || h0 < 5) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const h1 = w.col.terrainHeight(x + dx * 2.5, 80, z + dz * 2.5, 0);
      const hb = w.col.terrainHeight(x - dx * 4, 80, z - dz * 4, 0);
      if (h1 > -1e30 && hb > -1e30 && Math.abs(hb - h0) < 1 && h0 - h1 > 4) { out.push({ x, z, h: h0, dx, dz, drop: h0 - h1, hb }); break; }
    }
  }
  return out;
}
