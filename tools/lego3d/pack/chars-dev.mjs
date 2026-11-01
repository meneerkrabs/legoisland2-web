// dev loop: fitted LDraw body next to the original, rendered with the software rasteriser
import { loadBody } from './chars-core.mjs';
import { PARTS, fitsOf, partTris } from './chars-body.mjs';
import { renderViews } from '../raster.mjs';
const SPECS = {
  pepp: { zone: 'z02LGI', hr: 'PEPP_HR.msh', regions: {
    hips: { groups: [0], bones: [0], override: { 0: [-0.72, 0.72], 1: [1.30, 1.59], 2: [-0.36, 0.35] } },
    'leg +x': { groups: [0], bones: [2, 6, 7] }, 'leg -x': { groups: [0], bones: [1, 4, 5] },
    torso: { groups: [1], bones: null },
    'arm +x': { groups: [0], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [0], bones: [12, 15], override: { 0: [-1.12, -0.62] } } } },
  mfg: { zone: 'z02LGI', hr: 'MFG_HR.msh', regions: {
    hips: { groups: [0], bones: [0], override: { 1: [1.30, 1.59] } },
    'leg +x': { groups: [5], bones: [2, 6, 7] }, 'leg -x': { groups: [5], bones: [1, 4, 5] },
    torso: { groups: [1, 2, 3], bones: null },
    'arm +x': { groups: [4], bones: [11, 13], override: { 0: [0.62, 1.12] } }, 'arm -x': { groups: [4], bones: [12, 15], override: { 0: [-1.12, -0.62] } } } },
};
const which = process.argv[2] ?? 'pepp', spec = SPECS[which];
const B = loadBody(spec.zone, spec.hr);
const fits = fitsOf(B, spec);
const COL = { hips: [200, 60, 200], 'leg +x': [60, 90, 220], 'leg -x': [60, 140, 255], torso: [220, 60, 60], 'arm +x': [60, 200, 90], 'arm -x': [240, 200, 60] };
const parts = [];
let tot = 0;
for (const id of Object.keys(PARTS)) { const { tris } = partTris(id, fits[id], process.argv[3] ?? 'std'); const n = tris.length / 3; tot += tris.length / 9; parts.push({ pos: tris, idx: Array.from({ length: n }, (_, i) => i), color: COL[id] }); }
console.log('tris', tot);
const orig = (() => { const idx = []; for (const g of B.msh.groups) for (let t = 0; t < g.indexCount; t++) idx.push(B.msh.indices[g.firstIndex + t] + g.firstVertex); return { pos: B.world, idx, color: [150, 150, 150] }; })();
const bb = { lo: [-1.5, -0.1, -1], hi: [1.5, 3.1, 1] };
renderViews(`/tmp/l3d/pv/dev-${which}.png`, [orig], { views: [{ az: 0 }, { az: 90 }], size: 400, bbox: { lo: [-1.7, -0.3, -1.2], hi: [1.7, 3.1, 1.2] } });
renderViews(`/tmp/l3d/pv/dev-${which}-new.png`, parts, { views: [{ az: 0 }, { az: 90 }, { az: 180 }, { az: 35, el: 20 }], size: 400, bbox: { lo: [-1.7, -0.3, -1.2], hi: [1.7, 3.1, 1.2] } });
