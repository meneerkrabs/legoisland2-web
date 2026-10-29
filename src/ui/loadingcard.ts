// The loading card (FUN_0040d1be, drawn by the frame's present FUN_0040cb0f whenever the scene is not fully visible): the black fade quad, the spinning disc of `Pizza.tga` / `CD.tga`
// (a 128 radius diamond turned by two angles that advance with the wall clock) and the text LOADING / INSERTCD. `FUN_0043ec80(fade)` is the fade the game sets per frame; it also switches
// the card on while `ftol(fade * 16) < 16`, i.e. for every fade below 1.0: the disc spins over every fade-in / fade-out of every zone, with alpha `255 - fade * 255` (the text is not faded).
// Everything below follows the decompile / disassembly (docs/re/gaps.md U1, checked against the original's code in the x86 interpreter: tools/tests/m7-shell-loadcard.mjs):
//   * first call (+0x84 set by the constructor FUN_0040d02f): texts and textures are loaded, the fade is 0 and the vertex colour 0xffffffff (opaque);
//   * the angles: `rotZ = Euler0(0, 0, angle[0x92])`, `rotX = Euler0(angle[0x93], 0, 0)`, `m = rotZ * rotX` (FUN_0043a9e5(m, rotX, rotZ): rotZ is applied first), the four corners
//     (128, 0, 0) (0, 128, 0) (-128, 0, 0) (0, -128, 0) go through `m` (FUN_0043ab72), x / y are added to the viewport's centre (integers, `(x1 - x0) / 2`), the quad is an orthographic
//     triangle fan with the UVs (0,1) (1,1) (1,0) (0,0) (the full-screen quad's array, reused) and the vertex colour of the fade (block 0x10: texture colour, alpha = texture alpha * vertex alpha, no culling);
//   * which face: the transformed (0, 0, 1) has z > 0 -> the CD (`ctx + 0x224`), else the pizza (`ctx + 0x14c`);
//   * after the draw: `dt = (float)(int)(GetTickCount() - last) / 30`, `angle[0x92] += 0.05 * dt`, `angle[0x93] += 0.01 * dt` (float32 stores), `last = now`: the clock only moves while the card is drawn.
// The positions are in the viewport's own pixels; the port runs the 640x480 mode of the original (the only mode in which the text position FUN_00439c6f(.., W / 2, H - 100) is on the
// screen) in the 640x480 virtual grid of the 2D layer.
import { matEuler0, matMul, transformPoint } from '../fx/particles/mat.ts';

const f32 = Math.fround;

/** the corners of the diamond (local_234: four vec3) */
const CORNERS = [128, 0, 0, 0, 128, 0, -128, 0, 0, 0, -128, 0];
/** the UVs of the quad (the vertex array is built for the full-screen quad (0,0) (W-1,0) (W-1,H-1) (0,H-1) and reused by the disc): V = 1 at the top, like every picture of the 2D layer */
const UV: readonly (readonly [number, number])[] = [[0, 1], [1, 1], [1, 0], [0, 0]];

export interface CardVertex { x: number; y: number; u: number; v: number }
export interface CardFrame {
  /** the vertex colour of the fade quad and the disc (`ftol(255 - fade * 255) << 24 | 0xffffff`, 0xffffffff on the first call) */
  colour: number;
  /** the alpha byte of that colour */
  alpha: number;
  /** the four vertices of the disc (x / y in viewport pixels, float32) */
  verts: CardVertex[];
  /** 0 = Pizza.tga, 1 = CD.tga */
  face: 0 | 1;
  /** the text position FUN_00439c6f gets (x = W / 2, y = H - 100: the centre line and the line cell's bottom) */
  textX: number; textY: number;
}

export class LoadingCard {
  /** angle[0x92] (ctx + 0x248): about z */
  angleZ = 0;
  /** angle[0x93] (ctx + 0x24c): about x */
  angleX = 0;
  /** DAT_00987770: GetTickCount() of the last drawn card */
  lastTick = 0;
  /** DAT_00987bac: number of cards drawn */
  draws = 0;
  /** ctx + 0x84: the first call still has to load */
  private first = true;
  /** ctx + 0x8c: the card is on (FUN_0043ec80: `ftol(fade * 16) < 16`) */
  active = true;
  /** ctx + 0x90: the fade */
  fadeValue = 0;

  /** FUN_0043ec80(fade): the scene's visibility for the frame; also switches the card on / off */
  setFade(fade: number) {
    this.fadeValue = f32(fade);
    this.active = Math.trunc(this.fadeValue * 16) < 16;
  }

  /**
   * FUN_0040d1be for a viewport of `w` x `h` pixels at tick `now` (GetTickCount, ms): null when the card is off. Advances the angles like the original.
   * The first call overrides the fade with 0 and the colour with 0xffffffff.
   */
  frame(w: number, h: number, now: number): CardFrame | null {
    const cx = (w / 2) | 0, cy = (h / 2) | 0;   // (x1 - x0 + (sign)) >> 1 with the sign correction: truncation toward zero
    let colour: number;
    if (this.first) {
      this.first = false;
      this.active = true;
      this.fadeValue = 0;
      colour = 0xffffffff;
    } else {
      if (this.fadeValue < 0) this.fadeValue = 0;
      if (1 < this.fadeValue) this.fadeValue = 1;
      colour = (((Math.trunc(255 - this.fadeValue * 255) << 24) | 0xffffff) >>> 0);
    }
    if (!this.active) return null;
    const rz = new Float32Array(16), rx = new Float32Array(16), m = new Float32Array(16);
    matEuler0(rz, 0, 0, 0, this.angleZ);
    matEuler0(rx, 0, this.angleX, 0, 0);
    matMul(m, 0, rx, 0, rz, 0);
    const p = new Float32Array(3), c = new Float32Array(3);
    const verts: CardVertex[] = [];
    for (let k = 0; k < 4; k++) {
      c.set(CORNERS.slice(k * 3, k * 3 + 3));
      transformPoint(p, 0, m, 0, c, 0);
      verts.push({ x: f32(cx + p[0]), y: f32(cy + p[1]), u: UV[k][0], v: UV[k][1] });
    }
    const n = new Float32Array(3);
    transformPoint(n, 0, m, 0, new Float32Array([0, 0, 1]), 0);
    const face: 0 | 1 = n[2] > 0 ? 1 : 0;
    this.draws++;
    // the clock: int difference (DWORD wrap), float32 stores
    const dt = f32(f32((now - this.lastTick) | 0) / 30);
    this.lastTick = now | 0;
    this.angleZ = f32(f32(0.05) * dt + this.angleZ);
    this.angleX = f32(f32(0.01) * dt + this.angleX);
    return { colour, alpha: colour >>> 24, verts, face, textX: cx, textY: h - 100 };
  }
}
