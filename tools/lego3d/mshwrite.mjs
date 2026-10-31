// Writer for the game's .msh format (docs/re/formats.md section 4): VERT (32 bytes/vertex) + normals, INDL, GRPL, optional SVWL + AVW2.
// A mesh = { groups: [{ flags, pos: Float32Array(3n), nrm: Float32Array(3n), uv: Float32Array(2n), idx: Uint16Array|number[] (relative to the group), skin?: { bone: Int32Array(n), weight: Float32Array(n), extra: [{ v (index in the WHOLE mesh), bone, weight, local: [x,y,z] }] } }] }
// Skin extras are given per group with `v` = vertex index inside the group; they are renumbered here.
export function writeMsh(groups, { skinned = false, identityMatl = false, gtom = null, matl = null } = {}) {
  const n = groups.reduce((s, g) => s + g.pos.length / 3, 0);
  const k = groups.reduce((s, g) => s + g.idx.length, 0);
  const extras = [];
  if (skinned) { let base = 0; for (const g of groups) { for (const e of g.skin.extra ?? []) extras.push({ ...e, v: e.v + base }); base += g.pos.length / 3; } }
  const size = 8 + n * 32 + n * 12 + 8 + k * 2 + 8 + groups.length * 20 + (skinned ? 8 + n * 8 + 8 + extras.length * 24 : 0) + (identityMatl ? 8 + groups.length * 4 + 8 + 36 : 0) + (gtom ? 8 + gtom.length * 4 + 8 + matl.length * 4 : 0);
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  let p = 0;
  const tag = (t) => { for (let i = 0; i < 4; i++) dv.setUint8(p++, t.charCodeAt(i)); };
  const u32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const i32 = (v) => { dv.setInt32(p, v, true); p += 4; };
  const f32 = (v) => { dv.setFloat32(p, v, true); p += 4; };
  tag('VERT'); u32(n);
  for (const g of groups) for (let i = 0; i < g.pos.length / 3; i++) {
    f32(g.pos[i * 3]); f32(g.pos[i * 3 + 1]); f32(g.pos[i * 3 + 2]); u32(0xffffffff); f32(g.uv[i * 2]); f32(g.uv[i * 2 + 1]); f32(g.uv[i * 2]); f32(g.uv[i * 2 + 1]);
  }
  for (const g of groups) for (let i = 0; i < g.nrm.length; i++) f32(g.nrm[i]);
  tag('INDL'); u32(k);
  for (const g of groups) for (const i of g.idx) { dv.setUint16(p, i, true); p += 2; }
  tag('GRPL'); u32(groups.length);
  let fv = 0, fi = 0;
  for (const g of groups) { u32(g.flags ?? 0); u32(g.idx.length); u32(fv); u32(g.pos.length / 3); u32(fi); fv += g.pos.length / 3; fi += g.idx.length; }
  if (identityMatl) {
    tag('GTOM'); u32(groups.length); for (let i = 0; i < groups.length; i++) u32(0);
    tag('MATL'); u32(1); for (const v of [0, 0, 0, 0, 0, 0, 1, 1, 1]) f32(v);
  }
  if (gtom) {
    tag('GTOM'); u32(gtom.length); for (const g of gtom) u32(g);
    tag('MATL'); u32(matl.length / 9); for (const v of matl) f32(v);
  }
  if (skinned) {
    tag('SVWL'); u32(n);
    for (const g of groups) for (let i = 0; i < g.pos.length / 3; i++) { i32(g.skin.bone[i]); f32(g.skin.weight[i]); }
    tag('AVW2'); u32(extras.length);
    for (const e of extras) { f32(e.local[0]); f32(e.local[1]); f32(e.local[2]); u32(e.v); u32(e.bone); f32(e.weight); }
  }
  if (p !== size) throw new Error(`size ${p} != ${size}`);
  return new Uint8Array(buf);
}
