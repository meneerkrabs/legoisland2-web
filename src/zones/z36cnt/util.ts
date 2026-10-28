/** a float32 given as its bit pattern in the executable (immediates of the zone's functions) */
export function f32(h: number): number { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, h >>> 0); return b.getFloat32(0); }
