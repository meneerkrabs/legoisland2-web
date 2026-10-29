// z15SSH bot: aims the turret at the nearest running / leaping snake (with a lead) and fires, for the node tests and the browser runs (docs/re/m6/z15SSH.md).
// `botMask(world, node, cart, opts)` returns the logical button mask of this tick (1 left, 2 right, 4 up, 8 down, 0x80 fire); the caller sets it with `input.setVirtual`.
import { K } from '../../src/zones/z15ssh/rules.ts';

const STEP = K.AIM_STEP;
export class SshBot {
  constructor(opts = {}) {
    this.prev = [null, null, null];
    this.vel = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    this.range = opts.range ?? 75;        // fire when the target is within this distance (coconuts fly ~98 units)
    this.tol = opts.tol ?? 0.05;
    this.fireEvery = opts.fireEvery ?? 6;
    this.since = 99;
    this.skip = opts.skip ?? 0;           // a bot that ignores every n-th target (to lose gems on purpose)
  }
  /** target selection + aim; `parts` = the zone's PartStore (turret translation) */
  mask(node, cart, recs, parts) {
    const snakes = [0, 1, 2].map((i) => recs[[4, 5, 6][i]]);
    for (let i = 0; i < 3; i++) {
      const p = [snakes[i].x, snakes[i].y, snakes[i].z];
      if (this.prev[i]) this.vel[i] = [p[0] - this.prev[i][0], p[1] - this.prev[i][1], p[2] - this.prev[i][2]];
      this.prev[i] = p;
    }
    this.since++;
    const turret = parts.get(cart, 4);
    const S = [cart.x + turret[12], cart.y + turret[13], cart.z + turret[14]];
    // a leaping snake close to the muzzle is hit by a coconut that starts inside its hit sphere (squared radius 40): just fire
    for (let i = 0; i < 3; i++) {
      if (node.states[i] !== 3 || node.timers[i] !== 0) continue;
      const d = Math.hypot(snakes[i].x - S[0], snakes[i].y - S[1], snakes[i].z - S[2]);
      if (d < 5.5 && this.since >= this.fireEvery) { this.since = 0; return 0x80; }
    }
    let best = -1, bestD = 1e9;
    for (let i = 0; i < 3; i++) {
      if (node.states[i] !== 1 && node.states[i] !== 3) continue;
      if (node.timers[i] !== 0) continue;
      const d = Math.hypot(snakes[i].x - S[0], snakes[i].y - S[1], snakes[i].z - S[2]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return 0;
    const sn = snakes[best];
    const t = bestD / Math.abs(K.COCO_SPEED);
    const lead = Math.min(t, 40);
    const T = [sn.x + this.vel[best][0] * lead, sn.y + this.vel[best][1] * lead + 1, sn.z + this.vel[best][2] * lead];
    // the cart moves on while the coconut flies, the coconut's velocity is in world space
    const dir = [T[0] - S[0] - 0 * lead, T[1] - S[1], T[2] - S[2]];
    const m = cart.m;
    const dl = [dir[0] * m[0] + dir[1] * m[1] + dir[2] * m[2], dir[0] * m[4] + dir[1] * m[5] + dir[2] * m[6], dir[0] * m[8] + dir[1] * m[9] + dir[2] * m[10]];
    const l = Math.hypot(dl[0], dl[1], dl[2]) || 1;
    const n = [dl[0] / l, dl[1] / l, dl[2] / l];
    const rx = Math.asin(Math.max(-1, Math.min(1, n[1])));
    const ry = Math.atan2(-n[0], -n[2]);
    let mask = 0;
    const ey = ry - node.aimYaw, ep = rx - node.aimPitch;
    if (ey < -STEP / 2) mask |= 1; else if (ey > STEP / 2) mask |= 2;
    if (ep > STEP / 2) mask |= 4; else if (ep < -STEP / 2) mask |= 8;
    if (Math.abs(ey) < this.tol && Math.abs(ep) < this.tol && bestD < this.range && this.since >= this.fireEvery) { mask |= 0x80; this.since = 0; }
    return mask;
  }
}
