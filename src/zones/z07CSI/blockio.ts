// The save blocks of the hub nodes (WP-SAVE, docs/re/save.md): a node's block is a raw byte range of the original's node struct. These two helpers lay float32 / int32 / byte fields out at the
// ORIGINAL's offsets (relative to the first saved byte) so that `saveBlock` / `loadBlock` read like the original's `*out = node + 0xNN; return size` / memcpy pair. Shared by the castle's and
// the Adventure Island's nodes (src/zones/z13CAI imports it).
const dv = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** assemble a block of `size` bytes: the offsets are relative to the first saved byte (the node's +0x18 for the horse ...) */
export class BlockOut {
  readonly bytes: Uint8Array;
  private readonly v: DataView;
  constructor(size: number) { this.bytes = new Uint8Array(size); this.v = dv(this.bytes); }
  f32(off: number, x: number): this { this.v.setFloat32(off, x, true); return this; }
  i32(off: number, x: number): this { this.v.setInt32(off, x | 0, true); return this; }
  u32(off: number, x: number): this { this.v.setUint32(off, x >>> 0, true); return this; }
  u8(off: number, x: number): this { this.v.setUint8(off, x & 0xff); return this; }
}

/** read a block back (the loader's memcpy into the node) */
export class BlockIn {
  readonly bytes: Uint8Array;
  private readonly v: DataView;
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.v = dv(bytes); }
  f32(off: number): number { return this.v.getFloat32(off, true); }
  i32(off: number): number { return this.v.getInt32(off, true); }
  u32(off: number): number { return this.v.getUint32(off, true); }
  u8(off: number): number { return this.v.getUint8(off); }
}
