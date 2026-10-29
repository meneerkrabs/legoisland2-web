// Pictures of the galleries (pure, node-testable): the game's .tga / .wib decoded to RGBA frames, plus the mesh facts the model list shows.
import { parseTga } from '../formats/tga.ts';
import { parseWib } from '../formats/wib.ts';
import { parseMsh } from '../formats/msh.ts';

export interface Pic {
  w: number; h: number;
  /** RGBA8 frames, rows in STORED order (the first row is the bottom of the picture for the usual bottom-up files: draw them flipped, `topDown`) */
  frames: Uint8Array[];
  /** `.wib` playback order (empty for a .tga) */
  sequence: number[];
  kind: 'tga' | 'wib';
}

/** decode a texture member: `.tga` (also `.tgaback`, an artist's backup copy of a tga) or `.wib` (all frames; the grid shows frame sequence[0]) */
export function decodePic(path: string, bytes: Uint8Array): Pic {
  if (/\.wib$/i.test(path)) {
    const w = parseWib(bytes);
    return { w: w.width, h: w.height, frames: w.frames, sequence: [...w.sequence], kind: 'wib' };
  }
  const t = parseTga(bytes);
  return { w: t.width, h: t.height, frames: [t.rgba], sequence: [], kind: 'tga' };
}

/** the picture's pixels top row first (flips the stored order), optionally box-reduced so that the longest side is at most `max` */
export function topDown(pic: Pic, frame = 0, max = 0): { w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const src = pic.frames[frame] ?? pic.frames[0];
  const sc = max > 0 ? Math.min(1, max / Math.max(pic.w, pic.h)) : 1;
  const w = Math.max(1, Math.round(pic.w * sc)), h = Math.max(1, Math.round(pic.h * sc));
  const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let y = 0; y < h; y++) {
    const sy = Math.min(pic.h - 1, Math.floor(((y + 0.5) * pic.h) / h));
    const srow = pic.h - 1 - sy;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(pic.w - 1, Math.floor(((x + 0.5) * pic.w) / w));
      const si = (srow * pic.w + sx) * 4, o = (y * w + x) * 4;
      out[o] = src[si]; out[o + 1] = src[si + 1]; out[o + 2] = src[si + 2]; out[o + 3] = src[si + 3];
    }
  }
  return { w, h, rgba: out };
}

export interface MeshInfo {
  tris: number; verts: number; groups: number;
  /** bounding box size of the raw vertex positions */
  dim: [number, number, number];
  /** 12 triangles and size 1 x 1 x 1: the export pipeline's empty unit-cube stub (unused.md 7.1) */
  stub: boolean;
  /** 0 triangles ("leeg": z27TRX lava1, test2) */
  empty: boolean;
}
/** triangles / bounds of a .msh member (`stub` = 12 triangles AND 1 x 1 x 1 within 0.01) */
export function meshInfo(bytes: Uint8Array): MeshInfo {
  const m = parseMsh(bytes);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.vertexCount; i++) for (let k = 0; k < 3; k++) { const v = m.positions[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const dim: [number, number, number] = m.vertexCount ? [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] : [0, 0, 0];
  const tris = m.indices.length / 3;
  return { tris, verts: m.vertexCount, groups: m.groups.length, dim, stub: tris === 12 && dim.every((d) => Math.abs(d - 1) < 0.01), empty: tris === 0 };
}
