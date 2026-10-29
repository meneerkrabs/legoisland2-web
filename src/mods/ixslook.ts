// "IXS-look": a texture mod for LEGO Eiland 2 made from textures of LEGO Island Xtreme Stunts (IXS). The textures are not hosted anywhere: the player's browser reads the
// few IXS banks it needs from the IXS disc on archive.org (src/mods/rawdisc.ts) and builds the mod's TGA files here (the recipe of tools/ixs-look in the author's notes).
//
// What it replaces (each replaced LE2 picture exists as exact copies in several zone archives; `members` lists them all, found by comparing the pixels of the originals):
//   - the sea of every zone (z02LGI text004 and its copies) with IXS's bright semi-transparent sea (256x256 instead of 128x128)
//   - the sea backdrop (Backdrop/Sea0): the same sea flattened over a sea blue, because the backdrop is opaque
//   - the sand of the island (z02LGI text001 ...) with IXS's beach texture, its colour shifted to the mean colour of the original so that it blends into the edge tiles
//   - the shirts of Pepper and the Infomaniac with IXS's outfits (the top-left 64x64 of the 128x128 body textures)
// (An earlier version also replaced the grass; the replaced fill tile showed as a patchwork next to the unchanged edge tiles, so it was dropped.)
// The TGAs keep the originals' layout: bottom-up rows, 24 bit, or 32 bit when the picture has transparency (the sea, whose originals carry an alpha channel).
import { bankTexture } from './ixs.ts';
import type { Rgba } from './ixs.ts';
import type { RangeReader } from './rawdisc.ts';
import { RawDisc } from './rawdisc.ts';

/** the disc's files the recipe needs, with their sizes on the disc (a different size means a different disc) */
export const IXS_FILES = {
  sea: { path: 'LIXS/CDC/TEXTURES/SEA.BMB', size: 113198 },
  beach: { path: 'LIXS/CDC/Z07JSK/MODEL002.BMB', size: 258927 },
  pepper: { path: 'LIXS/CDC/Z00DEF/CHAR003.BMB', size: 3694 },
  info: { path: 'LIXS/CDC/Z00INT/CHAR019.BMB', size: 8749 },
} as const;
export type IxsBanks = Record<keyof typeof IXS_FILES, Uint8Array>;

/** the mean colour of LE2's original sand picture (z02LGI textures/text001.tga), which the IXS beach is shifted to */
const SAND_MEAN = [226.977783203125, 194.977783203125, 136.977783203125] as const;
/** the sea blue the backdrop is flattened over */
const SEA_BASE = [24, 92, 200] as const;

const A = (archive: string, ...paths: string[]) => paths.map((p) => `_data/${archive}/${p}`);
const tex = (n: number) => `textures/text${String(n).padStart(3, '0')}.tga`;
const z = (list: [string, number][]) => list.flatMap(([a, n]) => A(a, tex(n)));

interface Recipe { what: string; alpha: boolean; members: string[]; make(b: IxsBanks): Rgba }
const RECIPES: Recipe[] = [
  {
    what: 'Zee (zeevlak van elke zone)', alpha: true,
    members: z([['z02LGI', 4], ['z07CSI', 59], ['z09JST', 22], ['z10RGB', 60], ['z13CAI', 1], ['z14OSD', 119], ['z22BIP', 3], ['z38PAR', 1]]),
    make: (b) => bankTexture(b.sea, 'c'),
  },
  {
    what: 'Zee-achtergrond (Backdrop/Sea0)', alpha: false,
    members: [...A('GENERICBITS', 'Backdrop/Sea0.tga'), ...A('z02LGI', 'Backdrop/Sea0.tga'), ...A('z10RGB', 'Backdrop/Sea0.tga'), ...A('z22BIP', 'Backdrop/Sea0.tga', 'Backdrop/Copy of Sea0.tga'), ...A('z38PAR', 'Backdrop/Sea0.tga', 'Backdrop/Copy of Sea0.tga')],
    make: (b) => flatten(bankTexture(b.sea, 'c'), SEA_BASE),
  },
  {
    what: 'Zand', alpha: false,
    members: z([['z02LGI', 1], ['z04IFC', 72], ['z38PAR', 8]]),
    make: (b) => shiftMean(bankTexture(b.beach, 'N_Beach_A'), SAND_MEAN),
  },
  {
    what: 'Pepper (shirt)', alpha: false,
    members: z([['z01BPK', 16], ['z02LGI', 377], ['z03PPH', 57], ['z04IFC', 92], ['z05WAB', 44], ['z07CSI', 117], ['z10RGB', 93], ['z13CAI', 215], ['z14OSD', 131], ['z15SSH', 32], ['z16PYA', 115], ['z17WAS', 35], ['z18MMP', 41], ['z20DSP', 71], ['z21FSH', 26], ['z22BIP', 69], ['z23DIP', 127], ['z27TRX', 108], ['z28HAT', 83], ['z38PAR', 66], ['z42BRP', 66], ['z50LTC', 16], ['z60FRE', 53]]),
    make: (b) => crop(bankTexture(b.pepper, 'BODY_PEPP'), 0, 0, 64, 64),
  },
  {
    what: 'Infomaniac (shirt)', alpha: false,
    members: z([['z01BPK', 25], ['z02LGI', 370], ['z04IFC', 85], ['z60FRE', 64]]),
    make: (b) => crop(bankTexture(b.info, 'BODY_info'), 0, 0, 64, 64),
  },
];

export const IXS_LOOK_INFO = [
  'IXS-look',
  'Gemaakt met textures uit LEGO Island Xtreme Stunts',
  'Geeft LEGO Eiland 2 een stukje Island Xtreme Stunts: het helderblauwe IXS-zeewater, de gedetailleerdere IXS-ondergrond voor het zand (in kleur gelijkgetrokken met de randtegels) en de IXS-outfits van Pepper en Infomaniac.',
  '',
].join('\r\n');

/** the number of files the mod consists of (without info.txt) */
export const IXS_LOOK_FILES = RECIPES.reduce((n, r) => n + r.members.length, 0);

function flatten(img: Rgba, base: readonly number[]): Rgba {
  const px = new Uint8Array(img.px);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * a + base[k] * (1 - a));
    px[i + 3] = 255;
  }
  return { ...img, px };
}
function crop(img: Rgba, x0: number, y0: number, w: number, h: number): Rgba {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) px.set(img.px.subarray(((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4), y * w * 4);
  return { w, h, px };
}
/** shift each colour channel so that its mean matches `target` (keeps the detail) */
function shiftMean(img: Rgba, target: readonly number[]): Rgba {
  const n = img.w * img.h, sum = [0, 0, 0];
  for (let i = 0; i < n * 4; i++) if ((i & 3) < 3) sum[i & 3] += img.px[i];
  const px = new Uint8Array(img.px);
  for (let i = 0; i < px.length; i++) {
    const k = i & 3;
    if (k < 3) px[i] = Math.max(0, Math.min(255, Math.round(px[i] + (target[k] - sum[k] / n))));
  }
  return { ...img, px };
}

/** RGBA8 top-down -> TGA (type 2, bottom-up rows like the game's own files, 24 bit when opaque and not forced, else 32 bit with 8 alpha bits, TRUEVISION footer) */
export function toTga(img: Rgba, forceAlpha: boolean): Uint8Array {
  const { w, h, px } = img;
  let alpha = forceAlpha;
  if (!alpha) for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { alpha = true; break; }
  const bpp = alpha ? 4 : 3, out = new Uint8Array(18 + w * h * bpp + 26);
  const dv = new DataView(out.buffer);
  out[2] = 2; dv.setUint16(12, w, true); dv.setUint16(14, h, true); out[16] = bpp * 8; out[17] = alpha ? 8 : 0;
  let o = 18;
  for (let r = 0; r < h; r++) {
    const y = h - 1 - r;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      out[o++] = px[s + 2]; out[o++] = px[s + 1]; out[o++] = px[s];
      if (alpha) out[o++] = px[s + 3];
    }
  }
  out.set(new TextEncoder().encode('TRUEVISION-XFILE.\0'), o + 8);
  return out;
}

export interface BuiltMod { files: { path: string; data: Uint8Array }[]; info: string }

/** the mod's files from the five IXS banks (paths `_data/<archive>/<member>`) */
export function buildIxsLook(banks: IxsBanks): BuiltMod {
  const files: BuiltMod['files'] = [];
  for (const r of RECIPES) {
    const tga = toTga(r.make(banks), r.alpha);
    for (const m of r.members) files.push({ path: m, data: tga });
  }
  return { files, info: IXS_LOOK_INFO };
}

/** read the banks from a raw IXS disc through `read` (byte ranges of the .BIN) */
export async function readIxsBanks(read: RangeReader, onStep?: (what: string) => void): Promise<{ banks: IxsBanks; disc: RawDisc }> {
  const disc = new RawDisc(read);
  const banks = {} as IxsBanks;
  const keys = Object.keys(IXS_FILES) as (keyof typeof IXS_FILES)[];
  // the first lookup reads the directories the four files share; then the rest goes in parallel (the disc is far away, every request costs a second or more)
  await disc.find(IXS_FILES[keys[0]].path);
  await Promise.all(keys.map(async (k) => { banks[k] = await disc.file(IXS_FILES[k].path, IXS_FILES[k].size); onStep?.(IXS_FILES[k].path); }));
  return { banks, disc };
}
