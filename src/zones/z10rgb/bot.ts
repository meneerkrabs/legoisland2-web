// z10RGB: a scripted player for the node tests and the headless browser runs (not part of the game): it walks the bridge (a fixed list of waypoints found with the
// walk sweeps), enters a cannon, aims at the nearest enemy cannon that is still there with the flight model of the ball (FUN_005f8a7b) and fires when the
// cannon has reloaded. The browser steps get the same decisions through `ZoneGame.assist` (the page holds the keys with real key presses).
import { buildMatrix } from '../../formats/matrix.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import { K } from './consts.ts';
import { shotScale } from './pepper.ts';
import type { RgbState } from './shared.ts';

/** the walk from the start to the cannons: the bridge, its gap in the invisible fence at z = -15 .. -12, the field of the cannons (found with the walk sweeps) */
export const ROUTE: readonly (readonly [number, number])[] = [[100, -6], [40, -10], [10, -16.2], [-20, -16.2], [-47, -14], [-56, -13], [-70, -13], [-88, -12]];

export interface ShotPlan { /** the ball's path, swept like the game's (FUN_005f8291), stops at the enemy cannon */ hits?: boolean; rx: number; ry: number; /** where the ball comes down (x, z), the horizontal miss and the flight time in ticks */ land: [number, number]; miss: number; time: number }

/** the flight of a ball from the muzzle of a cannon aimed at (rx, ry): where it crosses the height `ty` on the way down */
export function flight(st: RgbState, pos: ArrayLike<number>, rx: number, ry: number, ty: number, scale: number): [number, number, number] | null {
  const m = buildMatrix(-rx, -ry, 0, pos[0], pos[1], pos[2]);
  const mx = K.MUZZLE[0] * m[0] + K.MUZZLE[1] * m[4] + K.MUZZLE[2] * m[8] + m[12];
  const my = K.MUZZLE[0] * m[1] + K.MUZZLE[1] * m[5] + K.MUZZLE[2] * m[9] + m[13];
  const mz = K.MUZZLE[0] * m[2] + K.MUZZLE[1] * m[6] + K.MUZZLE[2] * m[10] + m[14];
  const a = K.PITCH_K * rx + K.PITCH_0, cos = Math.cos(a), sin = Math.sin(a);
  const dx = m[8] * scale, dz = m[10] * scale;
  let x = mx, y = my, z = mz;
  for (let t = 1; t < 3000; t++) {
    const vy = scale * sin - t * st.g;
    const py = y;
    x += cos * dx; y += vy; z += cos * dz;
    if (py > ty && y <= ty) return [x, z, t];       // comes down through the height of the target
    if (y < -20) return null;
  }
  return null;
}

/** does the ball, flown from the muzzle with this aim, stop at the record `enemy` (the first record its swept steps meet)? The sweeps are the game's (`collideBall`: the step back from the new position) */
export function sweepHits(st: RgbState, pos: ArrayLike<number>, rx: number, ry: number, scale: number, enemy: GameRecord): boolean {
  const F = Math.fround;
  const m = buildMatrix(-rx, -ry, 0, pos[0], pos[1], pos[2]);
  let x = F(K.MUZZLE[0] * m[0] + K.MUZZLE[1] * m[4] + K.MUZZLE[2] * m[8] + m[12]);
  let y = F(K.MUZZLE[0] * m[1] + K.MUZZLE[1] * m[5] + K.MUZZLE[2] * m[9] + m[13]);
  let z = F(K.MUZZLE[0] * m[2] + K.MUZZLE[1] * m[6] + K.MUZZLE[2] * m[10] + m[14]);
  const a = F(F(F(K.PITCH_K * 1) * rx) + K.PITCH_0), cos = F(Math.cos(a)), sin = F(Math.sin(a));
  const d0 = F(m[8] * scale), d1 = F(1 * scale), d2 = F(m[10] * scale);
  for (let t = 1; t < 1500; t++) {
    const vx = F(cos * d0), vy = F(F(F(d1 * sin) - F(t * st.g))), vz = F(cos * d2);
    x = F(x + vx); y = F(y + vy); z = F(z + vz);
    if (y < 0) return false;
    const h = st.w.col.sweep(null, [x, y, z], [-vx, -vy, -vz], 2, 0.01, 0);
    if (h) return h.rec === enemy;
    const g = st.w.col.rayRecord(st.land, [x, y, z], [vx, vy, vz], 2, 0.01, 0);
    if (g) return false;
  }
  return false;
}

/** aim the cannon the player sits in at the point `target` (the middle of an enemy cannon): the heading and the pitch that bring the ball down on it */
export function planShot(st: RgbState, target: ArrayLike<number>, scale: number = shotScale.value): ShotPlan | null {
  const c = st.cannons[st.pepperCannon];
  if (!c) return null;
  const pos = [c.rec.x, K.CANNON_Y, c.rec.z];
  const tryPitch = (rx: number): ShotPlan | null => {
    let ry = -Math.atan2(target[0] - pos[0], target[2] - pos[2]);
    for (let it = 0; it < 3; it++) {
      const l = flight(st, pos, rx, ry, target[1], scale);
      if (!l) return null;
      // turn by the angle between the target and the landing point as seen from the cannon
      ry += Math.atan2(l[0] - pos[0], l[1] - pos[2]) - Math.atan2(target[0] - pos[0], target[2] - pos[2]);
    }
    const l = flight(st, pos, rx, ry, target[1], scale);
    if (!l) return null;
    return { rx, ry, land: [l[0], l[1]], miss: Math.hypot(l[0] - target[0], l[2] - target[2]) ? Math.hypot(l[0] - target[0], l[1] - target[2]) : 0, time: l[2] };
  };
  // the pitch can only be changed in steps of AIM_STEP from where the cannon points now (the euler angle moves by `step` per held tick): only those pitches are reachable.
  // A ball comes down almost vertically (a 2.5 * pitch + 0.8 launch angle of 1.4), so a pitch error of half a step is already about 4 units of range: plan on the lattice.
  const rx0 = c.rec.rx, step = K.AIM_STEP;
  const good: ShotPlan[] = [];
  let best: ShotPlan | null = null;
  for (let k = Math.ceil((K.PITCH_MIN - rx0) / step); rx0 + k * step <= K.PITCH_MAX + 1e-9; k++) {
    const p = tryPitch(rx0 + k * step);
    if (!p) continue;
    if (!best || p.miss < best.miss) best = p;
    if (p.miss < 6) good.push(p);
  }
  // the ones that come down near the target are swept like the game does; the heading too moves in steps (only those are reachable): take the nearest reachable heading
  let enemy: GameRecord | undefined, ed = 4;
  for (const e of st.enemy) { const q = hitCentre(e); const d = Math.hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]); if (d < ed) { ed = d; enemy = e; } }
  const ry0 = c.rec.ry;
  const hitting: ShotPlan[] = [];
  if (enemy) {
    for (const g of good) {
      // the heading, in steps from the ideal one outwards (the box is wider than a step: a ball that lands off the middle still stops at it)
      const k0 = Math.round((g.ry - ry0) / step);
      for (let d = 0; d <= 12; d++) {
        const cands = d === 0 ? [k0] : [k0 - d, k0 + d];
        const ok = cands.find((k) => sweepHits(st, pos, g.rx, ry0 + k * step, scale, enemy));
        if (ok !== undefined) { hitting.push({ ...g, ry: ry0 + ok * step, hits: true }); break; }
      }
    }
  }
  if (hitting.length) return hitting.sort((a, b) => a.time - b.time)[0];
  if (best) best.hits = enemy ? false : undefined;
  return best;
}

/** the middle of the enemy cannon's collision box in the world (the ball is stopped by the box's polygons: half extents 2.75 / 2.54 / 3.05 around the file's centre) */
export function hitCentre(e: { m: ArrayLike<number>; colObj?: { col: { center: ArrayLike<number> } } | null; x: number; y: number; z: number }): [number, number, number] {
  const c = e.colObj?.col.center;
  if (!c) return [e.x, e.y + 2.5, e.z];
  const m = e.m;
  return [m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13], m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]];
}

/** the nearest enemy cannon that is still there (to the player's cannon), its centre as the aim point (the model's middle: a little above its position) */
export function nextTarget(st: RgbState): { k: number; point: [number, number, number] } | null {
  const c = st.cannons[st.pepperCannon];
  let best: { k: number; point: [number, number, number] } | null = null, bd = Infinity;
  st.enemy.forEach((e, k) => {
    if (!(e.flags & RF_ENABLED)) return;
    const d = Math.hypot(e.x - (c?.rec.x ?? st.pepper.x), e.z - (c?.rec.z ?? st.pepper.z));
    if (d < bd) { bd = d; best = { k, point: hitCentre(e) }; }
  });
  return best;
}

/** the keys (logical bits of game/input.ts B) to hold this tick to turn from the current heading / pitch to the plan (0 = on target) */
export function aimKeys(rx: number, ry: number, plan: { rx: number; ry: number }): { keys: number; onTarget: boolean } {
  const step = K.AIM_STEP;
  let keys = 0;
  if (plan.ry > ry + step * 0.6) keys |= 1; else if (plan.ry < ry - step * 0.6) keys |= 2;       // Left = ry +, Right = ry -
  if (plan.rx > rx + step * 0.6) keys |= 4; else if (plan.rx < rx - step * 0.6) keys |= 8;       // Up = rx +, Down = rx -
  return { keys, onTarget: keys === 0 };
}

/** which keys walk towards (dx, dz) with the fixed camera of the zone (controls are screen based: Up = away from the camera along its forward axis) */
export function steerKeys(cam: ArrayLike<number>, dx: number, dz: number): number {
  const fx = cam[15], fz = cam[17], rx = cam[9], rz = cam[11];
  const fl = Math.hypot(fx, fz) || 1, rl = Math.hypot(rx, rz) || 1, dl = Math.hypot(dx, dz) || 1;
  const df = (dx * fx + dz * fz) / (dl * fl), dr = (dx * rx + dz * rz) / (dl * rl);
  const t = 0.3;
  let keys = 0;
  if (df > t) keys |= 4; if (df < -t) keys |= 8; if (dr > t) keys |= 2; if (dr < -t) keys |= 1;
  return keys;
}
