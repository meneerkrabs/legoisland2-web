// The star field of the asteroid belt (FUN_007b7c24 + FUN_0088002d, called from the shuttle's draw hook before the shuttle is drawn): a quad at 1500 units in front of the
// camera whose four corners are the corners of the view frustum's unit plane (centre + forward, +-0.7 along the view's right and up) stretched out to 1500 times the
// distance; the texture coordinates are the world x / y of the corners times 0.005, so the nebula texture (SKY_ record: meshes/background.Msh, texture 14) slides with the
// ship's position and repeats every 200 units. Drawn first, fog off, in render mode 2 (state block 1: texture colour and alpha, alpha blended, depth on).
// The records G000..G006 (flashy stars, galaxy ...) are never drawn in the original either: their flags are cleared by FUN_007b70a1 and nothing sets them again.
import type { Archive } from '../../formats/archive.ts';
import type { Msh } from '../../formats/msh.ts';
import { SKY_MODE } from '../../render/index.ts';
import type { Renderer, MeshGpu, TexGpu } from '../../render/index.ts';

/** FUN_007b7c24: the quad's distance factor (-1500 at 0x9456f4, applied to eye - corner) and the half extent of the frustum plane (FUN_00444370: 0.7) */
export const BACKDROP_DISTANCE = 1500;
export const BACKDROP_HALF = 0.7;
/** FUN_0088002d: uv = world position * 0.005 (0x8922cc) */
export const BACKDROP_UV = 0.005;
/** FUN_0088002d draws the corners (BL, BR, TR, TL) with the index list 0 2 1, 0 3 2 (DAT_009812c4) */
export const BACKDROP_INDICES = [0, 2, 1, 0, 3, 2] as const;

/** the four corners (bottom-left, bottom-right, top-right, top-left) in world space for an eye and a forward vector (up = world y: the camera never rolls) */
export function backdropCorners(eye: ArrayLike<number>, fwd: ArrayLike<number>, up0: ArrayLike<number> = [0, 1, 0], widen = 1): number[][] {
  // view basis like FUN_0043cc5c: right = up0 x forward, up = forward x right
  let rx = up0[1] * fwd[2] - up0[2] * fwd[1], ry = up0[2] * fwd[0] - up0[0] * fwd[2], rz = up0[0] * fwd[1] - up0[1] * fwd[0];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = fwd[1] * rz - fwd[2] * ry, uy = fwd[2] * rx - fwd[0] * rz, uz = fwd[0] * ry - fwd[1] * rx;
  const k = BACKDROP_HALF, kr = k * widen;   // `widen` = canvas aspect / (4:3): the quad grows with the horizontal field of view in widescreen
  const cx = eye[0] + fwd[0], cy = eye[1] + fwd[1], cz = eye[2] + fwd[2];
  const corner = (sr: number, su: number) => {
    const px = cx + su * k * ux + sr * kr * rx, py = cy + su * k * uy + sr * kr * ry, pz = cz + su * k * uz + sr * kr * rz;
    return [eye[0] + (px - eye[0]) * BACKDROP_DISTANCE, eye[1] + (py - eye[1]) * BACKDROP_DISTANCE, eye[2] + (pz - eye[2]) * BACKDROP_DISTANCE];
  };
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

export class Backdrop {
  private mesh: MeshGpu;
  private tex: TexGpu | null = null;
  private r: Renderer;
  private archive: Archive;
  private texId: number;
  private id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  private nrm = new Float32Array(12);

  /** `texId`: texture number in the zone's texture list (14 for z39ASB, text014.tga) */
  constructor(r: Renderer, archive: Archive, texId: number) {
    this.r = r; this.archive = archive; this.texId = texId;
    const msh: Msh = {
      vertexCount: 4, positions: new Float32Array(12), colors: new Uint32Array(4).fill(0xffffffff), uvs: new Float32Array(8), uvs2: new Float32Array(8),
      normals: new Float32Array(12), indices: Uint16Array.from(BACKDROP_INDICES), groups: [{ flags: 0, indexCount: 6, firstVertex: 0, vertexCount: 4, firstIndex: 0 }],
      gtom: null, matl: null, svwl: null,
    };
    this.mesh = r.uploadMesh(msh);
    for (let i = 0; i < 4; i++) this.nrm[i * 3 + 2] = -1;
  }

  draw(eye: [number, number, number], fwd: [number, number, number]) {
    const r = this.r;
    if (!this.tex) this.tex = r.texture(this.archive, this.texId);
    const tex = this.tex;
    if (!tex) return;
    const cv = r.canvas;
    const pts = backdropCorners(eye, fwd, [0, 1, 0], cv.width > 0 && cv.height > 0 ? cv.width / cv.height / (4 / 3) : 1);
    const pos = new Float32Array(12), uvs = this.mesh.msh.uvs;
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 3; k++) pos[i * 3 + k] = pts[i][k];
      uvs[i * 2] = pts[i][0] * BACKDROP_UV;
      uvs[i * 2 + 1] = pts[i][1] * BACKDROP_UV;
    }
    r.updateMeshVertices(this.mesh, pos, this.nrm);
    const fog = r.fog;
    r.fog = { ...fog, enabled: false };
    r.drawMesh(this.mesh, this.id, () => tex, { mode: SKY_MODE });
    r.fog = fog;
  }
}
