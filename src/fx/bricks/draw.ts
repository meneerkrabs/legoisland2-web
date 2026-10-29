// Drawing the brick effects (Effects.c FUN_0044d420 -> FUN_00886be0 -> FUN_00886b34, flush FUN_00447de0, docs/re/rendering.md section 10): the original transforms the LOD mesh of every
// visible brick on the CPU into world space (positions with the brick matrix FUN_0043ab72, normals with its rotation rows FUN_0043abe6, no renormalisation), gives each vertex the texture
// coordinate of its palette cell (u, v of the table at 0x981980: the first `split` vertices the brick's first colour, the rest its second colour), lights the vertices with the
// specular variant of the game's lighting (FUN_0088612c against light set 0, world matrix = the identity DAT_05d5fb00, so the half vector uses the direction from the world origin to the
// camera) and appends them to one of two ping-pong buffers of 4096 vertices / 4096 indices (FVF 0x2c2, 36 bytes). A brick that no longer fits flushes the buffer first
// (`0x1000 - n <= used`); the rest is flushed once per frame by FUN_00447de0 after the records. Both flushes draw with state preset 5 (modulate, texture alpha, blended, SPECULARENABLE) and
// texture 0 of the brick archive. This module does exactly that on the GPU side of a WebGL buffer.
import type { Renderer, BatchGpu } from '../../render/index.ts';
import { prepareLights, lightShiny } from '../../render/meshlight.ts';
import type { PreparedLights } from '../../render/meshlight.ts';
import { transformPointGame, transformDirGame } from '../../render/math.ts';
import { brickPaletteUv } from '../../formats/bricks.ts';
import type { BrickLibrary } from '../../formats/bricks.ts';
import type { BrickFxManager } from './manager.ts';

/** FUN_00886b34: the brick batches are drawn with state preset 5 (modulate, texture alpha, alpha blend, specular) */
export const BRICK_PRESET = 5;
/** FUN_00886900: two buffers of 0x1000 vertices; DAT_05defb6c: 0x1000 16-bit indices */
export const BATCH_VERTICES = 0x1000, BATCH_INDICES = 0x1000;
/** DAT_05d5fb00: the batch's world matrix, an identity that nothing ever writes (FUN_0043ac78) */
const P3 = new Float32Array(3), N3 = new Float32Array(3), T3 = new Float32Array(3);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** the CPU side of one batch buffer (FVF 0x2c2 in the original: position, diffuse, specular, uv; here split into arrays) */
export class BrickBatchCpu {
  pos = new Float32Array(BATCH_VERTICES * 3); uv = new Float32Array(BATCH_VERTICES * 2);
  col = new Uint8Array(BATCH_VERTICES * 4); spec = new Uint8Array(BATCH_VERTICES * 4);
  idx = new Uint16Array(BATCH_INDICES);
  private nrm = new Float32Array(BATCH_VERTICES * 3);
  nv = 0; ni = 0;
  /** FUN_00886be0's test: the brick does not fit (the original flushes and swaps buffers) */
  full(nv: number, ni: number): boolean { return BATCH_VERTICES - nv <= this.nv || BATCH_INDICES - ni <= this.ni; }
  reset() { this.nv = 0; this.ni = 0; }
  /**
   * FUN_0044d420 (transform) + FUN_00886be0 (colours, lighting, indices): appends the brick mesh `m` (positions / normals / 16-bit indices) drawn with the brick matrix `w`;
   * the first `split` vertices get the palette cell `uv1`, the rest `uv2`; lit with the prepared lights (world space, FUN_0088612c)
   */
  add(m: { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number>; vertexCount: number }, w: ArrayLike<number>, split: number, uv1: readonly number[], uv2: readonly number[], prep: PreparedLights) {
    const nv = m.vertexCount, ni = m.indices.length, o = this.nv;
    for (let i = 0; i < nv; i++) {
      const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2];
      const q = (o + i) * 3;
      // FUN_0043ab72 (point) and FUN_0043abe6 (direction: the rotation rows, not renormalised): the products add up in x, y, z order, every operation rounded to a float
      P3[0] = x; P3[1] = y; P3[2] = z; transformPointGame(w, P3, T3);
      this.pos[q] = T3[0]; this.pos[q + 1] = T3[1]; this.pos[q + 2] = T3[2];
      N3[0] = m.normals[i * 3]; N3[1] = m.normals[i * 3 + 1]; N3[2] = m.normals[i * 3 + 2]; transformDirGame(w, N3, T3);
      this.nrm[i * 3] = T3[0]; this.nrm[i * 3 + 1] = T3[1]; this.nrm[i * 3 + 2] = T3[2];
      const uv = i < split ? uv1 : uv2;
      this.uv[(o + i) * 2] = uv[0]; this.uv[(o + i) * 2 + 1] = uv[1];
    }
    lightShiny(prep, nv, this.nrm, this.col.subarray(o * 4), this.spec.subarray(o * 4), false);
    for (let i = 0; i < ni; i++) this.idx[this.ni + i] = m.indices[i] + o;
    this.ni += ni; this.nv += nv;
  }
}
interface BatchState { gpu: BatchGpu[]; cpu: BrickBatchCpu[]; cur: number; flushes: number; draws: number }
const states = new WeakMap<Renderer, BatchState>();

function stateOf(r: Renderer): BatchState {
  let s = states.get(r);
  if (!s) {
    s = { gpu: [r.createBatch(BATCH_VERTICES, BATCH_INDICES), r.createBatch(BATCH_VERTICES, BATCH_INDICES)], cpu: [new BrickBatchCpu(), new BrickBatchCpu()], cur: 0, flushes: 0, draws: 0 };
    states.set(r, s);
  }
  return s;
}

/** FUN_00886b34 / the full-buffer branch of FUN_00886be0: draw what the current buffer holds and switch to the other one */
function flush(r: Renderer, s: BatchState, lib: BrickLibrary, swap: boolean) {
  const c = s.cpu[s.cur];
  if (c.nv > 0) {
    r.drawBatch(s.gpu[s.cur], c.nv, c.ni, c.pos, c.uv, c.col, c.spec, c.idx, r.texture(lib.bricks, 0, ''), BRICK_PRESET);
    s.draws++;
  }
  c.reset();
  if (swap) s.cur ^= 1;
}

/** statistics of the last frames (tests): number of buffer draws since the renderer was created */
export function brickBatchDraws(r: Renderer): number { return states.get(r)?.draws ?? 0; }

/** UV of colour -1 as the texture address mode resolves it (u = 2.9758521e29, v = 0: see drawBrickFx) */
function missingColourUv(lib: BrickLibrary, r: Renderer): [number, number] {
  const raw = brickPaletteUv(lib.pe, -1), t = r.texture(lib.bricks, 0, '');
  const wrap = (v: number, w: boolean) => (w ? v - Math.floor(v) : Math.min(1, Math.max(0, v)));
  return [wrap(raw[0], t?.wrapU ?? true), wrap(raw[1], t?.wrapV ?? true)];
}

/** draw every brick of the effects whose draw pass ran this tick (after the records, before the particles: FUN_00442930); returns the number of bricks */
export function drawBrickFx(r: Renderer, fx: BrickFxManager): number {
  const lib = fx.lib, s = stateOf(r);
  s.cur = 0; for (const c of s.cpu) c.reset();   // FUN_00886ae2: each frame starts with the first buffer, empty
  const prep = prepareLights(r.lights, IDENTITY, r.eye);
  let n = 0;
  for (const b of fx.drawList()) {
    const t = b.type;
    const m = t ? lib.meshOf(t, b.lod) : null;
    if (!t || !m || !m.vertexCount || !m.indices.length) continue;
    let c = s.cpu[s.cur];
    if (c.full(m.vertexCount, m.indices.length)) { flush(r, s, lib, true); c = s.cpu[s.cur]; }
    const uv1 = brickPaletteUv(lib.pe, b.colour);
    // a missing second colour (-1) reads the 8 bytes before the palette table (the string bytes "...c\\Li", ".cpp": u = 2.9758521e29, v = 0). Those coordinates are what the original's vertices carry;
    // the rasteriser then applies the texture's address mode (text.txl): WRAP keeps the fraction (a float above 2^24 has none: 0), CLAMP takes the edge (1). v = 0 is 0 in both.
    const uv2 = b.colour2 >= 0 ? brickPaletteUv(lib.pe, b.colour2) : missingColourUv(lib, r);
    c.add(m, b.world, lib.splitOf(t, b.lod), uv1, uv2, prep);
    n++;
  }
  flush(r, s, lib, false);   // FUN_00447de0 -> FUN_00886b34 at the end of the frame
  return n;
}
