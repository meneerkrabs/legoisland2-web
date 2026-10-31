// WP16: era 2 of the island (story nodes 30..32, zone id 32) on the real island world (docs/re/m4/wp16-era2.md); browser bot tools/steps/m4-era2.mjs.
//  * the era-2 set-up: police station / skate park / garage / hospital hidden, the two pages shown, NICK on the police plot;
//  * the era-2 triggers: SKTP intro (slot 0, var 0x54 |= 2), the POLB StartCSM (gate node 0x1f, slot 3 = LGI08, S277 = 2), PORA (gate node 0x20,
//    S281 |= 2, var 5 = 10) with Pepper in the police helicopter.
import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';

const nodesOf = (I, name, kind) => I.rec(name)?.ctrl?.nodes.filter((n) => n.kind === kind) ?? [];

export default {
  name: 'm4-wp16-era2',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };

    // --- node 30: the police station and its props are hidden until the second page (LGIBR07); NICK / LICK stand on the plot after the constructor work
    {
      const I = loadIsland(ctx, { node: 30 });
      for (const n of ['POLB', 'JAIL', 'PCAR', 'PHEL', 'SKTP', 'GRGE', 'HOSP']) ok((I.rec(n).flags & 2) === 0, `node 30: ${n} hidden by the era-2 set-up`);
      ok((I.rec('PAG1').flags & 2) !== 0 && (I.rec('PAG2').flags & 2) !== 0, 'node 30: PAG1 / PAG2 shown');
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      ok(Math.abs(I.rec('NICK').y - 30.7) < 2, `NICK snapped onto the police plot: y ${I.rec('NICK').y}`);
    }
    // --- node 30: the era intro fires at once (SKTP, no waypoint, gate 0x54 & 2 == 0): slot 0, then var 0x54 |= 2
    {
      const I = loadIsland(ctx, { node: 30 });
      I.ictx.cutsceneTicks = 10;
      tick(I, 1);
      ok(I.ictx.cutscenes.length === 1 && I.ictx.cutscenes[0].slot === 0, `node 30 intro: ${JSON.stringify(I.ictx.cutscenes)}`);
      tick(I, 15);
      ok((I.vars.get(0x54) & 2) === 2, `node 30: var 0x54 = ${I.vars.get(0x54)}`);
      tick(I, 30);
      ok(I.ictx.cutscenes.length === 1, 'node 30: the intro fires once');
    }
    // --- node 31: the POLB trigger (5 PATH waypoints, radius 2) -> slot 3 (LGI08) -> S277 = 2
    {
      const I = loadIsland(ctx, { node: 31, vars: { 0x54: 2 } });
      I.ictx.cutsceneTicks = 10;
      tick(I, 2);
      const n = nodesOf(I, 'POLB', 'StartCSM')[0];
      ok(!!n, 'node 31: POLB has its StartCSM');
      // stand on the trigger's first waypoint
      const p = I.pepper, at = n ? nodeXYZ(n.a.map, n.a.waypoints[0]) : null;
      if (at) { p.x = at[0]; p.y = at[1]; p.z = at[2]; }
      tick(I, 3);
      ok(I.ictx.cutscenes.some((c) => c.slot === 3), `node 31: POLB -> slot 3 (${JSON.stringify(I.ictx.cutscenes)})`);
      tick(I, 15);
      ok(I.vars.get(0x115) === 2, `node 31: S277 = ${I.vars.get(0x115)}`);
    }
    // --- node 32: PORA with Pepper in PHEL -> S281 |= 2, var 5 = 10
    {
      const I = loadIsland(ctx, { node: 32, vars: { 0x54: 2, 0x115: 2 } });
      tick(I, 35);   // the portal counts 30 ticks of its own age first
      const phel = I.rec('PHEL'), pora = I.rec('PORA');
      const G = vehicles(I.world);
      G.current = phel; I.vars.set(0x5e, 8); I.vars.set(0x3e, 1);
      let fired = false;
      for (let k = 0; k < 90 && !fired; k++) {
        const d = 60 - k;   // approach from the west at the portal's height
        for (const r of [phel, I.pepper]) { r.x = pora.x - d; r.y = pora.y; r.z = pora.z; }
        tick(I, 1);
        fired = I.vars.get(5) === 10;
      }
      ok(fired && (I.vars.get(0x119) & 2) === 2, `node 32: PORA -> var 5 = ${I.vars.get(5)}, S281 = ${I.vars.get(0x119)}`);
    }
    return { checked, failures, notes };
  },
};

import { waypoints as WP } from '../../src/game/walker.ts';
function nodeXYZ(map, id) { const p = WP.nodePos(map, id); return p ? [...p] : null; }
