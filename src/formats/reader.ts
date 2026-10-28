// Tiny little-endian cursor over a Uint8Array. Pure, no DOM.
export class Reader {
  readonly data: Uint8Array;
  readonly dv: DataView;
  pos = 0;
  constructor(data: Uint8Array, pos = 0) {
    this.data = data;
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = pos;
  }
  get length() { return this.data.length; }
  get remaining() { return this.data.length - this.pos; }
  eof() { return this.pos >= this.data.length; }
  u8() { return this.data[this.pos++]; }
  i8() { return this.dv.getInt8(this.pos++); }
  u16() { const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  tag(): string {
    const d = this.data, p = this.pos;
    this.pos += 4;
    return String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
  }
  peekTag(): string {
    const d = this.data, p = this.pos;
    return String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
  }
  expectTag(t: string) {
    const at = this.pos;
    const g = this.tag();
    if (g !== t) throw new Error(`expected "${t}" at ${at}, got "${g}"`);
  }
  bytes(n: number): Uint8Array { const b = this.data.subarray(this.pos, this.pos + n); if (b.length !== n) throw new Error('read past end'); this.pos += n; return b; }
  skip(n: number) { this.pos += n; if (this.pos > this.data.length) throw new Error('skip past end'); }
  f32s(n: number): Float32Array {
    // copy: data may be unaligned
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.f32();
    return out;
  }
  u16s(n: number): Uint16Array {
    const out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u16();
    return out;
  }
  u32s(n: number): Uint32Array {
    const out = new Uint32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.u32();
    return out;
  }
  /** Text up to (not including) NUL or n bytes, latin-1. */
  cstr(n: number): string {
    const b = this.bytes(n);
    let s = '';
    for (let i = 0; i < b.length && b[i] !== 0; i++) s += String.fromCharCode(b[i]);
    return s;
  }
}

export function latin1(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 8192)));
  return s;
}
