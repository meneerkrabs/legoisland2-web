// Browser-side drawing of one game frame: interpolated chase camera, records in record order (LOD, textures, sky / sea specials), CPU-skinned
// animated characters with their attachments, and Pepper's blob shadow (docs/re/rendering.md sections 3, 7, 9). Reads the world, never changes it
// (the only exception: the camera's wall push is evaluated on the interpolated camera by temporarily writing it into `world.camera.c`).
import { Renderer, SkyState, SeaState, SKY_MODE, SEA_MODE, SEABED_MODE, SEA_EDGE_MODE, DEFAULT_FOV, cameraFromFog, defaultLights, projection, selectLod } from '../render/index.ts';
import type { MeshGpu, TexGpu, CameraSetup, LightSet, DrawOpts } from '../render/index.ts';
import { lookDirLH, mul, transformPoint } from '../render/math.ts';
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene, Model, FaceSetup } from '../formats/exe.ts';
import type { ZoneRenderParams } from '../formats/zoneparams.ts';
import { parseBlk, sampleBlk, parseSvwl, skinPositions, skinNormals } from '../formats/anim.ts';
import type { Blk, Svwl } from '../formats/anim.ts';
import type { GameData } from '../viewer/data.ts';
import type { Loaded } from './setup.ts';
import type { GameRecord } from './record.ts';
import { RF_ENABLED, RF_NO_DRAW } from './record.ts';
import { V } from './vars.ts';
import { activeEntries } from '../formats/zonesetup.ts';

interface Part { meshPath: string | null; texList: number[]; lod: number; mesh?: MeshGpu | null }
interface Attach { bone: number; slot: number; parts: Part[] }
/** a skinned mesh of one record that is re-posed every frame */
interface Dyn { gpu: MeshGpu; sv: Svwl; pos: Float32Array; nrm: Float32Array }
interface RecView {
  rec: GameRecord;
  parts: Part[];
  attach: Attach[];
  kind?: 'sky' | 'sea';
  mode: number;
  /** bind-pose bone matrices for attachments when the record has no running animation */
  bindBones?: Float32Array | null;
  dyn: Map<MeshGpu, Dyn | null>;
  /** local centre and radius of the first part's mesh (for culling) */
  localCenter?: number[]; radius: number;
  scale: number;
  /** the model's face object (Faces.c, FUN_0043f1d0 in the zone builder): which attachment / groups show `rec.face` */
  face?: FaceSetup;
}

/** Faces.c FUN_0087e260: the UVs of a `.wib` face group are scaled x4 about v = 1 (the mesh maps the face into the top-left quarter of the texture) */
const FACE_WIB_SCALE: readonly [number, number] = [4, 4];
/** DAT_00981190 / DAT_00981194: UV offset of expression n of a 4x4 face atlas (type 0, FUN_0087e038 -> FUN_0087e0cf): ((n & 3) / 4, -(n >> 2) / 4) */
const faceAtlasOffset = (n: number): readonly [number, number] => [(n & 3) * 0.25, -(n >> 2) * 0.25];

/** distance within which animated records are posed every frame (others show the bind pose) */
const POSE_RANGE = 150;
const SHADOW_TYPE = 4;
/** FUN_00444940: controller flags (+0xc) that give a record a blob shadow, and the squared range to the camera (_DAT_008921ec = 6400) */
const SHADOW_CTRL_FLAGS = 0x50, SHADOW_RANGE2 = 6400;
/** SWITCH_GME_PEPP_IN_VEHICLE */
const VAR_PEPP_IN_VEHICLE = 0xa9;

export interface FrameInfo { eye: [number, number, number]; target: [number, number, number]; camDist: number; draws: number; triangles: number }

export class GameRenderer {
  readonly renderer: Renderer;
  readonly loaded: Loaded;
  readonly data: GameData;
  readonly archive: Archive;
  /** options slider of the game's draw distance (0..100, default 50) */
  slider = 50;
  /** per record: local transform of an attachment slot (the model's `FUN_0043e910(model, slot, matrix)`: z36CNT's helmet visor), applied before the bone matrix */
  attachLocal = new Map<GameRecord, Map<number, Float32Array>>();
  /** translucent copies drawn right after their record (z36CNT's motion blur, FUN_007b1a1b: mode 7 + FUN_0043ebe0 alpha): world matrix and alpha 0..1 */
  ghosts = new Map<GameRecord, { m: Float32Array; alpha: number }[]>();
  /** extra blob shadows with caller-given corner points (z36CNT: FUN_007b1a1b -> FUN_0087dd20(shadow, type, 5 points)): `pts` = 5 x (x, y, z) in the Shadow.msh vertex order (corner, centre, corner, corner, corner) */
  extraShadows: { type: number; pts: number[] }[] = [];
  /** the camera zoom DAT_0089df2c (FUN_0040cd1a), the vertical field of view in radians (default 1.0); zones with a fixed camera (z17WAS 0.4) set it */
  fov = DEFAULT_FOV;
  /** distance within which animated records are posed every frame (default POSE_RANGE 150; a zone whose characters are seen from further away, z15SSH's snakes, raises it) */
  poseRange = POSE_RANGE;
  /** near plane override of the zone code (DAT_0089df30 is written by the camera code of some zones, e.g. z41MAP FUN_00816220); null = the zone's fog set-up (`cameraFromFog`) */
  near: number | null = null;
  /** a zone's own background drawn right after the frame starts, before the records (z39ASB: the star field quad of FUN_007b7c24 / FUN_0088002d); gets the interpolated eye and the forward vector */
  backdrop: ((r: Renderer, eye: [number, number, number], fwd: [number, number, number]) => void) | null = null;
  /** the effects pass after the records (FUN_00442930: the brick batches of FX_Bricks, then the particles): the island draws its brick effects here (src/fx/bricks/draw.ts) */
  effects: ((r: Renderer, eye: [number, number, number]) => void) | null = null;
  info: FrameInfo = { eye: [0, 0, 0], target: [0, 0, 0], camDist: 0, draws: 0, triangles: 0 };
  /**
   * live sub-object (MATL) matrices of a record (doors, swinging parts, rotors: the island's src/island/trigger/parts.ts `partOverrides`): every group of the
   * record's mesh whose GTOM index has an entry is drawn with that matrix instead of the static one. Set by the zone game; null = static matrices only.
   */
  partMatrices: ((rec: GameRecord) => ReadonlyMap<number, Float32Array> | undefined) | null = null;
  /** the six clip planes (a, b, c, d; inside when a x + b y + c z + d >= 0) of the last drawn frame, null before the first frame */
  private planes: Float32Array | null = null;
  private views: RecView[] = [];
  /** per record and mesh group: texture coordinate offset added when drawing (zones that scroll a texture, e.g. z05WAB's printer paper: `scrollGroup`) */
  private uvOffsets = new Map<GameRecord, Map<number, [number, number]>>();
  private blks = new Map<string, Blk | null>();
  private posed = new WeakMap<MeshGpu, MeshGpu>();
  private svwls = new WeakMap<MeshGpu, Svwl | null>();
  private sky: SkyState;
  private sea = new SeaState();
  private fog: ZoneRenderParams | null;
  private lights: LightSet;
  private shadowArchive: Archive | null;
  private shadowMesh: MeshGpu | null = null;
  private shadowPos = new Float32Array(15);
  private shadowNrm = new Float32Array(15);
  private mat = new Float32Array(16);
  private scene: ZoneScene;

  constructor(renderer: Renderer, data: GameData, archive: Archive, scene: ZoneScene, loaded: Loaded, fog: ZoneRenderParams | null, lights: LightSet | null, shadowArchive: Archive | null) {
    this.renderer = renderer; this.data = data; this.archive = archive; this.scene = scene; this.loaded = loaded;
    this.fog = fog; this.lights = lights ?? defaultLights(); this.shadowArchive = shadowArchive;
    this.sky = new SkyState(loaded.profile.zone === 'z02LGI');
    this.buildViews();
    if (shadowArchive) {
      const raw = renderer.mesh(shadowArchive, 'Shadow.msh');
      if (raw) this.shadowMesh = renderer.uploadMesh({ ...raw.msh });
    }
  }

  /**
   * Zones whose code calls SetupFog (FUN_00442d90) more than once: `extractRenderParams` lists the calls in address order and the first one is the default; the call
   * that runs last wins in the original (Pepper's house: the loop function's third call, near 1 / far 100..500, after the set-up function's own). Moves call `index` to the front.
   */
  useFogCall(index: number) {
    const f = this.fog?.fog;
    if (f && f[index] && index > 0) { const [x] = f.splice(index, 1); f.unshift(x); }
  }

  // ---------------------------------------------------------------- set-up

  /** a zone game added records (helper records for models the original draws with hand-made matrices): build the views again */
  refreshViews() { this.buildViews(); }

  private getBlk(name: string): Blk | null {
    const key = name.toUpperCase();
    if (!this.blks.has(key)) {
      const e = this.archive.find(`anim/${name}.blk`);
      let b: Blk | null = null;
      try { b = e ? parseBlk(this.archive.read(e)) : null; } catch (err) { console.warn('blk', name, err); }
      this.blks.set(key, b);
    }
    return this.blks.get(key)!;
  }

  private rigOf(meshPath: string): string {
    const base = meshPath.split('\\').pop()!.toUpperCase();
    if (base.startsWith('SWFT')) return 'SWFT';
    if (base.startsWith('RBB')) return 'RBBT';
    if (base.startsWith('PTER')) return 'PTER';
    return 'MFIG';
  }

  private buildViews() {
    const sc = this.scene;
    const seenSpecial = new Set<string>();
    const mkParts = (m: Model): Part[] => m.parts.filter(Boolean).map((p) => ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod }));
    this.views = [];
    for (const rec of this.loaded.world.records) {
      if (!rec.model) continue;
      const parts = mkParts(rec.model);
      if (!parts.length) continue;
      const attach: Attach[] = [];
      for (const at of rec.model.attach) if (at) attach.push({ bone: at.bone, slot: at.slot, parts: mkParts(at.child) });
      // SSKY / SSEA are unit shapes re-placed every frame; only the first record of each special name has the behaviour (like the viewer)
      const special = ['SEAB', 'SSEA', 'SEAE', 'SSKY'].includes(rec.name) && !seenSpecial.has(rec.name);
      if (special) seenSpecial.add(rec.name);
      const kind = special && rec.name === 'SSKY' ? 'sky' : special && rec.name === 'SSEA' ? 'sea' : undefined;
      const mode = !special ? 0 : rec.name === 'SSKY' ? SKY_MODE : rec.name === 'SSEA' ? SEA_MODE : rec.name === 'SEAB' ? SEABED_MODE : SEA_EDGE_MODE;
      const sc3 = Math.max(Math.abs(rec.scale[0]), Math.abs(rec.scale[1]), Math.abs(rec.scale[2]));
      this.views.push({ rec, parts, attach, kind, mode, dyn: new Map(), radius: 5, scale: sc3, face: rec.model.face });
    }
    // the render modes the zone's set-up code assigns (FUN_00444550(record, partMask, mode), extracted by src/formats/zonesetup.ts): translucent props, holograms, ...
    const setup = this.loaded.setup;
    if (setup) {
      const byIndex = new Map(this.views.map((v) => [v.rec.index, v]));
      for (const e of activeEntries(setup.modes, (v) => this.loaded.world.vars.get(v))) {
        const rv = e.record >= 0 ? byIndex.get(e.record) : undefined;
        if (rv && !rv.kind) rv.mode = e.mode;
      }
    }
  }

  /**
   * FUN_0043e930(model, child, bone, slot) / FUN_0043e970 at run time: the model attached to `slot` of the record's skeleton becomes `child` (null: detached). The zone game does this
   * for models the original swaps while playing (z08BKD: the diver's empty hand / carried brick, the skeleton's spark part).
   */
  setAttach(rec: GameRecord, slot: number, bone: number, child: Model | null) {
    const rv = this.views.find((v) => v.rec === rec);
    if (!rv) return;
    const sc = this.scene;
    const i = rv.attach.findIndex((a) => a.slot === slot);
    if (!child) { if (i >= 0) rv.attach.splice(i, 1); return; }
    const parts: Part[] = child.parts.filter(Boolean).map((p) => ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod }));
    if (i >= 0) rv.attach[i] = { bone, slot, parts }; else rv.attach.push({ bone, slot, parts });
  }

  /** add (du, dv) to the texture coordinates of mesh group `group` of the record's first part (accumulates; the repeating texture wraps) */
  scrollGroup(rec: GameRecord, group: number, du: number, dv: number) {
    let m = this.uvOffsets.get(rec);
    if (!m) this.uvOffsets.set(rec, (m = new Map()));
    const o = m.get(group) ?? [0, 0];
    o[0] = (o[0] + du) % 1024; o[1] = (o[1] + dv) % 1024;
    m.set(group, o);
  }
  /** number of mesh groups of the record's first part (0 until its mesh is loaded) */
  groupCount(rec: GameRecord): number {
    const v = this.views.find((x) => x.rec === rec);
    const m = v && v.parts[0] ? this.partMesh(v.parts[0]) : null;
    return m ? m.groups.length : 0;
  }

  // ---------------------------------------------------------------- meshes

  private partMesh(part: Part): MeshGpu | null {
    if (part.mesh !== undefined) return part.mesh;
    part.mesh = null;
    if (part.meshPath) {
      const p = part.meshPath.split('\\');
      const arch = p[1], member = p.slice(2).join('/');
      if (arch.toLowerCase() !== this.archive.name.toLowerCase()) {
        void this.data.archive(arch).then(() => { part.mesh = undefined; }).catch(() => { /* stays invisible */ });
        return null;
      }
      part.mesh = this.renderer.mesh(this.archive, member);
    }
    return part.mesh;
  }

  private svwlOf(m: MeshGpu): Svwl | null {
    if (this.svwls.has(m)) return this.svwls.get(m)!;
    let sv: Svwl | null = null;
    if (m.msh.svwl) { try { sv = parseSvwl(m.msh.svwl, m.msh.vertexCount); } catch (e) { console.warn('svwl', e); } }
    this.svwls.set(m, sv);
    return sv;
  }

  private maxBone(sv: Svwl): number { let mb = -1; for (const b of sv.bone) if (b > mb) mb = b; return mb; }

  /** a skinned mesh posed once at the bind pose (MFIG.blk clip 2 frame 0), shared between records */
  private bindPose(m: MeshGpu, meshPath: string): MeshGpu {
    const hit = this.posed.get(m);
    if (hit) return hit;
    let res = m;
    const sv = this.svwlOf(m);
    if (sv) {
      const blk = this.getBlk(this.rigOf(meshPath));
      try {
        if (blk && blk.skeleton && blk.clips.length > 2 && blk.clips[2].boneCount === blk.skeleton.boneCount && this.maxBone(sv) < blk.skeleton.boneCount) {
          const mats = sampleBlk(blk.skeleton, blk.clips[2], 0);
          res = this.renderer.uploadMesh({ ...m.msh, positions: skinPositions(m.msh.positions, sv, mats), normals: skinNormals(m.msh.normals, sv, mats, undefined, true) });
        }
      } catch (err) { console.warn('skin', meshPath, err); }
    }
    this.posed.set(m, res);
    return res;
  }

  /** per-record dynamic mesh, re-skinned with the bone matrices of this frame; null when the mesh cannot be skinned with this rig */
  private dynPose(rv: RecView, raw: MeshGpu, bones: Float32Array): MeshGpu | null {
    let d = rv.dyn.get(raw);
    if (d === undefined) {
      const sv = this.svwlOf(raw);
      d = sv && this.maxBone(sv) < bones.length / 16 ? { gpu: this.renderer.uploadMesh({ ...raw.msh }), sv, pos: new Float32Array(raw.msh.vertexCount * 3), nrm: new Float32Array(raw.msh.vertexCount * 3) } : null;
      rv.dyn.set(raw, d);
    }
    if (!d) return null;
    skinPositions(raw.msh.positions, d.sv, bones, d.pos);
    skinNormals(raw.msh.normals, d.sv, bones, d.nrm, true);
    this.renderer.updateMeshVertices(d.gpu, d.pos, d.nrm);
    return d.gpu;
  }

  private texFor(part: Part, g: number): TexGpu | null {
    const id = part.texList[g] ?? -1;
    return id < 0 ? null : this.renderer.texture(this.archive, id);
  }

  // ---------------------------------------------------------------- frame

  /** record matrix between the previous and the current tick (a jump of more than 40 units is a teleport: no smearing) */
  private interp(r: GameRecord, alpha: number): Float32Array {
    const a = r.prev, b = r.m, o = this.mat;
    const dx = b[12] - a[12], dy = b[13] - a[13], dz = b[14] - a[14];
    if (alpha >= 1 || dx * dx + dy * dy + dz * dz > 1600) { o.set(b); return o; }
    for (let i = 0; i < 16; i++) o[i] = a[i] + (b[i] - a[i]) * alpha;
    return o;
  }

  /** draw one frame. alpha = interpolation factor between the previous and the current simulation tick */
  render(alpha: number, dt: number) {
    const { world, pepper } = this.loaded;
    const r = this.renderer;
    r.resize();
    r.setMipmaps(false);
    r.updateTextures(dt); this.sky.update(dt); this.sea.update(dt);

    // camera: interpolated eye / target; hub zones push the eye in front of walls (the sweep wants the interpolated values, so write them into the camera for the call)
    const cam = world.camera, c = cam.c, p = cam.prev;
    const eye: [number, number, number] = [0, 0, 0], tgt: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) { eye[i] = p[i] + (c[i] - p[i]) * alpha; tgt[i] = p[3 + i] + (c[3 + i] - p[3 + i]) * alpha; }
    if (world.hub) {
      const save = [c[0], c[1], c[2], c[3], c[4], c[5]];
      c[0] = eye[0]; c[1] = eye[1]; c[2] = eye[2]; c[3] = tgt[0]; c[4] = tgt[1]; c[5] = tgt[2];
      const e = cam.viewEye(world);
      for (let i = 0; i < 6; i++) c[i] = save[i];
      eye[0] = e[0]; eye[1] = e[1]; eye[2] = e[2];
    }
    let fx = tgt[0] - eye[0], fy = tgt[1] - eye[1], fz = tgt[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;

    const fog0 = this.fog?.fog[0];
    const setup: CameraSetup = fog0 ? cameraFromFog(fog0, this.slider, this.fov) : { fov: this.fov, near: 0.5, far: 2000, fog: { enabled: false, color: [0.45, 0.62, 0.85], start: 0, end: 1e6 }, clear: [0.45, 0.62, 0.85] };
    if (this.near !== null) setup.near = this.near;
    r.fog = setup.fog; r.lights = fog0 ? this.lights : defaultLights();
    r.cull = 1; r.cwFront = true;
    const aspect = r.aspect;
    const view = lookDirLH(eye, [fx, fy, fz]);
    const viewProj = mul(view, projection(setup, aspect));
    r.begin(setup.clear, viewProj);
    this.planes = clipPlanes(viewProj, this.planes ?? new Float32Array(24));
    this.backdrop?.(r, eye, [fx, fy, fz]);
    const range = Math.min(setup.far, setup.fog.enabled ? setup.fog.end : setup.far);
    const seaLevel = world.seaLevel;
    const cullFar = setup.far * 1.5;

    for (const rv of this.views) {
      const rec = rv.rec;
      if ((rec.flags & RF_ENABLED) === 0 || (rec.flags & RF_NO_DRAW) !== 0) continue;
      const mat = this.interp(rec, alpha);
      const dist = Math.hypot(mat[12] - eye[0], mat[13] - eye[1], mat[14] - eye[2]);
      const first = rv.parts[0] ? this.partMesh(rv.parts[0]) : null;
      if (first && rv.localCenter === undefined) { rv.localCenter = first.center; rv.radius = first.radius; }
      const wc = rv.localCenter ? transformPoint(mat, rv.localCenter) : [mat[12], mat[13], mat[14]];
      const cdist = Math.hypot(wc[0] - eye[0], wc[1] - eye[1], wc[2] - eye[2]);
      if (!rv.kind && cdist - rv.radius * rv.scale > cullFar) continue;
      // FUN_00443f90: the record flags 0x100 / 0x200 / 0x400 force the part (LOD) 0 / 1 / 2 (Pepper's house shows the gold / silver / bronze trophy this way)
      const forced = rec.flags & 0x700;
      const pi = forced && rv.parts.length > 1 ? (forced & 0x100 ? 0 : forced & 0x200 ? 1 : Math.min(2, rv.parts.length - 1)) : selectLod(rv.parts, dist, this.fov);
      let part = rv.parts[pi], m = this.partMesh(part);
      if (!m) { for (const q of rv.parts) { const mm = this.partMesh(q); if (mm) { part = q; m = mm; break; } } }
      if (!m) continue;
      let world_: Float32Array = mat;
      if (rv.kind === 'sky') world_ = this.sky.matrix(eye, range, mat[13]);
      else if (rv.kind === 'sea') world_ = this.sea.matrix(eye, range, seaLevel);
      else world_ = mat.slice();   // keep: mat is scratch and attachments are drawn after

      // skinning: pose live near the camera (animated records), bind pose otherwise
      let bones: Float32Array | null = null;
      const animated = !!rec.anim && dist < this.poseRange && !rv.kind;
      if (animated) bones = rec.anim!.pose(alpha);
      let drawMesh = m;
      if (m.msh.svwl) {
        let live: MeshGpu | null = null;
        if (bones) live = this.dynPose(rv, m, bones);
        drawMesh = live ?? this.bindPose(m, part.meshPath ?? '');
      }
      const uvs = this.uvOffsets.get(rec);
      const ovr = this.partMatrices?.(rec);
      const opts: DrawOpts = { mode: rv.mode };
      if (uvs) opts.uvOffset = (g) => uvs.get(g);
      if (ovr && ovr.size) opts.groupMatrix = this.groupOverride(drawMesh, ovr);
      if (rv.face && rv.face.slot === -1) this.applyFace(rv, part, rv.parts.indexOf(part), opts);
      r.drawMesh(drawMesh, world_, (g) => this.texFor(part, g), opts);
      if (rv.attach.length && !bones) {
        if (rv.bindBones === undefined) {
          rv.bindBones = null;
          const mp = rv.parts[0].meshPath;
          const blk = rec.anim?.rig ?? (mp ? this.getBlk(this.rigOf(mp)) : null);
          if (blk && blk.skeleton && blk.clips.length > 2 && blk.clips[2].boneCount === blk.skeleton.boneCount) rv.bindBones = sampleBlk(blk.skeleton, blk.clips[2], 0);
        }
        bones = rv.bindBones ?? null;
      }
      const drawAttach = (wm: Float32Array, tint?: [number, number, number, number]) => {
        if (!bones) return;
        const locals = this.attachLocal.get(rec);
        for (const at of rv.attach) {
          let cp = at.parts[0];
          let li = selectLod(at.parts, dist, this.fov);
          if (!at.parts[li]) li = 0;
          cp = at.parts[li] ?? cp;
          const cm = cp && this.partMesh(cp);
          if (!cm) continue;
          const bm = bones.subarray(at.bone * 16, at.bone * 16 + 16);
          if (bm.length < 16) continue;
          const loc = locals?.get(at.slot);
          const ao: DrawOpts = tint ? { preset: 13, tint } : {};
          if (rv.face && rv.face.slot === at.slot) this.applyFace(rv, cp, li, ao);
          r.drawMesh(cm, mul(loc ? mul(loc, bm) : bm, wm), (g) => this.texFor(cp, g), ao);
        }
      };
      drawAttach(world_);
      const gh = this.ghosts.get(rec);
      if (gh) for (const g of gh) {
        r.drawMesh(drawMesh, g.m, (q) => this.texFor(part, q), { preset: 13, tint: [1, 1, 1, g.alpha] });
        drawAttach(g.m, [1, 1, 1, g.alpha]);
      }
      // FUN_00444940: Pepper always (type from var 0xc5), other records with a controller whose flags have 0x10 / 0x40 within 80 units of the camera (type 4);
      // the blob sits under bone 0 of the pose (hips) unless SWITCH_GME_PEPP_IN_VEHICLE (var 0xa9) is set or the record has no animation
      const shadowed = rec === pepper || (!!rec.ctrl && (rec.ctrl.flags & SHADOW_CTRL_FLAGS) !== 0 && (mat[12] - eye[0]) ** 2 + (mat[13] - eye[1]) ** 2 + (mat[14] - eye[2]) ** 2 <= SHADOW_RANGE2);
      if (shadowed) this.drawShadow(rec.anim && bones && bones.length >= 16 && world.vars.get(VAR_PEPP_IN_VEHICLE) === 0 ? mul(bones.subarray(0, 16), world_) : mat, rec === pepper, rec);
    }
    this.effects?.(r, eye);
    for (const sh of this.extraShadows) this.drawShadowPoints(sh.pts, sh.type);
    this.info = { eye, target: tgt, camDist: Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]), draws: r.stats.draws, triangles: r.stats.triangles };
    r.endFrame();
  }

  // ---------------------------------------------------------------- faces, live part matrices, visibility

  /**
   * Faces.c (FUN_0043f1d0 set-up, FUN_0043f2f0 -> vtable +4 = FUN_0087e570 / FUN_0087e038): the face group of LOD part `li` shows expression `rec.face`.
   * Type 1 (all island minifigs): the group's UVs are scaled x4 about v = 1 (FUN_0087e260, done once at set-up) and its `.wib` sheet is frozen on
   * frame n (FUN_00443120(model, i, group, 2, n) -> FUN_00411202). Type 0: a 4x4 atlas, the group's UVs are offset by DAT_00981190[n].
   * The original keeps one frame per texture (the last setter wins); the port selects the frame right before each record's draw.
   */
  private applyFace(rv: RecView, part: Part, li: number, o: DrawOpts) {
    const f = rv.face!;
    const g = f.groups[li < 0 ? 0 : li];
    if (g === undefined || g < 0) return;
    const n = rv.rec.face | 0;
    if (f.type === 1) {
      const id = part.texList[g] ?? -1;
      if (id >= 0) this.renderer.setTextureFrame(this.archive, id, 2, n);
      const prev = o.uvScale;
      o.uvScale = (q) => (q === g ? FACE_WIB_SCALE : prev?.(q));
    } else if (f.type === 0 && n >= 0 && n < 16) {
      const off = faceAtlasOffset(n), prev = o.uvOffset;
      o.uvOffset = (q) => {
        if (q !== g) return prev?.(q);
        const p = prev?.(q);
        return p ? [p[0] + off[0], p[1] + off[1]] : off;
      };
    }
  }

  /** group -> live matrix of its GTOM index (undefined = the static matrix) */
  private groupOverride(m: MeshGpu, ovr: ReadonlyMap<number, Float32Array>): (g: number) => Float32Array | undefined {
    const gt = m.msh.gtom;
    return (g) => (gt ? ovr.get(gt[g]) : undefined);
  }

  /**
   * FUN_00444370 / FUN_00416590: a sphere (world centre, radius) against the six planes of the last drawn view (the original tests the record's collision
   * sphere every frame and keeps the result in record flag 1). True before the first frame.
   */
  sphereVisible(c: ArrayLike<number>, radius: number): boolean {
    const P = this.planes;
    if (!P) return true;
    for (let i = 0; i < 6; i++) {
      const o = i * 4;
      if (P[o] * c[0] + P[o + 1] * c[1] + P[o + 2] * c[2] + P[o + 3] < -radius) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- shadow

  /** a blob shadow of type `type` on the given five points (no ray casts) */
  private drawShadowPoints(pts: number[], type: number) {
    const sm = this.shadowMesh, sa = this.shadowArchive;
    if (!sm || !sa) return;
    const tex = this.renderer.texture(sa, type, '');
    if (!tex) return;
    const P = this.shadowPos;
    for (let i = 0; i < 15; i++) P[i] = pts[i];
    for (let i = 0; i < 5; i++) { this.shadowNrm[i * 3] = 0; this.shadowNrm[i * 3 + 1] = 1; this.shadowNrm[i * 3 + 2] = 0; }
    this.renderer.updateMeshVertices(sm, P, this.shadowNrm);
    const id = new Float32Array(16); id[0] = id[5] = id[10] = id[15] = 1;
    this.renderer.drawMesh(sm, id, () => tex, { mode: 2 });
  }

  /** Pepper's blob shadow (rendering.md section 9, type 4): corners 2 units out at heading +-45 / 135 deg, ray-cast down 2 above, lifted 0.08 */
  private drawShadow(mat: Float32Array, isPepper = true, self: GameRecord | null = null) {
    const sm = this.shadowMesh, sa = this.shadowArchive;
    if (!sm || !sa || (isPepper && this.loaded.world.vars.get(V.PEPPERSSHADOW) === -1)) return;
    const w = this.loaded.world;
    const tex = this.renderer.texture(sa, SHADOW_TYPE, '');
    if (!tex) return;
    const x = mat[12], y = mat[13], z = mat[14];
    let fx = mat[8], fz = mat[10];
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = fz, rz = -fx;   // right = (cos h, -sin h) for forward (sin h, cos h)
    const R = 2, lift = 0.08, k = R / Math.SQRT2;
    const ground = (px: number, pz: number, base: number): number => {
      const h = w.col.sweep(self, [px, base + 2, pz], [0, -40, 0], 3, 0.01, 0);   // the original casts against the registered collision list (DAT_009e5714), never the record itself
      return h ? h.point[1] : -Infinity;
    };
    let cy = Math.max(w.seaLevel, ground(x, z, y));
    if (!Number.isFinite(cy)) cy = y;
    const P = this.shadowPos;
    // template vertices: 0 (-1,+1) 1 centre 2 (-1,-1) 3 (+1,-1) 4 (+1,+1) in (right, forward)
    const local = [[-1, 1], [0, 0], [-1, -1], [1, -1], [1, 1]];
    for (let i = 0; i < 5; i++) {
      const [lx, lz] = local[i];
      const px = x + (rx * lx + fx * lz) * k, pz = z + (rz * lx + fz * lz) * k;
      let h = i === 1 ? cy : ground(px, pz, y);
      if (!Number.isFinite(h)) h = cy;
      h = Math.max(cy - 16, Math.min(cy + 16, h));
      P[i * 3] = px; P[i * 3 + 1] = h + lift; P[i * 3 + 2] = pz;
    }
    for (let i = 0; i < 5; i++) { this.shadowNrm[i * 3] = 0; this.shadowNrm[i * 3 + 1] = 1; this.shadowNrm[i * 3 + 2] = 0; }
    this.renderer.updateMeshVertices(sm, P, this.shadowNrm);
    const id = new Float32Array(16); id[0] = id[5] = id[10] = id[15] = 1;
    this.renderer.drawMesh(sm, id, () => tex, { mode: 2 });
  }
}

/** the six frustum planes of a row-vector view * projection matrix with GL clip space (-w..w), normalised: left, right, bottom, top, near, far */
export function clipPlanes(vp: ArrayLike<number>, out: Float32Array): Float32Array {
  // clip = (x, y, z, 1) * VP: clip component j = column j of VP
  const col = (j: number, k: number) => vp[k * 4 + j];
  const sets: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (let i = 0; i < 6; i++) {
    const [j, sgn] = sets[i];
    let a = col(3, 0) + sgn * col(j, 0), b = col(3, 1) + sgn * col(j, 1), c = col(3, 2) + sgn * col(j, 2), d = col(3, 3) + sgn * col(j, 3);
    const l = Math.hypot(a, b, c) || 1;
    a /= l; b /= l; c /= l; d /= l;
    out[i * 4] = a; out[i * 4 + 1] = b; out[i * 4 + 2] = c; out[i * 4 + 3] = d;
  }
  return out;
}
