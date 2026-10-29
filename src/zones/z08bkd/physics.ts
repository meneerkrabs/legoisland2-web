// The collision helpers shared by the zone's bodies (the diver, the bricks, the cannon balls): FUN_005ba9a7 (the edges of a body's quad cast against a list of
// records), FUN_005bc194 (bounce) and the pushes of the swinging anchor (FUN_005be690) and the octopus's tentacle (FUN_005be130).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { C } from './consts.ts';
import { normalize3 } from './math.ts';

const fr = Math.fround;

/** the polygon flag mask of the zone's ray queries (DAT_00903570 = 2), their radius (DAT_00903574 = 0.01) and skin (0) */
export const QUERY = { MASK: 2, RADIUS: 0.01, SKIN: 0 } as const;

export interface QuadHit {
  /** the distinct records the edges ran into, in the order they were found */
  hits: GameRecord[];
  /** world normal and point of the last hit found (the out parameters of FUN_00441b10: the nearest polygon of the last record hit) */
  normal: [number, number, number];
  point: [number, number, number];
}

/**
 * FUN_005ba9a7(points, n, self, &normal, &point, hits, list): every edge (point i -> point i + 1, the last back to the first) is a ray (start + delta) against every record
 * of `list` except `self`; a record hit by any edge is listed once.
 */
export function castQuad(w: World, pts: readonly (readonly number[])[], n: number, self: GameRecord | null, list: readonly GameRecord[]): QuadHit {
  const out: QuadHit = { hits: [], normal: [0, 0, 0], point: [0, 0, 0] };
  for (let i = 0; i < n; i++) {
    const j = i === n - 1 ? 0 : i + 1;
    const delta = [pts[j][0] - pts[i][0], pts[j][1] - pts[i][1], pts[j][2] - pts[i][2]];
    for (const rec of list) {
      if (rec === self) continue;
      const h = w.col.rayRecord(rec, pts[i], delta, QUERY.MASK, QUERY.RADIUS, QUERY.SKIN);
      if (!h) continue;
      out.normal = h.normal; out.point = h.point;
      if (!out.hits.includes(rec)) out.hits.push(rec);
    }
  }
  return out;
}

/** a body's state a bounce changes (the original keeps these in the node at +0x88 / +0x9c) */
export interface Bouncer { vx: number; vy: number; vz: number; angVel: number }

/**
 * FUN_005bc194(vel, &angVel, pos, nx, ny, 0, hitPoint): reflect the velocity about the (normalised, z = 0) normal, scale it by 1 - max(0.4, |cos| / 2), spin the body by
 * +-pi/2 (times the same factor) by the side of the hit; a speed below 0.2 stops everything. Returns 1 when the body stopped (callers deactivate it).
 */
export function bounce(b: Bouncer, pos: ArrayLike<number>, normal: ArrayLike<number>, hit: ArrayLike<number>): number {
  const n = normalize3([normal[0], normal[1], 0]);
  const v = [b.vx, b.vy, b.vz];
  const nv = -(n[2] * v[2] + n[1] * v[1] + n[0] * v[0]);
  n[0] = fr(n[0] * nv); n[1] = fr(n[1] * nv);
  let ox = fr(C.TWO * n[0] + v[0]), oy = fr(C.TWO * n[1] + v[1]);
  const speed = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  let c = fr(Math.abs(nv) / speed * C.HALF);
  if (c < C.POINT_FOUR) c = fr(0.4);
  c = fr(C.ONE - c);
  ox = fr(ox * c); oy = fr(oy * c);
  if (speed < C.POINT_TWO) { b.vx = 0; b.vy = 0; b.angVel = 0; return 1; }
  b.vx = ox; b.vy = oy; b.vz = 0;
  const d = normalize3([pos[0] - hit[0], pos[1] - hit[1], pos[2] - hit[2]]);
  const u = normalize3([ox, oy, 0]);
  const dot = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
  b.angVel = fr((dot <= 0 ? -1.5707879 : 1.5707879) * c);
  return 0;
}

/** FUN_005be690 (anchor) / FUN_005be130 (tentacle): the push a swinging arm gives a body at `pos`: the arm's tangent (cos a, sin a) away from the side the body is on, times speed * distance * 1.1 */
export function swingPush(armPos: ArrayLike<number>, armAngle: number, armSpeed: number, pos: ArrayLike<number>): [number, number, number] {
  const c = fr(Math.cos(armAngle)), s = fr(Math.sin(armAngle));
  const d = [armPos[0] - pos[0], armPos[1] - pos[1], armPos[2] - pos[2]];
  const dist = Math.sqrt(d[2] * d[2] + d[1] * d[1] + d[0] * d[0]);
  normalize3(d);
  const dot = d[2] * 0 + d[1] * s + d[0] * c;
  const k = fr(Math.abs(armSpeed) * dist * C.ONE_POINT_ONE);
  return dot >= 0 ? [fr(-c * k), fr(-s * k), 0] : [fr(c * k), fr(s * k), 0];
}

/**
 * FUN_005c188e(pos, hitPoint, normal) -> the spin a hit gives: -pi/2 or +pi/2 by the sign of normal . (pos - hitPoint). The callers pass an UNINITIALISED local as the normal (the
 * debug build fills the frame with 0xcccccccc = -1.0737418e8 in every component), so the normal is always (-1, -1, -1) / sqrt 3: the spin goes by the side of pos - point along
 * that diagonal, not by the real surface (a quirk of the original, kept).
 */
export function hitSpin(pos: ArrayLike<number>, hit: ArrayLike<number>): number {
  const j = fr(-1.0737418e8);
  const n = normalize3([j, j, j]);
  const dot = n[2] * (pos[2] - hit[2]) + n[1] * (pos[1] - hit[1]) + n[0] * (pos[0] - hit[0]);
  return dot <= C.ZERO ? -1.5707879 : 1.5707879;
}
