// Minimal PNG reader (8-bit RGB / RGBA, all filters) for the screenshot tools: { w, h, bpp, d }
import fs from 'node:fs';
import zlib from 'node:zlib';
export function readPng(file) {
  const b = fs.readFileSync(file); let p = 8, w, h, ct; const idat = [];
  while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8); if (t === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); ct = b[p + 17]; } else if (t === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n)); p += 12 + n; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * bpp), st = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], r = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)), o = y * st;
    for (let x = 0; x < st; x++) {
      const A = x >= bpp ? out[o + x - bpp] : 0, B = y ? out[o - st + x] : 0, C = x >= bpp && y ? out[o - st + x - bpp] : 0;
      let v = r[x];
      if (f === 1) v += A; else if (f === 2) v += B; else if (f === 3) v += (A + B) >> 1; else if (f === 4) { const pp = A + B - C, pa = Math.abs(pp - A), pb = Math.abs(pp - B), pc = Math.abs(pp - C); v += pa <= pb && pa <= pc ? A : pb <= pc ? B : C; }
      out[o + x] = v & 255;
    }
  }
  return { w, h, bpp, d: out };
}
