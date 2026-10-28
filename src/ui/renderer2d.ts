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

// ---------------------------------------------------------------------------------------------------- textures

/** a UI texture: full size, CLAMP, bilinear, no mip maps (the UI textures are loaded with flag byte 0xffffff80) */
export interface UiTexture { tex: WebGLTexture; w: number; h: number }

function makeTexture(gl: WebGL2RenderingContext, rgba: Uint8Array, w: number, h: number): UiTexture {
  const tex = gl.createTexture()!;
  const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const prevAlign = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, prevAlign);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
        if (tg) { const im = parseTga(archive.read(tg)); list.push(makeTexture(gl, im.rgba, im.width, im.height)); continue; }
        const wb = archive.find(`${n}.wib`);
        if (wb) { const w = parseWib(archive.read(wb)); list.push(makeTexture(gl, w.frames[w.sequence[0] ?? 0], w.width, w.height)); continue; }
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
    return new UiTextureSet(gl, [makeTexture(gl, im.rgba, im.width, im.height)]);
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
  private texts: (TextCmd & { shadow: boolean })[] = [];
  private cur: Batch | null = null;
  private layer = 0;
  // letterbox state (FUN_0045f750 / FUN_0045f771)
  private lbMode = 0; private lbH = 0; private lbRate = 0;

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
    this.fontTex = data.map((d) => makeTexture(this.gl, d.image.rgba, d.image.width, d.image.height));
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
    this.nv = 0; this.layers = [[], [], []]; this.texts = []; this.cur = null; this.layer = 0;
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
    return { x0: x0 + v.x, y0: y0 + v.y, x1: x1 + v.x, y1: y1 + v.y, u0, u1, v0, v1 };
  }

  /**
   * Fade overlay (FUN_0040d1be, block 0x10): `a` = scene visibility 0..1 (1 = visible, 0 = black); a black quad over the WHOLE canvas with alpha 255 - a * 255.
   * Call it after the scene sprites and before the text of the frame. (The "frame is black while a == 0" rule is the caller's; a >= 1 draws nothing.)
   */
  fade(a: number) {
    const al = Math.trunc(255 - Math.max(0, Math.min(1, a)) * 255);
    if (al < 1) return;
    const c = (al << 24) >>> 0;
    this.quad(0, MODE_FADE, this.black, 0, 0, this.cw, this.ch, 0, 0, 1, 1, [c, c, c, c]);
  }
  /**
   * Cinematic bars (FUN_0045f750 / FUN_0045f7a8 / FUN_0045f8a1): `mode` 0 off, 1 top + bottom bar, 2 bottom bar only. The bar height grows by H / 30 per tick
   * (`dt` in 1/30 s ticks) up to 0.21875 H (H = canvas height); changing the mode restarts the animation. Black, over the whole canvas width.
   */
  letterbox(mode: 0 | 1 | 2, dt = 1) {
    if (mode !== this.lbMode) { this.lbMode = mode; this.lbH = 0; this.lbRate = this.ch / 30; }
    if (mode === 0) return;
    const max = this.ch * 0.4375 * 0.5;
    this.lbH += this.lbRate * dt;
    if (Math.trunc(this.lbH) >= max) { this.lbH = max; this.lbRate = 0; }
    const h = Math.trunc(this.lbH), H = Math.trunc(this.ch), W = Math.trunc(this.cw);
    const k = 0xff000000;
    if (mode === 1) this.quad(0, MODE_FLAT, this.white, 0, 0, W, h, 0, 0, 1, 1, [k, k, k, k]);
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
    for (const c of cmds) this.texts.push({ ...c, shadow: o.shadow !== false });
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
    const textQuads = (cmds: (TextCmd & { shadow: boolean })[]) => {
      for (let i = 0; i < cmds.length; i++) {
        const cmd = cmds[i], f = this.fonts[cmd.font];
        if (!f) continue;
        const tex = this.fontTex[cmd.font].tex;
        const emit = (x: number, y: number, colour: number) => {
          for (const q of drawString(f, env, x, y, cmd.text, colour).quads) this.quad(2, MODE_SPRITE, tex, q.x0 + v.x, q.y0 + v.y, q.x1 + v.x, q.y1 + v.y, q.u0, q.v0, q.u1, q.v1, q.c);
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

