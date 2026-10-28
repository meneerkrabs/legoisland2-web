import { interpret } from '../../src/formats/x86.ts';
import { extractZoneSetup, zoneCodeIndex, readZoneTable, activeEntries, hiddenRecords, nameOfEntry, ctorName, ZONE_ARCHIVES, FN, GLOBALS } from '../../src/formats/zonesetup.ts';
import { PROFILES, registerCtor, unregisterCtor, ctorFactory, CTOR } from '../../src/game/setup.ts';
import { loadExe, loadZone, sceneOf } from '../lib/engine-load.mjs';

// Zone set-up extracted from the executable (docs/re/zone-setup.md): per-zone counts, spot checks against the decompile (LE2.c = the Ghidra decompile in
// basdebeer-tools/decomp-le2, line numbers in the comments), the equality with the hand-written M1 profiles of z02LGI / z03PPH, the time bound, the
// interpreter extensions on a synthetic function, and the stub requirement: every one of the 30 zones loads and the player walks 300 ticks without
// exceptions / NaN.

/** per zone: [attaches, boxes, hide writes, render modes, cutscene slots, HUD hints] (the table of docs/re/zone-setup.md 4) */
const COUNTS = {
  z01BPK: [3, 0, 1, 0, 0, 0], z02LGI: [183, 16, 449, 13, 62, 6], z03PPH: [31, 0, 0, 30, 0, 0], z04IFC: [47, 0, 0, 17, 0, 0], z05WAB: [2, 0, 0, 0, 0, 0],
  z07CSI: [311, 10, 47, 5, 10, 4], z08BKD: [36, 0, 9, 1, 0, 0], z09JST: [19, 0, 0, 0, 0, 0], z10RGB: [17, 4, 1, 0, 0, 0], z13CAI: [13, 0, 1, 2, 0, 0],
  z14OSD: [54, 9, 11, 4, 2, 4], z15SSH: [5, 0, 0, 0, 0, 0], z16PYA: [35, 5, 15, 1, 2, 4], z17WAS: [2, 0, 1, 0, 0, 0], z18MMP: [41, 0, 33, 0, 0, 0],
  z20DSP: [27, 0, 2, 21, 0, 0], z21FSH: [11, 1, 2, 3, 2, 0], z22BIP: [39, 0, 0, 0, 0, 0], z23DIP: [124, 8, 35, 1, 2, 4], z27TRX: [6, 0, 0, 8, 0, 0],
  z28HAT: [23, 0, 8, 1, 2, 0], z36CNT: [2, 0, 0, 0, 0, 0], z38PAR: [8, 0, 0, 0, 0, 0], z39ASB: [1, 0, 0, 1, 0, 0], z40aPO: [6, 1, 6, 5, 1, 0],
  z40OGL: [97, 0, 11, 3, 3, 4], z41MAP: [11, 0, 0, 0, 0, 0], z42BRP: [9, 0, 0, 0, 1, 0], z50LTC: [4, 1, 1, 0, 0, 0], z60FRE: [11, 0, 0, 4, 0, 0],
};
/** zones without a record named PEPP (the shell flies a camera there) */
const NO_PLAYER = ['z09JST', 'z39ASB'];

const f32 = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };

export default {
  name: 'zonesetup',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const starts = pe.functionStarts();

    // --- the interpreter extensions on a synthetic function: 16-bit flag read-modify-write, a guarded call, a record loop
    {
      const base = 0x401000;
      const code = [
        0x8b, 0x0d, 0x04, 0x38, 0x98, 0x00,                     // mov ecx, [0x983804]
        0x66, 0x8b, 0x91, 0x28, 0x40, 0x00, 0x00,               // mov dx, [ecx + 0x4028]
        0x80, 0xe2, 0xfd,                                       // and dl, 0xfd
        0xa1, 0x04, 0x38, 0x98, 0x00,                           // mov eax, [0x983804]
        0x66, 0x89, 0x90, 0x28, 0x40, 0x00, 0x00,               // mov [eax + 0x4028], dx
        0x83, 0x3d, 0x00, 0x30, 0x90, 0x00, 0x05,               // cmp dword [0x903000], 5
        0x7d, 0x07,                                             // jge +7  (skips the push + call)
        0x6a, 0x01,                                             // push 1
        0xe8, 0x00, 0x00, 0x00, 0x00,                           // call next (target = base + 0x2b)
        0x83, 0xc4, 0x04,                                       // add esp, 4
        0xc3,
      ];
      const img = { at: (va) => (va >= base && va < base + code.length ? code[va - base] : undefined), slice: (va, n) => (va >= base && va < base + code.length ? Uint8Array.from([...code.slice(va - base, va - base + n + 16), ...new Array(16).fill(0)]) : null) };
      const evs = interpret(img, base, base + code.length, {});
      const st = evs.find((e) => e.type === 'store');
      ok(st && st.size === 2 && st.off === 0x4028 && st.rmw && st.rmw.op === 'and' && st.rmw.imm === 0xfffd && st.base.k === 'glob' && st.base.a === 0x983804, `interpreter: 16-bit read-modify-write: ${JSON.stringify(st)}`);
      const call = evs.find((e) => e.type === 'call');
      const g = call?.guards?.[0];
      ok(call && call.guards.length === 1 && g.cc === 0xd && g.taken === false && g.lhs.k === 'glob' && g.lhs.a === 0x903000 && g.rhs.k === 'imm' && g.rhs.v === 5, `interpreter: guard of a call: ${JSON.stringify(call?.guards)}`);
      const plain = interpret(img, base, base + code.length);
      ok(plain.length === 2 && !plain.some((e) => e.guards || e.rmw), 'interpreter without options: no guards / rmw (legacy behaviour)');
    }

    // --- extraction of all 30 zones: counts, time
    const index = zoneCodeIndex(pe, starts);
    ok(index.size === 30, `zone index has ${index.size} zones`);
    const table = readZoneTable(pe);
    ok(table.length === 35 && table[2].name === 'z90PSX' && table[3].name === 'z03PPH' && table[34].name === 'z50LTC', 'zone table (0x89a9c0)');
    const S = {};
    let slowest = 0, slowZone = '';
    for (const zone of ZONE_ARCHIVES) {
      const t0 = performance.now();
      let s;
      try { s = extractZoneSetup(pe, zone, undefined, starts); } catch (e) { failures.push(`${zone}: extraction failed: ${e.stack || e}`); continue; }
      const dt = performance.now() - t0;
      if (dt > slowest) { slowest = dt; slowZone = zone; }
      S[zone] = s;
      checked++;
      const got = [s.attaches.length, s.boxes.length, s.hide.length, s.modes.length, s.cutscenes.length, s.hudHints.length];
      if (JSON.stringify(got) !== JSON.stringify(COUNTS[zone])) failures.push(`${zone}: counts [attaches, boxes, hide, modes, cutscenes, hud] ${got} != ${COUNTS[zone]}`);
      if (dt > 300) failures.push(`${zone}: extraction took ${dt.toFixed(0)} ms (> 300)`);
      // structural sanity: the entries carry the address of their call / store and sit inside the zone's code region
      const [lo, hi] = s.region;
      for (const k of ['attaches', 'boxes', 'modes', 'cutscenes', 'hudHints', 'flagWrites']) for (const e of s[k]) {
        if (!(e.fn >= lo && e.fn < hi)) { failures.push(`${zone}: ${k} entry at ${e.at.toString(16)} in function ${e.fn.toString(16)} outside the region`); break; }
      }
      // a record that is not constant only in record loops (restricted by a name test the interpreter may not have understood: byte compares)
      for (const a of s.attaches) if (!(a.ctor >= 0x400000 && a.ctor < 0x900000) || (a.record < 0 && !a.loop)) { failures.push(`${zone}: attach at ${a.at.toString(16)} ctor ${a.ctor.toString(16)} record ${a.record}`); break; }
      // records exist in the scene
      const scene = sceneOf(ctx, zone);
      for (const a of s.attaches) if (a.record >= scene.records.length) { failures.push(`${zone}: attach at ${a.at.toString(16)} on record ${a.record} of ${scene.records.length}`); break; }
      if (s.focusRecord !== null && s.focusRecord >= scene.records.length) failures.push(`${zone}: focus record ${s.focusRecord} of ${scene.records.length}`);
    }
    notes.push(`extraction: slowest ${slowZone} ${slowest.toFixed(0)} ms (limit 300); zone index + zone table read once`);

    const L = S.z02LGI, P = S.z03PPH;
    if (L && P) {
      const at = (s, a) => s.attaches.find((x) => x.at === a);
      // --- FUN_004b4220 (LE2.c:75528): the player's node chain, PEPP = record 0x680 / 0x68 = 16
      const chain = [[0x4b427d, 0x4bc773, 0, 0, 0, 'Music'], [0x4b42a1, 0x4bbef8, 1, 0x5e, 0, 'PepSwitc'] /* LE2.c:75538 */, [0x4b42c5, 0x42f470, 2, 0x5e, 1, 'SGwalk'] /* :75539 */,
        [0x4b42e7, 0x88cf13, 3, 0x5e, 2, 'sgswim'], [0x4b430b, 0x43310c, 4, 0x5e, 4, null], [0x4b432f, 0x4333c2, 5, 0x5e, 8, 'SGVehic'], [0x4b4365, 0x4bb582, 6, 0x5e, 0x40, 'Ptera']];
      for (const [a, ctor, pos, v, mask, name] of chain) {
        const e = at(L, a);
        ok(e && e.record === 16 && e.fn === 0x4b4220 && e.ctor === ctor && e.pos === pos && (e.var === 0x5e) && e.mask === (mask === 0 ? 0 : mask) && e.value === (mask === 0 ? 0 : mask) && e.ctorName === name, `z02LGI attach at ${a.toString(16)}: ${JSON.stringify(e && { ...e, cond: undefined })}`);
      }
      // the era the chain belongs to: FUN_004b6475 branches on game var 0x58 (LE2.c:76207 `if (local_c < 7)` ...); FUN_004b4220 is reached from each era's set
      const eraCond = (e, op, val) => e.cond.some((c) => c.src === 'var' && c.id === 0x58 && c.op === op && c.value === val);
      ok(eraCond(at(L, 0x4b42a1), '<=', 6), 'z02LGI: the chain reached in era 0 is tagged var 0x58 <= 6 (`local_c < 7`)');
      // the five era arms of FUN_004b6475 (LE2.c:76207..): < 7, < 0x1e, < 0x34, < 0x3d, else
      const eras = new Set(L.attaches.filter((x) => x.fn === 0x4b4220 && x.record === 16 && x.pos === 2).map((x) => x.cond.map((c) => c.op + c.value).join('&')));
      ok(['<=6', '>=7&<=29', '>=30&<=51', '>=52&<=60', '>=61'].every((e) => eras.has(e)) && eras.size === 5, `z02LGI: the five story-state arms reach the player chain: ${[...eras]}`);
      // the Ptera of record 66 only exists from story state 0x34 (LE2.c:75552: `if (iVar1 < 0x34) hide else attach`)
      const ptera = L.attaches.filter((x) => x.at === 0x4b43de);
      ok(ptera.length > 0 && ptera.every((x) => x.record === 66 && x.ctor === 0x4bb1a6 && x.var === 0xb6 && x.cond.some((c) => c.src === 'var' && c.id === 0x58 && c.op === '>=' && c.value >= 0x34)), `z02LGI: Ptera attach (record 66) is conditional on var 0x58 >= 0x34 (the eras from there on): ${ptera.length}`);
      const v0 = (v) => 0;
      ok(!activeEntries(L.attaches, v0).some((x) => x.at === 0x4b43de), 'z02LGI era 0: no Ptera attach');
      ok(activeEntries(L.attaches, (v) => (v === 0x58 ? 0x35 : 0)).some((x) => x.at === 0x4b43de), 'z02LGI story state 0x35: Ptera attach active');
      // PEPP flags (LE2.c:75597 / :75598): `flags &= 0xffbf; flags |= 0x10` on record 16
      ok(L.flagWrites.some((f) => f.record === 16 && f.op === 'and' && f.mask === 0xffbf && f.fn === 0x4b4220) && L.flagWrites.some((f) => f.record === 16 && f.op === 'or' && f.mask === 0x10 && f.fn === 0x4b4220), 'z02LGI: PEPP flags &= ~0x40, |= 0x10 (FUN_004b4220)');
      // globals: sea level (LE2.c:76097 = 0x4019999a), gravity (:75604 = 0xc1200000), accessory (:75595), camera focus, ground (:76200)
      ok(L.seaLevel === f32(0x4019999a), `z02LGI sea level ${L.seaLevel}`);
      ok(L.gravity === -10, `z02LGI gravity ${L.gravity}`);
      ok(L.accessoryRecord === 9, `z02LGI accessory ${L.accessoryRecord}`);
      ok(L.focusRecord === 16, `z02LGI focus ${L.focusRecord}`);
      ok(L.groundRecord === 4 && L.groundName === null, `z02LGI ground record ${L.groundRecord}`);
      ok(L.subgame === 2 && L.variants.join() === '31,32,33', `z02LGI subgame ${L.subgame} variants ${L.variants}`);
      // box colliders (LE2.c:76100-76151)
      const byName = (n) => L.boxes.find((b) => b.record === -1 && nameOfEntry(b) === n);
      ok(byName('ROCK')?.kind === 'file' && byName('TREE')?.kind === 'radiusHeight' && byName('TREE').dims.join() === '4,16' && byName('OAKS').dims[0] === f32(0x3fcccccd) && byName('PALM').dims[1] === 16 && byName('GAR3')?.kind === 'file' && byName('PLAT')?.kind === 'file' && byName('CTRL')?.kind === 'file', 'z02LGI name-based box loop');
      const box165 = L.boxes.find((b) => b.record === 165), box111 = L.boxes.find((b) => b.record === 111);
      ok(box165 && box165.kind === 'dims' && box165.dims.join() === '4,8,4', `z02LGI box 165: ${JSON.stringify(box165)}`);
      ok(box111 && box111.kind === 'radiusHeight' && box111.dims[0] === f32(0x402a7efa) && box111.dims[1] === 16, `z02LGI box 111 (0x2d18 / 0x68, LE2.c:76151): ${JSON.stringify(box111)}`);
      // render mode (LE2.c:76150) and HUD hints (:76201..76206)
      const m = L.modes.find((x) => x.record === 0x9448 / 0x68);
      ok(m && m.partMask === 0xff && m.mode === 5, `z02LGI render mode of record ${0x9448 / 0x68}: ${JSON.stringify(m)}`);
      const h = L.hudHints;
      ok(h.length === 6 && h[0].index === 0 && h[0].a === 0x71 && h[0].b === 0x79 && h[0].c === 0x82 && h[0].d === 0x81 && h[5].index === 5 && h[5].c === 0x9c && h[0].scale === f32(0x3d03126f), `z02LGI HUD hints ${JSON.stringify(h.map((x) => [x.index, x.a, x.b, x.c, x.d]))}`);
      // the start place: FUN_004c0750 (LE2.c:80746) puts PEPP at node 0xf6 of waypoint map 1 (W_PATH) in the first story states (:80773)
      const place = L.places.find((p) => p.at === 0x4c07e8);
      ok(place && place.record === 16 && place.field === 0x3c && place.map === 1 && place.node === 0xf6 && eraCond(place, '<=', 3), `z02LGI start place: ${JSON.stringify(place && { ...place, cond: undefined })}`);
      ok(L.waypointMaps.some((w) => w.index === 1 && w.path.endsWith('W_PATH')), 'z02LGI waypoint maps loaded (W_PATH = map 1)');
      // the boats float at the sea level: `rec + 0x40 = DAT_009da858` (LE2.c:76142..)
      ok([163, 164, 171].every((r) => L.fieldWrites.some((f) => f.record === r && f.field === 0x40 && f.ref === GLOBALS.SEA_LEVEL)), 'z02LGI boats y = sea level');
      // fog: the set-up's own FUN_00442d90 call
      ok(L.fogCalls.length >= 1 && L.fogCalls[0].farMax !== undefined, 'z02LGI fog call extracted');
      // --- FUN_0053ea4d (LE2.c:94840): Pepper's house, PEPP = record 0xd68 / 0x68 = 33
      const pph = [[0x5421af, 0, 0, 0, 'ClimLadr'], [0x42f470, 1, 1, 1, 'SGwalk'], [0x5400d5, 2, 4, 4, 'PeppComp'], [0x541b79, 3, 2, 2, 'Trophy'], [0x541f94, 4, 0x20, 0x20, 'Trophy']];
      const mine = P.attaches.filter((a) => a.record === 33);
      ok(mine.length === 5 && pph.every(([ctor, pos, mask, value, name], i) => mine[i].ctor === ctor && mine[i].pos === pos && mine[i].var === 0x5e && mine[i].mask === mask && mine[i].value === value && mine[i].ctorName === name && mine[i].cond.length === 0), `z03PPH player chain (LE2.c:94860-94864): ${mine.map((a) => a.ctorName + '@' + a.pos)}`);
      const trophy = P.attaches.filter((a) => a.ctor === 0x54116c);
      ok(trophy.length > 5 && trophy[0].record === 18 && trophy[0].argWords?.slice(0, 3).join() === '64,32,1', `z03PPH trophy attach (LE2.c:94877): ${JSON.stringify(trophy[0] && { ...trophy[0], cond: undefined })}`);
      ok(P.focusRecord === 33 && P.seaLevel === null && P.gravity === null && P.groundRecord === null && P.subgame === 3, 'z03PPH: focus 33 (LE2.c:94868), no sea / gravity / ground stores');
      ok(P.modes.some((x) => x.record === 33 && x.partMask === 0xff && x.mode === 1), 'z03PPH render mode of PEPP (LE2.c:94865)');
      // other zones' globals: z40OGL gravity -7 / sea -96 / skateboard slot 0x1d (LE2.c:245676-245679), z16PYA sea -400 (:158329), z23DIP sea -80 (:204906)
      ok(S.z40OGL.gravity === f32(0xc0e00000) && S.z40OGL.seaLevel === -96 && S.z40OGL.accessoryRecord === 0x1d, `z40OGL gravity ${S.z40OGL.gravity} sea ${S.z40OGL.seaLevel} accessory ${S.z40OGL.accessoryRecord}`);
      ok(S.z16PYA.seaLevel === -400 && S.z16PYA.gravity === -10 && S.z23DIP.seaLevel === -80, 'z16PYA sea -400, z23DIP sea -80');
      ok(S.z07CSI.seaLevel === 0 && S.z07CSI.accessoryRecord === 0x44, `z07CSI sea ${S.z07CSI.seaLevel} accessory ${S.z07CSI.accessoryRecord} (0x44 at 0x573...)`);
      // table subgame ids
      const sub = Object.fromEntries(Object.entries(S).map(([z, s]) => [z, s.subgame]));
      ok(sub.z60FRE === 0 && sub.z01BPK === 1 && sub.z04IFC === 4 && sub.z05WAB === 5 && sub.z07CSI === 6 && sub.z17WAS === 14 && sub.z21FSH === 17 && sub.z38PAR === 25 && sub.z40aPO === 30 && sub.z40OGL === 27 && sub.z50LTC === 34, `subgame ids from the zone table: ${JSON.stringify(sub)}`);
      // constructor names come from the source file strings
      ok(ctorName(pe, 0x4bbef8) === 'PepSwitc' && ctorName(pe, 0x42f470) === 'SGwalk' && ctorName(pe, 0x88cf13) === 'sgswim', 'constructor names');
      // every zone with a PEPP record: the camera focus is that record
      let focusOk = 0;
      for (const [zone, s] of Object.entries(S)) {
        const scene = sceneOf(ctx, zone);
        const pepp = scene.records.findIndex((r) => r.name === 'PEPP');
        if (NO_PLAYER.includes(zone)) { ok(pepp < 0, `${zone}: expected no PEPP record`); continue; }
        ok(pepp >= 0, `${zone}: no PEPP record`);
        if (s.focusRecord !== null) { ok(s.focusRecord === pepp, `${zone}: focus record ${s.focusRecord} is not PEPP (${pepp})`); focusOk++; }
      }
      notes.push(`camera focus (DAT_009da5d8) = the PEPP record in ${focusOk} zones (z09JST / z39ASB have no PEPP; the others never store the focus in the set-up)`);
    }

    // --- M1 profiles (reference) against the extraction: z02LGI and z03PPH
    for (const zone of ['z02LGI', 'z03PPH']) {
      const A = loadZone(ctx, zone, { reference: true }), B = loadZone(ctx, zone);
      const wa = A.world, wb = B.world;
      ok(wa.records.length === wb.records.length, `${zone}: record count`);
      // (the executable stores the float 0x4019999a = 2.4000000953674316; M1 wrote 2.4)
      ok(Math.abs(wa.seaLevel - wb.seaLevel) < 1e-6 && wa.gravity === wb.gravity && wa.hub === wb.hub, `${zone}: sea level ${wa.seaLevel}/${wb.seaLevel}, gravity ${wa.gravity}/${wb.gravity}, hub ${wa.hub}/${wb.hub}`);
      ok((wa.col.groundRec?.index ?? -1) === (wb.col.groundRec?.index ?? -1), `${zone}: ground record ${wa.col.groundRec?.index} / ${wb.col.groundRec?.index}`);
      ok(wa.vars.get(0x59) === wb.vars.get(0x59), `${zone}: CURRENT_SUBGAME`);
      // M1 modelled: the hide list, the box colliders, some positions (umbrellas, boats), PEPP's flags. The extraction also applies what the era-0 set does
      // (FUN_00523200 -> FUN_0052bc9b ...: `flags |= 0x10` on more records) and more record positions (FUN_004b4907: sea-level y of record 67, houses 128 / 154):
      // those are the allowed differences.
      const diffs = [], extra = [];
      for (let i = 0; i < wa.records.length; i++) {
        const a = wa.records[i], b = wb.records[i];
        const ca = a.colObj, cb = b.colObj;
        const fx = (a.flags ^ b.flags) & 0xffff;
        if (fx & ~0x10) diffs.push(`#${i} ${a.name} flags ${(a.flags & 0xffff).toString(16)} / ${(b.flags & 0xffff).toString(16)}`);
        else if (fx) extra.push(`#${i}:${a.name}`);
        const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), dz = Math.abs(a.z - b.z);
        const moved = dx + dy + dz > 3e-4;
        if (moved && !S[zone].fieldWrites.some((f) => f.record === i && (f.field === 0x3c || f.field === 0x40 || f.field === 0x44))) diffs.push(`#${i} ${a.name} position ${[a.x, a.y, a.z]} / ${[b.x, b.y, b.z]}`);
        else if (moved) extra.push(`#${i}:${a.name} pos`);
        if ((ca?.shape ?? -1) !== (cb?.shape ?? -1) || (ca && cb && (ca.box.some((v, k) => Math.abs(v - cb.box[k]) > 5e-3) || Math.abs(ca.radius - cb.radius) > 5e-3))) diffs.push(`#${i} ${a.name} collider ${ca?.shape} ${ca?.box} / ${cb?.shape} ${cb?.box}`);
      }
      ok(diffs.length === 0, `${zone}: extraction differs from the M1 profile in ${diffs.length} records: ${diffs.slice(0, 6).join('; ')}`);
      if (extra.length) notes.push(`${zone}: the extraction also changes ${extra.length} records M1 left alone (flag 0x10 / position writes): ${extra.join(' ')}`);
      const kinds = (L2) => L2.pepper.ctrl.nodes.filter((n) => n.kind !== 'StubGuard').map((n) => `${n.kind}[${n.var.toString(16)}&${n.mask}=${n.value}]`).join(' ');
      if (zone === 'z02LGI') ok(kinds(A) === kinds(B), `${zone}: player chain ${kinds(A)} / ${kinds(B)}`);
      else {
        // the real house has only SGwalk (+ the ladder, computer and trophy nodes): M1 gave it PepSwitc and sgswim as well
        ok(kinds(B) === 'SGwalk[5e&1=1]', `${zone}: extracted player chain ${kinds(B)}`);
        notes.push(`${zone}: M1 reference chain ${kinds(A)} vs extracted ${kinds(B)} (PepSwitc / sgswim do not exist in the house)`);
      }
      ok(A.walk.accessory === B.walk.accessory || (A.walk.accessory?.index ?? -1) === (B.walk.accessory?.index ?? -1), `${zone}: accessory record`);
      ok(Math.abs(A.pepper.x - B.pepper.x) + Math.abs(A.pepper.y - B.pepper.y) + Math.abs(A.pepper.z - B.pepper.z) < 1e-4 && A.pepper.ry === B.pepper.ry, `${zone}: start place`);
      // visibility: records hidden by the set-up at story state 0 (hide(), era 0)
      const hidA = wa.records.filter((r) => !r.enabled).map((r) => r.index).join(), hidB = wb.records.filter((r) => !r.enabled).map((r) => r.index).join();
      ok(hidA === hidB, `${zone}: hidden records differ`);
      notes.push(`${zone}: ${wb.records.filter((r) => !r.enabled).length} records hidden, ${B.skipped.length} attaches skipped (constructors not ported)`);
    }
    // the hide list of the extraction (era 0) is a superset of the hand-written one; the difference are the records the era sets / FUN_004b4907 / FUN_004b7040 hide
    {
      const scene = sceneOf(ctx, 'z02LGI');
      const names = scene.records.map((r) => r.name);
      const h = new Set(hiddenRecords(S.z02LGI, () => 0, names));
      const m1 = PROFILES.z02LGI.hide;
      ok(m1.every((i) => h.has(i)), 'z02LGI: every hide of the M1 list is in the extraction');
      ok([...h].every((i) => m1.includes(i) || i === 367 || i === 369), `z02LGI: extracted hides outside the reference list: ${[...h].filter((i) => !m1.includes(i))}`);
      // the story state changes it (FUN_004b4220: `if (iVar1 < 0x34) hide record 66`)
      const h2 = new Set(hiddenRecords(S.z02LGI, (v) => (v === 0x58 ? 0x34 : 0), names));
      ok(h.has(66) && !h2.has(66), 'z02LGI: record 66 hidden before story state 0x34, shown from it');
    }

    // --- registry hook
    {
      ok(ctorFactory(CTOR.SGWALK) && ctorFactory(CTOR.SGSWIM) && ctorFactory(CTOR.ISLAND_PEPSWITC) && !ctorFactory(0x4bc773), 'ctor registry: built-ins registered, Music (0x4bc773) not');
      const B = loadZone(ctx, 'z02LGI');
      ok(B.setup && B.skipped.some((s) => s.ctor === 0x4bc773 && s.ctorName === 'Music') && !B.skipped.some((s) => s.ctor === CTOR.SGWALK), 'Loaded.skipped lists the unknown constructors (Music), not the known ones');
      let made = 0;
      registerCtor(0x4bc773, () => { made++; return { kind: 'MusicTest', var: 0, mask: 0, value: 0, stamp: 0xfffffffe, update: () => 2 }; });
      const C = loadZone(ctx, 'z02LGI');
      ok(made === 1 && C.pepper.ctrl.nodes.some((n) => n.kind === 'MusicTest') && !C.skipped.some((s) => s.ctor === 0x4bc773), 'registerCtor: a registered constructor is created at the attach site and no longer skipped');
      unregisterCtor(0x4bc773);
    }

    // --- the stub requirement: every zone loads, the player walks 300 ticks, no exception / NaN
    const lines = [];
    for (const zone of ZONE_ARCHIVES) {
      let Lz;
      try { Lz = loadZone(ctx, zone); } catch (e) { failures.push(`${zone}: load failed: ${e.stack || e}`); continue; }
      const w = Lz.world, p = Lz.pepper;
      ok(!!p && !!Lz.walk && w.records.includes(p), `${zone}: pepper / walk non-null`);
      ok(Lz.hasPlayer === !NO_PLAYER.includes(zone), `${zone}: hasPlayer ${Lz.hasPlayer}`);
      const x0 = p.x, y0 = p.y, z0 = p.z;
      let bad = null, minY = Infinity, maxCam = 0;
      w.input.setKey('ArrowUp', true);
      try {
        for (let i = 0; i < 300 && !bad; i++) {
          w.tick();
          const vals = [p.x, p.y, p.z, p.ry, ...w.camera.c.slice(0, 6), ...p.m];
          if (vals.some((v) => !Number.isFinite(v))) bad = `non-finite value at tick ${i}`;
          minY = Math.min(minY, p.y);
          maxCam = Math.max(maxCam, Math.hypot(w.camera.c[0] - p.x, w.camera.c[1] - p.y, w.camera.c[2] - p.z));
        }
      } catch (e) { bad = `exception: ${e.stack || e}`; }
      w.input.setKey('ArrowUp', false);
      checked++;
      if (bad) { failures.push(`${zone}: ${bad}`); continue; }
      const guard = p.ctrl?.nodes.find((n) => n.kind === 'StubGuard');
      const moved = Math.hypot(p.x - x0, p.z - z0);
      const flags = [];
      if (!Lz.hasPlayer) flags.push('dummy player (fly camera)');
      else {
        if (moved < 5) flags.push(`stuck (moved ${moved.toFixed(1)}: walls / a closed scene)`);
        if (guard?.respawns) flags.push(`walked off the edge ${guard.respawns} time(s), put back`);
        if (maxCam > 60) flags.push(`camera ${maxCam.toFixed(0)} away`);
        for (const n of Lz.notes) if (/camera|MFIG/.test(n)) flags.push(n);
      }
      lines.push(`${zone}: ${flags.length ? flags.join('; ') : 'fine'} (moved ${moved.toFixed(0)}, y ${y0.toFixed(1)} -> ${p.y.toFixed(1)}, lowest ${minY.toFixed(1)})`);
    }
    notes.push('stub walk (300 ticks forward): ' + lines.filter((l) => /: fine \(/.test(l)).length + ' of 30 fine; remarks on the others:');
    for (const l of lines) if (!/: fine \(/.test(l)) notes.push('  ' + l);
    return { checked, failures, notes };
  },
};
