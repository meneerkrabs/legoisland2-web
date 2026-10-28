// A small synchronous raw-DEFLATE (RFC 1951) decoder. InstallShield cabinets store every file as a series of
// independent raw deflate chunks; a synchronous decoder into a preallocated buffer is simpler and faster for that
// than DecompressionStream (one stream object per 32 KB chunk) and works the same in browsers and node.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Lookup table indexed by the next `bits` input bits (LSB first); entry = (codeLength << 16) | symbol, 0 = invalid. */
interface Huff { table: Int32Array; bits: number }

function buildHuff(lens: Uint8Array, n: number): Huff {
  const count = new Uint16Array(16);
  let max = 0;
  for (let i = 0; i < n; i++) {
    count[lens[i]]++;
    if (lens[i] > max) max = lens[i];
  }
  count[0] = 0;
  if (max === 0) return { table: new Int32Array(2), bits: 1 };
  const next = new Uint16Array(17);
  let code = 0;
  for (let l = 1; l <= 15; l++) {
    code = (code + count[l - 1]) << 1;
    next[l] = code;
  }
  const size = 1 << max;
  const table = new Int32Array(size);
  for (let sym = 0; sym < n; sym++) {
    const l = lens[sym];
    if (!l) continue;
    let c = next[l]++;
    let r = 0; // bit-reverse the code: deflate packs Huffman codes MSB first into an LSB-first stream
    for (let i = 0; i < l; i++, c >>= 1) r = (r << 1) | (c & 1);
    const entry = (l << 16) | sym;
    for (let j = r; j < size; j += 1 << l) table[j] = entry;
  }
  return { table, bits: max };
}

let fixedLit: Huff | null = null;
let fixedDist: Huff | null = null;
function fixedTables(): [Huff, Huff] {
  if (!fixedLit) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    fixedLit = buildHuff(l, 288);
    fixedDist = buildHuff(new Uint8Array(30).fill(5), 30);
  }
  return [fixedLit, fixedDist!];
}

/**
 * Inflate the raw deflate stream `src[sp..se)` into `dst` starting at `dp`.
 * Returns the new write position. Throws when the data is corrupt or does not fit in `dst`.
 */
export function inflateRaw(src: Uint8Array, sp: number, se: number, dst: Uint8Array, dp: number): number {
  let bitBuf = 0;
  let bitCnt = 0;
  let p = sp;
  const dend = dst.length;

  const need = (n: number) => {
    while (bitCnt < n) {
      bitBuf |= (p < se ? src[p] : 0) << bitCnt; // zero padding past the end; overrun is checked at the end
      p++;
      bitCnt += 8;
    }
  };
  const bits = (n: number): number => {
    if (n === 0) return 0;
    need(n);
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huff): number => {
    need(h.bits);
    const e = h.table[bitBuf & ((1 << h.bits) - 1)];
    const l = e >> 16;
    if (!l) throw new Error('inflate: ongeldige Huffman-code');
    bitBuf >>>= l;
    bitCnt -= l;
    return e & 0xffff;
  };

  let final = 0;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      // stored block: drop the partial byte, hand whole buffered bytes back, then copy LEN bytes
      bitBuf = 0;
      p -= bitCnt >> 3;
      bitCnt = 0;
      if (p + 4 > se) throw new Error('inflate: afgekapt');
      const len = src[p] | (src[p + 1] << 8);
      const nlen = src[p + 2] | (src[p + 3] << 8);
      if ((len ^ 0xffff) !== nlen) throw new Error('inflate: ongeldig opgeslagen blok');
      p += 4;
      if (p + len > se) throw new Error('inflate: afgekapt');
      if (dp + len > dend) throw new Error('inflate: uitvoer te groot');
      dst.set(src.subarray(p, p + len), dp);
      p += len;
      dp += len;
      continue;
    }
    if (type === 3) throw new Error('inflate: ongeldig bloktype');
    let lit: Huff;
    let dist: Huff;
    if (type === 1) {
      [lit, dist] = fixedTables();
    } else {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = buildHuff(cl, 19);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const s = decode(clh);
        if (s < 16) {
          lens[i++] = s;
        } else {
          let rep: number;
          let val = 0;
          if (s === 16) {
            if (i === 0) throw new Error('inflate: ongeldige lengtes');
            val = lens[i - 1];
            rep = 3 + bits(2);
          } else if (s === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > hlit + hdist) throw new Error('inflate: ongeldige lengtes');
          while (rep--) lens[i++] = val;
        }
      }
      lit = buildHuff(lens.subarray(0, hlit), hlit);
      dist = buildHuff(lens.subarray(hlit), hdist);
    }
    for (;;) {
      const s = decode(lit);
      if (s < 256) {
        if (dp >= dend) throw new Error('inflate: uitvoer te groot');
        dst[dp++] = s;
      } else if (s === 256) {
        break;
      } else {
        const li = s - 257;
        if (li >= 29) throw new Error('inflate: ongeldige lengtecode');
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        if (di >= 30) throw new Error('inflate: ongeldige afstandscode');
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > dp) throw new Error('inflate: afstand voor het begin');
        if (dp + len > dend) throw new Error('inflate: uitvoer te groot');
        if (d >= len) {
          dst.copyWithin(dp, dp - d, dp - d + len);
          dp += len;
        } else {
          for (let i = 0; i < len; i++, dp++) dst[dp] = dst[dp - d];
        }
      }
    }
  }
  if (p - (bitCnt >> 3) > se) throw new Error('inflate: afgekapt');
  return dp;
}
