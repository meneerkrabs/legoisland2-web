// LEGO 3D generator "textures": the LEGO-surface pictures of the game (139 stud plates, the brick walls) at 4x the resolution, tinted to the colours of the player's own picture.
//
// Two-layer rule (docs/re/lego3d.md): the pack holds only OUR renders (tools/lego3d/designs.mjs: Blender + LDraw geometry, colour-neutral shading fields: one stud cell per stud design,
// the whole tile for the walls) and a table (archive, texture id, design, studs per tile, phase, size and content hash of the original). The colour comes from the player's own picture
// at run time: its per-channel median (the plate colour), 3rd and 97th percentile (the dark and light end); the field f in [-1, 1] mixes median -> light end for f > 0 and
// median -> dark end for f < 0. Nothing of the original's pixels is stored or copied: three colours per texture are measured and used.
//
// The picture keeps its name, its 24 bit bottom-up TGA form and its UV mapping (a 2 x 2 stud tile stays 2 x 2 studs at the same phase); `Archive.isUpscaled` turns on mip maps for it
// because it is 4x the original's size. A member that does not match the table (hash) is only taken when it is a larger version of the same picture (an HD pack: same shape, the studs
// periodic at the table's phase); anything else is left alone.
import { parseTga } from '../../../formats/tga.ts';
import type { Generator } from './types.ts';
import { fnv1a, writeTga24, colourStats } from './surf.ts';

export interface TexEntry {
  id: number;
  /** design name (blob `textures/design/<d>.bin`) */
  d: string;
  /** design repeats per tile along u / v (stud cells: the studs per tile; a whole-tile design (brick wall, the 2 x 2 stud tile with a cross): 1) */
  nu: number; nv: number;
  /** position of the stud centre relative to the cell centre, in cell units (the design is shifted by it) */
  pu: number; pv: number;
  /** 1: the design's polarity is inverted (the studs are darker than the plate in the original) */
  inv: number;
  /** size and FNV-1a hash of the original member */
  w: number; h: number; hash: number;
  /** keep the original's green pixels (vegetation painted into a brick wall) */
  keepGreen?: number;
  /** flat colour of the stud top relative to f (informational, used by the studs generator through the design) */
  note?: string;
}
export interface TexTable { v: number; archive: string; entries: TexEntry[] }
export interface Design { w: number; h: number; f: Float32Array }

export const FACTOR = 4;
const decoded = new WeakMap<Uint8Array, Design>();
/** a design blob: u16 w, u16 h, then w * h bytes (128 + 127 f, row 0 = top) */
export function readDesign(blob: Uint8Array): Design {
  let d = decoded.get(blob);
  if (d) return d;
  const w = blob[0] | (blob[1] << 8), h = blob[2] | (blob[3] << 8);
  const f = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) f[i] = (blob[4 + i] - 128) / 127;
  d = { w, h, f };
  decoded.set(blob, d);
  return d;
}

/** box-filters a field down to (cw, ch) (exact when the sizes divide, nearest otherwise) */
export function reduceField(d: Design, cw: number, ch: number): Float32Array {
  const out = new Float32Array(cw * ch);
  if (d.w % cw === 0 && d.h % ch === 0) {
    const fx = d.w / cw, fy = d.h / ch, k = 1 / (fx * fy);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let s = 0;
      for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) s += d.f[(y * fy + j) * d.w + x * fx + i];
      out[y * cw + x] = s * k;
    }
  } else {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = d.f[Math.min(d.h - 1, Math.floor(((y + 0.5) * d.h) / ch)) * d.w + Math.min(d.w - 1, Math.floor(((x + 0.5) * d.w) / cw))];
  }
  return out;
}

export interface TintColours { median: ArrayLike<number>; lo: ArrayLike<number>; hi: ArrayLike<number> }
/** the shading field -> RGBA (opaque): median where f = 0, the light end at +1, the dark end at -1 */
export function tintField(f: Float32Array, c: TintColours, inv: number): Uint8Array {
  const out = new Uint8Array(f.length * 4);
  for (let i = 0; i < f.length; i++) {
    let v = inv ? -f[i] : f[i];
    const t = v > 0 ? c.hi : c.lo, a = v > 0 ? v : -v;
    for (let k = 0; k < 3; k++) { const x = c.median[k] + a * (t[k] - c.median[k]); out[i * 4 + k] = x < 0 ? 0 : x > 255 ? 255 : Math.round(x); }
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** the 4x stud texture field for a table entry: the stud cell design tiled nu x nv, shifted to the entry's phase (whole output pixels) */
export function studField(d: Design, e: TexEntry, W: number, H: number): Float32Array {
  const cu = Math.round(W / e.nu), cv = Math.round(H / e.nv);
  const cell = reduceField(d, cu, cv);
  const sx = Math.round(e.pu * cu), sy = Math.round(e.pv * cv);
  const f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const cy = (((y - sy) % cv) + cv) % cv;
    for (let x = 0; x < W; x++) f[y * W + x] = cell[cy * cu + ((((x - sx) % cu) + cu) % cu)];
  }
  return f;
}

/** luminance autocorrelation of a picture at a lag of one cell: >= 0.6 on both axes for a periodic stud plate (cheap, on a subsample) */
export function periodicity(rgba: Uint8Array, w: number, h: number, nu: number, nv: number): number {
  const L = new Float32Array(w * h);
  let m = 0;
  for (let i = 0; i < w * h; i++) { L[i] = 0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2]; m += L[i]; }
  m /= w * h;
  const lx = Math.round(w / nu), ly = Math.round(h / nv), step = Math.max(1, Math.floor(Math.max(w, h) / 128));
  let v = 0, cx = 0, cy = 0, n = 0;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const a = L[y * w + x] - m;
    v += a * a; cx += a * (L[y * w + ((x + lx) % w)] - m); cy += a * (L[((y + ly) % h) * w + x] - m); n++;
  }
  if (v < 1e-6 * n) return 0;
  return Math.min(cx, cy) / v;
}

/** the member path of a texture inside an archive as the archive spells it (`textures/text035.tga`), or null */
const tgaPath = (arch: { find(p: string): { path: string } | undefined }, id: number): string | null => {
  const n = String(id).padStart(3, '0');
  return (arch.find(`textures/Text${n}.tga`) ?? arch.find(`textures/text${n}.tga`))?.path ?? null;
};

export const generator: Generator = {
  id: 'textures',
  applies: (name, pack) => pack.has(`textures/arch/${name.toLowerCase()}.json`),
  async run(env) {
    const table = await env.pack.json<TexTable>(`textures/arch/${env.name.toLowerCase()}.json`);
    const designs = new Map<string, Design>();
    let done = 0, skipped = 0, bytes = 0;
    for (const e of table.entries) {
      const path = tgaPath(env.archive, e.id);
      const cur = path ? env.read(path) : null;
      if (!path || !cur) { env.log(`texture ${e.id}: not in the archive`); skipped++; continue; }
      try {
        const img = parseTga(cur);
        const same = img.width === e.w && img.height === e.h && fnv1a(cur) === e.hash;
        const larger = !same && img.width % e.w === 0 && img.height % e.h === 0 && img.width / e.w === img.height / e.h && img.width > e.w;
        if (!same && !larger) { env.log(`texture ${e.id}: not the game's picture (hash / size), left alone`); skipped++; continue; }
        if (!same && e.nu > 1 && periodicity(img.rgba, img.width, img.height, e.nu, e.nv) < 0.55) { env.log(`texture ${e.id}: larger picture is not a periodic stud plate, left alone`); skipped++; continue; }
        let d = designs.get(e.d);
        if (!d) { d = readDesign(await env.pack.get(`textures/design/${e.d}.bin`)); designs.set(e.d, d); }
        const W = e.w * FACTOR, H = e.h * FACTOR;
        const f = studField(d, e, W, H);
        const st = colourStats(e.keepGreen ? withoutGreen(img.rgba) : img.rgba);   // (the vegetation must not become the wall's light colour)
        const base = [st.median[0], st.median[1], st.median[2]];
        let rgba = tintField(f, { median: base, lo: st.lo, hi: st.hi }, e.inv);
        // the surface colour is the original's median: where the design covers more of one side the median of the result drifts, so the base colour is corrected until it is equal
        for (let it = 0; it < 4; it++) {
          const m = colourStats(rgba).median;
          const d = [0, 1, 2].map((k) => st.median[k] - m[k]);
          if (d.every((x) => x === 0)) break;
          for (let k = 0; k < 3; k++) base[k] += d[k];
          rgba = tintField(f, { median: base, lo: st.lo, hi: st.hi }, e.inv);
        }
        if (e.keepGreen) keepGreen(rgba, W, H, img.rgba, img.width, img.height);
        const out = writeTga24(W, H, rgba);
        env.put(path, out);
        done++; bytes += out.length;
      } catch (err) { env.log(`texture ${e.id}: ${(err as Error).message}`); skipped++; }
    }
    env.stats.textures = done; env.stats['textures-skipped'] = skipped; env.stats['texture-bytes'] = bytes;
  },
};

/** vegetation painted over the bottom of a brick wall: where the player's own picture is clearly green the (nearest-sampled) original pixel stays */
function keepGreen(out: Uint8Array, W: number, H: number, src: Uint8Array, sw: number, sh: number): void {
  for (let y = 0; y < H; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / H));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / W)), o = (sy * sw + sx) * 4;
      const r = src[o], g = src[o + 1], b = src[o + 2];
      if (g > 90 && g > r + 40 && g > b + 40) { const q = (y * W + x) * 4; out[q] = r; out[q + 1] = g; out[q + 2] = b; }
    }
  }
}

/** the picture without its clearly green pixels (the statistics of a wall must not see the grass) */
function withoutGreen(src: Uint8Array): Uint8Array {
  const keep: number[] = [];
  for (let i = 0; i < src.length; i += 4) { const r = src[i], g = src[i + 1], b = src[i + 2]; if (!(g > 90 && g > r + 40 && g > b + 40)) keep.push(r, g, b, 255); }
  return Uint8Array.from(keep);
}
