// A turntable viewer for the model gallery: its OWN small canvas with its OWN `Renderer` (src/render/renderer.ts), so it never touches the game's GL context (state, caches,
// lights). Auto-rotating camera around the model, mouse-drag orbit, wheel zoom. The model is drawn with the game's own draw path (`Renderer.drawMesh`, the same state
// presets and lighting as in play); the lights are the renderer's defaults, the look is therefore "bij benadering" (the zones' own light sets are not applied).
// Port extension (not in the original): the whole viewer. Only DOM + GL; the data side is in modellen.ts / gallery-*.ts.
import { Renderer } from '../render/renderer.ts';
import type { MeshGpu, TexGpu } from '../render/renderer.ts';
import { identity, lookDirLH, mul, perspectiveLH } from '../render/math.ts';
import type { LightSet } from '../render/lighting.ts';

export interface TurnSubject {
  /** the mesh to draw (null: only the collision lines) */
  mesh: MeshGpu | null;
  /** texture of group g (null = flat colour of that group) */
  texOf?: (g: number) => TexGpu | null;
  /** draw state: a state preset 0..29 (states.ts) instead of the part mode */
  preset?: number;
  mode?: number;
  /** collision wireframe: 6 floats per line segment, mesh space */
  lines?: Float32Array | null;
  /** bounds when there is no mesh (lines only) */
  min?: number[]; max?: number[];
}

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
void main(){ gl_Position = uMVP * vec4(aPos,1.0); }`;
const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 o;
void main(){ o = uColor; }`;

/** a studio light set instead of the renderer's fullbright default: a little ambient and one directional light (the light stays fixed while the camera orbits) */
const STUDIO: LightSet = { ambient: [0.55, 0.55, 0.55], directional: [], point: [], list: [{ kind: 1, pos: [0, 0, 0], dir: [-0.45, -0.75, -0.5], color: [0.65, 0.65, 0.65], range: 1 }, { kind: 0, pos: [0, 0, 0], dir: [0, 0, 0], color: [0.55, 0.55, 0.55], range: 1 }] };

/** group colours of the flat mode (the research's contact-sheet palette) */
const PALETTE: [number, number, number][] = [[220, 90, 80], [90, 170, 230], [240, 200, 70], [110, 210, 120], [200, 120, 220], [240, 150, 60], [160, 160, 170], [90, 220, 200]];

export class Turntable {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  yaw = 0.6; pitch = 0.4; zoom = 1;
  auto = true;
  showBox = true;
  showLines = false;
  /** false = both sides of every triangle are drawn (some leftovers have the wrong winding) */
  cull = true;
  subject: TurnSubject | null = null;
  frames = 0;
  private raf = 0;
  private last = 0;
  private flat: TexGpu[] = [];
  private prog: WebGLProgram;
  private uMvp: WebGLUniformLocation | null;
  private uCol: WebGLUniformLocation | null;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private lineN = 0;
  private lineFor: Float32Array | null = null;
  private dragging = false;
  private dragX = 0; private dragY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.renderer.lights = STUDIO;
    const gl = this.renderer.gl;
    const mk = (t: number, s: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, mk(gl.VERTEX_SHADER, LINE_VS)); gl.attachShader(this.prog, mk(gl.FRAGMENT_SHADER, LINE_FS));
    gl.linkProgram(this.prog);
    this.uMvp = gl.getUniformLocation(this.prog, 'uMVP'); this.uCol = gl.getUniformLocation(this.prog, 'uColor');
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    // one 1x1 texture per palette colour: flat group colours through the normal texture path
    for (const c of PALETTE) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([c[0], c[1], c[2], 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.flat.push({ tex, soft: false, cutout: false, w: 1, h: 1, frames: 1, mips: false });
    }
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.dragX = e.clientX; this.dragY = e.clientY; canvas.setPointerCapture(e.pointerId); canvas.focus(); });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.dragX) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - this.dragY) * 0.01));
      this.dragX = e.clientX; this.dragY = e.clientY;
    });
    const up = (e: PointerEvent) => { this.dragging = false; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.15, Math.min(8, this.zoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    canvas.addEventListener('dblclick', () => { this.auto = !this.auto; });
  }

  /** a group-colour texture for group `g` (the flat look) */
  flatTexture(g: number): TexGpu { return this.flat[g % this.flat.length]; }

  setSubject(s: TurnSubject | null) {
    this.subject = s;
    this.lineFor = null;
    this.zoom = 1;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      if (!this.canvas.isConnected || this.canvas.clientWidth === 0) return;
      const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      if (this.auto && !this.dragging) this.yaw += dt * 0.6;
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  get running() { return this.raf !== 0; }

  private bounds(): { c: number[]; r: number } {
    const s = this.subject;
    const mn = s?.mesh?.min ?? s?.min ?? [-1, -1, -1], mx = s?.mesh?.max ?? s?.max ?? [1, 1, 1];
    const c = [0, 1, 2].map((k) => (mn[k] + mx[k]) / 2);
    const r = Math.max(1e-3, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
    return { c, r };
  }

  /** draw one frame (also callable by hand, e.g. after a state change while the loop is stopped) */
  draw() {
    const r = this.renderer, gl = r.gl;
    const s = this.subject;
    const { c, r: rad } = this.bounds();
    const fov = (40 * Math.PI) / 180, dist = (rad / Math.sin(fov / 2)) * 1.05 * this.zoom;
    const cp = Math.cos(this.pitch);
    const eye = [c[0] + dist * cp * Math.sin(this.yaw), c[1] + dist * Math.sin(this.pitch), c[2] + dist * cp * Math.cos(this.yaw)];
    const view = lookDirLH(eye, [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]]);
    r.resize();
    const aspect = r.aspect;
    const proj = perspectiveLH(fov, aspect, Math.max(0.01, dist - rad * 1.5) * 0.5, dist + rad * 4);
    const viewProj = mul(view, proj);
    r.cull = this.cull ? 1 : 0;
    r.fog = { enabled: false, color: [0, 0, 0], start: 0, end: 1e6 };
    r.begin([0.07, 0.1, 0.2], viewProj);
    const world = identity();
    if (s?.mesh) {
      r.drawMesh(s.mesh, world, (g) => s.texOf?.(g) ?? this.flat[g % this.flat.length], { mode: s.mode, preset: s.preset });
      if (this.showBox) r.drawBox(world, s.mesh.min, s.mesh.max, [0.35, 0.5, 0.9, 1]);
    } else if (s && s.min && s.max && this.showBox) r.drawBox(world, s.min, s.max, [0.35, 0.5, 0.9, 1]);
    if (s?.lines && this.showLines) this.drawLines(s.lines, viewProj);
    this.frames++;
    void gl;
  }

  private drawLines(lines: Float32Array, viewProj: Float32Array) {
    const gl = this.renderer.gl;
    if (this.lineFor !== lines) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      this.lineN = lines.length / 3;
      this.lineFor = lines;
    }
    gl.useProgram(this.prog);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(this.uMvp, false, viewProj);
    gl.uniform4f(this.uCol, 0.2, 1, 0.9, 1);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.LINES, 0, this.lineN);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
  }

  /** forget GPU meshes / textures of the previous subjects (called when many models were browsed) */
  clearCaches() { this.renderer.clearCaches(); }
}

/** the edges of the collision triangles (9 floats per triangle in, 18 floats per triangle out: three segments) */
export function wireOfTriangles(tri: Float32Array): Float32Array {
  const n = tri.length / 9, out = new Float32Array(n * 18);
  for (let t = 0; t < n; t++) {
    const o = t * 18, i = t * 9;
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
      out.set([tri[a], tri[a + 1], tri[a + 2], tri[b], tri[b + 1], tri[b + 2]], o + e * 6);
    }
  }
  return out;
}
