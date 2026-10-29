// A bot for z08BKD "Brick Dive" (node tests and the headless browser steps, docs/re/m6/z08BKD.md): it plans a path over a grid of the scenery (the diver's quad cast
// against the static records at every cell, like the game does), flies it with the zone's own controls (LEFT / RIGHT turn, UP forward, DOWN back: the heading's
// forward vector is (-sin h, cos h)), fetches the bricks one at a time and brings each to the surface (y >= 86.5).
import { castQuad } from '../../src/zones/z08bkd/physics.ts';
import { rotateShape } from '../../src/zones/z08bkd/math.ts';

export const KEY = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8 };
const GRID = { x0: -52, x1: 52, y0: -184, y1: 96 };

/** the 8 headings (45 degree steps, heading 0 = up, positive = counter-clockwise) and the cell step of each */
const DIRS = [[0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1]];

/**
 * The scenery as the diver sees it: `free(i, j, d)` = the (tall, 0.5 widened) quad at the centre of cell (i, j) with heading d * 45 degrees touches nothing of the static
 * records (land, octopus parts, clam in its open pose, cannon, anchor); computed on demand and cached.
 */
export function buildGrid(world, opts = {}) {
  const R = world.records;
  const list = [R[1], R[72], R[52], R[53], R[57], ...(opts.tentacle ? [R[69]] : [])];   // the octopus's tentacle swings: planned through, the bot just times it by trying
  const lid = R[52], rx0 = lid.rx;
  lid.setEuler(-0.785, lid.ry, lid.rz, lid.x, lid.y, lid.z);   // the clam in its open pose (it cycles; its brick is reached through the gap under the opened lid)
  const L = opts.length ?? 4.9, Wd = opts.half ?? 1.3, B = opts.back ?? 0.5;
  const shape = [[Wd, L, 10], [-Wd, L, 10], [-Wd, -B, 10], [Wd, -B, 10]];
  const w = GRID.x1 - GRID.x0 + 1, h = GRID.y1 - GRID.y0 + 1;
  const cache = new Int8Array(w * h * 8).fill(-1);
  const grid = { discs: [] };   // extra blocked discs [x, y, r] (the pirates once they are awake)
  const free = (i, j, d) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return false;
    for (const dc of grid.discs) { const dx = GRID.x0 + i - dc[0], dy = GRID.y0 + j - dc[1]; if (dx * dx + dy * dy < dc[2] * dc[2]) return false; }
    const k = (j * w + i) * 8 + d;
    if (cache[k] >= 0) return cache[k] === 1;
    const pts = rotateShape(shape, 4, d * Math.PI / 4 + Math.PI / 2);
    for (const p of pts) { p[0] += GRID.x0 + i; p[1] += GRID.y0 + j; }
    const ok = castQuad(world, pts, 4, R[5], list).hits.length === 0;
    cache[k] = ok ? 1 : 0;
    return ok;
  };
  // the anchor swings (rz -0.436 .. 0.436): its blocked cells per swing angle, computed on demand with a copy of its record
  const A = R[54], shadow = Object.assign(Object.create(Object.getPrototypeOf(A)), A, { m: new Float64Array(A.m) });
  const BINS = 24, AH = 0.43633;
  const acache = [new Int8Array(w * h * 8 * BINS).fill(-1), new Int8Array(w * h * 8 * BINS).fill(-1)];
  const tallShape = [[Wd + 0.2, 7.6, 10], [-Wd - 0.2, 7.6, 10], [-Wd - 0.2, -B, 10], [Wd + 0.2, -B, 10]];
  const posed = { bin: -1 };
  const anchorFree = (i, j, d, rz, tall = false) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return true;
    const bin = Math.max(0, Math.min(BINS - 1, Math.round((rz + AH) / (2 * AH) * (BINS - 1))));
    const k = ((j * w + i) * 8 + d) * BINS + bin, ac = acache[tall ? 1 : 0];
    if (ac[k] >= 0) return ac[k] === 1;
    if (posed.bin !== bin) { shadow.setEuler(0, 0, -AH + bin * 2 * AH / (BINS - 1), A.x, A.y, A.z); posed.bin = bin; }
    const pts = rotateShape(tall ? tallShape : shape, 4, d * Math.PI / 4 + Math.PI / 2);
    for (const p of pts) { p[0] += GRID.x0 + i; p[1] += GRID.y0 + j; }
    const ok = castQuad(world, pts, 4, R[5], [shadow]).hits.length === 0;
    ac[k] = ok ? 1 : 0;
    return ok;
  };
  Object.assign(grid, { w, h, free, anchorFree, restore() { lid.setEuler(rx0, lid.ry, lid.rz, lid.x, lid.y, lid.z); }, ...GRID });
  return grid;
}

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

/** A* over (cell, heading): forward steps along the heading (both cells must be free at that heading), 45 degree turns on the spot; returns the cell centres from `from` to `to`, or null */
export function plan(grid, from, to, opts = {}) {
  const { w, h, free, x0, y0 } = grid;
  const cellOf = (p) => [Math.max(0, Math.min(w - 1, Math.round(p[0]) - x0)), Math.max(0, Math.min(h - 1, Math.round(p[1]) - y0))];
  const anyFree = (i, j) => { for (let d = 0; d < 8; d++) if (free(i, j, d)) return true; return false; };
  const nearestFree = ([i, j]) => {
    if (anyFree(i, j)) return [i, j];
    for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && anyFree(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  };
  const s = nearestFree(cellOf(from)), t = cellOf(to);
  if (!s) return null;
  const reach = opts.reach ?? 5.5;   // the quad reaches the target from this far
  const N = w * h * 8;
  const g = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1);
  const open = new Heap();
  const hh = (i, j) => Math.hypot(i - t[0], j - t[1]);
  for (let d = 0; d < 8; d++) if (free(s[0], s[1], d)) { const n = (s[1] * w + s[0]) * 8 + d; g[n] = 0; open.push(hh(s[0], s[1]), n); }
  let goal = -1;
  while (open.size) {
    const [, cur] = open.pop();
    const d = cur % 8, c = (cur / 8) | 0, ci = c % w, cj = (c / w) | 0;
    if (Math.hypot(ci - t[0], cj - t[1]) <= reach) { goal = cur; break; }
    // forward
    const [dx, dy] = DIRS[d];
    const ni = ci + dx, nj = cj + dy;
    if (free(ni, nj, d) && free(ci, cj, d)) {
      const n = (nj * w + ni) * 8 + d, cost = g[cur] + (dx && dy ? 1.4142 : 1);
      if (cost < g[n]) { g[n] = cost; prev[n] = cur; open.push(cost + hh(ni, nj), n); }
    }
    for (const turn of [1, 7]) {
      const nd = (d + turn) % 8;
      if (!free(ci, cj, nd)) continue;
      const n = c * 8 + nd, cost = g[cur] + 0.7;
      if (cost < g[n]) { g[n] = cost; prev[n] = cur; open.push(cost + hh(ci, cj), n); }
    }
  }
  if (goal < 0) return null;
  const path = [];
  for (let n = goal; n >= 0; n = prev[n]) {
    const c = (n / 8) | 0;
    const p = [x0 + (c % w), y0 + ((c / w) | 0)];
    if (!path.length || path[path.length - 1][0] !== p[0] || path[path.length - 1][1] !== p[1]) path.push(p);
  }
  return path.reverse();
}

const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * The fish do not react to the diver: their places are a function of the tick alone. `recordHazards` runs a copy of the zone with an idle diver and keeps where the
 * creatures that hurt (shark, swordfish, mantas) are at every tick, so the bot can look up where each will be a few seconds ahead.
 */
export function recordHazards(run, world, ticks) {
  const ents = run.env.hurt.entries.filter((e) => e.category !== 4);
  const n = ents.length;
  const data = new Float32Array(ticks * n * 3);
  // the octopus's tentacle (record 69) sweeps the neck of the pocket above the last brick (y -146 .. -157) with a period of 405 ticks. Its pose is a function of its angle
  // alone: for the first 450 ticks the diver's quad is tried at heights down the pocket (the small quad heading down for the dive, the tall carrier quad heading up for the way out)
  const R = world.records;
  const small = [[1, 4, 10], [-1, 4, 10], [-1, 0, 10], [1, 0, 10]], tall = [[1, 7, 10], [-1, 7, 10], [-1, 0, 10], [1, 0, 10]];
  const rz = new Float32Array(ticks), anchor = new Float32Array(ticks);
  const tent = { y0: -140, step: 2, count: 14, samples: [] };   // heights -140, -142 .. -166
  const hit = (sh, h, x, y) => { const pts = rotateShape(sh, 4, h + Math.PI / 2); for (const p of pts) { p[0] += x; p[1] += y; } return castQuad(world, pts, 4, R[5], [R[69]]).hits.length > 0; };
  for (let t = 0; t < ticks; t++) {
    run.beforeTick(); world.tick(); run.afterTick();
    rz[t] = R[69].rz; anchor[t] = R[54].rz;
    if (t < 450) {
      const d = new Uint8Array(tent.count), u = new Uint8Array(tent.count);
      for (let k = 0; k < tent.count; k++) {
        const y = tent.y0 - k * tent.step;
        for (const x of [-20.8, -19.3, -17.8]) if (hit(small, Math.PI, x, y)) d[k] = 1;   // the way down is the lane x = -19.3 (the swordfish that visits the pocket keeps to x > -17) ...
        for (const x of [-20.8, -19.3, -17.8]) if (hit(tall, 0, x, y)) u[k] = 1;          // ... and the way out
      }
      tent.samples.push({ rz: R[69].rz, d, u });
    }
    for (let i = 0; i < n; i++) { data[(t * n + i) * 3] = ents[i].anchorWorld[0]; data[(t * n + i) * 3 + 1] = ents[i].anchorWorld[1]; data[(t * n + i) * 3 + 2] = ents[i].anchorWorld[2]; }
  }
  return { n, ticks, data, rz, anchor, tent, radius: ents.map((e) => e.tpl.anchorRadius), category: ents.map((e) => e.category) };
}

/**
 * The bot. `decide(s)` gets the game's snapshot (`snapshot(run)` of src/zones/z08bkd/run.ts, with `bricks` = its `brickList`, `page` = `pageAt`, `havePage` = `page`) and returns the
 * key mask for this tick. It plans a path to the target over the scenery grid, and each tick samples directions around the one the path asks for, taking the nearest one
 * whose next 3 seconds (the diver's own drag model) stay clear of the scenery and of the creatures' recorded paths.
 */
export class Bot {
  constructor(grid, opts = {}) {
    this.grid = grid;
    this.tight = opts.tight ?? null;   // the exact-fit grid, used when the roomy one finds no way (the diver may have been thrown into a tight spot)
    this.hz = opts.hazards ?? null;
    this.path = null; this.pathFor = null; this.pathAge = 0;
    this.stuck = 0; this.lastPos = null; this.backoff = 0;
    this.wantPage = opts.page ?? false;
    this.margin = opts.margin ?? 3.5;
    this.horizon = opts.horizon ?? 90;
    this.log = []; this.exiting = false; this.braking = false;
  }
  target(s) {
    if (s.held >= 0) return { kind: 'surface', p: [Math.max(-30, Math.min(30, s.pos[0])), 93] };
    if (this.wantPage && s.page && !s.havePage) return { kind: 'page', p: s.page };
    const left = s.bricks.filter((b) => b[2]);
    if (!left.length) return { kind: 'surface', p: [0, 93] };
    let best = left[0], bd = 1e9;
    for (const b of left) { const d = Math.hypot(b[0] - s.pos[0], b[1] - s.pos[1]); if (d < bd) { bd = d; best = b; } }
    // the last brick: first to the mouth of its pocket (see `pocket`)
    if (best[3] === 92 && this.hz && !(s.pos[0] > -23 && s.pos[0] < -10 && s.pos[1] < -139) && Math.hypot(s.pos[0] + 19.3, s.pos[1] + 137) > 5) return { kind: 'goto', p: [-19.3, -137], index: 92 };
    return { kind: 'brick', p: [best[0], best[1]], index: best[3] };
  }
  /** is a diver at `p` flying along heading `h` clear of the scenery and of the creatures `k` ticks from now */
  clear(p, h, k, s, walls = true) {
    const g = this.grid;
    const d = ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
    if (walls && !g.free(Math.round(p[0]) - g.x0, Math.round(p[1]) - g.y0, d)) return false;
    const hz = this.hz;
    if (hz && s.ticks + k < hz.ticks && p[0] > -6 && p[0] < 42 && p[1] < -20 && p[1] > -72) {   // the swinging anchor
      const rz = hz.anchor[s.ticks - 1 + k], i = Math.round(p[0]) - g.x0, j = Math.round(p[1]) - g.y0;
      if (!g.anchorFree(i, j, d, rz, s.held >= 0)) return false;
    }
    if (hz && s.ticks + k < hz.ticks) {
      const base = (s.ticks - 1 + k) * hz.n;
      for (let i = 0; i < hz.n; i++) {
        // the creatures hurt through spheres of radius 1 around their body: only when their body is in the diver's plane (z = 10) within a couple of units
        if (Math.abs(hz.data[(base + i) * 3 + 2] - 10) > 3.2) continue;
        const R = hz.radius[i] + this.margin - 0.8;
        for (const a of s.held >= 0 ? [0.5, 3, 5.5, 7] : [0.5, 2.5, 4.5]) {   // along the quad (4.9 long, 7.5 with a brick)
          const dx = p[0] + Math.sin(-h) * a - hz.data[(base + i) * 3], dy = p[1] + Math.cos(h) * a - hz.data[(base + i) * 3 + 1];
          if (dx * dx + dy * dy < R * R) return false;
        }
      }
    }
    // the cannon's next shot (the timer only runs while he is in its range: 40 units, to its right): not close to it around that time
    if (s.cannon !== undefined && p[0] >= -11.5) {
      const tf = s.cannon * 30;
      if (k >= tf - 30 && k <= tf + 60 && (p[0] + 11.55) ** 2 + (p[1] + 8.47) ** 2 < 225) return false;
    }
    // the cannon balls in flight (parabola, gravity 4; the bounces are not looked at: the plan is redone every tick)
    for (const b of s.balls ?? []) {
      const tt = (k - 0) / 30;
      const bx = b[0] + b[2] * tt, by = b[1] + b[3] * tt - 2 * tt * tt;
      const dx = p[0] + Math.sin(-h) * 2 - bx, dy = p[1] + Math.cos(h) * 2 - by;
      if (dx * dx + dy * dy < 13) return false;
    }
    for (const z of s.hazards ?? []) if (z[5] === 4) { const dx = p[0] - z[0], dy = p[1] - z[1] - 3; if (dx * dx + dy * dy < 36) return false; }   // the awake pirate's hurt sphere (r 2.5) sits 3 above his feet
    return true;
  }
  /** the key law: turn toward `u` (PD on the heading error and the angular velocity), thrust forward while facing it, brake when close and fast */
  keysFor(heading, angVel, speed, u, dist) {
    const want = Math.atan2(-u[0], u[1]);
    const e = wrapPi(want - heading);
    let m = 0;
    const wantAng = Math.max(-2.2, Math.min(2.2, e * 2.2));
    if (angVel < wantAng - 0.3) m |= KEY.RIGHT; else if (angVel > wantAng + 0.3) m |= KEY.LEFT;
    if (Math.abs(e) < 0.7 && !(dist < 4 && speed > 6)) m |= KEY.UP;
    else if (dist < 4 && speed > 6) m |= KEY.DOWN;
    return m;
  }
  /** the direction nearest `u0` whose 3 s, flown with the same key law and the diver's own physics, stay clear of the scenery and the creatures; null when none */
  steer(s, u0, dist) {
    const dt = 1 / 30;
    const a0 = Math.atan2(u0[1], u0[0]);
    for (const off of [0, 0.1, -0.1, 0.2, -0.2, 0.35, -0.35, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.4, -1.4, 1.9, -1.9, 2.5, -2.5, 3.14]) {
      const a = a0 + off, u = [Math.cos(a), Math.sin(a)];
      let x = s.pos[0], y = s.pos[1], h = s.heading, w = s.angVel, vx = s.vel[0], vy = s.vel[1];
      let ok = true;
      for (let k = 1; k <= this.horizon && ok; k++) {
        const m = this.keysFor(h, w, Math.hypot(vx, vy), u, dist);
        const turn = (m & KEY.LEFT ? -4.7124 : 0) + (m & KEY.RIGHT ? 4.7124 : 0);
        const th = (m & KEY.UP ? 24 : 0) - (m & KEY.DOWN ? 24 : 0);
        w += (turn + w * -2) * dt;
        h += w * dt;
        const ca = Math.cos(h + Math.PI / 2), sa = Math.sin(h + Math.PI / 2);
        vx += (ca * th + vx * -2) * dt; vy += (sa * th + vy * -2) * dt;
        x += vx * dt; y += vy * dt;
        if (k % 3 === 0 && !this.clear([x, y], h, k - 1, s, false)) ok = false;
      }
      if (ok) return { u, off };
    }
    return null;
  }
  /** is the quad at height y (small going down / tall going up) clear of the tentacle at tick `tk` */
  tentFree(tk, y, kind) {
    const hz = this.hz;
    if (tk >= hz.ticks) return false;
    if (y > hz.tent.y0) return true;                           // above the sampled heights
    const f = (hz.tent.y0 - y) / hz.tent.step, k0 = Math.min(hz.tent.count - 1, Math.floor(f)), k1 = Math.min(hz.tent.count - 1, Math.ceil(f));
    for (const q of hz.tent.samples) if (Math.abs(q.rz - hz.rz[tk]) < 0.02 && (q[kind][k0] || q[kind][k1])) return false;
    return true;
  }
  /** the trip of `n` ticks from `y0` at rest at tick `tick0`, thrusting with the diver's drag (distance 12 t - 6 (1 - e^-2t)), `dir` = -1 down / +1 up, stays clear of the swing (heights beyond `ylim` are not looked at) */
  tripFree(tick0, y0, dir, kind, n, ylim) {
    const d = (u) => 12 * u - 6 * (1 - Math.exp(-2 * u));
    for (let k = 0; k <= n; k += 3) {
      const tau = k / 30;
      const ya = y0 + dir * d(0.75 * tau), yb = y0 + dir * d(tau);
      for (const y of [ya, (ya + yb) / 2, yb]) { if ((dir < 0 && y < ylim) || (dir > 0 && y > ylim)) continue; if (!this.tentFree(tick0 + k, y, kind)) return false; }
    }
    return true;
  }
  /** per tick: may the dive start (from y -137 facing down) / the way out (from y -166.5 facing up) */
  windows() {
    if (!this.win) {
      const n = this.hz.ticks - 140;
      const dive = new Uint8Array(this.hz.ticks), exit = new Uint8Array(this.hz.ticks);
      for (let t = 0; t < n; t++) { dive[t] = this.tripFree(t, -137, -1, 'd', 90, -162) ? 1 : 0; exit[t] = this.tripFree(t, -166.5, 1, 'u', 100, -139) ? 1 : 0; }
      this.win = { dive, exit };
    }
    return this.win;
  }
  /** is no creature that hurts within `r` of the column x = -16.3, y in [y0, y1] during ticks t0 .. t1 (the swordfish ring passes the pocket's mouth) */
  columnClear(t0, t1, y0, y1, r, xc = -19.3) {
    const hz = this.hz;
    for (let t = t0; t < t1; t += 2) {
      if (t >= hz.ticks) return false;
      for (let i = 0; i < hz.n; i++) {
        const b = (t * hz.n + i) * 3;
        if (Math.abs(hz.data[b + 2] - 10) > 3.2 + 1) continue;
        const dx = hz.data[b] - xc;
        const dy = hz.data[b + 1] < y0 ? y0 - hz.data[b + 1] : hz.data[b + 1] > y1 ? hz.data[b + 1] - y1 : 0;
        const R = hz.radius[i] + r;
        if (dx * dx + dy * dy < R * R) return false;
      }
    }
    return true;
  }
  /**
   * The last brick lies at the bottom of a dead-end pocket whose neck (y -146 .. -157) the octopus's tentacle sweeps every 13.5 s; below the neck nothing moves. The bot
   * waits above the neck, dives through it while the tentacle is away (about 4 s each way), takes the brick, turns round below the neck, waits there until the tentacle is
   * away again and drives out with the tall carrier quad. Returns a key mask, or null outside this manoeuvre (the planner flies).
   */
  pocket(s, t) {
    if (!this.hz) return null;
    const X0 = -19.3;
    const x = s.pos[0], y = s.pos[1];
    const inCol = x > -23 && x < -10;
    const speed = Math.hypot(s.vel[0], s.vel[1]);
    const faceH = (target, band = 0.3) => {   // steer to a heading
      const e = wrapPi(target - s.heading);
      const wantAng = Math.max(-2.2, Math.min(2.2, e * 2.2));
      return s.angVel < wantAng - band ? KEY.RIGHT : s.angVel > wantAng + band ? KEY.LEFT : 0;
    };
    const clampH = (v) => Math.max(-0.3, Math.min(0.3, v));
    const XE = -19.3;                                           // the lane out
    const downH = Math.PI + clampH(0.12 * (X0 - x)), upH = clampH(0.12 * (x - XE));
    const hz = this.hz;
    if (s.held !== 92) this.exiting = false;
    if (s.held === 92) {
      if (y > -139 || !inCol) { this.exiting = false; return null; }
      if (this.exiting) return faceH(upH) | KEY.UP;              // in the neck: out
      // below the neck: face up (turning on the spot), a little lower than the brick's spot so that the tall quad's top stays out of the tentacle's reach, and wait for the swing
      if (Math.abs(wrapPi(upH - s.heading)) > 0.07) return faceH(upH, 0.08);                     // turning: no thrust (it would push him sideways)
      if (y > -166.5 && speed < 3) return faceH(upH, 0.08) | KEY.DOWN;
      if (this.windows().exit[s.ticks] && this.columnClear(s.ticks, s.ticks + 100, -170, -135, 0.5, XE)) { this.exiting = true; return faceH(upH, 0.08) | KEY.UP; }
      return faceH(upH, 0.08) | (speed > 0.8 ? KEY.DOWN : 0);
    }
    if (t.index !== 92) return null;
    if (inCol && y < -139) {
      if (y <= -158) return null;                                // below the neck the planner takes the brick
      return faceH(downH) | KEY.UP;
    }
    if (Math.hypot(x - X0, y + 137) > 5) return null;           // the planner brings it to the mouth first
    // the whole trip: through the neck now, the wait below it until the swing is away again (the tentacle repeats), the way out; the swordfish that visits the pocket must stay away all along
    const win = this.windows();
    let ok = win.dive[s.ticks] && this.columnClear(s.ticks, s.ticks + 80, -170, -136, 1.5);
    if (ok) {
      let te = -1;
      for (let k = 110; k < 520 && te < 0; k++) if (win.exit[s.ticks + k]) te = s.ticks + k;
      ok = te >= 0 && this.columnClear(s.ticks + 80, te, -170, -158, 0.4, -19.3) && this.columnClear(te, te + 100, -170, -135, 0.5, XE);
    }
    const m = faceH(downH);
    if (!ok) return m | (speed > 0.8 ? KEY.DOWN : 0);           // wait above the neck
    return m | (Math.abs(wrapPi(downH - s.heading)) < 0.3 ? KEY.UP : 0);
  }
  decide(s) {
    // the pirates (once awake they slash at a diver with a brick within 16 units; their hurt sphere sits 3 above their feet): kept 5.5 units away by the planner
    const awake = (s.hazards ?? []).filter((z) => z[5] === 4).map((z) => [z[0], z[1] + 3, 5.5]);
    if (awake.length !== this.grid.discs.length) { this.grid.discs = awake; if (this.tight) this.tight.discs = awake; this.pathAge = 99; }
    const t = this.target(s);
    const key = `${t.kind}:${t.index ?? ''}`;
    if (this.pathFor !== key || !this.path || ++this.pathAge > 45) {
      const o = { reach: t.kind === 'surface' ? 1 : t.kind === 'goto' ? 1.5 : 5.5 };
      this.path = plan(this.grid, s.pos, t.p, o) ?? (this.tight ? plan(this.tight, s.pos, t.p, o) : null);
      this.pathFor = key; this.pathAge = 0;
    }
    const pk = this.pocket(s, t);
    if (pk !== null) { this.stuck = 0; this.lastPos = [s.pos[0], s.pos[1]]; return pk; }
    if (!this.braking && this.lastPos && Math.hypot(s.pos[0] - this.lastPos[0], s.pos[1] - this.lastPos[1]) < 0.02) this.stuck++; else this.stuck = 0;
    this.lastPos = [s.pos[0], s.pos[1]];
    if (this.stuck > 40) { this.backoff = 25; this.stuck = 0; this.pathAge = 99; }
    if (this.backoff > 0) { this.backoff--; return KEY.DOWN | (this.backoff % 12 < 6 ? KEY.LEFT : KEY.RIGHT); }
    const path = this.path;
    let aim = t.p;
    if (path && path.length) {
      for (const c of path) if (Math.hypot(c[0] - s.pos[0], c[1] - s.pos[1]) > 7) { aim = c; break; }
      if (Math.hypot(path[path.length - 1][0] - s.pos[0], path[path.length - 1][1] - s.pos[1]) < 7) aim = t.p;
    }
    let dx = aim[0] - s.pos[0], dy = aim[1] - s.pos[1];
    const dist = Math.hypot(dx, dy) || 1;
    let u = [dx / dist, dy / dist], brake = false;
    const st = this.steer(s, u, dist);
    if (st) u = st.u; else brake = true;
    const speed = Math.hypot(s.vel[0], s.vel[1]);
    let m = this.keysFor(s.heading, s.angVel, speed, u, dist);
    this.braking = brake;                                       // waiting for a creature to pass is not being stuck
    if (brake) { m &= ~KEY.UP; if (speed > 1) m |= KEY.DOWN; }
    return m;
  }
}
