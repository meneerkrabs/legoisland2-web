import { createRunner, makeScript, constScript, findLedges } from '../lib/m7-walk-run.mjs';
import { loadZone } from '../lib/engine-load.mjs';
import { B } from '../../src/game/input.ts';
import { ST } from '../../src/game/walk.ts';

// M7 / WP-VERIFY: the edge cases of the island's terrain: cliff edges walked towards slowly for a long time (teeter, back to idle with the land flag, then the forced jump), every state a
// node can request standing at an edge (the ledge test skips 2, 1, 0x1f, 0x57, 0x1a, 0x1c, 0x37, 0x38), a jump from the very edge, and walking into props whose record name starts with PAG
// (the walk's wall test ignores them). dt 1 and 0.5. See m7-walk-emu.mjs for the method.
export default {
  name: 'm7-walk-ledge',
  async run(ctx) {
    const R = await createRunner(ctx);
    const ledges = findLedges(ctx);
    const L0 = loadZone(ctx, 'z02LGI');
    const pag = L0.world.records.filter((r) => r.name.startsWith('PAG') && r.colObj && r.colObj.radius > 0);
    const place = (l) => ({ pos: [l.x - l.dx * 4, l.h + 0.5, l.z - l.dz * 4], yaw: Math.atan2(l.dx, l.dz) });
    const l1 = ledges[5], l2 = ledges[12];
    const pad = (n, v = -48) => (t, w, walk) => { walk.padY = t < n ? v : 0; };
    // a long slow approach: teeter (0x38) -> idle with land flag -> the forced jump
    for (const dt of [1, 0.5]) R.scenario({ name: 'ledge: slow pad approach, long', zone: 'z02LGI', dt, held: new Array(dt === 1 ? 260 : 330).fill(0), inject: pad(1000), ...place(l1) });
    // every requestable state standing at the edge
    const injectAt = (tick, state, extra) => (t, w, walk, rec) => { walk.padY = t < 60 ? -48 : 0; if (t === tick) { w.pep.mailbox = state; extra?.(w, walk, rec); } };
    for (const dt of [1, 0.5]) for (const [st, tick] of [[ST.KNOCKBACK, 14], [ST.OFFBOARD, 14], [ST.LANDING, 14], [ST.SLIDE, 14], [ST.JUMPSTART, 14], [ST.JUMP2, 14], [ST.CRASH, 14], [ST.THROW, 14]]) {
      R.scenario({ name: `ledge: state 0x${st.toString(16)} at the edge`, zone: 'z02LGI', dt, held: new Array(dt === 1 ? 70 : 100).fill(0), inject: injectAt(tick, st, (w, walk) => { if (st === ST.JUMP2) { walk.t = Math.fround(0.1); walk.v0 = 17.5; walk.y0 = 0; } }), ...place(l2) });
    }
    // Alt at the edge, run off the edge and land, the double jump over the gap
    for (const dt of [1, 0.5]) R.scenario({ name: 'ledge: Alt taps at the edge', zone: 'z02LGI', dt, held: constScript([[B.UP, 12], [B.UP | B.ALT, 1], [B.UP, 8], [B.ALT, 1], [B.UP, 40], [0, 20]]), ...place(ledges[8]) });
    // props named PAG*: walk into them from several sides
    for (const [i, r] of pag.slice(0, 3).entries()) {
      const c = r.toWorld(r.colObj.col.center), yaw = (i * 2.1) % 6.28, d = r.colObj.radius + 6;
      for (const dt of [1, 0.5]) R.scenario({ name: `PAG prop ${r.name} ${c[0].toFixed(0)},${c[2].toFixed(0)}`, zone: 'z02LGI', dt, held: constScript([[B.UP, dt === 1 ? 80 : 110], [0, 10]]), pos: [c[0] - Math.sin(yaw) * d, c[1] + 20, c[2] - Math.cos(yaw) * d], yaw });
    }
    return { checked: R.checked, failures: R.failures, notes: [...R.summary(), `PAG records on the island: ${pag.length}; ledge places found: ${ledges.length}`] };
  },
};
