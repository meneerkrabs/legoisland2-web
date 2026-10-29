import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles, IslandPepSwitch } from '../../src/island/vehicles/index.ts';

// M4 WP6: the island's PepSwitc (FUN_004bb630 / FUN_004bb67d) beyond the vehicles: walking into the sea -> swimming (state 0x62), swimming to the shore ->
// walking (0x25, sound 0x128), the Ptera ride node stops Pepper's chain, the interact bit 0x1000 survives the mode changes, story node 30 starts the
// hologram's call timer. Run: node tools/test-formats.mjs --only m4-wp6-switch -v

export default {
  name: 'm4-wp6-switch',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    waypoints.load(ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi'));

    {
      const I = loadIsland(ctx, { node: 2 });
      const P = I.pepper, W = I.world;
      ok(P.ctrl.find('PepSwitc') instanceof IslandPepSwitch, 'PEPP has the island PepSwitc (ctor 0x4bbef8)');
      // into the sea from the jetty: find a heading with water ahead
      const e = waypoints.nodePos(1, 0x1b4);
      P.x = e[0]; P.y = e[1]; P.z = e[2];
      tick(I, 2);
      let heading = null;
      for (let a = 0; a < 32 && heading === null; a++) {
        const s = Math.sin(a * Math.PI / 16), c = Math.cos(a * Math.PI / 16);
        if (W.col.terrainHeight(P.x + s * 10, P.y, P.z + c * 10, 4) < W.seaLevel - 1) heading = a * Math.PI / 16;
      }
      ok(heading !== null, 'a heading towards deep water from the jetty node 0x1b4');
      W.vars.or(0x5e, 0x1000);
      P.ry = heading; P.rebuildYaw();
      let swimAt = -1;
      for (let i = 0; i < 150 && swimAt < 0; i++) {
        hold(I, ['ArrowUp'], 1);
        if ((W.vars.get(0x5e) & 0xfff) === 2) { swimAt = i; ok(W.pep.mailbox === 0x62 || P.anim.clip === 0x62, 'into the water: the dive state 0x62'); }
      }
      ok(swimAt > 0, `walking off the jetty: swimming at tick ${swimAt}`);
      // (the walk node steers by the camera; the swim node by Pepper's yaw: swim on the way he walked)
      const out = Math.atan2(P.x - e[0], P.z - e[2]);
      P.ry = out; P.rebuildYaw();
      hold(I, ['ArrowUp'], 60);
      ok((W.vars.get(0x5e) & 0xfff) === 2, `still swimming 60 ticks further out (${W.vars.get(0x5e).toString(16)})`);
      ok((W.vars.get(0x5e) & 0x1000) !== 0, 'the interact bit 0x1000 survives the switch');
      ok(Math.abs(P.y - W.seaLevel) < 1e-3, `swimming at the sea level (${P.y.toFixed(2)})`);
      // swim back
      P.ry = out + Math.PI; P.rebuildYaw();
      const s0 = I.ictx.sounds.length;
      let walkAt = -1;
      hold(I, ['ArrowUp'], 400, (i) => { if (walkAt < 0 && (W.vars.get(0x5e) & 0xfff) === 1) walkAt = i; });
      ok(walkAt > 0, `swimming to the shore: walking again at tick ${walkAt}`);
      ok(I.ictx.sounds.slice(s0).some((s) => s.id === 0x128), 'the out-of-the-water sound 0x128');
      ok(P.y > W.seaLevel, `out of the water above the sea level (${P.y.toFixed(2)})`);

      // the Ptera ride node: PEPPER_CONTROL 0x40 stops the chain, Pepper stays where the Ptera puts him
      W.vars.set(0x5e, 0x40);
      const p = [P.x, P.y, P.z];
      hold(I, ['ArrowUp'], 30);
      ok(P.x === p[0] && P.y === p[1] && P.z === p[2], 'PEPPER_CONTROL 0x40: Pepper\'s own nodes do not move him');
      ok(vehicles(W).current === null, 'no vehicle');
      W.vars.set(0x5e, 1);
      tick(I, 5);
      // Ctrl with a vehicle chosen beats the skateboard: the getting-in clip 0x4c
    }
    {
      const I = loadIsland(ctx, { node: 30 });
      const W = I.world;
      I.ictx.objective = { holoTimer: 0, target: () => null };
      tick(I, 2);
      ok(I.ictx.objective.holoTimer >= 88 && I.ictx.objective.holoTimer <= 90, `story node 30: the hologram call timer starts at 90 (FUN_0088d2bc, got ${I.ictx.objective.holoTimer})`);
      I.ictx.objective.holoTimer = -5;
      tick(I, 5);
      ok(I.ictx.objective.holoTimer <= -5, 'only once');
      ok((W.vars.get(0x5e) & 0xfff) === 1, 'walking');
    }
    return { checked, failures, notes };
  },
};
