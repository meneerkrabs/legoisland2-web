// WP4: StartCSM triggers (FUN_0051e19c / FUN_0051dd7e) and box portals (FUN_0051ea3c / FUN_0051e5ab) on the real island world (docs/re/m4/wp4-triggers.md).
import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { Controller } from '../../src/game/controller.ts';
import { portalRow, decodeStartCsm, SLOT_DONE, SLOT_FIRED } from '../../src/island/trigger/startcsm.ts';
import { ArgView } from '../../src/island/args.ts';

const put = (I, x, y, z) => { const p = I.pepper; p.x = x; p.y = y; p.z = z; };
const nodesOf = (I, name, kind) => I.rec(name)?.ctrl?.nodes.filter((n) => n.kind === kind) ?? [];

export default {
  name: 'm4-wp4-triggers',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };

    // --- argument decoding against the emulated blocks (node 5: PIZB, 7 PATH waypoints, radius 2, var 0x115 = 1, walk-to, slot 0x26)
    {
      const I = loadIsland(ctx, { node: 5 });
      const at = I.profile.island.attaches.find((a) => a.ctor === 0x51e19c && a.pos === 1 && I.scene.records[a.record].name === 'PIZB');
      const a = decodeStartCsm(ArgView.of(at));
      ok(a.waypoints.join(',') === [0x59, 0x5a, 0x192, 0x193, 0x194, 0x195, 0xb3].join(','), `PIZB waypoints ${a.waypoints}`);
      ok(a.map === 1 && a.radius === 2 && a.opVar === 0x115 && a.opValue === 1 && a.op === 1 && a.walkTo && a.slot === 0x26 && a.keyMask === 0, `PIZB block ${JSON.stringify(a)}`);
    }

    // --- node 2: PIZB's immediate trigger (no waypoint) plays slot 0 at once and SETs var 0x115 (S277) = 0x10 once the cutscene ended
    {
      const I = loadIsland(ctx, { node: 2 });
      I.ictx.cutsceneTicks = 20;
      tick(I, 1);
      ok(I.ictx.cutscenes.length === 1 && I.ictx.cutscenes[0].slot === 0, `node 2 intro: cutscenes ${JSON.stringify(I.ictx.cutscenes)}`);
      ok(I.vars.get(0x115) === 0, 'node 2: var 0x115 only after the cutscene');
      tick(I, 25);
      ok(I.vars.get(0x115) === 0x10, `node 2: var 0x115 = ${I.vars.get(0x115).toString(16)}`);
      const n = nodesOf(I, 'PIZB', 'StartCSM').find((x) => x.a.slot === 0);
      ok(n?.slot === SLOT_DONE, `node 2: PIZB trigger done (${n?.slot})`);
      tick(I, 30);
      ok(I.ictx.cutscenes.length === 1, 'node 2: the trigger fires once');
    }

    // --- node 4: PHSE (Pepper's house) waypoint trigger: nothing while far, slot 0x25 near PATH node 0xef, then var 0x12f = 1
    {
      const I = loadIsland(ctx, { node: 4 });
      tick(I, 10);
      ok(I.ictx.cutscenes.length === 0, `node 4: no cutscene while far (${JSON.stringify(I.ictx.cutscenes)})`);
      const wp = waypoints.nodePos(1, 0xef);
      put(I, wp[0] + 30, wp[1], wp[2]);   // outside the radius 3 * 8 = 24
      tick(I, 3);
      ok(I.ictx.cutscenes.length === 0, 'node 4: no cutscene at 30 units');
      put(I, wp[0] + 10, wp[1], wp[2]);
      tick(I, 2);
      ok(I.ictx.cutscenes.some((c) => c.slot === 0x25), `node 4: slot 0x25 near the house (${JSON.stringify(I.ictx.cutscenes)})`);
      tick(I, 2);
      ok(I.vars.get(0x12f) === 1, `node 4: var 0x12f = ${I.vars.get(0x12f)}`);
      ok((I.vars.get(0x5e) & 0x1000) === 0, 'node 4: PEPPER_CONTROL & 0x1000 cleared');
    }

    // --- not on foot: PEPPER_CONTROL without 1 / 0x10 -> the trigger arms and asks for 0x1000, fires once Pepper walks
    {
      const I = loadIsland(ctx, { node: 4 });
      const wp = waypoints.nodePos(1, 0xef);
      const n = nodesOf(I, 'PHSE', 'StartCSM')[0];
      put(I, wp[0], wp[1], wp[2]);
      I.vars.set(0x5e, 4);   // skateboard
      n.update(I.world, I.rec('PHSE'), I.rec('PHSE').ctrl);
      ok(n.armed && (I.vars.get(0x5e) & 0x1000) !== 0 && I.ictx.cutscenes.length === 0, `skateboard: armed + 0x1000 (pc ${I.vars.get(0x5e).toString(16)})`);
      I.vars.set(0x5e, 1 | 0x1000);
      n.update(I.world, I.rec('PHSE'), I.rec('PHSE').ctrl);
      ok(I.ictx.cutscenes.some((c) => c.slot === 0x25) && n.slot === SLOT_FIRED && I.vars.get(0x5e) === 1, `skateboard: fires on foot (pc ${I.vars.get(0x5e).toString(16)})`);
    }

    // --- node 5: PIZB waypoint trigger -> slot 0x26, var 0x115 = 1
    {
      const I = loadIsland(ctx, { node: 5 });
      tick(I, 3);
      ok(I.ictx.cutscenes.length === 0, 'node 5: nothing at the start');
      const wp = waypoints.nodePos(1, 0xb3);
      put(I, wp[0], wp[1], wp[2]);
      tick(I, 3);
      ok(I.ictx.cutscenes.some((c) => c.slot === 0x26) && I.vars.get(0x115) === 1, `node 5: ${JSON.stringify(I.ictx.cutscenes)} var 0x115 ${I.vars.get(0x115)}`);
    }

    // --- node 6: JAIL: slot 0x27 sets BRICKSTER_ESCAPED (0x51) = 2, which opens the second trigger (gate 0x51 == 2): slot 0x28, op 0x40 (+1000 to 0xa6 / 0x12, -1 to 0xb0) and 0x51 = 1
    {
      const I = loadIsland(ctx, { node: 6 });
      I.ictx.cutsceneTicks = 10;
      const a6 = I.vars.get(0xa6), b0 = I.vars.get(0xb0);
      const wp = waypoints.nodePos(1, 0x9a);
      put(I, wp[0], wp[1], wp[2]);
      tick(I, 2);
      ok(I.ictx.cutscenes.map((c) => c.slot).join() === '39', `node 6 first: ${JSON.stringify(I.ictx.cutscenes)}`);
      tick(I, 12);
      ok(I.vars.get(0x51) === 2 || I.ictx.cutscenes.length === 2, 'node 6: var 0x51 = 2 after the first cutscene');
      tick(I, 14);
      ok(I.ictx.cutscenes.map((c) => c.slot).join() === '39,40', `node 6 second: ${JSON.stringify(I.ictx.cutscenes)}`);
      ok(I.vars.get(0x51) === 1 && I.vars.get(0xa6) === a6 + 1000 && I.vars.get(0xb0) === b0 - 1, `node 6 op 0x40: 0x51 ${I.vars.get(0x51)} a6 ${I.vars.get(0xa6)} b0 ${I.vars.get(0xb0)}`);
    }

    // --- node 7 / 11: INFC's immediate triggers (slot 5 at node 0xb, var 0x115 = 0x100)
    {
      const I = loadIsland(ctx, { node: 11 });
      tick(I, 2);
      ok(I.ictx.cutscenes.some((c) => c.slot === 5) && I.vars.get(0x115) === 0x100, `node 11: INFC ${JSON.stringify(I.ictx.cutscenes)} var ${I.vars.get(0x115).toString(16)}`);
    }

    // --- node 30: the sea portal PORS (row 0 of the portal table: SPBT / JSKI / DNGY, target zone 6) and the sky portal PORA (row 1, zone 10, ORs var 0x119 |= 2)
    {
      const I = loadIsland(ctx, { node: 30 });
      const row = portalRow(I.world, 0);
      ok(row.map((r) => r?.name).join() === 'SPBT,JSKI,DNGY', `portal row 0: ${row.map((r) => r?.name)}`);
      ok(portalRow(I.world, 1)[0]?.name === 'PHEL', 'portal row 1 starts with PHEL');
      const pors = I.rec('PORS'), boat = I.rec('JSKI');
      // the vehicles' own nodes are WP6's: a bare enabled controller is enough for the distance the portal reads
      if (!boat.ctrl) { boat.ctrl = new Controller(); }
      tick(I, 35);   // the portal ignores everything for its first 30 ticks
      ok(I.vars.get(5) === 32, `node 30: var 5 untouched (${I.vars.get(5)})`);
      // Pepper (the focus) rides the jet ski towards the portal: both records move together
      for (let d = 60; d >= 0; d -= 4) {
        put(I, pors.x + d, pors.y, pors.z); boat.x = pors.x + d; boat.y = pors.y; boat.z = pors.z;
        tick(I, 1);
      }
      ok(I.vars.get(5) === 6 && I.vars.get(0xbb) === 1, `node 30: PORS -> var 5 = ${I.vars.get(5)}, PORTAL_VEHICLE = ${I.vars.get(0xbb)}`);
    }
    {
      const I = loadIsland(ctx, { node: 32 });
      const pora = I.rec('PORA'), heli = I.rec('PHEL');
      if (!heli.ctrl) heli.ctrl = new Controller();
      heli.show();
      tick(I, 35);
      for (let d = 60; d >= 0; d -= 4) { put(I, pora.x, pora.y, pora.z + d); heli.x = pora.x; heli.y = pora.y; heli.z = pora.z + d; tick(I, 1); }
      ok(I.vars.get(5) === 10 && I.vars.get(0xbb) === 0 && (I.vars.get(0x119) & 2) === 2, `node 32: PORA -> var 5 ${I.vars.get(5)} vehicle ${I.vars.get(0xbb)} var 0x119 ${I.vars.get(0x119)}`);
      put(I, pora.x + 500, pora.y, pora.z); heli.x = pora.x + 500;
      tick(I, 2);
      ok((I.vars.get(0x119) & 2) === 0, 'node 32: out of range clears var 0x119 & 2');
      // the portal spins (+0x31) and faces the camera (+0x30)
      ok(Math.abs(pora.rx) > 0, 'PORA spins about x');
    }

    // --- era 4 (node 61): the wormhole WORM (gate var 0xd & 1, Pepper himself, zone 0x22) only when var 0xd is set
    {
      const I = loadIsland(ctx, { node: 61 });
      const worm = I.rec('WORM');
      tick(I, 35);
      for (let d = 60; d >= 0; d -= 4) { put(I, worm.x + d, worm.y, worm.z); tick(I, 1); }
      ok(I.vars.get(5) !== 0x22, 'node 61: WORM closed while var 0xd = 0');
      // the script writes var 0xd = 1; LGI_FSM (era 4) scales record 370 (WORM) in over 30 ticks (0xd = 2) and then writes 0xd = 5 (& 1: the portal's gate opens)
      I.vars.set(0xd, 1);
      put(I, worm.x + 200, worm.y, worm.z); tick(I, 2);
      ok(I.vars.get(0xd) === 2 && I.world.records[370].enabled, `node 61: wormhole scales in (var 0xd ${I.vars.get(0xd)})`);
      tick(I, 35);
      ok(I.vars.get(0xd) === 5, `node 61: var 0xd = ${I.vars.get(0xd)} after the scale-in`);
      tick(I, 35);   // the portal's age (node +0x40) only counts while its gate is open
      for (let d = 60; d >= 0; d -= 4) { put(I, worm.x + d, worm.y, worm.z); tick(I, 1); }
      ok(I.vars.get(5) === 0x22, `node 61: WORM -> var 5 = ${I.vars.get(5)}`);
    }
    // --- every era: the WP4 constructors are all registered (no WP4 attach skipped) and an idle minute runs without errors
    {
      const WP4 = new Set([0x51e19c, 0x51ea3c, 0x535e80, 0x5364a5, 0x535281, 0x5357cb, 0x4b8c73, 0x88df51]);
      const counts = [];
      for (const node of [3, 7, 20, 30, 40, 52, 57, 61, 70]) {
        let I;
        try { I = loadIsland(ctx, { node }); tick(I, 60); } catch (e) { ok(false, `node ${node}: ${e.stack || e}`); continue; }
        const skipped = I.L.skipped.filter((k) => WP4.has(k.ctor));
        ok(skipped.length === 0, `node ${node}: WP4 attaches skipped ${JSON.stringify(skipped)}`);
        const n = I.profile.island.attaches.filter((a) => WP4.has(a.ctor)).length;
        counts.push(`${node}:${n}/${I.ictx.cutscenes.map((c) => c.slot).join('+') || '-'}`);
      }
      notes.push(`WP4 attaches / cutscenes started in the first 60 ticks per node: ${counts.join(' ')}`);
    }
    notes.push('triggers: PIZB / PHSE / JAIL / INFC slots + var effects, portals PORS / PORA / WORM -> var 5');
    return { checked, failures, notes };
  },
};
