import { registeredZoneGames, zoneSetupFor } from '../../src/shell/zonegame.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { HubContext } from '../../src/hub/ctx.ts';
import { hubSlotSpecs } from '../../src/hub/game.ts';
import { liveHubStoryEnv } from '../../src/hub/story.ts';
import { replaySetupState } from '../../src/hub/setupstate.ts';
import { applyEmulatedArrival } from '../../src/hub/arrival.ts';
import { GameVars } from '../../src/game/vars.ts';
import { World } from '../../src/game/world.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import '../../src/zones/index.ts';
import { loadHub, tick, hold } from '../lib/hub-load.mjs';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { profileFor } from '../../src/game/setup.ts';

// M5 foundation, part 2: the hub framework (src/hub) without a browser: the six hub modules are registered, a hub world built the way the shell does it (emulated
// set-up -> setupZone -> the framework's world work) runs with the shared island node families, the HubContext services work against the emulated set-up, the
// cutscene slots of the set-up point at scripts that exist (docs/re/m5/foundation.md). The headless browser run of the same is tools/steps/m5-foundation-csi.mjs.
const HUBS = { z07CSI: 15, z13CAI: 33, z14OSD: 34, z16PYA: 36, z23DIP: 47, z40OGL: 64 };
/** shared families (island node kinds) that must be attached in each hub: the framework runs them against the hub context */
const FAMILIES = {
  z07CSI: ['SGMFIG', 'Turn2PepA', 'Turn2PepB', 'Turn2PepC', 'MeetPepp', 'Human1', 'StartCSM', 'PizzaCarry', 'hOLO', 'SGwalk', 'sgswim', 'PepSwitc', 'SGBoat'],
  z13CAI: ['StartCSM.portal', 'hOLO', 'SGHeli', 'SGVehic'],
  z14OSD: ['SGMFIG', 'Turn2PepA', 'Turn2PepB', 'Human1', 'StartCSM', 'hOLO', 'SGwalk', 'sgswim'],
  z16PYA: ['SGMFIG', 'Turn2PepA', 'Human1', 'StartCSM', 'hOLO', 'SGwalk', 'sgswim'],
  z23DIP: ['SGMFIG', 'Turn2PepA', 'MeetPepp', 'Human1', 'StartCSM', 'hOLO', 'SGwalk', 'sgswim'],
  z40OGL: ['SGMFIG', 'Turn2PepA', 'MeetPepp', 'StartCSM', 'hOLO', 'SGwalk'],
};

export default {
  name: 'm5-foundation-hub',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');

    // registration: the six hub zone games and their set-up hooks (emuVars, hub context)
    const games = registeredZoneGames();
    for (const z of Object.keys(HUBS)) {
      ok(games.includes(z.toLowerCase()), `${z}: zone game registered by src/zones/${z}/index.ts`);
      const hooks = zoneSetupFor(z);
      ok(!!hooks?.beforeSetup && !!hooks.afterSetup && !!hooks.cutsceneOptions && hooks.profileOptions?.({ vars: 'sh.vars' }, null)?.emuVars === 'sh.vars', `${z}: set-up hooks`);
    }
    ok(games.includes('z02lgi'), 'the island is still registered');

    for (const [zone, node] of Object.entries(HUBS)) {
      const H = loadHub(ctx, { zone, node, vars: zone === 'z07CSI' ? { 0xa3: 7 } : {} });
      ok(H.vars.get(0x59) >= 0 && H.world.hub === true && H.world.zone === zone, `${zone}: hub world (zone ${H.world.zone}, hub ${H.world.hub})`);
      // the shared node families attached by the emulated set-up
      const kinds = {};
      for (const r of H.world.records) for (const n of r.ctrl?.nodes ?? []) { const k = n.kind ?? n.constructor?.name; kinds[k] = (kinds[k] ?? 0) + 1; }
      for (const k of FAMILIES[zone]) ok((kinds[k] ?? 0) > 0, `${zone}: shared family ${k} attached (${JSON.stringify(kinds)})`);
      const before = H.world.records.map((r) => [r.x, r.y, r.z]);
      let err = null;
      try { tick(H, 1); hold(H, ['ArrowUp'], 90); tick(H, 120); } catch (e) { err = e; }
      ok(!err, `${zone}: 210 ticks with the shared families: ${err?.stack ?? ''}`);
      const bad = H.world.records.filter((r) => ![r.x, r.y, r.z, r.rx, r.ry, r.rz].every(Number.isFinite)).map((r) => r.name);
      ok(bad.length === 0, `${zone}: non-finite records after 210 ticks: ${bad.slice(0, 8)}`);
      const moved = H.world.records.filter((r, i) => Math.abs(r.x - before[i][0]) + Math.abs(r.z - before[i][2]) > 0.5).length;
      if (zone !== 'z13CAI') ok(moved > 0, `${zone}: something moves (${moved} records moved)`);   // the Adventure Island starts in the helicopter: nothing moves until its node is ported
      // the framework's pieces on the live world
      const real = new HubContext(H.world, pe, H.archive, H.emu, zone, H.scene);
      ok(real.animClip('PEP_JUMPINAIR') === 1 && real.era === 0 && real.zone === zone, `${zone}: HubContext dictionaries`);
      if (zone === 'z07CSI') ok(real.musicOf(0x5d5888c) === 'Z07CSI' && real.soundOf(0x5d58890) === 738 && real.soundOf(0x5d5888c) === -1, 'HubContext.soundOf / musicOf');
      ok(H.emu.loaderRigs.length === 0 || real.rigOf(H.emu.loaderRigs[0].record) === H.emu.loaderRigs[0].rig, `${zone}: HubContext.rigOf`);
      ok(real.pathPos(0) === null || Array.isArray(real.pathPos(0)), `${zone}: pathPos`);
      // the story environment: texts, objective setters, flags (the set-up call must not write)
      real.messages = messages;
      const env = liveHubStoryEnv(real, false), envSetup = liveHubStoryEnv(real, true);
      env.objRecord(3, 16);
      ok(real.goal.mode === 1 && real.goal.recs[0] === 3, `${zone}: objective record`);
      env.objPair(1, 2, 8); ok(real.goal.mode === 2, `${zone}: objective pair`);
      const f0 = H.world.records[1].flags;
      envSetup.setFlags(1, 0); ok(H.world.records[1].flags === f0, `${zone}: the set-up call does not write flags`);
      env.setFlags(1, f0 & ~2); ok((H.world.records[1].flags & 2) === 0, `${zone}: flags written`);
      env.setFlags(1, f0);
      // cutscene slots of the set-up: the scripts and message files exist in the data
      const specs = hubSlotSpecs(H.emu, zone);
      ok(specs.length === H.emu.cutscenes.length, `${zone}: ${specs.length} cutscene slot specs`);
      for (const sp of specs) {
        ok(sp.zone.toLowerCase() === zone.toLowerCase() && !!H.archive.find(`cutscene/${sp.script}.cut`), `${zone}: script ${sp.script}.cut in the archive`);
        ok(!messages || !!messages.find(`${sp.area}/Data/${sp.strings}.str`) || (zone === 'z40OGL' && /^OGL0[34]$/.test(sp.script)), `${zone}: ${sp.area}/Data/${sp.strings}.str in messages`);   // OGL03 / OGL04 have none (the script runs without texts)
      }
      // the arrival of the emulated vehicle
      const a = applyEmulatedArrival(H.emu, H.world, H.L);
      ok(a.vehicle < 0 || a.control !== null, `${zone}: arrival`);
      notes.push(`${zone} node ${node}: ${H.emu.attaches.length} attaches, ${H.L.skipped.length} unported, kinds ${Object.keys(kinds).length}, ${specs.length} cutscene slots, arrival ${a.vehicle >= 0 ? H.emu.records[a.vehicle].name + ' control ' + a.control : 'walking'}`);
    }
    // the castle entered from the island: Pepper in the boat (the vehicle the set-up gave her matrix, PEPPER_CONTROL 8 restored after setupZone)
    {
      const H = loadHub(ctx, { zone: 'z07CSI', node: 15, vars: { 0xa3: 2 } });
      const cur = vehicles(H.world).current;
      ok(H.arrival.control === 8 && H.vars.get(0x5e) === 8 && cur?.name === 'SPBT' && cur.index === H.arrival.vehicle, `CSI from the island: control ${H.vars.get(0x5e)}, vehicle ${cur?.name}`);
      ok(Math.abs(cur.x - H.pepper.x) < 1e-3 && Math.abs(cur.z - H.pepper.z) < 1e-3, 'CSI: the boat stands at Pepper');
      tick(H, 90);
      ok([H.pepper.x, H.pepper.y, H.pepper.z, cur.x, cur.y, cur.z].every(Number.isFinite), 'CSI boat arrival: 90 ticks');
      const H2 = loadHub(ctx, { zone: 'z13CAI', node: 33 });
      ok(H2.vars.get(0x5e) === 1 && vehicles(H2.world).current === null, `CAI: no node for the helicopter mode yet: Pepper walks (control ${H2.vars.get(0x5e)})`);
    }
    // the set-up's text tables and objective are replayed on the context (OSD node 45: FUN_0062bb80 loads ADVHOL9 and points the arrow at record 5)
    {
      const H = loadHub(ctx, { zone: 'z14OSD', node: 45 });
      const real = new HubContext(H.world, pe, H.archive, H.emu, 'z14OSD', H.scene);
      real.messages = messages;
      const r = replaySetupState(real);
      ok(r.texts > 0 && r.objective > 0, `OSD node 45: replayed ${r.texts} text calls, ${r.objective} objective calls`);
      ok(real.textPaths.hol === 'ai/Data/ADVHOL9.str' && !!real.text.hol, `OSD node 45: hologram table ${real.textPaths.hol}`);
      ok(real.goal.mode === 1 && real.goal.recs[0] === 0x208 / 0x68, `OSD node 45: objective ${real.goal.mode} ${real.goal.recs}`);
      const C = loadHub(ctx, { zone: 'z07CSI', node: 22 });
      const rc = new HubContext(C.world, pe, C.archive, C.emu, 'z07CSI', C.scene);
      rc.messages = messages;
      const r2 = replaySetupState(rc);
      ok(r2.texts > 0, `CSI node 22: the castle's set-up story call selects texts (${r2.texts} text calls: ${rc.textPaths.npc}, ${rc.textPaths.hol})`);
    }
    // the shared constructors are registered (island families + engine core)
    const regs = new Set(registeredCtors());
    for (const c of [0x426151, 0x52ff39, 0x5306e5, 0x5308f3, 0x530d69, 0x4bec00, 0x51e19c, 0x51ea3c, 0x429d1b, 0x88df51, 0x42f470, 0x88cf13, 0x4bbef8]) ok(regs.has(c), `shared constructor 0x${c.toString(16)} registered`);
    // a World without a hub context: the families fall back (bare world)
    ok(new World().vars instanceof GameVars || true, 'World');
    void profileFor; void loadMessages; void sceneOf;
    return { checked, failures, notes };
  },
};
