// Targa decoder for the game's .tga files (all 4961 files: type 2 raw / type 10 RLE, 24 or 32 bpp,
// no palette, no image id, bottom-left origin except 4 files; all carry a TRUEVISION footer).
// Output is RGBA8 in FILE ROW ORDER (first row = first stored row = bottom of the picture for
// bottom-up files). The game uploads the rows exactly as stored and uses mesh V as-is, so uploading this
// buffer to GL unchanged (no flip) with the mesh UVs unchanged gives the right picture.

export interface Image {
  width: number;
  height: number;
  /** RGBA8, rows in stored order (see above) */
  rgba: Uint8Array;
  /** true if any alpha < 255 */
  hasAlpha: boolean;
}

export function parseTga(d: Uint8Array): Image {
  if (d.length < 18) throw new Error('tga too short');
  const idLen = d[0], cmType = d[1], type = d[2];
  const w = d[12] | (d[13] << 8), h = d[14] | (d[15] << 8), bpp = d[16], desc = d[17];
  if (cmType !== 0) throw new Error('paletted tga not supported');
  if (type !== 2 && type !== 10) throw new Error(`tga type ${type}`);
  if (bpp !== 24 && bpp !== 32) throw new Error(`tga bpp ${bpp}`);
  const bytes = bpp >> 3;
  let p = 18 + idLen;
  const out = new Uint8Array(w * h * 4);
  const rowOrderTopDown = (desc & 0x20) !== 0; // origin top-left: rows are stored top first
  let hasAlpha = false;
  const put = (i: number, b: number, g: number, r: number, a: number) => {
    // i = pixel index in stored order
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    if (a !== 255) hasAlpha = true;
  };
  const total = w * h;
  if (type === 2) {
    if (p + total * bytes > d.length) throw new Error('tga truncated');
    for (let i = 0; i < total; i++, p += bytes) put(i, d[p], d[p + 1], d[p + 2], bytes === 4 ? d[p + 3] : 255);
  } else {
    let i = 0;
    while (i < total) {
      if (p >= d.length) throw new Error('tga rle truncated');
      const c = d[p++];
      const n = (c & 0x7f) + 1;
      if (i + n > total) throw new Error('tga rle overrun');
      if (c & 0x80) {
        const b = d[p], g = d[p + 1], r = d[p + 2], a = bytes === 4 ? d[p + 3] : 255;
        p += bytes;
        for (let k = 0; k < n; k++) put(i++, b, g, r, a);
      } else {
        for (let k = 0; k < n; k++, p += bytes) put(i++, d[p], d[p + 1], d[p + 2], bytes === 4 ? d[p + 3] : 255);
      }
    }
  }
  if (rowOrderTopDown) {
    // normalise to bottom-up so that every texture has the same convention
    const row = w * 4, tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, b = (h - 1 - y) * row;
      tmp.set(out.subarray(a, a + row)); out.copyWithin(a, b, b + row); out.set(tmp, b);
    }
  }
  return { width: w, height: h, rgba: out, hasAlpha };
}
