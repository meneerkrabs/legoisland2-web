// z22BIP: a scripted pilot for the node tests and the browser runs (no imports: the browser steps send `botButtons` into the page). It reads the zone's live objects
// (the `BipSetup` the zone game keeps as `game.setup`, the world) and returns the buttons to hold this tick (src/game/input.ts bits): Left / Right steer, Up dives,
// Down climbs, Space fires. It follows the course (the spline) a little ahead, keeps clear of the terrain, dives for the next fuel can when the tank is not full
// enough and shoots bananas at awake monkeys in front of it.
const LEFT = 1, RIGHT = 2, UP = 4, DOWN = 8, SPACE = 0x80;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function botButtons(S, w, o = {}) {
  const walk = S.walk, plane = S.plane, sp = S.run.spline;
  if (w.vars.get(0xfa) !== 2) return 0;
  let b = 0;
  const x = plane.x, y = plane.y, z = plane.z, h = walk.heading;
  const t = sp.nearest([x, y, z]);
  const look = o.look ?? 0.02;
  const tp = sp.sample(Math.min(0.999, t + look));
  let tx = tp[0], tz = tp[2], ty = tp[1] + (o.clear ?? 14);
  // a fuel can ahead (picked ones sit at the origin): aim at it when the tank has room for it
  let can = null;
  if (S.run.hudFuel < (o.refuelBelow ?? 85)) {
    let best = 1e9;
    for (const r of w.records) {
      if (!r.name.startsWith('FUEL') || (Math.abs(r.x) < 1 && Math.abs(r.z) < 1)) continue;
      const dx = r.x - x, dz = r.z - z, d = Math.hypot(dx, dz);
      const ang = wrap(Math.atan2(dx, dz) - h);
      if (d < (o.canRange ?? 330) && d > 6 && Math.abs(ang) < 0.75 && d < best) { best = d; can = r; }
    }
  }
  if (can) { tx = can.x; tz = can.z; ty = can.y + (o.canLift ?? 1.5); }
  const e = wrap(Math.atan2(tx - x, tz - z) - h);
  if (e > 0.03) b |= RIGHT; else if (e < -0.03) b |= LEFT;
  // terrain ahead
  let ground = -1e9;
  if (!can) for (let k = 1; k <= 4; k++) { const gx = x + Math.sin(h) * k * 25, gz = z + Math.cos(h) * k * 25; const g = w.col.terrainHeight(gx, 120, gz, 0); if (g > -1e30) ground = Math.max(ground, g); }
  let want = can ? ty : Math.max(ty, ground + (o.ground ?? 12));
  want = Math.max(4, Math.min(92, want));
  const climb = want - walk.alt;
  if (climb > 3) b |= DOWN; else if (climb < -3) b |= UP;
  // bananas at awake monkeys in front
  if (S.monkeys) for (const m of S.monkeys) {
    if (m.node.state !== 1) continue;
    const dx = m.rec.x - x, dz = m.rec.z - z, d = Math.hypot(dx, dz);
    if (d < 170 && Math.abs(wrap(Math.atan2(dx, dz) - h)) < 0.35) { b |= SPACE; break; }
  }
  return b;
}
