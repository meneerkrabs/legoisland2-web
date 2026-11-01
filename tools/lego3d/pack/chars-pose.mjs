// Pose sampling + edge stretch statistics shared by the builder (to pick the skin ring count) and tools/lego3d/pose-check-chars.mjs.
import { archive, archiveNames } from '../lib.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { parseSvwl, skinPositions, parseBlk, sampleBlk } from '../../../src/formats/anim.ts';
import { hashBytes } from '../../../src/mods/lego3d/chars/hash.ts';
import { BONES } from './chars-core.mjs';

let cache = null;
/** the distinct MFIG clips (by content) of every zone, as a list of { skeleton, clip } */
export function distinctClips() {
  if (cache) return cache;
  const clips = new Map();
  for (const n of archiveNames()) {
    if (!/^z\d/.test(n)) continue;
    const a = archive(n), e = a.find('anim/MFIG.blk'); if (!e) continue;
    const blk = parseBlk(a.read(e));
    blk.clips.forEach((c, i) => { if (c.boneCount !== blk.skeleton.boneCount) return; const k = hashBytes(new Uint8Array(c.data.buffer, c.data.byteOffset, c.data.byteLength)); if (!clips.has(k)) clips.set(k, { zone: n, i, skeleton: blk.skeleton, clip: c }); });
  }
  cache = [...clips.values()];
  return cache;
}
/** bone matrices of the poses: every `stride`-th frame of every distinct clip, plus the first and last */
export function poses(stride = 3, clipStride = 1) {
  const out = [];
  distinctClips().forEach(({ skeleton, clip }, ci) => {
    if (ci % clipStride) return;
    const frames = new Set([0, clip.frameCount - 1]);
    for (let f = 0; f < clip.frameCount; f += stride) frames.add(f);
    for (const f of frames) out.push(sampleBlk(skeleton, clip, f));
  });
  return out;
}
/** edge stretch statistics of a skinned body mesh over `P` (matrices): per pose the largest edge length ratio (edges longer than 0.05 in bind) */
export function edgeStretch(bytes, P, groups = null) {
  const m = parseMsh(bytes), sv = parseSvwl(m.svwl, m.vertexCount);
  const bind = skinPositions(m.positions, sv, BONES);
  const edges = [];
  for (const [gi, g] of m.groups.entries()) for (let t = 0; groups ? groups.includes(gi) && t < g.indexCount : t < g.indexCount; t += 3) { const v = [0, 1, 2].map((k) => m.indices[g.firstIndex + t + k] + g.firstVertex); for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) edges.push([v[a], v[b]]); }
  const len = (X, a, b) => Math.hypot(X[a * 3] - X[b * 3], X[a * 3 + 1] - X[b * 3 + 1], X[a * 3 + 2] - X[b * 3 + 2]);
  const l0 = edges.map(([a, b]) => len(bind, a, b));
  const worst = [], X = new Float32Array(m.vertexCount * 3);
  for (const bones of P) { skinPositions(m.positions, sv, bones, X); let mx = 0; for (let i = 0; i < edges.length; i++) if (l0[i] > 0.05) { const r = len(X, edges[i][0], edges[i][1]) / l0[i]; if (r > mx) mx = r; } worst.push(mx); }
  const s = [...worst].sort((a, b) => a - b);
  return { tris: m.indices.length / 3, median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
}

import { distSqPointTri } from '../../../src/mods/lego3d/geom/measure.ts';
/**
 * How far the posed new body drifts from the posed ORIGINAL body: for a sample of the new vertices, the distance to the original's posed surface, over the poses `P`; reported as the 95th
 * percentile in the pose minus the same in the bind pose (the static fit error is not the skin's fault). Needs the original's bytes.
 */
export function poseDeviation(newBytes, origBytes, P, maxVerts = 120) {
  const mk = (b) => { const m = parseMsh(b); return { m, sv: parseSvwl(m.svwl, m.vertexCount) }; };
  const A = mk(newBytes), O = mk(origBytes);
  const tris = []; for (const g of O.m.groups) for (let t = 0; t < g.indexCount; t += 3) tris.push([0, 1, 2].map((k) => O.m.indices[g.firstIndex + t + k] + g.firstVertex));
  const step = Math.max(1, Math.floor(A.m.vertexCount / maxVerts)), picks = []; for (let v = 0; v < A.m.vertexCount; v += step) picks.push(v);
  const dev = (bonesA, bonesO) => {
    const XA = skinPositions(A.m.positions, A.sv, bonesA), XO = skinPositions(O.m.positions, O.sv, bonesO), out = [];
    const T = tris.map((t) => t.map((i) => [XO[i * 3], XO[i * 3 + 1], XO[i * 3 + 2]]));
    for (const v of picks) { const p = [XA[v * 3], XA[v * 3 + 1], XA[v * 3 + 2]]; let best = 1e9; for (const [a, b, c] of T) { const d = distSqPointTri(p, a, b, c); if (d < best) best = d; } out.push(Math.sqrt(best)); }
    return out.sort((x, y) => x - y)[Math.floor(out.length * 0.95)];
  };
  const bind = dev(BONES, BONES);
  const ds = P.map((b) => dev(b, b)).sort((x, y) => x - y);
  return { bind, p50: ds[ds.length >> 1], p95: ds[Math.floor(ds.length * 0.95)], max: ds[ds.length - 1], extra95: ds[Math.floor(ds.length * 0.95)] - bind };
}
