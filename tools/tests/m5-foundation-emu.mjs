import { emulateIslandSetup, emulateZoneSetup, emulateSetup, emuSpecOf, ISLAND_SPEC, HUB_SPECS } from '../../src/formats/emusetup.ts';
import { extractZoneSetup, zoneCodeIndex, readZoneTable } from '../../src/formats/zonesetup.ts';
import { profileFor, setupZone } from '../../src/game/setup.ts';
import { islandRigs } from '../../src/island/ambient/common.ts';
import { emulatedArrival } from '../../src/hub/arrival.ts';
import { CollisionWorld } from '../../src/game/collision.ts';
import { buildRecords } from '../../src/game/zone.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { compareOracle } from '../lib/emu-oracle.mjs';

// M5 foundation, part 1: the x86 set-up emulation for any zone (src/formats/emusetup.ts `emulateZoneSetup`, docs/re/m5/foundation.md).
//  (a) the island through the generic entry is the island's emulation (identical results, `loaderRigs` = the island's own `islandRigs` table: an oracle for the
//      generalised loader hosts);
//  (b) every FSM node that maps to a hub runs with an empty `unhooked` and agrees with the symbolic extraction (oracle) on every attach / flag write / box / cutscene /
//      HUD hint / render mode it reports as active; attach counts are regression values; samples of every node band run too;
//  (c) the hub data the workers need: loader rigs, dictionaries, cutscene slots, waypoint maps, sound handles, arrival (vehicle, control, place per previous zone);
//  (d) profileFor(..., { emuVars }) -> profile.emu + setupZone for every hub;
//  (e) the terrain host (FUN_0043cd62) answers with the port's ground ray.

/** hub -> story nodes of the FSM that map to it (decomp-le2 tools/fsm_dump.py) */
const HUBS = {
  z07CSI: { index: 6, nodes: [15, 16, 17, 19, 20, 21, 22, 24, 25, 27, 28, 29] },
  z13CAI: { index: 10, nodes: [33, 51] },
  z14OSD: { index: 11, nodes: [34, 45] },
  z16PYA: { index: 13, nodes: [36, 38, 40] },
  z23DIP: { index: 19, nodes: [47, 50] },
  z40OGL: { index: 27, nodes: [64, 66] },
};
/** attach counts per hub node (regression; the emulated set-up with game variables 0x58 = node, everything else 0) */
const ATTACHES = {
  z07CSI: { 15: 115, 16: 115, 17: 115, 19: 127, 20: 127, 21: 127, 22: 127, 24: 125, 25: 125, 27: 124, 28: 124, 29: 124 },
  z13CAI: { 33: 27, 51: 27 }, z14OSD: { 34: 56, 45: 57 }, z16PYA: { 36: 39, 38: 30, 40: 26 }, z23DIP: { 47: 38, 50: 55 }, z40OGL: { 64: 64, 66: 59 },
};
/** nodes at the band boundaries of the hubs' set-ups + the extremes: all must run */
const SAMPLE_NODES = [0, 6, 17, 18, 22, 23, 26, 34, 35, 36, 37, 45, 46, 47, 48, 64, 65, 66, 72];

/** the emulated set-up the way the game asks for it: profileFor(..., { emuVars }) (it hands the port's ground ray to the terrain host) */
const emuOf = (ctx, pe, zone, vars) => profileFor(zone, pe, sceneOf(ctx, zone), undefined, { emuVars: vars, archive: ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase()) }).emu;
const varsOf = (init) => { const m = new Map(Object.entries(init).map(([k, v]) => [+k, v])); return { m, get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }; };

export default {
  name: 'm5-foundation-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    zoneCodeIndex(pe);

    // ---- (a) the island through the generic entry
    {
      const scene = sceneOf(ctx, 'z02LGI'), archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
      const a = emulateIslandSetup(pe, scene, { vars: varsOf({ 0x58: 30, 2: 1 }), archive });
      const b = emulateZoneSetup(pe, scene, { vars: varsOf({ 0x58: 30, 2: 1 }), archive }, { ...ISLAND_SPEC, loaderRigs: true });
      ok(a.attaches.length === b.attaches.length && a.stores.length === b.stores.length && a.calls.length === b.calls.length, `island: generic entry differs (${a.attaches.length}/${b.attaches.length} attaches)`);
      ok(emuSpecOf('z02LGI') === ISLAND_SPEC && emuSpecOf('Z07csi') === HUB_SPECS.z07csi && emuSpecOf('z03PPH') === undefined, 'emuSpecOf');
      // the loader's rigs from the emulated loader code == the island's static table (islandRigs, WP3 / WP7)
      const want = islandRigs(pe), got = new Map(b.loaderRigs.map((r) => [r.record, r.rig]));
      let diff = 0;
      for (const [r, n] of want) if (got.get(r) !== n) { diff++; failures.push(`island rig of record ${r}: static ${n}, emulated ${got.get(r)}`); }
      ok(diff === 0 && got.size === want.size, `island loaderRigs ${got.size} vs islandRigs ${want.size}`);
      checked += want.size;
      const clips = {}; for (const r of b.loaderRigs) clips[r.clip] = (clips[r.clip] ?? 0) + 1;
      ok(b.loaderRigs.every((r) => r.clip >= 0), `island loaderRigs: every record starts a clip (${JSON.stringify(clips)})`);
      ok(a.loaderRigs.length === 0 && a.soundHandles.length === 0, 'island default: no loaderRigs, no sound tokens');
      const p = profileFor('z02LGI', pe, scene, undefined, { islandVars: varsOf({ 0x58: 2, 2: 1 }), archive });
      ok(p.island === p.emu && p.island.attaches.length === 272 && p.setup.subgame === 2 && p.setup.variants.join() === '31,32,33', `profileFor islandVars: island === emu, subgame ${p.setup.subgame} variants ${p.setup.variants}`);
      const q = profileFor('z02LGI', pe, scene, undefined, { emuVars: varsOf({ 0x58: 2, 2: 1 }), archive });
      ok(q.emu.attaches.length === 272, 'profileFor emuVars on the island');
    }

    // ---- (b) the hubs: oracle, counts, unhooked
    let slowest = 0;
    for (const [zone, h] of Object.entries(HUBS)) {
      const scene = sceneOf(ctx, zone), archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
      const code = zoneCodeIndex(pe).get(zone.toLowerCase());
      const entry = readZoneTable(pe).find((t) => t.run >= code.lo && t.run < code.hi);
      ok(entry?.index === h.index && entry.kind === 1, `${zone}: zone table entry ${entry?.index}`);
      const oracle = extractZoneSetup(pe, zone, scene);
      for (const node of h.nodes) {
        const t0 = performance.now();
        let s;
        try { s = emuOf(ctx, pe, zone, varsOf({ 0x58: node, 2: 1 })); } catch (e) { failures.push(`${zone} node ${node}: emulation failed: ${e.stack || e}`); continue; }
        slowest = Math.max(slowest, performance.now() - t0);
        ok(s.attaches.length === ATTACHES[zone][node], `${zone} node ${node}: ${s.attaches.length} attaches (expected ${ATTACHES[zone][node]})`);
        ok(s.unhooked.length === 0, `${zone} node ${node}: engine functions without a host entry: ${s.unhooked.map((u) => `0x${u.fn.toString(16)} x${u.count} from ${u.callers.map((c) => c.toString(16))}`).join(', ')}`);
        ok(s.attaches.every((a) => a.record >= 0 && a.record < scene.records.length && a.args.length === 0x80), `${zone} node ${node}: attaches on real records with argument blocks`);
        const r = compareOracle(oracle, s, scene, node);
        checked += r.checked;
        for (const f of r.failures.slice(0, 5)) failures.push(`${zone}: ${f}`);
        const zs = s.toZoneSetup();
        ok(zs.subgame === h.index && zs.variants.length === 0 && zs.zone === zone && zs.attaches.length === s.attaches.length, `${zone} node ${node}: toZoneSetup (subgame ${zs.subgame})`);
      }
      for (const node of SAMPLE_NODES) {
        let s;
        try { s = emuOf(ctx, pe, zone, varsOf({ 0x58: node, 2: 1 })); } catch (e) { failures.push(`${zone} sample node ${node}: emulation failed: ${String(e.message).slice(0, 200)}`); continue; }
        ok(s.unhooked.length === 0 && s.attaches.length > 0, `${zone} sample node ${node}: unhooked ${s.unhooked.length}, ${s.attaches.length} attaches`);
      }
    }
    ok(slowest < 1500, `slowest hub emulation ${slowest.toFixed(0)} ms`);
    notes.push(`slowest hub emulation ${slowest.toFixed(0)} ms`);

    // ---- (c) the data the hub workers need
    const emu = (zone, node, extra = {}) => emuOf(ctx, pe, zone, varsOf({ 0x58: node, 2: 1, ...extra }));
    {
      const s = emu('z07CSI', 15);
      ok(s.dictionaries.anims.size === 246 && s.dictionaries.anims.get('PEP_JUMPINAIR') === 1, `CSI animation dictionary (${s.dictionaries.anims.size})`);
      ok(s.dictionaries.switches.size === 70 && s.dictionaries.switches.get('SWITCH_CSI_MOVE_BSD2') === 250, `CSI switch dictionary (${s.dictionaries.switches.size})`);
      ok(s.waypointMaps.map((m) => m.index).join() === '1,2' && s.cutsceneSlots.join() === '1' && s.cutscenes.map((c) => c.name).join() === 'csi01', 'CSI waypoint maps / cutscene slots');
      ok(s.storyHandler.length === 4 && s.storyHandler.every((c) => c.story), `CSI: the set-up's story-handler call is logged (${s.storyHandler.length} calls)`);
      const rigs = new Map(s.loaderRigs.map((r) => [r.record, r.rig]));
      ok(rigs.get(7) === 'MFIG' && rigs.get(8) === 'LFLG' && rigs.get(48) === 'HORS' && rigs.get(71) === 'CATP', 'CSI loader rigs (PEPP = MFIG clip 76, LFLG, HORS, CATP)');
      ok(s.loaderRigs.find((r) => r.record === 7)?.clip === 76, 'CSI: Pepper starts clip 76');
      const music = s.soundHandles.find((h) => h.kind === 'music');
      ok(music?.name === 'Z07CSI' && music.addr === 0x5d5888c, 'CSI music handle (DAT_05d5888c = FUN_00443290("Z07CSI"))');
      ok(s.soundHandles.some((h) => h.kind === 'sfx3d' && h.id === 738) && s.soundHandles.length > 30, `CSI sound handles of the wrapper's FUN_00572ef0 (${s.soundHandles.length})`);
      const a = emulatedArrival(s);
      ok(s.records[a.vehicle]?.name === 'SPBT' && a.control === 8 && Math.abs(a.pos[0] + 377.49) < 0.05 && Math.abs(a.pos[1] - 1.508) < 0.01, `CSI arrival by boat: vehicle ${a.vehicle}, control ${a.control}, pos ${a.pos}`);
      const b = emulatedArrival(emu('z07CSI', 15, { 0xa3: 7 }));
      ok(b.vehicle < 0 && b.control === 1 && Math.abs(b.pos[0] - 228.6) < 0.1, `CSI arrival from z08BKD (zone 7): walking at ${b.pos}`);
      const c = emulatedArrival(emu('z07CSI', 15, { 0xa3: 8 }));
      ok(c.control === 16, 'CSI arrival from z09JST (zone 8): control 0x10');
    }
    {
      const s = emu('z13CAI', 33), a = emulatedArrival(s);
      ok(s.records[a.vehicle]?.name === 'PHEL' && a.control === 8, `CAI arrival: helicopter (${s.records[a.vehicle]?.name}, control ${a.control})`);
      ok(emulatedArrival(emu('z13CAI', 33, { 0xa3: 11 })).pos[0] > 800, 'CAI arrival from the Oasis (zone 11): a different place');
      ok(s.dictionaries.anims.size === 154 && s.dictionaries.anims.has('PTER_PTER_FLAPPING') && s.soundHandles.some((h) => h.kind === 'music' && h.name === 'ad2'), 'CAI dictionary / music');
    }
    {
      const s = emu('z14OSD', 34);
      ok(s.cutscenes.map((c) => `${c.slot}:${c.name}:${c.area}`).join() === '0:ADV01:ai,1:ADV05:ai' && s.cutsceneSlots.join() === '2', 'OSD cutscenes');
      ok(emulatedArrival(emu('z14OSD', 34, { 0xa3: 10 })).pos[0] < -300, 'OSD arrival from zone 10 (PREV_SUBGAME read by FUN_006290ea)');
      ok(s.boxes.length > 1300 && s.modes.length > 600, `OSD boxes / render modes (${s.boxes.length} / ${s.modes.length})`);
    }
    {
      const s = emu('z40OGL', 64);
      ok(s.dictionaries.switches.size === 59 && s.dictionaries.switches.get('SWITCH_OGL_AT_OGEL_PIZZERIA') === 256 && s.dictionaries.anims.size === 228, 'OGL dictionaries');
      ok(s.soundHandles.length >= 45 && s.soundHandles[0].addr === 0x5d5f308 && s.soundHandles[0].id === 817, 'OGL sound handles (FUN_007e3350)');
      ok(s.cutscenes.map((c) => c.name).join() === 'OGL01,OGL03,OGL04', 'OGL cutscenes');
      ok(s.attaches.filter((a) => a.ctorName === 'Overlay').every((a) => a.mask !== 0), 'OGL Overlay gates (mask = shifted local)');
    }
    for (const [zone, n] of [['z16PYA', 36], ['z23DIP', 47]]) {
      const s = emu(zone, n);
      ok(s.loaderRigs.length > 10 && s.dictionaries.anims.size > 150, `${zone}: loader rigs ${s.loaderRigs.length}, dictionary ${s.dictionaries.anims.size}`);
    }

    // ---- (c2) `run`: a function of the original called in the emulated machine after the set-up (the oracle for the hub ports' tests): the castle's story handler
    {
      const s = emu('z07CSI', 17);
      const pNext = s.alloc(8), pPrev = s.alloc(8);
      s.mem.w32(pPrev, 17);
      s.setVar(0x58, 19);
      const r = s.run(0x574e40, [pNext, pPrev, 19]);
      ok(r.eax === 1 && s.mem.u32(pPrev) === 19 && r.calls.every((c) => c.story), `run FUN_00574e40(&next, &prev, 19): eax ${r.eax}, prev ${s.mem.u32(pPrev)}`);
      ok(r.calls.map((c) => c.name).join() === 'textFileFree,textFile2Free,hintTarget,textFile,textFile2', `run: the handler's calls (${r.calls.map((c) => c.name)})`);
      ok(r.calls[2].info.record >= 0 && r.calls[2].args[0] >= 0x10000000, 'run: the objective arrow at a record (hintTarget with a record pointer)');
      const t = r.calls.find((c) => c.name === 'textFile');
      ok(typeof t.info.file === 'string' && /\.str$/i.test(t.info.file), `run: text file ${t.info.file}`);
      // the same call again with the node it already handled changes nothing observable (still returns 1)
      ok(s.run(0x574e40, [pNext, pPrev, 19]).eax === 1, 'run: second call');
    }

    // ---- (d) profileFor emuVars + setupZone
    for (const [zone, h] of Object.entries(HUBS)) {
      const node = h.nodes[0];
      const scene = sceneOf(ctx, zone), archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
      const vars = varsOf({ 0x58: node, 2: 1 });
      const p = profileFor(zone, pe, scene, undefined, { emuVars: vars, archive });
      ok(!!p.emu && !p.island && p.hub === true && p.subgame === h.index && p.setup.attaches.length === p.emu.attaches.length, `${zone}: profileFor emuVars (subgame ${p.subgame}, hub ${p.hub})`);
      const L = setupZone(scene, archive, p, { vars: { 0x58: node }, pe, subgame: h.index });
      ok(L.hasPlayer && L.pepper.name === 'PEPP' && [L.pepper.x, L.pepper.y, L.pepper.z].every(Number.isFinite), `${zone}: setupZone player`);
      const e = p.emu.records[L.pepper.index];
      ok(Math.abs(L.pepper.x - e.pos[0]) < 1e-3 && Math.abs(L.pepper.z - e.pos[2]) < 1e-3, `${zone}: Pepper's place = the emulated record (${L.pepper.x.toFixed(1)}, ${L.pepper.z.toFixed(1)} vs ${e.pos[0].toFixed(1)}, ${e.pos[2].toFixed(1)})`);
      for (let i = 0; i < 20; i++) L.world.tick();
      ok([L.pepper.x, L.pepper.y, L.pepper.z].every(Number.isFinite), `${zone}: 20 ticks`);
      const def = profileFor(zone, pe, scene);
      ok(!def.emu && def.setup.attaches.length > 0, `${zone}: profileFor without emuVars = the symbolic extraction`);
    }

    // ---- (e) the terrain host: CSI node 22 puts Pepper on the ground (FUN_0057a6b6: FUN_0043cd62(&pos, 16))
    {
      const zone = 'z07CSI', scene = sceneOf(ctx, zone), archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z07csi');
      const s = emu(zone, 22, { 0xa3: 7 });   // arriving from a mini-game: walking (from the island Pepper arrives by boat and the boat code runs after it)
      const call = s.calls.find((c) => c.name === 'terrainHeight');
      ok(!!call && call.info.ground >= 0 && typeof call.info.height === 'number' && Number.isFinite(call.info.height), `CSI node 22: terrainHeight called with a ground record (${JSON.stringify(call?.info)})`);
      const cw = new CollisionWorld();
      cw.records = buildRecords(zone, scene, archive).records;
      cw.groundRec = cw.records[call.info.ground];
      const [x, y, z] = call.info.pos;
      ok(Math.abs(cw.terrainHeight(x, y, z, call.info.dy) - call.info.height) < 1e-3, 'terrainHeight = the port ground ray');
      const pep = s.records.findIndex((r) => r.name === 'PEPP');
      const st = s.stores.find((x) => x.record === pep && x.field === 0x40 && x.at > call.at && x.fn === call.caller);   // `*(rec + 0x318) = (float) FUN_0043cd62(...)` right after the call
      const f = new DataView(new ArrayBuffer(4)); f.setUint32(0, st?.value ?? 0, true);
      ok(!!st && Math.abs(f.getFloat32(0, true) - call.info.height) < 1e-3, `Pepper's y store after the call = the terrain height (${f.getFloat32(0, true)} vs ${call.info.height})`);
    }
    return { checked, failures, notes };
  },
};
