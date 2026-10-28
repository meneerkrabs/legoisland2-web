// Per-zone render parameters that the game's set-up code passes to the engine as constants:
//   FUN_00442d90(near, farMin, farMax, fogFrac, fogColourARGB, fogEnable)  -> camera range + fog (see docs/re/rendering.md 3.2)
//   mov [DAT_009da858], <float>                                          -> sea level (y of the sea plane)
// Both appear as straight-line code in the zone's set-up function, which sits in front of the zone's builder function
// (src/formats/exe.ts `ZoneScene.builderAt`). They are read from the user's own executable at run time like the zone tables.
import type { Pe } from './exe.ts';

export interface FogSetup {
  /** camera near plane */
  near: number;
  /** draw distance (far plane) at the highest / lowest setting of the options slider: far = lerp(farMax, farMin, slider / 100) */
  farMin: number; farMax: number;
  /** fog start = far - fogFrac * far / farMax */
  fogFrac: number;
  /** D3DCOLOR 0xAARRGGBB; also the colour the frame is cleared to */
  color: number;
  enabled: boolean;
  /** address of the call in the executable */
  at: number;
}
export interface ZoneRenderParams {
  /** every `SetupFog` call of the zone's set-up code, in code order (the first is the zone's default) */
  fog: FogSetup[];
  /** y of the sea plane (a zone that stores 0 keeps the sea at y = 0), null when the set-up code never stores it */
  seaLevel: number | null;
}

const SETUP_FOG = 0x442d90;
const SEA_LEVEL_GLOBAL = 0x9da858;
const f32 = new DataView(new ArrayBuffer(4));
const asFloat = (u: number) => { f32.setUint32(0, u >>> 0, true); return f32.getFloat32(0, true); };

/** Reads the `push imm` chain that ends right before `callAt`; returns the pushed values (last pushed first = first argument) */
function pushChain(pe: Pe, callAt: number): number[] | null {
  const t = pe.text, d = pe.data;
  const co = t.roff + (callAt - t.va);
  // try start offsets until a chain of push imm32 / push imm8 lands exactly on the call
  for (let back = 6 * 5; back >= 6 * 2; back--) {
    let o = co - back;
    const vals: number[] = [];
    while (o < co) {
      if (d[o] === 0x68) { vals.push((d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24)) >>> 0); o += 5; }
      else if (d[o] === 0x6a) { vals.push((d[o + 1] << 24 >> 24) >>> 0); o += 2; }
      else break;
    }
    if (o === co && vals.length >= 6) return vals.reverse();
  }
  return null;
}

export function extractRenderParams(pe: Pe, builderAt: number): ZoneRenderParams {
  const t = pe.text, d = pe.data;
  const calls: number[] = [];
  const seaStores: { at: number; v: number }[] = [];
  const lo = t.roff, hi = t.roff + t.rsize - 10;
  for (let o = lo; o < hi; o++) {
    if (d[o] === 0xe8) {
      const rel = d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24);
      if (((t.va + (o - lo) + 5 + rel) >>> 0) === SETUP_FOG) calls.push(t.va + (o - lo));
    } else if (d[o] === 0xc7 && d[o + 1] === 0x05) {
      const g = (d[o + 2] | (d[o + 3] << 8) | (d[o + 4] << 16) | (d[o + 5] << 24)) >>> 0;
      if (g === SEA_LEVEL_GLOBAL) seaStores.push({ at: t.va + (o - lo), v: (d[o + 6] | (d[o + 7] << 8) | (d[o + 8] << 16) | (d[o + 9] << 24)) >>> 0 });
    }
  }
  // the zone's set-up code is the nearest block of such calls in front of its builder function
  const before = calls.filter((c) => c < builderAt);
  const c0 = before.length ? before[before.length - 1] : 0;
  const mine = before.filter((c) => c0 - c <= 0x6000);
  const fog: FogSetup[] = [];
  for (const at of mine) {
    const a = pushChain(pe, at);
    if (!a) continue;
    // arguments (pushed right to left): near, farMin, farMax, fogFrac, colour, enable
    fog.push({ near: asFloat(a[0]), farMin: asFloat(a[1]), farMax: asFloat(a[2]), fogFrac: asFloat(a[3]), color: a[4], enabled: a[5] !== 0, at });
  }
  let seaLevel: number | null = null;
  if (c0) {
    for (const s of seaStores) if (s.at < builderAt && Math.abs(c0 - s.at) <= 0x6000) seaLevel = asFloat(s.v);
  }
  return { fog, seaLevel };
}

/** Far plane / fog range from the zone setup and the options slider (0..100, game default 50), FUN_004095ab */
export function fogRange(f: FogSetup, slider = 50): { near: number; far: number; fogStart: number; fogEnd: number } {
  const far = (f.farMax - f.farMin) * ((100 - slider) / 100) + f.farMin;
  return { near: Math.max(f.near, 1), far, fogStart: far - (f.fogFrac * far) / f.farMax, fogEnd: far };
}
