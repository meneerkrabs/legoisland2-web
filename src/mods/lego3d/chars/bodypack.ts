// The pack's body blobs: the fitted, decimated, pre-skinned LDraw geometry of one LOD of one body layout (positions in the reference pose, game axes). Written by
// tools/lego3d/pack/chars.mjs (encodeBody), read by the assembler (decodeBody). Layout (little endian):
//   u32 magic "CBD1", u32 nV, u32 nT, f32 lo[3], f32 hi[3], u16 pos[3 nV] (quantised to lo..hi), u8 bone[4 nV] (255 = none), u8 weight[4 nV] (sum 255), u16 idx[3 nT], u8 group[nT], u8 part[nT]
export interface BodyBlob {
  pos: Float32Array;
  /** 4 influences per vertex: bone (255 = unused) */
  bone: Uint8Array;
  /** 4 weights per vertex (floats, sum 1) */
  weight: Float32Array;
  idx: Uint16Array;
  /** per triangle: the group (index in the ORIGINAL mesh's group list) it goes to */
  group: Uint8Array;
  /** per triangle: which LDraw part it belongs to (index into the table's part list): decals are cut with the band planes of their host part */
  part: Uint8Array;
}
const MAGIC = 0x3244_4243;   // "CBD2"

export function encodeBody(b: { pos: ArrayLike<number>; bone: ArrayLike<number>; weight: ArrayLike<number>; idx: ArrayLike<number>; group: ArrayLike<number>; part: ArrayLike<number> }): Uint8Array {
  const nV = b.pos.length / 3, nT = b.idx.length / 3;
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], b.pos[i * 3 + c]); hi[c] = Math.max(hi[c], b.pos[i * 3 + c]); }
  const size = 12 + 24 + nV * 6 + nV * 4 + nV * 4 + nT * 6 + nT * 2;
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  let p = 0;
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; }, f32 = (v: number) => { dv.setFloat32(p, v, true); p += 4; };
  u32(MAGIC); u32(nV); u32(nT);
  for (const v of lo) f32(v); for (const v of hi) f32(v);
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { const r = hi[c] - lo[c] || 1; dv.setUint16(p, Math.round(((b.pos[i * 3 + c] - lo[c]) / r) * 65535), true); p += 2; }
  for (let i = 0; i < nV * 4; i++) dv.setUint8(p++, b.bone[i]);
  for (let i = 0; i < nV; i++) {   // weights to 8 bits, the remainder to the largest, so they sum to 255
    const w = [0, 1, 2, 3].map((k) => (b.bone[i * 4 + k] === 255 ? 0 : b.weight[i * 4 + k]));
    const q = w.map((x) => Math.round(x * 255)); let s = q.reduce((a, c) => a + c, 0), big = 0;
    for (let k = 1; k < 4; k++) if (w[k] > w[big]) big = k;
    q[big] += 255 - s; s = 255;
    for (let k = 0; k < 4; k++) dv.setUint8(p++, q[k]);
  }
  for (let i = 0; i < nT * 3; i++) { dv.setUint16(p, b.idx[i], true); p += 2; }
  for (let i = 0; i < nT; i++) dv.setUint8(p++, b.group[i]);
  for (let i = 0; i < nT; i++) dv.setUint8(p++, b.part[i]);
  return new Uint8Array(buf);
}

export function decodeBody(bytes: Uint8Array): BodyBlob {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a body blob');
  const nV = dv.getUint32(4, true), nT = dv.getUint32(8, true);
  const lo = [0, 1, 2].map((c) => dv.getFloat32(12 + c * 4, true)), hi = [0, 1, 2].map((c) => dv.getFloat32(24 + c * 4, true));
  let p = 36;
  const pos = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) { pos[i * 3 + c] = lo[c] + (dv.getUint16(p, true) / 65535) * (hi[c] - lo[c]); p += 2; }
  const bone = new Uint8Array(bytes.subarray(p, p + nV * 4)); p += nV * 4;
  const weight = new Float32Array(nV * 4);
  for (let i = 0; i < nV * 4; i++) weight[i] = bytes[p + i] / 255;
  p += nV * 4;
  const idx = new Uint16Array(nT * 3);
  for (let i = 0; i < nT * 3; i++) { idx[i] = dv.getUint16(p, true); p += 2; }
  const group = new Uint8Array(bytes.subarray(p, p + nT)); p += nT;
  const part = new Uint8Array(bytes.subarray(p, p + nT));
  return { pos, bone, weight, idx, group, part };
}
