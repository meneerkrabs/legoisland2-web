// Audio: the sounds every zone loads at its start (src/audio/zonesounds.ts, generated from the decompile by tools/gen/gen-zonesounds.py) against the
// executable's own bytes (a second, independent scan: `push imm; call FUN_00443580 / FUN_004433b0` inside each setup function), the table's consistency
// (slot caps, ids inside the sound table), the zone-local lists of the ported zones, the walking sound ids of the port's footstep code and the music / volume formulas.
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { readExeSoundTable } from '../../src/formats/sound.ts';
import { ZONE_SOUND_SETUP, SOUND_SETS, ZONE_CLASS_SETS } from '../../src/audio/zonesounds.ts';
import { walkSounds, landSound, SND_UI } from '../../src/audio/footsteps.ts';
import { musicVolumeDb, DM_PREPARE_TIME_MS } from '../../src/audio/music.ts';
import { ZONE_MUSIC } from '../../src/audio/zonemusic.ts';

const LOAD_2D = 0x443580, LOAD_3D = 0x4433b0;

/** every `push imm; call load` inside [start, end) by byte pattern, in address order */
function scan(pe, start, end) {
  const out = [];
  const u8 = (va) => pe.at(va);
  for (let a = start; a < end; a++) {
    if (u8(a) !== 0xe8) continue;
    const rel = pe.u32(a + 1) | 0;
    const t = (a + 5 + rel) >>> 0;
    if (t !== LOAD_2D && t !== LOAD_3D) continue;
    let id = null;
    if (u8(a - 5) === 0x68) id = pe.u32(a - 4);
    else if (u8(a - 2) === 0x6a) id = (u8(a - 1) << 24) >> 24;
    out.push([t === LOAD_2D ? '2d' : '3d', id]);
  }
  return out;
}

export default {
  name: 'audio-zonesounds',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const exe = new Uint8Array(fs.readFileSync(exePath));
    const pe = new Pe(exe);
    const table = readExeSoundTable(exe);

    // ---- the generated lists = the bytes of the setup functions
    const same = (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1]);
    let total = 0;
    for (const [zone, s] of Object.entries(ZONE_SOUND_SETUP)) {
      let bytes = scan(pe, s.fn, s.end);
      if (zone === 'z60FRE') bytes = bytes.concat(scan(pe, 0x47172c, 0x47177b));   // the zone function's own 3D load
      ok(same(bytes, s.loads), `${zone}: list differs from the bytes of 0x${s.fn.toString(16)} (${s.loads.length} vs ${bytes.length})`);
      ok(s.loads.every(([, id]) => id !== null && id >= 0 && id < table.length), `${zone}: id outside the sound table`);
      total += s.loads.length;
    }
    for (const [name, set] of Object.entries(SOUND_SETS)) {
      let bytes = [];
      for (const [f, e] of set.fn) bytes = bytes.concat(scan(pe, f, e));
      ok(same(bytes, set.loads), `set ${name}: list differs from the bytes (${set.loads.length} vs ${bytes.length})`);
    }
    notes.push(`${Object.keys(ZONE_SOUND_SETUP).length} zone lists, ${total} loads, ${Object.keys(SOUND_SETS).length} class / menu sets verified against the executable`);

    // ---- slot caps (200 of each kind) and voice caps per zone: list + classes + menu + island objects stay below the cache size
    for (const zone of Object.keys(ZONE_SOUND_SETUP)) {
      const all = [...ZONE_SOUND_SETUP[zone].loads, ...(ZONE_CLASS_SETS[zone] ?? []).flatMap((c) => SOUND_SETS[c].loads), ...SOUND_SETS.MENU.loads];
      const n2 = all.filter((l) => l[0] === '2d').length, n3 = all.filter((l) => l[0] === '3d').length;
      ok(n2 <= 200 && n3 <= 200, `${zone}: ${n2} 2D / ${n3} 3D loads exceed the 200-slot caches`);
    }

    // ---- the port's walking sounds (footsteps.ts) are all in the SGwalk set (what the zone loads when Pepper walks)
    const walk = new Set(SOUND_SETS.WALK.loads.filter((l) => l[0] === '2d').map((l) => l[1]));
    const used = new Set();
    for (let surface = 0; surface <= 10; surface++) { for (const i of walkSounds(surface) ?? []) used.add(i); const l = landSound(surface); if (l !== null) used.add(l); }
    for (const id of used) ok(walk.has(id), `walk / land sound ${id} (${table[id]?.name}) is not loaded by FUN_004b0b37 / FUN_004b0f16`);
    for (const id of [...SND_UI.MENU_MOVE, SND_UI.MENU_SELECT, SND_UI.MENU_BACK, SND_UI.MENU_ONOFF]) ok(SOUND_SETS.MENU.loads.some((l) => l[1] === id), `menu sound ${id} not in FUN_004b0240`);

    // ---- the zone-local lists of the ported zones are subsets of what the original loads
    const locals = [
      ['z42BRP', '../../src/zones/z42BRP/rules.ts'], ['z10RGB', '../../src/zones/z10rgb/consts.ts'], ['z08BKD', '../../src/zones/z08bkd/consts.ts'],
      ['z15SSH', '../../src/zones/z15ssh/rules.ts'], ['z18MMP', '../../src/zones/z18mmp/consts.ts'], ['z20DSP', '../../src/zones/z20dsp/shared.ts'], ['z21FSH', '../../src/zones/z21fsh/rules.ts'],
    ];
    for (const [zone, mod] of locals) {
      let m;
      try { m = await import(mod); } catch (e) { notes.push(`${zone}: ${mod} not importable in node (${String(e.message).split('\n')[0]})`); continue; }
      const s = ZONE_SOUND_SETUP[zone];
      for (const kind of ['2d', '3d']) {
        const list = m[kind === '2d' ? 'SOUNDS_2D' : 'SOUNDS_3D'];
        if (!list) continue;
        const have = new Set(s.loads.filter((l) => l[0] === kind).map((l) => l[1]));
        for (const id of list) ok(have.has(id), `${zone}: ${kind} sound ${id} (${table[id]?.name}) of the port's own list is not in the original's list`);
      }
    }

    // ---- every sound id a ported zone names (its `SND` table) is a sound the original's zone loads (setup list, the classes it registers, the menu clicks): the ids were
    //      all taken from the code, this checks them against the executable (docs/re/gaps.md A10)
    const sndModules = [
      ['z42BRP', '../../src/zones/z42BRP/rules.ts'], ['z10RGB', '../../src/zones/z10rgb/consts.ts'], ['z17WAS', '../../src/zones/z17was/rules.ts'], ['z36CNT', '../../src/zones/z36cnt/sim.ts'],
      ['z27TRX', '../../src/zones/z27trx/consts.ts'], ['z01BPK', '../../src/zones/z01bpk/skate.ts'], ['z05WAB', '../../src/zones/z05WAB/wab.ts'], ['z04IFC', '../../src/zones/z04IFC/ifc.ts'],
      ['z20DSP', '../../src/zones/z20dsp/shared.ts'], ['z08BKD', '../../src/zones/z08bkd/consts.ts'], ['z41MAP', '../../src/zones/z41MAP/rules.ts'], ['z21FSH', '../../src/zones/z21fsh/rules.ts'],
      ['z39ASB', '../../src/zones/z39ASB/sound.ts'], ['z15SSH', '../../src/zones/z15ssh/rules.ts'], ['z18MMP', '../../src/zones/z18mmp/consts.ts'],
    ];
    const flat = (v, out = []) => { if (typeof v === 'number') out.push(v); else if (Array.isArray(v)) v.forEach((x) => flat(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => flat(x, out)); return out; };
    for (const [zone, mod] of sndModules) {
      let m;
      try { m = await import(mod); } catch (e) { notes.push(`${zone}: SND table not checked (${String(e.message).split('\n')[0]})`); continue; }
      if (!m.SND) continue;
      const have = new Set([...ZONE_SOUND_SETUP[zone].loads.map((l) => l[1]), ...(ZONE_CLASS_SETS[zone] ?? []).flatMap((c) => SOUND_SETS[c].loads.map((l) => l[1])), ...SOUND_SETS.MENU.loads.map((l) => l[1])]);
      for (const id of flat(m.SND)) ok(have.has(id), `${zone}: SND id ${id} (${table[id]?.name}) is not loaded by the original's zone start`);
    }

    // ---- the music table: keys exist, play moments, volume formula (docs/re/audio.md 7.5)
    ok(DM_PREPARE_TIME_MS === 1000, 'DirectMusic default prepare time');
    for (const [zone, m] of Object.entries(ZONE_MUSIC)) {
      if (m.key) ok(!!m.plays && m.plays.length > 0, `${zone}: key without a play moment`);
    }
    const eq = (a, b) => Math.abs(a - b) < 1e-9;
    ok(eq(musicVolumeDb(100), 0) && eq(musicVolumeDb(80), -4.4) && eq(musicVolumeDb(50), -11), 'music dB at 100 / 80 / 50');
    ok(eq(musicVolumeDb(1), -21.78) && musicVolumeDb(0) <= -200, 'music dB at 1 / 0');
    ok(eq(musicVolumeDb(80, 0.5), Math.trunc(80 * 0.5 * 22 - 2200) / 100), 'music dB with the fade scale');
    ok(musicVolumeDb(80, 1, true) <= -200 && musicVolumeDb(80, 0) <= -200, 'music mute / fade 0 silent');
    return { checked, failures, notes };
  },
};
