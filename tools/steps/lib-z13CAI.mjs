// Helpers of the Adventure Island bots (tools/steps/m5-z13CAI-*.mjs): steering the helicopter / Ptera with REAL keys (Space = forward, Left / Right turn, Ctrl = land,
// Shift = the hologram), reading the vehicle from the page, the exit checks. Everything the bots press goes through page.keyboard (the game's own input mapper).
import { hub, hubUrl } from './lib-hub.mjs';

export const PORT = process.env.CAI_PORT ?? '5513';
export const BASE = process.env.BASE ?? `http://localhost:${PORT}`;
export const url = (node, extra = {}) => hubUrl('z13CAI', node, extra, BASE);

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function cai(h) {
  const { page, wait, log, shot } = h;
  const S = hub(h, 'z13CAI');
  const held = new Set();
  /** hold exactly the keys in `want` */
  S.keys = async (want = []) => {
    const w = new Set(want);
    for (const k of [...held]) if (!w.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of w) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  S.release = () => S.keys([]);
  /** the vehicle Pepper sits in (the island's vehicle globals): name, position, heading, PEPPER_CONTROL; null when none */
  S.veh = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const g = z.world.ext.get('island.vehicles'), c = g?.current, v = z.sh.vars;
    return { name: c ? c.name : null, x: c ? c.x : 0, y: c ? c.y : 0, z: c ? c.z : 0, ry: c ? c.ry : 0, ctrl: v.get(0x5e), tick: z.world.tickCount, next: v.get(5), node: v.get(0x58), arch: z.info.archive, s250: v.get(0xfa), cs: z.game?.debug?.().cutscene ?? false };
  });
  /** a record's position */
  S.at = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? [r.x, r.y, r.z] : null; }, name);
  /**
   * Steer the vehicle to (tx, tz) with Left / Right / Space until `done(state, dist, ang)` is true or `maxMs` passed. Returns the last state. The vehicle keeps its own altitude
   * (the helicopter holds 16..40 above the ground); `slow` releases Space inside that many units (the approach to the pad).
   */
  S.flyTo = async (tx, tz, { done = (s, d) => d < 30, maxMs = 120000, slow = 0, turnOnly = 0.5 } = {}) => {
    // (`maxMs` is game time, 30 ticks a second: a loaded page runs fewer ticks per second of wall time, so the limit is counted in ticks, with a wall-clock ceiling of 20 minutes)
    const t0 = Date.now(), maxTicks = (maxMs * 30) / 1000;
    let s = null, tick0 = -1;
    while (Date.now() - t0 < 1200000) {
      s = await S.veh();
      if (!s || s.arch !== 'z13CAI') break;
      if (tick0 < 0) tick0 = s.tick;
      if (s.tick - tick0 > maxTicks) break;
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz), ang = wrap(Math.atan2(dx, dz) - s.ry);
      if (await done(s, d, ang)) break;
      const k = [];
      if (ang > 0.08) k.push('ArrowRight'); else if (ang < -0.08) k.push('ArrowLeft');
      if (Math.abs(ang) < turnOnly && !(slow && d < slow)) k.push('Space');
      await S.keys(k);
      await wait(40);
    }
    await S.release();
    return s;
  };
  S.shot = shot; S.log = log; S.wait = wait; S.page = page;
  return S;
}
