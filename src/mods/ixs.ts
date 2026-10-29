// Island Xtreme Stunts (IXS, LEGO Interactive / Silicon Dreams, 2002) readers, used by the catalogue's "IXS-look" mod, which is built on the player's machine from the
// IXS disc and never hosted: the LZ unpacker (IXS `Game.exe` 0x417d5e), the `.BMB` texture banks and the pixel decoders. Everything decodes to RGBA8, top row first.

/**
 * IXS's LZ unpacker (Game.exe 0x417d5e). A file is compressed when bit 31 of its first u32 is set (the rest is the unpacked size); otherwise the u32 is the size
 * of the data that follows. Compressed data: a bit queue (u32 words, LSB first) that says "literal byte" (0) or "copy" (1); copies come in three shapes (a 3-byte short
 * form with an 8-bit distance, a 2-byte form with a 13-bit distance and a 3-bit length, and a long form with an optional 16-bit length); the long form's length 1 ends the stream.
 */
export function unpackIxs(d: Uint8Array): Uint8Array {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let size = dv.getUint32(0, true);
  if (!(size & 0x80000000)) return d.subarray(4, 4 + size);
  size &= 0x7fffffff;
  const out = new Uint8Array(size);
  let o = 0, i = 4, bits = dv.getUint32(i, true) >>> 0, cnt = 32;
  i += 4;
  const nxt = () => { bits >>>= 1; if (--cnt === 0) { bits = dv.getUint32(i, true) >>> 0; i += 4; cnt = 32; } };
  for (;;) {
    if (!(bits & 1)) out[o++] = d[i++];
    else {
      nxt();
      if (bits & 1) {
        const w = d[i] | (d[i + 1] << 8);
        i += 2;
        let off = (w >> 3) - 0x2000, n = w & 7;
        if (n) n += 2;
        else {
          const b = d[i++];
          if (b & 0x80) off -= 0x2000;
          n = b & 0x7f;
          if (n === 1) break;
          if (n === 0) { n = d[i] | (d[i + 1] << 8); i += 2; } else n += 2;
        }
        let p = o + off;
        while (n--) out[o++] = out[p++];
      } else {
        let p = o + d[i++] - 0x100;
        out[o++] = out[p++]; out[o++] = out[p++];
        nxt();
        if (bits & 1) { out[o++] = out[p++]; out[o++] = out[p++]; }
        nxt();
        if (bits & 1) out[o++] = out[p++];
      }
    }
    nxt();
  }
  if (o !== size) throw new Error(`IXS: uitpakken gaf ${o} bytes in plaats van ${size}`);
  return out;
}

export interface BmbTexture {
  name: string;
  w: number;
  h: number;
  mips: number;
  fmt: number;
  flags: number;
  imag: Uint8Array | null;
  clut: Uint8Array | null;
}

/**
 * A `.BMB` texture bank (after unpacking): a u32 size, `IDX2` + count + the names (u16 index, NUL-terminated name, ended by index 0xFFFF), then per texture an `INFO`
 * chunk (u16 width, u16 height, u32 mip count at +12, u32 format at +16, u32 flags at +20; the low byte of the flags is the bits per pixel), an `IMAG` chunk with the
 * pixels (and `CLUT` with a palette, `MIPM` / `END` for the rest).
 */
export function parseBmb(d: Uint8Array): BmbTexture[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const tag = (i: number) => String.fromCharCode(d[i], d[i + 1], d[i + 2], d[i + 3]);
  if (tag(4) !== 'IDX2') throw new Error('IXS: geen IDX2 in de texturebank');
  const n = dv.getUint32(8, true);
  const names = new Map<number, string>();
  for (let i = 12; i < 12 + n;) {
    const k = dv.getUint16(i, true);
    i += 2;
    if (k === 0xffff) break;
    let e = i;
    while (d[e]) e++;
    names.set(k, new TextDecoder('latin1').decode(d.subarray(i, e)));
    i = e + 1;
  }
  const texs: BmbTexture[] = [];
  let cur: BmbTexture | null = null;
  for (let i = 12 + n; i + 8 <= d.length;) {
    const t = tag(i), len = dv.getUint32(i + 4, true), body = d.subarray(i + 8, i + 8 + len);
    i += 8 + len;
    if (t === 'INFO') {
      const b = new DataView(body.buffer, body.byteOffset, body.byteLength);
      cur = { name: names.get(texs.length) ?? `#${texs.length}`, w: b.getUint16(0, true), h: b.getUint16(2, true), mips: b.getUint32(12, true), fmt: b.getUint32(16, true), flags: b.getUint32(20, true), imag: null, clut: null };
      texs.push(cur);
    } else if (t === 'IMAG' && cur) cur.imag = body;
    else if (t === 'CLUT' && cur) cur.clut = body;
  }
  return texs;
}

const rgb565 = (c: number): [number, number, number] => [(((c >> 11) & 31) * 255 / 31) | 0, (((c >> 5) & 63) * 255 / 63) | 0, ((c & 31) * 255 / 31) | 0];

/** DXT5 (BC3): 8 bytes of alpha (two end points + 16 three-bit indices), 8 bytes of colour (two RGB565 end points + 16 two-bit indices) per 4x4 block */
function dxt5(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let s = 0;
  for (let by = 0; by < Math.max(1, h >> 2); by++) {
    for (let bx = 0; bx < Math.max(1, w >> 2); bx++) {
      const a0 = src[s], a1 = src[s + 1];
      const al = [a0, a1];
      if (a0 > a1) for (let k = 1; k < 7; k++) al.push(((7 - k) * a0 + k * a1) / 7 | 0);
      else { for (let k = 1; k < 5; k++) al.push(((5 - k) * a0 + k * a1) / 5 | 0); al.push(0, 255); }
      // the 48 alpha index bits as two 24-bit halves (16 x 3 bits)
      const lo = src[s + 2] | (src[s + 3] << 8) | (src[s + 4] << 16), hi = src[s + 5] | (src[s + 6] << 8) | (src[s + 7] << 16);
      const c0 = src[s + 8] | (src[s + 9] << 8), c1 = src[s + 10] | (src[s + 11] << 8);
      const p0 = rgb565(c0), p1 = rgb565(c1);
      const pal = [p0, p1, p0.map((v, k) => (2 * v + p1[k]) / 3 | 0), p0.map((v, k) => (v + 2 * p1[k]) / 3 | 0)];
      const ci = src[s + 12] | (src[s + 13] << 8) | (src[s + 14] << 16) | (src[s + 15] << 24);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px, y = by * 4 + py;
          if (x >= w || y >= h) continue;
          const k = py * 4 + px, c = pal[(ci >>> (2 * k)) & 3];
          const a = al[k < 8 ? (lo >>> (3 * k)) & 7 : (hi >>> (3 * (k - 8))) & 7];
          const o = (y * w + x) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = a;
        }
      }
      s += 16;
    }
  }
  return out;
}

/** RGBA8, top row first; null for formats that are not pictures (palette stubs) */
export function decodeBmb(t: BmbTexture): Uint8Array | null {
  const { w, h, imag } = t, n = w * h;
  if (!imag) return null;
  const out = new Uint8Array(n * 4);
  if (t.fmt === 5) return dxt5(imag, w, h);
  const bpp = t.flags & 0xff;
  // 32 bits per pixel BGRA; a 24-bit bank whose pixels are padded to 4 bytes is read the same way (alpha 255)
  if (bpp === 32 || (bpp === 24 && imag.length >= n * 4 && imag.length % (n * 4) === 0 && imag.length < n * 4 * 1.3)) {
    for (let i = 0; i < n; i++) { out[i * 4] = imag[i * 4 + 2]; out[i * 4 + 1] = imag[i * 4 + 1]; out[i * 4 + 2] = imag[i * 4]; out[i * 4 + 3] = bpp === 32 ? imag[i * 4 + 3] : 255; }
    return out;
  }
  if (bpp === 24) {
    for (let i = 0; i < n; i++) { out[i * 4] = imag[i * 3 + 2]; out[i * 4 + 1] = imag[i * 3 + 1]; out[i * 4 + 2] = imag[i * 3]; out[i * 4 + 3] = 255; }
    return out;
  }
  if (bpp === 8 && t.clut && t.clut.length >= 1020) {
    const c = t.clut;
    for (let i = 0; i < n; i++) { const p = imag[i] * 4; out[i * 4] = c[p + 2] ?? 0; out[i * 4 + 1] = c[p + 1] ?? 0; out[i * 4 + 2] = c[p] ?? 0; out[i * 4 + 3] = c[p + 3] ?? 255; }
    return out;
  }
  return null;
}

export interface Rgba { w: number; h: number; px: Uint8Array }

/** the first texture called `name` in a bank (the raw `.BMB` file, compressed or not) that is a picture */
export function bankTexture(bmb: Uint8Array, name: string): Rgba {
  for (const t of parseBmb(unpackIxs(bmb))) {
    if (t.name !== name) continue;
    const px = decodeBmb(t);
    if (px) return { w: t.w, h: t.h, px };
  }
  throw new Error(`IXS: texture ${name} niet gevonden in de bank`);
}
