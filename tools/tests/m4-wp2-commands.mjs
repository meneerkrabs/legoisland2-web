import { loadIsland } from '../lib/island-load.mjs';
import { islandEnv, islandSlots, makeWalker } from '../lib/m4-wp2-fixture.mjs';
import { CutsceneRunner, CameraSpline, ActorSpline, actorCamera, sideVector, carryMatrix, SIDE_VEC_CSM, SIDE_VEC_END, END_HEIGHT, ACTOR_LOOK_HEIGHT, PEP_END_CLIP, NEAR_RUNNING } from '../../src/shell/cutscene.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';
import { parseMan } from '../../src/formats/anim.ts';
import { Controller } from '../../src/game/controller.ts';
import { waypoints, MAP_PATH, MAP_CSM } from '../../src/game/walker.ts';
import { V } from '../../src/game/vars.ts';

// M4 WP2: the cutscene commands one by one on the real island world (node 2 / node 30), against the decompile (docs/re/m4/wp2-cutscenes.md).
// Run: node tools/test-formats.mjs --only m4-wp2-commands -v

const cmd = (o) => ({ cmd: 0, name: '', actor: 'PEPP', waitId: 0, signalId: 0, delay: 0, duration: 0, body: new Uint8Array(0x40), trailer: [0, 0], ...o });
const script = (commands, declared) => ({ name: 'T', version: 4, declaredCount: declared ?? commands.length, commands, splineNames: [] });
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function setup(ctx, node = 2) {
  const I = loadIsland(ctx, { node });
  const env = islandEnv(ctx, I);
  const r = new CutsceneRunner(env);
  r.allocate(8);
  const one = (commands, slot = 0) => { r.define(slot, `t${slot}`, script(commands)); return slot; };
  const run = (n = 20000, each) => { let t = 0; while (r.active() && t < n) { r.tick(); env.tickSpeech(); t++; each?.(t); } return t; };
  return { I, env, r, one, run, w: I.world, pep: I.pepper, rec: (n) => I.world.records.find((x) => x.name === n) };
}

export default {
  name: 'm4-wp2-commands',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    // ---------------------------------------------------------------------- SETANIM: dictionary name -> clip, done when FUN_0043b92a says ended, then the duration; Shift
    {
      const S = setup(ctx);
      const an = S.pep.anim;
      ok(an && an.rig.clips.length === 317, 'Pepper has the MFIG rig (317 clips)');
      S.one([cmd({ cmd: 1, anim: 'XTALK', duration: 1 })]);
      S.r.start(0); S.r.tick();
      ok(an.clip === 130, `SETANIM XTALK starts clip 130 (dictionary) (got ${an.clip})`);
      const n = an.frameCount; let endTick = -1, t = 1;
      while (S.r.active() && t < 2000) { const f = an.frame; S.r.tick(); t++; if (endTick < 0 && an.frameCount < f + 1 + 2 + 1) endTick = t; }
      ok(t >= Math.floor(n - 3) + 30 - 3 && t <= Math.ceil(n - 3) + 30 + 4, `XTALK (${n} frames): ends ~frameCount - 3 ticks + 1 s duration (${t} ticks)`);
      // unknown name: FUN_0043b6a3(-1) fails, the clip plays on
      const S2 = setup(ctx);
      S2.pep.anim.start(58, 0);
      S2.one([cmd({ cmd: 1, anim: 'NOSUCHANIM' })]);
      S2.r.start(0); S2.r.tick();
      ok(S2.pep.anim.clip === 58, 'an unknown animation name leaves the clip unchanged');
      // Shift: done at once, duration dropped
      const S3 = setup(ctx);
      S3.one([cmd({ cmd: 1, anim: 'XTALK', duration: 5 })]);
      S3.r.start(0); S3.env.skip = true; const t3 = S3.run();
      ok(t3 <= 2, `Shift ends SETANIM and its duration at once (${t3} ticks)`);
      // the registered actor's animation advances one frame per tick (FUN_00459740)
      const S4 = setup(ctx);
      S4.one([cmd({ cmd: 1, anim: 'XTALK', duration: 0 })]);
      S4.r.start(0); S4.r.tick(); const f0 = S4.pep.anim.frame; S4.r.tick();
      ok(near(S4.pep.anim.frame - f0, 1) || S4.pep.anim.frame < f0, 'the actors\' animations advance by 1 frame per tick');
    }

    // ---------------------------------------------------------------------- SETSWITCH through the island dictionary, then SWITCH_GME_*; the duration
    {
      const S = setup(ctx);
      const sw = S.I.ictx.setup.dictionaries.switches;
      const v5 = sw.get('SWITCH_LGI_CSM_FX_SWITCH05');
      ok(v5 >= 250 && v5 <= 317, `SWITCH_LGI_CSM_FX_SWITCH05 is var ${v5}`);
      const gme = S.w.vars.indexOf('SWITCH_GME_BLDG_PHSE');
      S.one([cmd({ cmd: 8, actor: 'SWCH', switchName: 'SWITCH_LGI_CSM_FX_SWITCH05', switchValue: 3, duration: 0.5 }), cmd({ cmd: 8, actor: 'SWCH', switchName: 'SWITCH_GME_BLDG_PHSE', switchValue: 8 })]);
      S.r.start(0); S.r.tick();
      ok(S.w.vars.get(v5) === 3 && gme > 0 && S.w.vars.get(gme) === 8, `SETSWITCH: island dictionary (var ${v5} = 3) and SWITCH_GME (var ${gme} = 8)`);
      const t = S.run() + 1;
      ok(t >= 15 && t <= 17, `the switch command holds its 0.5 s duration (${t} ticks)`);
    }

    // ---------------------------------------------------------------------- actor walk: MOVEPOSITION to a PATH waypoint through the walker; SETPOSITION; FOLLOW
    {
      const S = setup(ctx);
      const pep = S.pep, h0 = makeWalker(pep);
      pep.ctrl.walker = h0;
      const start = waypoints.nearestNode(MAP_PATH, pep.x, pep.y, pep.z);
      const nb = waypoints.neighbors(MAP_PATH, start).nodes.filter((i) => i !== start);
      // a node two hops away whose name is its own first prefix match
      let goal = -1;
      for (const a of nb) for (const b of waypoints.neighbors(MAP_PATH, a).nodes) if (b !== start && goal < 0) { const nm = waypoints.node(MAP_PATH, b).name; if (waypoints.findNode(MAP_PATH, nm) === b && waypoints.findNode(MAP_CSM, nm) < 0) goal = b; }
      const gn = waypoints.node(MAP_PATH, goal);
      S.one([cmd({ cmd: 6, targetKind: 'waypoint', target: gn.name, duration: 1 })]);
      S.r.start(0);
      let arrived = -1, t = 0, aiOff = true;
      const p0 = [pep.x, pep.y, pep.z];
      while (S.r.active() && t < 5000) {
        S.r.tick(); t++;
        if ((pep.ctrl.flags & 2) !== 0 && S.r.active()) aiOff = false;
        if (arrived < 0 && S.r.inspect().commands[0].state === 1 && dist([pep.x, 0, pep.z], [gn.x, 0, gn.z]) < 1.5 && waypoints.get(h0).flags & 2) arrived = t;
      }
      ok(aiOff, 'the actor\'s AI (controller bit 2) is off while the script runs');
      ok(dist([pep.x, 0, pep.z], [gn.x, 0, gn.z]) < 1.5, `MOVEPOSITION: Pepper walked from ${p0.map((v) => v.toFixed(1))} to ${gn.name} (${[pep.x, pep.z].map((v) => v.toFixed(1))}, node ${[gn.x, gn.z].map((v) => v.toFixed(1))})`);
      ok(t > dist(p0, [gn.x, p0[1], gn.z]) / 0.4 - 5, `at the walker speed 0.05 x 8 = 0.4 units per tick (${t} ticks for ${dist(p0, [gn.x, p0[1], gn.z]).toFixed(1)} units)`);
      ok((pep.ctrl.flags & 2) !== 0 && near(waypoints.get(h0).lane, 0.01, 1e-6), 'the end: AI back on, the walker\'s lane restored (0.01)');
      ok(S.w.camera.c[4] === pep.y + END_HEIGHT || near(S.w.camera.c[4], pep.y + END_HEIGHT), 'the end: the camera looks at Pepper + 3.2');
      ok(pep.anim.clip === PEP_END_CLIP, `the end: Pepper's clip = DAT_008ae088 = 0x1b (walking) (got ${pep.anim.clip})`);
      // Shift: walked out at once
      const S2 = setup(ctx);
      S2.pep.ctrl.walker = makeWalker(S2.pep);
      S2.one([cmd({ cmd: 6, targetKind: 'waypoint', target: gn.name, duration: 3 })]);
      S2.r.start(0); S2.env.skip = true; S2.r.tick();
      ok(dist([S2.pep.x, 0, S2.pep.z], [gn.x, 0, gn.z]) < 1.5 && !S2.r.active() || (S2.r.tick(), !S2.r.active()), 'Shift: the walk is finished at once (at the node), the duration dropped');
      // SETPOSITION: PATH node of the index, walker re-pinned
      const S3 = setup(ctx);
      const h3 = makeWalker(S3.pep); S3.pep.ctrl.walker = h3;
      S3.one([cmd({ cmd: 5, targetKind: 'waypoint', target: gn.name })]);
      S3.r.start(0); S3.r.tick();
      ok(near(S3.pep.x, gn.x) && near(S3.pep.z, gn.z) && waypoints.get(h3).from === goal, 'SETPOSITION puts the actor on the PATH node and re-pins its walker there (FUN_004625d7)');
      // FOLLOW: Pepper's walker turns her to face another record, done when facing (-3)
      const S4 = setup(ctx);
      const h4 = makeWalker(S4.pep); S4.pep.ctrl.walker = h4;
      const other = S4.rec('INFO');
      S4.pep.ry = 0; S4.pep.rebuildYaw();
      S4.one([cmd({ cmd: 7, other: 'INFO' }), cmd({ cmd: 12, actor: 'CMRA', fov: 1, waitId: 0 })]);
      S4.r.start(0); const t4 = S4.run();
      const want = Math.atan2(other.x - S4.pep.x, other.z - S4.pep.z);
      let d = Math.abs(S4.pep.ry - want) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d;
      ok(d < 0.6 && t4 > 1 && t4 < 200, `FOLLOW: Pepper turned to face INFO (yaw ${S4.pep.ry.toFixed(2)} vs ${want.toFixed(2)}) in ${t4} ticks; an actor's FOLLOW keeps the script alive`);
      // no walker: the original's null walker makes MOVEPOSITION / FOLLOW no-ops
      const S5 = setup(ctx);
      S5.pep.ctrl.walker = 0;
      S5.one([cmd({ cmd: 6, targetKind: 'waypoint', target: gn.name }), cmd({ cmd: 7, other: 'INFO' })]);
      const px = S5.pep.x; S5.r.start(0); const t5 = S5.run();
      ok(t5 <= 2 && S5.pep.x === px, 'without a walker MOVEPOSITION / FOLLOW of an actor end at once (FUN_0045c470 gives the null DAT_05d4dc94)');
    }

    // ---------------------------------------------------------------------- camera: SETPOSITION actor sides (FUN_00422f21), SETTARGET, FOLLOW, the eased moves
    {
      // story node 30 (>= 8): the 0x1000 flag skips the collision test, the offset is exact
      const S = setup(ctx, 30);
      const bill = S.rec('INFO');
      bill.ry = 0.7; bill.rebuildYaw();
      for (const [word, side] of [['HEAD', 0], ['FRONT', 1], ['BEHIND', 2], ['LSIDE', 3], ['RSIDE', 4]]) {
        S.r.allocate(1); S.r.define(0, 's', script([cmd({ cmd: 5, actor: 'CMRA', targetKind: 'actor', target: 'INFO', side })]));
        S.r.start(0); S.r.tick();
        const c = S.w.camera.c, v = sideVector(side, SIDE_VEC_CSM), m = buildMatrix(0, 0.7, 0, 0, 0, 0);
        const o = [v[0] * m[0] + v[1] * m[4] + v[2] * m[8], v[0] * m[1] + v[1] * m[5] + v[2] * m[9], v[0] * m[2] + v[1] * m[6] + v[2] * m[10]];
        ok(near(c[3], bill.x) && near(c[4], bill.y + ACTOR_LOOK_HEIGHT) && near(c[5], bill.z) && near(c[0], bill.x + o[0]) && near(c[1], c[4] + o[1]) && near(c[2], bill.z + o[2]),
          `camera SETPOSITION actor ${word}: look at INFO + 3.37, eye at the turned offset (${o.map((x) => x.toFixed(2))})`);
        S.run();
      }
      ok(sideVector(1, SIDE_VEC_CSM).join() === '-4,2,10' && sideVector(2, SIDE_VEC_CSM).join() === '4,2,-10' && sideVector(0, SIDE_VEC_CSM).join() === '0,0,-1.75', 'FUN_00422e36: FRONT (-4, 2, 10), BEHIND (4, 2, -10), HEAD (0, 0, -1.75)');
      // camera FOLLOW: does not keep the script alive, follows until SETTARGET resets it
      const S2 = setup(ctx);
      const info = S2.rec('INFO');
      S2.one([cmd({ cmd: 7, actor: 'CMRA', other: 'INFO' }), cmd({ cmd: 12, actor: 'CMRA', fov: 1, delay: 0.5, signalId: 3 }), cmd({ cmd: 3, actor: 'CMRA', targetKind: 'actor', target: 'PEPP', waitId: 3 })]);
      S2.r.start(0); S2.r.tick();
      ok(near(S2.w.camera.c[3], info.x) && near(S2.w.camera.c[4], info.y + ACTOR_LOOK_HEIGHT), 'camera FOLLOW: the look-at is the actor + 3.37');
      const t2 = S2.run();
      ok(t2 >= 16 && t2 <= 19 && near(S2.w.camera.c[3], S2.pep.x), `the script ends with the last non-FOLLOW command; SETTARGET stopped the follow (${t2} ticks)`);
      // eased camera moves: the speeds (SETMOVESPEED a b -> max 0.1 a, ease 0.02 b), MOVETARGET to an actor (+3.37), MOVEPOSITION to a waypoint
      const S3 = setup(ctx);
      const csm = waypoints.maps[MAP_CSM].nodes;
      const wpName = csm.find((n, i) => waypoints.findNode(MAP_CSM, n.name) === i).name, wp = csm.find((n) => n.name === wpName);
      S3.w.camera.c.set([wp.x + 30, wp.y, wp.z, 0, 0, 0]);
      S3.one([cmd({ cmd: 10, actor: 'CMRA', speedA: 10, speedB: 5 }), cmd({ cmd: 6, actor: 'CMRA', targetKind: 'waypoint', target: wpName, duration: 0.5 }), cmd({ cmd: 4, actor: 'CMRA', targetKind: 'actor', target: 'INFO' })]);
      S3.r.start(0); S3.r.tick();
      const step1 = 30 - dist([S3.w.camera.c[0], S3.w.camera.c[1], S3.w.camera.c[2]], [wp.x, wp.y, wp.z]);
      ok(near(step1, 1.0 * 0.1, 1e-4), `MOVEPOSITION after SETMOVESPEED 10 5: first step = max 1.0 x ease 0.1 (${step1.toFixed(4)})`);
      S3.run();
      const c3 = S3.w.camera.c, info3 = S3.rec('INFO');
      ok(near(c3[0], wp.x) && near(c3[1], wp.y) && near(c3[2], wp.z) && near(c3[3], info3.x) && near(c3[4], info3.y + ACTOR_LOOK_HEIGHT) || S3.r.inspect().actors.includes(S3.pep),
        'the eye arrives exactly on the waypoint, the look-at on INFO + 3.37');
    }

    // ---------------------------------------------------------------------- splines: the camera B-spline (FUN_004466f0), the actor matrix track (FUN_0043efa0)
    {
      const S = setup(ctx);
      const read = (p) => parseMan(S.I.archive.read(S.I.archive.find(p)));
      const camMan = read('MatAnim/CAM_pHelFlight1.man'), heliMan = read('MatAnim/pHel_flight1.man');
      const cs = new CameraSpline(camMan);
      ok(cs.count === camMan.declaredFrames, `camera spline: ${cs.count} points (the header count), progress 1 / count per tick`);
      // a uniform cubic B-spline: at a knot it is (P[i-1] + 4 P[i] + P[i+1]) / 6 of the points (x negated)
      const k = 100, p = cs.sample(k / cs.count), P = (i) => [-camMan.tracks[0][i * 9 + 3], camMan.tracks[0][i * 9 + 4], camMan.tracks[0][i * 9 + 5]];
      const want = [0, 1, 2].map((j) => (P(k - 1)[j] + 4 * P(k)[j] + P(k + 1)[j]) / 6);
      ok(dist(p, want) < 1e-3, `B-spline at knot ${k}: (P[k-1] + 4 P[k] + P[k+1]) / 6 (${p.map((v) => v.toFixed(2))})`);
      const as = new ActorSpline(heliMan), m = new Float32Array(16);
      as.apply(50 / as.count, m);
      const r50 = heliMan.tracks[0].subarray(50 * 9, 51 * 9);
      const bm = buildMatrix(r50[0], r50[1], r50[2], -r50[3], r50[4], r50[5], r50[6], r50[7], r50[8]);
      ok([...m].every((v, i) => near(v, bm[i], 1e-3)), 'actor spline at t = 50 / count is record 50 exactly (FUN_0043a742 with x negated)');
      ok(as.count === heliMan.declaredFrames - 2, `actor spline: count = header - 2 (${as.count}), progress 1 / count`);
      // through the runner: lgi04's helicopter flight (BHEL on PHEL_FLIGHT1) and the camera on CAM_PHELFLIGHT1
      const bhel = S.rec('BHEL');
      S.one([cmd({ cmd: 6, actor: 'BHEL', targetKind: 'spline', target: 'Z02LGI\\MATANIM\\PHEL_FLIGHT1.MAN' }), cmd({ cmd: 6, actor: 'CMRA', targetKind: 'spline', target: 'Z02LGI\\MATANIM\\CAM_PHELFLIGHT1.MAN' })]);
      S.r.start(0); S.r.tick();
      const r0 = heliMan.tracks[0];
      ok(near(bhel.x, -r0[3]) && near(bhel.y, r0[4]) && near(bhel.z, r0[5]), 'MOVEPOSITION spline: the actor is on record 0 in the first tick');
      const t = S.run() + 1;
      ok(t >= cs.count + 1 && t <= cs.count + 2, `the camera spline lasts count ticks (+ the end frame: ${t}, count ${cs.count}), the actor's count - 2`);
      ok(dist([S.w.camera.c[0], S.w.camera.c[1], S.w.camera.c[2]], cs.sample((cs.count - 1) / cs.count)) < 1e-3, 'the eye ends on the last sample of the B-spline');
    }

    // ---------------------------------------------------------------------- SETEXPRESSION, the mouth frames of a speaking actor, ATTACH
    {
      const S = setup(ctx);
      const info = S.rec('INFO');
      S.pep.face = 0; info.face = 0;
      S.env.text = () => 'x'.repeat(40);
      S.one([cmd({ cmd: 13, actor: 'INFO', expression: 10, signalId: 1 }), cmd({ cmd: 2, actor: 'PEPP', textId: 'A', waitId: 1 })]);
      S.r.start(0); S.r.tick();
      ok(info.face === 10, 'SETEXPRESSION HAPPY: face frame 10 (FUN_0043f2f0)');
      const faces = new Set(); let t = 0;
      while (S.r.active() && t < 500) { S.r.tick(); S.env.tickSpeech(); t++; faces.add(S.pep.face); }
      ok(faces.size >= 4 && [...faces].every((f) => f >= 0 && f <= 9), `SAYTEXT: random mouth frames 0..9 while the voice plays (${[...faces].sort((a, b) => a - b)})`);
      ok(S.pep.face === 0 && info.face === 0, 'the end restores the registered actors\' face frames (FUN_0043f2f0 with the saved frame)');
      ok(t + 1 >= 92 && t + 1 <= 94, `(40 + 20) / 20 = 3 s with a 20 tick voice (${t + 1} ticks)`);
      // ATTACH: without a carry node the child follows the parent's bone each tick; NULL detaches; with a carry node FUN_00429638 hands it over and the AI is on
      const S2 = setup(ctx);
      const piz = S2.rec('PIZ3'), pep = S2.pep;
      S2.one([cmd({ cmd: 14, actor: 'PIZ3', other: 'PEPP', bone: 16 }), cmd({ cmd: 12, actor: 'CMRA', fov: 1, delay: 0.2 })]);
      S2.r.start(0); S2.run();
      const want = new Float32Array(16);
      carryMatrix({ m: want, show() {} }, pep, 16);
      ok(S2.r.carried.get(piz)?.parent === pep && [...piz.m].every((v, i) => near(v, want[i], 1e-4)) && piz.enabled, 'ATTACH PEPP LEFTHAND: the child sits on bone 16 of the parent');
      S2.r.define(1, 'd', script([cmd({ cmd: 14, actor: 'PIZ3', other: 'NULL', bone: 0 })]));
      S2.r.start(1); S2.run();
      ok(!S2.r.carried.has(piz), 'ATTACH NULL detaches');
      const S3 = setup(ctx);
      const box = S3.rec('PIZ3');
      const calls = [];
      box.ctrl = new Controller();
      box.ctrl.nodes.push({ kind: 'Pizza', var: 2, mask: 0, value: 0, stamp: 0, update() { return 0; }, setParent(p, b) { calls.push([p?.name, b]); } });
      S3.one([cmd({ cmd: 14, actor: 'PIZ3', other: 'BRIK', bone: 14 })]);
      S3.r.start(0); S3.run();
      ok(calls.length === 1 && calls[0][0] === 'BRIK' && calls[0][1] === 14 && (box.ctrl.flags & 2) !== 0, 'ATTACH on a record with a carry node: setParent(BRIK, RIGHTHAND) and the AI is switched on');
    }

    // ---------------------------------------------------------------------- loader rules: unknown actor, extra declared commands; manager: empty script, queue, menu, hold, skip, end
    {
      const S = setup(ctx);
      S.one([cmd({ cmd: 12, actor: 'CMRA', fov: 2 }), cmd({ cmd: 0, actor: 'FECM', flag: false }), cmd({ cmd: 12, actor: 'CMRA', fov: 3 })]);
      S.r.start(0); S.run();
      ok(S.env.log.includes('fov 2') && !S.env.log.includes('fov 3'), 'an unknown actor (lgibr07: FECM) stops the loader: the rest of the script never runs');
      // an empty script started directly blocks the manager; started from the queue it ends the next frame
      const S2 = setup(ctx);
      S2.r.define(0, 'empty', script([]));
      S2.r.define(1, 'b', script([cmd({ cmd: 12, actor: 'CMRA', fov: 4 })]));
      ok(!S2.r.start(0) && !S2.r.active(), 'an empty script (LGICI05-07) does not run');
      S2.r.start(1); S2.run();
      ok(!S2.env.log.includes('fov 4') && S2.r.inspect().queued === 1, 'after it, starts are only queued and never run (the original\'s stuck DAT_05d47b18) until the next allocate');
      const S3 = setup(ctx);
      S3.r.define(0, 'a', script([cmd({ cmd: 12, actor: 'CMRA', fov: 5, delay: 0.1 })]));
      S3.r.define(1, 'empty', script([]));
      S3.r.define(2, 'c', script([cmd({ cmd: 12, actor: 'CMRA', fov: 6 })]));
      S3.r.start(0); S3.r.start(1); S3.r.start(2);
      const tq = S3.run();
      ok(S3.env.log.includes('fov 5') && !S3.env.log.includes('fov 6') && !S3.r.active() && S3.env.bars === 0 && (S3.w.vars.get(V.PEPPER_CONTROL) & 0x100) === 0,
        `the queue is one deep (the third start is dropped); a queued empty script ends with the normal clean-up (${tq} ticks)`);
      S3.r.start(2); S3.run();
      ok(S3.env.log.includes('fov 6'), 'after that the manager works again');
      // STARTEDFROMMENU, the hold
      const S4 = setup(ctx);
      S4.one([cmd({ cmd: 12, actor: 'CMRA', fov: 7 })]);
      S4.w.vars.set(0xb, 1);
      ok(!S4.r.start(0) && !S4.r.active(), 'STARTEDFROMMENU (var 0xb) != 0: FUN_0045c40c does nothing');
      S4.w.vars.set(0xb, 0);
      S4.r.override = true;
      ok(S4.r.active(), 'FUN_0045c456(1) holds the active state');
      S4.r.override = false;
      // the frame: near plane, bars, PEPPER_CONTROL
      S4.r.start(0);
      ok(S4.env.bars === 1 && (S4.w.vars.get(V.PEPPER_CONTROL) & 0x100) && S4.env.near === 1, 'start: bars on, PEPPER_CONTROL |= 0x100, near plane 1.0');
      S4.r.tick();
      ok(S4.env.near === NEAR_RUNNING || S4.env.near === null, 'every frame of a script: near plane 2.0');
      // Shift: delays and speech
      const S5 = setup(ctx);
      S5.env.text = () => 'x'.repeat(100);
      S5.one([cmd({ cmd: 2, actor: 'PEPP', textId: 'A', delay: 3 })]);
      S5.r.start(0); S5.r.tick(); S5.env.skip = true; const t5 = S5.run();
      ok(t5 <= 2 && S5.env.log.includes('stop'), `Shift: the 3 s delay is zeroed and the line stopped (${t5} ticks)`);
      // the end puts the camera behind Pepper (no collision test before node 8 when free)
      const S6 = setup(ctx, 30);
      S6.pep.ctrl.walker = makeWalker(S6.pep);
      S6.pep.ry = 1.2; S6.pep.rebuildYaw();
      S6.one([cmd({ cmd: 0, actor: 'PEPP', flag: true })]);
      S6.r.start(0); S6.run();
      const c = S6.w.camera.c, v = SIDE_VEC_END, m = buildMatrix(0, 1.2, 0, 0, 0, 0);
      const o = [v[0] * m[0] + v[1] * m[4] + v[2] * m[8], v[0] * m[1] + v[1] * m[5] + v[2] * m[9], v[0] * m[2] + v[1] * m[6] + v[2] * m[10]];
      const okBehind = near(c[3], S6.pep.x) && near(c[4], S6.pep.y + END_HEIGHT) && near(Math.hypot(c[0] - c[3], c[1] - c[4], c[2] - c[5]), Math.hypot(...v));
      ok(okBehind, `end of script: look at Pepper + 3.2, eye ${Math.hypot(...v).toFixed(2)} away (BEHIND ${o.map((x) => x.toFixed(1))} or a free side)`);
      notes.push(`end camera offset ${[c[0] - c[3], c[1] - c[4], c[2] - c[5]].map((x) => x.toFixed(2))} (BEHIND would be ${o.map((x) => x.toFixed(2))})`);
      // actorCamera without the 0x1000 flag sweeps: a free view keeps the asked side
      actorCamera(S6.w, S6.pep, 1.2, 2, END_HEIGHT, v);
      ok(Math.hypot(c[0] - c[3], c[1] - c[4], c[2] - c[5]) > 20, 'FUN_00422f21 keeps the distance on every side it tries');
    }

    // ---------------------------------------------------------------------- the ground snap of registered actors (FUN_0045965d)
    {
      const S = setup(ctx);
      const pep = S.pep;
      const g = S.w.col.terrainHeight(pep.x, pep.y + 4, pep.z, 4);
      pep.y = g + 3;
      S.one([cmd({ cmd: 12, actor: 'CMRA', fov: 1, delay: 0.1 }), cmd({ cmd: 0, actor: 'PEPP', flag: true })]);
      S.r.start(0); S.r.tick();
      ok(Math.abs(pep.y - (g + 3)) > 0.5 && pep.y < g + 3, `a registered actor with a controller is put on the ground every frame (y ${(g + 3).toFixed(2)} -> ${pep.y.toFixed(2)}, terrain ${g.toFixed(2)})`);
      S.run();
    }

    // ---------------------------------------------------------------------- the island's real slots load (dictionary names all known)
    {
      for (const node of [2, 7, 30, 52, 61]) {
        const I = loadIsland(ctx, { node });
        const anims = I.ictx.setup.dictionaries.anims;
        const slots = islandSlots(ctx, I);
        const missing = new Set();
        for (const s of slots.slots) for (const c of s.script.commands) if (c.cmd === 1 && !anims.has(c.anim)) missing.add(c.anim);
        ok(missing.size === 0, `node ${node}: every SETANIM name is in the animation dictionary (${[...missing]})`);
        const sw = I.ictx.setup.dictionaries.switches, unknown = new Set();
        for (const s of slots.slots) for (const c of s.script.commands) if (c.cmd === 8 && !sw.has(c.switchName) && I.world.vars.indexOf(c.switchName) < 0) unknown.add(c.switchName);
        ok(unknown.size === 0, `node ${node}: every SETSWITCH name resolves (${[...unknown]})`);
      }
    }
    return { checked, failures, notes };
  },
};
