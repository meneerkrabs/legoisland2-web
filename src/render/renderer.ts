// WebGL2 renderer for game meshes. Reproduces the render-state model of the original Direct3D 7 renderer (docs/re/rendering.md):
//   * state presets (blend / alpha test / depth / colour+alpha combine) selected per mesh draw `mode`, see states.ts
//   * CPU-style Gouraud lighting (directional lights + ambient, evaluated per vertex), see lighting.ts
//   * linear fog by view depth, bilinear filtering of single-level textures (no mipmaps by default), per-texture wrap/clamp
//   * animated textures (.wib) stepping at the game's 30 Hz
// Game convention: left-handed, +Y up, row-vector matrices (see math.ts).
import { parseMsh, groupMatrices } from '../formats/msh.ts';
import type { Msh } from '../formats/msh.ts';
import { parseTga } from '../formats/tga.ts';
import { parseWib } from '../formats/wib.ts';
import type { Archive } from '../formats/archive.ts';
import type { Mat4 } from './math.ts';
import { PRESETS, modePreset } from './states.ts';
import type { Preset } from './states.ts';
import { MAX_DIRECTIONAL, defaultLights } from './lighting.ts';
import type { LightSet } from './lighting.ts';
import { GAME_TICK } from './camera.ts';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
uniform mat4 uMVP;
uniform mat4 uWorld;
uniform float uLit;
uniform vec3 uAmbient;
uniform int uNumLights;
uniform vec3 uLightDir[${MAX_DIRECTIONAL}];
uniform vec3 uLightCol[${MAX_DIRECTIONAL}];
out vec2 vUv;
out vec3 vLit;
out float vDepth;
void main(){
  vec4 p = uMVP * vec4(aPos,1.0);
  gl_Position = p;
  vUv = aUv;
  vDepth = p.w;
  vec3 c = vec3(1.0);
  if (uLit > 0.5) {
    // game lighting (Lights.cpp FUN_00885a9a): per colour channel acc += (1-acc) * max(N.L,0) * diffuse, result = max(acc, ambient)
    vec3 n = normalize(mat3(uWorld) * aNrm);
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${MAX_DIRECTIONAL}; i++) {
      if (i >= uNumLights) break;
      float d = max(dot(n, uLightDir[i]), 0.0);
      acc = acc + (vec3(1.0) - acc) * d * uLightCol[i];
    }
    c = max(acc, uAmbient);
  }
  vLit = c;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vLit; in float vDepth;
uniform sampler2D uTex;
uniform float uUseTex;      // 0: untextured group, uFlat is used as the texel
uniform vec3 uFlat;
uniform int uColorOp;       // 0 texture, 1 texture * vertex colour, 2 vertex colour
uniform int uAlphaOp;       // 0 one, 1 texture alpha, 2 texture * vertex alpha, 3 vertex alpha, 4 modulate 4x
uniform vec4 uTint;         // vertex colour of unlit presets (rgb) and vertex alpha (a)
uniform float uLit;
uniform float uHighlight;
uniform float uFogOn;
uniform vec3 uFog;
uniform vec2 uFogRange;     // start, end (view depth)
uniform float uAdditive;
out vec4 o;
void main(){
  vec4 t = uUseTex > 0.5 ? texture(uTex, vUv) : vec4(uFlat, 1.0);
  vec3 vc = uLit > 0.5 ? vLit : uTint.rgb;
  float va = uTint.a;
  vec3 col = uColorOp == 0 ? t.rgb : (uColorOp == 1 ? t.rgb * vc : vc);
  float a = uAlphaOp == 0 ? 1.0 : (uAlphaOp == 1 ? t.a : (uAlphaOp == 2 ? t.a * va : (uAlphaOp == 3 ? va : min(t.a * va * 4.0, 1.0))));
  if (a < 0.5 / 255.0) discard;                       // ALPHATESTENABLE, ALPHAREF 1, ALPHAFUNC GREATEREQUAL
  col = mix(col, vec3(1.0, 0.9, 0.2), uHighlight * 0.35);
  if (uFogOn > 0.5) {
    float f = clamp((uFogRange.y - vDepth) / max(uFogRange.y - uFogRange.x, 1e-3), 0.0, 1.0);
    col = mix(uAdditive > 0.5 ? vec3(0.0) : uFog, col, f);
  }
  o = vec4(col, a);
}`;
const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
void main(){ gl_Position = uMVP * vec4(aPos,1.0); }`;
const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 o;
void main(){ o = uColor; }`;

export interface MeshGpu {
  msh: Msh;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  /** per group: first index in the (32-bit) index buffer and count */
  groups: { first: number; count: number; flags: number; mat: Mat4 | null }[];
  min: number[]; max: number[]; center: number[]; radius: number;
  triangles: number;
}
export interface TexAnim {
  /** RGBA frames */
  frames: Uint8Array[];
  /** playback order (indices into frames), one entry per 1/30 s */
  sequence: Uint32Array;
  timer: number;
  current: number;
}
export interface TexGpu { tex: WebGLTexture; soft: boolean; cutout: boolean; w: number; h: number; frames: number; anim?: TexAnim; mips: boolean }

export interface FogState { enabled: boolean; color: [number, number, number]; start: number; end: number }

export interface DrawOpts {
  /** part draw mode 0..7 (states.ts modePreset); default 0 */
  mode?: number;
  /** state preset (0..29) overriding the mode */
  preset?: number;
  highlight?: boolean;
  /** colour of untextured groups */
  flat?: number[] | null;
  /** vertex colour of unlit presets and vertex alpha (particles, fades); default opaque white */
  tint?: [number, number, number, number];
  /** which draw passes to run: all three in order (the game's behaviour), or one of 0 / 1 / 2 */
  pass?: 'all' | 0 | 1 | 2;
}

function mul4(a: Mat4, b: Mat4, out: Mat4): Mat4 {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return out;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (t: number, s: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader'); return sh; };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

const COLOR_OP = { tex: 0, mod: 1, diffuse: 2 } as const;
const ALPHA_OP = { one: 0, tex: 1, mod: 2, diffuse: 3, mod4x: 4 } as const;

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private lineProg: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private ul: Record<string, WebGLUniformLocation | null> = {};
  private white: WebGLTexture;
  private boxVao: WebGLVertexArrayObject;
  private meshes = new Map<string, MeshGpu | null>();
  private textures = new Map<string, TexGpu | null>();
  private txl = new Map<string, Uint8Array | null>();
  private animated = new Set<TexGpu>();
  private viewProj: Mat4 = new Float32Array(16);
  /** culling: 0 none, 1 back faces culled; `cwFront` = clockwise triangles are front faces (Direct3D CULLMODE_CCW) */
  cull = 1;
  cwFront = true;
  /** the game creates textures without mip chains (TextureManager.cpp FUN_004100a1); true = generate mipmaps (smoother, not the original look) */
  mipmaps = false;
  fog: FogState = { enabled: false, color: [0, 0, 0], start: 0, end: 1e6 };
  lights: LightSet = defaultLights();
  stats = { draws: 0, triangles: 0 };

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.prog = compile(gl, VS, FS);
    this.lineProg = compile(gl, LINE_VS, LINE_FS);
    for (const n of ['uMVP', 'uWorld', 'uTex', 'uUseTex', 'uFlat', 'uColorOp', 'uAlphaOp', 'uTint', 'uLit', 'uHighlight', 'uFogOn', 'uFog', 'uFogRange', 'uAdditive', 'uAmbient', 'uNumLights', 'uLightDir', 'uLightCol']) this.u[n] = gl.getUniformLocation(this.prog, n);
    for (const n of ['uMVP', 'uColor']) this.ul[n] = gl.getUniformLocation(this.lineProg, n);
    this.white = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    // unit cube wireframe
    this.boxVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.boxVao);
    const pts: number[] = [];
    const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) pts.push(...c[a], ...c[b]);
    const bb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, bb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.gl.viewport(0, 0, w, h);
  }

  clearCaches() {
    const gl = this.gl;
    for (const m of this.meshes.values()) if (m) { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); }
    for (const t of this.textures.values()) if (t) gl.deleteTexture(t.tex);
    this.meshes.clear(); this.textures.clear(); this.txl.clear(); this.animated.clear();
  }

  mesh(archive: Archive, member: string): MeshGpu | null {
    const key = `${archive.name}/${member.toLowerCase()}`;
    if (this.meshes.has(key)) return this.meshes.get(key)!;
    let g: MeshGpu | null = null;
    const e = archive.find(member);
    if (e) {
      try { g = this.upload(parseMsh(archive.read(e))); } catch (err) { console.warn('mesh', member, err); }
    }
    this.meshes.set(key, g);
    return g;
  }

  /** upload an already parsed (possibly modified, e.g. skinned) mesh */
  uploadMesh(msh: Msh): MeshGpu { return this.upload(msh); }

  private upload(msh: Msh): MeshGpu {
    const gl = this.gl;
    const n = msh.vertexCount;
    const vb = new Float32Array(n * 8);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { const v = msh.positions[i * 3 + k]; vb[i * 8 + k] = v; vb[i * 8 + 3 + k] = msh.normals[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
      vb[i * 8 + 6] = msh.uvs[i * 2]; vb[i * 8 + 7] = msh.uvs[i * 2 + 1];
    }
    const idx = new Uint32Array(msh.indices.length);
    const groups: { first: number; count: number; flags: number; mat: Mat4 | null }[] = [];
    const gm = groupMatrices(msh);
    for (const [gi, g] of msh.groups.entries()) {
      for (let i = g.firstIndex; i < g.firstIndex + g.indexCount; i++) idx[i] = msh.indices[i] + g.firstVertex;
      groups.push({ first: g.firstIndex, count: g.indexCount, flags: g.flags & 0x7f, mat: gm[gi] });
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const b1 = gl.createBuffer()!, b2 = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b1);
    gl.bufferData(gl.ARRAY_BUFFER, vb, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b2);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    if (!n) { min.fill(0); max.fill(0); }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
    return { msh, vao, buffers: [b1, b2], groups, min, max, center, radius, triangles: idx.length / 3 };
  }

  /** per-texture flag bytes of <dir>/text.txl ("TEXT", u32 n, n bytes): bit0 = U wraps (else clamps), bit1 = V wraps (else clamps) */
  private textureFlags(archive: Archive, dir: string): Uint8Array | null {
    const key = `${archive.name}/${dir}`;
    if (!this.txl.has(key)) {
      let f: Uint8Array | null = null;
      const e = archive.find(`${dir}/text.txl`);
      if (e) { const d = archive.read(e); const n = d[4] | (d[5] << 8) | (d[6] << 16) | (d[7] << 24); f = d.subarray(8, 8 + n); }
      this.txl.set(key, f);
    }
    return this.txl.get(key)!;
  }

  /** texture number -> GL texture (from <archive>/textures/TextNNN.tga or .wib) */
  texture(archive: Archive, id: number, dir = 'textures'): TexGpu | null {
    if (id < 0) return null;
    const key = `${archive.name}/${dir}/${id}`;
    if (this.textures.has(key)) return this.textures.get(key)!;
    const gl = this.gl;
    const num = String(id).padStart(3, '0');
    let t: TexGpu | null = null;
    try {
      let rgba: Uint8Array | null = null, w = 0, h = 0, frames = 1;
      let anim: TexAnim | undefined;
      const tg = archive.find(`${dir}/Text${num}.tga`);
      if (tg) { const im = parseTga(archive.read(tg)); rgba = im.rgba; w = im.width; h = im.height; }
      else {
        const wb = archive.find(`${dir}/Text${num}.wib`);
        if (wb) {
          const wi = parseWib(archive.read(wb));
          rgba = wi.frames[wi.sequence[0] ?? 0]; w = wi.width; h = wi.height; frames = wi.frameCount;
          // the 16-frame sheets with the identity sequence are expression sheets (faces): the game freezes them on one frame (FUN_00411202); only real animations play
          const sheet = wi.frameCount === 16 && wi.sequence.length === 16 && wi.sequence.every((v, i) => v === i);
          if (!sheet && wi.sequence.length > 1) anim = { frames: wi.frames, sequence: wi.sequence, timer: 0, current: wi.sequence[0] };
        }
      }
      if (rgba) {
        let soft = false, cutout = false;
        for (let i = 3; i < rgba.length; i += 4) { const a = rgba[i]; if (a === 0) cutout = true; else if (a !== 255) { soft = true; break; } }
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        if (this.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const fl = this.textureFlags(archive, dir)?.[id];
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, fl === undefined || (fl & 1) ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, fl === undefined || (fl & 2) ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        t = { tex, soft, cutout, w, h, frames, anim, mips: this.mipmaps };
        if (anim) this.animated.add(t);
      }
    } catch (e) { console.warn('texture', id, e); }
    this.textures.set(key, t);
    return t;
  }

  /** switch mip-mapping of all loaded and future textures (the game does not use mip maps) */
  setMipmaps(on: boolean) {
    if (on === this.mipmaps) return;
    this.mipmaps = on;
    const gl = this.gl;
    for (const t of this.textures.values()) if (t) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      if (on && !t.mips) { gl.generateMipmap(gl.TEXTURE_2D); t.mips = true; }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, on ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    }
  }

  /** Steps all animated (.wib) textures: one sequence entry per 1/30 s, looping (FUN_00410ff8 / FUN_004111a3 once per frame). `dt` in seconds */
  updateTextures(dt: number) {
    const gl = this.gl;
    for (const t of this.animated) {
      const a = t.anim!;
      a.timer += dt * GAME_TICK;
      if (a.timer >= a.sequence.length) a.timer %= a.sequence.length;
      const idx = a.sequence[Math.min(a.sequence.length - 1, Math.floor(a.timer))];
      if (idx !== a.current) {
        a.current = idx;
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, a.frames[idx]);
        if (t.mips) gl.generateMipmap(gl.TEXTURE_2D);
      }
    }
  }

  /**
   * Starts a frame: clears to `clear` (the zone's fog colour in the game), enables the depth buffer and sets the camera.
   * The caller provides view * projection (row-vector order: view first, then projection).
   */
  begin(clear: [number, number, number], viewProj: Mat4) {
    const gl = this.gl;
    this.resize();
    this.viewProj = viewProj;
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform1i(this.u.uTex, 0);
    this.uploadLights();
    gl.uniform1f(this.u.uFogOn, this.fog.enabled ? 1 : 0);
    gl.uniform3f(this.u.uFog, this.fog.color[0], this.fog.color[1], this.fog.color[2]);
    gl.uniform2f(this.u.uFogRange, this.fog.start, this.fog.end);
    if (this.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(this.cwFront ? gl.CW : gl.CCW); } else gl.disable(gl.CULL_FACE);
    this.stats.draws = 0; this.stats.triangles = 0;
  }

  private uploadLights() {
    const gl = this.gl, L = this.lights;
    const n = Math.min(L.directional.length, MAX_DIRECTIONAL);
    const dir = new Float32Array(MAX_DIRECTIONAL * 3), col = new Float32Array(MAX_DIRECTIONAL * 3);
    for (let i = 0; i < n; i++) { dir.set(L.directional[i].dir, i * 3); col.set(L.directional[i].color, i * 3); }
    gl.uniform3fv(this.u.uLightDir, dir);
    gl.uniform3fv(this.u.uLightCol, col);
    gl.uniform1i(this.u.uNumLights, n);
    gl.uniform3f(this.u.uAmbient, L.ambient[0], L.ambient[1], L.ambient[2]);
  }

  /** applies the blend / depth part of a state preset (the colour / alpha combine is done in the shader) */
  private applyPreset(p: Preset) {
    const gl = this.gl;
    if (p.z) { gl.enable(gl.DEPTH_TEST); gl.depthMask(true); } else { gl.disable(gl.DEPTH_TEST); gl.depthMask(false); }
    switch (p.blend) {
      case 'off': gl.disable(gl.BLEND); break;
      case 'alpha': gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); break;
      case 'add': gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); break;
      case 'alphaAlpha': gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.SRC_ALPHA); break;
    }
    gl.uniform1i(this.u.uColorOp, COLOR_OP[p.colorOp]);
    gl.uniform1i(this.u.uAlphaOp, ALPHA_OP[p.alphaOp]);
    gl.uniform1f(this.u.uAdditive, p.blend === 'add' ? 1 : 0);
    gl.uniform1f(this.u.uLit, p.colorOp === 'mod' ? 1 : 0);
  }

  /**
   * Draw a mesh the way the game does (FUN_0088aca2): one state preset for the whole mesh, then three passes over the groups:
   * pass 0 draws the groups whose flags are 0, pass 1 those with flags 1, pass 2 everything else. texOf(group) gives the texture of each group
   * (null = untextured). Objects are drawn one after the other in record order, so a caller that wants the game's result must not reorder passes across objects.
   */
  drawMesh(m: MeshGpu, world: Mat4, texOf: (g: number) => TexGpu | null | undefined, o: DrawOpts = {}) {
    const gl = this.gl;
    const preset = PRESETS[o.preset ?? modePreset(o.mode ?? 0)];
    this.applyPreset(preset);
    const tint = o.tint ?? [1, 1, 1, 1];
    gl.uniform4f(this.u.uTint, tint[0], tint[1], tint[2], tint[3]);
    gl.uniform1f(this.u.uHighlight, o.highlight ? 1 : 0);
    const mvp = new Float32Array(16), w2 = new Float32Array(16), viewProj = this.viewProj;
    gl.bindVertexArray(m.vao);
    const passes: (0 | 1 | 2)[] = o.pass === undefined || o.pass === 'all' ? [0, 1, 2] : [o.pass];
    for (const pass of passes) {
      let lastMat: Mat4 | null | undefined;
      for (let g = 0; g < m.groups.length; g++) {
        const grp = m.groups[g];
        if (!grp.count) continue;
        const gpass = grp.flags >= 2 ? 2 : grp.flags;
        if (gpass !== pass) continue;
        if (lastMat === undefined || lastMat !== grp.mat) {
          lastMat = grp.mat;
          const wm = grp.mat ? mul4(grp.mat, world, w2) : world;
          for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mvp[r * 4 + c] = wm[r * 4] * viewProj[c] + wm[r * 4 + 1] * viewProj[4 + c] + wm[r * 4 + 2] * viewProj[8 + c] + wm[r * 4 + 3] * viewProj[12 + c];
          gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
          gl.uniformMatrix4fv(this.u.uWorld, false, wm);
        }
        const t = texOf(g);
        gl.activeTexture(gl.TEXTURE0);
        if (t) {
          gl.bindTexture(gl.TEXTURE_2D, t.tex);
          gl.uniform1f(this.u.uUseTex, 1);
        } else {
          gl.bindTexture(gl.TEXTURE_2D, this.white);
          gl.uniform1f(this.u.uUseTex, 0);
          const c = o.flat ?? [0.62, 0.64, 0.7];
          gl.uniform3f(this.u.uFlat, c[0], c[1], c[2]);
        }
        gl.drawElements(gl.TRIANGLES, grp.count, gl.UNSIGNED_INT, grp.first * 4);
        this.stats.draws++; this.stats.triangles += grp.count / 3;
      }
    }
    gl.bindVertexArray(null);
  }

  /** wireframe box in object space (min..max) transformed by world */
  drawBox(world: Mat4, min: number[], max: number[], color = [1, 0.9, 0.2, 1]) {
    const gl = this.gl, viewProj = this.viewProj;
    // scale/translate unit cube into [min,max] then world
    const s = new Float32Array(16);
    s[0] = max[0] - min[0] || 0.01; s[5] = max[1] - min[1] || 0.01; s[10] = max[2] - min[2] || 0.01; s[12] = min[0]; s[13] = min[1]; s[14] = min[2]; s[15] = 1;
    const tmp = new Float32Array(16), mvp = new Float32Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) tmp[r * 4 + c] = s[r * 4] * world[c] + s[r * 4 + 1] * world[4 + c] + s[r * 4 + 2] * world[8 + c] + s[r * 4 + 3] * world[12 + c];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mvp[r * 4 + c] = tmp[r * 4] * viewProj[c] + tmp[r * 4 + 1] * viewProj[4 + c] + tmp[r * 4 + 2] * viewProj[8 + c] + tmp[r * 4 + 3] * viewProj[12 + c];
    gl.useProgram(this.lineProg);
    gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(this.ul.uMVP, false, mvp);
    gl.uniform4f(this.ul.uColor, color[0], color[1], color[2], color[3]);
    gl.bindVertexArray(this.boxVao);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.prog);
    if (this.cull) gl.enable(gl.CULL_FACE);
  }
}
