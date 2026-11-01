// Tiny software rasteriser for looking at meshes (no Blender, any pose): flat-shaded triangles, z-buffer, orthographic, several views side by side -> PNG.
//   import { renderViews } from './raster.mjs';  renderViews(file, parts, { views: [{ az, el }], size: 400 })
// parts = [{ pos: Float32Array (world, game axes: +Y up, front +Z, left-handed), idx: ArrayLike (global, 3 per tri), color: [r,g,b] | (tri) => [r,g,b] }]
// Winding: game triangles have (b-a)x(c-a) along the OUTWARD normal; back faces (seen from behind) are drawn dark red when `showBack`, so inverted triangles show.
import { writePngTopDown } from './lib.mjs';

export function renderViews(file, parts, { views = [{ az: 0, el: 0 }, { az: 90, el: 0 }, { az: 180, el: 0 }, { az: 35, el: 20 }], size = 400, bbox = null, showBack = true, bg = [200, 205, 215] } = {}) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  if (bbox) { lo = bbox.lo; hi = bbox.hi; } else for (const p of parts) for (let i = 0; i < p.pos.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p.pos[i + c]); hi[c] = Math.max(hi[c], p.pos[i + c]); }
  const ctr = lo.map((l, i) => (l + hi[i]) / 2), ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1.08;
  const W = size * views.length, H = size, out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  views.forEach((v, vi) => {
    const az = v.az * Math.PI / 180, el = (v.el ?? 0) * Math.PI / 180;
    // camera looks along -dir; dir = from the object toward the camera. az 0 = camera at +Z (sees the front of a character)
    const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    const right = [Math.cos(az), 0, -Math.sin(az)];
    const up = [dir[1] * right[2] - dir[2] * right[1], dir[2] * right[0] - dir[0] * right[2], dir[0] * right[1] - dir[1] * right[0]];
    const zb = new Float32Array(size * size).fill(-1e9);
    const proj = (p) => { const q = [p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]]; return [(q[0] * right[0] + q[1] * right[1] + q[2] * right[2]) / ext * size + size / 2, size / 2 - (q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) / ext * size, q[0] * dir[0] + q[1] * dir[1] + q[2] * dir[2]]; };
    for (const part of parts) {
      const { pos, idx } = part;
      for (let t = 0; t < idx.length; t += 3) {
        const A = [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]], B = [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]], C = [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]];
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(...n) || 1; n = n.map((x) => x / nl);
        const facing = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
        let col = typeof part.color === 'function' ? part.color(t / 3) : part.color ?? [180, 180, 180];
        let shade;
        if (facing < 0) { if (!showBack) continue; col = [150, 0, 0]; shade = 0.7; } else shade = 0.45 + 0.55 * Math.max(0, n[0] * 0.3 + n[1] * 0.6 + n[2] * 0.75 + 0.0) / 1.2 + 0.2 * facing;
        const a = proj(A), b = proj(B), c = proj(C);
        const minx = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxx = Math.min(size - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
        const miny = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxy = Math.min(size - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
        const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-9) continue;
        for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den, l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den, l3 = 1 - l1 - l2;
          if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
          const z = l1 * a[2] + l2 * b[2] + l3 * c[2];
          if (z <= zb[y * size + x]) continue;
          zb[y * size + x] = z;
          const o = (y * W + vi * size + x) * 4;
          out[o] = Math.min(255, col[0] * shade); out[o + 1] = Math.min(255, col[1] * shade); out[o + 2] = Math.min(255, col[2] * shade);
        }
      }
    }
  });
  writePngTopDown(file, W, H, out);
}
