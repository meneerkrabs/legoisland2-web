// A scripted player for z28HAT (node tests and the headless browser steps): decides the held keys from `hatSnapshot(world)` (src/zones/z28hat/game.ts) alone.
// It flies the balloon to each dinosaur, lowers the hook, carries the dinosaur to the landing site, lets it go, and once all eleven are down hovers over Bronty's head
// and drops the sandbags. Keys are the logical button bits of the input mapper: 1 Left, 2 Right, 4 Up, 8 Down, 0x40 Shift (hook / sandbag).
export const KEY = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, SHIFT: 0x40 };

export function makePlan(opts = {}) {
  return {
    phase: 'pick', target: null, kind: null, cool: 0, tick: 0, tries: 0, hooked: 0, log: [],
    /** the horizontal distance within which the hook is lowered, and the speed under which it is */
    near: opts.near ?? 5, slow: opts.slow ?? 0.25,
    /** which dinosaurs to leave alone (a LOSS bot that does nothing passes `idle`) */
    idle: !!opts.idle,
    /** the sandbag phase: ticks hovering */
    hover: 0,
    /** a fixed list of targets (tests) */
    only: opts.only ?? null,
    /** `quick`: only these targets (e.g. ['babies0', 'dino1']) are carried to the landing site, every other dinosaur is let go where it hangs (counted, no points) */
    carry: opts.carry ?? null,
  };
}

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Steer to (tx, tz): the thrust follows the wanted change of velocity (desired velocity - velocity), the turn aligns the balloon (front or back) with it.
 * Returns the key mask; `gain` is the speed per unit of distance, `vmax` its limit.
 */
export function steer(s, tx, tz, gain = 0.045, vmax = 1.5) {
  const b = s.balloon, v = s.mom;
  const ex = tx - b.x, ez = tz - b.z, d = Math.hypot(ex, ez);
  let sp = Math.min(vmax, d * gain);
  const dvx = (d > 0 ? ex / d : 0) * sp - v[0], dvz = (d > 0 ? ez / d : 0) * sp - v[2];
  const dv = Math.hypot(dvx, dvz);
  let mask = 0;
  const fl = Math.hypot(b.fx, b.fz) || 1, fx = b.fx / fl, fz = b.fz / fl;
  // thrust direction: forward or backward, whichever is closer to the wanted change; heading of the wanted direction
  const dot = fx * dvx + fz * dvz;
  const sign = dot >= 0 ? 1 : -1;
  const want = Math.atan2(dvx, dvz) + (sign < 0 ? Math.PI : 0);
  const have = Math.atan2(fx, fz);
  const err = wrap(want - have);
  // the balloon turns by +ry when RIGHT is held (forward = (sin ry, cos ry))
  if (dv > 0.02) {
    if (err > 0.06) mask |= KEY.RIGHT; else if (err < -0.06) mask |= KEY.LEFT;
    if (Math.abs(err) < 0.5 && dv > 0.05) mask |= sign > 0 ? KEY.UP : KEY.DOWN;
  }
  return { mask, d, dv, err, speed: Math.hypot(v[0], v[2]) };
}

/** next target of the dinosaur phase: the closest dinosaur still standing (a baby group counts as the nest) */
function pickTarget(s, plan) {
  const b = s.balloon;
  const cand = [];
  s.dinos.forEach((d, i) => { if (d.on && d.state === 0) cand.push({ kind: 'dino', i, x: d.x, z: d.z, d: Math.hypot(d.x - b.x, d.z - b.z) }); });
  if (s.babies.every((d) => d.on && d.state === 0)) { const n = s.babies[0]; cand.push({ kind: 'babies', i: 0, x: s.nest?.x ?? n.x, z: s.nest?.z ?? n.z, d: Math.hypot(n.x - b.x, n.z - b.z) }); }
  const pool = plan.only ? cand.filter((c) => plan.only.includes(c.kind + c.i)) : cand;
  pool.sort((a, c) => a.d - c.d);
  return pool[0] ?? null;
}

/** is the target still standing (a baby group counts when all five are) */
function stillThere(s, t) {
  if (t.kind === 'dino') { const d = s.dinos[t.i]; return d.on && d.state === 0; }
  return s.babies.every((d) => d.on && d.state === 0);
}

/** one decision: returns the key mask to hold for the next tick (the bot presses Shift for exactly one tick when it means a press) */
export function hatBotStep(s, plan) {
  plan.tick++;
  if (plan.idle) return 0;
  let mask = 0;
  const b = s.balloon;
  if (plan.cool > 0) plan.cool--;
  const press = () => { if (plan.cool === 0) { mask |= KEY.SHIFT; plan.cool = 4; return true; } return false; };
  switch (plan.phase) {
    case 'pick': {
      if (s.allDone) { plan.phase = 'bronty'; break; }
      const t = pickTarget(s, plan);
      if (!t) {
        // nothing standing and not all done: the last ones are still landing / blinking
        mask = steer(s, s.drop.x, s.drop.z).mask;
        break;
      }
      plan.target = t; plan.kind = t.kind; plan.phase = 'approach'; plan.log.push(`target ${t.kind}${t.i}`);
      plan.toDrop = !plan.carry || plan.carry.includes(t.kind + t.i);
      break;
    }
    case 'approach': {
      const t = plan.target;
      if (s.allDone) { plan.phase = 'bronty'; break; }
      if (!stillThere(s, t) || plan.tries > 8) { plan.tries = 0; plan.phase = 'pick'; plan.log.push('target gone'); break; }
      // follow the target (the standing dinosaurs do not move; the nest is fixed)
      const st = steer(s, t.x, t.z, 0.05, 1.5);
      mask = st.mask;
      const need = t.kind === 'babies' ? Math.min(plan.near, 2.5) : plan.near;
      if (st.d < need && st.speed < plan.slow && s.winch === 0 && !s.carrying) { if (press()) { plan.phase = 'lower'; plan.hooked = 0; plan.log.push('lower'); } }
      break;
    }
    case 'lower': {
      // keep hovering over the target while the hook goes down
      const t = plan.target;
      if (s.allDone) { plan.phase = 'bronty'; break; }
      mask = steer(s, t.x, t.z, 0.05, 0.5).mask;
      if (s.carrying) { plan.phase = 'carry'; plan.log.push('hooked'); }
      else if (s.winch === 0) { plan.tries++; plan.phase = 'approach'; plan.log.push('missed'); }
      break;
    }
    case 'carry': {
      const st = steer(s, s.drop.x, s.drop.z, 0.04, 1.5);
      mask = plan.toDrop === false ? 0 : st.mask;
      if (!s.carrying) { plan.phase = 'pick'; plan.log.push('released / lost'); break; }
      if (plan.toDrop === false) { if (s.winch === 0 || plan.tick % 7 === 0) { if (press()) { plan.phase = 'release'; plan.log.push('let go in place'); } } break; }
      if (st.d < 12 && st.speed < 0.5 && s.winch === 0) { if (press()) { plan.phase = 'release'; plan.log.push('release'); } }
      break;
    }
    case 'release': {
      mask = plan.toDrop === false ? 0 : steer(s, s.drop.x, s.drop.z, 0.04, 0.8).mask;
      if (!s.carrying) plan.phase = 'pick';
      else if (plan.cool === 0) press();
      break;
    }
    case 'bronty': {
      const m = s.mouth ?? s.bronty;
      const st = steer(s, m.x, m.z, 0.05, 1.5);
      mask = st.mask;
      if (st.d < 3.5 && st.speed < 0.35) {
        plan.hover++;
        if (plan.hover > 2 && s.brontyState !== 1 && !s.sandbags.some((x) => x.active)) press();
      } else plan.hover = 0;
      break;
    }
  }
  return mask;
}
