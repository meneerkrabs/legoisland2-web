import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { startApoRun, apoSnapshot } from '../../src/zones/z40aPO.ts';
import { ApoFx } from '../../src/zones/parachute/apo-fx.ts';
import { ApoHud } from '../../src/zones/parachute/apo-hud.ts';
import { apoBotStep } from '../lib/apo-bot.mjs';
import { setRandomSource } from '../../src/zones/parachute/util.ts';

// WP-PART-WIRE z40aPO: footsmoke.par x 2 (bones 2 / 4 of the pilot) + T_gold.par (TAR1) from FUN_007d53af, rocket01.par x 8 on BBT0..7 from FUN_007d2650 (botexpl01.par is the
// invalid-handle stub FUN_004429e0: not started), the gates (footsmokes off in the states 5 / 6, T_gold on below the third group's height, a rocket off while its bot is parked below y = 500).
const f32 = (x) => Math.fround(x);
export default {
  name: 'm8-wire-z40aPO',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    ok(pe.cstr(0x94a358) === 'footsmoke.par' && pe.cstr(0x94a368) === 'footsmoke.par' && pe.cstr(0x94a378) === 'T_gold.par' && pe.cstr(0x94a1f0) === 'rocket01.par' && pe.cstr(0x94a1e0) === 'botexpl01.par', 'effect names in the executable');
    let seed = 5; setRandomSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; });
    const L = loadZone(ctx, 'z40aPO');
    const run = startApoRun(L.world, L.archive);
    const calls = [];
    let nextH = 0;
    const fake = {
      start: (name, m, pos, rot, gate) => { const h = nextH++; calls.push({ op: 'start', h, name, m, pos: [...pos], rot: [...rot], gate: gate ? [...gate] : null }); return h; },
      on: (h) => calls.push({ op: 'on', h }), off: (h) => calls.push({ op: 'off', h }), setMatrix: (h, m) => calls.push({ op: 'setMatrix', h, m }), finish: () => calls.push({ op: 'finish' }),
    };
    const af = new ApoFx(fake);
    run.fx = af;
    af.pilotCtor(L.world.records[3]);
    af.botsCtor(run.recs.bots);
    const st = calls.filter((c) => c.op === 'start');
    ok(st.length === 11, `11 starts (2 + 1 + 8), got ${st.length}`);
    ok(st.slice(0, 3).map((s) => s.name).join() === 'footsmoke.par,footsmoke.par,T_gold.par' && st.slice(3).every((s) => s.name === 'rocket01.par'), 'start order');
    ok(st[0].pos.join() === [f32(0.79), f32(0.07), f32(-0.53)].join() && st[1].pos.join() === [f32(-0.79), f32(0.07), f32(-0.53)].join(), 'footsmoke offsets (0x3f4a3d71 ..)');
    ok(st[2].m === L.world.records[3].m && st[2].gate.join() === '1,1,1', 'T_gold: TAR1 (record 3), off');
    ok(st.slice(3).every((s, i) => s.m === run.recs.bots[i].m && s.gate.join() === '2,1,1' && s.rot.join() === '0,0,0'), 'rocket01 on the live bot matrices, gate on, no rotation');
    ok(calls.filter((c) => c.op !== 'start').map((c) => `${c.op}${c.h}`).join() === 'off2,on0,on1', 'constructor tail: T_gold off, both footsmokes on');
    calls.length = 0;
    // a whole game
    const hud = new ApoHud();
    const offs = { smoke: -1, gold: -1 }, rocketOn = new Set(), rocketOff = new Set();
    let tick = 0, moved = false;
    const m2 = af.boneM2.slice();
    for (; tick < 8000 && !run.over; tick++) {
      const s = apoSnapshot(L.world);
      L.world.input.setVirtual(apoBotStep(s, {}));
      const before = calls.length;
      L.world.tick();
      if (!run.over) hud.update(run, L.world.dt);
      for (let i = before; i < calls.length; i++) {
        const c = calls[i];
        if (c.op === 'off' && (c.h === 0 || c.h === 1) && offs.smoke < 0) offs.smoke = tick;
        if (c.op === 'on' && c.h === 2 && offs.gold < 0) offs.gold = tick;
        if (c.h >= 3) (c.op === 'on' ? rocketOn : rocketOff).add(c.h);
      }
      if (af.boneM2.some((v, i) => v !== m2[i])) moved = true;
    }
    ok(run.over, 'the bot finished the game');
    ok(moved, 'the bone-2 matrix follows the pilot');
    ok(offs.smoke >= 0, `footsmokes switched off at landing (tick ${offs.smoke})`);
    ok(rocketOn.size > 0 && rocketOff.size > 0, 'rocket gates switch both ways');
    // T_gold: below the third group's height with a ring of the group passed (FALL state): on (2, 1, 1) every tick
    {
      const L2 = loadZone(ctx, 'z40aPO');
      const r2 = startApoRun(L2.world, L2.archive);
      const c2 = []; let h2 = 0;
      const a2 = new ApoFx({ start: () => h2++, on: (h) => c2.push(['on', h]), off: (h) => c2.push(['off', h]), setMatrix() {}, finish() {} });
      r2.fx = a2; a2.pilotCtor(L2.world.records[3]); a2.botsCtor(r2.recs.bots); c2.length = 0;
      const pil = r2.recs.pepp.ctrl.find('ApoPilot');
      let n = 0;
      while (pil.state !== 2 && n++ < 3000) { L2.world.input.setVirtual(0); L2.world.tick(); }
      ok(pil.state === 2, 'the pilot reached the free fall');
      c2.length = 0;
      r2.ring[10] = 1; r2.recs.pepp.y = 300;
      L2.world.tick();
      ok(c2.some((x) => x[0] === 'on' && x[1] === 2), 'T_gold on below 310 with a ring of the third group passed');
      c2.length = 0; r2.ring[10] = 0; r2.recs.pepp.y = 290; L2.world.tick();
      ok(!c2.some((x) => x[0] === 'on' && x[1] === 2) && r2.ring[14] === 2, 'no ring of the group passed: missed, T_gold stays off');
    }
    return { checked, failures, notes: [`game ${tick} ticks; footsmoke off ${offs.smoke}, T_gold on ${offs.gold}, rockets on ${[...rocketOn]} off ${[...rocketOff]}`] };
  },
};
