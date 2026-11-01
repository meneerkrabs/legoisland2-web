// Writer for the game's .msh format (docs/re/formats.md section 4) for the LEGO 3D generators, pure TS (node + browser): VERT (32 bytes / vertex) + normals, INDL, GRPL,
// optional GTOM + MATL and SVWL + AVW2 (skinned meshes). Parsed back by src/formats/msh.ts (`parseMsh`, `validateMsh`).
export interface MshSkinExtra { /** vertex index inside the group */ v: number; bone: number; weight: number; local: [number, number, number] }
export interface MshOutGroup {
  flags?: number;
  pos: ArrayLike<number>;
  nrm: ArrayLike<number>;
  uv: ArrayLike<number>;
  /** indices relative to the group's first vertex */
  idx: ArrayLike<number>;
  /** per-vertex skin (the primary bone + weight, as SVWL) and the extra influences (AVW2) of the vertices of this group */
  skin?: { bone: ArrayLike<number>; weight: ArrayLike<number>; extra?: MshSkinExtra[] };
  /** vertex colour (0xAARRGGBB), default white */
  colour?: number;
}
export interface MshWriteOptions { skinned?: boolean; identityMatl?: boolean; gtom?: ArrayLike<number> | null; matl?: ArrayLike<number> | null }

export function writeMsh(groups: MshOutGroup[], { skinned = false, identityMatl = false, gtom = null, matl = null }: MshWriteOptions = {}): Uint8Array {
  const n = groups.reduce((s, g) => s + g.pos.length / 3, 0);
  const k = groups.reduce((s, g) => s + g.idx.length, 0);
  const extras: (MshSkinExtra & { v: number })[] = [];
  if (skinned) { let base = 0; for (const g of groups) { for (const e of g.skin?.extra ?? []) extras.push({ ...e, v: e.v + base }); base += g.pos.length / 3; } }
  const size = 8 + n * 32 + n * 12 + 8 + k * 2 + 8 + groups.length * 20 + (skinned ? 8 + n * 8 + 8 + extras.length * 24 : 0) + (identityMatl ? 8 + groups.length * 4 + 8 + 36 : 0) + (gtom ? 8 + gtom.length * 4 + 8 + (matl as ArrayLike<number>).length * 4 : 0);
  const buf = new ArrayBuffer(size), dv = new DataView(buf);
  let p = 0;
  const tag = (t: string) => { for (let i = 0; i < 4; i++) dv.setUint8(p++, t.charCodeAt(i)); };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; };
  const i32 = (v: number) => { dv.setInt32(p, v, true); p += 4; };
  const f32 = (v: number) => { dv.setFloat32(p, v, true); p += 4; };
  tag('VERT'); u32(n);
  for (const g of groups) for (let i = 0; i < g.pos.length / 3; i++) {
    f32(g.pos[i * 3]); f32(g.pos[i * 3 + 1]); f32(g.pos[i * 3 + 2]); u32(g.colour ?? 0xffffffff); f32(g.uv[i * 2]); f32(g.uv[i * 2 + 1]); f32(g.uv[i * 2]); f32(g.uv[i * 2 + 1]);
  }
  for (const g of groups) for (let i = 0; i < g.nrm.length; i++) f32(g.nrm[i]);
  tag('INDL'); u32(k);
  for (const g of groups) for (let i = 0; i < g.idx.length; i++) { dv.setUint16(p, g.idx[i], true); p += 2; }
  tag('GRPL'); u32(groups.length);
  let fv = 0, fi = 0;
  for (const g of groups) { u32(g.flags ?? 0); u32(g.idx.length); u32(fv); u32(g.pos.length / 3); u32(fi); fv += g.pos.length / 3; fi += g.idx.length; }
  if (identityMatl) {
    tag('GTOM'); u32(groups.length); for (let i = 0; i < groups.length; i++) u32(0);
    tag('MATL'); u32(1); for (const v of [0, 0, 0, 0, 0, 0, 1, 1, 1]) f32(v);
  }
  if (gtom) {
    tag('GTOM'); u32(gtom.length); for (let i = 0; i < gtom.length; i++) u32(gtom[i]);
    const m = matl as ArrayLike<number>;
    tag('MATL'); u32(m.length / 9); for (let i = 0; i < m.length; i++) f32(m[i]);
  }
  if (skinned) {
    tag('SVWL'); u32(n);
    for (const g of groups) for (let i = 0; i < g.pos.length / 3; i++) { const s = g.skin as NonNullable<MshOutGroup['skin']>; i32(s.bone[i]); f32(s.weight[i]); }
    tag('AVW2'); u32(extras.length);
    for (const e of extras) { f32(e.local[0]); f32(e.local[1]); f32(e.local[2]); u32(e.v); u32(e.bone); f32(e.weight); }
  }
  if (p !== size) throw new Error(`size ${p} != ${size}`);
  return new Uint8Array(buf);
}

/** splits an indexed mesh with one group id per triangle into per-group mesh pieces (each with its own vertex range, indices relative): [{ group, pos, idx, srcVertex }] sorted by group id */
export function splitByGroup(pos: ArrayLike<number>, idx: ArrayLike<number>, tgroup: ArrayLike<number>): { group: number; srcVertex: number[]; idx: number[] }[] {
  const by = new Map<number, { group: number; map: Map<number, number>; srcVertex: number[]; idx: number[] }>();
  for (let t = 0; t < idx.length / 3; t++) {
    const gid = tgroup[t];
    let g = by.get(gid);
    if (!g) { g = { group: gid, map: new Map(), srcVertex: [], idx: [] }; by.set(gid, g); }
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let l = g.map.get(v);
      if (l === undefined) { l = g.srcVertex.length; g.map.set(v, l); g.srcVertex.push(v); }
      g.idx.push(l);
    }
  }
  return [...by.values()].sort((a, b) => a.group - b.group).map(({ group, srcVertex, idx: i }) => ({ group, srcVertex, idx: i }));
}
