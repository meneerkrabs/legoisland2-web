// Animation / camera formats of LEGO Island 2 (pure, no DOM):
//   .blk  skeleton + bone-rotation clips         (ABLK, or the tag-less "offset table" variant)
//   .man  per-object TRS tracks (MATA)           (camera moves, flying objects, ...)
//   .anm  10-bit packed Euler bone clip (one file only, RODD_Swish)
//   .cam  static camera                          (CAMA)
//   SVWL/AVW2 tail of .msh                       (skin weights, see parseSvwl)
// Layouts and conventions: docs/re/fragments/anim.md
import { Reader } from './reader.ts';

/** Frames per second of a clip played at rate 1: FUN_0043b76a adds `rate * DAT_008b1718` per drawn frame and DAT_008b1718 is the frame time in 1/30 s units (0.5 at 60 Hz), i.e. 30 clip frames per second whatever the frame rate. */
export const ANIM_FPS = 30;

// ---------------------------------------------------------------- .blk

export interface BlkClip {
  /** chunk index in the file; clip 0 is the skeleton chunk ("ASKL"), the game addresses clips by this number */
  index: number;
  kind: 'ASKL' | 'ANIM';
  /** flags word: always has bits 0|1 (3); 0x10 = loops (EXE, FUN_0043b76a: wrap at frameCount instead of stopping at frameCount-1); 0x08 set on walk/run-like clips (meaning unknown) */
  flags: number;
  boneCount: number;
  frameCount: number;
  /** frameCount x (3 + 4*boneCount) floats: root translation xyz, then per bone a quaternion x,y,z,w */
  data: Float32Array;
}

export interface BlkSkeleton {
  boneCount: number;
  /** boneCount x 3: translation of the bone in its parent's frame (x is mirrored when composing, see sampleBlk) */
  offsets: Float32Array;
  /** parent bone index per bone, -1 for the root (bone 0); parent < child always */
  parents: Int32Array;
}

export interface Blk {
  /** 'ABLK' = magic + chunk count + tagged chunks; 'OFFS' = u32 count + u32 chunk offsets + untagged chunks */
  variant: 'ABLK' | 'OFFS';
  /** chunk count from the header (an ABLK with count 1 and 0 bytes of chunks exists: OCTO/CATP/SCRP/SPID) */
  declaredCount: number;
  skeleton: BlkSkeleton | null;
  /** all chunks in file order; clips[0] is the skeleton chunk (a 1-frame rest/first pose) when present */
  clips: BlkClip[];
}

const BLK_HEAD = 12;

function parseBlkChunk(r: Reader, index: number, tag: 'ASKL' | 'ANIM' | null, end: number): { clip: BlkClip; skeleton: BlkSkeleton | null } {
  const start = r.pos;
  const flags = r.u32();
  const bones = r.u32();
  const frames = r.u32();
  if (bones === 0 || bones > 4096 || frames === 0 || frames > 100000) throw new Error(`BLK chunk ${index}: absurd bones ${bones} / frames ${frames}`);
  const stride = 3 + 4 * bones;
  const dataBytes = frames * stride * 4;
  const total = end - start;
  const skelBytes = bones * 16;
  let hasSkel: boolean;
  if (total === BLK_HEAD + dataBytes) hasSkel = false;
  else if (total === BLK_HEAD + dataBytes + skelBytes) hasSkel = true;
  else throw new Error(`BLK chunk ${index}: size ${total} fits neither ${BLK_HEAD + dataBytes} (clip) nor ${BLK_HEAD + dataBytes + skelBytes} (skeleton)`);
  if (tag === 'ASKL' && !hasSkel) throw new Error(`BLK chunk ${index}: ASKL without bone records`);
  if (tag === 'ANIM' && hasSkel) throw new Error(`BLK chunk ${index}: ANIM with bone records`);
  const data = r.f32s(frames * stride);
  let skeleton: BlkSkeleton | null = null;
  if (hasSkel) {
    const offsets = new Float32Array(bones * 3);
    const parents = new Int32Array(bones);
    for (let k = 0; k < bones; k++) {
      offsets[k * 3] = r.f32(); offsets[k * 3 + 1] = r.f32(); offsets[k * 3 + 2] = r.f32();
      parents[k] = r.i32();
    }
    if (parents[0] !== -1) throw new Error('BLK skeleton: bone 0 is not the root');
    for (let k = 1; k < bones; k++) if (parents[k] < 0 || parents[k] >= k) throw new Error(`BLK skeleton: bone ${k} parent ${parents[k]} out of order`);
    skeleton = { boneCount: bones, offsets, parents };
  }
  return { clip: { index, kind: hasSkel ? 'ASKL' : 'ANIM', flags, boneCount: bones, frameCount: frames, data }, skeleton };
}

/** Parse a .blk file. Throws on any structural inconsistency (all 136 shipped files parse strictly). */
export function parseBlk(data: Uint8Array): Blk {
  const r = new Reader(data);
  const clips: BlkClip[] = [];
  let skeleton: BlkSkeleton | null = null;
  let variant: Blk['variant'];
  let declaredCount: number;
  const take = (tag: 'ASKL' | 'ANIM' | null, end: number) => {
    const { clip, skeleton: sk } = parseBlkChunk(r, clips.length, tag, end);
    if (sk) {
      if (skeleton || clips.length !== 0) throw new Error('BLK: skeleton chunk must be unique and first');
      skeleton = sk;
    }
    if (r.pos !== end) throw new Error(`BLK chunk ${clips.length}: consumed ${r.pos}, expected end ${end}`);
    clips.push(clip);
  };
  if (data.length >= 4 && r.peekTag() === 'ABLK') {
    variant = 'ABLK';
    r.skip(4);
    declaredCount = r.u32();
    for (let i = 0; i < declaredCount && !r.eof(); i++) {
      const t = r.tag();
      if (t !== 'ASKL' && t !== 'ANIM') throw new Error(`BLK: unknown chunk tag "${t}" at ${r.pos - 4}`);
      const size = r.u32();
      take(t, r.pos + size);
    }
    if (!r.eof()) throw new Error(`BLK: ${r.remaining} trailing bytes`);
    if (clips.length !== declaredCount && !(declaredCount === 1 && clips.length === 0)) throw new Error(`BLK: ${clips.length} chunks, header says ${declaredCount}`);
  } else {
    variant = 'OFFS';
    declaredCount = r.u32();
    if (declaredCount === 0 || declaredCount > 100000) throw new Error('BLK: neither ABLK nor offset-table variant');
    const offs: number[] = [];
    for (let i = 0; i < declaredCount; i++) offs.push(r.u32());
    if (offs[0] !== 4 + 4 * declaredCount) throw new Error('BLK(OFFS): first chunk does not follow the table');
    offs.push(data.length);
    for (let i = 0; i < declaredCount; i++) {
      if (r.pos !== offs[i]) throw new Error(`BLK(OFFS): chunk ${i} offset ${offs[i]} != position ${r.pos}`);
      take(null, offs[i + 1]);
    }
    if (!r.eof()) throw new Error('BLK(OFFS): trailing bytes');
  }
  return { variant, declaredCount, skeleton, clips };
}

/** Length of a clip in seconds at ANIM_FPS (frames-1 intervals; a 1-frame clip is a static pose). */
export function blkClipSeconds(clip: BlkClip): number {
  return clip.frameCount > 1 ? (clip.frameCount - 1) / ANIM_FPS : 0;
}

const fr = Math.fround;
/** _DAT_00892230 = 1e-5 (double): quaternions with 1 - dot <= 1e-5 count as parallel (_DAT_008920cc = 0.1f is the snap of `pose`, game/anim.ts POSE_SNAP) */
const SLERP_EPS = 0.00001;

/**
 * FUN_0085e354 (CRT acos): `fpatan(fsqrt((1 + x) * (1 - x)), x)`. The CRT's switch (FUN_00868455: `(cw & 0x300) | 0x7f`) keeps the caller's precision control, so in the game's 24 bit mode the sum, the difference, the product
 * and the square root round to float32 (fpatan / fsin results are not rounded by the precision control: doubles).
 */
function crtAcos(x: number): number { return Math.atan2(fr(Math.sqrt(fr(fr(1 + x) * fr(1 - x)))), x); }

/**
 * FUN_0043e59e(out, a, b, t): the slerp of one bone's quaternions (x, y, z, w) at the x87's 24 bit precision, in the order of the machine code. The dot product is formed from four rounded
 * products added x, y, z, w; a negative one flips `b` (the shortest path); parallel quaternions (1 - dot <= 1e-5) blend linearly with (1 - t, t); otherwise the weights are
 * sin((1 - t) w) / sin w and sin(t w) / sin w with w = acos(dot) (CRT acos / sin results are doubles; the products, the quotients and the final sums round to 24 bits). The
 * branch for 1 + dot <= 1e-5 (a flipped dot is never below 0) is the original's too.
 */
function slerp(out: Float32Array, oo: number, d: Float32Array, a: number, b: number, t: number) {
  let dot = fr(fr(fr(fr(d[a] * d[b]) + fr(d[a + 1] * d[b + 1])) + fr(d[a + 2] * d[b + 2])) + fr(d[a + 3] * d[b + 3]));
  let q0 = d[b], q1 = d[b + 1], q2 = d[b + 2], q3 = d[b + 3];
  if (!(dot >= 0)) { dot = -dot; q0 = -q0; q1 = -q1; q2 = -q2; q3 = -q3; }
  if (fr(1 + dot) <= SLERP_EPS) {
    // (never reached: dot >= 0 here) the original's perpendicular branch
    const p0 = -q1, p1 = q0, p2 = -q3, p3 = q2;
    const s0 = Math.sin(fr(fr(1 - t) * 1.5707963705062866)), s1 = Math.sin(fr(t * 1.5707963705062866));
    out[oo] = fr(fr(d[a] * s0) + fr(p0 * s1)); out[oo + 1] = fr(fr(d[a + 1] * s0) + fr(p1 * s1));
    out[oo + 2] = fr(fr(d[a + 2] * s0) + fr(p2 * s1)); out[oo + 3] = fr(fr(d[a + 3] * s0) + fr(p3 * s1));
    return;
  }
  let s0: number, s1: number;
  if (fr(1 - dot) <= SLERP_EPS) { s0 = fr(1 - t); s1 = t; }
  else {
    const om = crtAcos(dot), so = Math.sin(om);
    s0 = fr(Math.sin(fr(fr(1 - t) * om)) / so);
    s1 = fr(Math.sin(fr(t * om)) / so);
  }
  out[oo] = fr(fr(d[a] * s0) + fr(q0 * s1)); out[oo + 1] = fr(fr(d[a + 1] * s0) + fr(q1 * s1));
  out[oo + 2] = fr(fr(d[a + 2] * s0) + fr(q2 * s1)); out[oo + 3] = fr(fr(d[a + 3] * s0) + fr(q3 * s1));
}

/**
 * Per-bone matrices of `clip` at fractional frame `frame`, written into `out` (allocated if omitted), as the original's FUN_0043ba7a / FUN_0043b987 leave them in the animation's buffer: 16 floats per
 * bone, the game's row-major row-vector 4x4 (the rotation in rows 0..2, the translation in row 3), which read as a column-major WebGL matrix is the transpose, i.e. the same bytes. Every x87 step rounds
 * to a float32 (bit-exact against the emulated original: tools/tests/m7-pose-emu.mjs). The root bone has no parent (the identity: `FUN_0043ba7a(anim, parent)` is passed one by the draw).
 *
 * Frame selection (FUN_0043ba7a): i = floor(frame), f = frame - i (a float32); the translation is lerped (`(next - cur) * f + cur`) and the quaternions slerped with the next frame, the frame after the last
 * one being frame 0 (whatever the clip's loop flag says); a fractional part below 0.1f (`snap`, 0.1f in the game) or the instance flag 2 (`snap` = Infinity) shows the exact frame i. The original does not
 * wrap or clamp the frame: a frame at or beyond the frame count (`FUN_0043b874` stops AT the count) reads past the clip's data; the port clamps to the last frame there. `loop` is not used any more.
 *
 * Bone k > 0: local = [R(q_k) | (-offset.x, offset.y, offset.z)] and world = local * parent (FUN_0043a9e5), the root's translation is (-x, y, z) of the frame's first three floats.
 */
export function sampleBlk(skeleton: BlkSkeleton, clip: BlkClip, frame: number, _loop = true, out?: Float32Array, snap = 0): Float32Array {
  const bones = skeleton.boneCount;
  if (clip.boneCount !== bones) throw new Error('sampleBlk: clip/skeleton bone count mismatch');
  const res = out ?? new Float32Array(bones * 16);
  const n = clip.frameCount;
  const fl = fr(frame);
  let i = Math.floor(fl), f = fr(fl - fr(i));
  if (i >= n) { i = n - 1; f = 0; }
  else if (i < 0) { i = 0; f = 0; }
  const stride = 3 + 4 * bones;
  const d = clip.data;
  let a = i * stride;
  let cur: Float32Array = d;
  if (f > 0 && f >= snap) {
    const b = (i + 1 < n ? i + 1 : 0) * stride;
    const mixed = mixedFor(stride);
    mixed[0] = fr(fr(fr(d[b] - d[a]) * f) + d[a]); mixed[1] = fr(fr(fr(d[b + 1] - d[a + 1]) * f) + d[a + 1]); mixed[2] = fr(fr(fr(d[b + 2] - d[a + 2]) * f) + d[a + 2]);
    for (let k = 0; k < bones; k++) slerp(mixed, 3 + 4 * k, d, a + 3 + 4 * k, b + 3 + 4 * k, f);
    cur = mixed; a = 0;
  }
  const q = LOCAL;
  for (let k = 0; k < bones; k++) {
    const qa = a + 3 + 4 * k;
    const x = cur[qa], y = cur[qa + 1], z = cur[qa + 2], w = cur[qa + 3];
    // FUN_0043e43d: the quaternion as a row-vector matrix (2x, 2y, 2z, then the products, each stored as a float32)
    const x2 = fr(x + x), y2 = fr(y + y), z2 = fr(z + z);
    const xx = fr(x2 * x), yy = fr(y2 * y), zz = fr(z2 * z), yx = fr(y2 * x), zx = fr(z2 * x), zy = fr(z2 * y), xw = fr(x2 * w), yw = fr(y2 * w), zw = fr(z2 * w);
    q[0] = fr(1 - fr(yy + zz)); q[4] = fr(yx + zw); q[8] = fr(zx - yw); q[12] = 0;
    q[1] = fr(yx - zw); q[5] = fr(1 - fr(xx + zz)); q[9] = fr(zy + xw); q[13] = 0;
    q[2] = fr(zx + yw); q[6] = fr(zy - xw); q[10] = fr(1 - fr(xx + yy)); q[14] = 0;
    q[3] = 0; q[7] = 0; q[11] = 0; q[15] = 1;
    if (k === 0) { q[12] = -cur[a]; q[13] = cur[a + 1]; q[14] = cur[a + 2]; }
    else { q[12] = -skeleton.offsets[k * 3]; q[13] = skeleton.offsets[k * 3 + 1]; q[14] = skeleton.offsets[k * 3 + 2]; }
    // FUN_0043a9e5(bone, parent, local): local * parent, every product and sum a float32 (the translation row adds the parent's)
    const o = k * 16, pm: ArrayLike<number> = k === 0 ? IDENT : res, p = k === 0 ? 0 : skeleton.parents[k] * 16;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        let v = fr(fr(fr(q[r * 4] * pm[p + c]) + fr(q[r * 4 + 1] * pm[p + 4 + c])) + fr(q[r * 4 + 2] * pm[p + 8 + c]));
        if (r === 3) v = fr(v + pm[p + 12 + c]);
        res[o + r * 4 + c] = v;
      }
      res[o + r * 4 + 3] = r === 3 ? 1 : 0;
    }
  }
  return res;
}
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** scratch of `sampleBlk` (synchronous, not re-entrant): the interpolated frame and the bone's local matrix */
let mixedBuf = new Float32Array(3 + 4 * 64);
const LOCAL = new Float32Array(16);
function mixedFor(stride: number): Float32Array { if (mixedBuf.length < stride) mixedBuf = new Float32Array(stride); return mixedBuf; }

// ---------------------------------------------------------------- SVWL / AVW2 (tail of skinned .msh)

export interface Svwl {
  vertexCount: number;
  /** primary influence per vertex: bone index (-1 = not skinned, stays in place) */
  bone: Int32Array;
  /** primary weight per vertex (the weights of all influences of a vertex sum to 1) */
  weight: Float32Array;
  /** additional influences (chunk "AVW2"), sorted by vertex */
  extra: {
    count: number;
    /** 3 floats: the vertex position in the local space of `bone` (primary influences use the .msh position itself) */
    local: Float32Array;
    vertex: Uint32Array;
    bone: Uint32Array;
    weight: Float32Array;
  };
}

/**
 * Decode the raw bytes msh.ts keeps in `Msh.svwl` (everything after the SVWL vertex count):
 *   vertexCount x { i32 bone, f32 weight }, "AVW2", u32 n, n x { f32 x,y,z, u32 vertex, u32 bone, f32 weight }.
 */
export function parseSvwl(data: Uint8Array, vertexCount: number): Svwl {
  const r = new Reader(data);
  const bone = new Int32Array(vertexCount);
  const weight = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) { bone[i] = r.i32(); weight[i] = r.f32(); }
  r.expectTag('AVW2');
  const n = r.u32();
  const local = new Float32Array(n * 3);
  const vertex = new Uint32Array(n);
  const eb = new Uint32Array(n);
  const ew = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    local[i * 3] = r.f32(); local[i * 3 + 1] = r.f32(); local[i * 3 + 2] = r.f32();
    vertex[i] = r.u32(); eb[i] = r.u32(); ew[i] = r.f32();
    if (vertex[i] >= vertexCount) throw new Error(`AVW2 record ${i}: vertex ${vertex[i]} >= ${vertexCount}`);
  }
  if (!r.eof()) throw new Error(`SVWL: ${r.remaining} trailing bytes`);
  return { vertexCount, bone, weight, extra: { count: n, local, vertex, bone: eb, weight: ew } };
}

/**
 * Skin a mesh like the game's skinning loop (FUN_0088b87b): out[v] = sum_i w_i * (M_bone_i * local_i), where the primary influence's local position is the vertex position stored in the .msh and
 * further influences use AVW2's local positions. `matrices` comes from sampleBlk. Every step rounds to a float32 like the original's x87 (24 bit): the point is transformed (FUN_0043ab72: the products
 * added x, y, z, then the translation), scaled by its weight when that is not 1, and the further influences are ADDED to the vertex (translation first: `new + old`).
 */
export function skinPositions(positions: Float32Array, svwl: Svwl, matrices: Float32Array, out?: Float32Array): Float32Array {
  const V = svwl.vertexCount;
  const res = out ?? new Float32Array(V * 3);
  const bones = matrices.length / 16;
  const M = matrices;
  const point = (m: number, x: number, y: number, z: number, j: number) => fr(fr(fr(fr(x * M[m + j]) + fr(y * M[m + 4 + j])) + fr(z * M[m + 8 + j])) + M[m + 12 + j]);
  for (let v = 0; v < V; v++) {
    const b = svwl.bone[v];
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (b < 0 || b >= bones) { res[v * 3] = x; res[v * 3 + 1] = y; res[v * 3 + 2] = z; continue; }
    const w = svwl.weight[v], m = b * 16;
    res[v * 3] = point(m, x, y, z, 0); res[v * 3 + 1] = point(m, x, y, z, 1); res[v * 3 + 2] = point(m, x, y, z, 2);
    if (w !== 1) { res[v * 3] = fr(res[v * 3] * w); res[v * 3 + 1] = fr(res[v * 3 + 1] * w); res[v * 3 + 2] = fr(res[v * 3 + 2] * w); }
  }
  const e = svwl.extra;
  for (let i = 0; i < e.count; i++) {
    const v = e.vertex[i], b = e.bone[i];
    if (b >= bones) continue;
    const x = e.local[i * 3], y = e.local[i * 3 + 1], z = e.local[i * 3 + 2], w = e.weight[i], m = b * 16;
    let px = point(m, x, y, z, 0), py = point(m, x, y, z, 1), pz = point(m, x, y, z, 2);
    if (w !== 1) { px = fr(px * w); py = fr(py * w); pz = fr(pz * w); }
    res[v * 3] = fr(px + res[v * 3]); res[v * 3 + 1] = fr(py + res[v * 3 + 1]); res[v * 3 + 2] = fr(pz + res[v * 3 + 2]);
  }
  return res;
}

/**
 * Skin the vertex normals like the game does (FUN_0088b87b): every influence rotates the vertex's own normal with its bone matrix (FUN_0043abe6; no per-influence normal exists), scales it by the
 * weight when that is not 1 and the results are summed (float32 steps). The sum is NOT renormalised by the game (the weights sum to 1, so it is only shorter than 1 when the bone rotations
 * differ); pass `normalize = true` to renormalise (a port extension of the renderer, the fixed-function pipeline normalised the normals).
 */
export function skinNormals(normals: Float32Array, svwl: Svwl, matrices: Float32Array, out?: Float32Array, normalize = false): Float32Array {
  const V = svwl.vertexCount;
  const res = out ?? new Float32Array(V * 3);
  const bones = matrices.length / 16;
  res.fill(0);
  const add = (v: number, b: number, w: number, first: boolean) => {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2], m = b * 16;
    let nx = fr(fr(fr(x * matrices[m]) + fr(y * matrices[m + 4])) + fr(z * matrices[m + 8]));
    let ny = fr(fr(fr(x * matrices[m + 1]) + fr(y * matrices[m + 5])) + fr(z * matrices[m + 9]));
    let nz = fr(fr(fr(x * matrices[m + 2]) + fr(y * matrices[m + 6])) + fr(z * matrices[m + 10]));
    if (w !== 1) { nx = fr(nx * w); ny = fr(ny * w); nz = fr(nz * w); }
    if (first) { res[v * 3] = nx; res[v * 3 + 1] = ny; res[v * 3 + 2] = nz; }
    else { res[v * 3] = fr(nx + res[v * 3]); res[v * 3 + 1] = fr(ny + res[v * 3 + 1]); res[v * 3 + 2] = fr(nz + res[v * 3 + 2]); }
  };
  for (let v = 0; v < V; v++) {
    const b = svwl.bone[v];
    if (b < 0 || b >= bones) { res[v * 3] = normals[v * 3]; res[v * 3 + 1] = normals[v * 3 + 1]; res[v * 3 + 2] = normals[v * 3 + 2]; }
    else add(v, b, svwl.weight[v], true);
  }
  const e = svwl.extra;
  for (let i = 0; i < e.count; i++) if (e.bone[i] < bones) add(e.vertex[i], e.bone[i], e.weight[i], false);
  if (normalize) for (let v = 0; v < V; v++) {
    const l = Math.hypot(res[v * 3], res[v * 3 + 1], res[v * 3 + 2]) || 1;
    res[v * 3] /= l; res[v * 3 + 1] /= l; res[v * 3 + 2] /= l;
  }
  return res;
}

// ---------------------------------------------------------------- .man

export interface Man {
  /** header word 1: number of interleaved tracks (objects animated together): 1 in 162 files, 2 in PLAN_Planet, 4 in hanger_building_LOD1 */
  trackCount: number;
  /** header word 2: nominal frame count; the file holds either this many or one fewer frames per track */
  declaredFrames: number;
  /** frames actually stored per track */
  frameCount: number;
  /** per track: frameCount x 9 floats: rotation xyz (Euler, radians), translation xyz, scale xyz */
  tracks: Float32Array[];
}

export function parseMan(data: Uint8Array): Man {
  const r = new Reader(data);
  r.expectTag('MATA');
  const trackCount = r.u32();
  const declaredFrames = r.u32();
  if (trackCount < 1 || trackCount > 64) throw new Error(`MAN: absurd track count ${trackCount}`);
  const body = r.remaining;
  const recBytes = 36 * trackCount;
  if (body % recBytes) throw new Error(`MAN: ${body} bytes is not a multiple of ${recBytes}`);
  const frameCount = body / recBytes;
  if (frameCount !== declaredFrames && frameCount !== declaredFrames - 1) throw new Error(`MAN: ${frameCount} frames stored, header says ${declaredFrames}`);
  const tracks: Float32Array[] = [];
  for (let t = 0; t < trackCount; t++) tracks.push(new Float32Array(frameCount * 9));
  for (let f = 0; f < frameCount; f++) {
    for (let t = 0; t < trackCount; t++) for (let i = 0; i < 9; i++) tracks[t][f * 9 + i] = r.f32();
  }
  return { trackCount, declaredFrames, frameCount, tracks };
}

/** Linear sample of one track at a fractional frame (clamped): 9 floats rotation(3) translation(3) scale(3). */
export function sampleMan(man: Man, track: number, frame: number, out: Float32Array = new Float32Array(9)): Float32Array {
  const d = man.tracks[track];
  const n = man.frameCount;
  const f = Math.min(Math.max(frame, 0), n - 1);
  const f0 = Math.floor(f), f1 = Math.min(f0 + 1, n - 1), t = f - f0;
  for (let i = 0; i < 9; i++) out[i] = d[f0 * 9 + i] + (d[f1 * 9 + i] - d[f0 * 9 + i]) * t;
  return out;
}

/**
 * Rotation matrix (3x3 row-major, 9 floats) of a .man Euler triple: M = (Rz(rz) * Ry(ry) * Rx(rx))^T. This is exactly the upper 3x3 of the
 * row-vector D3D matrix the game builds (FUN_0043a742, scale omitted). For column vectors a camera track looks along M * (0,0,-1)
 * (empirical: camera tracks aim at their target tracks, medium confidence).
 */
export function manRotationMatrix(rx: number, ry: number, rz: number, out: Float32Array = new Float32Array(9)): Float32Array {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Rz*Ry*Rx
  const a00 = cz * cy, a01 = cz * sy * sx - sz * cx, a02 = cz * sy * cx + sz * sx;
  const a10 = sz * cy, a11 = sz * sy * sx + cz * cx, a12 = sz * sy * cx - cz * sx;
  const a20 = -sy, a21 = cy * sx, a22 = cy * cx;
  out[0] = a00; out[1] = a10; out[2] = a20;
  out[3] = a01; out[4] = a11; out[5] = a21;
  out[6] = a02; out[7] = a12; out[8] = a22;
  return out;
}

// ---------------------------------------------------------------- .anm (10-bit packed Euler clip)

export interface Anm {
  version: number;
  boneCount: number;
  frameCount: number;
  /** frameCount x (3 + boneCount) u32: 3 root words (all 0 in the shipped file), then one packed rotation per bone */
  words: Uint32Array;
}

export function parseAnm(data: Uint8Array): Anm {
  const r = new Reader(data);
  const version = r.u32();
  const boneCount = r.u32();
  const frameCount = r.u32();
  if (version !== 1) throw new Error(`ANM: version ${version}`);
  const n = frameCount * (3 + boneCount);
  if (r.remaining !== n * 4) throw new Error(`ANM: ${r.remaining} bytes, expected ${n * 4}`);
  return { version, boneCount, frameCount, words: r.u32s(n) };
}

function s10(v: number): number { v &= 0x3ff; return v >= 512 ? v - 1024 : v; }

/** Unpack a bone word into three signed 10-bit angles in 1/1024 turn: [0] about Z, [1] about Y (assumed), [2] about X; bits 30-31 spare. */
export function anmUnpack(word: number): [number, number, number] {
  return [s10(word), s10(word >>> 10), s10(word >>> 20)];
}

/** Quaternion (x,y,z,w) equivalent to the packed word, in the same convention as the .blk quaternions: q = Qx(f2) * Qy(f1) * Qz(f0). */
export function anmToQuaternion(word: number, out: Float32Array = new Float32Array(4)): Float32Array {
  const [fz, fy, fx] = anmUnpack(word);
  const k = Math.PI / 1024; // half of 2*pi/1024
  const ax = fx * k, ay = fy * k, az = fz * k;
  const qx = [Math.sin(ax), 0, 0, Math.cos(ax)], qy = [0, Math.sin(ay), 0, Math.cos(ay)], qz = [0, 0, Math.sin(az), Math.cos(az)];
  const mul = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const q = mul(mul(qx, qy), qz);
  out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; out[3] = q[3];
  return out;
}

// ---------------------------------------------------------------- .cam

export interface Cam {
  version: number;
  /** eye position */
  eye: [number, number, number];
  /** eye + 1 unit of view direction (distance to eye is always 1.0 +- 4e-4) */
  look: [number, number, number];
}

export function parseCam(data: Uint8Array): Cam {
  const r = new Reader(data);
  r.expectTag('CAMA');
  const version = r.u32();
  const eye: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const look: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  if (!r.eof()) throw new Error('CAM: trailing bytes');
  return { version, eye, look };
}
