// Compact mesh blobs of the LEGO 3D pack for the brick and set generators (LDraw-derived geometry only), isomorphic (node + browser), no enums / parameter properties.
// A blob = a list of groups; a group is either geometry (positions quantised to 16 bit over the group's own box, normals 8 bit, 16-bit indices relative to the group) or a PLACEHOLDER
// (kind 1: its content comes from the player's own archive at run time, never from the pack).
//   u32 'MSH1' | u16 groups | u16 reserved | per group: u8 kind | u8 0 | u16 nv | u32 ni | u32 flags | f32 lo[3] | f32 step[3] | kind 0: nv * 3 * u16 pos, nv * 3 * i8 nrm, ni * u16 idx
// Decoding is exact and deterministic: pos = lo + q * step in float32, normal = i8 / 127 renormalised in float32.
export interface PackGroup {
  kind: number;
  flags: number;
  pos: Float32Array;
  nrm: Float32Array;
  /** indices relative to the group's first vertex */
  idx: Uint16Array;
}
const MAGIC = 0x3148534d;   // "MSH1"

export function encodeMesh(groups: { kind?: number; flags?: number; pos?: ArrayLike<number>; nrm?: ArrayLike<number>; idx?: ArrayLike<number> }[]): Uint8Array {
  let size = 8;
  for (const g of groups) size += 40 + (g.kind === 1 ? 0 : 2 * (g.pos?.length ?? 0) + pad4((g.nrm?.length ?? 0)) + 2 * (g.idx?.length ?? 0));
  const buf = new ArrayBuffer(size + 4), dv = new DataView(buf);
  let p = 0;
  const u8 = (v: number) => { dv.setUint8(p, v); p += 1; };
  const u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  const f32 = (v: number) => { dv.setFloat32(p, v, true); p += 4; };
  u32(MAGIC); u16(groups.length); u16(0);
  for (const g of groups) {
    const kind = g.kind ?? 0, pos = g.pos ?? [], nrm = g.nrm ?? [], idx = g.idx ?? [], nv = pos.length / 3;
    u8(kind); u8(0); u16(kind === 1 ? 0 : nv); u32(kind === 1 ? 0 : idx.length); u32(g.flags ?? 0);
    const lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
    if (kind === 0) for (let i = 0; i < pos.length; i++) { const c = i % 3; if (pos[i] < lo[c]) lo[c] = pos[i]; if (pos[i] > hi[c]) hi[c] = pos[i]; }
    else { lo[0] = lo[1] = lo[2] = 0; hi[0] = hi[1] = hi[2] = 0; }
    const step = [0, 1, 2].map((c) => Math.fround(Math.max((hi[c] - lo[c]) / 65535, 1e-9)));
    for (let c = 0; c < 3; c++) f32(lo[c]);
    for (let c = 0; c < 3; c++) f32(step[c]);
    if (kind === 1) continue;
    const lof = lo.map(Math.fround);
    for (let i = 0; i < pos.length; i++) { const c = i % 3; u16(Math.max(0, Math.min(65535, Math.round((pos[i] - lof[c]) / step[c])))); }
    for (let i = 0; i < nrm.length; i++) dv.setInt8(p++, Math.max(-127, Math.min(127, Math.round(nrm[i] * 127))));
    while (p % 4) p++;
    for (let i = 0; i < idx.length; i++) u16(idx[i]);
  }
  return new Uint8Array(buf, 0, p);
}
const pad4 = (n: number) => (n + 3) & ~3;

export function decodeMesh(bytes: Uint8Array): PackGroup[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a LEGO 3D mesh blob');
  const n = dv.getUint16(4, true);
  let p = 8;
  const out: PackGroup[] = [];
  for (let g = 0; g < n; g++) {
    const kind = dv.getUint8(p), nv = dv.getUint16(p + 2, true), ni = dv.getUint32(p + 4, true), flags = dv.getUint32(p + 8, true);
    const lo = [dv.getFloat32(p + 12, true), dv.getFloat32(p + 16, true), dv.getFloat32(p + 20, true)], step = [dv.getFloat32(p + 24, true), dv.getFloat32(p + 28, true), dv.getFloat32(p + 32, true)];
    p += 36;
    if (kind === 1) { out.push({ kind, flags, pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint16Array(0) }); continue; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint16Array(ni);
    for (let i = 0; i < nv * 3; i++) { pos[i] = Math.fround(lo[i % 3] + Math.fround(dv.getUint16(p, true) * step[i % 3])); p += 2; }
    for (let v = 0; v < nv; v++) {
      const x = dv.getInt8(p + v * 3) / 127, y = dv.getInt8(p + v * 3 + 1) / 127, z = dv.getInt8(p + v * 3 + 2) / 127, l = Math.hypot(x, y, z) || 1;
      nrm[v * 3] = x / l; nrm[v * 3 + 1] = y / l; nrm[v * 3 + 2] = z / l;
    }
    p += nv * 3; p = (p + 3) & ~3;
    for (let i = 0; i < ni; i++) { idx[i] = dv.getUint16(p, true); p += 2; }
    out.push({ kind, flags, pos, nrm, idx });
  }
  return out;
}

/** content hash of a member: two 32-bit FNV-1a style hashes (different seeds / multipliers) + the length -> 16 hex digits (not cryptographic: it tells the game's meshes from a mod's) */
export function hashMember(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) ^ (h2 >>> 13);
  }
  h1 = (h1 ^ b.length) >>> 0; h2 = (h2 + b.length) >>> 0;
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
