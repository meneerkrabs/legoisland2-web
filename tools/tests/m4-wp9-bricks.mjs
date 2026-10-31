// WP9 (FX_Bricks, docs/re/m4/wp9-bricks.md): the Bricks / BrickMorph data parsed the way the game's loaders read it, and the brick effects on the real
// island world: the house stages (LGIPH01.. set SWITCH_LGI_BRICKFX_PEPPERSHOUSEnn), the era-0 buildings floating away, the era-1 buildings falling into
// place, switch 0xfe (finish an effect now), the Brikimal morph, all driven by the LGI_FSM node's tick.
import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadExe } from '../lib/engine-load.mjs';
import { BrickLibrary, brickDictionaries, readBrickLod, loadBrickModel } from '../../src/formats/bricks.ts';
import { islandBrickFx, setBrickRandom } from '../../src/fx/bricks/index.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';

export default {
  name: 'm4-wp9-bricks',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let seed = 4242;
    setBrickRandom(() => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; });
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());

    // ------------------------------------------------------------------ data
    const pe = loadExe(ctx.dataRoot);
    const d = brickDictionaries(pe);
    ok(d.colours.size === 22 && d.bricks.size === 267 && d.groups.size === 30 && d.centres.size === 3, `dictionaries 22 / 267 / 30 / 3: ${d.colours.size} / ${d.bricks.size} / ${d.groups.size} / ${d.centres.size}`);
    ok(d.colours.get('WHITE') === 5 && d.colours.get('TRANS_LIME') === 0x15 && d.bricks.get('ROOF2X2_SLOPED_CNR') === 0x96 && d.bricks.get('BRICK09') === 0x10a && d.groups.get('AUTO09') === 0 && d.groups.get('PART19') === 0x1d && d.centres.get('VECTOR') === 2,
      'dictionary values (WHITE 5, TRANS_LIME 0x15, roof2x2_sloped_cnr 0x96, brick09 0x10a, AUTO09 0, PART19 0x1d, VECTOR 2)');
    const lib = new BrickLibrary(pe, arc('Bricks'), arc('BrickMorph'));
    const types = lib.types.filter(Boolean);
    ok(types.length === 257, `brickset.txt: 257 bricks (${types.length})`);
    let lods = 0, badLod = 0;
    for (const e of arc('Bricks').entries) {
      if (!/\.msh$/i.test(e.path)) continue;
      try {
        const m = readBrickLod(arc('Bricks').read(e));
        lods++;
        if (m.indices.length % 3 || m.indices.some((i) => i >= m.vertexCount)) badLod++;
      } catch { badLod++; }
    }
    ok(lods === 693 && badLod === 0, `LOD meshes: ${lods} read, ${badLod} bad`);
    let noMesh = 0, badSplit = 0;
    for (const t of types) for (let l = 0; l < 3; l++) {
      const m = lib.meshOf(t, l);
      if (!m) { noMesh++; continue; }
      const s = lib.splitOf(t, l);
      if (s < 0 || s > m.vertexCount) badSplit++;
    }
    ok(noMesh === 0 && badSplit === 0, `every brick has a mesh at LOD 0..2 after the copies (${noMesh} missing), first-colour counts in range (${badSplit} bad)`);
    const win = lib.types[d.bricks.get('DOOR4X5_6PANE')];
    ok(win && lib.meshOf(win, 0).vertexCount - lib.splitOf(win, 0) === 48, 'door4x5_6pane: the last 48 vertices take the second colour');
    let files = 0, total = 0, unknown = 0, legacyEmpty = false;
    for (const e of arc('BrickMorph').entries) {
      const m = lib.model(e.path);
      files++; total += m.bricks.length;
      for (const b of m.bricks) if (!lib.types[b.type]) unknown++;
      if (/house04/i.test(e.path)) legacyEmpty = m.bricks.length === 0 && m.centreMode === 0;
    }
    ok(files === 96 && total === 6155 && unknown === 0, `BrickMorph: ${files} models, ${total} bricks (6155), ${unknown} without a brickset entry`);
    ok(legacyEmpty, 'house04.txt (old syntax, CENTRE AUTO) gives no bricks');
    const ph = lib.model('peppershouse01.txt');
    ok(ph.bricks.length === 195 && ph.layers === 11 && Math.abs(ph.centre[0] + 0.16) < 1e-6 && Math.abs(ph.centre[2] + 0.4) < 1e-6, `peppershouse01: 195 bricks, 11 layers, centre ${ph.centre}`);
    const one = loadBrickModel('NAME\tx\nMODELTYPE\tHOUSE\nCENTRE\tVECTOR 1 1 1\n// c\nauto01 fat2x2 1 2 3 0 90 0 red\nnewlayer\npart03 fat2x2 0 0 0 0 0 0 blue trans_red\nbad line\n', lib);
    ok(one.bricks.length === 2 && one.layers === 1 && Math.abs(one.bricks[0].pos[0] - 1.6) < 1e-6 && Math.abs(one.bricks[0].pos[1] - 2.88) < 1e-5 && one.bricks[0].group === 8 && one.bricks[1].group === 0xd
      && one.bricks[1].colour2 === 0x11 && one.bricks[0].colour2 === -1 && Math.abs(one.bricks[0].rot[1] + Math.PI / 2) < 1e-5, 'model line rules (grid 0.8 / 0.96, centre added, y + pi wrapped, groups, colours, NEWLAYER)');

    const ref = {};   // tick counts measured at dt = 1, for the dt = 0.5 runs below (the same effect takes twice the steps at half the step)
    // ------------------------------------------------------------------ era 0: the set-up's registrations, the house stage PH01
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      tick(I, 1);
      const fx = islandBrickFx(I.world);
      const slots = fx.slots.filter(Boolean);
      const bySlot = (n) => slots.find((s) => s.record.name === n);
      ok(slots.filter((s) => s.models.length === 2).length === 22, `era 0: 22 two-stage effects from FUN_004c0ce9 (${slots.length} slots in all)`);
      const h1 = bySlot('PH01'), hosp = bySlot('HOSP');
      ok(h1 && h1.v === I.ictx.switchVar('SWITCH_LGI_BRICKFX_PEPPERSHOUSE01') && h1.fn[1] === 8 && h1.vis[1] === 1 && h1.iparams[1][5] === 0 && h1.iparams[1][6] === 0x16 && Math.abs(h1.params[1][4] - 60) < 1e-6 && h1.wait === 3,
        `PH01: var BRICKFX_PEPPERSHOUSE01, stage 1 = callback 8 bricks 0..0x16 from 60 up, show the record, wait 3 s`);
      ok(hosp && hosp.fn[0] === 7 && hosp.fn[1] === 4 && hosp.vis[0] === 1 && hosp.vis[1] === 0 && hosp.models[1].file === 'hospital.txt', 'HOSP: test01 (7, show) / hospital.txt (4, hide)');
      const rec = h1.record;
      ok(!rec.enabled, 'PH01 hidden before its stage');
      I.ictx.sounds.length = 0;
      I.vars.set(h1.v, 1);   // SETSWITCH SWITCH_LGI_BRICKFX_PEPPERSHOUSE01 1 (LGIPH01)
      tick(I, 1);
      const m = h1.models[1], tail = m.tail();
      ok(fx.log.includes(`start ${h1.index} 1 8`) && h1.running, 'switch 1: callback 8 of stage 1 runs');
      ok(I.ictx.sounds.some((s) => s.id === 0x34f && Math.abs(s.pos[0] - rec.m[12]) < 1e-3), 'sound 0x34f (DAT_05d58130) at PH01');
      ok(tail.slice(0, 0x16).every((b) => b.visible) && tail.slice(0x16).every((b) => !b.visible), 'bricks 0..21 of the file shown, the rest hidden');
      ok(Math.abs(tail[0x15].offset[1] - 60.1) < 0.01, `the last brick of the range starts 60.1 up (${tail[0x15].offset[1].toFixed(2)})`);
      ok(h1.drawn && [...fx.drawList()].filter((b) => m.bricks.includes(b)).length === 0x16, 'the 22 bricks are in the draw list');
      let landed = -1, done = -1;
      for (let t = 2; t < 400; t++) {
        tick(I);
        if (landed < 0 && tail.slice(0, 0x16).every((b) => b.offset[1] === 0 && !b.moving)) landed = t;
        if (rec.enabled) { done = t; break; }
      }
      notes.push(`PH01: all bricks home after ${landed} ticks, record shown after ${done} ticks`);
      ref.landed = landed; ref.done = done;
      ok(landed > 140 && landed < 170, `bricks land after 3 s of drops + 61 ticks of falling (${landed})`);
      ok(done > landed + 85 && done < landed + 95, `the record is shown after the 3 s wait (${done - landed} ticks later)`);
      tick(I, 1);
      ok(h1.stage === 1 && !h1.running && !h1.drawn, 'stage 1 reached, the bricks are not drawn at rest (visibility 1)');
      ok(I.ictx.sounds.filter((s) => [0x339, 0x338, 0x337, 0x336].includes(s.id)).length >= 22, 'a click sound (DAT_05d58200 / 1f4 / 1f8 / 1fc) per landed brick');
      // switch 0xfe = n: finish building effect n at once (FUN_00447ef0(DAT_05d58304[n])); HOSP is the third of the era-0 list
      const vH = hosp.v;
      I.vars.set(vH, 1); tick(I, 2);
      ok(hosp.running && hosp.record.enabled, 'HOSP: blowing away (layer by layer), the record still shown');
      I.vars.set(0xfe, 3); tick(I, 1);
      ok(I.vars.get(0xfe) === 0, 'switch 0xfe is cleared');
      tick(I, 1);
      ok(!hosp.running && !hosp.record.enabled && hosp.stage === 1, 'switch 0xfe = 3 finished the hospital effect: hidden (visibility 0)');
    }

    // ------------------------------------------------------------------ era 0: a building floats away on its own
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      tick(I, 1);
      const fx = islandBrickFx(I.world);
      const s = fx.slots.find((x) => x && x.record.name === 'SHP1');
      I.vars.set(s.v, 1);
      let t = 0;
      for (; t < 2000 && s.record.enabled; t++) tick(I);
      const m = s.models[1];
      notes.push(`SHP1 (shop01.txt, ${m.count} bricks, ${m.layers} layers) floated away in ${t} ticks`);
      ref.shp1 = t;
      ok(!s.record.enabled && t > 100 && t < 1000, `era 0 SHP1: hidden after the bricks rose 200 units (${t} ticks)`);
      ok(m.bricks.every((b) => b.offset[0] ** 2 + b.offset[1] ** 2 + b.offset[2] ** 2 > 40000 || b.offset[1] > 150), 'every brick is far up');
    }

    // ------------------------------------------------------------------ the same effects at dt = 0.5 (the fixed 60 Hz step after the first five frames: every tick counts half)
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      I.world.dt = 0.5;
      tick(I, 1);
      const fx = islandBrickFx(I.world);
      const h1 = fx.slots.find((s) => s && s.record.name === 'PH01'), rec = h1.record, tail = h1.models[1].tail();
      I.vars.set(h1.v, 1);
      let landed = -1, done = -1;
      for (let t = 1; t < 900; t++) {
        tick(I);
        if (landed < 0 && tail.slice(0, 0x16).every((b) => b.offset[1] === 0 && !b.moving)) landed = t;
        if (rec.enabled) { done = t; break; }
      }
      notes.push(`PH01 at dt 0.5: all bricks home after ${landed} ticks, record shown after ${done} ticks`);
      ok(Math.abs(landed - 2 * ref.landed) <= 4, `dt 0.5: the bricks land after twice the ticks (${landed} vs 2 x ${ref.landed})`);
      ok(Math.abs(done - 2 * ref.done) <= 6, `dt 0.5: the record is shown after twice the ticks (${done} vs 2 x ${ref.done})`);
      const J = loadIsland(ctx, { node: 2, bricks: true });
      J.world.dt = 0.5;
      tick(J, 1);
      const s = islandBrickFx(J.world).slots.find((x) => x && x.record.name === 'SHP1');
      J.vars.set(s.v, 1);
      let t = 0;
      for (; t < 3000 && s.record.enabled; t++) tick(J);
      notes.push(`SHP1 at dt 0.5 floated away in ${t} ticks`);
      ok(t > 1.5 * ref.shp1 && t < 2.3 * ref.shp1, `dt 0.5: SHP1 floats away in about twice the ticks (${t} vs 2 x ${ref.shp1}; the random delays of the blow-away differ between the runs)`);
    }
    // ------------------------------------------------------------------ era 1: RESQ falls into place (callback 7)
    {
      const I = loadIsland(ctx, { node: 7, bricks: true });
      tick(I, 1);
      const fx = islandBrickFx(I.world);
      const s = fx.slots.find((x) => x && x.record.name === 'RESQ');
      ok(s && s.fn[1] === 7 && s.models[1].file === 'resq.txt' && Math.abs(s.params[1][4] - 100) < 1e-6, 'era 1 (FUN_004c0471): RESQ resq.txt, callback 7 from 100 up');
      if (s) {
        s.record.hide();
        I.vars.set(s.v, 1);
        tick(I, 1);
        const tl = s.models[1].tail(), b0 = tl[tl.length - 1];
        ok(Math.abs(b0.offset[1] - 100) < 1e-3 && tl.every((b) => b.visible), `RESQ's bricks start 100 up (the last one: ${b0.offset[1]})`);
        let t = 0;
        for (; t < 1000 && !s.record.enabled; t++) tick(I);
        ok(s.record.enabled && t > 150, `RESQ shown when the bricks are home and the wait is over (${t} ticks)`);
      }
    }

    // ------------------------------------------------------------------ the Brikimal (FUN_004bd4a8 -> IslandCtx.brickMorph)
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      tick(I, 2);
      const fx = islandBrickFx(I.world);
      const bml = I.rec('BML1');
      const s = fx.slots.find((x) => x && x.record === bml);
      ok(s && s.models.map((m) => m.file).join(',') === 'animal07.txt,animal00.txt,animal06.txt,animal02.txt' && s.vis.slice(0, 4).every((v) => v === 2), 'BML1: four animals, visibility 2 (bricks drawn at rest)');
      ok(!bml.enabled, 'BML1 record hidden (the bricks are the animal)');
      tick(I, 40);
      const shown = () => s.models.map((m) => m.bricks.filter((b) => b.visible).length);
      ok(shown()[1] === s.models[1].count && shown()[0] === 0 && s.drawn && !s.running, `after the start burst animal 1 stands (visible ${shown()})`);
      const st0 = s.stage;
      I.vars.set(s.v, 1);
      tick(I, 1);
      ok(s.running && fx.state(s.index) !== 2, 'var 1: the morph runs, state not idle');
      tick(I, 60);
      ok(!s.running && s.stage === (st0 + 1) % 4 && shown()[2] === s.models[2].count && shown()[1] === 0, `morphed into animal 2 (visible ${shown()})`);
      const b = s.models[2].bricks[0];
      ok(Math.hypot(b.world[12] - bml.x, b.world[14] - bml.z) < 6, 'the bricks stand at the Brikimal');
    }
    // ------------------------------------------------------------------ the vehicle roster FUN_0051c823: a crashed car falls apart and is rebuilt
    {
      const I = loadIsland(ctx, { node: 3, bricks: true });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      const w = I.world;
      tick(I, 60);
      const fx = islandBrickFx(w);
      const roster = fx.slots.filter((s) => s && s.models.length > 4 && !/^BML/.test(s.record.name)).map((s) => s.record.name);
      ok(roster.join(',') === 'AMBU,DNGY,JSKI,SPBT,RHEL,PHEL,SPD0,SPD1,SPD2,PCAR', `roster (table 0x8e9b28): ${roster.join(',')}`);
      const car = I.rec('SPD0'), s = fx.slots.find((x) => x && x.record === car);
      ok(s.v === 0x24 && s.models.length === 9 && s.models[0].file === 'speedster08.txt' && s.fn.slice(0, 2).join() === '10,11' && s.vis[0] === 1, 'SPD0: var 0x24, speedster08 / 00..07, callbacks 10 / 11 alternating, show');
      const P = I.pepper;
      P.x = car.x + car.m[8] * 15; P.z = car.z + car.m[10] * 15; P.y = w.col.terrainHeight(P.x, car.y + 20, P.z, 0); P.rebuildYaw();
      tick(I, 3);
      ok((car.flags & 0x8000) !== 0 && s.running && s.oneShot, `SPD0 crashes in front of Pepper: flag 0x8000, the burst (0xd) runs`);
      const vis = () => s.models.reduce((n, m) => n + m.bricks.filter((b) => b.visible).length, 0);
      ok(vis() > 0 && s.drawn, `its bricks are drawn (${vis()})`);
      P.x = car.x + 300; P.rebuildYaw();
      let n = 0;
      while ((car.flags & 0x8000) && n++ < 600) tick(I, 1);
      ok((car.flags & 0x8000) === 0 && car.enabled && !s.running && n < 200, `rebuilt: flag 0x8000 cleared by the end of the burst after ${n} ticks`);
      const p0 = [car.x, car.z];
      tick(I, 60);
      ok(Math.hypot(car.x - p0[0], car.z - p0[1]) > 3, `SPD0 drives on (${Math.hypot(car.x - p0[0], car.z - p0[1]).toFixed(1)} units in 60 ticks)`);
      notes.push(`SPD0 crash: rebuilt after ${n} ticks`);
    }
    setBrickRandom(null);
    return { checked, failures, notes };
  },
};
