import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes, SupeNode, SUPE, ST, SND_SUPE, TrainNode } from '../../src/island/pizza/index.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { waypoints } from '../../src/game/walker.ts';

// WP14: SUPE (SupaStat.c FUN_0053c337 / FUN_0053adc3) on the real island: registered in every era, patrols the OTH sky map, lands at the station
// at Pepper's end of the island and takes off when she leaves, and rescues Pepper from the railway: swoop, pick-up, lift over the nearest track
// node, (the east line first), the flight to the nearest helipad exit node, the drop, the climb back; Pepper's place, PEPPER_CONTROL, the camera,
// the sounds, the no-talk bit, no NaN.
export default {
  name: 'm4-wp14-supe',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (n) => '0x' + (n >>> 0).toString(16);
    const f1 = (v) => v.toFixed(1);
    const start = (node) => {
      const I = loadIsland(ctx, { node });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      return I;
    };
    const supeOf = (I) => I.rec('SUPE')?.ctrl?.nodes.find((n) => n instanceof SupeNode);
    const finite = (...vs) => vs.every((v) => Number.isFinite(v));
    const place = (I, x, z, y) => {
      const P = I.pepper;
      const g = y ?? I.world.col.terrainHeight(x, 300, z, 0);
      P.x = x; P.y = g; P.z = z; P.rebuildYaw();
    };

    // ============================================================ 1. registered in every era, gate MOVE_SUPE & 0 == 0, after the SGMFIG node
    for (const node of [2, 7, 30, 52, 61]) {
      const I = start(node);
      const S = I.rec('SUPE');
      const i = S?.ctrl?.nodes.findIndex((n) => n instanceof SupeNode) ?? -1;
      const n = i >= 0 ? S.ctrl.nodes[i] : null;
      ok(n && i === 1 && n.var === 0xa8 && n.mask === 0 && S.ctrl.nodes[0].kind !== 'supe', `node ${node}: SUPE node at pos 1 (index ${i}, var ${hex(n?.var ?? 0)})`);
    }

    // ============================================================ 2. constructor and the patrol (Pepper in the middle of the island)
    {
      const I = start(2);
      const w = I.world, S = I.rec('SUPE'), n = supeOf(I);
      tick(I, 1);
      ok(Math.abs(n.zoneA - 15.35) < 0.2 && Math.abs(n.zoneB + 336.95) < 0.2, `zones from OTH 0 / 0x39: south z > ${f1(n.zoneA)}, north z < ${f1(n.zoneB)}`);
      ok(n.state === ST.FLY && n.mode === 0 && n.dest >= 0 && n.dest <= 4, `Pepper in the middle (z ${f1(I.pepper.z)}): flying from the hub to a random node 0..4 (state ${n.state}, dest ${n.dest})`);
      ok(Math.hypot(S.x + 55.8, S.z + 186.8) < 5, `starts at the hub CTR (${f1(S.x)}, ${f1(S.y)}, ${f1(S.z)})`);
      let path = 0, prev = [S.x, S.y, S.z], bad = 0;
      const goals = new Set();
      for (let i = 0; i < 1500; i++) {
        tick(I, 1);
        path += Math.hypot(S.x - prev[0], S.y - prev[1], S.z - prev[2]); prev = [S.x, S.y, S.z];
        if (!finite(S.x, S.y, S.z, S.rx, S.ry, S.rz) || [...S.m].some((v) => !Number.isFinite(v))) bad++;
        goals.add(n.goal);
      }
      notes.push(`patrol: ${path.toFixed(0)} units in 1500 ticks over OTH nodes ${[...goals].sort((a, b) => a - b).join(',')}, speed ${n.speed.toFixed(2)}`);
      ok(bad === 0, `no NaN in the patrol (${bad})`);
      ok(path > 1500 && goals.size >= 4, `patrols the OTH map (${path.toFixed(0)} units, ${goals.size} goals)`);
      ok(n.state < 5 && (w.vars.get(0xa8) & SUPE.NO_TALK) === 0, 'not carrying: no no-talk bit');
    }

    // ============================================================ 3. lands at the south station, stands, takes off when Pepper leaves
    {
      const I = start(2);
      const w = I.world, S = I.rec('SUPE'), n = supeOf(I);
      tick(I, 1);
      place(I, 170, 120);
      tick(I, 2);
      ok(w.pep.surfaceAtFeet !== SUPE.SURF_RAIL, `Pepper on ordinary ground in the south (surface ${w.pep.surfaceAtFeet})`);
      let landedAt = -1;
      for (let i = 0; i < 4000 && landedAt < 0; i++) { tick(I, 1); if (n.state === ST.STAND) landedAt = i; }
      const st = waypoints.nodePos(3, SUPE.STAT1_IN);
      const g = w.col.terrainHeight(S.x, S.y + 8, S.z, 0);
      notes.push(`landed at tick ${landedAt} at (${f1(S.x)}, ${f1(S.y)}, ${f1(S.z)}), ground ${f1(g)}, mode ${n.mode}, dest ${n.dest}`);
      ok(landedAt > 0 && n.dest === SUPE.STAT1_IN && Math.hypot(S.x - st[0], S.z - st[2]) < 4, `lands at STAT1_IN (${f1(Math.hypot(S.x - st[0], S.z - st[2]))} from it, tick ${landedAt})`);
      ok(landedAt > 0 && S.y - g < 1.2 && S.y - g > -0.5, `standing on the ground (y ${f1(S.y)}, below ${f1(g)})`);
      tick(I, 60);
      ok(n.state === ST.STAND && S.anim?.clip !== SUPE.CLIP_GRAB && S.anim?.clip !== SUPE.CLIP_FLY && n.goal === SUPE.STAT1_OUT, `stands (state ${n.state}, clip ${hex(S.anim?.clip ?? -1)}: idle / Turn2Pep's wave as the node returns 0), takeoff goal STAT1_OUT (${n.goal})`);
      place(I, 153.8, -62.5);
      tick(I, 3);
      ok(n.state === ST.FLY && n.dest === SUPE.HUB && n.mode === 0, `Pepper back in the middle: takes off for the hub (state ${n.state}, dest ${n.dest})`);
      const s0 = [S.x, S.y, S.z]; tick(I, 60);
      const gone = Math.hypot(S.x - s0[0], S.y - s0[1], S.z - s0[2]);
      ok(gone > 30, `flies off (${f1(gone)} in 60 ticks)`);
    }

    // ============================================================ 4. the rescue: Pepper on the rail at track node 105 (south, not the east line)
    const rescue = (node, road, label, extra) => {
      const I = start(node);
      const w = I.world, S = I.rec('SUPE'), P = I.pepper, n = supeOf(I);
      tick(I, 200);
      const p = waypoints.nodePos(0, road);
      place(I, p[0], p[2], p[1] + 1);
      I.ictx.sounds.length = 0; I.ictx.stopped.length = 0;
      const seq = [];
      let carryMax = 0, bad = 0, noTalk = true, pcCarry = true, camOk = true, liftT = -1, dropT = -1, maxY = -1e9;
      const camD = [];
      for (let i = 0; i < 4000; i++) {
        tick(I, 1);
        if (seq[seq.length - 1] !== n.state) seq.push(n.state);
        if (!finite(S.x, S.y, S.z, P.x, P.y, P.z, ...w.camera.c) || [...S.m, ...P.m].some((v) => !Number.isFinite(v))) bad++;
        if (n.state >= ST.TRACK && n.state <= ST.PAD) {
          carryMax = Math.max(carryMax, Math.abs(Math.hypot(P.x - S.x, P.y - S.y, P.z - S.z) - Math.SQRT2));
          if (w.vars.get(0x5e) !== SUPE.PC_CARRIED) pcCarry = false;
          const c = w.camera.c;
          if (Math.abs(c[3] - S.x) > 1e-3 || Math.abs(c[4] - S.y - 4) > 1e-3 || Math.abs(c[5] - S.z) > 1e-3) camOk = false;
          camD.push(Math.hypot(c[0] - S.x, c[1] - S.y, c[2] - S.z));
          maxY = Math.max(maxY, S.y);
        }
        if (n.state > 4 && n.state < ST.RISE && (w.vars.get(0xa8) & SUPE.NO_TALK) === 0 && i > 0) noTalk = false;
        if (liftT < 0 && n.state === ST.LIFT) liftT = i;
        if (dropT < 0 && n.state === ST.RISE) dropT = i;
        if (n.state === ST.FLY_FREE && dropT >= 0) break;
      }
      notes.push(`${label}: states ${seq.map((s) => s.toString(16)).join(' > ')}, pick-up at ${liftT}, drop at ${dropT}, highest ${f1(maxY)}, Pepper at (${f1(P.x)}, ${f1(P.y)}, ${f1(P.z)}) pad ${n.pad}`);
      ok(bad === 0, `${label}: no NaN (${bad})`);
      ok(seq[0] === ST.SWOOP || seq.includes(ST.SWOOP), `${label}: Pepper on the rail calls him (states ${seq.join(',')})`);
      ok(liftT > 0 && dropT > liftT, `${label}: picked up and put down (${liftT}, ${dropT})`);
      for (const s of extra.states) ok(seq.includes(s), `${label}: state ${hex(s)} passed`);
      ok(carryMax < 0.01, `${label}: Pepper hangs 1 below and 1 beside him all the way (error ${carryMax.toFixed(4)})`);
      ok(pcCarry, `${label}: PEPPER_CONTROL 0x80 while carried`);
      ok(camOk, `${label}: the camera looks at him + 4 while carrying`);
      ok(camD.length > 0 && camD[camD.length - 1] < 60, `${label}: the camera eye follows (last distance ${f1(camD[camD.length - 1] ?? -1)})`);
      ok(maxY > p[1] + 40, `${label}: flies high over the island (${f1(maxY)})`);
      ok(noTalk, `${label}: MOVE_SUPE has the no-talk bit 0x20000 while swooping / carrying`);
      const pad = waypoints.nodePos(1, n.pad);
      const g = w.col.terrainHeight(P.x, P.y + 4, P.z, 0);
      ok(Math.hypot(P.x - pad[0], P.z - pad[2]) < 4, `${label}: put down at the helipad exit node ${n.pad} (${f1(Math.hypot(P.x - pad[0], P.z - pad[2]))} away)`);
      ok(Math.abs(P.y - g) < 0.5, `${label}: Pepper on the ground (y ${f1(P.y)}, ground ${f1(g)})`);
      ok(w.vars.get(0x5e) === SUPE.PC_WALK && P.anim?.clip !== SUPE.CLIP_GRAB, `${label}: walking again (PEPPER_CONTROL ${hex(w.vars.get(0x5e))}, clip ${hex(P.anim?.clip ?? -1)})`);
      ok(Math.abs(P.rx) < 1e-6 && Math.abs(P.m[1]) < 1e-5 && Math.abs(P.m[5] - 1) < 1e-5, `${label}: Pepper upright`);
      const ids = I.ictx.sounds.map((s) => s.id);
      ok(ids.includes(SND_SUPE.UP) && ids.includes(SND_SUPE.FLY) && ids.includes(SND_SUPE.DOWN) && I.ictx.stopped.includes(SND_SUPE.FLY), `${label}: sounds Pep_Up + Thrust at the pick-up, Pep_Down at the drop, Thrust stopped`);
      ok(!I.world.records[9].enabled, `${label}: the skateboard record 9 hidden at the drop`);
      ok(vehicles(w).current === null, `${label}: no vehicle chosen`);
      // he climbs back to free flight and is solid again
      ok(n.state === ST.FLY_FREE && n.goal === SUPE.HUB && (S.flags & 0x10) === 0, `${label}: back to free flight towards the hub (state ${n.state}, flags ${hex(S.flags)})`);
      // Pepper walks again
      const z0 = P.z, x0 = P.x;
      w.input.setKey('ArrowUp', true); tick(I, 30); w.input.setKey('ArrowUp', false);
      ok(Math.hypot(P.x - x0, P.z - z0) > 3, `${label}: Pepper walks off afterwards (${f1(Math.hypot(P.x - x0, P.z - z0))})`);
      return { I, n };
    };
    rescue(2, 105, 'rail 105 (era 0)', { states: [ST.SWOOP, ST.LIFT, ST.PAD_HIGH, ST.PAD_LOW, ST.PAD, ST.DROP, ST.RISE] });
    {
      const { n } = rescue(2, 103, 'east line 103', { states: [ST.EAST_TURN, ST.EAST_ALIGN, ST.TRACK, ST.PAD_HIGH, ST.DROP] });
      ok(n.east === 1 && n.road === SUPE.EAST_B, `east line: flies to the other end, ROAD 0x60 (${hex(n.road)})`);
    }
    rescue(7, 97, 'rail 97 (era 1, no train)', { states: [ST.SWOOP, ST.LIFT, ST.PAD_HIGH, ST.DROP] });

    // ============================================================ 5. the trigger rules
    {
      const I = start(2);
      const w = I.world, n = supeOf(I);
      tick(I, 50);
      const p = waypoints.nodePos(0, 105);
      // two ticks on the rail are not enough
      place(I, p[0], p[2], p[1] + 1); tick(I, 2);
      ok(n.state < 5 && n.timer >= 1 && n.timer < 3, `2 ticks on the rail: not yet (state ${n.state}, timer ${n.timer})`);
      place(I, 170, 120); tick(I, 1);
      ok(n.timer === 0, 'off the rail: the timer resets');
      // too high (the window 41..48)
      place(I, p[0], p[2], p[1] + 1); I.pepper.y = 60; w.pep.surfaceAtFeet = SUPE.SURF_RAIL;
      n.timer = 10; n.update(w, I.rec('SUPE'), I.rec('SUPE').ctrl);
      ok(n.state < 5, `Pepper at y 60: no rescue (state ${n.state})`);
    }
    {
      // the locomotive within 24: at once, he appears 24 behind the camera
      const I = start(2);
      const w = I.world, S = I.rec('SUPE'), n = supeOf(I), L = I.rec('TRNL');
      ok(L.ctrl?.nodes.some((x) => x instanceof TrainNode), 'TRNL runs (era 0)');
      tick(I, 30);
      const fwd = [L.m[8], L.m[10]];
      place(I, L.x + fwd[0] * 12, L.z + fwd[1] * 12, L.y + 1);
      tick(I, 2);
      const c = w.camera.c;
      const dc = Math.hypot(S.x - c[0], S.y - c[1], S.z - c[2]);
      notes.push(`train close: surface ${w.pep.surfaceAtFeet}, train dist ${f1(Math.sqrt(L.ctrl.distSq))}, timer ${n.timer}, state ${n.state}, SUPE ${f1(dc)} from the eye`);
      ok(n.state === ST.SWOOP && n.timer >= SUPE.WAIT_FORCED, `the locomotive close: called at once (state ${n.state}, timer ${n.timer})`);
      ok(dc > 15 && dc < 35, `appears about 24 (+8 up) behind the camera eye (${f1(dc)}, then 2.4 closer per tick)`);
    }
    return { checked, failures, notes };
  },
};
