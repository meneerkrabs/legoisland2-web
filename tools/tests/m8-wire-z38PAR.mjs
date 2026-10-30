import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { startParRun, parSnapshot } from '../../src/zones/z38PAR.ts';
import { ParFx } from '../../src/zones/parachute/par-fx.ts';
import { ParHud } from '../../src/zones/parachute/par-hud.ts';
import { parBotStep } from '../lib/par-bot.mjs';
import { setRandomSource } from '../../src/zones/parachute/util.ts';

// WP-PART-WIRE z38PAR: the emitters the original starts (FUN_0046a926: footsmoke.par x 2 on two static bone matrices + spray01 on LAND at (92.8, 71.5, -126.8); FUN_004676cd: James01 on the
// BOAT record), their gates (always on; the footsmokes off in the states 4 / 5, the spray in 5) and the matrices (the bones 7 / 5 of the pilot's pose x his record; James01 = the boat's live matrix).
const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
export default {
  name: 'm8-wire-z38PAR',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    // the executable: names and offsets of the three start calls (0x46a99b / 0x46a9cb / 0x46aa13) and of James01 (0x467729)
    ok(pe.cstr(0x8b991c) === 'footsmoke.par' && pe.cstr(0x8b992c) === 'footsmoke.par' && pe.cstr(0x8b993c) === 'spray01' && pe.cstr(0x8b9734) === 'James01', 'effect names in the executable');
    let seed = 3; setRandomSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; });
    const L = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
    const run = startParRun(L.world, L.archive);
    const calls = [];
    let nextH = 0;
    const fake = {
      start: (name, m, pos, rot, gate) => { const h = nextH++; calls.push({ op: 'start', h, name, m, pos: [...pos], rot: [...rot], gate: gate ? [...gate] : null }); return h; },
      on: (h) => calls.push({ op: 'on', h }), off: (h) => calls.push({ op: 'off', h }), setMatrix: (h, m) => calls.push({ op: 'setMatrix', h, m }), finish: () => calls.push({ op: 'finish' }),
    };
    const pf = new ParFx(fake);
    run.fx = pf;
    const a = run.recs.pepp.anim;
    pf.pilotCtor(run.recs.land, run.recs.pepp, a?.clip ?? 0, a?.frame ?? 0);
    pf.boatCtor(run.recs.boat);
    const starts = calls.filter((c) => c.op === 'start');
    ok(starts.length === 4, `4 starts, got ${starts.length}`);
    ok(starts.map((s) => s.name).join() === 'footsmoke.par,footsmoke.par,spray01,James01', 'start order');
    ok(starts.every((s) => s.rot[0] === Math.fround(-1.5707964) || Math.abs(s.rot[0] + Math.PI / 2) < 1e-6) && starts.every((s) => s.gate.join() === '2,1,1'), 'rotation -pi/2, gate (2,1,1)');
    ok(starts[2].m === run.recs.land.m && starts[3].m === run.recs.boat.m, 'parents: LAND (record 3) and BOAT (record 40) live matrices');
    ok(starts[2].pos.join() === [0x42b99b23, 0x428ef7cf, 0xc2fdab02].map((h) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, h, true); return d.getFloat32(0, true); }).join(), 'spray01 offset = the immediates of 0x46aa13');
    ok(starts[0].m === pf.boneM7 && starts[1].m === pf.boneM5, 'footsmoke matrices = the static bone 7 / bone 5 matrices');
    // play a whole game with the bot; collect the gate calls
    const hud = new ParHud();
    let states = new Set(), firstOff = -1, tick = 0, sprayOff = -1, matrixChanged = false;
    const m7 = pf.boneM7.slice();
    calls.length = 0;
    for (; tick < 6000 && !run.over; tick++) {
      const s = parSnapshot(L.world);
      L.world.input.setVirtual(parBotStep(s, {}));
      const before = calls.length;
      L.world.tick();
      if (!run.over) hud.update(run, L.pepper.ry, L.world.dt);
      states.add(s.state);
      for (let i = before; i < calls.length; i++) if (calls[i].op === 'off' && calls[i].h === 2 && sprayOff < 0) sprayOff = tick;
      if (firstOff < 0 && calls.some((c) => c.op === 'off' && (c.h === 0 || c.h === 1))) firstOff = tick;
      if (pf.boneM7.some((v, i) => v !== m7[i])) matrixChanged = true;
    }
    ok(run.over, 'the bot finished the game');
    ok(matrixChanged, 'the bone matrix follows the pilot');
    ok(calls.filter((c) => c.op === 'setMatrix').length > 0 && calls.filter((c) => c.op === 'setMatrix').every((c) => c.h === 3 && c.m === run.recs.boat.m), 'James01: the boat matrix is set every tick');
    ok(firstOff >= 0, 'footsmokes switched off in the landing / over states');
    ok(sprayOff >= 0 && sprayOff >= firstOff, 'spray01 off in state 5');
    ok(calls.filter((c) => c.op === 'off' && c.h < 2).length % 2 === 0, 'the two footsmokes go off together');
    return { checked, failures, notes: [`game of ${tick} ticks; first footsmoke gate-off at tick ${firstOff}, spray off at ${sprayOff}`] };
  },
};
