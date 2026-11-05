// LEGO 3D generator "plants": the game's pine and oak trees rebuilt as stacks of LEGO round plates (docs/re/lego3d.md section 19): the pine as eight octagonal plates whose radius follows the game's cone, the oak as eight
// (six at the far LOD) 10-sided plates following its ball, both on a round-brick trunk and a round-plate foot, at the footprint and height of the game's mesh (silhouette IoU >= 0.9 over six views, measured when the
// pack is built and by the test) and with the game's own texture slots, so the foliage keeps the game's picture.
//
// Two-layer rule: the pack holds only generated geometry in the game's frame (tools/lego3d/pack/plants.mjs: plate outlines whose sizes are fitted numbers, revolved in 8 / 10 sides, positions and normals) and, per member, the content hash of the
// GAME's mesh, its group flags and the numbers of the texture mapping measured from it (an affine u, v of the position per group, the middle of a lit pad for the horizontal faces). At run time every member whose current
// content matches the hash is replaced (same groups in the same order, white vertex colours like the game's); a member that does not match (the player's own mod) is left alone. The trees have no skeleton and no MATL, the
// collision objects are other files: nothing but the picture of the mesh changes.
import type { Generator } from './types.ts';
import { decodeMesh, hashMember } from '../meshpack.ts';
import { writeMsh } from '../mshio.ts';

/** texture mapping of one group: u = a . (x, y, z, 1), v = b . (x, y, z, 1) (`a`, `b`: 4 numbers), or the constant texel `c`; vertices whose normal points up more than `flatY` take the texel `flat` */
export interface PlantUv { a?: number[]; b?: number[]; c?: [number, number]; flat?: [number, number] }
export interface PlantEntry { member: string; hash: string; model: string; groups: { flags: number; uv: PlantUv }[] }
export interface PlantTable { v: number; archive: string; entries: PlantEntry[] }
export const FLAT_Y = 0.6;

export const generator: Generator = {
  id: 'plants',
  applies: (name, pack) => pack.has(`plants/arch/${name.toLowerCase()}.json`),
  async run(env) {
    let table: PlantTable;
    try { table = await env.pack.json<PlantTable>(`plants/arch/${env.name.toLowerCase()}.json`); } catch (e) { env.log(`no plants table: ${String(e)}`); return; }
    const blobs = new Map<string, ReturnType<typeof decodeMesh>>();
    let replaced = 0, left = 0, missing = 0, trianglesAfter = 0;
    for (const e of table.entries) {
      const cur = env.read(e.member);
      if (!cur) { missing++; continue; }
      if (hashMember(cur) !== e.hash) { left++; continue; }   // not the game's own mesh any more: leave it
      try {
        let groups = blobs.get(e.model);
        if (!groups) { groups = decodeMesh(await env.pack.get(`plants/${e.model}.bin`)); blobs.set(e.model, groups); }
        if (groups.length !== e.groups.length || groups.some((g) => g.kind !== 0)) { env.log(`${e.member}: group count differs from the model`); continue; }
        const out = groups.map((g, gi) => {
          const nv = g.pos.length / 3, uv = new Float32Array(nv * 2), spec = e.groups[gi].uv;
          for (let v = 0; v < nv; v++) {
            const x = g.pos[v * 3], y = g.pos[v * 3 + 1], z = g.pos[v * 3 + 2];
            if (spec.flat && g.nrm[v * 3 + 1] > FLAT_Y) { uv[v * 2] = spec.flat[0]; uv[v * 2 + 1] = spec.flat[1]; }
            else if (spec.a && spec.b) { uv[v * 2] = spec.a[0] * x + spec.a[1] * y + spec.a[2] * z + spec.a[3]; uv[v * 2 + 1] = spec.b[0] * x + spec.b[1] * y + spec.b[2] * z + spec.b[3]; }
            else { uv[v * 2] = spec.c?.[0] ?? 0.5; uv[v * 2 + 1] = spec.c?.[1] ?? 0.5; }
          }
          trianglesAfter += g.idx.length / 3;
          return { flags: e.groups[gi].flags, pos: g.pos, nrm: g.nrm, uv, idx: g.idx };
        });
        env.put(e.member, writeMsh(out));
        replaced++;
      } catch (err) { env.log(`${e.member}: ${String(err)}`); }
    }
    env.stats.replaced = replaced; env.stats.left = left; env.stats.missing = missing; env.stats.trianglesAfter = trianglesAfter;
  },
};
