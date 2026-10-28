// .wib animated texture ("WIBF"/"WIBT").
//   "WIBF" u32 n; n x u32 frame order (playback sequence of frame indices; repeats = longer display)
//   "WIBT" u32 width, u32 height, u32 kind, u32 frameCount
//   frameCount x width x height x bpp raw pixels (bpp = 3 for kind 0, else 4)
// Pixel channel order is verified in tools/tests (see docs/re/formats.md).
export interface Wib {
  width: number;
  height: number;
  kind: number;
  bytesPerPixel: number;
  frameCount: number;
  sequence: Uint32Array;
  /** frames[i] is RGBA8, rows in stored order (same convention as tga.ts) */
  frames: Uint8Array[];
}

import { Reader } from './reader.ts';

export function parseWib(d: Uint8Array): Wib {
  const r = new Reader(d);
  r.expectTag('WIBF');
  const n = r.u32();
  const sequence = r.u32s(n);
  r.expectTag('WIBT');
  const width = r.u32(), height = r.u32(), kind = r.u32(), frameCount = r.u32();
  const bpp = kind === 0 ? 3 : 4;
  if (r.remaining !== width * height * bpp * frameCount) throw new Error(`wib size mismatch: ${r.remaining} vs ${width * height * bpp * frameCount}`);
  for (const s of sequence) if (s >= frameCount) throw new Error('wib sequence index out of range');
  const frames: Uint8Array[] = [];
  for (let f = 0; f < frameCount; f++) {
    const src = r.bytes(width * height * bpp);
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      // stored as B,G,R(,A) like TGA (verified visually)
      out[i * 4] = src[i * bpp + 2];
      out[i * 4 + 1] = src[i * bpp + 1];
      out[i * 4 + 2] = src[i * bpp];
      out[i * 4 + 3] = bpp === 4 ? src[i * bpp + 3] : 255;
    }
    frames.push(out);
  }
  return { width, height, kind, bytesPerPixel: bpp, frameCount, sequence, frames };
}
