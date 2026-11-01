// LEGO 3D characters, LOD pop: when the game switches from one LOD of a character part to the next, the surface jumps by some amount. For every family of LOD members that the generator touches (body HR..BGR
// of the 3 layouts + the space suit, heads, hands) the symmetric mean nearest-surface distance between consecutive LODs (bind pose, the part's own coordinate system, in game units) is measured on the
// ORIGINAL pair and on the MODDED pair (a LOD that stays the game's mesh is the original there). What the player sees is the jump in PIXELS at the distance where the game switches (LOD parts
// start at 20 / 40 / 70 / 100 units; 60 degrees, 600 px high: px = 520 d / switch distance): the mod's pop must stay below 1.5 px and not exceed the original's by more than 20 % + 0.4 px.
// The numbers are also the evidence for docs/re/lego3d.md. Skips with a note without the pack / game folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions } from '../../src/formats/anim.ts';
import { TriSet } from '../../src/mods/lego3d/chars/geo.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');

/** deterministic surface samples of a mesh (area weighted, golden-ratio barycentrics) in the bind pose */
function surface(bytes, bind, n = 300) {
  const m = parseMsh(bytes);
  let pos = m.positions;
  if (m.svwl && bind) pos = skinPositions(m.positions, parseSvwl(m.svwl, m.vertexCount), bind);
  const idx = []; for (const g of m.groups) for (let k = 0; k < g.indexCount; k++) idx.push(m.indices[g.firstIndex + k] + g.firstVertex);
  const tris = idx.length / 3, area = new Float64Array(tris); let tot = 0;
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], w = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    area[t] = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; tot += area[t];
  }
  const pts = [], cum = []; let acc = 0; for (let t = 0; t < tris; t++) { acc += area[t]; cum.push(acc); }
  for (let i = 0; i < n; i++) {
    const r = ((i + 0.5) / n) * tot; let lo = 0, hi = tris - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const t = lo, a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3, u = (i * 0.6180339887) % 1, v = (i * 0.7548776662) % 1, s = u + v > 1 ? [1 - u, 1 - v] : [u, v];
    pts.push([pos[a] + (pos[b] - pos[a]) * s[0] + (pos[c] - pos[a]) * s[1], pos[a + 1] + (pos[b + 1] - pos[a + 1]) * s[0] + (pos[c + 1] - pos[a + 1]) * s[1], pos[a + 2] + (pos[b + 2] - pos[a + 2]) * s[0] + (pos[c + 2] - pos[a + 2]) * s[1]]);
  }
  return { pts, set: new TriSet(pos, idx) };
}
const meanTo = (A, B) => { let s = 0; for (const p of A.pts) s += B.set.closest(p)?.d ?? 0; return s / A.pts.length; };
const pop = (a, b) => (meanTo(a, b) + meanTo(b, a)) / 2;

export default {
  name: 'lego3d-chars-lod',
  async run(ctx) {
    const failures = [], notes = [];
    if (!fs.existsSync(PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    if (!pack.has('chars/tables.json')) return { checked: 0, failures, notes: ['pack has no chars part: skipped'] };
    const t = await pack.json('chars/tables.json');
    const bind = Float32Array.from(t.bind);
    const a = ctx.archives.find((x) => x.name === 'z02LGI');
    if (!a) return { checked: 0, failures, notes: ['no z02LGI archive'] };
    const gen = await generateArchive(pack, 'z02LGI', a, async () => null, ['characters']);
    const get = (name, modded) => { const e = a.find(`Meshes/${name}.msh`); if (!e) return null; const bytes = modded ? gen.files.get(e.path) ?? a.read(e) : a.read(e); return bytes; };
    const families = {
      'body PEPP': ['PEPP_HR', 'PEPP_MR', 'PEPP_LR', 'PEPP_SLR'], 'body MFG': ['MFG_HR', 'MFG_MR', 'MFG_LR', 'MFG_SLR', 'MFG_BGR'], 'body BB': ['BB_HR', 'BB_MR', 'BB_LR', 'BB_SLR', 'BB_BGR'],
      'head INFO': ['INFO_HRhead', 'INFO_MRhead', 'INFO_LRhead', 'INFO_SLRhead', 'INFO_BGRhead'], 'head MAMA': ['MAMA_HRhead', 'MAMA_MRhead', 'MAMA_LRhead', 'MAMA_SLRhead', 'MAMA_BGRhead'], 'head PEPP': ['PEPP_HRhead', 'PEPP_MRhead', 'PEPP_LRhead', 'PEPP_SLRhead'],
      'hand MFG r': ['MFG_HRrhand', 'MFG_MRrhand', 'MFG_LRrhand', 'MFG_SLRrhand', 'MFG_BGRrhand'], 'hand PEPP r': ['PEPP_HRrhand', 'PEPP_MRrhand', 'PEPP_LRrhand', 'PEPP_SLRrhand'],
      'hair JACK': ['JACK_HRhair', 'JACK_MRhair'], 'helmet BSD1': ['BSD1_HRhelmet', 'BSD1_MRhelmet', 'BSD1_LRhelmet'],
    };
    let checked = 0;
    const rows = [], SWITCH = [20, 40, 70, 100], px = (d, i) => (520 * d) / SWITCH[i];
    let worstPx = 0;
    for (const [fam, names] of Object.entries(families)) {
      const O = names.map((n) => { const b = get(n, false); return b ? surface(b, bind) : null; }), M = names.map((n) => { const b = get(n, true); return b ? surface(b, bind) : null; });
      const row = [];
      for (let i = 0; i + 1 < names.length; i++) {
        if (!O[i] || !O[i + 1]) continue;
        const po = pop(O[i], O[i + 1]), pm = pop(M[i], M[i + 1]);
        checked++; row.push(`${names[i].split('_')[1] ?? i}>${names[i + 1].split('_')[1] ?? i + 1} ${po.toFixed(3)}->${pm.toFixed(3)} (${px(po, i).toFixed(1)}->${px(pm, i).toFixed(1)} px)`);
        worstPx = Math.max(worstPx, px(pm, i));
        if (px(pm, i) > Math.max(1.5, px(po, i) * 1.2 + 0.4)) failures.push(`${fam}: LOD pop ${names[i]} -> ${names[i + 1]} is ${pm.toFixed(3)} = ${px(pm, i).toFixed(1)} px at its switch distance (original ${po.toFixed(3)} = ${px(po, i).toFixed(1)} px)`);
      }
      rows.push(`${fam}: ${row.join('  ')}`);
    }
    notes.push('LOD pop (symmetric mean nearest distance between consecutive LODs in game units, and in pixels at the switch distance; original -> mod):', ...rows, `worst mod pop ${worstPx.toFixed(2)} px`);
    return { checked, failures, notes };
  },
};
