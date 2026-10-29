// Restored feature 'swimmer' (src/restore/features/swimmer.ts): BML2 (record 367, kind 2) is placed on open sea and swims; 3000 ticks over every shape (var 0x2e counts 0..7) stay in water.
// Option off: BML2 stays where the original leaves it (0, 0, 0, flags 0x20, no node).
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { loadIsland, tick } from '../lib/island-load.mjs';
import { isSea, openSea, CLEAR, VAR_BML2 } from '../../src/restore/features/swimmer.ts';

const only = RESTORE_FEATURES.map((f) => f.id).filter((f) => f !== 'swimmer');
const clear = () => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; };

export default {
  name: 'restore-swimmer',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };

    forceRestored(null); clear();
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      const b = I.rec('BML2');
      ok(b.x === 0 && b.y === 0 && b.z === 0 && !b.ctrl, 'option off: BML2 is not placed and has no node');
    }
    forceRestored(true, only); await loadRestore();
    for (const node of [2, 31, 56, 68]) {
      const I = loadIsland(ctx, { node, bricks: true });
      const game = { ctx: { world: I.world } };
      const bml1 = [I.rec('BML1').x, I.rec('BML1').z], bml3 = [I.rec('BML3').x, I.rec('BML3').z];
      restoreHooks.islandStart(game);
      const b = I.rec('BML2');
      const n = b.ctrl?.nodes.find((x) => x.kind === 'Brikimal');
      ok(!!n && n.var === VAR_BML2 && n.mask === 0, `node ${node}: BML2 has the Brikimal node on var 0x2e`);
      if (!n) continue;
      const hx = b.x, hz = b.z;
      ok(openSea(I.world, hx, hz, CLEAR), `node ${node}: home (${hx.toFixed(0)}, ${hz.toFixed(0)}) is open sea (clear radius ${CLEAR})`);
      ok(Math.abs(b.y - (I.world.seaLevel - 0.3)) < 1e-4, `node ${node}: floats at the sea level`);
      let maxD = 0, wet = 0, shapes = new Set(), land = 0;
      for (let t = 0; t < 3000; t++) {
        tick(I, 1);
        const d = Math.hypot(b.x - hx, b.z - hz); if (d > maxD) maxD = d;
        if (isSea(I.world, b.x, b.z)) wet++; else land++;
        shapes.add(I.vars.get(VAR_BML2));
        ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z), `node ${node} tick ${t}: finite`) ;
      }
      ok(land === 0, `node ${node}: 3000 ticks, always over water (${land} dry ticks)`);
      ok(maxD < 50, `node ${node}: stays within ${maxD.toFixed(1)} of home`);
      ok(shapes.size >= 8, `node ${node}: shape counter cycles through every shape (${[...shapes]})`);
      ok(Math.abs(b.y - I.world.seaLevel) < 5, `node ${node}: height ${b.y.toFixed(2)} stays near the sea level`);
      // the siblings are untouched
      ok(I.rec('BML1').ctrl.nodes.length === 1 && I.rec('BML3').ctrl.nodes.length === 1 && I.rec('BML4').ctrl === null, `node ${node}: BML1 / BML3 / BML4 unchanged`);
      if (node === 2) notes.push(`BML2 home (${hx.toFixed(0)}, ${hz.toFixed(0)}), farthest ${maxD.toFixed(1)} in 3000 ticks, BML3 at (${bml3[0].toFixed(0)}, ${bml3[1].toFixed(0)}), BML1 at (${bml1[0].toFixed(0)}, ${bml1[1].toFixed(0)})`);
    }
    clear(); forceRestored(null);
    return { checked, failures, notes };
  },
};
