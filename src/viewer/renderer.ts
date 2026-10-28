// WebGL2 renderer for game meshes (game convention: left-handed, +Y up, row-vector matrices).
import { parseMsh, groupMatrices } from '../formats/msh.ts';
import type { Msh } from '../formats/msh.ts';
import { parseTga } from '../formats/tga.ts';
import { parseWib } from '../formats/wib.ts';
import type { Archive } from '../formats/archive.ts';
import type { Mat4 } from './math.ts';

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
uniform mat4 uMVP;
uniform mat4 uWorld;
out vec2 vUv;
out vec3 vN;
out float vDepth;
void main(){
  vec4 p = uMVP * vec4(aPos,1.0);
  gl_Position = p;
  vUv = aUv;
  vN = mat3(uWorld) * aNrm;
  vDepth = p.w;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vN; in float vDepth;
uniform sampler2D uTex;
uniform vec4 uColor;      // multiplied; used for untextured groups
uniform float uUseTex;
uniform float uCutoff;
uniform float uHighlight;
uniform vec3 uFog;
uniform vec2 uFogRange;
out vec4 o;
void main(){
  vec4 c = uUseTex > 0.5 ? texture(uTex, vUv) : vec4(1.0);
  if (c.a < uCutoff) discard;
  vec3 n = normalize(vN);
  float l = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.35,0.8,-0.45))), 0.0) + 0.15 * n.y;
  vec3 rgb = c.rgb * uColor.rgb * l;
  rgb = mix(rgb, vec3(1.0,0.9,0.2), uHighlight*0.35);
  float f = clamp((vDepth - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  o = vec4(mix(rgb, uFog, f), c.a * uColor.a);
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
export interface TexGpu { tex: WebGLTexture; soft: boolean; cutout: boolean; w: number; h: number; frames: number }

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
  /** frontFace choice for the game's winding; cull: 0 none, 1 back faces culled */
  cull = 1;
  cwFront = true;
  fog: [number, number] = [4000, 9000];
  stats = { draws: 0, triangles: 0 };

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.prog = compile(gl, VS, FS);
    this.lineProg = compile(gl, LINE_VS, LINE_FS);
    for (const n of ['uMVP', 'uWorld', 'uTex', 'uColor', 'uUseTex', 'uCutoff', 'uHighlight', 'uFog', 'uFogRange']) this.u[n] = gl.getUniformLocation(this.prog, n);
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
    this.meshes.clear(); this.textures.clear(); this.txl.clear();
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
      const tg = archive.find(`${dir}/Text${num}.tga`);
      if (tg) { const im = parseTga(archive.read(tg)); rgba = im.rgba; w = im.width; h = im.height; }
      else {
        const wb = archive.find(`${dir}/Text${num}.wib`);
        if (wb) { const wi = parseWib(archive.read(wb)); rgba = wi.frames[wi.sequence[0] ?? 0]; w = wi.width; h = wi.height; frames = wi.frameCount; }
      }
      if (rgba) {
        let soft = false, cutout = false;
        for (let i = 3; i < rgba.length; i += 4) { const a = rgba[i]; if (a === 0) cutout = true; else if (a !== 255) { soft = true; break; } }
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        const fl = this.textureFlags(archive, dir)?.[id];
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, fl === undefined || (fl & 1) ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, fl === undefined || (fl & 2) ? gl.REPEAT : gl.CLAMP_TO_EDGE);
        t = { tex, soft, cutout, w, h, frames };
      }
    } catch (e) { console.warn('texture', id, e); }
    this.textures.set(key, t);
    return t;
  }

  begin(clear: [number, number, number]) {
    const gl = this.gl;
    this.resize();
    gl.clearColor(clear[0], clear[1], clear[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform3f(this.u.uFog, clear[0], clear[1], clear[2]);
    gl.uniform2f(this.u.uFogRange, this.fog[0], this.fog[1]);
    if (this.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.frontFace(this.cwFront ? gl.CW : gl.CCW); } else gl.disable(gl.CULL_FACE);
    this.stats.draws = 0; this.stats.triangles = 0;
  }

  /**
   * Draw the groups of a mesh that belong to draw pass `pass` (the game draws group flags 0, 1, >=2 in three
   * successive passes per object; here groups with flags 0 and a translucent texture join pass 1).
   * texOf(group) gives the texture of each group (null = untextured).
   */
  drawMesh(m: MeshGpu, world: Mat4, viewProj: Mat4, texOf: (g: number) => TexGpu | null | undefined, pass: number, highlight = false, flat: number[] | null = null) {
    const gl = this.gl;
    const mvp = new Float32Array(16), w2 = new Float32Array(16);
    gl.uniform1f(this.u.uHighlight, highlight ? 1 : 0);
    gl.bindVertexArray(m.vao);
    let lastMat: Mat4 | null | undefined;
    for (let g = 0; g < m.groups.length; g++) {
      const grp = m.groups[g];
      if (!grp.count) continue;
      const t = texOf(g);
      const soft = !!t && t.soft;
      const gpass = grp.flags >= 2 ? 2 : grp.flags === 1 || soft ? 1 : 0;
      if (gpass !== pass) continue;
      if (lastMat === undefined || lastMat !== grp.mat) {
        lastMat = grp.mat;
        const wm = grp.mat ? mul4(grp.mat, world, w2) : world;
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mvp[r * 4 + c] = wm[r * 4] * viewProj[c] + wm[r * 4 + 1] * viewProj[4 + c] + wm[r * 4 + 2] * viewProj[8 + c] + wm[r * 4 + 3] * viewProj[12 + c];
        gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
        gl.uniformMatrix4fv(this.u.uWorld, false, wm);
      }
      gl.activeTexture(gl.TEXTURE0);
      if (t) {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.uniform1f(this.u.uUseTex, 1);
        gl.uniform4f(this.u.uColor, 1, 1, 1, 1);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.white);
        gl.uniform1f(this.u.uUseTex, 0);
        const c = flat ?? [0.62, 0.64, 0.7];
        gl.uniform4f(this.u.uColor, c[0], c[1], c[2], 1);
      }
      gl.uniform1f(this.u.uCutoff, soft ? 0.02 : 0.5);
      if (soft) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
      gl.drawElements(gl.TRIANGLES, grp.count, gl.UNSIGNED_INT, grp.first * 4);
      this.stats.draws++; this.stats.triangles += grp.count / 3;
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** wireframe box in object space (min..max) transformed by world */
  drawBox(world: Mat4, viewProj: Mat4, min: number[], max: number[], color = [1, 0.9, 0.2, 1]) {
    const gl = this.gl;
    // scale/translate unit cube into [min,max] then world
    const s = new Float32Array(16);
    s[0] = max[0] - min[0] || 0.01; s[5] = max[1] - min[1] || 0.01; s[10] = max[2] - min[2] || 0.01; s[12] = min[0]; s[13] = min[1]; s[14] = min[2]; s[15] = 1;
    const tmp = new Float32Array(16), mvp = new Float32Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) tmp[r * 4 + c] = s[r * 4] * world[c] + s[r * 4 + 1] * world[4 + c] + s[r * 4 + 2] * world[8 + c] + s[r * 4 + 3] * world[12 + c];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mvp[r * 4 + c] = tmp[r * 4] * viewProj[c] + tmp[r * 4 + 1] * viewProj[4 + c] + tmp[r * 4 + 2] * viewProj[8 + c] + tmp[r * 4 + 3] * viewProj[12 + c];
    gl.useProgram(this.lineProg);
    gl.disable(gl.CULL_FACE); gl.disable(gl.DEPTH_TEST);
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
