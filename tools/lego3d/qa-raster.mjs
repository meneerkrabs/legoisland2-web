// Tiny software rasteriser for LOOKING at LEGO 3D meshes (QA sheets, no Blender / browser needed): orthographic, z-buffer, Lambert + headlight, optional back-face colouring.
// Meshes are triangle soups in the game's frame (left-handed, +Y up, outward normal = (b-a) x (c-a)). Used by the brick / set builders and their QA sheets.
//   const img = render([{ tris, colour: [r, g, b] }], { yaw, pitch, size: 256, cull: false, bounds });   // -> { w, h, rgba }
//   sheet(file, [[img, img, ...], ...])                 // rows of images side by side
import { writePngTopDown } from './lib.mjs';

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function boundsOf(meshes) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const m of meshes) for (let i = 0; i < m.tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.tris[i + c]); hi[c] = Math.max(hi[c], m.tris[i + c]); }
  return { lo, hi };
}

/** yaw: degrees around Y (0 = the camera sits at -Z looking along +Z), pitch: degrees above the horizon (positive = from above) */
export function render(meshes, { yaw = 35, pitch = 25, size = 256, cull = false, bounds = null, bg = [32, 34, 40], wire = false } = {}) {
  const b = bounds ?? boundsOf(meshes);
  const ctr = [0, 1, 2].map((c) => (b.lo[c] + b.hi[c]) / 2), rad = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]) / 2 || 1;
  const ya = (yaw * Math.PI) / 180, pa = (pitch * Math.PI) / 180;
  // camera looks along f (from the camera into the scene); the camera sits at ctr - f * R
  const f = norm([-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)]);
  const r = norm(cross([0, 1, 0], f)), u = cross(f, r);
  const W = size, H = size, scale = (size * 0.46) / rad;
  const col = new Uint8Array(W * H * 4), zb = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) { col[i * 4] = bg[0]; col[i * 4 + 1] = bg[1]; col[i * 4 + 2] = bg[2]; col[i * 4 + 3] = 255; }
  const light = norm([-0.4, 0.8, -0.45]);
  const proj = (x, y, z) => { const p = [x - ctr[0], y - ctr[1], z - ctr[2]]; return [W / 2 + dot(p, r) * scale, H / 2 - dot(p, u) * scale, dot(p, f)]; };
  for (const m of meshes) {
    const t = m.tris, c0 = m.colour ?? [200, 200, 200];
    for (let i = 0; i < t.length; i += 9) {
      const A = [t[i], t[i + 1], t[i + 2]], B = [t[i + 3], t[i + 4], t[i + 5]], C = [t[i + 6], t[i + 7], t[i + 8]];
      let n = norm(cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]));
      const facing = dot(n, f) < 0;
      let shade, c = c0;
      if (!facing) { if (cull) continue; c = [220, 0, 220]; n = [-n[0], -n[1], -n[2]]; }
      shade = 0.38 + 0.42 * Math.max(0, dot(n, light)) + 0.25 * Math.max(0, -dot(n, f));
      const P = [proj(...A), proj(...B), proj(...C)];
      const minx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const miny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const l1 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den;
        const l2 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den;
        const l3 = 1 - l1 - l2, e = -0.002;
        if (l1 < e || l2 < e || l3 < e) continue;
        const z = l1 * P[0][2] + l2 * P[1][2] + l3 * P[2][2];
        const k = y * W + x;
        if (z >= zb[k]) continue;
        zb[k] = z;
        let s = shade;
        if (wire && (l1 < 0.04 || l2 < 0.04 || l3 < 0.04)) s *= 0.55;
        col[k * 4] = Math.min(255, c[0] * s); col[k * 4 + 1] = Math.min(255, c[1] * s); col[k * 4 + 2] = Math.min(255, c[2] * s);
      }
    }
  }
  return { w: W, h: H, rgba: col };
}

/** rows of images side by side -> PNG */
export function sheet(file, rows, gap = 4) {
  const W = Math.max(...rows.map((r) => r.reduce((s, i) => s + i.w + gap, gap))), H = rows.reduce((s, r) => s + Math.max(...r.map((i) => i.h)) + gap, gap);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = 12; out[i * 4 + 1] = 12; out[i * 4 + 2] = 14; out[i * 4 + 3] = 255; }
  let y0 = gap;
  for (const r of rows) {
    let x0 = gap;
    for (const im of r) { for (let y = 0; y < im.h; y++) out.set(im.rgba.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y0 + y) * W + x0) * 4); x0 += im.w + gap; }
    y0 += Math.max(...r.map((i) => i.h)) + gap;
  }
  writePngTopDown(file, W, H, out);
}

/** triangle soup of an indexed mesh (pos 3/vertex, idx 3/tri) */
export function soup(pos, idx) {
  const o = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { o[i * 3] = pos[idx[i] * 3]; o[i * 3 + 1] = pos[idx[i] * 3 + 1]; o[i * 3 + 2] = pos[idx[i] * 3 + 2]; }
  return o;
}
/** triangle soup of a parsed .msh (parseMsh), optionally only the groups in `groups`; matl = apply MATL matrices per group (GTOM) when given */
export function mshSoup(m, groups = null) {
  const o = [];
  m.groups.forEach((g, gi) => {
    if (groups && !groups.includes(gi)) return;
    for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; o.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); }
  });
  return Float32Array.from(o);
}
