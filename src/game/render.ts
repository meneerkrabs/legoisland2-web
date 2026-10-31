// Browser-side drawing of one game frame: the chase camera as the last step left it (no interpolation: one sim step = one drawn frame of the original), records in record order (LOD, textures, sky / sea specials), CPU-skinned
// animated characters with their attachments, and Pepper's blob shadow (docs/re/rendering.md sections 3, 7, 9). Reads the world, never changes it
// The state the original updates in its draw pass is stepped per sim step (`World.advanceDt` logs the passes, `render` replays the ones it has not drawn yet): see `takePasses`.
import { Renderer, SkyState, SeaState, SKY_MODE, SEA_MODE, SEABED_MODE, SEA_EDGE_MODE, DEFAULT_FOV, cameraFromFog, defaultLights, projection, selectLod } from '../render/index.ts';
import type { MeshGpu, TexGpu, CameraSetup, LightSet, DrawOpts, BatchGpu } from '../render/index.ts';
import { viewPlaneMesh, viewPlaneTexturedMesh, VIEWPLANE_TEX_PRESET, VIEWPLANE_TEX_STEP } from '../render/viewplane.ts';
import { lookDirLH, mul, mulGame, transformPoint } from '../render/math.ts';
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
import { PASS_LOG } from './world.ts';
import { pickFogCall } from './fogphases.ts';
import { frustumPlanes, visibleFlags } from '../fx/particles/sprites.ts';
import { PARTITIONS } from '../render/partition.ts';
import { runDrawHooks } from './controller.ts';
import { blobShadowPoints, markerPoints, markerVisible, shadowGate, SHADOW_HANDLED, SHADOW_RAY_LENGTH, SHADOW_RAY_MASK, SHADOW_RAY_RADIUS } from './shadow.ts';
import type { ShadowRay } from './shadow.ts';
import { activeEntries } from '../formats/zonesetup.ts';

/** the draw-time entry of the island's sky / sea scene nodes (src/island/ambient/seabed.ts `SkyNode.place` / `SeaNode.place`) */
interface SceneNodeApi { place(rec: GameRecord, eye: ArrayLike<number>, drawEye: ArrayLike<number>, v: { far: number; fogOn: boolean; fogEnd: number; domeBase: number; seaLevel: number; dt: number }): Float32Array }

/**
 * one LOD part of a model (the 0x14-byte part record: mesh +8, texture list +0xc, mode +0x10): `mode` is the draw mode FUN_00444550(record, partMask, mode) sets (default 0;
 * `slot` = the part's index, the bit of the part mask), `shiny` = FUN_004446c0 switched its mesh to vertex format 0x2c2
 */
/** the far / fog set-up of a loop pass (`stepView`); `pass` is its number in `World.passes` */
interface PassSetup { pass: number; far: number; fogOn: boolean; fogEnd: number }
/** one replayed pass: its own dt, camera and far / fog set-up (null = nobody logged it: the current one) */
interface PassInfo { dt: number; eye: [number, number, number]; setup: PassSetup | null }
interface Part { meshPath: string | null; texList: number[]; lod: number; mesh?: MeshGpu | null; slot: number; mode: number; shiny?: boolean }
interface Attach { bone: number; slot: number; parts: Part[] }
/** a skinned mesh of one record that is re-posed every frame */
interface Dyn { gpu: MeshGpu; sv: Svwl; pos: Float32Array; nrm: Float32Array }
interface RecView {
  rec: GameRecord;
  parts: Part[];
  attach: Attach[];
  kind?: 'sky' | 'sea';
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

/** the texture the debug option's textured view plane uses per zone when no `viewPlaneTexture` is given: NOT from the code (FUN_0087f854 is never called); z10RGB's only animated sheet (62, 15 frames), z22BIP's only tileable texture (3, wrap flags 7) */
const VIEWPLANE_TEXTURE_DEFAULT: Record<string, number> = { z10RGB: 62, z22BIP: 3 };

/** distance within which animated records are posed every frame (others show the bind pose) */
const POSE_RANGE = 150;
/** SWITCH_GME_PEPPSMARKER (var 0xc6): Pepper's flashing marker (FUN_00444ef0) */
const VAR_PEPP_MARKER = 0xc6;
/** SWITCH_GME_PEPP_IN_VEHICLE */
const VAR_PEPP_IN_VEHICLE = 0xa9;

export interface FrameInfo { eye: [number, number, number]; target: [number, number, number]; camDist: number; draws: number; triangles: number }

/** the motion-blur copies of z36CNT (FUN_007b1a1b: FUN_0043f180(model, 0, 7), draw mode 7 = state preset 26, modulated colour + alpha, blended, WITHOUT z test: modePreset(7)); M5 audit */
const GHOST_PRESET = 26;
/** DAT_009e5868, see `GameRenderer.markerTick` */
let markerTickGlobal = 0;

export class GameRenderer {
  readonly renderer: Renderer;
  readonly loaded: Loaded;
  readonly data: GameData;
  readonly archive: Archive;
  /** options slider of the game's draw distance (0..100, default 50) */
  slider = 50;
  /** per record: local transform of an attachment slot (the model's `FUN_0043e910(model, slot, matrix)`: z36CNT's helmet visor), applied before the bone matrix */
  attachLocal = new Map<GameRecord, Map<number, Float32Array>>();
  /** the camera zoom DAT_0089df2c (FUN_0040cd1a), the vertical field of view in radians (default 1.0); zones with a fixed camera (z17WAS 0.4) set it */
  fov = DEFAULT_FOV;
  /** distance within which animated records are posed every frame (default POSE_RANGE 150; a zone whose characters are seen from further away, z15SSH's snakes, raises it) */
  poseRange = POSE_RANGE;
  /** near plane override of the zone code (DAT_0089df30 is written by the camera code of some zones, e.g. z41MAP FUN_00816220); null = the zone's fog set-up (`cameraFromFog`) */
  near: number | null = null;
  /** a zone's own background drawn right after the frame starts, before the records (z39ASB: the star field quad of FUN_007b7c24 / FUN_0088002d); gets the eye and the forward vector */
  backdrop: ((r: Renderer, eye: [number, number, number], fwd: [number, number, number]) => void) | null = null;
  /** the effects pass after the records (FUN_00442930: the brick batches of FX_Bricks, then the particles): the island draws its brick effects here (src/fx/bricks/draw.ts) */
  effects: ((r: Renderer, eye: [number, number, number]) => void) | null = null;
  /** the particle draw pass (src/fx/particles/draw.ts), after `effects` (FUN_00442930 draws the particles last) */
  particles: ((r: Renderer, viewProj: Float32Array | number[]) => void) | null = null;
  info: FrameInfo = { eye: [0, 0, 0], target: [0, 0, 0], camDist: 0, draws: 0, triangles: 0 };
  /**
   * live sub-object (MATL) matrices of a record (doors, swinging parts, rotors: the island's src/island/trigger/parts.ts `partOverrides`): every group of the
   * record's mesh whose GTOM index has an entry is drawn with that matrix instead of the static one. Set by the zone game; null = static matrices only.
   */
  partMatrices: ((rec: GameRecord) => ReadonlyMap<number, Float32Array> | undefined) | null = null;
  /**
   * live vertex positions of a record's first mesh (FUN_0043ebe0(model, 2, points, 0) = FUN_0088350d mode 2: vertex i := point i, world space): z40aPO's SHAD shadow patch.
   * The function returns the 3 * n floats (n = the mesh's vertex count) or undefined for the static mesh. Set by the zone game; null = none.
   */
  vertexOverride: ((rec: GameRecord) => Float32Array | undefined) | null = null;
  /**
   * model-texture swaps (SwapText.c FUN_00443810 / FUN_004439f0: the island's vehicle looks, `src/island/vehicles/looks.ts`): for a record and the model's LOD part `lod`
   * the SwapText bank texture (`swapArchive`, `text<N>.tga`) of every mesh group that replaces the model's own texture; undefined / null = the model's own textures.
   */
  swapTextures: ((rec: GameRecord, lod: number) => readonly number[] | null | undefined) | null = null;
  swapArchive: Archive | null = null;
  /**
   * extra draws of a record's part-0 mesh with live vertex positions (world space) at the record's own matrix, after all records and before the effects (FUN_005f90f7, z10RGB: for every
   * flying ball FUN_0043ebe0(CSHD model, 2, 5 ground points, 0) + FUN_00444480(CSHD) draws the ball's shadow patch). The zone game refills the list every frame (a function) or leaves it empty.
   */
  meshDraws: (() => { rec: GameRecord; verts: Float32Array }[]) | null = null;
  /** debug option only (src/devcorner): the debug-draw queue, lines and boxes drawn at the end of the frame; null = nothing (always null without the debug option) */
  debugDraw: ((r: Renderer, eye: [number, number, number], viewProj: Float32Array | number[]) => void) | null = null;
  /**
   * Ontwikkelaarshoek (debug only, src/devcorner/camera-lod.ts), all null = the default play: `lodHook` replaces the part (LOD) choice of a record that has no flag-forced part (FUN_00443f90's adaptive
   * branch, DAT_009e56b8 / DAT_009e56bc; `dist` = distance to the eye, `parts` = the part count, returns the part index or null = the normal `selectLod`); `farHook` maps the frame's far clip
   * (DAT_0089df34, the adaptive detail moves it by +-50) to the one used for the projection and the culling.
   */
  lodHook: ((rec: GameRecord, parts: readonly { lod: number }[], dist: number, zoom: number) => number | null) | null = null;
  farHook: ((far: number) => number) | null = null;
  private liveVerts = new WeakMap<MeshGpu, MeshGpu>();
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
    renderer.loadDt = loaded.world.dt;   // FUN_004112ac's closing pass adds DAT_008b1718 to a fresh .wib timer: the global at the zone's load = the previous loop's last dt (`sh.dt`, 1.0 at boot), wp-time-wib-load
    renderer.resetLighting();   // a zone's meshes are loaded afresh: their mode 0 lighting happens again at the first draw
    this.buildViews();
    // FUN_00444530(FUN_0043f160(model, 0), nx, ny, nz) of the zone's set-up: the mesh of the record's part 0 is cut into cells and drawn through them (src/render/partition.ts)
    for (const [ri, nx, ny, nz] of PARTITIONS[loaded.profile.zone] ?? []) {
      const p0 = this.views.find((v) => v.rec.index === ri)?.parts.find((p) => p.slot === 0);
      const pm = p0 && this.partMesh(p0);
      if (pm) renderer.partitionMesh(pm, nx, ny, nz);
    }
    // the draw hooks FUN_005f7709 / FUN_0070fc64 (constructors 0x5f77ad / 0x70fd0b) draw the view plane around their record
    for (const a of loaded.setup?.attaches ?? []) {
      if (a.record < 0) continue;
      if (a.ctor === 0x5f77ad) this.viewPlanes.set(a.record, { y: 0, after: false });
      else if (a.ctor === 0x70fd0b) this.viewPlanes.set(a.record, { y: -106, after: true });
      else if (a.ctor === 0x426f55 && a.argWords && a.argWords.length >= 2) {
        const f = (u: number) => new Float32Array(new Uint32Array([u >>> 0]).buffer)[0];
        this.flow.set(a.record, { dv: f(a.argWords[0]), du: f(a.argWords[1]), var: a.var, mask: a.mask, value: a.value });
      }
    }
    // FUN_00444850 (the zone's shadow set-up, called once from its loop function) also initialises the two variables of Pepper's shadow: var 0xc6 = 0 (no marker), var 0xc5 = 4 (type)
    if (loaded.setup?.shadow) { loaded.world.vars.set(VAR_PEPP_MARKER, 0); loaded.world.vars.set(V.PEPPERSSHADOW, 4); }
    if (shadowArchive) {
      const raw = renderer.mesh(shadowArchive, 'Shadow.msh');
      if (raw) this.shadowMesh = renderer.uploadMesh({ ...raw.msh });
    }
  }

  /**
   * Zones whose code calls SetupFog (FUN_00442d90) more than once: `extractRenderParams` lists the calls in address order and the first one is the default; the call
   * that runs last wins in the original (Pepper's house: the loop function's third call, near 1 / far 100..500, after the set-up function's own). Moves call `index` to the front.
   */
  /** the loop's mode (loopmachine.ts MODE, set by the shell each frame): 7 = fade-in, decides which SetupFog call is in effect (fogphases.ts); undefined = play */
  loopMode: number | undefined;
  /** the zone was started again after a restart (exit state 3): its first fade-in shows the restart fog */
  restarted = false;
  /** the SetupFog call in effect now: the play call from the end of the first fade-in on, before it the set-up helper's (or, after a restart, the restart) call */
  private currentFog() {
    const r = pickFogCall(this.loaded.profile.zone, this.fog?.fog, { loopMode: this.loopMode, playedYet: this.playedYet, restarted: this.restarted });
    this.playedYet = r.playedYet;
    return r.call;
  }
  private playedYet = false;
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
    const mkParts = (m: Model, mode = 0): Part[] => m.parts.map((p, slot) => p ? ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod, slot, mode }) : null).filter((p): p is Part => !!p);
    this.views = [];
    for (const rec of this.loaded.world.records) {
      if (!rec.model) continue;
      // SSKY / SSEA are unit shapes re-placed every frame; only the first record of each special name has the behaviour (like the viewer)
      const special = ['SEAB', 'SSEA', 'SEAE', 'SSKY'].includes(rec.name) && !seenSpecial.has(rec.name);
      if (special) seenSpecial.add(rec.name);
      const kind = special && rec.name === 'SSKY' ? 'sky' : special && rec.name === 'SSEA' ? 'sea' : undefined;
      // the modes the behaviours' set-up code gives their records (FUN_00444550(record, 0xff, mode): seabed.c FUN_004266ca / FUN_00426915 / FUN_00426da4, the island's FUN_004b4907 for the foam)
      const mode0 = !special ? 0 : rec.name === 'SSKY' ? SKY_MODE : rec.name === 'SSEA' ? SEA_MODE : rec.name === 'SEAB' ? SEABED_MODE : SEA_EDGE_MODE;
      const parts = mkParts(rec.model, mode0);
      if (!parts.length) continue;
      const attach: Attach[] = [];
      for (const at of rec.model.attach) if (at) attach.push({ bone: at.bone, slot: at.slot, parts: mkParts(at.child) });
      const sc3 = Math.max(Math.abs(rec.scale[0]), Math.abs(rec.scale[1]), Math.abs(rec.scale[2]));
      this.views.push({ rec, parts, attach, kind, dyn: new Map(), radius: 5, scale: sc3, face: rec.model.face });
    }
    // the render modes and the specular switch the zone's set-up code assigns (FUN_00444550(record, partMask, mode), FUN_004446c0(record, 1); extracted by src/formats/zonesetup.ts or
    // read from the emulated set-up: translucent props, holograms, shiny vehicles ...), then the calls the zone's code made at run time (`setPartMode`, `setShiny`)
    const setup = this.loaded.setup;
    if (setup) {
      const vars = (v: number) => this.loaded.world.vars.get(v);
      for (const e of activeEntries(setup.modes, vars)) if (e.record >= 0) this.applyPartMode(e.record, e.partMask, e.mode, false);
      for (const e of activeEntries(setup.shiny ?? [], vars)) if (e.record >= 0) this.applyShiny(e.record, e.on, false);
      // the nodes' constructors ran while the set-up attached them: their calls come after the set-up's own
      for (const e of activeEntries(setup.ctorModes ?? [], vars)) if (e.record >= 0) this.applyPartMode(e.record, e.partMask, e.mode, false);
      for (const e of activeEntries(setup.ctorShiny ?? [], vars)) if (e.record >= 0) this.applyShiny(e.record, e.on, false);
    }
    for (const c of this.runtimeCalls) { if (c.kind === 'mode') this.applyPartMode(c.record, c.mask, c.mode, false); else this.applyShiny(c.record, c.on, false); }
  }

  /** the calls of the zone's run-time code to FUN_00444550 / FUN_004446c0, replayed when the views are rebuilt (`refreshViews`) */
  private runtimeCalls: ({ kind: 'mode'; record: number; mask: number; mode: number } | { kind: 'shiny'; record: number; on: boolean })[] = [];
  /**
   * The record views in draw order, with the draw hooks that draw OTHER records inside their own turn (`BehaviourNode.drawSeq`, e.g. the boat's FUN_00430c59: wake WAKR, spray WAKS, the boat,
   * then the plume WAKP only while fast, each through the default draw with the record's flags | 3 set for the call): those records come at the hook's turn (`forced` = drawn although their own
   * flags are cleared) and not at their own place in the record order.
   */
  private drawOrder(): { rv: RecView; forced: boolean }[] {
    const w = this.loaded.world;
    const seqs = new Map<number, { before: GameRecord[]; after: GameRecord[] }>();
    const claimed = new Set<number>();
    for (const rv of this.views) {
      const c = rv.rec.ctrl;
      if (!c || !c.enabled) continue;
      for (let i = 0; i < c.nodes.length; i++) {
        const n = c.nodes[i];
        if (!c.ran[i] || !n.drawSeq) continue;
        const q = n.drawSeq(w, rv.rec);
        if (!q) continue;
        seqs.set(rv.rec.index, q);
        for (const r of q.before) claimed.add(r.index);
        for (const r of q.after) claimed.add(r.index);
      }
    }
    if (claimed.size === 0) return this.views.map((rv) => ({ rv, forced: false }));
    const out: { rv: RecView; forced: boolean }[] = [];
    for (const rv of this.views) {
      if (claimed.has(rv.rec.index)) continue;
      const q = seqs.get(rv.rec.index);
      for (const r of q?.before ?? []) { const v = this.viewOf(r.index); if (v) out.push({ rv: v, forced: true }); }
      out.push({ rv, forced: false });
      for (const r of q?.after ?? []) { const v = this.viewOf(r.index); if (v) out.push({ rv: v, forced: true }); }
    }
    return out;
  }
  private viewOf(recordIndex: number): RecView | undefined { return this.views.find((v) => v.rec.index === recordIndex); }
  private applyPartMode(recordIndex: number, mask: number, mode: number, log: boolean) {
    const rv = this.viewOf(recordIndex);
    if (log) this.runtimeCalls.push({ kind: 'mode', record: recordIndex, mask, mode });
    // the behaviours of the sky / sea plane own their records' modes (their set-up call comes from seabed.c, not the zone's table)
    if (rv && !rv.kind) for (const p of rv.parts) if (mask & (1 << p.slot)) p.mode = mode;
  }
  private applyShiny(recordIndex: number, on: boolean, log: boolean) {
    const rv = this.viewOf(recordIndex);
    if (log) this.runtimeCalls.push({ kind: 'shiny', record: recordIndex, on });
    if (!rv) return;
    // FUN_004446c0 walks every part of the record's model and every part of its attached models
    for (const p of rv.parts) this.markShiny(p, on);
    for (const a of rv.attach) for (const p of a.parts) this.markShiny(p, on);
  }
  private markShiny(p: Part, on: boolean) {
    p.shiny = on;
    if (p.mesh) this.renderer.setShiny(p.mesh, on);
  }
  /**
   * FUN_00444550(record, partMask, mode): sets the draw mode of the record's model parts whose bit is set in `partMask` (bit i = LOD part i; 0xff = all). Modes: states.ts `modePreset`
   * (0 lit once, 1 lit at every draw, 2 unlit blended, 3 unlit no depth, 4 lit once no depth, 5, 6 unlit opaque, 7). The call is also made at run time by zone code (boat ripple / wake
   * `FUN_00444550(rip, 0xff, 2)`, ...): this is the entry point for those.
   */
  setPartMode(rec: GameRecord, partMask: number, mode: number) { this.applyPartMode(rec.index, partMask, mode, true); }
  /** FUN_004446c0(record, on): the record's model (and its attached models) switch to vertex format 0x2c2, the lighting adds a specular term (docs/re/rendering.md 4.2) */
  setShiny(rec: GameRecord, on = true) { this.applyShiny(rec.index, on, true); }
  /** the current mode of part `slot` of the record's model (tests, tools); undefined when the record or part does not exist */
  partModeOf(rec: GameRecord, slot = 0): number | undefined { return this.viewOf(rec.index)?.parts.find((p) => p.slot === slot)?.mode; }

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
    const sh = this.shinyModels.has(child);
    const parts: Part[] = child.parts.map((p, slot): Part | null => p ? ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod, slot, mode: 0, shiny: sh }) : null).filter((p): p is Part => !!p);
    if (i >= 0) rv.attach[i] = { bone, slot, parts }; else rv.attach.push({ bone, slot, parts });
  }

  /**
   * the record's model pointer (record + 4) changed at run time: the views of the record are built from the new model (M5 audit: the front end's Pepper borrows the outfit of
   * another stage figure, FUN_004721f0 `*(param_1 + 4) = *(record + 4)`); the face object stays the one of the model like in buildViews
   */
  setModel(rec: GameRecord, model: Model) {
    const rv = this.views.find((v) => v.rec === rec);
    if (!rv) return;
    const sc = this.scene;
    const mk = (m: Model): Part[] => { const sh = this.shinyModels.has(m); return m.parts.map((p, slot): Part | null => p ? ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod, slot, mode: 0, shiny: sh }) : null).filter((p): p is Part => !!p); };
    rv.parts = mk(model);
    rv.attach = [];
    for (const at of model.attach) if (at) rv.attach.push({ bone: at.bone, slot: at.slot, parts: mk(at.child) });
    rv.face = model.face;
    rv.localCenter = undefined;
    rv.bindBones = undefined;
  }

  /** models FUN_00444600(model, 1) switched to the shiny vertex format (the island's decor entries): their parts are shiny whenever a record shows them */
  private shinyModels = new Set<Model>();
  setModelShiny(model: Model) {
    this.shinyModels.add(model);
    for (const rv of this.views) if (rv.rec.model === model) for (const p of rv.parts) this.markShiny(p, true);
  }

  /**
   * FUN_0043ebe0(model, 0, &du, &dv) = FUN_0088350d mode 0 for mesh group `group` of the record's first part (callers loop over every group, which adds (du, dv) once to every vertex like the
   * original): u += du, v += dv per vertex in float32 on the mesh's own UVs (`Renderer.scrollMeshUV`, no wrapping, no dt). A skinned part's drawn mesh is a per-record copy of this one, which the
   * in-place scroll cannot reach: those keep a draw-time offset (never wrapped, summed in float32).
   */
  scrollGroup(rec: GameRecord, group: number, du: number, dv: number) {
    const rv = this.views.find((x) => x.rec === rec);
    const m = rv && rv.parts[0] ? this.partMesh(rv.parts[0]) : null;
    const g = m && !m.msh.svwl ? m.msh.groups[group] : undefined;
    if (m && g) { this.renderer.scrollMeshUV(m, du, dv, g.firstVertex, g.vertexCount); return; }
    let u = this.uvOffsets.get(rec);
    if (!u) this.uvOffsets.set(rec, (u = new Map()));
    const o = u.get(group) ?? [0, 0];
    o[0] = Math.fround(o[0] + du); o[1] = Math.fround(o[1] + dv);
    u.set(group, o);
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
      if (part.mesh && part.shiny) this.renderer.setShiny(part.mesh, true);
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

  private texFor(part: Part, g: number, swap?: readonly number[] | null): TexGpu | null {
    if (swap && this.swapArchive) { const sid = swap[g]; if (sid !== undefined && sid >= 0) return this.renderer.texture(this.swapArchive, sid, ''); }
    const id = part.texList[g] ?? -1;
    return id < 0 ? null : this.renderer.texture(this.archive, id);
  }

  // ---------------------------------------------------------------- frame

  /**
   * The draw passes of the original (FUN_00442930, once per loop pass) that happened since the last drawn frame: `World.advanceDt` logs each pass's dt and camera, `stepView` (the end of the
   * sim step, where the pass's view is set up) the pass's own far / fog set-up. The browser loops run at most ONE pass per drawn frame (`FrameClock`: a slow frame is one pass with a larger
   * dt, never several fixed ones), so a drawn frame replays 0 or 1 passes; harnesses that step many times between two draws replay them all, each with its own dt, camera and set-up.
   * State the original changes in its draw pass (.wib textures, sky / sea hooks, flowing water, view plane phases, the marker blink) advances by exactly those passes, never by rAF calls and never scaled by the wall time.
   */
  private takePasses(): PassInfo[] {
    const w = this.loaded.world;
    const n = Math.min(w.passes - this.seenPass, PASS_LOG);
    this.seenPass = w.passes;
    const out: PassInfo[] = [];
    for (let j = 0; j < n; j++) {
      const k = w.passes - n + j, i = k & (PASS_LOG - 1);
      const st = this.stepSetups[i];
      out.push({ dt: w.passDt[i], eye: [w.passEye[i * 3], w.passEye[i * 3 + 1], w.passEye[i * 3 + 2]], setup: st && st.pass === k ? st : null });
    }
    return out;
  }
  /** the number of `world.passes` the last drawn frame had replayed */
  private seenPass = 0;
  /** the passes of the frame being drawn (`takePasses`) */
  private passes: PassInfo[] = [];
  /** the far / fog set-up of each logged pass (ring parallel to the world's pass log), written by `stepView` before the pass is logged */
  private stepSetups: (PassSetup | undefined)[] = new Array(PASS_LOG);

  /** the view of the last sim step: eye / target (hub zones push the eye in front of walls), the camera setup (fog / fov / near / far) and the view-projection matrix */
  private viewSetup() {
    const { world } = this.loaded;
    const cam = world.camera, c = cam.c;
    let eye: [number, number, number] = [c[0], c[1], c[2]];
    const tgt: [number, number, number] = [c[3], c[4], c[5]];
    if (world.hub) { const e = cam.viewEye(world); eye = [e[0], e[1], e[2]]; }
    let fx = tgt[0] - eye[0], fy = tgt[1] - eye[1], fz = tgt[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const fog0 = this.currentFog();
    const setup: CameraSetup = fog0 ? cameraFromFog(fog0, this.slider, this.fov) : { fov: this.fov, near: 0.5, far: 2000, fog: { enabled: false, color: [0.45, 0.62, 0.85], start: 0, end: 1e6 }, clear: [0.45, 0.62, 0.85] };
    if (this.near !== null) setup.near = this.near;
    if (this.farHook) setup.far = this.farHook(setup.far);   // Ontwikkelaarshoek: adaptive detail (FUN_00443d10), null = off
    const view = lookDirLH(eye, [fx, fy, fz]);
    const viewProj = mul(view, projection(setup, this.renderer.aspect));
    return { eye, tgt, fx, fy, fz, fog0, setup, view, viewProj };
  }

  /**
   * The frustum planes of this loop pass (FUN_00444370 / FUN_00416590 run in the original's draw pass, once per pass; the nodes of the next pass read the flags it left). The loops call this at
   * the end of every sim step, so the flags follow the sim and not the browser's drawing rate: a page that draws one frame for several steps (a loaded machine) would otherwise let the nodes see
   * the view of a frame long gone (a bot head walked into while the view was stale was not collected). `render` computes the same planes again from the same camera.
   */
  stepView(): void {
    const vs = this.viewSetup();
    this.planes = clipPlanes(vs.viewProj, this.planes ?? new Float32Array(24));
    const k = this.loaded.world.passes;   // the pass this step is about to log (`World.advanceDt` follows)
    this.stepSetups[k & (PASS_LOG - 1)] = { pass: k, far: vs.setup.far, fogOn: vs.setup.fog.enabled, fogEnd: vs.setup.fog.end };
  }

  /**
   * draw one frame: the state of the last sim step. The arguments are not used any more (the loops pass `alpha` = 1: the original does not interpolate, and the step time is `world.dt`);
   * they stay so that hosts that wrap `render` keep working.
   */
  render(_alpha = 1, _dt = 0) {
    const { world } = this.loaded;
    const r = this.renderer;
    r.resize();
    r.setMipmaps(false);
    const passes = this.passes = this.takePasses();
    this.markerPending = true;
    for (const p of passes) { r.stepTextures(p.dt); this.sky.update(p.dt); this.sea.update(p.dt); }
    r.flushTextures();

    // camera: the chase camera of the last step; hub zones push the eye in front of walls
    const { eye, tgt, fx, fy, fz, fog0, setup, view, viewProj } = this.viewSetup();
    this.eye = eye;
    r.fog = setup.fog; r.lights = fog0 ? this.lights : defaultLights();
    r.eye = [eye[0], eye[1], eye[2]];   // DAT_00986e18..20: the specular lighting of shiny meshes looks from here
    r.cull = 1; r.cwFront = true;
    const aspect = r.aspect;
    r.begin(setup.clear, viewProj);
    this.planes = clipPlanes(viewProj, this.planes ?? new Float32Array(24));
    this.lastViewProj = viewProj;
    this.backdrop?.(r, eye, [fx, fy, fz]);
    const range = Math.min(setup.far, setup.fog.enabled ? setup.fog.end : setup.far);
    const seaLevel = world.seaLevel;
    const cullFar = setup.far * 1.5;

    // the view planes of records whose draw hook calls FUN_00444500 (z10RGB's LAND before the record, z22BIP's SEAB after it); an 'after' plane is drawn at the next record's turn
    // records without a model have no default draw, but the draw pass still calls their hooks
    for (const rec of world.records) if (rec.ctrl && !this.viewOf(rec.index)) this.drawHooks(rec);
    let planeAfter: number | null = null;   // the level of an 'after' view plane that is still to be drawn
    // the textured view plane's phases: one 0.01 step per pass of the original's draw (FUN_0087f01e), not scaled by the frame time; the passes of this frame but the last are skipped draws
    const planePasses = passes.length;
    const viewPlane = (level: number) => this.drawViewPlane(eye, tgt, view, setup, aspect, planePasses, level);
    for (const { rv, forced: hooked } of this.drawOrder()) {
      if (planeAfter !== null) { viewPlane(planeAfter); planeAfter = null; }
      const vp = this.viewPlanes.get(rv.rec.index);
      if (vp) { if (vp.after) planeAfter = vp.y; else viewPlane(vp.y); }
      const rec = rv.rec;
      // the flowing-water node's draw hook (constructor 0x426f55, z13CAI's LAVA / FALL; FUN_00426e9a): every pass it adds (du, dv) to the texture coordinates of part 0's mesh (FUN_0043ebe0 ->
      // FUN_0088350d mode 0: in place, per vertex, float32, no wrapping, the vertex buffer is shared by every record of the mesh) and draws that mesh in mode 0 at the record's matrix, without the
      // visibility flags and without LOD selection (per DRAWN FRAME = once per pass of the loop, NOT scaled by the frame time)
      const flow = this.flow.get(rec.index);
      let flowing = false;
      if (flow && this.loaded.world.vars.gate(flow.var, flow.mask, flow.value)) {
        flowing = true;
        const m0 = rv.parts[0] ? this.partMesh(rv.parts[0]) : null;
        if (m0) for (let k = 0; k < passes.length; k++) r.scrollMeshUV(m0, flow.du, flow.dv);   // the vertex buffer's own float32 u += du, v += dv per pass (`scrollUvs`), uploaded again
      }
      // the node draw pass (FUN_0042271b): the draw hooks of the nodes that ran run whatever the record's own draw flags say (the blob shadow hook FUN_004bd41a draws a hidden record's shadow);
      // a hook that reports "handled" (non-zero) replaces the record's default draw (FUN_00444480)
      // the sky dome node of z40OGL (PeppSwit.c STAR, FUN_007e62da): its draw hook scales the record to the far plane, centres it on the camera and draws it with the fog off
      const dome = rec.ctrl?.nodes.find((n) => n.kind === 'PeppStar') as { place(rec: GameRecord, eye: ArrayLike<number>, far: number, fogOn: boolean): unknown } | undefined;
      const domeOn = !!dome && world.vars.gate(2, 1, 1);
      if (domeOn) dome!.place(rec, eye, setup.far, setup.fog.enabled);
      if (this.drawHooks(rec)) continue;
      if (!flowing && (((rec.flags & RF_ENABLED) === 0 && !hooked) || (rec.flags & RF_NO_DRAW) !== 0)) continue;
      const mat = this.mat; mat.set(rec.m);
      const dist = Math.hypot(mat[12] - eye[0], mat[13] - eye[1], mat[14] - eye[2]);
      const first = rv.parts[0] ? this.partMesh(rv.parts[0]) : null;
      if (first && rv.localCenter === undefined) { rv.localCenter = first.center; rv.radius = first.radius; }
      const wc = rv.localCenter ? transformPoint(mat, rv.localCenter) : [mat[12], mat[13], mat[14]];
      const cdist = Math.hypot(wc[0] - eye[0], wc[1] - eye[1], wc[2] - eye[2]);
      if (!rv.kind && !domeOn && cdist - rv.radius * rv.scale > cullFar) continue;
      // FUN_00443f90: the record flags 0x100 / 0x200 / 0x400 force the part (LOD) 0 / 1 / 2 (Pepper's house shows the gold / silver / bronze trophy this way)
      const forced = rec.flags & 0x700;
      const pi = flowing ? 0 : forced && rv.parts.length > 1 ? (forced & 0x100 ? 0 : forced & 0x200 ? 1 : Math.min(2, rv.parts.length - 1)) : ((!rv.kind ? this.lodHook?.(rec, rv.parts, dist, this.fov) : null) ?? selectLod(rv.parts, dist, this.fov));
      let part = rv.parts[pi], m = this.partMesh(part);
      if (!m) { for (const q of rv.parts) { const mm = this.partMesh(q); if (mm) { part = q; m = mm; break; } } }
      if (!m) continue;
      let world_: Float32Array = mat;
      // the sky dome / sea plane of the zone carry the original's scene nodes (src/island/ambient/seabed.ts: FUN_004267d2 / FUN_00426a43): they own the state the save game holds and move their record
      // with the CURRENT camera, once per pass of the loop. A record without such a node (the viewer's models) keeps the renderer's own placement.
      const sceneNode = rv.kind ? rec.ctrl?.nodes.find((n) => n.kind === 'Sky' || n.kind === 'Sea') as SceneNodeApi | undefined : undefined;
      if (sceneNode) {
        // the draw hook of every pass of this frame (each with its own dt and camera position, the hook advances the node's state); a frame without a new pass shows the record as the last hook left it
        const v = { far: setup.far, fogOn: setup.fog.enabled, fogEnd: Math.trunc(setup.fog.end), domeBase: range, seaLevel, dt: 0 };
        world_ = mat.slice();
        for (const p of passes) {
          // each pass with its own far / fog set-up (the logged one; the current one for a pass nobody logged)
          const ps = p.setup;
          v.dt = p.dt; v.far = ps ? ps.far : setup.far; v.fogOn = ps ? ps.fogOn : setup.fog.enabled; v.fogEnd = Math.trunc(ps ? ps.fogEnd : setup.fog.end);
          v.domeBase = Math.min(v.far, v.fogOn ? ps ? ps.fogEnd : setup.fog.end : v.far);
          world_ = sceneNode.place(rec, p.eye, p.eye, v);
        }
      }
      else if (rv.kind === 'sky') world_ = this.sky.matrix(eye, range, mat[13]);
      else if (rv.kind === 'sea') world_ = this.sea.matrix(eye, range, seaLevel);
      else world_ = mat.slice();   // keep: mat is scratch and attachments are drawn after

      // skinning: pose live near the camera (animated records), bind pose otherwise
      let bones: Float32Array | null = null;
      const animated = !!rec.anim && dist < this.poseRange && !rv.kind;
      if (animated) bones = rec.anim!.pose(1);
      let drawMesh = m;
      if (m.msh.svwl) {
        let live: MeshGpu | null = null;
        if (bones) live = this.dynPose(rv, m, bones);
        drawMesh = live ?? this.bindPose(m, part.meshPath ?? '');
      }
      const uvs = this.uvOffsets.get(rec);
      const vo = this.vertexOverride?.(rec);
      if (vo) {
        let g = this.liveVerts.get(m);
        if (!g) { g = this.renderer.uploadMesh({ ...m.msh }); this.liveVerts.set(m, g); }
        this.renderer.updateMeshVertices(g, vo, m.msh.normals as Float32Array);
        drawMesh = g;
      }
      const ovr = this.partMatrices?.(rec);
      // FUN_00444480 -> FUN_004440f0 (records with a skeleton, record + 8): the base mesh is drawn by FUN_0088b87b, which ignores the part's mode: block 3, skinned and lit at every draw
      // (FUN_0088589e; a mesh without skin data is not lit at all: it keeps the colours its vertex buffer has); every other record goes through FUN_0088aca2 with the part's mode
      const opts: DrawOpts = rec.anim && !rv.kind ? (m.msh.svwl ? { mode: 1, skinned: true } : { mode: 1, lit: 'never' }) : { mode: part.mode, skinned: !!m.msh.svwl };
      if (drawMesh !== m && drawMesh.shiny !== m.shiny) r.setShiny(drawMesh, m.shiny);   // posed copies of a shiny mesh are shiny too
      if (uvs) opts.uvOffset = (g) => uvs.get(g);
      if (ovr && ovr.size) opts.groupMatrix = this.groupOverride(drawMesh, ovr);
      if (rv.face && rv.face.slot === -1) this.applyFace(rv, part, rv.parts.indexOf(part), opts);
      const swap = this.swapTextures?.(rec, rv.parts.indexOf(part));
      const fogKeep = r.fog;
      if (domeOn) r.fog = { ...fogKeep, enabled: false };     // FUN_00442d50(0)
      r.drawMesh(drawMesh, world_, (g) => this.texFor(part, g, swap), opts);
      if (this.trackWorld.has(rec)) this.lastWorld.set(rec, world_.slice());
      if (domeOn) r.fog = fogKeep;
      if (rv.attach.length && !bones) {
        if (rv.bindBones === undefined) {
          rv.bindBones = null;
          const mp = rv.parts[0].meshPath;
          const blk = rec.anim?.rig ?? (mp ? this.getBlk(this.rigOf(mp)) : null);
          if (blk && blk.skeleton && blk.clips.length > 2 && blk.clips[2].boneCount === blk.skeleton.boneCount) rv.bindBones = sampleBlk(blk.skeleton, blk.clips[2], 0);
        }
        bones = rv.bindBones ?? null;
      }
      const drawAttach = (wm: Float32Array) => {
        if (!bones) return;
        const locals = this.attachLocal.get(rec);
        for (const at of rv.attach) {
          // FUN_004440f0: the attached model shows the same LOD index as the base mesh (clamped to its own number of parts)
          let li = Math.min(rv.parts.indexOf(part), at.parts.length - 1);
          if (li < 0) li = 0;
          const cp = at.parts[li] ?? at.parts[0];
          const cm = cp && this.partMesh(cp);
          if (!cm) continue;
          const bm = bones.subarray(at.bone * 16, at.bone * 16 + 16);
          if (bm.length < 16) continue;
          const loc = locals?.get(at.slot);
          // attachments are drawn by FUN_0088b4c0 with mode 1: lit at every draw (static variant)
          const ao: DrawOpts = { mode: 1 };
          if (rv.face && rv.face.slot === at.slot) this.applyFace(rv, cp, li, ao);
          const am = mul(loc ? mul(loc, bm) : bm, wm);
          r.drawMesh(cm, am, (g) => this.texFor(cp, g), ao);
          if (this.trackWorld.has(rec)) this.lastWorld.set(rec, am.slice());
        }
      };
      drawAttach(world_);
      // FUN_004440f0 ends with FUN_00444940(record): the blob shadow of records with a skeleton (rec + 8), right after the model and its attachments
      if (rec.anim && !rv.kind) this.drawBlobShadow(rec, mat, world_, bones, eye);
    }
    if (planeAfter !== null) viewPlane(planeAfter);
    for (const d of this.meshDraws?.() ?? []) this.drawLiveMesh(d.rec, d.verts);
    this.effects?.(r, eye);
    this.particles?.(r, viewProj);
    this.debugDraw?.(r, eye, viewProj);
    this.info = { eye, target: tgt, camDist: Math.hypot(tgt[0] - eye[0], tgt[1] - eye[1], tgt[2] - eye[2]), draws: r.stats.draws, triangles: r.stats.triangles };
    r.endFrame();
  }

  /**
   * The direct draw of a node's draw hook (FUN_0043f180(model, 0, mode) + FUN_0043f160(model, 0, matrix, part) + FUN_0043f1a0 = FUN_00416885(matrix) + FUN_0087d9a7(object, part, mode)):
   * LOD part 0 of the record's model at the world matrix `m`, without visibility flags, culling or LOD selection. `ghostAlpha` null = draw mode 1 (lit at every draw, the real part);
   * a number 0..1 = draw mode 7 (state preset 26, no z test) with that alpha (FUN_0043ebe0(model, 3, &alpha, 0)). z36CNT's hook FUN_007b1a1b.
   */
  drawPart0(rec: GameRecord, m: Float32Array, ghostAlpha: number | null) {
    const rv = this.viewOf(rec.index);
    const part = rv?.parts[0];
    const pm = part ? this.partMesh(part) : null;
    if (!rv || !part || !pm) return;
    const mesh = pm.msh.svwl ? this.bindPose(pm, part.meshPath ?? '') : pm;
    const o: DrawOpts = ghostAlpha === null ? { mode: 1 } : { preset: GHOST_PRESET, tint: [1, 1, 1, ghostAlpha] };
    this.renderer.drawMesh(mesh, m, (g) => this.texFor(part, g), o);
  }

  /** a record's part-0 mesh with the vertices `verts` (3 floats each, world space), drawn at the record's matrix with the part's mode (`meshDraws`) */
  private drawLiveMesh(rec: GameRecord, verts: Float32Array, noZ = false) {
    const rv = this.viewOf(rec.index);
    const part = rv?.parts[0];
    const m = part ? this.partMesh(part) : null;
    if (!rv || !part || !m) return;
    let g = this.liveVerts.get(m);
    if (!g) { g = this.renderer.uploadMesh({ ...m.msh }); this.liveVerts.set(m, g); }
    this.renderer.updateMeshVertices(g, verts, m.msh.normals as Float32Array);
    if (g.shiny !== m.shiny) this.renderer.setShiny(g, m.shiny);
    this.renderer.drawMesh(g, rec.m.slice(), (q) => this.texFor(part, q), { mode: part.mode, skinned: false, noZ });
  }

  /**
   * The D3D world matrix a record's draw leaves behind = the matrix of the LAST mesh it drew (the base mesh, then its attachments in slot order: FUN_004440f0). Draw hooks that project a point afterwards
   * (z09JST's aim marker FUN_005d2814: FUN_004445c0 with the local point (0, 0, 0)) read it. Only records in `trackWorld` are recorded; `lastWorld` holds the matrix of the last frame drawn.
   */
  readonly trackWorld = new Set<GameRecord>();
  readonly lastWorld = new Map<GameRecord, Float32Array>();
  /** the view * projection matrix of the last frame (D3D's transform state for a draw hook's FUN_004445c0 projection) */
  lastViewProj: Float32Array = new Float32Array(16);

  /** a draw hook's direct draw of a record with live vertices (FUN_0043ebe0(model, 2, points, 0) + FUN_00444480(rec)), optionally with the z test off (FUN_0040cc4d(0)): z28HAT's balloon shadow */
  drawRecordLive(rec: GameRecord, verts: Float32Array, noZ: boolean) { this.drawLiveMesh(rec, verts, noZ); }

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
    // FUN_0040cd36: `(flags & 0x3f000) == 0` of the ComputeSphereVisibility result = no plane has the sphere completely outside (a sphere cutting a plane is visible)
    return (visibleFlags(P, c[0], c[1], c[2], radius) & 0x3f000) === 0;
  }

  // ---------------------------------------------------------------- shadow

  /** a blob shadow of type `type` on the given five points (no ray casts); `mode` = the part mode FUN_0043f1a0 draws with (the shadows: 0, Pepper's marker: 2) */
  drawShadowPoints(pts: ArrayLike<number>, type: number, mode = 2) {
    const sm = this.shadowMesh, sa = this.shadowArchive;
    if (!sm || !sa) return;
    const tex = this.renderer.texture(sa, type, '');
    if (!tex) return;
    const P = this.shadowPos;
    for (let i = 0; i < 15; i++) P[i] = pts[i];
    for (let i = 0; i < 5; i++) { this.shadowNrm[i * 3] = 0; this.shadowNrm[i * 3 + 1] = 1; this.shadowNrm[i * 3 + 2] = 0; }
    this.renderer.updateMeshVertices(sm, P, this.shadowNrm);
    const id = new Float32Array(16); id[0] = id[5] = id[10] = id[15] = 1;
    this.renderer.drawMesh(sm, id, () => tex, { mode });
  }

  /**
   * records whose draw hook draws the view plane (FUN_00444500(y), src/render/viewplane.ts) before or after the record itself: z10RGB's LAND node (constructor 0x5f77ad, y = 0, before) and
   * z22BIP's SEAB node (0x70fd0b, y = -106, after) found in the zone's attach list; other zones can add theirs with `setViewPlane`
   */
  private viewPlanes = new Map<number, { y: number; after: boolean }>();
  setViewPlane(rec: GameRecord, y: number, after: boolean) { this.viewPlanes.set(rec.index, { y, after }); }
  private planeBatch: BatchGpu | null = null;
  /** records with the flowing-water node: texture scroll per drawn frame (u = argument word 1, v = argument word 0) and the node's gate */
  private flow = new Map<number, { du: number; dv: number; var: number; mask: number; value: number }>();
  /**
   * DEBUG OPTION (not in the original): switch on the textured pass of FUN_0087f01e, which the original never runs (DAT_05d5faac is only written by the never-called FUN_0087f854, see
   * viewplane.ts). `viewPlaneTexture` = the texture number FUN_0087f854's first argument would name (`null` = `VIEWPLANE_TEXTURE_DEFAULT` of the zone: a guess, the code does not say). Only has an
   * effect in the zones whose draw hook draws a view plane (z10RGB, z22BIP). Default off: the pass stays dead like in the original.
   */
  viewPlaneTextured = false;
  viewPlaneTexture: number | null = null;
  /** DAT_05d5fad4 / DAT_05d5fad8: the phases of the textured pass (0 at start, + 0.01 per drawn pass of the original) */
  private planeT1 = 0;
  private planeT2 = 0;
  /** the phases the last drawn pass used */
  private planeDraw1 = 0;
  private planeDraw2 = 0;
  /**
   * FUN_0087f01e: the textured pass (only with the debug option, see above) and the coloured polygon of the view plane, with the far plane at 2000 and no depth test. The coloured one only shows
   * for a camera below y = -200, see viewplane.ts. `passes` = the passes of the original's loop this frame replays: the textured pass' phases grow by 0.01 per drawn frame of the original (not scaled by the frame time).
   */
  private drawViewPlane(eye: ArrayLike<number>, tgt: ArrayLike<number>, view: Float32Array, setup: CameraSetup, aspect: number, passes: number, level: number) {
    const r = this.renderer;
    // widescreen: the original's quad covers a 4:3 view; a wider canvas gets a proportionally wider quad
    const inp = { eye, fwd: [view[2], view[6], view[10]], up: [0, 1, 0], target: tgt, level, widen: Math.max(1, aspect / (4 / 3)) };
    const opts = { mvp: mul(view, projection({ ...setup, far: 2000 }, aspect)), specular: false };
    this.planeBatch ??= r.createBatch(8, 24);
    if (this.viewPlaneTextured) {
      const tex = this.viewPlaneTexture ?? VIEWPLANE_TEXTURE_DEFAULT[this.loaded.profile.zone] ?? 0;
      // the passes of this frame but the last are draws nobody saw: the phases still step for them; a frame without a new pass draws the last phases again
      if (passes > 0) { this.planeDraw1 = this.planeT1; this.planeDraw2 = this.planeT2; for (let k = 1; k < passes; k++) { this.planeDraw1 = Math.fround(this.planeDraw1 + VIEWPLANE_TEX_STEP); this.planeDraw2 = Math.fround(this.planeDraw2 + VIEWPLANE_TEX_STEP); } this.planeT1 = Math.fround(this.planeDraw1 + VIEWPLANE_TEX_STEP); this.planeT2 = Math.fround(this.planeDraw2 + VIEWPLANE_TEX_STEP); }
      const tm = viewPlaneTexturedMesh(inp, this.planeDraw1, this.planeDraw2);
      if (tm) r.drawBatch(this.planeBatch, tm.count, tm.indices.length, tm.positions, tm.uvs, tm.colors, null, tm.indices, r.texture(this.archive, tex, 'textures'), VIEWPLANE_TEX_PRESET, opts);
    }
    const mesh = viewPlaneMesh(inp);
    if (!mesh) return;
    r.drawBatch(this.planeBatch, mesh.count, mesh.indices.length, mesh.positions, null, mesh.colors, null, mesh.indices, null, 0x1d, opts);
  }

  /** `_DAT_009e5868`: the tick counter of Pepper's marker (a float32 engine global, never reset, so it carries over from zone to zone; FUN_00444ef0 adds DAT_008b1718 at every call = once per drawn pass: 32 passes per blink period at dt 0.5) */
  private get markerTick() { return markerTickGlobal; }
  private set markerTick(v: number) { markerTickGlobal = v; }
  /** the frame's passes have not been added to `markerTick` yet (the marker is drawn at most once per frame) */
  private markerPending = false;
  /** the eye of the frame being drawn (the blob shadow hooks of records without a model need it) */
  private eye: ArrayLike<number> = [0, 0, 0];

  /**
   * FUN_0042271b's hooks for one record (controller.ts `runDrawHooks`): a node whose hook is the blob shadow (FUN_004bd41a = FUN_00444940) draws the shadow and reports what that function
   * leaves in eax; any other node's `draw` runs as it is. True = the default draw of the record is skipped.
   */
  private drawHooks(rec: GameRecord): boolean {
    const w = this.loaded.world;
    if (!rec.ctrl) return false;
    return runDrawHooks(w, rec, (n) => {
      if (n.blobShadow) return this.drawBlobShadow(rec, rec.m, rec.m.slice(), null, this.eye);
      if (n.kind === 'SeaAmin') { this.drawFoamHook(rec); return 1; }
      return n.draw?.(w, rec, rec.ctrl!);
    });
  }

  /**
   * The shore foam's draw hook FUN_004b109e (SeaAmin, the node's `draw` reports "handled" = 1, so the record's default draw does not run): it draws part 0's mesh itself,
   * `FUN_0043f1a0(mesh, record matrix, entry + 0xc, 3)` = draw mode 3 (block 0x10: no depth), whatever the part's mode (2) or the record's flags say; no LOD, no distance cull (the engine's own
   * clip-box test of FUN_0088aca2 is the GPU's clipping here). The hook runs on every pass the node ran, visible or not (its UV step, `SeaAminNode.prerender`, too).
   */
  private drawFoamHook(rec: GameRecord) {
    const rv = this.viewOf(rec.index);
    const part = rv?.parts[0];
    const m = part ? this.partMesh(part) : null;
    if (!part || !m) return;
    this.renderer.drawMesh(m, rec.m.slice(), (g) => this.texFor(part, g), { mode: 3, skinned: !!m.msh.svwl });
  }

  /**
   * FUN_00444940(record): the blob shadow of a record (docs/re/rendering.md section 9; geometry in shadow.ts, checked against the original on the emulator). Called by the game's
   * draw of skeleton records right after the model (here from `render`), and by node draw hooks of records the generic draw does not reach (the island's glider: FUN_004bd41a).
   *   * only zones that called FUN_00444850 and registered terrain records (FUN_00444ed0) have shadows (`ZoneSetup.shadow`): the rays go against exactly those records;
   *   * PEPP: type = var 0xc5 (-1 = none) and, while var 0xc6 is set, the flashing marker at bone 10 (FUN_00444ef0); every other record needs a controller whose flags have bit 0x10 or 0x40
   *     and a squared distance to the camera of at most 6400, and gets type 4;
   *   * the shadow sits under the hips (bone 0 times the record matrix) of a posed record unless var 0xa9 (PEPP_IN_VEHICLE) is set, else under the record's translation.
   * `mat` = the record's matrix, `world` = the matrix it is drawn with, `bones` = the pose of this frame (null when the record is not posed).
   * Returns what the original leaves in eax, which is what a node draw hook made of it reports to the draw pass (checked on the emulator, tools/tests/render-shadow.mjs): 0 when the zone has
   * no shadow system / no registered terrain or the record's controller lacks flags 0x10 / 0x40, else a non-zero, non-1 value (a stack pointer, -1 or the FPU status word's top bits): "handled".
   */
  drawBlobShadow(rec: GameRecord, mat: ArrayLike<number>, world: Float32Array, bones: Float32Array | null, eye: ArrayLike<number>): number {
    const ss = this.loaded.setup?.shadow;
    if (!ss || !ss.records.length || !this.shadowMesh || !this.shadowArchive) return 0;
    const w = this.loaded.world;
    const pepp = rec.name === 'PEPP';
    let type = 4;
    if (pepp) {
      if (w.vars.get(VAR_PEPP_MARKER) !== 0 && bones && bones.length >= 176) {
        if (this.markerPending) {   // FUN_00444ef0 adds DAT_008b1718 at every call = once per pass of the loop that drew the marker: the passes of this frame
          this.markerPending = false;
          for (const p of this.passes) this.markerTick = Math.fround(this.markerTick + p.dt);
        }
        if (markerVisible(this.markerTick)) this.drawShadowPoints(markerPoints(mulGame(bones.subarray(160, 176), world), eye), 7, 2);
      }
      type = w.vars.get(V.PEPPERSSHADOW);
    }
    const dx = eye[0] - mat[12], dy = eye[1] - mat[13], dz = eye[2] - mat[14];
    const gate = shadowGate({ terrain: true, pepp, type, hasCtrl: !!rec.ctrl, ctrlFlags: rec.ctrl?.flags ?? 0, dist2: dx * dx + dy * dy + dz * dz });
    if (!gate.draw) return gate.ret;
    const src = rec.anim && bones && bones.length >= 16 && w.vars.get(VAR_PEPP_IN_VEHICLE) === 0 ? mulGame(bones.subarray(0, 16), world) : mat;
    const ray: ShadowRay = (index, o) => {
      const target = w.records[index];
      if (!target) return null;
      const h = w.col.rayRecord(target, o, [0, -SHADOW_RAY_LENGTH, 0], SHADOW_RAY_MASK, SHADOW_RAY_RADIUS, 0);
      return h ? h.point : null;
    };
    // the original's rays also overwrite the "last polygon hit" (DAT_009deb78) the footstep sounds read; the port draws between simulation ticks, so that state is kept
    const lastHit = w.col.lastHit;
    const pts = blobShadowPoints({ x: src[12], y: src[13], z: src[14], fx: src[8], fz: src[10], type, seaLevel: w.seaLevel }, ss.records, ray);
    w.col.lastHit = lastHit;
    this.drawShadowPoints(pts, type, 0);
    return SHADOW_HANDLED;
  }
}

/**
 * The six planes IDirect3DDevice7::ComputeSphereVisibility builds from a row-vector view * projection matrix with GL clip space (-w..w): left, right, top, bottom, front, back,
 * float32, not normalised (the call normalises per sphere): `sprites.ts frustumPlanes` (Wine's native-measured ddraw implementation, tools/tests/d3d-spherevis.mjs).
 */
export function clipPlanes(vp: ArrayLike<number>, out: Float32Array): Float32Array {
  return frustumPlanes(vp, out);
}
