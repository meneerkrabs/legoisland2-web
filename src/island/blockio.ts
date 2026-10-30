import type { World } from '../game/world.ts';
import type { GameRecord } from '../game/record.ts';
// WP-SAVE helpers for the per node save blocks (docs/re/save.md): a little-endian byte block written / read by field, floats as float32 bits.
/** a writer over a fresh zeroed block of `size` bytes */
export class BlockOut {
  readonly bytes: Uint8Array;
  private readonly dv: DataView;
  constructor(size: number, fill = 0) { this.bytes = new Uint8Array(size); if (fill) this.bytes.fill(fill); this.dv = new DataView(this.bytes.buffer); }
  u8(o: number, v: number) { this.dv.setUint8(o, v & 0xff); return this; }
  i16(o: number, v: number) { this.dv.setInt16(o, v << 16 >> 16, true); return this; }
  u16(o: number, v: number) { this.dv.setUint16(o, v & 0xffff, true); return this; }
  u32(o: number, v: number) { this.dv.setUint32(o, v >>> 0, true); return this; }
  i32(o: number, v: number) { this.dv.setInt32(o, v | 0, true); return this; }
  f32(o: number, v: number) { this.dv.setFloat32(o, v, true); return this; }
}
/** a reader over a block */
export class BlockIn {
  readonly bytes: Uint8Array;
  private readonly dv: DataView;
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  u8(o: number) { return this.dv.getUint8(o); }
  i16(o: number) { return this.dv.getInt16(o, true); }
  u16(o: number) { return this.dv.getUint16(o, true); }
  u32(o: number) { return this.dv.getUint32(o, true); }
  i32(o: number) { return this.dv.getInt32(o, true); }
  f32(o: number) { return this.dv.getFloat32(o, true); }
}

/** the first dword of a record: its 4 name characters (a shorter name is padded with 0; FUN_00419a79 looks records up by it) */
export function recordTag(name: string): number {
  let t = 0;
  for (let k = 0; k < 4; k++) t |= (k < name.length ? name.charCodeAt(k) & 0xff : 0) << (8 * k);
  return t >>> 0;
}

/**
 * The constructors' world work of the island's nodes (a constructor reads the record's position / mesh part matrices / game variables when the node is built, and the save block holds the results):
 * every node with a `ctorInit(world, record)` runs it once right after the set-up, in record order (the hubs do the same in `registerHub`, src/hub/game.ts).
 */
export function runCtorInits(w: World): void {
  for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) (n as { ctorInit?: (w: World, r: GameRecord) => void }).ctorInit?.(w, r);
}

/** the debug heap's fill byte of a new block (FUN_00433d38 -> __nh_malloc_dbg): a byte a constructor never writes is 0xCD in a real save */
export const CD = 0xcd;
/** the float32 whose bits are 0xCDCDCDCD (an unwritten float field) and the matching signed 32 bit / 16 bit values */
export const CDF = new Float32Array(new Uint32Array([0xcdcdcdcd]).buffer)[0];
export const CD32 = 0xcdcdcdcd | 0, CD16 = 0xcdcd << 16 >> 16;
/** copy the never written ranges (padding) of the block loaded last, if any, over `o`: a loaded block must save back as it was loaded */
export function keepRaw(o: BlockOut, raw: Uint8Array | null, ranges: [number, number][]): void {
  if (raw) for (const [a, n] of ranges) for (let i = 0; i < n; i++) o.bytes[a + i] = raw[a + i];
}
