import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { AsteroidBelt, MsvcRand, ST } from '../../src/zones/z39ASB/belt.ts';
import { ASB_EXHAUST } from '../../src/zones/z39ASB/game.ts';
import { GameVars } from '../../src/game/vars.ts';

// WP-PART-WIRE z39ASB: FUN_007b780c starts three rocket01.par on SHUT; FUN_007b82dd gates them off at the end of the fly-in (state 0 -> 1) and on again in the states 3 / 4 / 5.
const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
export default {
  name: 'm8-wire-z39ASB',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    ok(pe.cstr(0x945704) === 'rocket01.par' && pe.cstr(0x945714) === 'rocket01.par' && pe.cstr(0x945724) === 'rocket01.par', 'effect names (0x945704 / 14 / 24)');
    ok(ASB_EXHAUST.flat().join() === [0, Math.fround(4.08), 0, Math.fround(1.44), Math.fround(1.65), 0, -Math.fround(1.44), Math.fround(1.65), 0].join(), 'offsets');
    const run = (stop) => {
      const L = loadZone(ctx, 'z39ASB');
      const r = L.world.records;
      const cam = new Float64Array(18);
      const belt = new AsteroidBelt({ shut: r[1], hull: r[2], asteroids: r.filter((x) => x.name.startsWith('AST')) }, cam, new MsvcRand(9), new GameVars());
      const log = [];
      belt.fxGate = (on) => log.push([belt.state, on]);
      return { belt, log };
    };
    // flight to the end: the gate goes off once at the end of the fly-in, then on every tick of the end states
    {
      const { belt, log } = run();
      let t = 0;
      for (; t < 400 && belt.state === ST.INTRO; t++) belt.update({ held: 0 }, 1);
      ok(belt.state === ST.FLY && log.length === 1 && log[0][1] === false, `fly-in end: one gate-off (${JSON.stringify(log)})`);
      belt.aid(1);       // the course end (F9 aid): DONE
      for (let i = 0; i < 400 && belt.state !== ST.END; i++) belt.update({ held: 0 }, 1);
      ok(belt.state === ST.END, 'the run ended');
      const ons = log.slice(1);
      ok(ons.length > 10 && ons.every((x) => x[1] === true && x[0] === ST.DONE), `DONE: gate-on every tick (${ons.length})`);
    }
    {
      const { belt, log } = run();
      for (let i = 0; i < 400 && belt.state === ST.INTRO; i++) belt.update({ held: 0 }, 1);
      belt.aid(2);       // hull empty
      for (let i = 0; i < 600 && belt.state !== ST.END; i++) belt.update({ held: 0 }, 1);
      ok(log.slice(1).length > 10 && log.slice(1).every((x) => x[1] === true && (x[0] === ST.EMPTY || x[0] === ST.CRASHED)), 'EMPTY / CRASHED: gate-on every tick');
    }
    return { checked, failures };
  },
};
