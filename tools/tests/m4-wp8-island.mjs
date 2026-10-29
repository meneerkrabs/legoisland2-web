// M4 WP8: the island zone game's pieces in node. (a) The arrival place FUN_004c2d22 (src/zones/z02LGI/arrival.ts) against the original run in the x86
// emulation for every PREV_SUBGAME case (walking cases: same position and yaw; vehicle cases: same yaw, vehicle record and PEPPER_CONTROL, the position
// = the emulated one too since FUN_0043cec0 runs natively in the emulation, WP10) and against the hand-written M1 start (PROFILE_LGI).
// (b) The story handler on the live island world (liveStoryEnv): the "just advanced" actions of nodes 4 / 9 / 0x36, record visibility, the message
// tables it loads, the objective target. (c) The objective resolution modes (FUN_00424e37).
import { emulateIslandSetup } from '../../src/formats/emusetup.ts';
import { PROFILE_LGI } from '../../src/game/setup.ts';
import { arrival, arrivalRule, emulatedVehicle, VEHICLE_ARRIVAL_DIST } from '../../src/zones/z02LGI/arrival.ts';
import { storyHandler } from '../../src/zones/z02LGI/story.ts';
import { IslandContext } from '../../src/zones/z02LGI/ctx.ts';
import { liveStoryEnv, pathPositions } from '../../src/zones/z02LGI/index.ts';
import { Objective, OBJ } from '../../src/zones/z02LGI/objective.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { loadIsland } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';

export default {
  name: 'm4-wp8-island',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const eq = (msg, a, b) => { checked++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) failures.push(`${msg}: ${x} != ${y}`); };
    const near = (a, b, e = 1e-4) => a.every((v, i) => Math.abs(v - b[i]) <= e);
    const pe = loadExe(ctx.dataRoot);
    const scene = sceneOf(ctx, 'z02LGI');
    const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const path = pathPositions(archive);

    // ---- (a) arrival
    const CASES = [[0, 2], [3, 2], [4, 2], [5, 2], [6, 2], [10, 30], [13, 30], [0x13, 52], [0x18, 52], [0x18, 61], [0x19, 52], [0x19, 61], [12, 7]];
    for (const [prev, node] of CASES) {
      const m = new Map([[0x58, node], [2, 1], [0x4f, 11], [0xb0, 11], [0xa3, prev]]);
      const s = emulateIslandSetup(pe, scene, { vars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive });
      const veh = emulatedVehicle(s);
      const a = arrival(prev, node, (i) => s.records[i].pos, path, veh);
      const p = s.records[16];
      const tag = `arrival from ${prev} at node ${node}`;
      ok(!!a, `${tag}: no place`);
      if (!a) continue;
      ok(Math.abs(a.yaw - p.euler[1]) < 1e-5, `${tag}: yaw ${a.yaw} != emulated ${p.euler[1]}`);
      eq(`${tag}: PEPPER_CONTROL`, a.control, m.get(0x5e));
      if (arrivalRule(prev, node).node >= 0) {
        ok(near(a.pos, p.pos, 1e-3), `${tag}: pos ${a.pos} != emulated ${p.pos}`);
        eq(`${tag}: walking`, a.vehicle, -1);
      } else {
        eq(`${tag}: vehicle record`, a.vehicle, veh);
        const b = s.records[arrivalRule(prev, node).base].pos;
        ok(Math.abs(Math.hypot(a.pos[0] - b[0], a.pos[1] - b[1], a.pos[2] - b[2]) - VEHICLE_ARRIVAL_DIST) < 1e-3, `${tag}: not ${VEHICLE_ARRIVAL_DIST} from the harbour`);
        // WP10: FUN_0043cec0 runs natively in the emulation now, so the emulated Pepper is placed by the original code too
        ok(near(a.pos, p.pos, 1e-3), `${tag}: vehicle place ${a.pos} != emulated ${p.pos}`);
        notes.push(`${tag}: vehicle record ${veh} (${scene.records[veh]?.name}), PEPPER_CONTROL 0x${a.control.toString(16)}, place ${a.pos.map((v) => v.toFixed(1))}`);
      }
    }
    // the M1 hand-written start agrees for the skate park and the house door
    for (const from of ['', 'z03PPH']) {
      const hand = PROFILE_LGI.start(archive, scene.records.map((r) => ({ name: r.name, x: r.matrix[12], y: r.matrix[13], z: r.matrix[14] })), from);
      const a = arrival(from ? 3 : 0, 2, (i) => [scene.records[i].matrix[12], scene.records[i].matrix[13], scene.records[i].matrix[14]], path);
      ok(near(hand.pos, a.pos) && Math.abs(hand.yaw - a.yaw) < 1e-5, `arrival '${from}': port ${a.pos} / ${a.yaw} != PROFILE_LGI ${hand.pos} / ${hand.yaw}`);
    }

    // ---- (b) the handler on the live world
    const live = (node) => {
      const I = loadIsland(ctx, { node });
      const ictx = new IslandContext(I.world, pe, archive, I.profile.island);
      ictx.messages = messages; ictx.pathPos = path;
      return { I, ictx, env: liveStoryEnv(ictx) };
    };
    {
      const { I, ictx, env } = live(3);
      I.vars.set(0x58, 4); I.vars.set(0x50, 0);
      const ref = { prev: 3, next: -10 };
      eq('node 4: stays', storyHandler(env, ref, 4), 1);
      eq('node 4 just advanced: PEPPHOUSE_SIZE 100, BLDG_PHSE |= 9, hologram alert', [I.vars.get(0xb3), I.vars.get(0x50) & 9, ictx.goal.holoTimer], [100, 9, 90]);
      eq('node 4: objective = PHSE (125)', [ictx.goal.mode, ictx.goal.recs[0]], [OBJ.RECORD, 125]);
      eq('node 4: message tables', [ictx.textPaths.npc, ictx.textPaths.hol, !!ictx.text.npc, !!ictx.text.hol], ['li/Data/lifsm2.str', 'li/Data/lihol2.str', true, true]);
      const t = ictx.objective.target(I.pepper);
      const phse = I.world.records[125];
      ok(t && near(t.pos, [phse.x, phse.y, phse.z]), 'node 4: target = PHSE position');
      eq('node 4: prev', ref.prev, 4);
      // the next frame with the same node does nothing (the loop compares var 0x58 with prev); node 5 from 4: no alert
      ictx.goal.holoTimer = 0;
      storyHandler(env, ref, 5);
      eq('node 5: no one-shot, objective PIZB (123)', [ictx.goal.holoTimer, ictx.goal.recs[0], ictx.textPaths.npc], [0, 123, 'li/Data/lifsm3.str']);
      const npc = ictx.text.npc;
      ok(!!npc && npc.entries?.length !== 0, 'node 5: lifsm3 loaded');
    }
    {
      const { I, env } = live(8);
      const r11 = I.world.records[11];
      r11.show();
      storyHandler(env, { prev: 8, next: -10 }, 9);
      eq('node 9: record 11 hidden, MOVE_INFO = 0x4000', [r11.enabled, I.vars.get(0x62)], [false, 0x4000]);
      storyHandler(env, { prev: 9, next: -10 }, 10);
      eq('node 10: MOVE_INFO & ~0x4000', I.vars.get(0x62) & 0x4000, 0);
    }
    {
      const { I, ictx, env } = live(53);
      // the zone game's afterSetup: the set-up's waypoint maps and the NPCs' walkers (WP3)
      loadIslandWalkMaps(archive, I.profile.island);
      startIslandNpcs(I.world);
      for (let k = 0; k < 30; k++) I.world.tick();
      const pins = [17, 18, 19, 20, 21, 22, 25, 24, 23, 26];
      const withWalker = pins.filter((r) => I.world.records[r]?.ctrl?.walker);
      const r112 = I.world.records[112];
      r112.hide();
      storyHandler(env, { prev: 0x35, next: -10 }, 0x36);
      eq('node 0x36: record 112 shown, 13 / 12 / 32 hidden', [r112.enabled, I.world.records[13].enabled, I.world.records[12].enabled, I.world.records[32].enabled], [true, false, false, false]);
      eq('node 0x36: objective = the four PAG records', [ictx.goal.mode, ictx.goal.recs], [OBJ.NEAREST4, [69, 70, 71, 72]]);
      notes.push(`node 0x36: ${withWalker.length} of the 10 re-pinned records have a walker (WP3 creates them)`);
      for (const r of withWalker) {
        const n = { 17: 0x171, 18: 0x185, 19: 0x171, 20: 0xe5, 21: 0x2f, 22: 0x77, 25: 0x9f, 24: 0x2c, 23: 0x71, 26: 0x133 }[r];
        const rec = I.world.records[r], p = path(n);
        ok(near([rec.x, rec.y, rec.z], p, 1e-3), `node 0x36: record ${r} on PATH node ${n}`);
      }
    }

    // ---- (c) objective resolution
    {
      const { I } = live(52);
      const o = new Objective();
      const recs = I.world.records;
      o.four(69, 70, 71, 72);
      for (const i of [69, 70, 71, 72]) { recs[i].show(); if (recs[i].ctrl) recs[i].ctrl.distSq = 1000 + i; }
      const have = [69, 70, 71, 72].filter((i) => recs[i].ctrl);
      const t4 = o.target(recs, null, 1, path);
      eq('mode 4: the nearest visible record with a controller', t4?.record ?? -1, have.length ? have[0] : -1);
      if (have.length) { recs[have[0]].hide(); eq('mode 4: hidden ones are skipped', o.target(recs, null, 1, path)?.record ?? -1, have[1] ?? -1); }
      o.pair(161, 165, 8);
      eq('mode 2: the second record', o.target(recs, null, 1, path)?.record, 165);
      eq('mode 2 with Pepper in a vehicle and a delivery list: the first record', o.target(recs, null, 8, path, { kind: -2, docks: [], pads: [], nodePos: () => null })?.record, 161);
      // the vehicle branch of FUN_00424e37 (S4): the nearest FREE berth by XZ distance to `from`, then PATH node number = the berth's INDEX (the original's slip)
      {
        const pos = new Map([[1, new Map()]]);
        const berths = (xs, base) => xs.map(([x, z, taken], k) => ({ map: 1, node: base + k, taken }));
        const nodeAt = (list, xs) => xs.forEach(([x, z], k) => pos.get(1).set(list[k].node, [x, 0, z]));
        const docks = berths([[0, 100, false], [50, 0, false], [10, 10, true], [90, 90, false]], 100), pads = berths([[500, 500, false], [20, 5, false], [3, 3, true]], 200);
        nodeAt(docks, [[0, 100], [50, 0], [10, 10], [90, 90]]); nodeAt(pads, [[500, 500], [20, 5], [3, 3]]);
        const veh = (kind) => ({ kind, docks, pads, nodePos: (m, n) => pos.get(m)?.get(n) ?? null });
        const from = { x: 0, y: 0, z: 0 };
        const P = (n) => [n * 10, n, n * 100];
        o.pathNode(0x1a5, 16);
        let t = o.target(recs, from, 8, P, veh(-2));
        ok(t && near(t.pos, P(1)) && t.record === -1, `boat (-2): the nearest free dock is index 1 (50, 0), its target is PATH node 1 = (${t?.pos})`);
        t = o.target(recs, from, 8, P, veh(-3));
        ok(t && near(t.pos, P(1)), `helicopter (-3): the nearest free pad is index 1 (20, 5), target PATH node 1 (${t?.pos})`);
        docks[1].taken = true; pads[1].taken = true;
        t = o.target(recs, from, 8, P, veh(-2));
        ok(t && near(t.pos, P(0)), `dock 1 taken: index 0 (0, 100) is next, PATH node 0 (${t?.pos})`);
        for (const d of docks) d.taken = true;
        t = o.target(recs, from, 8, P, veh(-2));
        ok(t && near(t.pos, [0, 0, 0]), `no free dock: index -1, FUN_00462be9 reads before the array: the origin (${t?.pos})`);
        t = o.target(recs, from, 8, P, veh(-4));
        ok(t && near(t.pos, [0, 0, 0]), 'kind -4 (pizza / Ptera code): neither loop runs, index -1');
        t = o.target(recs, from, 8, P, veh(-1));
        ok(near(t.pos, P(0x1a5)), 'kind -1 (car): the plain branch, mode 3');
      }
      o.pathNode(0x1a5, 16);
      ok(near(o.target(recs, null, 1, path).pos, path(0x1a5)), 'mode 3: the PATH node');
      o.record(-1, 16);
      eq('mode 0 after FUN_00424270(0): nearest talk NPC (none without the SGMFIG port flags)', o.mode, OBJ.NONE);
    }
    return { checked, failures, notes };
  },
};
