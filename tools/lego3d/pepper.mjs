#!/usr/bin/env node
// Builds Pepper (island, z02LGI) as an LDraw minifig in the game's own .msh format: body (HR / MR / LR / SLR), head, hands. Output: the mod folder
//   node tools/lego3d/pepper.mjs [--mod ~/Documents/legoeiland2-extract/mods/lego3d-pilot] [--preview]
// Method (docs/re/lego3d.md): every LDraw part is fitted (per-axis scale + shift, hands: best of 24 rotations by chamfer distance) to the bounding box of the matching original
// part in bind pose, skin weights are copied from the nearest original vertex (so every animation and bone attachment stays as it was), the original decal groups (prints
// on legs, arms, torso) are kept and draped onto the new surface, groups / texture slots keep the original order per LOD.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, scene, memberOf, EXTRACT } from './lib.mjs';
import { readMesh, bindBones, baseName } from './modelio.mjs';
import { skinPositions, skinNormals } from '../../src/formats/anim.ts';
import { writeMsh } from './mshwrite.mjs';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { bboxPts, rotations24, applyRot, chamfer, samplePts, decimate, weldSmooth, closestFacing, splitAtPlane, pruneHidden, capSmallHoles, norm, cross, sub } from './geom.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const MOD = opt('--mod', path.join(EXTRACT, 'mods/lego3d-pilot'));
const ZONE = 'z02LGI';
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const sc = scene(ZONE);
const model = sc.models.find((m) => m.parts.some((p) => /PEPP_HR\.msh/i.test(sc.meshPaths[p.mesh])));
const { bones } = bindBones(ZONE);
const SOLID = { 374: 'blue', 371: 'red' };           // flat colour textures of the body (hips, legs, arms = blue; torso = red)
const DECAL_LIFT = 0.012;

// ---------- matrices of the bones (row-vector, world = local * R + t)
const inv3 = (m) => { const [a, b, c, d, e, f, g, h, i] = m; const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); const s = 1 / det; return [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s]; };
const R3 = (b) => { const M = bones.subarray(b * 16, b * 16 + 16); return [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]; };
const T3 = (b) => [bones[b * 16 + 12], bones[b * 16 + 13], bones[b * 16 + 14]];
const invCache = new Map();
const rowMul = (v, m) => [v[0] * m[0] + v[1] * m[3] + v[2] * m[6], v[0] * m[1] + v[1] * m[4] + v[2] * m[7], v[0] * m[2] + v[1] * m[5] + v[2] * m[8]];
const worldToLocal = (b, p) => { if (!invCache.has(b)) invCache.set(b, inv3(R3(b))); const t = T3(b); return rowMul([p[0] - t[0], p[1] - t[1], p[2] - t[2]], invCache.get(b)); };
const dirToLocal = (b, d) => { if (!invCache.has(b)) invCache.set(b, inv3(R3(b))); return rowMul(d, invCache.get(b)); };

// ---------- skin weights: LEGO parts are rigid, so every part follows one bone, with a short blend where the original blends (elbow, ankle, neck) and nothing else. The same rule skins the solid
// parts and the decals that lie on them (a decal must move with its surface: nearest-vertex weights from the original tore the thin geometry apart in twisted poses). Heights = the original's
// blend bands in bind pose (documented in docs/re/lego3d.md): torso bone 3 up to y 2.55, bone 8 from 2.85; elbow bone 11/12 above y 2.04, 13/15 below 1.77; ankle bone 2/1 above y 0.41, 7/5 below 0.31.
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const norm1 = (inf) => { const t = inf.reduce((s, e) => s + e.w, 0); return inf.filter((e) => e.w > 0.004).map((e) => ({ bone: e.bone, w: e.w / t })).sort((x, y) => y.w - x.w); };
/** a leg: thigh bone `a` down to y 0.81, knee bone `k` blended in (0.8 at 0.41), the shoe's bone `f` below 0.31 (the original's weights read off its vertices, docs/re/lego3d.md) */
const legSkin = (a, k, f) => (q) => { const y = q[1]; if (y >= 0.81) return [{ bone: a, w: 1 }]; if (y >= 0.41) { const w4 = 0.8 * clamp01((0.81 - y) / 0.4); return norm1([{ bone: a, w: 1 - w4 }, { bone: k, w: w4 }]); } if (y > 0.31) { const s = clamp01((0.41 - y) / 0.1); return norm1([{ bone: a, w: 0.2 * (1 - s) }, { bone: k, w: 0.8 * (1 - s) }, { bone: f, w: s }]); } return [{ bone: f, w: 1 }]; };
/** an arm: shoulder bone `u` above y 2.43, half-and-half at 2.04, the forearm bone `l` below 1.77 */
const armSkin = (u, l) => (q) => { const y = q[1]; const wl = y >= 2.43 ? 0 : y >= 2.04 ? 0.5 * (2.43 - y) / 0.39 : y >= 1.77 ? 0.5 + 0.5 * (2.04 - y) / 0.27 : 1; return norm1([{ bone: u, w: 1 - wl }, { bone: l, w: wl }]); };
const SKIN = {
  hips: () => [{ bone: 0, w: 1 }],
  torso: (q) => { const y = q[1]; if (y <= 1.62) return [{ bone: 0, w: 1 }]; if (y < 1.98) { const t = (y - 1.62) / 0.36; return norm1([{ bone: 0, w: 1 - t }, { bone: 3, w: 0.7 * t }, { bone: 8, w: 0.3 * t }]); } if (y < 2.84) { const w8 = 0.3 + 0.7 * (y - 1.98) / 0.86; return norm1([{ bone: 3, w: 1 - w8 }, { bone: 8, w: w8 }]); } return [{ bone: 8, w: 1 }]; },
  'arm +x': armSkin(11, 13), 'arm -x': armSkin(12, 15),
  'leg +x': legSkin(2, 6, 7), 'leg -x': legSkin(1, 4, 5),
};
/** the planes a part is cut at so that the skin blend has vertices to act on: all of them at HR, every other one at MR, the band edges only at LR */
const bandPlanes = (name, level) => { const all = BAND_PLANES[name] ?? []; if (level === 'all') return all; if (level === 'some') return all.filter((_, i) => i % 2 === 0 || i === all.length - 1); return all.length > 2 ? [all[0], all[1], all[all.length - 1]] : all; };
const BAND_PLANES = { torso: [1.62, 1.98, 2.27, 2.55, 2.84], 'arm +x': [1.77, 2.04, 2.21, 2.43], 'arm -x': [1.77, 2.04, 2.21, 2.43], 'leg +x': [0.31, 0.41, 0.53, 0.7, 0.81], 'leg -x': [0.31, 0.41, 0.53, 0.7, 0.81] };
// ---------- the original body: world positions + influences
function origBody(name) {
  const r = readMesh(ZONE, `_data\\${ZONE}\\Meshes\\${name}`);
  const world = skinPositions(r.msh.positions, r.sv, bones), nrm = skinNormals(r.msh.normals, r.sv, bones, undefined, true);
  const inf = Array.from({ length: r.msh.vertexCount }, (_, v) => [{ bone: r.sv.bone[v], w: r.sv.weight[v], local: [r.msh.positions[v * 3], r.msh.positions[v * 3 + 1], r.msh.positions[v * 3 + 2]] }]);
  const e = r.sv.extra;
  for (let i = 0; i < e.count; i++) inf[e.vertex[i]].push({ bone: e.bone[i], w: e.weight[i], local: [e.local[i * 3], e.local[i * 3 + 1], e.local[i * 3 + 2]] });
  return { ...r, world, nrm, inf };
}
const HR = origBody('PEPP_HR.msh');
const texOf = (modelPartIndex) => sc.texLists[model.parts[modelPartIndex].texList];
const solidVerts = [];  // HR solid group vertices: { v, group, bone }
HR.msh.groups.forEach((g, gi) => { if (SOLID[texOf(0)[gi]]) for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) solidVerts.push({ v, gi }); });
const regionBox = (bonesSet, texId) => {
  const pts = [];
  HR.msh.groups.forEach((g, gi) => { if (texId !== undefined && texOf(0)[gi] !== texId) return; for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) if (!bonesSet || bonesSet.includes(HR.sv.bone[v])) pts.push(HR.world[v * 3], HR.world[v * 3 + 1], HR.world[v * 3 + 2]); });
  return bboxPts(pts);
};
/** lean of the shoulder -> elbow bone chain in bind pose (tried: tilting the LDraw arm by it leaves a gap at the torso, the arm is narrower than the original's: off, `tilt: 0`) (radians, positive = the lower end moves toward +x) */
const armTilt = (a, b) => Math.atan2(bones[b * 16 + 12] - bones[a * 16 + 12], bones[a * 16 + 13] - bones[b * 16 + 13]);
const BODY_PARTS = [
  { ld: '3815b.dat', tex: 374, box: regionBox([0], 374), name: 'hips', src: [0] },
  { ld: '3816.dat', tex: 374, box: regionBox([2, 6, 7], 374), name: 'leg +x', src: [2, 6, 7] },
  { ld: '3817.dat', tex: 374, box: regionBox([1, 4, 5], 374), name: 'leg -x', src: [1, 4, 5] },
  { ld: '973.dat', tex: 371, box: regionBox(null, 371), name: 'torso', src: [0, 3, 8] },
  { ld: '3818.dat', tex: 374, box: regionBox([11, 13], 374), name: 'arm +x', src: [11, 13], sleeve: { width: 0.5, outer: 1.12, side: 1 }, tilt: 0 * armTilt(11, 13) },
  { ld: '3819.dat', tex: 374, box: regionBox([12, 15], 374), name: 'arm -x', src: [12, 15], sleeve: { width: 0.5, outer: 1.12, side: -1 }, tilt: 0 * armTilt(12, 15) },
];
// LDraw -> game: p = -(x, y, z) (LDraw is right-handed with -Y up and the front at -Z; the game is left-handed, +Y up, front +Z); a reflection, so the winding is reversed
const mapTris = (tris, fit) => { const o = new Float32Array(tris.length); for (let i = 0; i < tris.length; i += 9) { for (let k = 0; k < 3; k++) { const p = applyFit(fit, [-tris[i + k * 3], -tris[i + k * 3 + 1], -tris[i + k * 3 + 2]]); const j = k === 1 ? 2 : k === 2 ? 1 : k; o[i + j * 3] = p[0]; o[i + j * 3 + 1] = p[1]; o[i + j * 3 + 2] = p[2]; } } return o; };
const applyFit = (f, p) => { const q = f.rot ? applyRot(f.rot, p) : p; return [q[0] * f.s[0] + f.o[0], q[1] * f.s[1] + f.o[1], q[2] * f.s[2] + f.o[2]]; };
/** fit of a (mapped, i.e. already negated) bbox onto a target bbox: per-axis scale + shift */
function fitBox(src, dst, rot = null) {
  const s = [0, 1, 2].map((c) => (dst.hi[c] - dst.lo[c]) / (src.hi[c] - src.lo[c] || 1));
  const o = [0, 1, 2].map((c) => dst.lo[c] - src.lo[c] * s[c]);
  return { s, o, rot };
}
const negBox = (b) => ({ lo: b.hi.map((v) => -v), hi: b.lo.map((v) => -v) });

/** the far LODs: HR 0-20 and MR 20-40 are rebuilt, LR (40-70) simplified from the low-resolution parts; SLR (70+, a few dozen pixels high) stays the game's own: clustering a 3 px grid over it leaves holes (docs/re/lego3d.md) */
const LODS = [
  { name: 'HR', res: 'std', skip: null, dec: 0, bands: 'all', maxe: 0.35 },
  { name: 'MR', res: 'low', skip: null, dec: 0, bands: 'some', maxe: 0.7 },
  { name: 'LR', res: 'low', skip: /stud/, dec: 0.1, bands: 'min', maxe: 1.2, cross: true },
];

function buildBody(lod, li) {
  const orig = lod.name === 'HR' ? HR : origBody(`PEPP_${lod.name}.msh`);
  const texList = texOf(li);
  const solidTris = {};   // tex -> world triangles
  const partTris = {};    // part name -> world triangles
  const partTrisOrig = {};
  const pruned = {};
  const solidInfo = [];   // every new solid vertex: part, world position, influences (decals take theirs from the surface they sit on)
  for (const part of BODY_PARTS) {
    const f = lib.flatten(part.ld, { res: lod.res, skip: lod.skip });
    // the arms hang along the bone chain shoulder -> elbow, which in the original's bind pose leans outward (about 17 deg): the LDraw arm is tilted the same way before the box fit
    let rot = null;
    if (part.tilt) { const c = Math.cos(part.tilt), s = Math.sin(part.tilt); rot = [c, -s, 0, s, c, 0, 0, 0, 1]; }
    const negAll = Float32Array.from(f.tris, (v) => -v);
    const rotated = rot ? negAll.map((_, i) => 0) : negAll;
    if (rot) for (let i = 0; i < negAll.length; i += 3) rotated.set(applyRot(rot, [negAll[i], negAll[i + 1], negAll[i + 2]]), i);
    const neg = bboxPts(rotated);
    const fit = fitBox(neg, part.box, rot);
    if (part.sleeve) {   // arms: the sleeve (LDraw 10.1 wide, the shoulder hinge on top reaches 7 LDU further in) gets the original's sleeve thickness and its outer face the original's outer edge; the hinge then sits inside the torso
      const sx = part.sleeve.width / 10.1; fit.s[0] = sx; fit.o[0] = part.sleeve.side * (part.sleeve.outer - 10.1 * sx);
    }
    let tris = mapTris(f.tris, fit);
    if (lod.dec) tris = decimate(tris, lod.dec);
    for (const y of bandPlanes(part.name, lod.bands)) tris = splitAtPlane(tris, 1, y);   // vertices at the edges of the blend bands, or a long face across the joint stretches
    (solidTris[part.tex] ??= []).push(tris);
    partTris[part.name] = tris; partTrisOrig[part.name] = tris;
  }
  // (LR, 40+ units, also drops the faces that another part covers)
  // inner walls and sockets of a part are never seen: dropped (every LOD); faces that only ANOTHER part covers stay (a face half under an arm left a hole in the torso side)
  const everything = Float32Array.from(Object.values(partTris).flatMap((a) => [...a]));
  for (const part of BODY_PARTS) { let t = pruneHidden(partTris[part.name], lod.cross ? everything : partTris[part.name]); const cap = capSmallHoles(t); t = cap.tris; if (cap.capped) console.log(`${lod.name} ${part.name}: ${cap.capped} small holes capped`); partTris[part.name] = t; pruned[part.name] = t; }   // against the part itself only: a big torso side face that an arm covers in part must stay
  const groups = [];
  texList.forEach((tex, gi) => {
    const og = orig.msh.groups[gi];
    if (SOLID[tex]) {
      // every LDraw part is welded on its own and takes its skin weights from the original vertices of the matching region only (nearest vertex among the bones in `src`): a vertex at the
      // crotch must not be hung on the other leg, a torso vertex not on an arm (nearest over everything tore the legs in motion: max edge stretch 12x against 3x in the original)
      const pos = [], nrm = [], idx = [], bone = [], weight = [], lc = [], extra = [];
      for (const part of BODY_PARTS.filter((q) => q.tex === tex)) {
        const w = weldSmooth(pruned[part.name], 38), base = pos.length / 3, n = w.pos.length / 3;
        for (let v = 0; v < n; v++) {
          const q = [w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]];
          const inf = SKIN[part.name](q), p0 = inf[0];
          solidInfo.push({ part: part.name, q, inf });
          bone.push(p0.bone); weight.push(p0.w);
          lc.push(...worldToLocal(p0.bone, q));
          pos.push(...q);
          for (const e of inf.slice(1)) extra.push({ v: base + v, bone: e.bone, weight: e.w, local: worldToLocal(e.bone, q) });
        }
        for (const i of w.idx) idx.push(base + i);
        // lighting parity for every solid part: the big flat LDraw faces caught the skinned meshes' specular term where the original's rounded normals do not (a salmon torso, pale blue legs in motion): the original's nearest normals
        {
          const cand = solidVerts.filter((sv) => part.src.includes(HR.sv.bone[sv.v]));
          for (let v = 0; v < n; v++) {
            const q = [w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]];
            const near = cand.map((sv) => ({ sv, d: (HR.world[sv.v * 3] - q[0]) ** 2 + (HR.world[sv.v * 3 + 1] - q[1]) ** 2 + (HR.world[sv.v * 3 + 2] - q[2]) ** 2 })).sort((x, y) => x.d - y.d).slice(0, 4);
            let x = 0, y = 0, z = 0;
            for (const { sv, d } of near) { const k = 1 / (d + 1e-4); x += HR.nrm[sv.v * 3] * k; y += HR.nrm[sv.v * 3 + 1] * k; z += HR.nrm[sv.v * 3 + 2] * k; }
            const l = Math.hypot(x, y, z) || 1; w.nrm[v * 3] = x / l; w.nrm[v * 3 + 1] = y / l; w.nrm[v * 3 + 2] = z / l;
          }
        }
        nrm.push(...w.nrm);
      }
      const nn = pos.length / 3, bone32 = Int32Array.from(bone);
      groups.push({ flags: og.flags, pos: Float32Array.from(lc), nrm: rotNormals(Float32Array.from(nrm), bone32), uv: new Float32Array(nn * 2).fill(0.5), idx, skin: { bone: bone32, weight: Float32Array.from(weight), extra } });
    } else {
      groups.push(copyDecal(orig, gi, partTris, solidInfo, lod.maxe));
    }
  });
  return { bytes: writeMsh(groups, { skinned: true }), groups };
}
/** world normals -> the primary bone's local space (the game rotates the stored normal with the bone matrix again) */
function rotNormals(nw, bone) { const o = new Float32Array(nw.length); for (let v = 0; v < bone.length; v++) { const l = dirToLocal(bone[v], [nw[v * 3], nw[v * 3 + 1], nw[v * 3 + 2]]); o.set(l, v * 3); } return o; }

/** an original decal group kept as it is, but lifted onto the new surface along its normal */
const BONE_PARTS = { 0: ['torso', 'hips'], 3: ['torso'], 8: ['torso'], 1: ['leg -x'], 4: ['leg -x'], 5: ['leg -x'], 2: ['leg +x'], 6: ['leg +x'], 7: ['leg +x'], 11: ['arm +x'], 13: ['arm +x'], 12: ['arm -x'], 15: ['arm -x'] };
function copyDecal(orig, gi, partTris, solidInfo, MAXE) {
  const g = orig.msh.groups[gi];
  // the original decal's triangles with world-space attributes, subdivided until no edge is longer than MAXE (a decal that is two big triangles cannot follow a surface whose skin weights change
  // along it: it came away from the torso in twisted poses)
  const V = (v) => ({ p: [orig.world[v * 3], orig.world[v * 3 + 1], orig.world[v * 3 + 2]], n: [orig.nrm[v * 3], orig.nrm[v * 3 + 1], orig.nrm[v * 3 + 2]], uv: [orig.msh.uvs[v * 2], orig.msh.uvs[v * 2 + 1]], inf: orig.inf[v] });
  const mid = (a, b) => ({ p: a.p.map((x, i) => (x + b.p[i]) / 2), n: a.n.map((x, i) => (x + b.n[i]) / 2), uv: a.uv.map((x, i) => (x + b.uv[i]) / 2), inf: a.inf });
  const dist = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
  const tris = [];
  const split = (a, b, c, depth) => {
    if (depth > 4 || Math.max(dist(a, b), dist(b, c), dist(c, a)) <= MAXE) { tris.push([a, b, c]); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    split(a, ab, ca, depth + 1); split(ab, b, bc, depth + 1); split(ca, bc, c, depth + 1); split(ab, bc, ca, depth + 1);
  };
  for (let t = 0; t < g.indexCount; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => V(orig.msh.indices[g.firstIndex + t + k] + g.firstVertex));
    split(a, b, c, 0);
  }
  const verts = tris.flat(), n = verts.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), bone = new Int32Array(n), weight = new Float32Array(n), extra = [];
  const idx = Array.from({ length: n }, (_, i) => i);
  // planar decal (all normals alike: the torso print): one lift for all, the largest distance to the new surface
  const nn0 = verts.map((v) => norm(v.n));
  const planar = nn0.every((x) => x[0] * nn0[0][0] + x[1] * nn0[0][1] + x[2] * nn0[0][2] > 0.97);
  const namesOf = (inf) => [...new Set(inf.filter((e) => e.w >= 0.25).flatMap((e) => BONE_PARTS[e.bone] ?? []))];
  const hits = verts.map((v, i) => { const names = namesOf(v.inf); const cand = Float32Array.from(names.flatMap((nm) => [...partTris[nm]])); return { names, hit: closestFacing(v.p, nn0[i], cand, 0.5, 0.35) }; });
  let planarShift = null;
  if (planar) for (let i = 0; i < n; i++) { const h = hits[i].hit; if (!h) continue; const d = (h.q[0] - verts[i].p[0]) * nn0[i][0] + (h.q[1] - verts[i].p[1]) * nn0[i][1] + (h.q[2] - verts[i].p[2]) * nn0[i][2] + DECAL_LIFT; if (planarShift === null || d > planarShift) planarShift = d; }
  let moved = 0, missed = 0;
  for (let i = 0; i < n; i++) {
    const v = verts[i], h = hits[i].hit, nw = nn0[i];
    let shift = [0, 0, 0];
    if (planarShift !== null) { shift = nw.map((x) => x * planarShift); moved++; }
    else if (h) { shift = [h.q[0] + h.n[0] * DECAL_LIFT - v.p[0], h.q[1] + h.n[1] * DECAL_LIFT - v.p[1], h.q[2] + h.n[2] * DECAL_LIFT - v.p[2]]; moved++; } else missed++;
    const fin = [v.p[0] + shift[0], v.p[1] + shift[1], v.p[2] + shift[2]];
    // skin weights of the nearest new vertex of the part it lies on: the decal moves with that surface
    let bestD = 1e18, bpart = hits[i].names[0] ?? 'torso';
    const pickFrom = (restrict) => { for (const si of solidInfo) { if (restrict && !hits[i].names.includes(si.part)) continue; const d = (si.q[0] - fin[0]) ** 2 + (si.q[1] - fin[1]) ** 2 + (si.q[2] - fin[2]) ** 2; if (d < bestD) { bestD = d; bpart = si.part; } } };
    pickFrom(hits[i].names.length > 0);
    const binf = SKIN[bpart](fin);
    bone[i] = binf[0].bone; weight[i] = binf[0].w;
    pos.set(worldToLocal(binf[0].bone, fin), i * 3);
    for (const e of binf.slice(1)) extra.push({ v: i, bone: e.bone, weight: e.w, local: worldToLocal(e.bone, fin) });
    nrm.set(dirToLocal(binf[0].bone, norm(v.n)), i * 3);
    uv.set(v.uv, i * 2);
  }
  return { flags: g.flags, pos, nrm, uv, idx, skin: { bone, weight, extra }, note: { moved, missed } };
}

// ---------- head and hands (static meshes in the attachment bone's local space)
function plainGroup(tris, nrmFix, flags, uvFn) {
  const w = weldSmooth(tris, 38), n = w.pos.length / 3, uv = new Float32Array(n * 2).fill(0.5);
  if (uvFn) for (let v = 0; v < n; v++) { const [u, vv] = uvFn([w.pos[v * 3], w.pos[v * 3 + 1], w.pos[v * 3 + 2]]); uv[v * 2] = u; uv[v * 2 + 1] = vv; }
  return { flags, pos: w.pos, nrm: w.nrm, uv, idx: w.idx };
}
function copyStatic(orig, gi) {
  const m = orig.msh, g = m.groups[gi];
  return { flags: g.flags, pos: m.positions.slice(g.firstVertex * 3, (g.firstVertex + g.vertexCount) * 3), nrm: m.normals.slice(g.firstVertex * 3, (g.firstVertex + g.vertexCount) * 3), uv: m.uvs.slice(g.firstVertex * 2, (g.firstVertex + g.vertexCount) * 2), idx: Array.from(m.indices.subarray(g.firstIndex, g.firstIndex + g.indexCount)) };
}
const attach = (slot) => model.attach[slot];
function staticOrig(slot, lodName) { const a = attach(slot); const name = baseName(sc.meshPaths[a.child.parts[LODS.findIndex((l) => l.name === lodName)].mesh]); return { r: readMesh(ZONE, `_data\\${ZONE}\\Meshes\\${name}`), name, texList: sc.texLists[a.child.parts[LODS.findIndex((l) => l.name === lodName)].texList] }; }

/** lighting parity: the original head's normals are not radial (mean radial dot 0.72 / 0.93), which reads brighter under the island's light; blend the LDraw normals toward +Y by this much */
const HEAD_TILT = 0.45;
/** lighting parity: the normals of the original's nearest vertices (inverse-distance mean of 4) replace the LDraw ones, so the head and hands get the original's cartoon shading under the island light */
function takeNormals(g, orig, groupIdx) {
  const m = orig.msh, cand = [];
  for (const gi of groupIdx) { const og = m.groups[gi]; for (let v = og.firstVertex; v < og.firstVertex + og.vertexCount; v++) cand.push(v); }
  for (let v = 0; v < g.pos.length / 3; v++) {
    const near = cand.map((c) => ({ c, d: (m.positions[c * 3] - g.pos[v * 3]) ** 2 + (m.positions[c * 3 + 1] - g.pos[v * 3 + 1]) ** 2 + (m.positions[c * 3 + 2] - g.pos[v * 3 + 2]) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 4);
    let x = 0, y = 0, z = 0;
    for (const { c, d } of near) { const k = 1 / (d + 1e-4); x += m.normals[c * 3] * k; y += m.normals[c * 3 + 1] * k; z += m.normals[c * 3 + 2] * k; }
    const l = Math.hypot(x, y, z) || 1; g.nrm[v * 3] = x / l; g.nrm[v * 3 + 1] = y / l; g.nrm[v * 3 + 2] = z / l;
  }
  return g;
}
function tiltUp(g, k) { for (let v = 0; v < g.nrm.length / 3; v++) { const x = g.nrm[v * 3], y = g.nrm[v * 3 + 1] + k, z = g.nrm[v * 3 + 2]; const l = Math.hypot(x, y, z) || 1; g.nrm[v * 3] = x / l; g.nrm[v * 3 + 1] = y / l; g.nrm[v * 3 + 2] = z / l; } return g; }
const FACE = { x: 0.35, y0: 0.30, y1: 0.92 };
function buildHead(lod) {
  const { r, name, texList } = staticOrig(4, lod.name);
  const hr = staticOrig(4, 'HR');
  const skinG = hr.r.msh.groups[hr.texList.indexOf(361)];
  const pts = hr.r.msh.positions.subarray(skinG.firstVertex * 3, (skinG.firstVertex + skinG.vertexCount) * 3);
  const box = bboxPts(pts);
  const f = lib.flatten('3626b.dat', { res: lod.res, skip: lod.skip });
  // fit the head body (LDraw y 0..24 below the stud base) to the original skin group; the stud sticks out above
  const body = bboxPts(Float32Array.from(f.tris.filter((_, i) => true)).filter(() => true));
  const bodyTris = []; for (let i = 0; i < f.tris.length; i += 9) { if (Math.min(f.tris[i + 1], f.tris[i + 4], f.tris[i + 7]) >= -0.001) bodyTris.push(...f.tris.subarray(i, i + 9)); }
  const bb = bboxPts(Float32Array.from(bodyTris, (v) => -v));
  const fit = fitBox({ lo: bb.lo, hi: bb.hi }, { lo: box.lo, hi: box.hi });
  let tris = mapTris(f.tris, fit);
  if (lod.dec) tris = decimate(tris, lod.dec * 0.5);
  tris = pruneHidden(tris, tris);
  tris = splitAtPlane(tris, 1, FACE.y0);
  const faceT = [], skinT = [];
  for (let i = 0; i < tris.length; i += 9) {
    const xs = [tris[i], tris[i + 3], tris[i + 6]], ys = [tris[i + 1], tris[i + 4], tris[i + 7]], zs = [tris[i + 2], tris[i + 5], tris[i + 8]];
    const cx = (xs[0] + xs[1] + xs[2]) / 3, cy = (ys[0] + ys[1] + ys[2]) / 3, cz = (zs[0] + zs[1] + zs[2]) / 3;
    const inFace = Math.abs(cx) <= FACE.x && cy >= FACE.y0 && cy <= FACE.y1 && cz > 0.1;
    (inFace ? faceT : skinT).push(...tris.subarray(i, i + 9));
  }
  const faceUv = (p) => { const u = (p[0] + FACE.x) / (2 * FACE.x), v = 0.92 * (p[1] - FACE.y0) / (FACE.y1 - FACE.y0); return [u / 4, 1 + (v - 1) / 4]; };
  const groups = texList.map((tex, gi) => {
    const keep = texList.map((t, i) => (t === 361 || t === 473 ? i : -1)).filter((i) => i >= 0);
    if (tex === 361) return takeNormals(plainGroup(Float32Array.from(skinT), null, r.msh.groups[gi].flags), r, keep);
    if (tex === 473) return takeNormals(plainGroup(Float32Array.from(faceT), null, r.msh.groups[gi].flags, faceUv), r, keep);
    return copyStatic(r, gi);
  });
  return { name, bytes: writeMsh(groups, { identityMatl: true }), groups };
}

function buildHand(slot, lod) {
  const { r, name } = staticOrig(slot, lod.name);
  const hr = staticOrig(slot, 'HR');
  const hbox = bboxPts(hr.r.msh.positions);
  const f = lib.flatten('3820.dat', { res: lod.res, skip: lod.skip });
  // cut the long wrist peg (LDraw z > 4, the claw is z -16..-3): the arm has its own
  const kept = []; for (let i = 0; i < f.tris.length; i += 9) { if ((f.tris[i + 2] + f.tris[i + 5] + f.tris[i + 8]) / 3 < 4) kept.push(...f.tris.subarray(i, i + 9)); }
  const handLd = Float32Array.from(kept);
  const key = `hand${slot}`;
  if (!buildHand.fit) buildHand.fit = {};
  if (!buildHand.fit[key]) {
    const ref = samplePts(Float32Array.from(Array.from({ length: hr.r.msh.indices.length / 3 }, (_, t) => [0, 1, 2].flatMap((k) => { const v = hr.r.msh.indices[t * 3 + k] + hr.r.msh.groups[0].firstVertex; return [hr.r.msh.positions[v * 3], hr.r.msh.positions[v * 3 + 1], hr.r.msh.positions[v * 3 + 2]]; })).flat()));
    const std = lib.flatten('3820.dat', { res: 'std' });
    const stdKept = []; for (let i = 0; i < std.tris.length; i += 9) { if ((std.tris[i + 2] + std.tris[i + 5] + std.tris[i + 8]) / 3 < 4) stdKept.push(...std.tris.subarray(i, i + 9)); }
    let best = null;
    for (const rot of rotations24()) {
      const neg = Float32Array.from(stdKept, (v) => -v);
      const rotated = new Float32Array(neg.length);
      for (let i = 0; i < neg.length; i += 3) rotated.set(applyRot(rot, [neg[i], neg[i + 1], neg[i + 2]]), i);
      const fit = fitBox(bboxPts(rotated), hbox, rot);
      const pts = samplePts(rotated).map((v, i) => v * fit.s[i % 3] + fit.o[i % 3]);
      const d = chamfer(pts, ref);
      if (!best || d < best.d) best = { d, fit, rot };
    }
    buildHand.fit[key] = best;
    console.log(`hand slot ${slot}: best rotation chamfer ${best.d.toFixed(4)} rot ${best.rot.join(',')}`);
  }
  const { fit } = buildHand.fit[key];
  let tris = mapTris(handLd, fit);
  // mapTris applies applyFit with fit.rot after the negation: same order as the search above
  if (lod.dec) tris = decimate(tris, lod.dec * 0.5);
  tris = pruneHidden(tris, tris);
  const groups = [takeNormals(plainGroup(tris, null, r.msh.groups[0].flags), r, [0])];
  return { name, bytes: writeMsh(groups, { identityMatl: true }), groups };
}

// ---------- write
const outDir = path.join(MOD, '_data', ZONE, 'meshes');
fs.mkdirSync(outDir, { recursive: true });
const report = [];
const put = (name, bytes, groups) => {
  fs.writeFileSync(path.join(outDir, name), bytes);
  const m = parseMsh(bytes), problems = validateMsh(m);
  report.push({ name, verts: m.vertexCount, tris: m.indices.length / 3, groups: m.groups.length, bytes: bytes.length, problems });
  if (problems.length) console.log('PROBLEMS', name, problems);
  const notes = groups.map((g) => g.note).filter(Boolean);
  if (notes.length) console.log(name, 'decals draped (moved/missed):', notes.map((n) => `${n.moved}/${n.missed}`).join(' '));
};
LODS.forEach((lod, li) => {
  const b = buildBody(lod, li);
  put(`PEPP_${lod.name}.msh`, b.bytes, b.groups);
  const h = buildHead(lod); put(h.name, h.bytes, h.groups);
  for (const slot of [6, 8]) { const hd = buildHand(slot, lod); put(hd.name, hd.bytes, hd.groups); }
});
console.table(report);
fs.writeFileSync(path.join(WORKDIR(), 'pepper-report.json'), JSON.stringify(report, null, 1));
function WORKDIR() { const d = path.join(EXTRACT, 'lego3d'); fs.mkdirSync(d, { recursive: true }); return d; }
