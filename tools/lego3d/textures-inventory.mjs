#!/usr/bin/env node
// Which textures of the game depict LEGO surfaces? Every texture of every zone archive that a mesh group uses (texture lists from the executable's zone tables), with: size, alpha, flat / periodic
// (autocorrelation of the luminance at lags N/2, N/4, N/8 in both axes), how the meshes tile it (UV range), and whether the meshes that use it carry stud geometry (inventory.mjs).
// Output: $LE2_LEGO3D/inventory/textures.json and contact sheets of the best candidates.
import fs from 'node:fs';
import path from 'node:path';
import { archive, archiveNames, scene, memberOf, textureOf, contactSheet, WORK } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';

const OUT = path.join(WORK, 'inventory'); fs.mkdirSync(OUT, { recursive: true });
const studOf = new Map();
for (const r of JSON.parse(fs.readFileSync(path.join(OUT, 'meshes.json'), 'utf8'))) studOf.set(`${r.archive}/${r.path.toLowerCase()}`, r.studs);
const lum = (t) => { const o = new Float32Array(t.width * t.height); for (let i = 0; i < o.length; i++) o[i] = 0.3 * t.rgba[i * 4] + 0.59 * t.rgba[i * 4 + 1] + 0.11 * t.rgba[i * 4 + 2]; return o; };
function periodic(t) {
  const W = t.width, H = t.height, L = lum(t);
  let mean = 0; for (const v of L) mean += v; mean /= L.length;
  let varr = 0; for (const v of L) varr += (v - mean) ** 2; varr /= L.length;
  if (varr < 25) return { flat: true, per: 0, sd: Math.sqrt(varr) };
  let best = 0;
  for (const d of [2, 4, 8]) {
    const lx = Math.floor(W / d), ly = Math.floor(H / d);
    if (lx < 2 || ly < 2) continue;
    let cx = 0, cy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = L[y * W + x] - mean; cx += a * (L[y * W + (x + lx) % W] - mean); cy += a * (L[((y + ly) % H) * W + x] - mean); }
    best = Math.max(best, Math.min(cx, cy) / (varr * L.length));
  }
  return { flat: false, per: +best.toFixed(2), sd: +Math.sqrt(varr).toFixed(1) };
}
const rows = [];
const meshCache = new Map();
for (const an of archiveNames()) {
  if (!/^z\d\d/i.test(an)) continue;
  let sc; try { sc = scene(an); } catch { continue; }
  const arch = archive(an);
  const use = new Map();   // tex id -> { groups, tiled, studMesh, meshes:Set }
  const visit = (part) => {
    const mp = sc.meshPaths[part.mesh]; if (!mp) return;
    const mem = memberOf(mp); const key = `${an}/${mem.toLowerCase()}`;
    let m = meshCache.get(key);
    if (m === undefined) { try { m = parseMsh(arch.read(mem)); } catch { m = null; } meshCache.set(key, m); }
    if (!m) return;
    const tl = sc.texLists[part.texList] ?? [];
    m.groups.forEach((g, gi) => {
      const id = tl[gi]; if (id === undefined || id < 0) return;
      const u = use.get(id) ?? { groups: 0, tiled: 0, studMesh: 0, meshes: new Set() };
      let umax = 0, vmax = 0;
      for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) { umax = Math.max(umax, Math.abs(m.uvs[v * 2])); vmax = Math.max(vmax, Math.abs(m.uvs[v * 2 + 1])); }
      u.groups++; if (Math.max(umax, vmax) > 1.5) u.tiled++; if ((studOf.get(key) ?? 0) >= 8) u.studMesh++; u.meshes.add(path.basename(mem));
      use.set(id, u);
    });
  };
  for (const model of sc.models) { for (const p of model.parts) visit(p); for (const a of model.attach) if (a) for (const p of a.child.parts) visit(p); }
  for (const [id, u] of use) {
    const t = textureOf(arch, id); if (!t) continue;
    let alpha = false; for (let i = 3; i < t.rgba.length; i += 4) if (t.rgba[i] < 250) { alpha = true; break; }
    rows.push({ zone: an, id, w: t.width, h: t.height, frames: t.frames ?? 1, alpha, ...periodic(t), groups: u.groups, tiled: u.tiled, studMesh: u.studMesh, meshes: [...u.meshes].slice(0, 6) });
  }
}
fs.writeFileSync(path.join(OUT, 'textures.json'), JSON.stringify(rows));
const n = rows.length;
console.log('textures used by meshes:', n, 'flat colours:', rows.filter((r) => r.flat).length, 'periodic (>0.6):', rows.filter((r) => r.per > 0.6).length, 'on stud meshes:', rows.filter((r) => r.studMesh > 0).length);
const cand = rows.filter((r) => !r.flat && r.per > 0.55 && (r.tiled > 0 || r.studMesh > 0)).sort((a, b) => b.per - a.per);
console.log('candidates (periodic, tiled or on stud meshes):', cand.length);
fs.writeFileSync(path.join(OUT, 'texture-candidates.json'), JSON.stringify(cand));
let k = 0;
for (let i = 0; i < Math.min(cand.length, 96); i += 24) {
  const chunk = cand.slice(i, i + 24);
  contactSheet(path.join(OUT, `tex-cand-${k++}.png`), chunk.map((r) => textureOf(archive(r.zone), r.id)), 96, 8);
  console.log(`sheet ${k - 1}: ` + chunk.map((r, j) => `${j}:${r.zone}#${r.id}(${r.w}x${r.h},p${r.per},st${r.studMesh},t${r.tiled})`).join(' '));
}
