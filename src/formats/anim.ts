// Animation / camera formats of LEGO Island 2 (pure, no DOM):
//   .blk  skeleton + bone-rotation clips         (ABLK, or the tag-less "offset table" variant)
//   .man  per-object TRS tracks (MATA)           (camera moves, flying objects, ...)
//   .anm  10-bit packed Euler bone clip (one file only, RODD_Swish)
//   .cam  static camera                          (CAMA)
//   SVWL/AVW2 tail of .msh                       (skin weights, see parseSvwl)
// Layouts and conventions: docs/re/fragments/anim.md
import { Reader } from './reader.ts';

/** Frames per second: the game advances a clip by 1 frame per game tick (30 Hz per Moreno's analysis; not verified in the EXE). */
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

/**
 * Per-bone object-space matrices of `clip` at fractional frame `frame` (column-major 4x4, 16 floats per bone, WebGL ready),
 * written into `out` (allocated if omitted).
 *
 * Frame interpolation mirrors the game (SDAnim.c, FUN_0043ba7a): the root translation is lerped, the bone quaternions are slerped
 * (shortest path) towards the next frame, and the frame after the last one is frame 0 (that is how looping clips close). With
 * `loop = false` the frame is clamped to [0, frameCount-1] instead (a once-only clip stops on its last frame). The game only
 * interpolates when the fractional part is >= 0.1 and otherwise shows the exact frame: pass `snap = 0.1` to reproduce that.
 *
 * Conventions (exact, see the doc): the game builds row-vector D3D matrices local = [R(q) | (-offset.x, offset.y, offset.z)] with
 * R(q) the usual quaternion matrix, and world = local * parentWorld. As a column-vector matrix that is
 * local = [R(q)^T | t], world = parentWorld * local; the root translation is the frame's first 3 floats with x negated.
 * The resulting space is the space of the .msh vertex data of the skinned meshes (see skinPositions).
 */
export function sampleBlk(skeleton: BlkSkeleton, clip: BlkClip, frame: number, loop = true, out?: Float32Array, snap = 0): Float32Array {
  const bones = skeleton.boneCount;
  if (clip.boneCount !== bones) throw new Error('sampleBlk: clip/skeleton bone count mismatch');
  const res = out ?? new Float32Array(bones * 16);
  const n = clip.frameCount;
  let f = frame;
  if (n <= 1) f = 0;
  else if (loop) { f = f % n; if (f < 0) f += n; }
  else f = Math.min(Math.max(f, 0), n - 1);
  let f0 = Math.floor(f);
  let t = f - f0;
  if (f0 >= n) f0 = n - 1;
  let f1 = f0 + 1;
  if (f1 >= n) f1 = loop ? 0 : n - 1;
  if (f0 === f1 || t < snap) t = 0;
  const stride = 3 + 4 * bones;
  const d = clip.data;
  const a = f0 * stride, b = f1 * stride;
  const tx = d[a] + (d[b] - d[a]) * t, ty = d[a + 1] + (d[b + 1] - d[a + 1]) * t, tz = d[a + 2] + (d[b + 2] - d[a + 2]) * t;
  for (let k = 0; k < bones; k++) {
    const qa = a + 3 + 4 * k, qb = b + 3 + 4 * k;
    let x = d[qa], y = d[qa + 1], z = d[qa + 2], w = d[qa + 3];
    if (t > 0) {
      let x1 = d[qb], y1 = d[qb + 1], z1 = d[qb + 2], w1 = d[qb + 3];
      let dot = x * x1 + y * y1 + z * z1 + w * w1;
      if (dot < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; dot = -dot; }
      let s0 = 1 - t, s1 = t;
      if (1 - dot > 1e-6) {
        const om = Math.acos(Math.min(1, dot)), so = Math.sin(om);
        s0 = Math.sin((1 - t) * om) / so; s1 = Math.sin(t * om) / so;
      }
      x = x * s0 + x1 * s1; y = y * s0 + y1 * s1; z = z * s0 + z1 * s1; w = w * s0 + w1 * s1;
    }
    // standard quaternion -> matrix, then transposed (see doc comment)
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    // local rotation L = R^T (rows of L = columns of R)
    const l00 = r00, l01 = r10, l02 = r20, l10 = r01, l11 = r11, l12 = r21, l20 = r02, l21 = r12, l22 = r22;
    const o = k * 16;
    if (k === 0) {
      // column-major
      res[o] = l00; res[o + 1] = l10; res[o + 2] = l20; res[o + 3] = 0;
      res[o + 4] = l01; res[o + 5] = l11; res[o + 6] = l21; res[o + 7] = 0;
      res[o + 8] = l02; res[o + 9] = l12; res[o + 10] = l22; res[o + 11] = 0;
      res[o + 12] = -tx; res[o + 13] = ty; res[o + 14] = tz; res[o + 15] = 1;
    } else {
      const p = skeleton.parents[k] * 16;
      const ox = -skeleton.offsets[k * 3], oy = skeleton.offsets[k * 3 + 1], oz = skeleton.offsets[k * 3 + 2];
      const p00 = res[p], p10 = res[p + 1], p20 = res[p + 2];
      const p01 = res[p + 4], p11 = res[p + 5], p21 = res[p + 6];
      const p02 = res[p + 8], p12 = res[p + 9], p22 = res[p + 10];
      res[o] = p00 * l00 + p01 * l10 + p02 * l20; res[o + 1] = p10 * l00 + p11 * l10 + p12 * l20; res[o + 2] = p20 * l00 + p21 * l10 + p22 * l20; res[o + 3] = 0;
      res[o + 4] = p00 * l01 + p01 * l11 + p02 * l21; res[o + 5] = p10 * l01 + p11 * l11 + p12 * l21; res[o + 6] = p20 * l01 + p21 * l11 + p22 * l21; res[o + 7] = 0;
      res[o + 8] = p00 * l02 + p01 * l12 + p02 * l22; res[o + 9] = p10 * l02 + p11 * l12 + p12 * l22; res[o + 10] = p20 * l02 + p21 * l12 + p22 * l22; res[o + 11] = 0;
      res[o + 12] = p00 * ox + p01 * oy + p02 * oz + res[p + 12];
      res[o + 13] = p10 * ox + p11 * oy + p12 * oz + res[p + 13];
      res[o + 14] = p20 * ox + p21 * oy + p22 * oz + res[p + 14];
      res[o + 15] = 1;
    }
  }
  return res;
}

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
 * Skin a mesh: out[v] = sum_i w_i * (M_bone_i * local_i), where the primary influence's local position is the vertex position
 * stored in the .msh and further influences use AVW2's local positions. `matrices` comes from sampleBlk.
 * Same as the game's skinning loop (FUN_0088b87b). Normals: see skinNormals.
 */
export function skinPositions(positions: Float32Array, svwl: Svwl, matrices: Float32Array, out?: Float32Array): Float32Array {
  const V = svwl.vertexCount;
  const res = out ?? new Float32Array(V * 3);
  const bones = matrices.length / 16;
  for (let v = 0; v < V; v++) {
    const b = svwl.bone[v];
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (b < 0 || b >= bones) { res[v * 3] = x; res[v * 3 + 1] = y; res[v * 3 + 2] = z; continue; }
    const w = svwl.weight[v], m = b * 16;
    res[v * 3] = w * (matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z + matrices[m + 12]);
    res[v * 3 + 1] = w * (matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13]);
    res[v * 3 + 2] = w * (matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z + matrices[m + 14]);
  }
  const e = svwl.extra;
  for (let i = 0; i < e.count; i++) {
    const v = e.vertex[i], b = e.bone[i];
    if (b >= bones) continue;
    const x = e.local[i * 3], y = e.local[i * 3 + 1], z = e.local[i * 3 + 2], w = e.weight[i], m = b * 16;
    res[v * 3] += w * (matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z + matrices[m + 12]);
    res[v * 3 + 1] += w * (matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z + matrices[m + 13]);
    res[v * 3 + 2] += w * (matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z + matrices[m + 14]);
  }
  return res;
}

/**
 * Skin the vertex normals like the game does (FUN_0088b87b): every influence rotates the vertex's own normal with its bone matrix
 * (no per-influence normal exists) and the results are summed with the influence weights. The sum is NOT renormalised by the game
 * (the weights sum to 1, so it is only shorter than 1 when the bone rotations differ); pass `normalize = true` to renormalise.
 */
export function skinNormals(normals: Float32Array, svwl: Svwl, matrices: Float32Array, out?: Float32Array, normalize = false): Float32Array {
  const V = svwl.vertexCount;
  const res = out ?? new Float32Array(V * 3);
  const bones = matrices.length / 16;
  res.fill(0);
  const add = (v: number, b: number, w: number) => {
    const x = normals[v * 3], y = normals[v * 3 + 1], z = normals[v * 3 + 2], m = b * 16;
    res[v * 3] += w * (matrices[m] * x + matrices[m + 4] * y + matrices[m + 8] * z);
    res[v * 3 + 1] += w * (matrices[m + 1] * x + matrices[m + 5] * y + matrices[m + 9] * z);
    res[v * 3 + 2] += w * (matrices[m + 2] * x + matrices[m + 6] * y + matrices[m + 10] * z);
  };
  for (let v = 0; v < V; v++) {
    const b = svwl.bone[v];
    if (b < 0 || b >= bones) { res[v * 3] = normals[v * 3]; res[v * 3 + 1] = normals[v * 3 + 1]; res[v * 3 + 2] = normals[v * 3 + 2]; }
    else add(v, b, svwl.weight[v]);
  }
  const e = svwl.extra;
  for (let i = 0; i < e.count; i++) if (e.bone[i] < bones) add(e.vertex[i], e.bone[i], e.weight[i]);
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
