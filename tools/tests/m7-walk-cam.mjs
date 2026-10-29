import { createRunner, makeScript, rng } from '../lib/m7-walk-run.mjs';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';

// M7 / WP-VERIFY + WP-ISLAND-FIX: the chase camera of src/game/camera.ts against the original's FUN_0042c227 (chase), FUN_0043cc5c (view basis), FUN_0042b8e8 (key ramps) in the x86 emulation,
// tolerance 0 on every camera float, the vertical velocity, the node's stick fields and the hit cache the camera's rays leave. The findings of the first run are closed:
//   CAM-1  a zone without a ground record (house, room zones): no ground record = "no hit" (was `ground ?? true`);
//   CAM-2  float32 storage (the camera is a Float32Array) and float32 constants / operations (the camera rests exactly on its minimum height: equality compares);
//   CAM-3  the view basis computed per operation in float32 (LookAtLH: forward, up - (up . z) z normalised, right = up x z).
// The mouse path (FUN_00437ca5: buttons 0x10 / 0x20, movement since the last tick replacing the camera sticks, zoom like <> + Z / X + C) is driven with random bursts: oracle hook `H.mouse`, port `w.input.mouse`.
export default {
  name: 'm7-walk-cam',
  async run(ctx) {
    const R = await createRunner(ctx);
    const mouseScript = (seed, ticks) => {
      const r = rng(seed), out = [];
      let t = 0;
      while (t < ticks) {
        const len = 1 + r.int(20), kind = r.int(4);
        const m = { buttons: kind === 1 ? 0x10 : kind === 2 ? 0x20 : kind === 3 ? 0x30 : 0, dx: r() < 0.6 ? r.int(81) - 40 : 0, dy: r() < 0.6 ? r.int(81) - 40 : 0 };
        if (r() < 0.3) { m.dx = 0; m.dy = 0; }
        for (let i = 0; i < len && t < ticks; i++, t++) out.push(r() < 0.8 ? m : { buttons: m.buttons, dx: r.int(9) - 4, dy: r.int(9) - 4 });
      }
      return out;
    };
    const run = (name, zone, dt, held, o = {}) => R.scenario({ name, zone, dt, held, ...o });
    for (let seed = 1; seed <= 2; seed++) run(`z03PPH seed ${seed}`, 'z03PPH', seed === 2 ? 0.5 : 1, makeScript(seed, 250, { jump: 0.03 }));   // no ground record
    run('z50LTC', 'z50LTC', 1, makeScript(31, 200, { jump: 0.03 }));                              // ground record CAVE
    const wp = parseCompiledWaypoints(ctx.archives.find((a) => a.name === 'z02LGI').read('Waypoints/W_PATH_C.wpt'));
    const nodes = wp.nodes.filter((n) => n.y < 60), r = rng(11);
    for (let i = 0; i < 2; i++) { const nd = nodes[r.int(nodes.length)]; run(`island node ${nd.x.toFixed(0)},${nd.z.toFixed(0)}`, 'z02LGI', i ? 0.5 : 1, makeScript(40 + i, 150), { pos: [nd.x, nd.y + 0.5, nd.z], yaw: r() * 6.28 }); }
    // the mouse path: with and without ground record, dt 1 and 0.5, vehicle heights
    for (let i = 0; i < 3; i++) {
      const nd = nodes[r.int(nodes.length)], dt = i === 1 ? 0.5 : 1;
      run(`mouse island ${i}`, 'z02LGI', dt, makeScript(60 + i, 200, { camera: i === 2 }), { pos: [nd.x, nd.y + 0.5, nd.z], yaw: r() * 6.28, mouse: mouseScript(70 + i, 200), setup: i === 2 ? (L, w) => { w.camera.vehicle = true; } : undefined });
    }
    run('mouse z03PPH', 'z03PPH', 1, makeScript(65, 200), { mouse: mouseScript(75, 200) });
    run('mouse z50LTC', 'z50LTC', 0.5, makeScript(66, 200), { mouse: mouseScript(76, 200) });
    return { checked: R.checked, failures: R.failures, notes: R.summary() };
  },
};
