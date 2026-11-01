// Far-LOD parts as LOFTS: a minifig part (leg, torso, arm, hips) is an extrusion along y, so its far-LOD version is rebuilt as rings of K points at chosen y levels (the skin band planes
// plus the levels where the cross-section changes), measured by SLICING the HR part: watertight, manifold, vertices exactly on the skin planes, a fixed small triangle count (edge-collapse
// decimation of the open LDraw shells stalls at tens of triangles per part). Builder only.
function hull2(P) {
  const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
/** the (x, z) points where the soup crosses the plane y = level */
export function slicePoints(t, y) {
  const pts = [];
  for (let i = 0; i < t.length; i += 9) {
    const P = [0, 1, 2].map((k) => [t[i + k * 3], t[i + k * 3 + 1], t[i + k * 3 + 2]]);
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3], da = a[1] - y, db = b[1] - y;
      if (Math.abs(da) < 1e-6) pts.push([a[0], a[2]]);
      if ((da > 1e-6 && db < -1e-6) || (da < -1e-6 && db > 1e-6)) { const s = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * s, a[2] + (b[2] - a[2]) * s]); }
    }
  }
  return pts;
}
/** K points of the cross-section: K = 4 -> the bounding rectangle's corners, else the hull sampled at K equal angles around its centroid; ordered counter-clockwise in (x, z) */
export function ringOf(pts, K, round = false, bevel = 0) {
  if (pts.length < 3) return null;
  const lo = [1e9, 1e9], hi = [-1e9, -1e9];
  for (const p of pts) for (let c = 0; c < 2; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
  if (bevel && K === 8 && !round) {   // the bounding rectangle with chamfered corners (the game's parts have bevels: the flat faces keep flat vertex normals, the corners carry the bevel)
    const b = Math.min(bevel, 0.3 * (hi[0] - lo[0]), 0.3 * (hi[1] - lo[1]));
    return [[lo[0] + b, lo[1]], [hi[0] - b, lo[1]], [hi[0], lo[1] + b], [hi[0], hi[1] - b], [hi[0] - b, hi[1]], [lo[0] + b, hi[1]], [lo[0], hi[1] - b], [lo[0], lo[1] + b]];
  }
  if (K === 4 && !round) return [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]];   // (a round cross-section - a head - takes the hull sampled at 4 angles instead: the bounding rectangle's corners stick out by 41 %)
  const H = hull2(pts);
  const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2], out = [];
  for (let k = 0; k < K; k++) {
    const th = (2 * Math.PI * k) / K - Math.PI / 4, d = [Math.cos(th), Math.sin(th)];
    let best = 0;   // the farthest hull intersection along d from c: intersect the ray with every hull edge
    for (let i = 0; i < H.length; i++) {
      const a = H[i], b = H[(i + 1) % H.length], e = [b[0] - a[0], b[1] - a[1]], den = d[0] * e[1] - d[1] * e[0];
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a[0] - c[0]) * e[1] - (a[1] - c[1]) * e[0]) / den, u = ((a[0] - c[0]) * d[1] - (a[1] - c[1]) * d[0]) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, t);
    }
    out.push([c[0] + d[0] * best, c[1] + d[1] * best]);
  }
  return out;
}
/** levels where the cross-section changes: Douglas-Peucker on the slice bounding box curves (xmin, xmax, zmin, zmax over y), tolerance `tol`; a jump gets two levels (just below / above) */
export function shapeLevels(t, ylo, yhi, tol, step = 0.01) {
  const ys = [], bb = [];
  for (let y = ylo + step / 2; y < yhi; y += step) {
    const p = slicePoints(t, y); if (p.length < 3) continue;
    const b = [1e9, -1e9, 1e9, -1e9]; for (const q of p) { b[0] = Math.min(b[0], q[0]); b[1] = Math.max(b[1], q[0]); b[2] = Math.min(b[2], q[1]); b[3] = Math.max(b[3], q[1]); }
    ys.push(y); bb.push(b);
  }
  if (!ys.length) return { levels: [], ys, bb };
  // greedy Douglas-Peucker: the split with the largest error first, so `ranked` is ordered by importance
  const ranked = [];
  const cand = [[0, ys.length - 1]];
  const err = (i0, i1) => {
    let worst = 0, wi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const s = (ys[i] - ys[i0]) / (ys[i1] - ys[i0]);
      let e = 0; for (let c = 0; c < 4; c++) e = Math.max(e, Math.abs(bb[i][c] - (bb[i0][c] + (bb[i1][c] - bb[i0][c]) * s)));
      if (e > worst) { worst = e; wi = i; }
    }
    return { worst, wi };
  };
  const todo = [{ i0: 0, i1: ys.length - 1, ...err(0, ys.length - 1) }];
  while (todo.length) {
    todo.sort((a, b) => b.worst - a.worst);
    const t = todo.shift();
    if (t.wi < 0 || t.worst <= tol) continue;
    ranked.push(ys[t.wi]);
    todo.push({ i0: t.i0, i1: t.wi, ...err(t.i0, t.wi) }, { i0: t.wi, i1: t.i1, ...err(t.wi, t.i1) });
  }
  return { levels: [...ranked].sort((a, b) => a - b), ranked, ys, bb };
}
/** the loft itself: rings at `levels` (y values, ascending), K points each, side quads + end caps, outward winding of the game (a loft of a CCW-in-(x,z) ring seen from +y) */
export function loft(t, levels, K, { straighten = false, flatEnds = false, uniform = false, axis = null, roundTop = null, round = false, squareBottom = false, bevel = 0 } = {}) {
  const rings = [];
  for (const y of levels) {
    // a level exactly at a surface step slices ambiguously: nudge a hair inside
    let r = ringOf(slicePoints(t, y), K, round, bevel);
    if (!r) r = ringOf(slicePoints(t, y + 0.004), K, round, bevel) ?? ringOf(slicePoints(t, y - 0.004), K, round, bevel);
    if (r) rings.push({ y, r });
  }
  if (uniform && rings.length) {   // a straight tube: every ring the shape of the median slice (a sleeve: the LDraw arm's dome and wrist cap would make a lemon)
    const area = (g) => { const x = g.r.map((p) => p[0]), z = g.r.map((p) => p[1]); return (Math.max(...x) - Math.min(...x)) * (Math.max(...z) - Math.min(...z)); };
    const sorted = [...rings].sort((a, b) => area(a) - area(b)), big = sorted[Math.floor(sorted.length * 0.5)];   // the median slice
    for (const g of rings) g.r = big.r.map((p) => [...p]);
  }
  if (flatEnds && rings.length > 2) {   // rounded ends (a shoulder dome, a wrist cap) would become cones: flat ends with the ring of the neighbouring level instead
    const area = (g) => { const x = g.r.map((p) => p[0]), z = g.r.map((p) => p[1]); return (Math.max(...x) - Math.min(...x)) * (Math.max(...z) - Math.min(...z)); };
    if (area(rings[0]) < 0.7 * area(rings[1])) rings[0].r = rings[1].r.map((p) => [...p]);
    const n = rings.length; if (area(rings[n - 1]) < 0.7 * area(rings[n - 2])) rings[n - 1].r = rings[n - 2].r.map((p) => [...p]);
  }
  if (straighten && rings.length) {   // concentric rings: the LDraw arm bends at the elbow, the game's bind pose is straight (the animation bends it)
    const cen = rings.map((g) => [g.r.reduce((s, p) => s + p[0], 0) / g.r.length, g.r.reduce((s, p) => s + p[1], 0) / g.r.length]);
    const mean = [cen.reduce((s, c) => s + c[0], 0) / cen.length, cen.reduce((s, c) => s + c[1], 0) / cen.length];
    rings.forEach((g, i) => { const c = axis ? axis(g.y) : mean; g.r = g.r.map((p) => [p[0] - cen[i][0] + c[0], p[1] - cen[i][1] + c[1]]); });
  }
  if (squareBottom && rings.length > 2) {   // the game's head has a SQUARE bottom edge, the LDraw head a rounded one: every ring below the widest of the lower part takes that ring's shape (the face quad of the game ends on the chin: a bevel there would squeeze the mouth)
    const area = (g) => { const x = g.r.map((p) => p[0]), z = g.r.map((p) => p[1]); return (Math.max(...x) - Math.min(...x)) * (Math.max(...z) - Math.min(...z)); };
    const lim = rings[0].y + 0.35 * (rings[rings.length - 1].y - rings[0].y);
    let wi = 0; rings.forEach((g, i) => { if (g.y <= lim && area(g) > area(rings[wi]) * 1.001) wi = i; });
    for (let i = 0; i < wi; i++) rings[i].r = rings[wi].r.map((p) => [...p]);
  }
  if (roundTop && rings.length > 1) {   // a leg turns about the hip joint: its top is a half cylinder about that axis (x direction, through y = cy, z = cz), not the flat top of the LDraw part (which would stick out as a plate when the leg swings)
    const { cy, cz, steps } = roundTop;
    const keep = rings.filter((g) => g.y < cy - 0.01), base = rings.filter((g) => g.y >= cy - 0.01).sort((a, b) => a.y - b.y)[0];
    if (base && keep.length) {
      const R = Math.max(...base.r.map((p) => Math.abs(p[1] - cz)));
      rings.length = 0; rings.push(...keep);
      for (let k = 0; k <= steps; k++) { const th = (k / (steps + 1)) * (Math.PI / 2) * 0.93; rings.push({ y: cy + R * Math.sin(th), r: base.r.map((p) => [p[0], cz + (p[1] - cz) * Math.cos(th)]) }); }
    }
  }
  const out = [];
  const V = (ri, k) => [rings[ri].r[k % K][0], rings[ri].y, rings[ri].r[k % K][1]];
  for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < K; k++) {
    const a = V(i, k), b = V(i, k + 1), c = V(i + 1, k + 1), d = V(i + 1, k);
    out.push(...a, ...c, ...b, ...a, ...d, ...c);   // outward for a ring running counter-clockwise in (x, z): checked by orient() below
  }
  const cap = (ri, up) => { const c = [0, 0]; for (let k = 0; k < K; k++) { c[0] += rings[ri].r[k][0] / K; c[1] += rings[ri].r[k][1] / K; } const C = [c[0], rings[ri].y, c[1]]; for (let k = 0; k < K; k++) { const a = V(ri, k), b = V(ri, k + 1); out.push(...(up ? [...C, ...b, ...a] : [...C, ...a, ...b])); } };
  if (rings.length) { cap(0, false); cap(rings.length - 1, true); }
  return orient(Float32Array.from(out));
}
/** flips the whole soup when its signed volume is of the wrong sign (the game's outward winding has a NEGATIVE signed volume in these axes? checked on the first run: see volumeSign) */
function orient(t) {
  let v = 0;
  for (let i = 0; i < t.length; i += 9) { const a = [t[i], t[i + 1], t[i + 2]], b = [t[i + 3], t[i + 4], t[i + 5]], c = [t[i + 6], t[i + 7], t[i + 8]]; v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); }
  if (v >= 0) return t;   // outward normals (b-a)x(c-a) give a positive signed volume
  const o = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 9) { o.set(t.subarray(i, i + 3), i); o.set(t.subarray(i + 6, i + 9), i + 3); o.set(t.subarray(i + 3, i + 6), i + 6); }
  return o;
}
