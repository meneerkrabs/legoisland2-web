// The argument block of a behaviour node of the island (docs/re/m4/emu.md): the 0x80 bytes the original's set-up code built in its scratch buffer
// (DAT_05d58668) and passed as FUN_00423532's third argument. The island's set-up is RUN out of the executable (src/formats/emusetup.ts), so the
// bytes are exactly what the constructor would have read. Pointers inside the block are emulated addresses: record pointers (0x10000000 + index * 0x68)
// resolve with `rec` / `recIndex`; pointers into the executable (strings, tables) with `str` (needs the Pe) or not at all.
import type { Attach } from '../formats/zonesetup.ts';
import type { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import type { Pe } from '../formats/exe.ts';

/** record array base of the emulation (emusetup.ts RECORDS_BASE) and the record stride of the original */
export const EMU_RECORDS_BASE = 0x10000000, EMU_RECORD_STRIDE = 0x68;

export class ArgView {
  readonly bytes: Uint8Array;
  readonly attach?: Attach;
  readonly dv: DataView;
  constructor(bytes: Uint8Array, attach?: Attach) { this.bytes = bytes; this.attach = attach; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  static of(attach: Attach & { args?: Uint8Array }): ArgView { return new ArgView(attach.args ?? new Uint8Array(0x80), attach); }
  u8(o: number) { return o < this.bytes.length ? this.bytes[o] : 0; }
  i8(o: number) { return (this.u8(o) << 24) >> 24; }
  u16(o: number) { return o + 2 <= this.bytes.length ? this.dv.getUint16(o, true) : 0; }
  i16(o: number) { return (this.u16(o) << 16) >> 16; }
  u32(o: number) { return o + 4 <= this.bytes.length ? this.dv.getUint32(o, true) : 0; }
  i32(o: number) { return this.u32(o) | 0; }
  f32(o: number) { return o + 4 <= this.bytes.length ? this.dv.getFloat32(o, true) : 0; }
  /** record index of the record pointer at byte offset `o` (-1 when it is not a record pointer) */
  recIndex(o: number): number { return recIndexOfPtr(this.u32(o)); }
  /** the record the pointer at `o` points to (any field of the record counts), null when it is none */
  rec(o: number, w: World): GameRecord | null { const i = this.recIndex(o); return i >= 0 ? w.records[i] ?? null : null; }
  /** NUL terminated string the pointer at `o` points to in the executable's image */
  str(o: number, pe: Pe): string { return pe.cstr(this.u32(o)); }
}

/** index of the record an emulated record pointer points into (any field), -1 otherwise */
export function recIndexOfPtr(ptr: number, count = 0x10000): number {
  const d = (ptr >>> 0) - EMU_RECORDS_BASE;
  if (d < 0 || d >= count * EMU_RECORD_STRIDE) return -1;
  return Math.floor(d / EMU_RECORD_STRIDE);
}
