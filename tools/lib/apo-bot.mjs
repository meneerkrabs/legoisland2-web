// A scripted pilot for z40aPO (node tests and the browser steps): from a snapshot (`apoSnapshot`, src/zones/z40aPO.ts) the held key mask for the next tick.
// Dives through the 15 rings in order (aiming at the centre disc RCnn), opens the wing when allowed and glides to a target.
import { B } from '../../src/game/input.ts';
import { steerBits, pitchBits } from './par-bot.mjs';

/** plan = { rings: number of rings to try (default 15), land: target 1..3 (default 3), noChute: never open the wing, margin / noFlareBelow like par-bot } */
export function apoBotStep(s, plan = {}) {
  const p = s.pepper;
  let mask = 0;
  if (s.state === 2) {
    const n = plan.rings ?? 15;
    let next = -1;
    for (let i = 0; i < n; i++) if (s.ring[i] === 0 && p.y > s.rc[i].y - 2) { next = i; break; }
    if (next >= 0) {
      const r = s.rc[next];
      const dh = Math.hypot(r.x - p.x, r.z - p.z);
      mask |= steerBits(s, r.x, r.z);
      mask |= pitchBits(s, dh > 3 ? 4.25 : 4.71);
    } else mask |= pitchBits(s, 4.71);
    if (!plan.noChute && s.chuteOk) mask |= B.SHIFT;
  } else if (s.state === 4) {
    const t = s.targets[(plan.land ?? 3) - 1];
    const dh = Math.hypot(t.x - p.x, t.z - p.z);
    mask |= steerBits(s, t.x, t.z);
    const can = ((p.y + 50) * 8 * 0.3) / 2400 / 0.3;
    if (dh / Math.max(1, s.height) > can * (plan.margin ?? 0.9) && s.height > (plan.noFlareBelow ?? 20)) mask |= B.UP;
  }
  return mask;
}
