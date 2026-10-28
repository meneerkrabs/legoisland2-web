// `lights/lights.lgt` (magic LGTL): per-zone static light list used for software vertex lighting.
// Loader FUN_008864b6 (0x008864b6) + FUN_008849c6 (0x008849c6) convert it to runtime lights, FUN_00884f68 evaluates them.
// See docs/re/fragments/script-text.md.
import { Reader } from './reader.ts';

export type LightType = 'point' | 'spot' | 'directional' | 'unknown';
export interface Light {
  /** 0 = point, 1 = spot (never seen), 2 = directional (sun) */
  type: number;
  typeName: LightType;
  /** the two 0.5 floats after the type (D3D theta/phi-like; always 0.5) */
  a: number; b: number;
  /** range (1000 .. 10000) */
  range: number;
  /** position (point lights; 0,0,0 for the directional light) */
  position: [number, number, number];
  /** direction (directional lights; 0,1,0 placeholder for point lights) */
  direction: [number, number, number];
  /** RGB of the three colour slots followed by one pad float each */
  ambient: [number, number, number];
  ambientPad: number;
  diffuse: [number, number, number];
  diffusePad: number;
  specular: [number, number, number];
  specularPad: number;
}
export interface LightFile {
  /**
   * header word at +4: the number of 88-byte records the game's loader (FUN_008864b6) reads. The files contain
   * fewer records (usually declaredCount - 1, up to declaredCount - 4); the missing ones read as zero (black point lights at 0,0,0).
   */
  declaredCount: number;
  lights: Light[];
}
export const LGT_RECORD_SIZE = 88;

export function parseLgt(data: Uint8Array): LightFile {
  const r = new Reader(data);
  r.expectTag('LGTL');
  const declaredCount = r.u32();
  const n = (data.length - 8) / LGT_RECORD_SIZE;
  if (!Number.isInteger(n)) throw new Error(`size ${data.length} is not 8 + n*${LGT_RECORD_SIZE}`);
  const lights: Light[] = [];
  const v3 = (): [number, number, number] => [r.f32(), r.f32(), r.f32()];
  for (let i = 0; i < n; i++) {
    const type = r.u32();
    const a = r.f32(), b = r.f32(), range = r.f32();
    const position = v3(), direction = v3();
    const ambient = v3(); const ambientPad = r.f32();
    const diffuse = v3(); const diffusePad = r.f32();
    const specular = v3(); const specularPad = r.f32();
    lights.push({ type, typeName: type === 0 ? 'point' : type === 1 ? 'spot' : type === 2 ? 'directional' : 'unknown', a, b, range, position, direction, ambient, ambientPad, diffuse, diffusePad, specular, specularPad });
  }
  if (r.remaining !== 0) throw new Error('trailing bytes');
  return { declaredCount, lights };
}
