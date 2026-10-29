import { loadZone, loadExe } from '../lib/engine-load.mjs';
import { ColOracle } from '../lib/col-oracle.mjs';
import { headerOnlyColSlots } from '../../src/game/colshapes.ts';
import { startParRun, parSnapshot } from '../../src/zones/z38PAR.ts';
import { startApoRun, apoSnapshot } from '../../src/zones/z40aPO.ts';
import { parBotStep } from '../lib/par-bot.mjs';
import { apoBotStep } from '../lib/apo-bot.mjs';
import { buildMatrix } from '../../src/formats/matrix.ts';
import { setRandomSource } from '../../src/zones/parachute/util.ts';

// WP-MINI: does the canopy / wing record PARA take part in the pilot's sweeps? The ORIGINAL sweep FUN_00441270 (x86 interpreter, tools/lib/col-oracle.mjs) is run with PARA's record (flags 2, the
// matrix the port has at that moment: zero scale while closed, growing to 0.55 while it opens) and its collision object laid out the way the zone's loader builds it, for every sweep of the pilot
// (radius 1.2, mask 3) of a whole scripted game. z38PAR's loader loads PARA_Chute.col with FUN_0043f700 (header only: 0x46ea70, `push path; call 0x43f700; mov [ecx + 0x1c], eax`: slot 7, a disp8 store the slot
// finder missed before), z40aPO's solaarwing.col is an NCOL file. The control (the same sweeps with PARA_Chute.col's POLYGONS loaded by FUN_0043f370) hits on every tick: the test would see a collision.
export default {
  name: 'm8-para-collision',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    let seed = 3; setRandomSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; });
    for (const [zone, file, start, snap, bot] of [['z38PAR', 'col/PARA_Chute.col', startParRun, parSnapshot, parBotStep], ['z40aPO', 'col/solaarwing.col', startApoRun, apoSnapshot, apoBotStep]]) {
      const L = loadZone(ctx, zone, { pe });      // (with `pe` setupZone applies the loader's header-only slots like the game does: setup.ts)
      const run = start(L.world, L.archive);
      const para = L.world.records.find((r) => r.name === 'PARA');
      const hdrSlots = headerOnlyColSlots(pe, L.scene.loaderAt);
      const bytes = L.archive.read(L.archive.find(file));
      const isNcol = String.fromCharCode(...bytes.subarray(32, 36)) !== 'COLP';
      ok(hdrSlots.has(L.scene.records.find((r) => r.name === 'PARA').col) || isNcol, `${zone}: PARA's collision object has no polygons (header-only loader slot or NCOL file)`);
      ok((para.flags & 0x10) === 0 && (para.flags & 2) !== 0, `${zone}: PARA keeps flags 2 (no 0x10 exclusion)`);
      const orc = new ColOracle(pe), ctl = new ColOracle(pe);
      orc.cpu.cw = 0x7f; ctl.cpu.cw = 0x7f;      // Direct3D 7 leaves the x87 in 24-bit mode (docs/re/engine-m1.md 8.1): the original's sweep runs at the control word 0x7f
      const col = orc.collisionObject(bytes, hdrSlots.has(L.scene.records.find((r) => r.name === 'PARA').col));
      const colPoly = ctl.collisionObject(bytes, false);
      const pep = L.pepper;
      const orig = L.world.col.sweep.bind(L.world.col);
      let calls = 0, hits = 0, ctlHits = 0, portHits = 0, scaled = 0;
      L.world.col.sweep = (rec, from, delta, mask, r, s) => {
        const res = orig(rec, from, delta, mask, r, s);
        if (rec === pep && mask === 3 && Math.abs(r - 1.2) < 0.01) {
          calls++;
          if (res && res.rec === para) portHits++;
          if (para.m[0] !== 0 || para.m[5] !== 0) scaled++;
          const list = (c) => [{ name: 'PEPP', m: Array.from(pep.m), flags: 0x12 }, { name: 'PARA', m: Array.from(para.m), flags: 2, col: c }];
          orc.records(list(col));
          const o = orc.sweep(0, from.map(Math.fround), delta.map(Math.fround), 3, r, s);
          if (o && o.rec === 1) hits++;
          ctl.records(list(colPoly));
          const c = ctl.sweep(0, from.map(Math.fround), delta.map(Math.fround), 3, r, s);
          if (c && c.rec === 1) ctlHits++;
        }
        return res;
      };
      let t = 0;
      for (; t < 8000 && !run.over; t++) { L.world.input.setVirtual(bot(snap(L.world), {})); L.world.tick(); }
      ok(run.over && calls > 500, `${zone}: a whole game (${t} ticks, ${calls} pilot sweeps)`);
      ok(hits === 0, `${zone}: the original's sweep never hits PARA (${hits} of ${calls})`);
      ok(portHits === 0, `${zone}: the port's sweep never hits PARA (${portHits})`);
      if (zone === 'z38PAR') ok(ctlHits > calls / 2, `${zone}: control, PARA_Chute.col with polygons would be hit (${ctlHits} of ${calls})`);
      // the opened canopy (scale 0.55 around the pilot, the matrix FUN_00468338 builds: Euler of the pilot, translation = the bone, uniform scale): 400 random sweeps through it
      {
        let rs = 99; const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
        let oh = 0, ph = 0;
        for (let k = 0; k < 400; k++) {
          const px = (rnd() - 0.5) * 2, py = 800 + rnd(), pz = (rnd() - 0.5) * 2;
          const m = buildMatrix(rnd() * 0.5, rnd() * 6.28, 0, px, py + 1.5, pz, 0.55, 0.55, 0.55);
          const from = [px, py, pz].map(Math.fround), delta = [(rnd() - 0.5) * 3, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3].map(Math.fround);
          orc.records([{ name: 'PEPP', m: Array.from(pep.m), flags: 0x12 }, { name: 'PARA', m: Array.from(m), flags: 2, col }]);
          const o = orc.sweep(0, from, delta, 3, 1.2, 1.2);
          if (o && o.rec === 1) oh++;
          ctl.records([{ name: 'PEPP', m: Array.from(pep.m), flags: 0x12 }, { name: 'PARA', m: Array.from(m), flags: 2, col: colPoly }]);
          const c = ctl.sweep(0, from, delta, 3, 1.2, 1.2);
          if (c && c.rec === 1) ph++;
        }
        ok(oh === 0, `${zone}: opened canopy, the original's sweeps never hit PARA (${oh} of 400)`);
        if (zone === 'z38PAR') ok(ph > 0, `${zone}: control: with the polygons the opened canopy is hit (${ph} of 400)`);
        notes.push(`${zone}: opened canopy: original ${oh} hits of 400, with polygons ${ph}`);
      }
      notes.push(`${zone}: ${calls} sweeps, original hits ${hits}, port hits ${portHits}, with polygons ${ctlHits}, canopy open in ${scaled}`);
    }
    return { checked, failures, notes };
  },
};
