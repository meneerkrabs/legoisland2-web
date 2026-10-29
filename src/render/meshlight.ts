// The game's CPU vertex lighting (Lights.cpp), ported function by function so that the renderer can write the same vertex colours the original writes into its vertex
// buffers (docs/re/rendering.md section 5). Pure (no DOM, no GL).
//
//   FUN_00885664  prepareLights      per draw: the light vectors of the runtime light array in the object's space (from the D3D world matrix at that time)
//   FUN_00885a9a  lightStatic        diffuse of static meshes (vertex format 0x242): directional + point + ambient lights
//   FUN_0088589e  lightSkinned       diffuse of skinned meshes: directional + ambient only
//   FUN_0088612c  lightShiny         diffuse + specular of meshes switched to vertex format 0x2c2 (FUN_004446c0(record, 1)): pow(H.N, 16), threshold 0.9, factor 128/255;
//                                    also the brick batches (Effects.c FUN_00886be0, world space, identity matrix)
//   FUN_00885e33  lightSkinnedShiny  the skinned 0x2c2 variant: pow(H.N, 8), threshold 0.92, factor 220/255
//
// All of them work with the vertex NORMAL of the mesh's separate normal array (object space, not renormalised) and the light vectors in object space; the result is written
// as 8-bit colours (`ROUND(x * 255)`: fistp, round half to even; the alpha byte is left alone by the 0x242 variants and set to 0xff by the 0x2c2 variants).
//
// Float handling: the original keeps its locals in 32-bit floats (the x87 runs with D3D's single precision control word); `Math.fround` is applied where the original stores.
import type { LightSet, RuntimeLight } from './lighting.ts';
import { runtimeLights } from './lighting.ts';

const fr = Math.fround;

export interface PreparedLight {
  kind: 0 | 1 | 2;
  /** kind 1: unit vector towards the light in object space ( normalise(rows . dir) ), FUN_00885664 +0x1c (negated twice) */
  dirObj: [number, number, number];
  /** kind 1: the half vector (V + L, normalised, in world space) taken into object space (FUN_0043b0c5, not normalised again); zero without an eye */
  halfObj: [number, number, number];
  /** kind 2: the light position in object space (FUN_0043b022) */
  posObj: [number, number, number];
  color: [number, number, number];
  range: number;
}
export interface PreparedLights { lights: PreparedLight[] }

/** FUN_0043cec0: normalise in place, a zero vector is left alone; `1 / sqrt` as a float product like the original */
function normalise(v: [number, number, number]): void {
  const l2 = fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]));
  if (l2 !== 0) {
    const k = fr(1 / fr(Math.sqrt(l2)));
    v[0] = fr(k * v[0]); v[1] = fr(k * v[1]); v[2] = fr(k * v[2]);
  }
}

/** FUN_0043b0c5: v . rows of the matrix's 3x3 (the inverse rotation for an orthonormal matrix; the matrix is row-major, row vectors) */
function rows(m: ArrayLike<number>, v: ArrayLike<number>): [number, number, number] {
  return [
    fr(fr(fr(v[0] * m[0]) + fr(v[1] * m[1])) + fr(v[2] * m[2])),
    fr(fr(fr(v[0] * m[4]) + fr(v[1] * m[5])) + fr(v[2] * m[6])),
    fr(fr(fr(v[0] * m[8]) + fr(v[1] * m[9])) + fr(v[2] * m[10])),
  ];
}

/**
 * FUN_00885664(lightSet, world): the light vectors of every runtime light for an object drawn with the world matrix `world` (row-major 4x4, translation in 12..14).
 * `eye` = the camera position (DAT_00986e18..20); null = unknown (no specular).
 */
export function prepareLights(set: LightSet, world: ArrayLike<number>, eye: ArrayLike<number> | null): PreparedLights {
  const out: PreparedLight[] = [];
  for (const l0 of runtimeLights(set)) {
    // the light records hold 32-bit floats
    const l = { kind: l0.kind, dir: l0.dir.map(fr) as [number, number, number], pos: l0.pos.map(fr) as [number, number, number], color: l0.color.map(fr) as [number, number, number], range: fr(l0.range) };
    const p: PreparedLight = { kind: l.kind, dirObj: [0, 0, 0], halfObj: [0, 0, 0], posObj: [0, 0, 0], color: l.color, range: l.range };
    if (l.kind === 1) {
      const d = rows(world, l.dir);
      // the original negates the vector and the diffuse test negates the dot product again
      p.dirObj = d; normalise(p.dirObj);
      if (eye) {
        const v: [number, number, number] = [fr(fr(eye[0]) - fr(world[12])), fr(fr(eye[1]) - fr(world[13])), fr(fr(eye[2]) - fr(world[14]))];
        normalise(v);
        const h: [number, number, number] = [fr(v[0] + l.dir[0]), fr(v[1] + l.dir[1]), fr(v[2] + l.dir[2])];
        normalise(h);
        p.halfObj = rows(world, h);
      }
    } else if (l.kind === 2) {
      const dx = fr(l.pos[0] - world[12]), dy = fr(l.pos[1] - world[13]), dz = fr(l.pos[2] - world[14]);
      p.posObj = [
        fr(fr(fr(dx * world[0]) + fr(dy * world[1])) + fr(dz * world[2])),
        fr(fr(fr(dx * world[4]) + fr(dy * world[5])) + fr(dz * world[6])),
        fr(fr(fr(dx * world[8]) + fr(dy * world[9])) + fr(dz * world[10])),
      ];
    }
    out.push(p);
  }
  return { lights: out };
}

/** `c + (1 - c) * a * k` evaluated the way the x87 does with 24-bit precision control: every operation rounds (fld 1; fsub c; fmul a; fmul k; fadd c) */
const acc = (c: number, a: number, k: number): number => fr(fr(fr(fr(1 - c) * a) * k) + c);

/** the static variant's accumulation with the light colour already multiplied in: `c + (1 - c) * ak` */
const accPre = (c: number, ak: number): number => fr(fr(fr(1 - c) * ak) + c);

/** `(int)ROUND(x)`: fistp with the default rounding mode (nearest, ties to even) */
export function roundEven(x: number): number {
  if (!(Math.abs(x) < 2147483648)) return -2147483648;   // fistp's "integer indefinite"
  const r = Math.floor(x + 0.5);
  return x + 0.5 === r && (r & 1) ? r - 1 : r;
}
const b8 = (x: number, k: number): number => { const v = roundEven(fr(x * k)); return v < 0 ? 0 : v > 255 ? 255 : v; };
/**
 * the 0x2c2 variants store `ROUND(g) * 0x100 - 0x1000000 + ROUND(b) + ROUND(r) * 0x10000` as one dword (alpha 0xff when no channel exceeds 255; a channel over 255, which only
 * happens when the object's matrix is scaled and the half vector comes out longer than 1, carries into its neighbour exactly like that arithmetic)
 */
function packShiny(out: Uint8Array | Uint8ClampedArray, o: number, r: number, g: number, b: number): void {
  const v = (g * 0x100 - 0x1000000 + b + r * 0x10000) | 0;
  out[o] = (v >> 16) & 255; out[o + 1] = (v >> 8) & 255; out[o + 2] = v & 255; out[o + 3] = (v >>> 24) & 255;
}

/**
 * FUN_00885a9a: vertex colours (RGB bytes into `out` at 4 * i, alpha untouched) of a static mesh (vertex format 0x242) for the given normals and positions
 * (object space; the positions only matter for point lights).
 */
export function lightStatic(pl: PreparedLights, n: number, normals: ArrayLike<number>, positions: ArrayLike<number>, out: Uint8Array | Uint8ClampedArray): void {
  const L = pl.lights;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (l.kind === 1) {
        const d = fr(fr(fr(l.dirObj[0] * nx) + fr(l.dirObj[1] * ny)) + fr(l.dirObj[2] * nz));
        if (d > 0) {
          // the static variant multiplies the light colour in first (fstp dr), then fld 1; fsub c; fmul dr; fadd c
          r = accPre(r, fr(d * l.color[0])); g = accPre(g, fr(d * l.color[1])); b = accPre(b, fr(d * l.color[2]));
        }
      } else if (l.kind === 2) {
        // FUN_00415190 normalises the vertex-to-light vector in place and returns its length
        let dx = fr(positions[i * 3] - l.posObj[0]), dy = fr(positions[i * 3 + 1] - l.posObj[1]), dz = fr(positions[i * 3 + 2] - l.posObj[2]);
        const l2 = fr(fr(fr(dx * dx) + fr(dy * dy)) + fr(dz * dz));
        let len = 0;
        if (l2 !== 0) { len = fr(Math.sqrt(l2)); const k2 = fr(1 / len); dx = fr(k2 * dx); dy = fr(k2 * dy); dz = fr(k2 * dz); }
        const d = -fr(fr(fr(dx * nx) + fr(dy * ny)) + fr(dz * nz));
        if (d > 0 && len < l.range) {
          const f = fr(fr(1 - fr(len / l.range)) * d);
          r = accPre(r, fr(f * l.color[0])); g = accPre(g, fr(f * l.color[1])); b = accPre(b, fr(f * l.color[2]));
        }
      } else {
        if (r < l.color[0]) r = l.color[0];
        if (g < l.color[1]) g = l.color[1];
        if (b < l.color[2]) b = l.color[2];
      }
    }
    out[i * 4] = b8(r, 255); out[i * 4 + 1] = b8(g, 255); out[i * 4 + 2] = b8(b, 255);
  }
}

/** FUN_0088589e: the skinned variant (no point lights) */
export function lightSkinned(pl: PreparedLights, n: number, normals: ArrayLike<number>, out: Uint8Array | Uint8ClampedArray): void {
  const L = pl.lights;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (l.kind === 1) {
        const d = fr(fr(fr(l.dirObj[0] * nx) + fr(l.dirObj[1] * ny)) + fr(l.dirObj[2] * nz));
        if (d > 0) {
          r = acc(r, d, l.color[0]);
          g = acc(g, d, l.color[1]);
          b = acc(b, d, l.color[2]);
        }
      } else if (l.kind === 0) {
        if (r < l.color[0]) r = l.color[0];
        if (g < l.color[1]) g = l.color[1];
        if (b < l.color[2]) b = l.color[2];
      }
    }
    out[i * 4] = b8(r, 255); out[i * 4 + 1] = b8(g, 255); out[i * 4 + 2] = b8(b, 255);
  }
}

/** the repeated squaring of the specular term (fld h; fmul h; fst h; fmul h; fst h ...): 4 squarings = h^16, 3 = h^8, each rounded to a float */
function powChain(x: number, squarings: 3 | 4): number {
  let p = x;
  for (let i = 0; i < squarings; i++) p = fr(p * p);
  return p;
}

/**
 * FUN_0088612c (`skinned` = false: pow 16, threshold 0.9, scale 128) and FUN_00885e33 (`skinned`: pow 8, threshold 0.92, scale 220): RGB bytes of the diffuse colour into `diff`
 * and of the specular colour into `spec` (4 bytes per vertex each, alpha 0xff). Directional lights contribute to both, point lights to neither.
 */
export function lightShiny(pl: PreparedLights, n: number, normals: ArrayLike<number>, diff: Uint8Array | Uint8ClampedArray, spec: Uint8Array | Uint8ClampedArray, skinned = false): void {
  const L = pl.lights;
  const thr = skinned ? fr(0.92) : fr(0.9), sc = skinned ? 220 : 128, sq: 3 | 4 = skinned ? 3 : 4;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, sr = 0, sg = 0, sb = 0;
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (l.kind === 1) {
        const d = fr(fr(fr(l.dirObj[0] * nx) + fr(l.dirObj[1] * ny)) + fr(l.dirObj[2] * nz));
        const h = fr(fr(fr(l.halfObj[0] * nx) + fr(l.halfObj[1] * ny)) + fr(l.halfObj[2] * nz));
        if (d > 0) {
          r = acc(r, d, l.color[0]);
          g = acc(g, d, l.color[1]);
          b = acc(b, d, l.color[2]);
        }
        if (h > thr) {
          const p = powChain(h, sq);
          sr = acc(sr, p, l.color[0]);
          sg = acc(sg, p, l.color[1]);
          sb = acc(sb, p, l.color[2]);
        }
      } else if (l.kind === 0) {
        if (r < l.color[0]) r = l.color[0];
        if (g < l.color[1]) g = l.color[1];
        if (b < l.color[2]) b = l.color[2];
      }
    }
    packShiny(diff, i * 4, roundEven(fr(r * 255)), roundEven(fr(g * 255)), roundEven(fr(b * 255)));
    packShiny(spec, i * 4, roundEven(fr(sr * sc)), roundEven(fr(sg * sc)), roundEven(fr(sb * sc)));
  }
}

/** a RuntimeLight array from plain numbers (tests) */
export function lightSetOf(list: RuntimeLight[]): LightSet {
  return { ambient: [0, 0, 0], directional: [], point: [], list };
}
