// Shared helpers of the characters builder (tools/lego3d/pack/chars.mjs): the original body in the reference pose, LDraw parts mapped to the game's axes, skin rules.
import path from 'node:path';
import { archive, scene, memberOf } from '../lib.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { parseSvwl, skinPositions, skinNormals, parseBlk, sampleBlk } from '../../../src/formats/anim.ts';

/** the reference (bind) pose: clip 2 frame 0 of the main MFIG.blk. The pack stores these 17 matrices (numbers), the assembler uses them for every zone */
export function refBones(zone = 'z02LGI') {
  const blk = parseBlk(archive(zone).read('anim/MFIG.blk'));
  return Float32Array.from(sampleBlk(blk.skeleton, blk.clips[2], 0));
}
export const BONES = refBones();

export const inv3 = (m) => { const [a, b, c, d, e, f, g, h, i] = m; const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); const s = 1 / det; return [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s]; };
const R3 = (b) => { const M = BONES.subarray(b * 16, b * 16 + 16); return [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]]; };
const invCache = new Map();
const rowMul = (v, m) => [v[0] * m[0] + v[1] * m[3] + v[2] * m[6], v[0] * m[1] + v[1] * m[4] + v[2] * m[7], v[0] * m[2] + v[1] * m[5] + v[2] * m[8]];
export const worldToLocal = (b, p) => { if (!invCache.has(b)) invCache.set(b, inv3(R3(b))); return rowMul([p[0] - BONES[b * 16 + 12], p[1] - BONES[b * 16 + 13], p[2] - BONES[b * 16 + 14]], invCache.get(b)); };

/** an original body mesh of a zone in the reference pose: { msh, sv, world, nrm, inf: per vertex [{bone, w}] } */
export function loadBody(zone, name) {
  const a = archive(zone), msh = parseMsh(a.read(`Meshes/${name}`)), sv = parseSvwl(msh.svwl, msh.vertexCount);
  const world = skinPositions(msh.positions, sv, BONES), nrm = skinNormals(msh.normals, sv, BONES, undefined, true);
  const inf = Array.from({ length: msh.vertexCount }, (_, v) => [{ bone: sv.bone[v], w: sv.weight[v] }]);
  for (let i = 0; i < sv.extra.count; i++) inf[sv.extra.vertex[i]].push({ bone: sv.extra.bone[i], w: sv.extra.weight[i] });
  const groupOf = new Int32Array(msh.vertexCount);
  msh.groups.forEach((g, gi) => { for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) groupOf[v] = gi; });
  return { zone, name, msh, sv, world, nrm, inf, groupOf };
}
/** bounding box of the original vertices of the groups / primary bones given (null = all) */
export function regionBox(B, groups, bones) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let n = 0;
  for (let v = 0; v < B.msh.vertexCount; v++) {
    if (groups && !groups.includes(B.groupOf[v])) continue;
    if (bones && !bones.includes(B.sv.bone[v])) continue;
    n++; for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], B.world[v * 3 + c]); hi[c] = Math.max(hi[c], B.world[v * 3 + c]); }
  }
  return { lo, hi, n };
}

// ---------- skin rules (positions in the reference pose; the bands of docs/re/lego3d.md section 1, read off the original's vertices)
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const norm1 = (inf) => { const t = inf.reduce((s, e) => s + e.w, 0); return inf.filter((e) => e.w > 0.004).map((e) => ({ bone: e.bone, w: e.w / t })).sort((x, y) => y.w - x.w); };
const legSkin = (a, k, f) => (q) => { const y = q[1]; if (y >= 0.81) return [{ bone: a, w: 1 }]; if (y >= 0.41) { const w4 = 0.8 * clamp01((0.81 - y) / 0.4); return norm1([{ bone: a, w: 1 - w4 }, { bone: k, w: w4 }]); } if (y > 0.31) { const s = clamp01((0.41 - y) / 0.1); return norm1([{ bone: a, w: 0.2 * (1 - s) }, { bone: k, w: 0.8 * (1 - s) }, { bone: f, w: s }]); } return [{ bone: f, w: 1 }]; };
const armSkin = (u, l) => (q) => { const y = q[1]; const wl = y >= 2.43 ? 0 : y >= 2.04 ? 0.5 * (2.43 - y) / 0.39 : y >= 1.77 ? 0.5 + 0.5 * (2.04 - y) / 0.27 : 1; return norm1([{ bone: u, w: 1 - wl }, { bone: l, w: wl }]); };
export const SKIN = {
  hips: () => [{ bone: 0, w: 1 }],
  torso: (q) => { const y = q[1]; if (y <= 1.62) return [{ bone: 0, w: 1 }]; if (y < 1.98) { const t = (y - 1.62) / 0.36; return norm1([{ bone: 0, w: 1 - t }, { bone: 3, w: 0.7 * t }, { bone: 8, w: 0.3 * t }]); } if (y < 2.84) { const w8 = 0.3 + 0.7 * (y - 1.98) / 0.86; return norm1([{ bone: 3, w: 1 - w8 }, { bone: 8, w: w8 }]); } return [{ bone: 8, w: 1 }]; },
  'arm +x': armSkin(11, 13), 'arm -x': armSkin(12, 15),
  'leg +x': legSkin(2, 6, 7), 'leg -x': legSkin(1, 4, 5),
};
export const BAND_PLANES = { torso: [1.62, 1.98, 2.27, 2.55, 2.84], 'arm +x': [1.77, 2.04, 2.21, 2.43], 'arm -x': [1.77, 2.04, 2.21, 2.43], 'leg +x': [0.31, 0.41, 0.53, 0.7, 0.81], 'leg -x': [0.31, 0.41, 0.53, 0.7, 0.81], hips: [] };

// ---------- measured skin rules: the original's weights of a region as a function of ONE coordinate along the part (legs, torso: y; arms: along the shoulder -> wrist chain), averaged over a
// window of the original's vertices of that region. Position-only (no 3D proximity: copying the nearest vertex's weights tore thin LEGO geometry apart in motion, docs section 3.1)
/** `pick(v)` selects the original vertices of the region, `axis` = { o: [x,y,z], d: [dx,dy,dz] unit } */
export function kernelSkin(B, pick, axis, window = 0.04) {
  const S = [];
  for (let v = 0; v < B.msh.vertexCount; v++) {
    if (!pick(v)) continue;
    const s = (B.world[v * 3] - axis.o[0]) * axis.d[0] + (B.world[v * 3 + 1] - axis.o[1]) * axis.d[1] + (B.world[v * 3 + 2] - axis.o[2]) * axis.d[2];
    S.push({ s, inf: B.inf[v] });
  }
  S.sort((a, b) => a.s - b.s);
  const fn = (q) => {
    const s = (q[0] - axis.o[0]) * axis.d[0] + (q[1] - axis.o[1]) * axis.d[1] + (q[2] - axis.o[2]) * axis.d[2];
    let w = window, hit = [];
    for (let tries = 0; tries < 8 && !hit.length; tries++, w *= 2) { hit = S.filter((e) => Math.abs(e.s - s) <= w); }
    const m = new Map();
    for (const e of hit) for (const x of e.inf) m.set(x.bone, (m.get(x.bone) ?? 0) + x.w / hit.length);
    return norm1([...m].map(([bone, w]) => ({ bone, w })));
  };
  fn.samples = S.length;
  return fn;
}
/** the L1 distance between a rule and the original's own weights at its vertices (validation: mean, max) */
export function skinError(B, pick, rule) {
  let n = 0, sum = 0, mx = 0;
  for (let v = 0; v < B.msh.vertexCount; v++) {
    if (!pick(v)) continue;
    const pred = rule([B.world[v * 3], B.world[v * 3 + 1], B.world[v * 3 + 2]]), m = new Map();
    for (const e of pred) m.set(e.bone, (m.get(e.bone) ?? 0) + e.w); for (const e of B.inf[v]) m.set(e.bone, (m.get(e.bone) ?? 0) - e.w);
    let d = 0; for (const x of m.values()) d += Math.abs(x); n++; sum += d; mx = Math.max(mx, d);
  }
  return { n, mean: sum / n, max: mx };
}
const bp = (b) => [BONES[b * 16 + 12], BONES[b * 16 + 13], BONES[b * 16 + 14]];
const unit = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return d.map((x) => x / l); };
export const AXIS = {
  y: { o: [0, 0, 0], d: [0, 1, 0] },
  'arm +x': { o: bp(11), d: unit(bp(11), bp(14)) },
  'arm -x': { o: bp(12), d: unit(bp(12), bp(16)) },
};

// ---------- LDraw parts -> game axes
export const applyRot3 = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
/** LDraw triangles (9 floats per triangle, LDU, right-handed, -Y up, front -Z) -> game axes p = -(x, y, z) (a reflection: the winding is reversed) */
export function ldrawToGame(tris) {
  const o = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 9) for (let k = 0; k < 3; k++) { const j = k === 1 ? 2 : k === 2 ? 1 : k; for (let c = 0; c < 3; c++) o[i + j * 3 + c] = -tris[i + k * 3 + c]; }
  return o;
}
export function bbox(tris) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); } return { lo, hi }; }
/** per-axis affine map taking the box `src` onto `dst` (after an optional rotation about z by `rotZ`, applied about `pivot` AFTER the fit) */
export function boxFit(src, dst) {
  const s = [0, 1, 2].map((c) => (dst.hi[c] - dst.lo[c]) / (src.hi[c] - src.lo[c] || 1));
  return { s, o: [0, 1, 2].map((c) => dst.lo[c] - src.lo[c] * s[c]) };
}
export const applyFit = (f, p) => { let q = [p[0] * f.s[0] + f.o[0], p[1] * f.s[1] + f.o[1], p[2] * f.s[2] + f.o[2]]; if (f.rotZ) { const c = Math.cos(f.rotZ), s = Math.sin(f.rotZ), px = f.pivot[0], py = f.pivot[1], dx = q[0] - px, dy = q[1] - py; q = [px + dx * c - dy * s, py + dx * s + dy * c, q[2]]; } return q; };
export function mapTris(tris, fit) { const o = new Float32Array(tris.length); for (let i = 0; i < tris.length; i += 3) o.set(applyFit(fit, [tris[i], tris[i + 1], tris[i + 2]]), i); return o; }

/**
 * The skin rule of a region measured from the original: its vertices sit on rings (equal y); the weights of a ring are the mean of its vertices, between two rings the weights are interpolated
 * linearly (what the original's own triangles do between their vertices), beyond the outer rings they stay. `fn.rings` = [{ y, w: Map(bone -> weight) }] for the band planes.
 */
export function ringSkin(B, pick, tol = 0.012) {
  const pts = [];
  for (let v = 0; v < B.msh.vertexCount; v++) if (pick(v)) pts.push({ y: B.world[v * 3 + 1], inf: B.inf[v] });
  pts.sort((a, b) => a.y - b.y);
  const rings = [];
  for (const p of pts) {
    const last = rings[rings.length - 1];
    if (last && Math.abs(p.y - last.sumY / last.n) <= tol) { last.n++; last.sumY += p.y; for (const e of p.inf) last.m.set(e.bone, (last.m.get(e.bone) ?? 0) + e.w); }
    else rings.push({ n: 1, sumY: p.y, m: new Map(p.inf.map((e) => [e.bone, e.w])) });
  }
  const R = rings.map((r) => ({ y: r.sumY / r.n, w: new Map([...r.m].map(([b, w]) => [b, w / r.n])) }));
  const at = (y) => {
    let w;
    if (y <= R[0].y) w = R[0].w; else if (y >= R[R.length - 1].y) w = R[R.length - 1].w;
    else {
      let i = 0; while (R[i + 1].y < y) i++;
      const a = R[i], b = R[i + 1], t = (y - a.y) / (b.y - a.y);
      w = new Map(); for (const k of new Set([...a.w.keys(), ...b.w.keys()])) w.set(k, (a.w.get(k) ?? 0) * (1 - t) + (b.w.get(k) ?? 0) * t);
    }
    return norm1([...w].map(([bone, w]) => ({ bone, w })));
  };
  const fn = (q) => at(q[1]);
  fn.rings = R; fn.samples = pts.length;
  return fn;
}

/** removes rings whose weights the neighbours' linear interpolation reproduces within `eps` (L1), smallest error first: fewer cut planes, almost the same skin */
export function simplifyRings(R, eps = 0.06) {
  const l1 = (a, b) => { let d = 0; for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)); return d; };
  const lerp = (a, c, t) => { const m = new Map(); for (const k of new Set([...a.w.keys(), ...c.w.keys()])) m.set(k, (a.w.get(k) ?? 0) * (1 - t) + (c.w.get(k) ?? 0) * t); return m; };
  const out = R.slice();
  for (;;) {
    let best = -1, bestE = Infinity;
    for (let i = 1; i < out.length - 1; i++) { const a = out[i - 1], c = out[i + 1], e = l1(lerp(a, c, (out[i].y - a.y) / (c.y - a.y)), out[i].w); if (e < bestE) { bestE = e; best = i; } }
    if (best < 0 || bestE > eps) break;
    out.splice(best, 1);
  }
  return out;
}
/** a skin rule from a (simplified) ring list */
export function ringRule(R) {
  const at = (y) => {
    let w;
    if (y <= R[0].y) w = R[0].w; else if (y >= R[R.length - 1].y) w = R[R.length - 1].w;
    else { let i = 0; while (R[i + 1].y < y) i++; const a = R[i], b = R[i + 1], t = (y - a.y) / (b.y - a.y); w = new Map(); for (const k of new Set([...a.w.keys(), ...b.w.keys()])) w.set(k, (a.w.get(k) ?? 0) * (1 - t) + (b.w.get(k) ?? 0) * t); }
    return norm1([...w].map(([bone, w]) => ({ bone, w })));
  };
  const fn = (q) => at(q[1]); fn.rings = R; return fn;
}

/** removes rings until no two neighbours are closer than `minGap` (the ring whose removal changes the interpolated weights least goes first; the outer two stay): short edges across a steep skin gradient stretch a lot */
export function thinRings(R, minGap) {
  const l1 = (a, b) => { let d = 0; for (const k of new Set([...a.keys(), ...b.keys()])) d += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)); return d; };
  const lerp = (a, c, t) => { const m = new Map(); for (const k of new Set([...a.w.keys(), ...c.w.keys()])) m.set(k, (a.w.get(k) ?? 0) * (1 - t) + (c.w.get(k) ?? 0) * t); return m; };
  const out = R.slice();
  for (;;) {
    let best = -1, bestE = Infinity;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i + 1].y - out[i].y >= minGap) continue;
      for (const j of [i, i + 1]) {
        if (j === 0 || j === out.length - 1) continue;
        const a = out[j - 1], c = out[j + 1], e = l1(lerp(a, c, (out[j].y - a.y) / (c.y - a.y)), out[j].w);
        if (e < bestE) { bestE = e; best = j; }
      }
    }
    if (best < 0) break;
    out.splice(best, 1);
  }
  return out;
}
