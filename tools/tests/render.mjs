// Rendering parameters: per-zone SetupFog calls + sea level read from the executable, the lighting maths and the state presets.
import fs from 'node:fs';
import path from 'node:path';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { extractZoneSetup, zoneCodeIndex } from '../../src/formats/zonesetup.ts';
import { extractRenderParams, fogRange } from '../../src/formats/zoneparams.ts';
import { parseLgt } from '../../src/formats/lights.ts';
import { lightSetFromLgt, lightVertex } from '../../src/render/lighting.ts';
import { PRESETS, modePreset, d3dZRange, GAME_Z_RANGE } from '../../src/render/states.ts';
import { selectLod } from '../../src/render/camera.ts';
import { SeaState, SkyState } from '../../src/render/environment.ts';
import { FOG_PHASES, pickFogCall } from '../../src/game/fogphases.ts';

const ZONES = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC', 'z60FRE'];
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

export default {
  name: 'render',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    // --- presets
    ok(PRESETS.length === 30, 'preset count');
    ok(PRESETS[3].colorOp === 'mod' && PRESETS[3].alphaOp === 'tex' && PRESETS[3].blend === 'alpha' && PRESETS[3].z, 'preset 3 = lit mesh state');
    ok(PRESETS[1].colorOp === 'tex' && PRESETS[0x10].z === false && PRESETS[7].blend === 'add', 'presets 1 / 0x10 / 7');
    ok(modePreset(0) === 3 && modePreset(2) === 1 && modePreset(3) === 0x10 && modePreset(6) === 0, 'mode -> preset');
    // --- LOD (FUN_00443f90): (lod)^2 < zoom * dist^2
    const parts = [{ lod: 0 }, { lod: 20 }, { lod: 40 }, { lod: 70 }];
    ok(selectLod(parts, 10) === 0 && selectLod(parts, 21) === 1 && selectLod(parts, 50) === 2 && selectLod(parts, 500) === 3 && selectLod(parts, 20) === 0, 'selectLod');
    // --- sea / sky placement
    const sea = new SeaState();
    const m = sea.matrix([100, 30, 50], 450, 2.4);
    ok(near(m[0], 450 * 2.5) && near(m[5], 1) && near(m[13], 2.4) && near(m[10], 450 * 2.5), 'sea matrix scale / level');
    const sky = new SkyState(false).matrix([10, 40, 20], 450, 0);
    ok(near(sky[0], 540) && near(sky[5], 140) && near(sky[12], 10) && near(sky[14], 20), 'sky matrix');
    // --- zones from the executable
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked, failures: [...failures, `missing ${exePath}`] };
    const pe = new Pe(fs.readFileSync(exePath));
    const starts = pe.functionStarts();
    for (const zone of ZONES) {
      let s;
      try { s = extractZone(pe, zone, undefined, starts); } catch (e) { failures.push(`${zone}: ${e.message}`); continue; }
      const p = extractRenderParams(pe, s.builderAt);
      ok(p.fog.length >= 1, `${zone}: no SetupFog call found`);
      for (const f of p.fog) ok(Number.isFinite(f.near) && f.near >= 1 && f.farMin > 0 && f.farMax >= f.farMin && f.fogFrac > 0, `${zone}: implausible fog setup ${JSON.stringify(f)}`);
    }
    {
      const s = extractZone(pe, 'z02LGI', undefined, starts);
      const p = extractRenderParams(pe, s.builderAt);
      const f = p.fog[0];
      ok(f && f.near === 4 && f.farMin === 100 && f.farMax === 800 && f.fogFrac === 500 && f.color === 0xffff && f.enabled, 'z02LGI fog setup');
      ok(near(p.seaLevel ?? NaN, 2.4, 1e-3), 'z02LGI sea level 2.4');
      const r = fogRange(f, 50);
      ok(near(r.far, 450) && near(r.fogStart, 168.75), 'z02LGI far 450, fog start 168.75');
      const arch = ctx.archives.find((a) => a.name === 'z02LGI');
      const e = arch?.find('lights/lights.lgt');
      if (e) {
        const set = lightSetFromLgt(parseLgt(arch.read(e)));
        ok(set.directional.length === 1 && set.directional[0].dir[1] > 0, 'z02LGI sun points towards the light (y flipped to >= 0)');
        const up = lightVertex(set, [0, 1, 0]), down = lightVertex(set, [0, -1, 0]);
        ok(near(up[0], set.directional[0].dir[1], 1e-6) && near(down[0], set.ambient[0], 1e-6), 'z02LGI lit top / ambient-only bottom');
      }
    }
    // --- WP-RENDER R8: the SetupFog call of each phase (src/game/fogphases.ts) is one the extraction finds, with the values read from the decompile
    {
      const vals = (f) => [f.near, f.farMin, f.farMax, f.fogFrac, f.color, f.enabled ? 1 : 0].join('/');
      const want = {   // zone: [start, play, restart] near / farMin / farMax / fogFrac / colour / enabled
        z08BKD: ['4/200/200/120/0/1', '4/200/200/120/65535/1', '4/200/200/120/0/0'], z09JST: ['4/200/500/400/16750950/1', '4/200/500/400/16750950/1', '4/200/500/400/0/1'],
        z10RGB: ['4/800/800/500/16750950/1', '4/100/600/300/16750950/1', '4/800/800/500/16750950/1'], z17WAS: ['1/400/400/100/65535/0', '1/400/400/100/65535/0', '1/400/400/100/0/0'],
        z20DSP: ['4/400/700/300/65535/1', '4/400/700/300/65535/1', '4/400/700/300/0/0'], z21FSH: ['4/100/800/500/65535/0', '4/100/800/500/65535/0', '4/100/800/500/0/0'],
        z22BIP: ['4/400/500/300/65535/1', '4/400/500/300/65535/1', '4/400/500/300/0/1'], z28HAT: ['4/80/300/150/16771238/1', '4/80/300/150/16771238/1', '4/80/300/150/0/1'],
        z40OGL: ['4/100/300/200/0/1', '4/100/300/200/0/1', '4/100/300/200/0/1'],
      };
      for (const [zone, ph] of Object.entries(FOG_PHASES)) {
        const sc = extractZone(pe, zone, undefined, starts);
        const fog = extractRenderParams(pe, sc.builderAt).fog;
        const pick = (at) => fog.find((f) => f.at === at);
        for (const [k, i] of [['start', 0], ['play', 1], ['restart', 2]]) {
          const at = ph[k] ?? (k === 'restart' ? ph.start : null) ?? ph.play;
          const f = pick(at);
          ok(!!f, `${zone}: the ${k} call 0x${at.toString(16)} is not among the extracted SetupFog calls ${fog.map((x) => x.at.toString(16))}`);
          if (f && want[zone]) ok(vals(f) === want[zone][i], `${zone} ${k} fog ${vals(f)} vs ${want[zone][i]}`);
        }
      }
      // the phases as the renderer picks them: first fade-in = start, after the restart exit = restart, play from the first non-fade mode on (z08BKD: three different calls)
      {
        const fog = extractRenderParams(pe, extractZone(pe, 'z08BKD', undefined, starts).builderAt).fog, ph = FOG_PHASES.z08BKD;
        let st = { loopMode: 7, playedYet: false, restarted: false };
        let r = pickFogCall('z08BKD', fog, st);
        ok(r.call.at === ph.start && !r.playedYet, 'z08BKD: the first fade-in uses the start call');
        r = pickFogCall('z08BKD', fog, { ...st, restarted: true });
        ok(r.call.at === ph.restart, 'z08BKD: the fade-in after the restart exit uses the restart call');
        r = pickFogCall('z08BKD', fog, { loopMode: 1, playedYet: false, restarted: true });
        ok(r.call.at === ph.play && r.playedYet, 'z08BKD: any other mode plays with the play call (and the fade-in is over)');
        r = pickFogCall('z08BKD', fog, { loopMode: 7, playedYet: true, restarted: false });
        ok(r.call.at === ph.play, 'z08BKD: a later mode 7 (pause fade) keeps the play call');
        ok(pickFogCall('z01BPK', [{ at: 1 }, { at: 2 }], st).call.at === 1, 'a zone without phases uses the first call');
      }
      // the 16-bit branch of z40OGL (first by address) differs from the 32-bit one that applies
      const og = extractRenderParams(pe, extractZone(pe, 'z40OGL', undefined, starts).builderAt).fog;
      ok(og.length === 2 && vals(og[0]) === '4/80/200/100/0/1' && vals(og[1]) === '4/100/300/200/0/1', `z40OGL calls ${og.map(vals)}`);
    }
    // --- WP-RENDER R4: the render calls of the attached nodes' constructors (FUN_00444550 / FUN_004446c0 inside FUN_0079798f, FUN_004b4000 ...)
    {
      const ctor = (zone) => { const sc = extractZone(pe, zone, undefined, starts); const st = extractZoneSetup(pe, zone, sc, starts, { ctorRender: true }); return { sc, st }; };
      const hat = ctor('z28HAT');
      ok(hat.st.ctorModes.some((m) => hat.sc.records[m.record]?.name === 'ZAPP' && m.partMask === 0xff && m.mode === 2), 'z28HAT: the balloon constructor sets ZAPP to mode 2');
      ok(hat.st.modes.every((m) => hat.sc.records[m.record]?.name !== 'ZAPP'), 'z28HAT: the set-up code itself does not (ctorModes only)');
      const lgi = ctor('z02LGI');
      ok(lgi.st.ctorModes.length > 50 && lgi.st.ctorModes.filter((m) => m.mode === 1).length > 40, `z02LGI: ${lgi.st.ctorModes.length} constructor modes (mode 1 for the moving records)`);
      // the constructors of the seabed.c behaviours repeat the modes the renderer hard-codes (sky 2, sea 3, seabed 3, foam 2)
      const cai = ctor('z13CAI');
      const nameOf = (m) => cai.sc.records[m.record]?.name;
      ok(cai.st.ctorModes.some((m) => nameOf(m) === 'SSKY' && m.mode === 2) && cai.st.ctorModes.some((m) => nameOf(m) === 'SSEA' && m.mode === 3) && cai.st.ctorModes.some((m) => nameOf(m) === 'SEAB' && m.mode === 3), 'z13CAI: SSKY 2, SSEA 3, SEAB 3');
      const dsp = ctor('z20DSP');
      ok(dsp.st.ctorModes.some((m) => dsp.sc.records[m.record]?.name === 'PEPP' && m.mode === 1), 'z20DSP: Pepper in mode 1');
    }
    // --- WP-RENDER R-viewport: the three SetViewport calls pass MinZ = MaxZ = 0; Direct3D 7 turns that into [0, 0.001]
    {
      // the structs the game fills (FUN_0040a43f / FUN_0040acb0 / FUN_0040bdd1): dwX, dwY, width, height, then two zero words
      const decomp = path.join(process.env.HOME ?? '', 'Documents/basdebeer-tools/decomp-le2/LE2.c');
      const lines = fs.existsSync(decomp) ? fs.readFileSync(decomp, 'utf8').split('\n') : [];
      if (lines.length) for (const [fn, expect] of [['FUN_0040a43f', ['local_1c0 = 0;', 'local_1bc = 0;']], ['FUN_0040acb0', ['local_5c = 0;', 'local_58 = 0;']], ['FUN_0040bdd1', ['local_d8 = 0;', 'local_d4 = 0;']]]) {
        const at = lines.findIndex((l) => l.startsWith(`// ==== ${fn} @`));
        const call = at < 0 ? -1 : lines.findIndex((l, i) => i > at && l.includes('+ 0x34))(DAT_00983a38,&local_'));
        ok(at >= 0 && call > at && lines.slice(call - 2, call).map((l) => l.trim()).join('|') === expect.join('|'), `${fn}: the viewport's last two words (MinZ, MaxZ) are not both 0 (${lines.slice(call - 2, call)})`);
      }
      // Wine's tests against native Windows (ddraw7.c, 'Test degenerate viewport z ranges'): the z a vertex with NDC z = 1, 0.5, 0.25 ends up at
      const z = (min, max, ndc) => Math.fround(ndc * (d3dZRange(min, max)[1] - d3dZRange(min, max)[0]) + d3dZRange(min, max)[0]);
      ok([1, 0.5, 0.25].every((n) => z(0, 1, n) === n), 'normal range 0..1');
      ok(near(z(0, 0, 1), 1e-3, 1e-9) && near(z(0, 0, 0.5), 5e-4, 1e-9) && near(z(0, 0, 0.25), 2.5e-4, 1e-9), 'degenerate 0..0 = 0..0.001');
      ok(near(z(1, 0, 1), 1.001, 1e-6) && near(z(1, 0, 0.5), 1.0005, 1e-6), 'inverted 1..0 = 1..1.001');
      ok(near(z(-2, 4, 0.5), 1, 1e-6), 'plain -2..4');
      ok(GAME_Z_RANGE[0] === 0 && near(GAME_Z_RANGE[1], 0.001, 1e-9), `the game's range ${GAME_Z_RANGE}`);
    }
    // --- WP-RENDER R4 (second pass): every call of FUN_00444550 / FUN_004446c0 in a zone's code is accounted for (walk, emulation, constructor walk, table loops, field records)
    {
      const starts2 = pe.functionStarts(), index = zoneCodeIndex(pe, starts2), t = pe.text;
      const sites = new Map();   // zone -> call-site addresses
      for (let va = t.va; va < t.va + t.rsize - 5; va++) {
        const o = t.roff + (va - t.va);
        if (pe.data[o] !== 0xe8) continue;
        const target = (va + 5 + (pe.data[o + 1] | (pe.data[o + 2] << 8) | (pe.data[o + 3] << 16) | (pe.data[o + 4] << 24))) >>> 0;
        if (target !== 0x444550 && target !== 0x4446c0) continue;
        for (const [, c] of index) if (va >= c.lo && va < c.hi) (sites.get(c.zone) ?? sites.set(c.zone, []).get(c.zone)).push(va);
      }
      const hubs = new Set(['z02LGI', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL', 'z40aPO']);   // other owners (WP-ISLAND / M5): reported, not asserted
      let total = 0, open = [];
      for (const [zone, list] of sites) {
        const sc = extractZone(pe, zone, undefined, starts), st = extractZoneSetup(pe, zone, sc, starts, { ctorRender: true });
        const have = new Set([...st.modes, ...st.shiny, ...st.ctorModes, ...st.ctorShiny].map((m) => m.at));
        const missing = list.filter((a) => !have.has(a));
        total += list.length;
        if (hubs.has(zone)) { if (missing.length) open.push(`${zone} ${missing.length}`); continue; }
        ok(missing.length === 0, `${zone}: call sites of FUN_00444550 / FUN_004446c0 not accounted for: ${missing.map((a) => a.toString(16))}`);
      }
      // the table loops and the vehicle's block fields
      const cnt = (zone, at) => { const sc = extractZone(pe, zone, undefined, starts), st = extractZoneSetup(pe, zone, sc, starts, { ctorRender: true }); return [...st.ctorModes, ...st.ctorShiny].filter((m) => m.at === at); };
      ok(cnt('z15SSH', 0x655e67).length === 14 && cnt('z17WAS', 0x6989e7).length === 15 && cnt('z41MAP', 0x811495).length === 18, 'the start functions\' record tables (z15SSH 14, z17WAS 15, z41MAP 18 records)');
      ok(cnt('z60FRE', 0x472892).length === 18 && cnt('z60FRE', 0x4728b2).length === 18 && cnt('z60FRE', 0x472892).every((m) => m.mode === 1 && m.partMask === 0xff), 'z60FRE: 18 records mode 1 + 18 shiny');
      ok(['WEBR', 'WEBL', 'WEFR', 'WEFL'].every((n) => cnt('z20DSP', 0x6c6b4d).concat(cnt('z20DSP', 0x6c6b63), cnt('z20DSP', 0x6c6b7c), cnt('z20DSP', 0x6c6b95)).some((m) => extractZone(pe, 'z20DSP', undefined, starts).records[m.record]?.name === n && m.mode === 1)), 'z20DSP: the four wheels get mode 1');
      notes.push(`${total} render-call sites checked; open in other owners' zones: ${open.join(', ') || 'none'}`);
    }
    notes.push(`${ZONES.length} zones parsed`);
    return { checked, failures, notes };
  },
};
