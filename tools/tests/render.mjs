// Rendering parameters: per-zone SetupFog calls + sea level read from the executable, the lighting maths and the state presets.
import fs from 'node:fs';
import path from 'node:path';
import { Pe, extractZone } from '../../src/formats/exe.ts';
import { extractRenderParams, fogRange } from '../../src/formats/zoneparams.ts';
import { parseLgt } from '../../src/formats/lights.ts';
import { lightSetFromLgt, lightVertex } from '../../src/render/lighting.ts';
import { PRESETS, modePreset } from '../../src/render/states.ts';
import { selectLod } from '../../src/render/camera.ts';
import { SeaState, SkyState } from '../../src/render/environment.ts';

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
    notes.push(`${ZONES.length} zones parsed`);
    return { checked, failures, notes };
  },
};
