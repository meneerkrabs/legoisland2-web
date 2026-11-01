// Silhouette IoU between two triangle soups (orthographic masks from several views): the quality gate of the brick-built reconstructions (docs/re/lego3d.md section 16).
//   const r = silhouetteIoU([soupA...], [soupB...], { views: [[yaw, pitch], ...], size: 512 })   // { iou: per view, min, mean, maskA, maskB } ; yaw / pitch as in qa-raster.mjs
// Both soups are rendered into the same frame (the union box of both), a pixel counts when its centre lies inside a triangle (either facing).
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const DEFAULT_VIEWS = [[0, 0], [90, 0], [180, 0], [270, 0], [0, 90], [35, 25], [215, 25], [125, 30], [305, 30]];

function boxOf(soups) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const s of soups) for (let i = 0; i < s.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], s[i + c]); hi[c] = Math.max(hi[c], s[i + c]); }
  return { lo, hi };
}

function mask(soups, [yaw, pitch], box, size) {
  const ctr = [0, 1, 2].map((c) => (box.lo[c] + box.hi[c]) / 2), rad = Math.hypot(box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]) / 2 || 1;
  const ya = (yaw * Math.PI) / 180, pa = (pitch * Math.PI) / 180;
  const f = norm([-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)]);
  let r = norm(cross([0, 1, 0], f)); if (Math.abs(pitch) >= 89.9) r = [Math.cos(ya), 0, Math.sin(ya)];
  const u = cross(f, r), scale = (size * 0.46) / rad, out = new Uint8Array(size * size);
  for (const t of soups) for (let i = 0; i < t.length; i += 9) {
    const P = [0, 1, 2].map((k) => { const p = [t[i + k * 3] - ctr[0], t[i + k * 3 + 1] - ctr[1], t[i + k * 3 + 2] - ctr[2]]; return [size / 2 + dot(p, r) * scale, size / 2 - dot(p, u) * scale]; });
    const minx = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxx = Math.min(size - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const miny = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxy = Math.min(size - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const den = (P[1][1] - P[2][1]) * (P[0][0] - P[2][0]) + (P[2][0] - P[1][0]) * (P[0][1] - P[2][1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((P[1][1] - P[2][1]) * (px - P[2][0]) + (P[2][0] - P[1][0]) * (py - P[2][1])) / den, l2 = ((P[2][1] - P[0][1]) * (px - P[2][0]) + (P[0][0] - P[2][0]) * (py - P[2][1])) / den, l3 = 1 - l1 - l2;
      if (l1 >= 0 && l2 >= 0 && l3 >= 0) out[y * size + x] = 1;
    }
  }
  return out;
}

export function silhouetteIoU(a, b, { views = DEFAULT_VIEWS, size = 512, box = null } = {}) {
  const bx = box ?? boxOf([...a, ...b]);
  const per = [], masks = [];
  for (const v of views) {
    const A = mask(a, v, bx, size), B = mask(b, v, bx, size);
    let inter = 0, uni = 0;
    for (let i = 0; i < A.length; i++) { const x = A[i], y = B[i]; if (x & y) inter++; if (x | y) uni++; }
    per.push(uni ? inter / uni : 1); masks.push({ A, B, size });
  }
  return { iou: per, min: Math.min(...per), mean: per.reduce((s, v) => s + v, 0) / per.length, masks, box: bx };
}
