import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { npcGlobals, groupVarOp } from '../../src/island/npc/globals.ts';
import { startPizzaNodes, TrainNode, SpeederNode, DriverNode, FootballNode, FlowerNode, BobNode, platformBeside, TRAIN, SND_TRAIN, SND_FOOTY, BALL } from '../../src/island/pizza/index.ts';

// WP5: the ambient nodes of speeder.c / SupaStat.c / Footy.c on the real island (story node 2; LOON in node 52): the train runs its loop, stops at a
// station with the whistle and can be ridden; the cars follow their roads (WP3's Human1 drives the walker this node creates), pitch to the ground,
// stop and fall apart when Pepper stands in the way, the drivers sit on the seats; the football goes round the three kids; the flowers grow and shrink.
export default {
  name: 'm4-wp5-ambient',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (n) => '0x' + (n >>> 0).toString(16);
    const start = (node) => {
      const I = loadIsland(ctx, { node });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);   // before the NPCs: the car walkers this makes are the ones Human1 reads its speed from (the set-up's order)
      startIslandNpcs(I.world);
      I.ictx.bursts = [];
      I.ictx.brickBurst = (rec, kind) => I.ictx.bursts.push({ rec: rec.name, kind, tick: I.world.tickCount });
      return I;
    };
    const nodeOf = (I, name, cls) => I.rec(name)?.ctrl?.nodes.find((n) => n instanceof cls);

    // ============================================================ 1. the train
    {
      const I = start(2);
      const w = I.world;
      const L = I.rec('TRNL'), T = I.rec('TRNT'), C = I.rec('TRNC');
      const nl = nodeOf(I, 'TRNL', TrainNode), nt = nodeOf(I, 'TRNT', TrainNode), nc = nodeOf(I, 'TRNC', TrainNode);
      ok(nl && nt && nc && !nl.leader && nt.leader === L && nc.leader === T, `train nodes: loco + 2 followers (${nl?.leader?.name}, ${nt?.leader?.name}, ${nc?.leader?.name})`);
      ok(L.ctrl.walker > 0 && T.ctrl.walker > 0, `walkers created (${L.ctrl.walker}, ${T.ctrl.walker})`);
      const p0 = [L.x, L.z];
      let travelled = 0, prev = [L.x, L.z], stopAt = -1, restartAt = -1, minGap = 1e9, maxGap = 0, whistles = 0;
      I.ictx.sounds.length = 0;
      for (let i = 0; i < 4000 && restartAt < 0; i++) {
        tick(I, 1);
        travelled += Math.hypot(L.x - prev[0], L.z - prev[1]); prev = [L.x, L.z];
        const gap = Math.hypot(L.x - T.x, L.z - T.z);
        if (i > 30) { minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap); }
        if (stopAt < 0 && nl.stopTicks > 0) stopAt = i;
        if (stopAt >= 0 && restartAt < 0 && nl.stopTicks <= 0) restartAt = i;
      }
      whistles = I.ictx.sounds.filter((s) => s.id === SND_TRAIN.WHISTLE).length;
      notes.push(`train: ${travelled.toFixed(0)} units, stop at tick ${stopAt}, off again at ${restartAt}, loco-tender gap ${minGap.toFixed(1)}..${maxGap.toFixed(1)}, whistles ${whistles}`);
      ok(travelled > 100, `the loco runs (${travelled.toFixed(0)} units from ${p0.map((v) => v.toFixed(0))})`);
      ok(stopAt > 0 && restartAt - stopAt >= 140 && restartAt - stopAt <= 160, `stops at a station for 150 ticks (${stopAt} -> ${restartAt})`);
      ok(whistles >= 2, `whistles at the stop and the start (${whistles})`);
      ok(minGap > 4 && maxGap < 40, `the tender follows the loco (gap ${minGap.toFixed(1)}..${maxGap.toFixed(1)})`);
      ok(I.ictx.sounds.some((s) => s.id === SND_TRAIN.RUN), 'the running loop plays');

      // ---- the ride: wait for the next stop, Pepper onto the platform beside the loco, Ctrl
      let n = 0;
      while (nl.stopTicks <= 0 && n++ < 4000) tick(I, 1);
      const spot = [0, 0, 0];
      const beside = platformBeside(w, L, spot);
      ok(nl.stopTicks > 0 && beside, `stopped at a station with a platform beside (${nl.stopTicks.toFixed(0)}, ${beside})`);
      const P = I.pepper;
      P.x = spot[0]; P.y = spot[1]; P.z = spot[2]; P.rebuildYaw();
      tick(I, 2);
      ok((w.vars.get(0x0c) & TRAIN.ICON_BOARD) !== 0, `the board icon (INTERACT_ICONS ${hex(w.vars.get(0x0c))})`);
      press(I, 'ControlLeft');
      ok(nl.riding && w.vars.get(0x5e) === TRAIN.PC_RIDE, `Ctrl on the platform: riding, PEPPER_CONTROL 0x80 (${nl.riding}, ${hex(w.vars.get(0x5e))})`);
      tick(I, 160);
      const seat = L.toWorld(nl.seat);
      ok(Math.hypot(P.x - seat[0], P.y - seat[1], P.z - seat[2]) < 0.5, 'Pepper on the seat');
      const before = [L.x, L.z];
      hold(I, ['ArrowUp'], 60);
      const moved = Math.hypot(L.x - before[0], L.z - before[1]);
      ok(nl.moving && moved > 5, `Up drives the train (${moved.toFixed(1)} in 60 ticks, factor ${(w.ext.get('train').factor).toFixed(2)})`);
      hold(I, ['ArrowDown'], 60);
      ok(!nl.moving, 'Down brakes it to a stop');
      // drive on until a platform is beside, then Ctrl gets off
      let off = false; n = 0;
      while (!off && n++ < 3000) {
        hold(I, ['ArrowUp'], 1);
        if (platformBeside(w, L, spot)) { hold(I, ['ArrowDown'], 40); press(I, 'ControlLeft'); off = !nl.riding; }
      }
      ok(off && w.vars.get(0x5e) === 1, `off at a platform after ${n} ticks (PEPPER_CONTROL ${hex(w.vars.get(0x5e))})`);
    }

    // ============================================================ 2. the cars
    {
      const I = start(2);
      const w = I.world;
      const A = I.rec('AMBU'), na = nodeOf(I, 'AMBU', SpeederNode);
      const pete = I.rec('PETE'), nd = nodeOf(I, 'PETE', DriverNode);
      ok(na && na.startNode === 107 && A.ctrl.walker > 0, `AMBU: speeder from ROAD node ${na?.startNode}, walker ${A.ctrl.walker}`);
      ok(nd && nd.car === null && nd.inMask === 8 && nd.inValue === 0 && nd.mask === 0, `PETE: driver node, in-car test a7 & 8 == 0 (${nd?.inMask}, ${nd?.inValue}), own gate open`);
      const a0 = [A.x, A.z];
      let pMin = 1e9, pMax = -1e9;
      for (let i = 0; i < 300; i++) { tick(I, 1); pMin = Math.min(pMin, A.rx); pMax = Math.max(pMax, A.rx); }
      const d = Math.hypot(A.x - a0[0], A.z - a0[1]);
      notes.push(`AMBU moved ${d.toFixed(1)} in 300 ticks (Human1 of WP3 drives it), pitch ${pMin.toFixed(3)}..${pMax.toFixed(3)}`);
      ok(pMax - pMin > 0.05 && pMax < 0.6 && pMin > -0.6, `pitches with the road (${pMin.toFixed(3)}..${pMax.toFixed(3)})`);
      ok(d > 5, `the ambulance drives (${d.toFixed(1)})`);
      const g = w.col.terrainHeight(A.x, A.y + 20, A.z, 0);
      ok(Math.abs(A.y - g) < 2, `on the ground (y ${A.y.toFixed(2)}, ground ${g.toFixed(2)})`);
      ok(Math.hypot(pete.x - A.x, pete.z - A.z) < 4 && pete.y > A.y, `PETE sits in it (${Math.hypot(pete.x - A.x, pete.z - A.z).toFixed(2)} away)`);
      ok(I.ictx.sounds.some((s) => s.id === 0x2ea), 'the ambulance engine loop (CarVox2)');
      // Pepper in the way
      const P = I.pepper;
      P.x = A.x + A.m[8] * 10; P.y = A.y; P.z = A.z + A.m[10] * 10; P.rebuildYaw();
      tick(I, 2);
      ok((A.flags & 0xa010) === 0xa010 && I.ictx.bursts.some((b) => b.rec === 'AMBU' && b.kind === 0xd), `Pepper ahead: the car stops and falls apart (flags ${hex(A.flags)}, bursts ${I.ictx.bursts.length})`);
      ok(I.ictx.sounds.some((s) => s.id === 0x2eb), 'the ambulance horn (Horn3)');
      const y0 = pete.y; tick(I, 5);
      ok(pete.y > y0 + 4, `the driver pops up while the car is in bricks (+${(pete.y - y0).toFixed(1)})`);
      // the driver out: var bit 8
      w.vars.or(0xa7, 8); tick(I, 2);
      ok(nd.placed, 'with a7 & 8 the driver stands at his PATH node');
    }

    // ============================================================ 3. the football and the flowers
    {
      const I = start(2);
      const w = I.world;
      const nb = nodeOf(I, 'BALL', FootballNode);
      ok(nb && nb.kids.map((k) => k?.name).join() === 'XXX0,XXX1,XXX2', `the ball's kids ${nb?.kids.map((k) => k?.name)}`);
      const states = new Set(); const kickers = new Set();
      for (let i = 0; i < 1500; i++) { tick(I, 1); states.add(nb.state); kickers.add(nb.from); }
      notes.push(`football: states ${[...states].sort().join(',')}, kickers ${[...kickers].join(',')}, ground ${nb.ground.toFixed(2)}`);
      ok(states.has(BALL.FLY) && states.has(BALL.ROLL) && kickers.size >= 2, `the ball goes round (states ${[...states]}, kickers ${[...kickers]})`);
      ok(I.ictx.sounds.some((s) => s.id === SND_FOOTY.KICK) && I.ictx.sounds.some((s) => s.id === SND_FOOTY.BOUNCE), 'kick and bounce sounds');
      // the flower: STEV's var 0x7c bit 0x20
      const F = I.rec('FLR1'), nf = nodeOf(I, 'FLR1', FlowerNode);
      ok(Math.abs(F.m[0] ** 2 + F.m[1] ** 2 + F.m[2] ** 2 - 0.25) < 1e-3, 'FLR1 at scale 0.5 before');
      w.vars.or(0x7c, 0x20);
      tick(I, 91);
      ok(Math.abs(nf.scale - 1.5) < 0.02, `grown to 1.5 after 90 ticks (${nf.scale.toFixed(3)})`);
      tick(I, 300);
      ok((w.vars.get(0x7c) & 0x20) === 0 && Math.abs(nf.scale - 0.5) < 1e-6, `shrunk back and the bit cleared (${hex(w.vars.get(0x7c))}, ${nf.scale.toFixed(3)})`);
    }

    // ============================================================ 3b. NUBB: out of SPD0 after Nancy's pizza, then talkable (node 3, real brick FX)
    {
      const I = loadIsland(ctx, { node: 3, bricks: true });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      const w = I.world, v = w.vars;
      const g = npcGlobals(w).groups.map((x) => x.map((r) => r?.name ?? '-').join('+'));
      ok(g.includes('NANC+NUBB+-') && g.includes('CLIK+PETE+-') && g.includes('DARR+RICH+-'), `the era-0 NPC groups from FUN_0042407f (${g.join(' ')})`);
      const car = I.rec('SPD0'), nubb = I.rec('NUBB'), nanc = I.rec('NANC');
      const drv = nodeOf(I, 'NUBB', DriverNode);
      tick(I, 60);
      ok(Math.hypot(nubb.x - car.x, nubb.z - car.z) < 4 && (v.get(0x80) & 8) === 0, 'NUBB drives SPD0');
      // the cars drive on when nobody is in the way: no crash
      let crashed = 0;
      for (let i = 0; i < 300; i++) { tick(I, 1); for (const n of ['AMBU', 'SPD0', 'SPD1']) if (I.rec(n).flags & 0x8000) crashed++; }
      ok(crashed === 0, `no car falls apart without Pepper in the way (${crashed})`);
      // Pepper in front of SPD0: it falls apart (real FX_Bricks), NUBB still cannot be talked to
      const P = I.pepper;
      P.x = car.x + car.m[8] * 15; P.z = car.z + car.m[10] * 15; P.y = w.col.terrainHeight(P.x, car.y + 20, P.z, 0); P.rebuildYaw();
      tick(I, 3);
      ok((car.flags & 0x8000) !== 0, `SPD0 falls apart in front of Pepper (flags ${hex(car.flags)})`);
      P.x = car.x + 300; P.rebuildYaw();
      let n = 0;
      while ((car.flags & 0x8000) && n++ < 600) tick(I, 1);
      // the car's brick slot is registered by FUN_0051c823 (the vehicle roster of PepSwitc's constructor, WP6, not ported yet): without it the burst
      // does nothing and the car keeps flag 0x8000 (not drawn). Reported, not asserted.
      notes.push(`SPD0 after the crash: flags ${hex(car.flags)} after ${n} ticks (${(car.flags & 0x8000) ? 'still in bricks: no vehicle slot registered' : 'rebuilt'})`);
      // deliver Nancy's pizza (type 1, slot 12): her conversation end ORs 3 into MOVE_NUBB (group)
      const place = (npc, d) => { P.x = npc.x + Math.sin(npc.ry) * d; P.z = npc.z + Math.cos(npc.ry) * d; P.y = npc.y; P.ry = Math.atan2(npc.x - P.x, npc.z - P.z); P.rebuildYaw(); };
      for (let i = 0; i < 3; i++) { place(nanc, 4); tick(I, 1); }
      I.ictx.cutscenes.length = 0;
      press(I, 'ShiftLeft'); tick(I, 3);
      ok(I.ictx.cutscenes[0]?.slot === 12 && (v.get(0x80) & 3) === 3, `Nancy's cutscene 12, MOVE_NUBB | 3 (${JSON.stringify(I.ictx.cutscenes.map((c) => c.slot))}, ${hex(v.get(0x80))})`);
      P.x += 400; P.rebuildYaw();
      n = 0;
      while ((v.get(0x80) & 8) === 0 && n++ < 6000) tick(I, 1);
      ok((v.get(0x80) & 8) !== 0, `SPD0 drives to ROAD 94 and lets NUBB out (MOVE_NUBB ${hex(v.get(0x80))} after ${n} ticks)`);
      tick(I, 2);
      ok(drv.placed && Math.hypot(nubb.x - car.x, nubb.z - car.z) > 4, `NUBB out of the car (${Math.hypot(nubb.x - car.x, nubb.z - car.z).toFixed(1)} from it)`);
      tick(I, 30);
      ok((v.get(0x80) & 0x20000) === 0, `talkable: no 0x20000 in MOVE_NUBB (${hex(v.get(0x80))})`);
      const before = v.get(0x4f);
      for (let i = 0; i < 3; i++) { place(nubb, 4); tick(I, 1); }
      I.ictx.cutscenes.length = 0;
      press(I, 'ShiftLeft'); tick(I, 3);
      ok(I.ictx.cutscenes[0]?.slot === 14 && v.get(0x4f) === before - 1, `Shift: NUBB's cutscene 14, bricks ${before} -> ${v.get(0x4f)}`);
      notes.push(`NUBB: out after ${n} ticks, cutscenes ${JSON.stringify(I.ictx.cutscenes.map((c) => c.slot))}`);
      // the other drivers: CLIK -> PETE (AMBU), DARR -> RICH (SPD1)
      const pete = nodeOf(I, 'PETE', DriverNode), rich = nodeOf(I, 'RICH', DriverNode);
      groupVarOp(w, I.rec('CLIK'), 3, 0); groupVarOp(w, I.rec('DARR'), 3, 0);
      n = 0;
      while (!(pete.placed && rich.placed) && n++ < 8000) tick(I, 1);
      ok(pete.placed && rich.placed, `PETE and RICH get out too after their group's delivery (${n} ticks; a7 ${hex(v.get(0xa7))}, a4 ${hex(v.get(0xa4))})`);
    }

    // ============================================================ 4. LOON (era 3)
    {
      const I = start(52);
      const nl = nodeOf(I, 'LOON', BobNode);
      const R = I.rec('LOON');
      ok(nl && Math.abs(nl.height - 24) < 1e-4, `LOON bobs 3 * 8 = 24 (${nl?.height})`);
      const y0 = R.y; let top = -1e9;
      for (let i = 0; i < 700; i++) { tick(I, 1); top = Math.max(top, R.y - y0); }
      ok(Math.abs(top - 24.08) < 0.2 && Math.abs(R.y - y0) < 25, `up 24 and down again (max +${top.toFixed(2)})`);
    }
    return { checked, failures, notes };
  },
};
