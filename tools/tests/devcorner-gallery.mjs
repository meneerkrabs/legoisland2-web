// Developer corner, sections 6 and 7 (model / texture galleries): the "never loaded / unlisted" lists are computed at run time from the user's data by the PURE code of
// src/devcorner/gallery-unused.ts (the method of docs/re/unused.md section 7) and compared with the research numbers; known examples are in, known-used ones are out; every
// listed picture decodes; the trigram string index gives the same answers as the naive substring search the research used; mesh facts (stub / leeg) and the brick lists are checked.
// On the dev data (the NL retail exe, 6,459,444 bytes) the totals must match the research EXACTLY; on another build a 2% tolerance applies (and a note says so).
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { ExeStrings, ZONE_NAMES, OTHER_NAMES, zoneTablesOf, computeModels, computeTextures, computeBricks, neverLoadedBrickModels, borrowTextures, namedBy, memberOf } from '../../src/devcorner/gallery-unused.ts';
import { decodePic, topDown, meshInfo } from '../../src/devcorner/gallery-pic.ts';
import { wireOfTriangles } from '../../src/devcorner/gallery-turntable.ts';
import { BrickLibrary } from '../../src/formats/bricks.ts';
import { parseCol, extractTriangles } from '../../src/formats/col.ts';

export default {
  name: 'devcorner-gallery',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const exact = pe.data.length === 6459444;
    const near = (got, want, what) => {
      checked++;
      const tol = exact ? 0 : Math.ceil(want * 0.02);
      if (Math.abs(got - want) > tol) failures.push(`${what}: ${got}, research ${want}${exact ? '' : ` (tolerance ${tol})`}`);
      else if (got !== want) notes.push(`${what}: ${got} vs research ${want} (within tolerance, other build?)`);
    };
    if (!exact) notes.push(`executable is ${pe.data.length} bytes (research build 6459444): 2% tolerance on the totals`);

    const blob = new ExeStrings(pe.data);
    ok(blob.lines.length > 40000, `exe strings ${blob.lines.length}`);
    const tables = {};
    for (const z of ZONE_NAMES) tables[z] = zoneTablesOf(sceneOf(ctx, z));
    const archives = new Map(ctx.archives.map((a) => [a.name, a]));
    const listings = [...ZONE_NAMES, ...OTHER_NAMES].map((n) => archives.get(n)).filter(Boolean);
    ok(listings.length === ZONE_NAMES.length + OTHER_NAMES.length, `archives found ${listings.length}`);

    // ---- models: totals and per-zone counts of unused.md 7.1
    const ml = computeModels(blob, tables, listings);
    near(ml.never.length, 805, 'never loaded meshes');
    near(ml.neverCol.length, 787, 'never named .col');
    const per = {};
    for (const e of ml.never) per[e.archive] = (per[e.archive] ?? 0) + 1;
    const R71 = { z27TRX: 201, z02LGI: 135, z23DIP: 68, z21FSH: 66, z03PPH: 56, z14OSD: 48, z41MAP: 46, z07CSI: 32, z10RGB: 31, z15SSH: 25, z17WAS: 25, z40OGL: 21, z16PYA: 18, z18MMP: 13, z13CAI: 10, z09JST: 4, z36CNT: 3, z04IFC: 2, z22BIP: 1 };
    for (const [z, n] of Object.entries(R71)) near(per[z] ?? 0, n, `never loaded meshes in ${z}`);
    ok(Object.keys(per).every((z) => z in R71), `never-loaded meshes in an archive the research does not list: ${Object.keys(per).filter((z) => !(z in R71))}`);
    // the .col counts equal the mesh counts per zone, except z28HAT 41 and z21FSH 45 (collision files of loaded characters)
    const perCol = {};
    for (const e of ml.neverCol) perCol[e.archive] = (perCol[e.archive] ?? 0) + 1;
    ok(perCol.z28HAT === 41, `z28HAT .col ${perCol.z28HAT}`);
    ok(perCol.z21FSH === 45, `z21FSH .col ${perCol.z21FSH}`);
    ok(perCol.z27TRX === 201, `z27TRX .col ${perCol.z27TRX}`);
    // loaded but not wired into any model: z60FRE 359 of 730, z41MAP 9, z23DIP 1
    const un = {};
    for (const e of ml.unwired) un[e.archive] = (un[e.archive] ?? 0) + 1;
    near(un.z60FRE ?? 0, 359, 'z60FRE loaded but unwired'); near(un.z41MAP ?? 0, 9, 'z41MAP loaded but unwired'); near(un.z23DIP ?? 0, 1, 'z23DIP loaded but unwired');
    ok(Object.keys(un).length === 3, `unwired zones ${Object.keys(un)}`);
    near(ml.loaded.z60FRE, 730, 'z60FRE loader table meshes');
    ok(ml.unwired.some((e) => e.archive === 'z41MAP' && e.name === 'bb_bgr'), 'z41MAP bb_bgr unwired');
    ok(ml.unwired.some((e) => e.archive === 'z23DIP' && e.name === 'vals_bgrhair'), 'z23DIP vals_bgrhair unwired');

    // ---- known examples in, known-used out
    const has = (a, n) => ml.never.some((e) => e.archive === a && e.name === n);
    for (const [a, n] of [['z27TRX', 'boulder1'], ['z27TRX', 'boulder36'], ['z27TRX', 'lava1'], ['z27TRX', 'test2'], ['z27TRX', 'statue5'], ['z27TRX', 'swing_log1'], ['z02LGI', 'ferry'], ['z02LGI', 'steam_train'], ['z02LGI', 'police_chopper'], ['z02LGI', 'mfig_bill'], ['z02LGI', 'mfig_brickbot0'], ['z02LGI', 'mfig_pepper'], ['z02LGI', 'sandboard1'],
      ['z03PPH', 'ast_gold'], ['z03PPH', 'plaque'], ['z23DIP', 'palm_trunk_low1'], ['z13CAI', 'skeleton_one'], ['z16PYA', 'pyramids'], ['z07CSI', 'cata_lod1'], ['z41MAP', 'piz7_pizza'], ['z41MAP', 'cit1_ogelcitizen'], ['z14OSD', 'gull_seagull'], ['z22BIP', 'rock_mocster_template'], ['z18MMP', 'rays']]) ok(has(a, n), `${a}/${n} should be never loaded`);
    // used ones are out: every loader-table mesh is never listed as never loaded
    for (const z of ZONE_NAMES) for (const mp of tables[z].meshAll) ok(!ml.never.some((e) => e.archive === z && e.path.toLowerCase() === mp), `${z} ${mp} is loaded but listed as never loaded`);
    ok(!has('z27TRX', 'lava') && !has('z27TRX', 'lava_flow'), 'z27TRX lava / lava_flow are loaded');
    ok(!ml.never.some((e) => e.archive === 'z60FRE'), 'z60FRE has no never-loaded meshes (all are in its loader table)');
    ok(!has('z02LGI', 'seabed') && !has('z02LGI', 'sea'), 'z02LGI sea meshes are loaded');
    ok(ml.never.find((e) => e.archive === 'z02LGI' && e.name === 'ferry')?.col?.toLowerCase() === 'col/ferry.col', 'ferry has its .col partner');
    ok(ml.colOnly.length > 0 && ml.colOnly.every((e) => /\.col$/i.test(e.path)), '.col-only list');
    // namedBy examples
    const memb = (a, p) => memberOf(a, { path: p, size: 0 });
    ok(namedBy(blob, tables.z27TRX, memb('z27TRX', 'meshes/lava.msh')).how === 'loader', 'lava.msh named by the loader');
    ok(namedBy(blob, tables.z27TRX, memb('z27TRX', 'meshes/boulder1.msh')).named === false, 'boulder1.msh never named');

    // ---- the index agrees with the naive substring search of the research (a sample of stems and suffixes)
    const naive = '\n' + blob.lines.join('\n') + '\n';
    let seed = 12345;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const stems = ['boulder1', 'ferry', 'jail', 'zzzzz', 'house01', 'shuttle', 'lava', 'pepper', 'bldg_jail', 'text0', 'clock1', 'sea0', 'nonexistent_xyz', 'resq', 'mfig_bill'];
    for (let i = 0; i < 200; i++) { const l = blob.lines[rnd(blob.lines.length)]; if (l.length > 5) { const a = rnd(l.length - 3); stems.push(l.slice(a, a + 3 + rnd(l.length - a - 2))); } }
    for (const s of stems) {
      if (s.length < 3 || s.includes('\n')) continue;
      ok(blob.includes(s) === naive.includes(s), `includes(${s}) index vs naive`);
      ok(blob.endsWith(s) === naive.includes(`${s}\n`), `endsWith(${s}) index vs naive`);
    }

    // ---- mesh facts: stub cubes, empty meshes, known triangle counts
    const info = (a, n) => meshInfo(archives.get(a).read(`meshes/${n}.msh`));
    const stubNames = ['mfig_bill', 'mfig_brickster', 'mfig_pepper', 'mfig_brickbot0', 'mfig_brickbot9', 'rbbt_rabbit1'];
    for (const n of stubNames) { const i = info('z02LGI', n); ok(i.stub && i.tris === 12, `z02LGI/${n} should be a 12-triangle unit-cube stub: ${JSON.stringify(i)}`); }
    ok(info('z41MAP', 'cit1_ogelcitizen').stub, 'cit1_ogelcitizen is a stub');
    ok(info('z27TRX', 'lava1').empty && info('z27TRX', 'test2').empty, 'lava1 and test2 are empty (0 triangles)');
    ok(!info('z27TRX', 'boulder1').stub && info('z27TRX', 'boulder1').tris === 80, `boulder1 tris ${info('z27TRX', 'boulder1').tris}`);
    ok(info('z02LGI', 'police_chopper').tris === 882, `police_chopper tris ${info('z02LGI', 'police_chopper').tris}`);
    ok(info('z02LGI', 'steam_train').tris === 1838, `steam_train tris ${info('z02LGI', 'steam_train').tris}`);
    ok(!info('z03PPH', 'ast_gold').stub, 'ast_gold is a real mesh');
    let stubs = 0, empties = 0;
    for (const e of ml.never) { try { const i = meshInfo(archives.get(e.archive).read(e.path)); if (i.stub) stubs++; if (i.empty) empties++; } catch (err) { failures.push(`meshInfo ${e.archive}/${e.path}: ${err.message}`); } }
    notes.push(`of the ${ml.never.length} never-loaded meshes ${stubs} are 12-triangle unit-cube stubs and ${empties} are empty`);
    ok(stubs >= 20 && empties >= 2, `stub ${stubs} / empty ${empties}`);

    // ---- collision wireframe: ferry.col -> lines
    const colTri = extractTriangles(parseCol(archives.get('z02LGI').read('col/ferry.col')));
    const wire = wireOfTriangles(colTri.positions);
    ok(wire.length === (colTri.positions.length / 9) * 18 && wire.length > 0, `ferry.col wireframe ${wire.length}`);

    // ---- textures (unused.md 7.3)
    const tl = computeTextures(blob, tables, listings);
    near(tl.unlisted.length, 151, 'unlisted zone textures');
    near(tl.leftovers.length, 105, 'overlay leftovers');
    const tz = {};
    for (const t of tl.unlisted) tz[t.archive] = (tz[t.archive] ?? 0) + 1;
    near(tz.z60FRE ?? 0, 79, 'z60FRE unlisted'); near(tz.z04IFC ?? 0, 47, 'z04IFC unlisted'); near(tz.z41MAP ?? 0, 8, 'z41MAP unlisted'); near(tz.z17WAS ?? 0, 4, 'z17WAS unlisted');
    const ids = (z) => tl.unlisted.filter((t) => t.archive === z).map((t) => t.id).sort((a, b) => a - b);
    ok(ids('z60FRE')[0] === 143 && ids('z60FRE').at(-1) === 219, `z60FRE ids ${ids('z60FRE')[0]}..${ids('z60FRE').at(-1)}`);
    ok(ids('z41MAP').join() === '88,89,90,91,92,93,94,95', `z41MAP ids ${ids('z41MAP')}`);
    ok(ids('z17WAS').join() === '55,56,57,58', `z17WAS ids ${ids('z17WAS')}`);
    ok(ids('z04IFC')[0] === 29 && ids('z04IFC').includes(199), `z04IFC ids ${ids('z04IFC')[0]}..`);
    ok(tl.unlisted.some((t) => t.archive === 'z02LGI' && t.id === 340) && tl.unlisted.some((t) => t.archive === 'z21FSH' && t.id === 1), 'z02LGI 340 and z21FSH 001 unlisted');
    const lf = (p) => tl.leftovers.some((t) => `${t.archive}/${t.path}`.toLowerCase() === p.toLowerCase());
    ok(lf('Overlays/Z02LGI/Text007old.tga') && lf('GENERICBITS/Backdrop/OldLoadingScreen.tga') && lf('Overlays/Z20DSP/Save/Clock1.tga') && lf('Overlays/Z02LGI/Originals/REDBAR.tga'), 'known leftovers present');
    // a listed texture (text000 of z02LGI is in a list) is not unlisted; the island pointer / bars are NOT leftovers (live numbered files, handled by the HUD blocks)
    ok(!tl.unlisted.some((t) => t.archive === 'z02LGI' && t.id === 1), 'z02LGI text001 is listed');
    ok(!lf('Overlays/Z02LGI/Text008.tga'), 'Text008 is a numbered HUD sprite, not a leftover');
    // every listed picture decodes (tga / wib) and draws top-down; the odd extension .tgaback too
    let dec = 0;
    const pics = [...tl.unlisted, ...tl.leftovers];
    for (const t of pics) {
      try { const p = decodePic(t.path, archives.get(t.archive).read(t.path)); const d = topDown(p, p.sequence[0] ?? 0, 64); ok(d.w > 0 && d.h > 0 && d.rgba.length === d.w * d.h * 4, `${t.path} thumbnail`); dec++; } catch (err) { failures.push(`decode ${t.archive}/${t.path}: ${err.message}`); }
    }
    ok(dec === pics.length, `decoded ${dec}/${pics.length}`);
    const back = archives.get('z39ASB').entries.find((e) => /\.tgaback$/i.test(e.path));
    ok(!!back && decodePic(back.path, archives.get('z39ASB').read(back)).w > 0, 'Text000.tgaback decodes as a tga');
    for (const i of [8, 9, 10, 11]) { const e = archives.get('Overlays').find(`Z02LGI/Text${String(i).padStart(3, '0')}.tga`); ok(!!e && decodePic(e.path, archives.get('Overlays').read(e)).w > 0, `island HUD text0${i}`); }
    for (const i of [2, 68, 69, 70, 71]) { const e = archives.get('menu').find(`mOverlays/Text${String(i).padStart(3, '0')}.tga`); ok(!!e && decodePic(e.path, archives.get('menu').read(e)).w > 0, `menu text${i}`); }
    const wib = tl.unlisted.find((t) => t.ext === 'wib');
    if (wib) { const p = decodePic(wib.path, archives.get(wib.archive).read(wib.path)); ok(p.kind === 'wib' && p.frames.length >= 1, 'a wib texture decodes with frames'); }

    // ---- borrowed textures: a never-loaded mesh whose file name is also in another zone's table
    // (a never-loaded mesh has by definition no string naming it, so none of them shares a name with a loaded one; the loaded-but-unwired ones do)
    let borrowed = 0, borrowedNever = 0;
    for (const e of ml.never) if (borrowTextures(tables, e.archive, `${e.name}.msh`).length) borrowedNever++;
    for (const e of ml.unwired) if (borrowTextures(tables, e.archive, `${e.name}.msh`).length) borrowed++;
    ok(borrowedNever === 0, `never-loaded meshes with a same-named mesh in another zone's table: ${borrowedNever}`);
    ok(borrowed >= 300, `unwired meshes with textures borrowed from another zone's model table: ${borrowed}`);
    ok(borrowTextures(tables, 'z41MAP', 'bb_mr.msh')[0]?.zone === 'z02LGI', 'z41MAP/bb_mr borrows the texture list of z02LGI');
    notes.push(`${borrowed} of ${ml.unwired.length} loaded-but-unwired meshes share their file name with a mesh in another zone's model table (their texture list is used in the turntable); ${borrowedNever} of the never-loaded ones (flat group colours)`);

    // ---- bricks (unused.md 7.2)
    const lib = new BrickLibrary(pe, archives.get('Bricks'), archives.get('BrickMorph'));
    const b = computeBricks(lib);
    near(b.total, 257, 'bricks in brickset.txt'); near(b.used.size, 210, 'bricks used by brick models'); near(b.unused.length, 47, 'unused bricks'); near(b.modelFiles, 96, 'brick-model files');
    const bn = new Set(b.unused.map((x) => x.name));
    for (const n of ['awning', 'parasol', 'parasol_stand', 'wing9x4', 'police_car_box', 'fat12x12', 'bar4x2_studs']) ok(bn.has(n), `${n} should be an unused brick`);
    for (const n of ['brick1x1', 'plate1x1']) { const t = lib.types.find((x) => x && x.name.toLowerCase() === n); if (t) ok(!bn.has(t.name), `${n} is used`); }
    const five = neverLoadedBrickModels(blob, archives.get('BrickMorph'));
    ok(five.slice().sort().join() === 'helicopter_resq.txt,house04.txt,jail.txt,policecar01.txt,shuttle.txt', `never loaded brick models: ${five}`);
    near(five.length, 5, 'never loaded brick-model files');
    ok(!five.includes('test01.txt') && !five.includes('house01.txt'), 'test01.txt and house01.txt are named by the exe');
    for (const f of five) {
      const m = lib.model(f);
      // house04.txt is in an older format (BRICK_ORIENT_nnn names, other brick names): FUN_0044d570's sscanf reads no brick from it
      if (f === 'house04.txt') ok(!!m && m.bricks.length === 0, 'house04.txt has an old format and yields no bricks');
      else ok(!!m && m.bricks.length > 0, `${f} parses with bricks`);
    }
    return { checked, failures, notes };
  },
};
