import { createRunner, makeScript, constScript, rng, findLedges } from '../lib/m7-walk-run.mjs';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';
import { B } from '../../src/game/input.ts';

// M7 / WP-VERIFY: Pepper walking on the island z02LGI (sub-game 2, ground record LAND, sea level 2.4, 393 collision records, skateboard accessory): see m7-walk-emu.mjs for the method.
// Start places: PATH waypoint nodes (roads, slopes, stairs, the beach), random yaw, random key scripts with jumps, camera keys; cliff edges found by scanning the terrain (teeter on the edge when
// walking slowly, a jump / fall when running); walls of the buildings and props. dt = 1 here, 0.5 in m7-walk-dt.
export default {
  name: 'm7-walk-island',
  async run(ctx) {
    const R = await createRunner(ctx);
    const dt = +(process.env.M7_DT ?? 1);
    const wp = parseCompiledWaypoints(ctx.archives.find((a) => a.name === 'z02LGI').read('Waypoints/W_PATH_C.wpt'));
    const nodes = wp.nodes.filter((n) => n.y < 60);
    const r = rng(7);
    const N = +(process.env.M7_N ?? 6), T = +(process.env.M7_T ?? 200);
    for (let i = 0; i < N; i++) {
      const nd = nodes[r.int(nodes.length)];
      R.scenario({ name: `island node ${nd.x.toFixed(0)},${nd.z.toFixed(0)} seed ${i}`, zone: 'z02LGI', pos: [nd.x, nd.y + 0.5, nd.z], yaw: r() * 6.28, dt, held: makeScript(100 + i, T) });
    }
    // cliffs: start 4 units before an edge facing it; the pad stick at 3/8 deflection walks slowly (speed 0.35: teeter on the edge), the run key runs off it (fall)
    const ledges = findLedges(ctx);
    const picks = [3, 6, 11, 14].map((k) => ledges[(k * 7 + 1) % ledges.length]);
    picks.forEach((l, k) => {
      const run = k === 3;
      R.scenario({ name: `island ledge ${l.x},${l.z} ${run ? 'run' : 'pad'}`, zone: 'z02LGI', pos: [l.x - l.dx * 4, l.h + 0.5, l.z - l.dz * 4], yaw: Math.atan2(l.dx, l.dz), dt,
        held: run ? constScript([[B.UP, 60], [0, 30]]) : new Array(110).fill(0), inject: run ? undefined : (t, w, walk) => { walk.padY = t < 80 ? -48 : 0; } });
    });
    return { checked: R.checked, failures: R.failures, notes: R.summary() };
  },
};
