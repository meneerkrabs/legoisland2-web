// The 2D layer (docs/re/rendering.md section 11, docs/re/ui-m2.md): sprites, rectangles, text, fade, letterbox on a WebGL2 context that is shared with the 3D
// `Renderer` (3D first, `ui.flush()` last). Own program / buffer / VAO; every GL state touched is saved and restored around `flush()`.
// The 2D area is the 640x480 virtual grid of the game scaled to the canvas: 4:3 centred (`fit`, default; the game only has 4:3 modes) or stretched.
// Draw order inside a frame: immediate sprites / rectangles / fade / letterbox in call order, then deferred sprites, then text (like the game's queues).
import type { Archive } from '../formats/archive.ts';
import { parseTextOptions } from '../formats/text.ts';
import { parseTga } from '../formats/tga.ts';
import { parseWib } from '../formats/wib.ts';
import { loadFontData } from './fonts.ts';
import type { UiFontData } from './fonts.ts';
import { drawString, layoutMessage, lineHeight, measureText, COLOUR_SHADOW } from './layout.ts';
import type { Align, LayoutFont, ScreenEnv, TextCmd } from './layout.ts';
import { LoadingCard } from './loadingcard.ts';
import { getTickCount } from '../game/crt.ts';

// ---------------------------------------------------------------------------------------------------- textures

/** a UI texture: full size, CLAMP, bilinear, no mip maps (the UI textures are loaded with flag byte 0xffffff80) */
export interface UiTexture { tex: WebGLTexture; w: number; h: number }

/** `mips`: an HD texture pack's picture (larger than the original): mip-mapped, because it is drawn much smaller than it is */
function makeTexture(gl: WebGL2RenderingContext, rgba: Uint8Array, w: number, h: number, mips = false): UiTexture {
  const tex = gl.createTexture()!;
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const prevAlign = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, prevAlign);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, prev);
  return { tex, w, h };
}

/**
 * A numbered texture set of the 2D layer: `<dir>/text.opt` + `Text000.tga ...` (or `.wib`, first frame) of an archive, e.g. `menu/mOverlays` (72), `Overlays/Z02LGI`,
 * `Overlays/HUDFX`, `menu/loading`, or a single image (`GENERICBITS`: `Backdrop/loadingscreen.tga`, `CD.tga`, `Pizza.tga`). Textures are indexed like the game's `{list, index}` pairs.
 */
export class UiTextureSet {
  readonly gl: WebGL2RenderingContext;
  readonly textures: (UiTexture | null)[];
  constructor(gl: WebGL2RenderingContext, textures: (UiTexture | null)[]) { this.gl = gl; this.textures = textures; }
  get length() { return this.textures.length; }
  get(i: number): UiTexture | null { return this.textures[i] ?? null; }
  /** pixel size of texture `i` (0x0 when missing) */
  size(i: number): { w: number; h: number } { const t = this.textures[i]; return t ? { w: t.w, h: t.h } : { w: 0, h: 0 }; }

  static load(gl: WebGL2RenderingContext, archive: Archive, dir: string): UiTextureSet {
    const d = dir ? dir.replace(/\/+$/, '') + '/' : '';
    const opt = archive.find(`${d}text.opt`);
    let count = opt ? parseTextOptions(archive.read(opt)).count : 0;
    if (!opt) while (archive.has(`${d}Text${String(count).padStart(3, '0')}.tga`) || archive.has(`${d}Text${String(count).padStart(3, '0')}.wib`)) count++;
    const list: (UiTexture | null)[] = [];
    for (let i = 0; i < count; i++) {
      const n = `${d}Text${String(i).padStart(3, '0')}`;
      try {
        const tg = archive.find(`${n}.tga`);
        if (tg) { const im = parseTga(archive.read(tg)); list.push(makeTexture(gl, im.rgba, im.width, im.height, archive.isUpscaled(tg, im.width, im.height))); continue; }
        const wb = archive.find(`${n}.wib`);
        if (wb) { const w = parseWib(archive.read(wb)); list.push(makeTexture(gl, w.frames[w.sequence[0] ?? 0], w.width, w.height, archive.isUpscaled(wb, w.width, w.height))); continue; }
      } catch (e) { console.warn('ui texture', n, e); }
      list.push(null);
    }
    return new UiTextureSet(gl, list);
  }
  /** a single `.tga` (e.g. `Backdrop/loadingscreen.tga`) as a set of one */
  static loadImage(gl: WebGL2RenderingContext, archive: Archive, path: string): UiTextureSet {
    const e = archive.find(path);
    if (!e) throw new Error(`${archive.name}: no ${path}`);
    const im = parseTga(archive.read(e));
    return new UiTextureSet(gl, [makeTexture(gl, im.rgba, im.width, im.height, archive.isUpscaled(e, im.width, im.height))]);
  }
  dispose() { for (const t of this.textures) if (t) this.gl.deleteTexture(t.tex); this.textures.length = 0; }
}

// ---------------------------------------------------------------------------------------------------- shader

const VS = `#version 300 es
layout(location=0) in vec2 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aCol;
uniform vec2 uCanvas;
out vec2 vUv; out vec4 vCol;
void main() {
  vUv = aUv; vCol = aCol;
  gl_Position = vec4(aPos.x / uCanvas.x * 2.0 - 1.0, 1.0 - aPos.y / uCanvas.y * 2.0, 0.0, 1.0);
}`;
// mode 0: block 3 / 0x12   colour = texture * vertex colour, alpha = texture alpha
// mode 1: block 0x10       colour = texture,                alpha = texture alpha * vertex alpha
// mode 2: block 0x1d       colour = vertex colour,          alpha = vertex alpha
// alpha test (all blocks): the fragment's alpha byte must be >= 1
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform int uMode;
in vec2 vUv; in vec4 vCol; out vec4 o;
void main() {
  vec4 t = texture(uTex, vUv);
  vec3 rgb; float a;
  if (uMode == 0) { rgb = t.rgb * vCol.rgb; a = t.a; }
  else if (uMode == 1) { rgb = t.rgb; a = t.a * vCol.a; }
  else { rgb = vCol.rgb; a = vCol.a; }
  if (a < 0.5 / 255.0) discard;
  o = vec4(rgb, a);
}`;

/** quad kinds = the game's state blocks */
const MODE_SPRITE = 0, MODE_FADE = 1, MODE_FLAT = 2;

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export type RectLike = Rect | readonly [number, number, number, number];
const asRect = (r: RectLike): Rect => (Array.isArray(r) ? { x0: r[0], y0: r[1], x1: r[2], y1: r[3] } : (r as Rect));

interface Batch { mode: number; tex: WebGLTexture | null; first: number; count: number }
const STRIDE = 20; // x y u v (floats) + rgba (4 bytes)

export interface TextOpts {
  /** colour table index (0 yellow, 1 white, ... 8 black) or raw 0xAARRGGBB; default 0 */
  colour?: number;
  align?: Align;
  /** wrap width in characters: wraps like FUN_00439c6f and centres every line (as the game does, `align` is then ignored) */
  maxChars?: number;
  /** the black copy at (+2, +2) pixels (default true) */
  shadow?: boolean;
}

export class Ui2D {
  readonly gl: WebGL2RenderingContext;
  fit: 'fit' | 'stretch';
  /** the 2D area in canvas pixels after `begin()`: x, y offset, w, h size */
  view = { x: 0, y: 0, w: 640, h: 480 };
  fonts: UiFontData[] = [];
  private fontTex: UiTexture[] = [];
  private prog: WebGLProgram;
  private uCanvas: WebGLUniformLocation | null;
  private uMode: WebGLUniformLocation | null;
  private uTex: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private white: WebGLTexture;
  private black: WebGLTexture;
  private cw = 640; private ch = 480;
  private data = new ArrayBuffer(STRIDE * 6 * 512);
  private f32 = new Float32Array(this.data);
  private u32 = new Uint32Array(this.data);
  private nv = 0;
  private layers: Batch[][] = [[], [], []];
  private texts: (TextCmd & { shadow: boolean; dx: number })[] = [];
  private cur: Batch | null = null;
  private layer = 0;
  // letterbox state (FUN_0045f750 / FUN_0045f771)
  private lbMode = 0; private lbState = 0; private lbH = 0; private lbRate = 0; private lbMax = 0;
  /** horizontal shift (canvas pixels) of what is queued next: see `anchor()` */
  private dx = 0;
  /** the loading card of the fade overlay (FUN_0040d1be, loadingcard.ts): the two faces of the disc and its text; null = only the black quad */
  card: { pizza: UiTexture; cd: UiTexture; text: string } | null = null;
  readonly cardState = new LoadingCard();
  /** GetTickCount (ms) of the card's clock */
  clockMs: () => number = () => getTickCount();   // GetTickCount of the shared C runtime (src/game/crt.ts; tests pin it with setTickCountSource)

  constructor(gl: WebGL2RenderingContext, opts: { fit?: 'fit' | 'stretch' } = {}) {
    this.gl = gl;
    this.fit = opts.fit ?? 'fit';
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    this.uCanvas = gl.getUniformLocation(p, 'uCanvas'); this.uMode = gl.getUniformLocation(p, 'uMode'); this.uTex = gl.getUniformLocation(p, 'uTex');
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    const pv = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null, pb = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.bindVertexArray(pv); gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    this.white = makeTexture(gl, new Uint8Array([255, 255, 255, 255]), 1, 1).tex;
    this.black = makeTexture(gl, new Uint8Array([0, 0, 0, 255]), 1, 1).tex; // stands for the black 16x16 LoadingScreen.tga of the fade overlay
  }

  // ------------------------------------------------------------------------------------------ setup

  /** upload the glyph sheets (index = slot: 0 Balloon12, 1 Balloon24); `loadFontData(archive)` from fonts.ts or `ui.loadFonts(archive)` */
  setFonts(data: UiFontData[]) {
    for (const t of this.fontTex) this.gl.deleteTexture(t.tex);
    this.fonts = data;
    this.fontTex = data.map((d) => makeTexture(this.gl, d.image.rgba, d.image.width, d.image.height, d.hd));
  }
  loadFonts(fontsArchive: Archive) { this.setFonts(loadFontData(fontsArchive)); }
  /** the fonts as the layout module wants them */
  get layoutFonts(): LayoutFont[] { return this.fonts; }
  loadSet(archive: Archive, dir: string): UiTextureSet { return UiTextureSet.load(this.gl, archive, dir); }
  loadImage(archive: Archive, path: string): UiTextureSet { return UiTextureSet.loadImage(this.gl, archive, path); }

  /**
   * Start a frame: sizes the 2D area from the canvas (drawing buffer size by default) and clears the queues. `fit`: the 4:3 area is centred in the canvas
   * (pillar / letterboxed, the bars are NOT painted here: the 3D scene or the caller's clear shows there); `stretch`: the area is the whole canvas.
   */
  begin(canvasW = this.gl.drawingBufferWidth, canvasH = this.gl.drawingBufferHeight) {
    this.cw = canvasW; this.ch = canvasH;
    if (this.fit === 'stretch' || canvasW * 3 === canvasH * 4) this.view = { x: 0, y: 0, w: canvasW, h: canvasH };
    else {
      const w = Math.min(canvasW, Math.floor((canvasH * 4) / 3)), h = Math.min(canvasH, Math.floor((canvasW * 3) / 4));
      this.view = { x: Math.floor((canvasW - w) / 2), y: Math.floor((canvasH - h) / 2), w, h };
    }
    this.nv = 0; this.layers = [[], [], []]; this.texts = []; this.cur = null; this.layer = 0; this.dx = 0;
  }
  /**
   * Widescreen: where the sprites / text queued from now on are anchored horizontally. `'centre'` (default) = the 4:3 area; `'left'` / `'right'` move them with the
   * left / right edge of the canvas (the 640x480 grid is unchanged, only the area's own offset is replaced by the edge's). With a 4:3 canvas all three are the same.
   * Reset to `'centre'` by `begin()`.
   */
  anchor(side: 'left' | 'centre' | 'right') {
    const v = this.view;
    this.dx = side === 'left' ? -v.x : side === 'right' ? this.cw - v.x - v.w : 0;
  }
  /** the 2D area as the layout's screen environment */
  get env(): ScreenEnv { return { w: this.view.w, h: this.view.h }; }
  /** virtual (640x480) -> canvas pixel scale of the 2D area */
  get scale(): { x: number; y: number } { return { x: this.view.w / 640, y: this.view.h / 480 }; }

  // ------------------------------------------------------------------------------------------ quads

  private ensure(extra: number) {
    if ((this.nv + extra) * STRIDE <= this.data.byteLength) return;
    const nd = new ArrayBuffer(this.data.byteLength * 2);
    new Uint8Array(nd).set(new Uint8Array(this.data));
    this.data = nd; this.f32 = new Float32Array(nd); this.u32 = new Uint32Array(nd);
  }
  private batch(layer: number, mode: number, tex: WebGLTexture | null) {
    const c = this.cur;
    if (c && this.layer === layer && c.mode === mode && c.tex === tex) return c;
    const b: Batch = { mode, tex, first: this.nv, count: 0 };
    this.layers[layer].push(b); this.cur = b; this.layer = layer;
    return b;
  }
  /** one quad in CANVAS pixels (+0.5 pixel-centre fix applied here); uv rect (u0,v0) top-left (u1,v1) bottom-right; `c` = ARGB of TL TR BR BL */
  private quad(layer: number, mode: number, tex: WebGLTexture | null, x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, c: readonly [number, number, number, number]) {
    this.ensure(6);
    const b = this.batch(layer, mode, tex);
    const px = [x0, x1, x1, x0], py = [y0, y0, y1, y1], pu = [u0, u1, u1, u0], pv = [v0, v0, v1, v1];
    const pack = (argb: number) => (((argb & 0xff0000) >>> 16) | (argb & 0xff00) | ((argb & 0xff) << 16) | ((argb >>> 24) << 24)) >>> 0;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const o = (this.nv * STRIDE) >> 2;
      this.f32[o] = px[k] + 0.5; this.f32[o + 1] = py[k] + 0.5; this.f32[o + 2] = pu[k]; this.f32[o + 3] = pv[k];
      this.u32[o + 4] = pack(c[k]);
      this.nv++;
    }
    b.count += 6;
  }

  /** a convex quad in CANVAS pixels (corners in fan order, a free shape: the loading card's disc), one colour; the +0.5 pixel-centre fix is applied here */
  private quad4(layer: number, mode: number, tex: WebGLTexture | null, p: readonly { x: number; y: number; u: number; v: number }[], argb: number) {
    this.ensure(6);
    const b = this.batch(layer, mode, tex);
    const pack = (c: number) => (((c & 0xff0000) >>> 16) | (c & 0xff00) | ((c & 0xff) << 16) | ((c >>> 24) << 24)) >>> 0;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const o = (this.nv * STRIDE) >> 2;
      this.f32[o] = p[k].x + 0.5; this.f32[o + 1] = p[k].y + 0.5; this.f32[o + 2] = p[k].u; this.f32[o + 3] = p[k].v;
      this.u32[o + 4] = pack(argb);
      this.nv++;
    }
    b.count += 6;
  }

  /**
   * FUN_0043c267 (block 3): the whole texture on a rectangle given in the 640x480 virtual grid (floats, not truncated), tinted by `argb` (0xffffffff = unchanged;
   * the alpha of the colour is ignored like in the game: the alpha comes from the texture). `set` null / index out of range = block 0x1d (flat ARGB incl. alpha).
   * The rectangle is hand clipped to the 2D area with the UVs following. `deferred` = the end-of-frame queue (FUN_0043c645), drawn after the immediate ones.
   */
  sprite(set: UiTextureSet | null, index: number, rect: RectLike, argb = 0xffffffff, deferred = false) {
    const t = set?.get(index) ?? null;
    if (!t) { this.fillRect(rect, argb, deferred); return; }
    this.spriteTex(t, rect, argb, deferred);
  }
  spriteTex(t: UiTexture, rect: RectLike, argb = 0xffffffff, deferred = false) {
    const clip = this.clipRect(rect);
    if (!clip) return;
    this.quad(deferred ? 1 : 0, MODE_SPRITE, t.tex, clip.x0, clip.y0, clip.x1, clip.y1, clip.u0, clip.v1, clip.u1, clip.v0, [argb, argb, argb, argb]);
  }
  /**
   * RESTORED CONTENT (src/restore/features/arrow.ts; not in the original): the whole texture `index` as a square of side `size` centred on (cx, cy) of the 640x480 virtual grid, turned
   * clockwise by `angle` radians (screen y down), tinted like `sprite`. Not clipped (a small icon well inside the screen). A missing texture draws nothing.
   */
  spriteRot(set: UiTextureSet | null, index: number, cx: number, cy: number, size: number, angle: number, argb = 0xffffffff, deferred = false) {
    const t = set?.get(index) ?? null;
    if (!t) return;
    const v = this.view, sx = v.w / 640, sy = v.h / 480, h = size / 2, c = Math.cos(angle), s = Math.sin(angle);
    // corners TL TR BR BL (fan order of quad4) with the UVs of `sprite` (V up: the top edge has v = 1)
    const corner = (ox: number, oy: number, u: number, vv: number) => ({ x: v.x + this.dx + (cx + ox * c - oy * s) * sx, y: v.y + (cy + ox * s + oy * c) * sy, u, v: vv });
    this.quad4(deferred ? 1 : 0, MODE_SPRITE, t.tex, [corner(-h, -h, 0, 1), corner(h, -h, 1, 1), corner(h, h, 1, 0), corner(-h, h, 0, 0)], argb);
  }
  /** FUN_0043c267 without texture (block 0x1d): a rectangle of flat ARGB (alpha blended) in virtual coordinates */
  fillRect(rect: RectLike, argb: number, deferred = false) {
    const clip = this.clipRect(rect);
    if (!clip) return;
    this.quad(deferred ? 1 : 0, MODE_FLAT, this.white, clip.x0, clip.y0, clip.x1, clip.y1, 0, 0, 1, 1, [argb, argb, argb, argb]);
  }
  /** virtual rect -> canvas px, clipped to the 2D area (FUN_0043c267's clipping); u, v with V up: v0 = bottom edge value (0), v1 = top (1) before clipping */
  private clipRect(r: RectLike) {
    const v = this.view, sx = v.w / 640, sy = v.h / 480, q = asRect(r);
    let x0 = q.x0 * sx, y0 = q.y0 * sy, x1 = q.x1 * sx, y1 = q.y1 * sy;
    let u0 = 0, u1 = 1, v0 = 0, v1 = 1; // v1 = V at the top edge
    if (!(x1 >= 0 && y1 >= 0 && x0 < v.w && y0 < v.h)) return null;
    if (x0 < 0) { u0 = 0 - (x0 * 1) / (x1 - x0); x0 = 0; }
    if (y0 < 0) { v1 = 1 - (y0 * -1) / (y1 - y0); y0 = 0; }
    if (v.w <= x1) { u1 = ((v.w - x1) * (1 - u0)) / (x1 - x0) + 1; x1 = v.w; }
    if (v.h <= y1) { v0 = ((v.h - y1) * (0 - v1)) / (y1 - y0) + 0; y1 = v.h; }
    return { x0: x0 + v.x + this.dx, y0: y0 + v.y, x1: x1 + v.x + this.dx, y1: y1 + v.y, u0, u1, v0, v1 };
  }

  /**
   * Fade overlay and loading card (FUN_0043ec80 + FUN_0040d1be at the frame's present, block 0x10): `a` = scene visibility 0..1 (1 = visible, 0 = black); a black quad over the whole canvas except its last pixel
   * column / row (the original's quad is (0, 0)-(W - 1, H - 1) of the back buffer), with alpha 255 - a * 255, and, while `a < 1`, the spinning disc and the text LOADING (loadingcard.ts: the original draws them with every fade, fading with it).
   * Call it after the scene sprites and before the text of the frame. (The "frame is black while a == 0" rule is the caller's; a >= 1 draws nothing.)
   */
  fade(a: number) {
    const card = this.cardState;
    card.setFade(a);
    const cf = card.frame(640, 480, this.clockMs());
    const al = cf ? cf.alpha : Math.trunc(255 - Math.max(0, Math.min(1, a)) * 255);
    if (al >= 1) {
      const c = (al << 24) >>> 0;
      // the original quad is (0, 0)-(W - 1, H - 1) of the back buffer it renders to (here the drawing buffer): with the top-left rule its last pixel column and row stay unfaded
      this.quad(0, MODE_FADE, this.black, 0, 0, this.cw - 1, this.ch - 1, 0, 0, 1, 1, [c, c, c, c]);
    }
    if (!cf) return;
    const t = this.card;
    if (t) {
      // the disc (triangle fan of the four corners, block 0x10, both faces drawn)
      const v = this.view, sx = v.w / 640, sy = v.h / 480;
      this.quad4(0, MODE_FADE, (cf.face === 1 ? t.cd : t.pizza).tex, cf.verts.map((q) => ({ x: v.x + this.dx + q.x * sx, y: v.y + q.y * sy, u: q.u, v: q.v })), cf.colour);
    }
    // FUN_00439c6f(0, 1, text, 1, 0, W / 2, H - 100, 30): font 1, yellow, wrap 30, centred
    if (t) this.text(1, t.text, cf.textX, cf.textY, { colour: 0, maxChars: 30 });
  }
  /**
   * Cinematic bars, the state machine of FUN_0045f771 (FUN_0045f750 sets the mode and re-arms it: state 1; FUN_0045f7a8 = the arming pass; FUN_0045f8a1 = the pass that
   * steps and draws): `mode` 0 off, 1 top + bottom bar, 2 bottom bar only. Call ONCE PER SIM STEP (= once per drawn frame of the original) with `dt` = DAT_008b1718. The pass that sees a
   * new mode only arms (no bar yet: max = H * 0.4375 * 0.5, rate = H / 30, height 0, float32 like the x87 at 24 bit); every later pass adds `rate * dt` (`_DAT_05d4dce8 * DAT_008b1718 +
   * height`) and stops at the max once `ftol(height)` reaches it. `letterboxDraw` queues the bars of the current state.
   */
  letterboxStep(mode: 0 | 1 | 2, dt: number) {
    const fr = Math.fround;
    if (mode !== this.lbMode) { this.lbMode = mode; this.lbState = 1; }
    if (this.lbState === 1) {
      if (mode === 0) { this.lbState = 0; return; }
      const H = fr(this.ch);
      this.lbMax = fr(fr(H * fr(0.4375)) * fr(0.5)); this.lbH = 0; this.lbRate = fr(H / fr(30)); this.lbState = 2;
      return;
    }
    if (this.lbState !== 2) return;
    this.lbH = fr(fr(this.lbRate * fr(dt)) + this.lbH);
    if (this.lbMax <= Math.trunc(this.lbH)) { this.lbH = fr(this.lbMax * fr(1)); this.lbRate = 0; }
  }
  /** the bars of the state `letterboxStep` left: black, over the whole canvas width (FUN_0043c267 with colour 0xff000000) */
  letterboxDraw() {
    if (this.lbState !== 2 || this.lbMode === 0) return;
    const h = Math.trunc(this.lbH), H = Math.trunc(this.ch), W = Math.trunc(this.cw);
    const k = 0xff000000;
    if (this.lbMode === 1) this.quad(0, MODE_FLAT, this.white, 0, 0, W, h, 0, 0, 1, 1, [k, k, k, k]);
    this.quad(0, MODE_FLAT, this.white, 0, H - h, W, H, 0, 0, 1, 1, [k, k, k, k]);
  }
  /** current bar height in canvas pixels */
  get letterboxHeight() { return Math.trunc(this.lbH); }

  // ------------------------------------------------------------------------------------------ text

  /**
   * Queue a text (drawn after all sprites at `flush()`, with the black copy at +2,+2). `x`, `y` in the 640x480 grid; `y` is the BOTTOM of the line cell (text sits above it).
   * `font` = slot (0 Balloon12, 1 Balloon24 at 0.7). `text` must already be expanded (`MessageTable.text`). Returns the number of lines queued.
   */
  text(font: number, text: string, x: number, y: number, o: TextOpts = {}): number {
    const env = this.env;
    const cmds = layoutMessage(this.fonts, env, { font, text, x, y, colour: o.colour ?? 0, maxChars: o.maxChars, align: o.maxChars !== undefined ? 'centre' : (o.align ?? 'left') });
    for (const c of cmds) this.texts.push({ ...c, shadow: o.shadow !== false, dx: this.dx });
    return cmds.length;
  }
  /** text width in the 640x480 grid (what the menu engine centres with) */
  measure(font: number, text: string) { return measureText(this.fonts[font], text); }
  lineHeight(font: number) { return lineHeight(this.fonts[font]); }

  // ------------------------------------------------------------------------------------------ flush

  /** Draw everything queued since `begin()`; GL state is restored. Call after the 3D scene. */
  flush() {
    const gl = this.gl;
    // text layer -> quads
    const env = this.env, v = this.view;
    const textQuads = (cmds: (TextCmd & { shadow: boolean; dx: number })[]) => {
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i], f = this.fonts[cmd.font];
        if (!f) continue;
        const tex = this.fontTex[cmd.font].tex;
        const emit = (x: number, y: number, colour: number) => {
          for (const q of drawString(f, env, x, y, cmd.text, colour).quads) this.quad(2, MODE_SPRITE, tex, q.x0 + v.x + cmd.dx, q.y0 + v.y, q.x1 + v.x + cmd.dx, q.y1 + v.y, q.u0, q.v0, q.u1, q.v1, q.c);
        };
        if (cmd.shadow) emit(cmd.x + 2, cmd.y + 2, COLOUR_SHADOW);
        emit(cmd.x, cmd.y, cmd.colour);
      }
    };
    textQuads(this.texts);
    const total = this.layers[0].length + this.layers[1].length + this.layers[2].length;
    if (this.nv === 0 || total === 0) { this.texts = []; return; }

    // save state
    const saved = {
      prog: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      abuf: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
      active: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
      blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), scissor: gl.isEnabled(gl.SCISSOR_TEST), stencil: gl.isEnabled(gl.STENCIL_TEST),
      dither: gl.isEnabled(gl.DITHER),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
      colorMask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
      blendSrc: gl.getParameter(gl.BLEND_SRC_RGB) as number, blendDst: gl.getParameter(gl.BLEND_DST_RGB) as number,
      blendSrcA: gl.getParameter(gl.BLEND_SRC_ALPHA) as number, blendDstA: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
      blendEq: gl.getParameter(gl.BLEND_EQUATION_RGB) as number, blendEqA: gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    };
    gl.activeTexture(gl.TEXTURE0);
    const tex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(this.data, 0, this.nv * STRIDE), gl.STREAM_DRAW);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.DITHER);
    gl.depthMask(false); gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(this.uCanvas, this.cw, this.ch);
    gl.uniform1i(this.uTex, 0);
    for (const layer of this.layers) {
      for (const b of layer) {
        gl.bindTexture(gl.TEXTURE_2D, b.tex ?? this.white);
        gl.uniform1i(this.uMode, b.mode);
        gl.drawArrays(gl.TRIANGLES, b.first, b.count);
      }
    }

    // restore
    gl.bindTexture(gl.TEXTURE_2D, tex0);
    gl.activeTexture(saved.active);
    gl.bindVertexArray(saved.vao); gl.bindBuffer(gl.ARRAY_BUFFER, saved.abuf);
    gl.useProgram(saved.prog);
    gl.viewport(saved.viewport[0], saved.viewport[1], saved.viewport[2], saved.viewport[3]);
    const en = (cap: number, on: boolean) => (on ? gl.enable(cap) : gl.disable(cap));
    en(gl.BLEND, saved.blend); en(gl.DEPTH_TEST, saved.depth); en(gl.CULL_FACE, saved.cull); en(gl.SCISSOR_TEST, saved.scissor); en(gl.STENCIL_TEST, saved.stencil); en(gl.DITHER, saved.dither);
    gl.depthMask(saved.depthMask); gl.colorMask(saved.colorMask[0], saved.colorMask[1], saved.colorMask[2], saved.colorMask[3]);
    gl.blendFuncSeparate(saved.blendSrc, saved.blendDst, saved.blendSrcA, saved.blendDstA);
    gl.blendEquationSeparate(saved.blendEq, saved.blendEqA);
    this.nv = 0; this.layers = [[], [], []]; this.texts = []; this.cur = null;
  }
}

