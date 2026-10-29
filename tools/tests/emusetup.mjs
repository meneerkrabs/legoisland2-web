import { emulateIslandSetup, eraOfNode, recIndexOfPtr, RECORDS_BASE } from '../../src/formats/emusetup.ts';
import { extractZoneSetup, activeEntries, nameOfEntry, nameMatches, zoneCodeIndex } from '../../src/formats/zonesetup.ts';
import { profileFor, setupZone } from '../../src/game/setup.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';

// The island's set-up RUN out of the executable (src/formats/emusetup.ts, docs/re/m4/emu.md) for one story node of every era: (a) the oracle = every
// attach / flag write / box / cutscene slot / HUD hint the symbolic extraction (zonesetup.ts) reports as active for the node is in the emulator's output
// with the same record / constructor / position / gate (resp. a store at the same instruction with a consistent value); the differences that are explained
// (the oracle is wrong there, the decompile agrees with the emulator) are listed in EXPLAINED; (b) the attach count per era and per constructor (notes);
// (c) no unknown engine function is called on a set-up path; (d) the time bound; (e) var 0x4f (FUN_0041ad80) selects which of the ten PH records is shown.

const NODES = [2, 7, 30, 52, 61];
/** oracle entries that differ from the emulation, with the reason (call address -> why) */
const EXPLAINED = new Map([
  // FUN_0052266a (era 3, the four buildings 69..72 with constructor 0x535281): the gate mask is `local_c`, 1 shifted left after every attach
  // (decompile: `FUN_00423532(..., 0x26, local_c & 0xffff, 0); local_c = local_c << 1;`); the symbolic interpreter reads it as 0.
  [0x522c29, 'mask = local_c (1, 2, 4, 8: shifted after each attach); the oracle does not track the local'],
  [0x522cc0, 'mask = local_c << 1'], [0x522d55, 'mask = local_c << 2'], [0x522ded, 'mask = local_c << 3'],
]);
/** expected attach counts per story node (regression) */
const ATTACHES = { 2: 272, 7: 290, 30: 261, 52: 302, 61: 266 };

const varsOf = (init) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [+k, v]));
  return { m, get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) };
};

export default {
  name: 'emusetup',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const scene = sceneOf(ctx, 'z02LGI');
    const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    zoneCodeIndex(pe);   // the one-off index of the executable (shared with the symbolic extraction), not part of the per-era time
    const oracle = extractZoneSetup(pe, 'z02LGI', scene);
    const names = scene.records.map((r) => r.name);
    const table = new Map();   // ctor name -> per-node counts
    const explainedSeen = new Set();
    let slowest = 0;

    for (const node of NODES) {
      const vars = varsOf({ 0x58: node, 2: 1 });
      let s;
      const t0 = performance.now();
      try { s = emulateIslandSetup(pe, scene, { vars, archive }); } catch (e) { failures.push(`node ${node}: emulation failed: ${e.stack || e}`); continue; }
      const dt = performance.now() - t0;
      slowest = Math.max(slowest, dt);
      ok(dt < 1000, `node ${node}: ${dt.toFixed(0)} ms (> 1 s)`);
      ok(s.era === eraOfNode(node), `node ${node}: era ${s.era}`);
      ok(s.attaches.length === ATTACHES[node], `node ${node}: ${s.attaches.length} attaches (expected ${ATTACHES[node]})`);
      const gv = (v) => (v === 0x58 ? node : 0);

      // (a) attaches
      const key = (a) => `${a.record}|${a.ctor}|${a.var}|${a.mask}|${a.value}`;
      const pool = new Map();
      for (const a of s.attaches) { const k = `${a.at}|${key(a)}`; (pool.get(k) ?? pool.set(k, []).get(k)).push(a); }
      const orcA = activeEntries(oracle.attaches, gv).filter((a) => a.record >= 0);
      let miss = 0;
      for (const a of orcA) {
        const l = pool.get(`${a.at}|${key(a)}`);
        const hit = l?.find((e) => a.pos < 0 || e.pos === a.pos);
        if (hit) { l.splice(l.indexOf(hit), 1); continue; }
        const why = EXPLAINED.get(a.at);
        const emu = s.attaches.filter((e) => e.at === a.at).map((e) => `rec ${e.record} ctor ${e.ctor.toString(16)} pos ${e.pos} gate ${e.var.toString(16)}&${e.mask.toString(16)}=${e.value.toString(16)}`);
        if (why) { explainedSeen.add(a.at); notes.push(`node ${node}: oracle attach at 0x${a.at.toString(16)} (rec ${a.record}, mask ${a.mask}) vs emulator [${emu.join('; ')}]: ${why}`); continue; }
        miss++;
        failures.push(`node ${node}: oracle attach rec ${a.record} ${a.ctorName ?? a.ctor.toString(16)} pos ${a.pos} gate ${a.var.toString(16)}&${a.mask.toString(16)}=${a.value.toString(16)} at 0x${a.at.toString(16)} not in the emulation (emulator at that call: ${emu.join('; ') || 'none'})`);
      }
      checked += orcA.length;
      // flag writes: a store at the same instruction into the same record with a value that fits the oracle's op
      const orcF = activeEntries(oracle.flagWrites, gv);
      let fbad = 0, fn = 0;
      for (const w of orcF) {
        const pat = w.record < 0 ? nameOfEntry(w) : null;
        const recs = w.record >= 0 ? [w.record] : pat ? names.flatMap((nm, i) => (nameMatches(pat, nm) ? [i] : [])) : [];
        for (const r of recs) {
          fn++;
          const st = s.stores.filter((x) => x.at === w.at && x.record === r && x.field >= 0x60 && x.field < 0x62);
          const v = st.length ? st[st.length - 1].value : null;
          const good = v !== null && (w.op === 'and' ? (v & ~w.mask & 0xffff) === 0 : w.op === 'or' ? (v & w.mask) === w.mask : w.op === 'set' ? v === w.mask : true);
          if (!good) { fbad++; failures.push(`node ${node}: oracle flag write rec ${r} ${w.op} 0x${w.mask.toString(16)} at 0x${w.at.toString(16)}: emulator ${v === null ? 'no store' : '0x' + v.toString(16)}`); }
        }
      }
      checked += fn;
      // boxes, cutscene slots, HUD hints
      const near = (a, b) => a.length === b.length && a.every((x, k) => Math.abs(x - b[k]) < 1e-5);
      for (const b of activeEntries(oracle.boxes, gv)) {
        const recs = b.record >= 0 ? [b.record] : names.flatMap((nm, i) => (nameMatches(nameOfEntry(b) ?? '????', nm) ? [i] : []));
        for (const r of recs) ok(s.boxes.some((x) => x.at === b.at && x.record === r && x.kind === b.kind && near(x.dims, b.dims)), `node ${node}: oracle box ${JSON.stringify(b)} rec ${r} missing`);
      }
      for (const c of activeEntries(oracle.cutscenes, gv)) ok(s.cutscenes.some((x) => x.at === c.at && x.slot === c.slot && x.name === c.name && x.messages === c.messages), `node ${node}: oracle cutscene ${JSON.stringify(c)} missing`);
      for (const h of activeEntries(oracle.hudHints, gv)) ok(s.hudHints.some((x) => x.at === h.at && x.index === h.index && x.a === h.a && x.b === h.b && x.c === h.c && x.d === h.d && Math.abs(x.scale - h.scale) < 1e-6), `node ${node}: oracle HUD hint ${JSON.stringify(h)} missing`);
      for (const m of activeEntries(oracle.modes, gv)) if (m.record >= 0) ok(s.modes.some((x) => x.at === m.at && x.record === m.record && x.partMask === m.partMask && x.mode === m.mode), `node ${node}: oracle render mode ${JSON.stringify(m)} missing`);

      // structure: attaches on real records, arg snapshots, start place, dictionaries, the stores' records
      ok(s.attaches.every((a) => a.record >= 0 && a.record < scene.records.length), `node ${node}: attach with a record outside the array`);
      ok(s.attaches.every((a) => a.args.length === 0x80), `node ${node}: arg snapshots`);
      ok(s.dictionaries.switches.size === 70 && s.dictionaries.switches.get('SWITCH_LGI_BRICKFX_RADIOSTATION') === 250, `node ${node}: switch dictionary (${s.dictionaries.switches.size})`);
      ok(s.dictionaries.anims.size === 339 && s.dictionaries.anims.get('SKBD_SKBD_ONTOBOARD') === 1, `node ${node}: animation dictionary (${s.dictionaries.anims.size})`);
      ok(s.waypointMaps.length === 4 && s.waypointMaps[1].path?.endsWith('W_PATH'), `node ${node}: waypoint maps`);
      ok(s.unhooked.length === 0, `node ${node}: engine functions without a host entry: ${s.unhooked.map((u) => `0x${u.fn.toString(16)} x${u.count} from ${u.callers.map((c) => c.toString(16))}`).join(', ')}`);
      const zs = s.toZoneSetup();
      ok(zs.attaches.length === s.attaches.length && zs.cutscenes.length === s.cutscenes.length && zs.flagWrites.length > 0 && Math.abs(zs.seaLevel - 2.4) < 1e-6 && zs.groundRecord === 4 && zs.focusRecord === 16, `node ${node}: toZoneSetup (sea ${zs.seaLevel}, ground ${zs.groundRecord}, focus ${zs.focusRecord})`);
      ok(recIndexOfPtr(RECORDS_BASE + 16 * 0x68 + 0x3c) === 16 && recIndexOfPtr(0x401000) === -1, 'recIndexOfPtr');

      // (b) per-constructor counts
      for (const a of s.attaches) {
        const n = a.ctorName ? `${a.ctorName} 0x${a.ctor.toString(16)}` : `0x${a.ctor.toString(16)}`;
        const row = table.get(n) ?? table.set(n, {}).get(n);
        row[node] = (row[node] ?? 0) + 1;
      }
      notes.push(`node ${node} (era ${s.era}): ${s.attaches.length} attaches (oracle ${orcA.length}, ${miss} missing), ${fn} oracle flag writes (${fbad} bad), ${s.stores.length} record stores, ${s.changed.length} record changes, ${s.cutscenes.length} cutscenes / ${s.cutsceneSlots} slots, ${s.boxes.length} boxes, ${s.varWrites.length} var writes, ${s.calls.length} host calls (${s.storyHandler.length} in the story handler), ${s.steps} instructions, ${dt.toFixed(0)} ms`);
    }
    for (const at of EXPLAINED.keys()) ok(explainedSeen.has(at), `explained difference at 0x${at.toString(16)} no longer occurs (remove it from EXPLAINED)`);

    // (e) var 0x4f selects the visible PH record (FUN_004b6475: records 350..359 (flags at 0x8e90 ... 0x9238) hidden, `iVar2 == 10` shows 350 ... `== 1` shows 359)
    for (const v of [0, 1, 5, 10]) {
      const vars = varsOf({ 0x58: 2, 2: 1, 0x4f: v });
      const s = emulateIslandSetup(pe, scene, { vars, archive });
      const shown = [];
      for (let r = 350; r <= 359; r++) if (s.records[r].flags & 2) shown.push(r);
      const want = v >= 1 && v <= 10 ? [360 - v] : [];
      ok(JSON.stringify(shown) === JSON.stringify(want), `var 0x4f = ${v}: shown PH records ${shown} (expected ${want})`);
    }

    // profileFor(..., { islandVars }) + setupZone: the emulated set-up drives the port's world (flags, positions, boxes, the player chain)
    for (const node of [2, 30]) {
      const vars = varsOf({ 0x58: node, 2: 1 });
      const p = profileFor('z02LGI', pe, scene, undefined, { islandVars: vars, archive });
      ok(!!p.island && p.setup.attaches.length === ATTACHES[node], `profileFor islandVars node ${node}: ${p.setup.attaches.length} attaches`);
      const L = setupZone(scene, archive, p, { vars: { 0x58: node }, pe });
      const bad = L.world.records.filter((r, i) => i < p.island.records.length && ((r.flags & 2) !== 0) !== ((p.island.records[i].flags & 2) !== 0)).map((r) => r.index);
      ok(bad.length === 0, `setupZone with the emulation, node ${node}: visibility differs from the emulated records for ${bad.slice(0, 10)}`);
      ok(L.hasPlayer && L.pepper.name === 'PEPP', `setupZone node ${node}: player`);
      for (let i = 0; i < 30; i++) L.world.tick();
      ok([L.pepper.x, L.pepper.y, L.pepper.z].every(Number.isFinite), `setupZone node ${node}: 30 ticks, player at ${L.pepper.x}, ${L.pepper.y}, ${L.pepper.z}`);
      const def = profileFor('z02LGI', pe, scene);
      ok(!def.island && def.setup.attaches.length === 183, 'profileFor without islandVars: the symbolic extraction (default unchanged)');
    }

    // per-constructor table (notes)
    const rows = [...table].sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
    notes.push(`attaches per constructor (nodes ${NODES.join(' / ')}):`);
    for (const [n, c] of rows) notes.push(`  ${n.padEnd(22)} ${NODES.map((k) => String(c[k] ?? 0).padStart(4)).join(' ')}`);
    notes.push(`slowest era ${slowest.toFixed(0)} ms`);
    return { checked, failures, notes };
  },
};
