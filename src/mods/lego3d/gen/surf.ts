// Helpers shared by the LEGO 3D "textures" and "studs" generators (pure TS, node + browser): content hash, TGA writer, colour statistics of a picture.

/** FNV-1a (32 bit) of a byte range: the pack keys members on it (a hash is a name, not content) */
export function fnv1a(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** an uncompressed 24 bit bottom-up Targa like the game's own files (type 2 / 10, 24 bpp, origin bottom-left) with the TRUEVISION footer; `rgba` rows are in file order (row 0 = V 0) */
export function writeTga24(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(18 + w * h * 3 + 26);
  out[2] = 2; out[12] = w & 255; out[13] = w >> 8; out[14] = h & 255; out[15] = h >> 8; out[16] = 24; out[17] = 0;
  let o = 18;
  for (let i = 0; i < w * h; i++) { out[o++] = rgba[i * 4 + 2]; out[o++] = rgba[i * 4 + 1]; out[o++] = rgba[i * 4]; }
  const f = 'TRUEVISION-XFILE.';
  for (let i = 0; i < f.length; i++) out[o + 8 + i] = f.charCodeAt(i);
  return out;
}

export interface ColourStats { median: [number, number, number]; lo: [number, number, number]; hi: [number, number, number]; mean: [number, number, number]; lumSd: number }
/** per-channel percentiles of an RGBA8 picture (alpha ignored): the median is the surface colour, `lo` / `hi` the dark / light end (p3 / p97) the design's shading is mapped onto */
export function colourStats(rgba: Uint8Array, loP = 0.03, hiP = 0.97): ColourStats {
  const n = rgba.length >> 2;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let sum = [0, 0, 0], l1 = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    hist[0][r]++; hist[1][g]++; hist[2][b]++; sum[0] += r; sum[1] += g; sum[2] += b;
    const l = 0.3 * r + 0.59 * g + 0.11 * b; l1 += l; l2 += l * l;
  }
  const pick = (h: Uint32Array, p: number) => { const t = p * n; let a = 0; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= t) return v; } return 255; };
  const m = l1 / n;
  return {
    median: [pick(hist[0], 0.5), pick(hist[1], 0.5), pick(hist[2], 0.5)],
    lo: [pick(hist[0], loP), pick(hist[1], loP), pick(hist[2], loP)],
    hi: [pick(hist[0], hiP), pick(hist[1], hiP), pick(hist[2], hiP)],
    mean: [sum[0] / n, sum[1] / n, sum[2] / n],
    lumSd: Math.sqrt(Math.max(0, l2 / n - m * m)),
  };
}
