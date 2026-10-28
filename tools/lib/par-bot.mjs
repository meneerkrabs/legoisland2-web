// A scripted pilot for z38PAR (node tests and the browser steps use the same decisions): from a snapshot of the run (`parSnapshot`, src/zones/z38PAR.ts)
// it returns the held key mask for the next tick: dives through the rings at the dive angle (rx 4.0 .. 5.5 rad), opens the chute when allowed, steers to a target.
import { B } from '../../src/game/input.ts';

const TWO_PI = 6.2831855;
const wrapPi = (a) => { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; };

/** the held LEFT / RIGHT bit that turns the heading towards (tx, tz) */
export function steerBits(s, tx, tz) {
  const p = s.pepper;
  const d = wrapPi(Math.atan2(tx - p.x, tz - p.z) - p.ry);
  const want = Math.max(-0.14, Math.min(0.14, d * 0.35));
  if (want - s.yawRate > 0.012) return B.RIGHT;
  if (s.yawRate - want > 0.012) return B.LEFT;
  return 0;
}

/** hold Up / Down until the pitch rx is at `target` (radians, wraps) */
export function pitchBits(s, target) {
  const d = wrapPi(target - s.pepper.rx);
  if (d > 0.04) return B.UP;
  if (d < -0.04) return B.DOWN;
  return 0;
}

/**
 * plan = { rings: order to try (default [3, 2, 1]), land: target to land on (1..3, default 3), ring1Offset: where to cross ring 1 (the balloon hangs in its middle),
 * noChute: never open the chute (the crash scenario), dive: false to fall flat (no dive bonus), margin: pull-up threshold relative to the plain glide ratio }
 */
export function parBotStep(s, plan = {}) {
  const p = s.pepper;
  const order = plan.rings ?? [3, 2, 1];
  const ring = (n) => s.rings[n - 1];
  let mask = 0;
  if (s.state === 1) {
    const next = order.find((n) => s.ring[n - 1] === 0 && p.y > ring(n).y - 3);
    if (next) {
      const r = ring(next);
      const off = next === 1 ? (plan.ring1Offset ?? [8, 0]) : [0, 0];
      const tx = r.x + off[0], tz = r.z + off[1];
      const dh = Math.hypot(tx - p.x, tz - p.z);
      mask |= steerBits(s, tx, tz);
      // far: glide forward at a dive angle that still gives forward speed (4.25 rad: sin(8.5) = 0.8); on the axis: straight down (4.71)
      mask |= pitchBits(s, plan.dive === false ? 0.2 : dh > 3 ? 4.25 : 4.71);
    } else {
      mask |= pitchBits(s, plan.dive === false ? 0 : 4.71);
    }
    if (!plan.noChute && s.chuteOk) mask |= B.SHIFT;
  } else if (s.state === 3) {
    const t = s.targets[(plan.land ?? 3) - 1];
    const dh = Math.hypot(t.x - p.x, t.z - p.z);
    mask |= steerBits(s, t.x, t.z);
    // pull up (4x forward speed, half the sink) while the plain glide cannot reach the target: the plain glide covers 8 * 0.3 * y / 1760 per tick while sinking 0.3
    // (ratio y / 220), so the pull-up is needed when dh / height is above that
    const can = (p.y * 8 * 0.3) / 1760 / 0.3;
    if (dh / Math.max(1, s.height) > can * (plan.margin ?? 0.9) && s.height > (plan.noFlareBelow ?? 20)) mask |= B.UP;
  }
  return mask;
}
