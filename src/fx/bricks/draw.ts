// Drawing the brick effects (Effects.c FUN_00886be0 / FUN_00886b34, docs/re/rendering.md "Brick batches"): the original transforms every visible brick's
// LOD mesh on the CPU into ping-pong vertex buffers and flushes them once per frame with state preset 5; each vertex gets the texture coordinate of
// its palette cell (u, v of the 32-entry table at 0x981980): the first `split` vertices the brick's first colour, the rest its second colour.
// Here every (brick, LOD, colours) mesh is uploaded once with those texture coordinates and drawn with the brick's world matrix (same pixels, one
// draw per brick instead of a batch).
import type { Renderer, MeshGpu } from '../../render/index.ts';
import type { Msh } from '../../formats/msh.ts';
import { brickPaletteUv } from '../../formats/bricks.ts';
import type { BrickLibrary } from '../../formats/bricks.ts';
import type { BrickFxManager } from './manager.ts';
import type { Brick } from './sim.ts';

/** FUN_00886b34: the brick batches are drawn with state preset 5 (modulate, texture alpha, alpha blend, specular) */
export const BRICK_PRESET = 5;

const caches = new WeakMap<Renderer, Map<string, MeshGpu | null>>();

/** the mesh of brick `b` at its LOD with its colours (cached per renderer) */
function brickMesh(r: Renderer, lib: BrickLibrary, b: Brick): MeshGpu | null {
  const t = b.type;
  if (!t) return null;
  let c = caches.get(r);
  if (!c) caches.set(r, (c = new Map()));
  const key = `${t.index}/${b.lod}/${b.colour}/${b.colour2}`;
  if (c.has(key)) return c.get(key)!;
  let g: MeshGpu | null = null;
  const m = lib.meshOf(t, b.lod);
  if (m && m.vertexCount && m.indices.length) {
    const n = m.vertexCount, split = lib.splitOf(t, b.lod);
    const uv1 = brickPaletteUv(lib.pe, b.colour);
    // a missing second colour (-1) reads before the table in the original: drawn with the first colour here
    const uv2 = b.colour2 >= 0 ? brickPaletteUv(lib.pe, b.colour2) : uv1;
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const p = i < split ? uv1 : uv2; uvs[i * 2] = p[0]; uvs[i * 2 + 1] = p[1]; }
    const msh: Msh = {
      vertexCount: n, positions: m.positions, colors: new Uint32Array(n).fill(0xffffffff), uvs, uvs2: uvs, normals: m.normals,
      indices: m.indices, groups: [{ flags: 0, indexCount: m.indices.length, firstVertex: 0, vertexCount: n, firstIndex: 0 }],
      gtom: null, matl: null, svwl: null,
    };
    g = r.uploadMesh(msh);
  }
  c.set(key, g);
  return g;
}

/** draw every brick of the effects whose draw pass ran this tick (after the records, before the particles: FUN_00442930) */
export function drawBrickFx(r: Renderer, fx: BrickFxManager): number {
  const lib = fx.lib;
  const tex = r.texture(lib.bricks, 0, '');
  let n = 0;
  for (const b of fx.drawList()) {
    const g = brickMesh(r, lib, b);
    if (!g) continue;
    r.drawMesh(g, b.world, () => tex, { preset: BRICK_PRESET });
    n++;
  }
  return n;
}
