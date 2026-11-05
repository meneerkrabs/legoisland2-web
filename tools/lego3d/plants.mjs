// Plants and rocks from LDraw-style parts (docs/re/lego3d.md section 19, generator `plants`): a spec is a list of instances in the game's frame, each either
//   * a body of revolution (`lathe: true`): a profile [{ y, r }] revolved in n sides (flat caps), fitted to a box: box.y = [y0, y1], box.r = the largest radius, box.aspect stretches z (an oval seen from above);
//     the pine and oak are stacks of round plates, i.e. step profiles (a step = two points at the same y), or
//   * a real LDraw part (`part: '30294c01'`) fitted to a target box { x, y, z } with a non-uniform scale and a turn about y (the rock experiment, tools/lego3d/plants-rockfit.mjs): its hollow underside is closed,
//     it is decimated (coplanar merges) and gets crease-welded normals.
//   spec = { parts: [{ lathe: true, profile, n: 8, phase: 22.5, box: { y: [0.5, 4], r: 1.3 }, group: 1 }, { part: '30294c01', rotY: 60, box: { x: [..], y: [..], z: [..] }, res: 'low', group: 0 }] }
//   buildPlant(spec, { maxCost, crease }) -> { groups: [{ pos, nrm, idx }] (one per game group, in group order), tris, perPart }
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW } from './lib.mjs';
import { closeBottom, simplify } from './brickmesh.mjs';
const S = 0.04;
let _lib = null;
export const ldLib = () => (_lib ??= new LDrawLib(path.join(LDRAW, 'lib/ldraw')));
const cache = new Map();
/** the part's triangles in the game's frame (p = -(x, y, z) * 0.04, winding reversed), studs left out unless asked; { tris, colors, info, infos, lo, hi } */
export function partGame(file, res = 'std', studs = false) {
  const key = `${file}|${res}|${studs}`;
  if (cache.has(key)) return cache.get(key);
  const r = ldLib().flatten(`${file}.dat`, { res, skip: studs ? undefined : /^stud/ });
  const t = new Float32Array(r.tris.length), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < r.tris.length; i += 9) for (let k = 0; k < 3; k++) {
    const j = k === 1 ? 2 : k === 2 ? 1 : k;
    for (let c = 0; c < 3; c++) { const v = -r.tris[i + k * 3 + c] * S; t[i + j * 3 + c] = v; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  }
  const colors = new Uint16Array(r.colors.length);
  for (let i = 0; i < colors.length; i++) colors[i] = r.colors[i];
  const o = { tris: t, colors, info: r.info, infos: r.infos, lo, hi };
  cache.set(key, o);
  return o;
}
/** places a part's game-frame triangles into a target box (per axis [lo, hi]; null = keep the span, x / z centred on 0) after a turn of rotY degrees about +Y */
export function fitInstance(inst) {
  const p = partGame(inst.part, inst.res ?? 'std', !!inst.studs);
  const ry = ((inst.rotY ?? 0) * Math.PI) / 180, cs = Math.cos(ry), sn = Math.sin(ry);
  let tris = p.tris;
  if (ry) { tris = new Float32Array(p.tris.length); for (let i = 0; i < tris.length; i += 3) { const x = p.tris[i], z = p.tris[i + 2]; tris[i] = x * cs + z * sn; tris[i + 1] = p.tris[i + 1]; tris[i + 2] = -x * sn + z * cs; } }
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); }
  const box = inst.box ?? {}, sc = [1, 1, 1], off = [0, 0, 0];
  ['x', 'y', 'z'].forEach((a, c) => {
    const t = box[a];
    if (!t) { off[c] = c === 1 ? 0 : -(lo[c] + hi[c]) / 2; return; }
    sc[c] = (t[1] - t[0]) / (hi[c] - lo[c]);
    off[c] = c === 1 ? t[0] - lo[c] * sc[c] : (t[0] + t[1]) / 2 - ((lo[c] + hi[c]) / 2) * sc[c];
  });
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) out[i + c] = tris[i + c] * sc[c] + off[c];
  return { tris: out, colors: p.colors, sc, off };
}

/**
 * A body of revolution (triangle soup, game frame, outward winding): `profile` [{ y, r }] bottom to top, n sides, first vertex at `phase` degrees; flat caps (radius > 1e-4; `noBottom` leaves the bottom open).
 * `rscale` / `ymap(y)` map the profile into the game's frame, (cx, cz) is the axis.
 */
export function lathe(profile, n, { phase = 0, rscale = 1, ymap = (y) => y, cx = 0, cz = 0, noBottom = false } = {}) {
  const out = [];
  const P = (r, y, k) => { const a = ((phase + (360 * k) / n) * Math.PI) / 180; return [cx + r * rscale * Math.cos(a), ymap(y), cz + r * rscale * Math.sin(a)]; };
  const tri = (a, b, c) => out.push(...a, ...b, ...c);
  for (let i = 0; i + 1 < profile.length; i++) {
    const A = profile[i], B = profile[i + 1];
    for (let k = 0; k < n; k++) {
      const a0 = P(A.r, A.y, k), a1 = P(A.r, A.y, k + 1), b0 = P(B.r, B.y, k), b1 = P(B.r, B.y, k + 1);
      if (B.r > 1e-6) tri(a0, b0, b1);
      if (A.r > 1e-6) tri(a0, b1, a1);
    }
  }
  const cap = (L, up) => { if (L.r < 1e-4) return; const c = [cx, ymap(L.y), cz]; for (let k = 0; k < n; k++) { const a = P(L.r, L.y, k), b = P(L.r, L.y, k + 1); if (up) tri(c, b, a); else tri(c, a, b); } };
  if (!noBottom) cap(profile[0], false);
  cap(profile[profile.length - 1], true);
  return Float32Array.from(out);
}

/** builds the spec: lathe bodies and fitted parts, concatenated per `group` (welded, crease-welded normals). Returns { groups: [{ pos, nrm, idx }], tris, perPart } */
export function buildPlant(spec, { maxCost = 4e-4, crease = 40 } = {}) {
  const byGroup = new Map(), perPart = [];
  for (const inst of spec.parts) {
    let soup, label, sc = [1, 1, 1];
    if (inst.lathe) {
      const prof = inst.profile, y0 = prof[0].y, y1 = prof[prof.length - 1].y, rmax = Math.max(...prof.map((q) => q.r));
      const [b0, b1] = inst.box.y, ys = (b1 - b0) / (y1 - y0 || 1), rs = inst.box.r / rmax, cz = inst.box.cz ?? 0;
      soup = lathe(prof, inst.n ?? 8, { noBottom: !!inst.noBottom, phase: inst.phase ?? 0, rscale: rs, ymap: (y) => b0 + (y - y0) * ys, cx: inst.box.cx ?? 0, cz });
      if (inst.box.aspect && inst.box.aspect !== 1) for (let i = 2; i < soup.length; i += 3) soup[i] = cz + (soup[i] - cz) * inst.box.aspect;   // an oval seen from above: z stretched
      label = inst.part ?? 'profile'; sc = [rs, ys, rs];
    } else {
      const f = fitInstance(inst);
      soup = f.tris; label = inst.part; sc = f.sc;
      if (!inst.open) { const c = closeBottom(soup); soup = new Float32Array(c.tris.length + c.cap.length); soup.set(c.tris); soup.set(c.cap, c.tris.length); }
    }
    const m = simplify(soup, { maxCost: inst.lathe ? 1e-9 : (inst.maxCost ?? maxCost), crease: inst.crease ?? crease, targetTris: 4 });
    const g = inst.group ?? 0;
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)).push(m);
    perPart.push({ part: label, tris: m.idx.length / 3, sc: sc.map((v) => +v.toFixed(3)) });
  }
  const groups = [];
  for (const g of [...byGroup.keys()].sort((a, b) => a - b)) {
    const pos = [], nrm = [], idx = [];
    for (const m of byGroup.get(g)) { const base = pos.length / 3; for (const v of m.pos) pos.push(v); for (const v of m.nrm) nrm.push(v); for (const i of m.idx) idx.push(i + base); }
    groups[g] = { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx) };
  }
  for (let g = 0; g < groups.length; g++) groups[g] ??= { pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };
  return { groups, tris: groups.reduce((s, g) => s + g.idx.length / 3, 0), perPart };
}
/** a triangle soup (9 floats per triangle) per group, for the IoU gate */
export const soupsOf = (groups) => groups.map((g) => { const o = new Float32Array(g.idx.length * 3); for (let i = 0; i < g.idx.length; i++) for (let c = 0; c < 3; c++) o[i * 3 + c] = g.pos[g.idx[i] * 3 + c]; return o; });
