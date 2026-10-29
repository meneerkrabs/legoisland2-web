// The particle draw pass (FX_Particle.c FUN_0044f380 + FUN_00887498): the sprites of the engine's draw list are culled, projected, sorted, built and clipped on the
// CPU exactly like the original (sprites.ts) and drawn as screen space triangle fans with the original's three state blocks:
//   material 0 -> block 6: colour = texture * vertex colour, alpha = texture alpha * vertex alpha, SRCALPHA / INVSRCALPHA
//   material 1 -> block 7: colour = vertex colour only (the texture is the shape), alpha = texture alpha * vertex alpha, SRCALPHA / ONE (additive glow)
//   material 2 -> block 3: colour = texture * vertex colour, alpha = texture alpha only, SRCALPHA / INVSRCALPHA
// all with the depth test (LEQUAL) and depth write ON, alpha test >= 1 / 255, no fog, no lighting, the sprite sheet `particle/Text000.tga` (8 x 8 sprites of 32 pixels).
//
// Time: the spin of a sprite advances once per game frame AFTER its draw (FUN_0044f4c0), only for sprites that were visible. The port draws once per rendered frame
// (interpolation), so `draw(viewProj, tick)` advances the spin of the sprites visible at the FIRST draw of a tick when the next tick starts.
import type { Archive } from '../../formats/archive.ts';
import type { Renderer, TexGpu } from '../../render/renderer.ts';
import type { Mat4 } from '../../render/math.ts';
import type { ParticleEngine } from './engine.ts';
import type { Particle } from './pool.ts';
import { AP } from './layout.ts';
import { buildQuad, clipPolygon, frustumPlanes, particlePos, projectPoint, sortSprites, spinStep, visibleFlags, VSTRIDE } from './sprites.ts';

const f32 = Math.fround;
const VS = `#version 300 es
layout(location=0) in vec4 aPos;      // x, y in pixels (y down), z 0..1, rhw
layout(location=1) in vec4 aCol;
layout(location=2) in vec2 aUv;
uniform vec2 uView;
out vec4 vCol;
out vec2 vUv;
void main(){
  float w = 1.0 / aPos.w;
  vec2 ndc = vec2(aPos.x / uView.x * 2.0 - 1.0, 1.0 - aPos.y / uView.y * 2.0);
  gl_Position = vec4(ndc * w, (aPos.z * 2.0 - 1.0) * w, w);
  vCol = aCol; vUv = aUv;
}`;
const FS = `#version 300 es
precision highp float;
in vec4 vCol; in vec2 vUv;
uniform sampler2D uTex;
uniform int uMat;
out vec4 o;
void main(){
  vec4 t = texture(uTex, vUv);
  vec3 c = uMat == 1 ? vCol.rgb : t.rgb * vCol.rgb;
  float a = uMat == 2 ? t.a : t.a * vCol.a;
  if (a < 0.5 / 255.0) discard;                      // ALPHATESTENABLE, ALPHAREF 1, ALPHAFUNC GREATEREQUAL
  o = vec4(c, a);
}`;

/** the viewport in the units the original projects with */
export interface DrawView { w: number; h: number }

export class ParticleDraw {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private ibo: WebGLBuffer;
  private uView: WebGLUniformLocation | null;
  private uMat: WebGLUniformLocation | null;
  private uTex: WebGLUniformLocation | null;
  private tex: TexGpu | null = null;
  private planes = new Float32Array(24);
  // scratch (grown on demand)
  private pts = new Float32Array(0);
  private idx = new Int32Array(0);
  private verts = new Float32Array(0);
  // deferred spin steps
  private pending: { p: Particle; gen: number }[] = [];
  private pendingDt = 1;
  private lastTick = -1;
  /** last frame's statistics */
  stats = { listed: 0, visible: 0, polygons: 0, draws: 0 };

  /** engine + 0x38 divisor: the zoom factor at creation (DAT_0089df2c when FUN_0044ec60 ran) */
  private zoom0: number;
  private renderer: Renderer; readonly engine: ParticleEngine; private archive: Archive; private dir: string;
  constructor(renderer: Renderer, engine: ParticleEngine, archive: Archive, dir = 'particle') {
    this.zoom0 = f32(engine.zoom); this.renderer = renderer; this.engine = engine; this.archive = archive; this.dir = dir;
    const gl = renderer.gl;
    this.gl = gl;
    const sh = (t: number, s: string) => { const x = gl.createShader(t)!; gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? 'shader'); return x; };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(this.prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) ?? 'link');
    this.uView = gl.getUniformLocation(this.prog, 'uView'); this.uMat = gl.getUniformLocation(this.prog, 'uMat'); this.uTex = gl.getUniformLocation(this.prog, 'uTex');
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!; this.ibo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 40, 16);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 40, 32);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bindVertexArray(null);
  }

  /** apply the spin steps owed from the previous tick (FUN_0044f4c0's update, after the draw of that frame) */
  private flushSpin(): void {
    for (const e of this.pending) if (e.p.gen === e.gen) spinStep(e.p, this.pendingDt);
    this.pending.length = 0;
  }

  /**
   * Draw the engine's particles. `viewProj` = view * projection of the frame (row vectors, GL clip space), `view` = the 3D area in pixels, `tick` = the game's
   * logic frame counter (the spin advances once per tick).
   */
  draw(viewProj: Mat4, view: DrawView, tick: number): void {
    const eng = this.engine;
    const list = eng.drawList;
    const newTick = tick !== this.lastTick;
    if (newTick) { this.flushSpin(); this.lastTick = tick; }
    this.stats.listed = list.length;
    if (!list.length) { this.stats.visible = 0; this.stats.polygons = 0; this.stats.draws = 0; return; }
    const W = view.w, H = view.h;
    // --- visibility (ComputeSphereVisibility) and projection (ProcessVertices)
    frustumPlanes(viewProj, this.planes);
    if (this.pts.length < list.length * 4) { this.pts = new Float32Array(list.length * 4 * 2); this.idx = new Int32Array(list.length * 2); }
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const [x, y, z] = particlePos(p);
      const fl = visibleFlags(this.planes, x, y, z, p.app.f[AP.SIZE]);
      if ((fl & 0xf) !== fl) continue;
      projectPoint(viewProj, x, y, z, W, H, this.pts, n * 4);
      this.idx[n] = i;
      n++;
    }
    this.stats.visible = n;
    // --- sort back to front (rhw ascending), build and clip the quads
    sortSprites(this.pts, this.idx, 0, n - 1);
    const zoom0 = this.zoom0;
    const invZoom = f32(1.0 / eng.zoom);
    // engine + 0x38 = viewport width at creation / zoom at creation: the 4:3 design width is used so that a wide window keeps the vertical size of the sprites
    const sizeScale = f32((H * 4 / 3) / zoom0);
    const need = n * 12 * VSTRIDE;
    if (this.verts.length < need) this.verts = new Float32Array(need * 2);
    const vi = new Int32Array(this.verts.buffer);
    const scr = new Float32Array(VSTRIDE * 24), scrI = new Int32Array(scr.buffer);
    const quad = new Float32Array(VSTRIDE * 24), quadI = new Int32Array(quad.buffer);
    // output: interleaved pos4, col4, uv2 per vertex
    const outCap = n * 8;
    const out = new Float32Array(outCap * 10);
    const ind = new Uint16Array(n * 8 * 3 * 2);
    let nv = 0, ni = 0;
    const runs: { mat: number; first: number; count: number }[] = [];
    const rect = { left: 0, top: 0, right: W, bottom: H };
    for (let k = 0; k < n; k++) {
      const p = list[this.idx[k]];
      buildQuad(p, this.pts.subarray(k * 4, k * 4 + 4), invZoom, sizeScale, eng.ps, quad, quadI, 0);
      const cnt = clipPolygon(quad, quadI, 0, scr, scrI, rect);
      if (cnt === 0) continue;
      const mat = p.app.i[AP.MATERIAL];
      const base = nv;
      for (let v = 0; v < cnt; v++) {
        const o = v * VSTRIDE, d = (nv + v) * 10;
        out[d] = quad[o]; out[d + 1] = quad[o + 1]; out[d + 2] = quad[o + 2]; out[d + 3] = quad[o + 3];
        const c = quadI[o + 4] >>> 0;
        out[d + 4] = ((c >>> 16) & 255) / 255; out[d + 5] = ((c >>> 8) & 255) / 255; out[d + 6] = (c & 255) / 255; out[d + 7] = ((c >>> 24) & 255) / 255;
        out[d + 8] = quad[o + 5]; out[d + 9] = quad[o + 6];
      }
      nv += cnt;
      const first = ni;
      for (let t = 1; t + 1 < cnt; t++) { ind[ni++] = base; ind[ni++] = base + t; ind[ni++] = base + t + 1; }
      const last = runs[runs.length - 1];
      if (last && last.mat === mat) last.count += ni - first; else runs.push({ mat, first, count: ni - first });
    }
    this.stats.polygons = runs.reduce((s, r) => s + r.count / 3, 0);
    this.stats.draws = runs.length;
    if (newTick && !eng.paused) { this.pending = []; for (let k = 0; k < n; k++) { const p = list[this.idx[k]]; this.pending.push({ p, gen: p.gen }); } this.pendingDt = eng.dt; }
    if (!runs.length) return;
    this.submit(out.subarray(0, nv * 10), ind.subarray(0, ni), runs, W, H);
    void vi;
  }

  private submit(verts: Float32Array, inds: Uint16Array, runs: { mat: number; first: number; count: number }[], W: number, H: number): void {
    const gl = this.gl, r = this.renderer;
    if (!this.tex) this.tex = r.texture(this.archive, 0, this.dir);
    if (!this.tex) return;
    const prog = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const cull = gl.isEnabled(gl.CULL_FACE);
    gl.useProgram(this.prog);
    gl.uniform2f(this.uView, W, H);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.tex);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, inds, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    let last = -1;
    for (const run of runs) {
      if (run.mat !== last) {
        last = run.mat;
        // material 0 -> block 6, 1 -> block 7 (additive), 2 -> block 3 (anything else keeps the previous block in the original)
        if (run.mat === 1) gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform1i(this.uMat, run.mat);
      }
      gl.drawElements(gl.TRIANGLES, run.count, gl.UNSIGNED_SHORT, run.first * 2);
    }
    gl.bindVertexArray(null);
    gl.useProgram(prog);
    if (cull) gl.enable(gl.CULL_FACE);
  }
}
