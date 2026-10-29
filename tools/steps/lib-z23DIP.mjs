// Helpers of the z23DIP bots (tools/steps/m5-z23DIP*.mjs): steering Pepper along PATH nodes with REAL key presses (arrow keys held through the page's keyboard), reading the
// state of the zone. Builds on lib-hub.mjs.
import { hub as baseHub } from './lib-hub.mjs';

export const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

let opts_shot = true;
export function dip({ page, wait, log, shot }) {
  const H = baseHub({ page, wait, log, shot }, 'z23DIP');
  /** Pepper: place, yaw, control, current clip */
  H.pep = () => page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; return { x: p.x, y: p.y, z: p.z, ry: p.ry, ctrl: z.sh.vars.get(0x5e), clip: p.anim?.clip ?? -1, cs: !!z.game.debug().cutscene, node: z.sh.vars.get(0x58), tick: z.world.tickCount }; });
  /** the sign of Right: +1 when holding Right increases the yaw */
  // measured (m5-z23DIP-dirtest): forward = (sin ry, cos ry); Right increases the yaw by about 0.2 rad per tick once the key ramp is up, Left decreases it
  const turnSign = 1;
  H.calibrate = async () => turnSign;
  /**
   * walk to (x, z) with the arrow keys: Up held, Left / Right pressed while the heading is off by more than `tolAng`; stops within `tol` units or after `maxTicks` game ticks.
   * Returns { ok, d, ticks } (the last distance). `stop()` is polled (cutscene / node change ends it early).
   */
  H.walkTo = async (x, z, { tol = 6, maxTicks = 900, tolAng = 0.2, stop = null } = {}) => {
        const t0 = (await H.pep()).tick;
    let up = false, left = false, right = false, last = null, stuck = 0, res = null, detours = 0;
    const set = async (key, want, cur) => { if (want && !cur) await page.keyboard.down(key); if (!want && cur) await page.keyboard.up(key); return want; };
    for (;;) {
      const p = await H.pep();
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d <= tol) { res = { ok: true, d, ticks: p.tick - t0 }; break; }
      if (p.tick - t0 > maxTicks) { res = { ok: false, d, ticks: p.tick - t0 }; break; }
      if (stop && (await stop(p))) { res = { ok: false, d, ticks: p.tick - t0, stopped: true }; break; }
      if (p.cs) { up = await set('ArrowUp', false, up); left = await set('ArrowLeft', false, left); right = await set('ArrowRight', false, right); await wait(80); continue; }
      const err = wrap(Math.atan2(dx, dz) - p.ry);
      const turn = Math.abs(err) > tolAng ? Math.sign(err) * turnSign : 0;
      right = await set('ArrowRight', turn > 0, right);
      left = await set('ArrowLeft', turn < 0, left);
      up = await set('ArrowUp', true, up);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.05 && p.tick - last.tick > 20) stuck++; else if (last && p.tick - last.tick > 20) stuck = 0;
      if (!last || p.tick - last.tick > 20) last = p;
      if (stuck > 6) {
        // blocked (an actor / a wall in the way): a player steps aside: turn about 90 degrees one way (alternating), walk 30 ticks, then steer again
        if (detours >= 6) { if (opts_shot) await shot(`stuck-${Math.round(p.x)}-${Math.round(p.z)}`); res = { ok: false, d, ticks: p.tick - t0, stuck: true }; break; }
        const dir = detours % 2 === 0 ? 1 : -1; detours++;
        up = await set('ArrowUp', false, up); left = await set('ArrowLeft', false, left); right = await set('ArrowRight', false, right);
        await page.keyboard.down(dir > 0 ? 'ArrowRight' : 'ArrowLeft'); await H.untilTicks(async () => false, 7, 10); await page.keyboard.up(dir > 0 ? 'ArrowRight' : 'ArrowLeft');
        await page.keyboard.down('ArrowUp'); await H.untilTicks(async () => false, 30, 10); await page.keyboard.up('ArrowUp');
        stuck = 0; last = null;
        continue;
      }
      await wait(20);
    }
    await set('ArrowUp', false, up); await set('ArrowLeft', false, left); await set('ArrowRight', false, right);
    return res;
  };
  /** walk the PATH nodes in order (a list of node numbers) */
  H.walkPath = async (nodes, opts = {}) => {
    for (const n of nodes) {
      const p = Array.isArray(n) ? [n[0], 0, n[1]] : await H.pathNode(n);   // a PATH node number or a free [x, z] point
      const r = await H.walkTo(p[0], p[2], opts);
      log('node', n, JSON.stringify(p.map((v) => +v.toFixed(1))), JSON.stringify(r));
      if (!r.ok && !opts.carryOn) return false;
    }
    return true;
  };
  return H;
}
