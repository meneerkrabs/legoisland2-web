// Replay.c (Silicon Dreams common code, C:\projects\LegoIsland2\Common\Z20DSP\c_src\..., functions 0x6f3270 .. 0x6f349a): an input recorder / playback buffer.
// docs/re/m6/z20DSP.md section 8. The zone allocates one buffer of 0x1a5e0 bytes (FUN_006f3270(0x1a5e0), 9000 slots of 12 bytes = 300 s at 30 Hz) and the
// Speedster's update (FUN_006c2627) reserves one slot per tick while it is not replaying (FUN_006f331e(buffer, 0xc)); nothing in the shipped game fills the slot
// (FUN_006f343a, the "put" function, has no caller) and the playback side (FUN_006f336b / FUN_006f339d / FUN_006f3402, taken when var 0x106 != 0) is dead too:
// var 0x106 is only ever set to 0 by this zone. The port keeps the whole buffer (record, reserve, peek, advance, put, get) so a replay can be driven, and the Speedster
// uses it like the original: a reserve every live tick, and the playback branch when the replay variable is set.

/** buffer header: 5 dwords before the data (FUN_006f3270): +0 data start, +4 end (start - 4 + size), +8 write cursor, +0xc read cursor, +0x10 size */
export const REPLAY_HEADER = 0x14;
/** one slot (FUN_006f331e's `param_2` = 0xc): tag byte (+0: 2 reserved, 1 written), buttons u16 (+2), two signed bytes (+4 / +5), a dword (+8) */
export const REPLAY_SLOT = 0xc;
/** the zone's buffer size (FUN_006bf929: FUN_006f3270(0x1a5e0)) */
export const REPLAY_SIZE = 0x1a5e0;

export interface ReplaySample { buttons: number; x: number; y: number; extra: number }

export class ReplayBuffer {
  readonly size: number;
  /** data area; offsets below are relative to its start (the original stores absolute pointers) */
  readonly data: Uint8Array;
  private readonly view: DataView;
  /** +8: write cursor (next slot to reserve) */
  write = 0;
  /** +0xc: read cursor */
  read = 0;
  /** +4: one slot below the end (`start - 4 + size`): the original compares `cursor + n < end` */
  private readonly end: number;

  constructor(size = REPLAY_SIZE) {
    this.size = size;
    this.data = new Uint8Array(size + 16);
    this.view = new DataView(this.data.buffer);
    this.end = size - 4;
  }

  /** FUN_006f3302: both cursors back to the start */
  reset() { this.write = 0; this.read = 0; }

  /** FUN_006f331e(buffer, n): reserve n bytes at the write cursor; returns the offset of the reserved slot or -1 (the original returns 0) when the buffer is full. The slot's tag byte is set to 2. */
  reserve(n: number): number {
    if (this.write + n < this.end) {
      const at = this.write;
      this.write += n;
      this.data[this.write] = 2;       // `**(byte**)(buffer + 8) = 2`: the tag is written at the NEW cursor (the slot the next reserve returns), as the original does
      return at;
    }
    return -1;
  }

  /** FUN_006f336b: the slot at the read cursor, or -1 when the cursor has reached the end */
  peek(): number { return this.read < this.end ? this.read : -1; }

  /** FUN_006f339d: advance the read cursor past a written slot (tag 1) */
  advance(): void {
    const at = this.peek();
    if (at >= 0 && this.data[at] === 1) this.read += REPLAY_SLOT;
  }

  /** FUN_006f343a(slot, &buttons, &extra): write a sample into the slot at `at` (tag 1, u16 +2, bytes +4 / +5, dword +8) */
  put(at: number, s: ReplaySample): void {
    const d = this.data, v = this.view;
    d[at] = 1;
    v.setUint16(at + 2, s.buttons & 0xffff, true);
    d[at + 4] = s.x & 0xff; d[at + 5] = s.y & 0xff;
    v.setUint32(at + 8, s.extra >>> 0, true);
  }

  /** FUN_006f3402: read the sample of the slot at `at` (buttons u16, two signed bytes, dword) */
  get(at: number): ReplaySample {
    const d = this.data, v = this.view;
    return { buttons: v.getUint16(at + 2, true), x: (d[at + 4] << 24) >> 24, y: (d[at + 5] << 24) >> 24, extra: v.getUint32(at + 8, true) };
  }

  /** number of slots reserved so far */
  get count(): number { return this.write / REPLAY_SLOT; }
}
