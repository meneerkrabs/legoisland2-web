// z10RGB: a scripted player for the node tests and the headless browser runs (not part of the game): it walks the bridge (a fixed list of waypoints found with the
// walk sweeps), enters a cannon, aims at the nearest enemy cannon that is still there with the flight model of the ball (FUN_005f8a7b) and fires when the
// cannon has reloaded. The browser steps get the same decisions through `ZoneGame.assist` (the page holds the keys with real key presses).
import { buildMatrix } from '../../formats/matrix.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { K } from './consts.ts';
import { shotScale } from './pepper.ts';
import type { RgbState } from './shared.ts';

/** the walk from the start to the cannons: the bridge, its gap in the invisible fence at z = -15 .. -12, the field of the cannons (found with the walk sweeps) */
export const ROUTE: readonly (readonly [number, number])[] = [[100, -6], [40, -10], [10, -16.2], [-20, -16.2], [-47, -14], [-56, -13], [-70, -13], [-88, -12]];

export interface ShotPlan { rx: number; ry: number; /** where the ball comes down (x, z), the horizontal miss and the flight time in ticks */ land: [number, number]; miss: number; time: number }

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
  // every pitch that brings the ball within 2 units of the target (a low and a high arc may both do): the one that lands first
  const good: ShotPlan[] = [];
  let best: ShotPlan | null = null;
  for (let rx = K.PITCH_MIN; rx <= K.PITCH_MAX + 1e-9; rx += 0.004) {
    const p = tryPitch(rx);
    if (!p) continue;
    if (!best || p.miss < best.miss) best = p;
    if (p.miss < 6) good.push(p);
  }
  const refine = (c0: number): ShotPlan | null => {
    let b: ShotPlan | null = null;
    for (let rx = Math.max(K.PITCH_MIN, c0 - 0.004); rx <= Math.min(K.PITCH_MAX, c0 + 0.004); rx += 0.0005) {
      const p = tryPitch(rx);
      if (p && (!b || p.miss < b.miss)) b = p;
    }
    return b;
  };
  const cand = good.map((g) => refine(g.rx)).filter((g): g is ShotPlan => !!g && g.miss < 2).sort((a, b) => a.time - b.time);
  if (cand.length) return cand[0];
  return best ? refine(best.rx) ?? best : null;
}

/** the nearest enemy cannon that is still there (to the player's cannon), its centre as the aim point (the model's middle: a little above its position) */
export function nextTarget(st: RgbState): { k: number; point: [number, number, number] } | null {
  const c = st.cannons[st.pepperCannon];
  let best: { k: number; point: [number, number, number] } | null = null, bd = Infinity;
  st.enemy.forEach((e, k) => {
    if (!(e.flags & RF_ENABLED)) return;
    const d = Math.hypot(e.x - (c?.rec.x ?? st.pepper.x), e.z - (c?.rec.z ?? st.pepper.z));
    if (d < bd) { bd = d; best = { k, point: [e.x, e.y + 2.5, e.z] }; }
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
