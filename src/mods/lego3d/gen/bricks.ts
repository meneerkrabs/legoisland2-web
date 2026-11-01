// LEGO 3D generator "bricks": the brick library of the Bricks archive (lods/<brick>_lod0/1.msh) rebuilt from LDraw parts (docs/re/lego3d.md).
//
// Two-layer rule: the pack holds only LDraw-derived geometry in the game's frame (tools/lego3d/pack/bricks.mjs: part fitted to the game's brick by measurement, studs as prisms, hidden faces
// removed, the underside closed, decimated) and, per member, the content hash of the GAME's original mesh. At run time every LOD member whose current content matches that hash is replaced; a
// member that does not match (the player's own mod) is left alone. The game's far LOD (lod2, a 12-triangle box) always stays.
//
// The engine draws a brick with one palette cell (the vertices carry no UVs) and takes the first `split` vertices as the first colour, the rest as the second (windows, wheels ...):
// the first-colour counts of the replaced meshes go to the additive sidecar `lego3d/bricksplit.json` that BrickLibrary.splitOf reads (inert when the member does not exist).
import type { Generator } from './types.ts';
import { decodeMesh, hashMember } from '../meshpack.ts';
import { writeMsh } from '../mshio.ts';

export interface BrickLodEntry { off: number; len: number; split: number; tris: number; verts: number; hash: string }
export interface BrickEntry { tier: string; lods: Record<string, BrickLodEntry> }
export interface BrickIndex { v: number; studSides: [number, number]; bricks: Record<string, BrickEntry> }

export const generator: Generator = {
  id: 'bricks',
  applies: (name, pack) => name.toLowerCase() === 'bricks' && pack.has('bricks/index.json') && pack.has('bricks/lods.bin'),
  async run(env) {
    let index: BrickIndex;
    let bin: Uint8Array;
    try { index = await env.pack.json<BrickIndex>('bricks/index.json'); bin = await env.pack.get('bricks/lods.bin'); } catch (e) { env.log(`no brick data: ${String(e)}`); return; }
    const splits: Record<string, number> = {};
    let replaced = 0, left = 0, missing = 0, trisBefore = 0, trisAfter = 0;
    for (const name of Object.keys(index.bricks).sort()) {
      const b = index.bricks[name];
      for (const lod of Object.keys(b.lods)) {
        const e = b.lods[lod], member = `lods/${name}_lod${lod}.msh`;
        const cur = env.read(member);
        if (!cur) { missing++; continue; }
        if (hashMember(cur) !== e.hash) { left++; continue; }   // not the game's own mesh any more: leave it
        try {
          const g = decodeMesh(bin.subarray(e.off, e.off + e.len))[0];
          const nv = g.pos.length / 3;
          if (!g || g.kind !== 0 || !nv || g.idx.length % 3) { env.log(`${member}: bad pack entry`); continue; }
          env.put(member, writeMsh([{ flags: 0, pos: g.pos, nrm: g.nrm, uv: new Float32Array(nv * 2), idx: g.idx }]));
          splits[`${name.toLowerCase()}_${lod}`] = e.split;
          replaced++; trisAfter += e.tris;
        } catch (err) { env.log(`${member}: ${String(err)}`); }
      }
    }
    if (replaced) env.put('lego3d/bricksplit.json', new TextEncoder().encode(JSON.stringify(splits)));
    env.stats.replaced = replaced; env.stats.left = left; env.stats.missing = missing; env.stats.trianglesAfter = trisAfter; env.stats.trianglesBefore = trisBefore;
  },
};
