// Section 4 "Camera en tekenen", part 2: the debug-draw queue of the original, ported as a TS queue class plus the drain that draws it with the port's renderer.
//
// The original (LE2.c:38663 .. 38860, docs/re/unused.md 6.6):
//   FUN_00445b90(mode)            DAT_05cb5894 = mode: 0 = world-space lines (FUN_0087da0b: D3D LINELIST, FVF XYZ | DIFFUSE), non-zero = screen-space lines (FUN_0087da91: XYZRHW | DIFFUSE; z08BKD's 2D UI)
//   FUN_00445ba0(a, b, c0, c1)    a line into the line queue DAT_014d5888 (0x24 bytes: mode, a (3 floats), b (3), colour at a, colour at b), only while DAT_05cb5898 (line queue on)
//                                 and the master DAT_05cb588c are non-zero; FUN_00445c30(count, &DAT_05cb5898) after the store
//   FUN_00445c70(pos, type, r, c) a marker into the shape queue DAT_009e5888 (0x1c bytes: pos (3), r at +0xc, colour at +0x10, type at +0x18), only while DAT_05cb589c and the master are non-zero
//   FUN_00445c30(count, &flag)    count >= 0x64000: the queue is switched off (flag = 0) and, once, the message box "Graph Queue has overflowed / Do you want to be warned aboiut this again?" (title
//                                 "Aaaaarg", Yes / No): No sets DAT_05cb58a0 = 1 (never warn again)
//   FUN_00445cf0                  the queues are emptied and switched on again (called at the end of the drain)
//   FUN_00445d20                  the drain, at the end of every frame: world matrix = identity; with the master: lines (FUN_00445f20), then the markers: type 0 FUN_00445f60 = an X (the two
//                                 diagonals (x - r, y - r)-(x + r, y + r) and (x - r, y + r)-(x + r, y - r)), type 1 FUN_004460a0 = a + (the two axes), type 2 FUN_004461b0 = a square (4 edges); all in the
//                                 world XY plane at the marker's z, both vertex colours = the marker's colour (r = half the size, NOT a sphere). The per-point list DAT_022e5914 (DAT_05cb5890, never set) is not ported.
// Colours are D3DCOLOR (ARGB).
//
// Port differences (extensions, all labelled in the UI): (a) every entry carries a `tag` (the category the corner's check boxes switch); (b) the original's queue is emptied by the drain at the end of
// every frame, one tick per frame; the port draws at the display rate (60 Hz or more against the 60 Hz sim step), so the batch of the LAST tick stays in the queue and is drawn again until the next
// tick starts a new one (`beginTick`); (c) markers can be drawn as spheres (3 circles) instead of the original's flat X / + / square (`sphereMarkers`); (d) screen-space (mode != 0) lines are kept and counted but not drawn.
import type { Renderer } from '../render/index.ts';

/** FUN_00445c30: `0x63fff < count` */
export const QUEUE_LIMIT = 0x64000;
/** the entry sizes of the original, for the UI */
export const LINE_ENTRY_BYTES = 0x24, SHAPE_ENTRY_BYTES = 0x1c;

export interface QLine { mode: number; a: [number, number, number]; b: [number, number, number]; c0: number; c1: number; tag: string }
export interface QShape { pos: [number, number, number]; r: number; color: number; type: number; tag: string }

export class DebugQueue {
  /** DAT_05cb588c: the master switch (set by FUN_005cdb60 in z08BKD; the corner sets it while a category is on) */
  master = false;
  /** DAT_05cb5894 (FUN_00445b90) */
  mode = 0;
  /** DAT_05cb5898 / DAT_05cb589c: the queues are on (FUN_00445cf0 sets them, an overflow clears them) */
  lineOn = true; shapeOn = true;
  /** DAT_05cb58a0 */
  neverWarn = false;
  lines: QLine[] = [];
  shapes: QShape[] = [];
  /** how often an overflow happened / how often the message box would have been shown */
  overflows = 0; warnings = 0;
  /** the message box of FUN_00445c30: true = "No" (do not warn again). Default: a console warning that counts as "No" would hide later overflows, so it answers "Yes" (warn again) */
  onOverflow: (which: 'lines' | 'shapes') => boolean = (w) => { console.warn(`Graph Queue has overflowed (${w})`); return false; };
  /** lines and markers queued since the queue was created */
  total = { lines: 0, shapes: 0 };

  /** FUN_00445b90 */
  setMode(m: number) { this.mode = m; }

  /** FUN_00445ba0(a, b, c0, c1) */
  line(a: ArrayLike<number>, b: ArrayLike<number>, c0: number, c1: number, tag = '') {
    if (!this.lineOn || !this.master) return;
    this.lines.push({ mode: this.mode, a: [a[0], a[1], a[2]], b: [b[0], b[1], b[2]], c0: c0 >>> 0, c1: c1 >>> 0, tag });
    this.total.lines++;
    this.overflow(this.lines.length, 'lines');
  }

  /** FUN_00445c70(pos, type, r, colour) */
  shape(pos: ArrayLike<number>, type: number, r: number, color: number, tag = '') {
    if (!this.shapeOn || !this.master) return;
    this.shapes.push({ pos: [pos[0], pos[1], pos[2]], r, color: color >>> 0, type, tag });
    this.total.shapes++;
    this.overflow(this.shapes.length, 'shapes');
  }

  /** FUN_00445c30(count, &flag) */
  private overflow(count: number, which: 'lines' | 'shapes') {
    if (count < QUEUE_LIMIT) return;
    if (which === 'lines') this.lineOn = false; else this.shapeOn = false;
    this.overflows++;
    if (!this.neverWarn) { this.warnings++; this.neverWarn = this.onOverflow(which); }
  }

  /** FUN_00445cf0: empty both queues, switch them on again */
  reset() { this.lines.length = 0; this.shapes.length = 0; this.lineOn = true; this.shapeOn = true; }

  /**
   * a new tick starts: the batch of the previous tick is dropped (extension (b)). Not called while the game stands still (corner open and paused): the last batch stays on screen.
   */
  beginTick() { this.reset(); }
}

/** D3DCOLOR 0xAARRGGBB -> [r, g, b, a] in 0..1 */
export function argb(c: number): [number, number, number, number] {
  return [((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255, ((c >>> 24) & 255) / 255];
}

/** the segments of a marker (FUN_00445f60 / FUN_004460a0 / FUN_004461b0), each as [x0, y0, x1, y1] relative to the marker: z stays the marker's z */
export function markerSegments(type: number, r: number): number[][] {
  switch (type) {
    case 0: return [[-r, -r, r, r], [-r, r, r, -r]];                       // FUN_00445f60: the two diagonals
    case 1: return [[-r, 0, r, 0], [0, r, 0, -r]];                         // FUN_004460a0: the two axes
    case 2: return [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]];   // FUN_004461b0: the four edges
    default: return [];
  }
}

export interface DrawOptions {
  /** (c) markers as a sphere: 3 circles of radius r instead of the flat X / + / square */
  sphereMarkers: boolean;
  /** which tags are drawn (undefined = all) */
  show?: (tag: string) => boolean;
  /** gradient lines (c0 != c1) are drawn as this many pieces (the original interpolates the vertex colours) */
  gradientPieces: number;
}

/** a circle of `n` segments in the plane spanned by axes `ax` and `ay` (0 = x, 1 = y, 2 = z) around `p` */
export function circleSegments(p: ArrayLike<number>, r: number, ax: number, ay: number, n = 16): [number[], number[]][] {
  const out: [number[], number[]][] = [];
  const pt = (k: number) => { const q = [p[0], p[1], p[2]]; const a = (k / n) * Math.PI * 2; q[ax] += Math.cos(a) * r; q[ay] += Math.sin(a) * r; return q; };
  for (let k = 0; k < n; k++) out.push([pt(k), pt(k + 1)]);
  return out;
}

/** FUN_00445d20's drawing part: lines (mode 0), then the markers. Returns how many Renderer.drawLine calls it made. */
export function drawQueue(r: Pick<Renderer, 'drawLine'>, q: DebugQueue, o: DrawOptions): number {
  let n = 0;
  const line = (a: ArrayLike<number>, b: ArrayLike<number>, col: number[]) => { r.drawLine(a, b, col); n++; };
  for (const l of q.lines) {
    if (l.mode !== 0) continue;                       // screen-space lines (FUN_0087da91): not drawn
    if (o.show && !o.show(l.tag)) continue;
    if (l.c0 === l.c1 || o.gradientPieces <= 1) { line(l.a, l.b, argb(l.c0)); continue; }
    const k = o.gradientPieces;
    const A = argb(l.c0), Bc = argb(l.c1);
    for (let i = 0; i < k; i++) {
      const t0 = i / k, t1 = (i + 1) / k, tm = (t0 + t1) / 2;
      const p0 = [l.a[0] + (l.b[0] - l.a[0]) * t0, l.a[1] + (l.b[1] - l.a[1]) * t0, l.a[2] + (l.b[2] - l.a[2]) * t0];
      const p1 = [l.a[0] + (l.b[0] - l.a[0]) * t1, l.a[1] + (l.b[1] - l.a[1]) * t1, l.a[2] + (l.b[2] - l.a[2]) * t1];
      line(p0, p1, [0, 1, 2, 3].map((c) => A[c] + (Bc[c] - A[c]) * tm));
    }
  }
  for (const s of q.shapes) {
    if (o.show && !o.show(s.tag)) continue;
    const col = argb(s.color);
    if (o.sphereMarkers) {
      for (const [ax, ay] of [[0, 1], [1, 2], [0, 2]]) for (const [a, b] of circleSegments(s.pos, s.r, ax, ay)) line(a, b, col);
      continue;
    }
    for (const g of markerSegments(s.type, s.r)) if (g.length) line([s.pos[0] + g[0], s.pos[1] + g[1], s.pos[2]], [s.pos[0] + g[2], s.pos[1] + g[3], s.pos[2]], col);
  }
  return n;
}
