// Helpers of the z16PYA bots (M5): real key input steering of Pepper towards a point (what a player does with the arrow keys), built on tools/steps/lib-hub.mjs.
//   const P = pya({ page, wait, log, shot });   // = hub(...) + steer / pepper state helpers
//   await P.steer(() => ({ x, z }), { stop: 4 });   // arrow keys: turn towards the point, walk, jump (Alt) when stuck; returns { arrived, ticks, stuck }
// Keys are held for game ticks (30 per second of game time), never for wall-clock time, so a slow page does not change the result.
import { hub } from './lib-hub.mjs';
import { parseCompiledWaypoints, nextHop } from '../../src/formats/waypoints.ts';
import { standaloneCtx } from '../lib/ctx-standalone.mjs';

let pathMap = null;
/** the Pyramid's compiled PATH map (Waypoints/W_PATH_C.wpt, the NPCs' roads: also the routes a player takes through the dunes) */
export function pyramidPath() {
  if (!pathMap) {
    const a = standaloneCtx().archives.find((x) => x.name.toLowerCase() === 'z16pya');
    pathMap = parseCompiledWaypoints(a.read(a.find('Waypoints/W_PATH_C.wpt')));
  }
  return pathMap;
}
/** the nodes of the route from node a to node b (FUN_00463b49 next-hop matrix), a and b included */
export function pathRoute(a, b) {
  const wp = pyramidPath(), out = [a];
  for (let n = a, k = 0; n !== b && k < 400; k++) { const h = nextHop(wp, n, b); if (h === n) break; out.push(h); n = h; }
  return out;
}
/** the PATH node nearest to (x, z) */
export function nearestNode(x, z) {
  const wp = pyramidPath(); let best = 0, bd = Infinity;
  wp.nodes.forEach((n, i) => { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

const TURN_PER_TICK = 0.17;   // measured in the Pyramid: 10 ticks of Left / Right turn Pepper by about 1.7 rad
export function pya({ page, wait, log = () => {}, shot = async () => {} }) {
  const H = hub({ page, wait, log, shot }, 'z16PYA');
  /** Pepper's place, yaw, tick and the control word */
  H.me = () => page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; return { x: p.x, y: p.y, z: p.z, ry: p.ry, t: z.world.tickCount, ctrl: z.sh.vars.get(0x5e), node: z.sh.vars.get(0x58), cs: !!z.game?.debug?.().cutscene }; });
  /** hold keys for `n` game ticks */
  H.keys = (keys, n) => page.evaluate(async ([ks, ticks]) => {
    // the keys go down and up as DOM keyboard events at the page (what the input mapper listens to, like Playwright's own keyboard and browse.mjs's mode-1 tap), released after exactly
    // `ticks` simulation ticks counted INSIDE the page: a loaded machine (headless software GL) must not stretch a 3-tick turn into 8 ticks
    const w = window.__zone.world, fire = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { code: k, key: k, bubbles: true }));
    ks.forEach((k) => fire('keydown', k));
    const t0 = w.tickCount;
    while (w.tickCount - t0 < ticks) await new Promise((r) => setTimeout(r, 0));
    [...ks].reverse().forEach((k) => fire('keyup', k));
  }, [keys, n]);
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  /**
   * walk to the point `target()` returns (called every step: it may follow a moving record or the objective arrow); `stop` = distance at which to stop;
   * `until` = optional predicate (async) that ends the walk early (the story moved on, a cutscene started)
   */
  H.steer = async (target, { stop = 4, maxTicks = 6000, until = null, label = '' } = {}) => {
    let stuckTicks = 0, jumps = 0, last = await H.me(), t0 = last.t, lastProgress = last, steps = 0;
    for (;;) {
      const s = await H.me();
      if (s.t - t0 > maxTicks) return { arrived: false, ticks: s.t - t0, why: 'timeout', at: s };
      if (until && (await until(s))) return { arrived: false, ticks: s.t - t0, why: 'until', at: s };
      if (s.cs) { await H.skipCutscenes(); continue; }
      if ((s.ctrl & 0x100) !== 0) { await H.freePepper(); continue; }
      const tg = await target();
      if (!tg) return { arrived: false, ticks: s.t - t0, why: 'no target', at: s };
      const dx = tg.x - s.x, dz = tg.z - s.z, d = Math.hypot(dx, dz);
      if (d < stop) return { arrived: true, ticks: s.t - t0, dist: d, at: s };
      const diff = wrap(Math.atan2(dx, dz) - s.ry);
      steps++;
      // progress check every ~40 ticks of walking
      if (s.t - lastProgress.t >= 40) {
        const moved = Math.hypot(s.x - lastProgress.x, s.z - lastProgress.z);
        stuckTicks = moved < 3 ? stuckTicks + 1 : 0;
        lastProgress = s;
      }
      if (stuckTicks >= 1) {
        // blocked: turn aside a random amount and jump while walking (Alt = jump), then try again
        jumps++;
        log('  stuck at', JSON.stringify([s.x, s.y, s.z].map((v) => +v.toFixed(1))), 'jump try', jumps);
        const side = jumps % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
        await H.keys([side], 4 + (jumps % 5) * 2);
        await H.keys(['ArrowUp', 'AltLeft'], 14);
        await H.keys(['ArrowUp'], 20);
        stuckTicks = 0; lastProgress = await H.me();
        continue;
      }
      // turn on the spot (10 ticks of a turn key = 1.7 rad: never turn while walking, it overshoots), then walk a few ticks
      if (Math.abs(diff) > 0.1) await H.keys([diff < 0 ? 'ArrowLeft' : 'ArrowRight'], Math.max(1, Math.min(9, Math.round(Math.abs(diff) / TURN_PER_TICK))));
      if (Math.abs(diff) <= 0.9) await H.keys(['ArrowUp'], 5);
    }
  };
  /** walk the PATH route from the node nearest to Pepper to `goalNode`, node after node (the roads of the original's own walkers); returns the last steer result */
  H.follow = async (goalNode, opt = {}) => {
    const wp = pyramidPath();
    const me = await H.me();
    const route = pathRoute(nearestNode(me.x, me.z), goalNode);
    log('route', route.length, 'nodes', route.slice(0, 6).map((n) => n.toString(16)).join(','), '...');
    let r = null;
    for (let i = 0; i < route.length; i++) {
      const n = wp.nodes[route[i]];
      const last = i === route.length - 1;
      r = await H.steer(async () => ({ x: n.x, z: n.z }), { stop: last ? (opt.stop ?? 2) : 3.5, maxTicks: opt.legTicks ?? 700, until: opt.until });
      log('  node', route[i].toString(16), JSON.stringify({ arrived: r.arrived, ticks: r.ticks, why: r.why, at: [r.at.x, r.at.y, r.at.z].map((v) => +v.toFixed(1)) }));
      if (r.why === 'until') return r;
      if (!r.arrived && r.why === 'timeout') {
        // the bot's steering is crude (no obstacle planning): a leg that does not finish in `legTicks` ticks is closed by putting Pepper on the node (counted in H.shortcuts)
        H.shortcuts = (H.shortcuts ?? 0) + 1;
        log('  SHORTCUT: leg to node', route[i].toString(16), 'not finished, Pepper put on the node');
        await H.teleportTo(n.x, n.z, n.x, n.z + 1);
        await H.untilTicks(async () => false, 10, 20);
      }
    }
    return r;
  };
  return H;
}
