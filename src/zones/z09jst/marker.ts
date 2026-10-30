// z09JST: the aim marker FUN_005d2814 (the draw hook of the dark knight's record). After FUN_00444480 (the record and its attachments) it projects the origin (0, 0, 0) of the LAST drawn mesh's
// world matrix (the shield attachment: FUN_004445c0 = FUN_00416d1a: ComputeSphereVisibility of the point with radius 1.0 in the current world matrix, drawn only when the sphere is completely inside
// the frustum (flags 0); ProcessVertices to a point of the BACK BUFFER, in pixels of the display mode), then draws 16 lines with FUN_00445ba0 in those pixels: the fixed corner marks (size 20, white) around the
// projected point and the aim marks (size 30, yellow, red when the squared aim offset is < 40) around point + aim. Integer division: the short part of a mark is `size / 3` as an int (6 and 10).
// Not drawn while the loop is in mode 3 (pause menu) or 9 (controls help), nor without the node's reticle flag (+0x51).

export interface Line { x0: number; y0: number; x1: number; y1: number; color: number }

/** the 8 lines of one mark of size `s` around (cx, cy), in the order of the code: left-top down, top left, top right, right-top down, right-bottom, bottom right, bottom left, left-bottom */
export function markLines(cx: number, cy: number, s: number, color: number): Line[] {
  const t = Math.trunc(s / 3);
  const f = Math.fround;
  const L = (x0: number, y0: number, x1: number, y1: number): Line => ({ x0: f(x0), y0: f(y0), x1: f(x1), y1: f(y1), color });
  return [
    L(cx - s, cy - t, cx - s, cy - s), L(cx - s, cy - s, cx - t, cy - s), L(cx + t, cy - s, cx + s, cy - s), L(cx + s, cy - s, cx + s, cy - t),
    L(cx + s, cy + t, cx + s, cy + s), L(cx + s, cy + s, cx + t, cy + s), L(cx - t, cy + s, cx - s, cy + s), L(cx - s, cy + s, cx - s, cy + t),
  ];
}

/** the 16 lines FUN_005d2814 draws for the projected shield origin (px, py) and the aim offset (aimX, aimY), all in back-buffer pixels */
export function reticleLines(px: number, py: number, aimX: number, aimY: number): Line[] {
  const f = Math.fround;
  const aimSq = f(f(aimY * aimY) + f(aimX * aimX));         // node +0xf4 = +0xf0 * +0xf0 + +0xec * +0xec
  const col = aimSq < 40 ? 0xffff0000 : 0xffffff00;
  return [...markLines(px, py, 20, 0xffffffff), ...markLines(f(px + aimX), f(py + aimY), 30, col)];
}

/** is the marker drawn in this loop mode (DAT_05d5ad04): not in the pause menu (3) and not in the controls help (9) */
export const reticleMode = (mode: number): boolean => mode !== 3 && mode !== 9;
