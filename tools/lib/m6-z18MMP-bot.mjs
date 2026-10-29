// A scripted player for z18MMP (docs/re/m6/z18MMP.md): plays the whole tomb with the game's own keys. Used by the node tests (tools/tests/m6-z18MMP.mjs, on a world built
// by loadZone) and by the headless browser runs (tools/steps/m6-z18MMP*.mjs, real key presses on the page): `snapshotFromZone` builds the plain-data view of the game (it
// has no imports so the browser steps can send its source to the page), `Z18Bot.step(snapshot)` answers with the keys to hold. The bot reads the symbols of the coffins from the
// snapshot (it "knows" the pairs), walks along the ring of coffins like a player would, keeps away from the three roaming mummies, takes the key, runs to the page and
// steers through the collapse. `mode: 'careless'` opens a wrong pair first.

export const KEY = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown', SHIFT: 'ShiftLeft' };

/** the plain-data view of a running game: `zone` = `{ world, game: { mmp: { shared, run, nodes } } }` (window.__zone of the browser page, or the same shape in node) */
export function snapshotFromZone(zone) {
  const w = zone.world, m = zone.game.mmp, rs = w.records, c = w.camera.c, v = w.vars;
  const SYM = [25, 26, 24, 28, 30, 32, 33, 27, 29, 31, 34, 35], CASE = [96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 95];
  const p = rs[121];
  return {
    tick: w.tickCount, sec: m.shared.seconds, danger: m.shared.danger, over: m.run.result !== 0, result: m.run.result, reason: m.run.reason,
    p: { x: p.x, y: p.y, z: p.z, state: m.nodes.pepper.state, visible: (p.flags & 2) !== 0 },
    cam: { rx: c[9], rz: c[11], fx: c[15], fz: c[17] },
    guards: [123, 124, 125].map((i) => ({ x: rs[i].x, y: rs[i].y, z: rs[i].z })),
    vars: { near: v.get(0xfc), matched: v.get(0xfd), open: v.get(0xfe), ready: v.get(0xff), pending: v.get(0xfb) },
    coffins: m.nodes.coffins.map((n) => ({ n: n.n, state: n.state })),
    sym: SYM.map((i) => rs[i].name), symPos: SYM.map((i) => [rs[i].x, rs[i].z]), caseFwd: CASE.map((i) => [rs[i].m[8], rs[i].m[10]]),
    key: { y: rs[11].y, shown: (rs[11].flags & 2) !== 0 }, door: rs[111].y, trap: rs[112].y, page: (rs[94].flags & 2) !== 0, rock: { z: rs[83].z },
  };
}

const RIGHT = [5, 4, 3, 2, 1, 0], LEFT = [6, 7, 8, 9, 10, 11];
const COMBOS = [[], [KEY.U], [KEY.D], [KEY.L], [KEY.R], [KEY.U, KEY.L], [KEY.U, KEY.R], [KEY.D, KEY.L], [KEY.D, KEY.R]];

export class Z18Bot {
  /** opts.mode: 'smart' (the pairs in order of the symbols) | 'careless' (a wrong pair first, then the right ones) | 'idle' (does nothing) */
  constructor(opts = {}) {
    this.mode = opts.mode ?? 'smart';
    this.avoid = opts.avoid ?? true;
    this.goals = null;
    this.cur = null;            // the coffin Pepper last stood at (null: at the entrance)
    this.log = [];
    this.stuck = { n: 0, at: null };
    this.phase = 'start';
  }
  /** a point d in front of coffin n (its symbol's first place: matched symbols fly to the middle of the room) */
  front(s, n, d = 4.5) { const [sx, sz] = this.home[n], [fx, fz] = s.caseFwd[n]; return [sx + fx * d, sz + fz * d]; }
  entryPath(s, n) {
    const side = RIGHT.includes(n) ? RIGHT : LEFT;
    const path = [[0, 61.5], this.front(s, side[0])];
    for (let i = 1; i <= side.indexOf(n); i++) path.push(this.front(s, side[i]));
    return path;
  }
  ringPath(s, a, b) {
    const sideOf = (n) => (RIGHT.includes(n) ? RIGHT : LEFT);
    const sa = sideOf(a), sb = sideOf(b), path = [];
    if (sa === sb) {
      const ia = sa.indexOf(a), ib = sa.indexOf(b), step = ib >= ia ? 1 : -1;
      for (let i = ia; i !== ib + step; i += step) path.push(this.front(s, sa[i]));
    } else {
      for (let i = sa.indexOf(a); i >= 0; i--) path.push(this.front(s, sa[i]));
      path.push([0, 62]);
      for (let i = 0; i <= sb.indexOf(b); i++) path.push(this.front(s, sb[i]));
    }
    return path;
  }
  pairs(s) {
    const out = [], seen = new Set();
    for (let n = 0; n < 12; n++) {
      if (seen.has(n)) continue;
      const m = s.sym.findIndex((x, i) => x === s.sym[n] && i !== n);
      seen.add(n); seen.add(m); out.push([n, m]);
    }
    return out;
  }
  /** the goals of the whole run, built when the first snapshot is seen (the symbols are known then) */
  plan(s) {
    const g = [{ t: 'idle', ticks: 20 }];
    let pairs = this.pairs(s);
    if (this.mode === 'careless') {
      // a wrong pair first: the first coffins of two different pairs that are on the same side
      const a = pairs[0][0], b = pairs.find((q) => q[0] !== a && RIGHT.includes(q[0]) === RIGHT.includes(a))?.[0] ?? pairs[1][0];
      g.push({ t: 'coffin', n: a }, { t: 'coffin', n: b }, { t: 'settle' });
    }
    for (const [a, b] of pairs) g.push({ t: 'coffin', n: a }, { t: 'coffin', n: b }, { t: 'settle' });
    g.push({ t: 'key' }, { t: 'door' }, { t: 'corridor' }, { t: 'page' }, { t: 'chase' });
    return g;
  }
  /** the key combination whose movement (relative to the camera, as the game computes it) is closest to the world direction (dx, dz) */
  keysToward(s, dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return [];
    const rl = Math.hypot(s.cam.rx, s.cam.rz) || 1, fl = Math.hypot(s.cam.fx, s.cam.fz) || 1;
    const r = [s.cam.rx / rl, s.cam.rz / rl], f = [s.cam.fx / fl, s.cam.fz / fl];
    let best = [], bd = -2;
    for (const k of COMBOS) {
      const lr = k.includes(KEY.L) ? -1 : k.includes(KEY.R) ? 1 : 0, ud = k.includes(KEY.U) ? -1 : k.includes(KEY.D) ? 1 : 0;
      const mx = lr * r[0] - ud * f[0], mz = lr * r[1] - ud * f[1], ml = Math.hypot(mx, mz);
      if (ml === 0) continue;
      const dot = (mx * dx + mz * dz) / (ml * l);
      if (dot > bd) { bd = dot; best = k; }
    }
    return best;
  }
  /** the world movement (per tick) a key combination makes: the game's own formula (relative to the camera's right / forward axes), speed 0.32 */
  moveOf(s, k) {
    const rl = Math.hypot(s.cam.rx, s.cam.rz) || 1, fl = Math.hypot(s.cam.fx, s.cam.fz) || 1;
    const lr = k.includes(KEY.L) ? -1 : k.includes(KEY.R) ? 1 : 0, ud = k.includes(KEY.U) ? -1 : k.includes(KEY.D) ? 1 : 0;
    return [(lr * s.cam.rx / rl - ud * s.cam.fx / fl) * 0.32, (lr * s.cam.rz / rl - ud * s.cam.fz / fl) * 0.32];
  }
  /**
   * steer to (tx, tz): of the nine key combinations the one with the best progress over the next 8 ticks, where a combination that brings Pepper within 3.6 of a roaming
   * mummy (which walk 0.072 per tick towards him) pays a penalty: the mummies are slow, Pepper is fast, a player simply runs around them
   */
  steer(s, tx, tz) {
    let dx = tx - s.p.x, dz = tz - s.p.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    let best = [], bs = -1e9;
    for (const k of COMBOS) {
      const [mx, mz] = this.moveOf(s, k);
      let score = 0;
      if (mx === 0 && mz === 0) score = -0.05;
      for (let t = 1; t <= 8; t++) {
        const px = s.p.x + mx * t, pz = s.p.z + mz * t;
        score += mx * dx + mz * dz;
        if (this.avoid && !(this.bold > 0)) for (const g of s.guards) {
          if (g.y > 100) continue;
          const ax = px - g.x, az = pz - g.z, r = Math.hypot(ax, az);
          const rg = Math.max(0, r - 0.072 * t);          // the mummy has come closer by now
          if (rg < 3.6) score -= (3.6 - rg) * 0.6;
        }
      }
      if (score > bs) { bs = score; best = k; }
    }
    return best;
  }
  /** one decision: the keys to hold now, null when the run is over */
  step(s) {
    if (s.over) return null;
    if (this.mode === 'idle') return [];
    if (!this.goals) { this.home = s.symPos.map((p) => [p[0], p[1]]); this.goals = this.plan(s); }
    // stuck detection (a mummy standing at the edge of its chase radius keeps the penalty of `steer` balanced): after 90 ticks without getting anywhere the bot ignores the
    // mummies for 50 ticks and accepts a hit
    const h = this.hist ?? (this.hist = []);
    h.push([s.p.x, s.p.z]);
    if (h.length > 90) h.shift();
    if (this.bold > 0) this.bold--;
    else if (h.length === 90 && Math.hypot(h[0][0] - s.p.x, h[0][1] - s.p.z) < 1.5 && ['coffin', 'key', 'door', 'corridor'].includes(this.goals[0]?.t) && s.p.state === 0 && !(this.goals[0]?.t === 'coffin' && this.sub && this.sub.stage === 'wait')) {
      this.bold = 50; this.stuck.n++; h.length = 0;
    }
    const keys = this.run(s);
    return keys;
  }
  next() { this.goals.shift(); this.sub = null; }
  run(s) {
    const g = this.goals[0];
    if (!g) return [];
    const near = (pt, tol) => Math.hypot(pt[0] - s.p.x, pt[1] - s.p.z) <= tol;
    switch (g.t) {
      case 'idle': g.ticks--; if (g.ticks <= 0) this.next(); return [];
      case 'coffin': {
        if (!this.sub) {
          this.sub = { stage: 'go', path: this.cur === null ? this.entryPath(s, g.n) : this.ringPath(s, this.cur, g.n), i: 0, t: 0 };
        }
        const u = this.sub;
        if (u.stage === 'go') {
          const pt = u.path[u.i];
          if (near(pt, 0.9)) { u.i++; if (u.i >= u.path.length) u.stage = 'approach'; }
          else return this.steer(s, pt[0], pt[1]);
        }
        if (u.stage === 'approach') {
          if ((s.vars.near & 0xfff) === (1 << g.n)) u.stage = 'knock';
          else { const [sx, sz] = this.home[g.n], [fx, fz] = s.caseFwd[g.n]; return this.steer(s, sx + fx, sz + fz); }
        }
        if (u.stage === 'knock') {
          if (s.p.state !== 0) u.stage = 'wait';
          else if (++u.t > 12) { u.stage = 'approach'; u.t = 0; }       // not accepted (a mummy hit, not in reach): try again
          else return [KEY.SHIFT];
        }
        if (u.stage === 'wait') {
          if (s.p.state === 0) { this.cur = g.n; this.next(); return []; }
          return [];
        }
        return [];
      }
      case 'settle': {
        // the pair is decided: wait until every coffin rests (closed or matched) and nothing is open
        if (!this.sub) this.sub = { t: 0 };
        this.sub.t++;
        const rest = s.coffins.every((c) => c.state === 0) && (s.vars.open & 0xfff) === 0;
        if ((rest && this.sub.t > 5) || this.sub.t > 600) this.next();
        return [];
      }
      case 'key': {
        if (!this.sub) this.sub = { i: 0, pts: [[0, 62], [0, 70], [0, 73.2]], t: 0 };
        const u = this.sub;
        if (s.vars.matched & 0x1000) { this.next(); return []; }
        if ((s.vars.ready & 0x1000) === 0) return [];       // the key is still coming down
        const pt = u.pts[Math.min(u.i, u.pts.length - 1)];
        if (near(pt, 0.6) && u.i < u.pts.length - 1) u.i++;
        return this.steer(s, pt[0], pt[1]);
      }
      case 'door': {
        // the key is in the middle of the three mummies: back to the entrance, out of their reach, until the portcullis is up
        if (s.door >= 14) { this.next(); return []; }
        if (Math.hypot(s.p.x, s.p.z - 59.5) < 0.8) return [];
        return this.steer(s, 0, 59.5);
      }
      case 'corridor': {
        if (!this.sub) this.sub = { i: 0, pts: [[0, 86], [0, 95], [0, 130], [0, 170], [0, 200], [0, 203.2]] };
        const u = this.sub, pt = u.pts[u.i];
        if (s.vars.ready & 0x2000) { this.next(); return []; }
        if (near(pt, u.i === u.pts.length - 1 ? 0.4 : 0.8)) { u.i++; if (u.i >= u.pts.length) { this.next(); return []; } }
        return this.steer(s, pt[0], pt[1]);
      }
      case 'page': {
        // the page was touched: Pepper walks to the pedestal and takes it by himself; wait for the collapse to start
        if (s.vars.open & 0x4000 && s.p.state === 10) { this.next(); return []; }
        return [];
      }
      case 'chase': {
        // the run: only left / right counts; stay in the middle of the corridor
        if (s.p.state !== 10) return [];
        if (s.p.x < -0.4) return [KEY.R];
        if (s.p.x > 0.4) return [KEY.L];
        return [];
      }
    }
    return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// node side: a z18MMP world and a loop that plays it with a bot (used by tools/tests/m6-z18MMP*.mjs)

import { loadZone } from './engine-load.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import '../../src/zones/z18MMP.ts';
import { prepareMmp } from '../../src/zones/z18mmp/setup.ts';
import { MmpRun } from '../../src/zones/z18mmp/run.ts';

/** a seeded random source (an LCG) with the interface of `MmpRng` */
export function seededRng(seed) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { float: (x) => r() * x, int: (n) => Math.floor(r() * n) };
}

/** a world of the zone, prepared like the zone game does (shuffled symbols, nodes initialised); `G.zone` has the shape `snapshotFromZone` reads */
export function bootWorld(ctx, seed = 1) {
  const L = loadZone(ctx, 'z18MMP');
  const arch = L.archive;
  const rig = (n) => parseBlk(arch.read(arch.find(`anim/${n}.blk`)));
  const sh = L.pepper.ctrl.nodes.find((n) => n.kind === 'mmpWalk').sh;
  sh.rng = seededRng(seed);
  const nodes = prepareMmp(L.world, sh, { MFIG: L.rigs.get('MFIG') ?? rig('MFIG'), SPID: rig('SPID'), RATT: rig('RATT') });
  const run = new MmpRun(sh);
  const G = { L, w: L.world, sh, nodes, run, rs: L.world.records, ticks: 0 };
  G.zone = { world: G.w, game: { mmp: { shared: sh, run, nodes } } };
  return G;
}

/** one tick of the loop with the given held keys (mode 2 of FUN_006a26a8: clock and danger, the update pass, the game-over check); true when the game is over */
export function tickWorld(G, keys = []) {
  for (const k of Object.values(KEY)) G.w.input.setKey(k, keys.includes(k));
  G.run.beforeTick();
  G.w.tick();
  G.ticks++;
  return G.run.afterTick(G.w.vars);
}

/** play with `bot` until the game is over or `max` ticks passed */
export function playBot(G, bot, max = 12000) {
  for (let i = 0; i < max; i++) {
    const keys = bot.step(snapshotFromZone(G.zone));
    if (keys === null) return i;
    tickWorld(G, keys);
  }
  return max;
}
