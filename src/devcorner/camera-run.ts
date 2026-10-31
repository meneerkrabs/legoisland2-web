// Section 4 "Camera en tekenen": the per-run hook (free camera, debug-draw queue, LOD switches, F8 autoplay, F10 / frustum helpers) and the state the UI edits.
// The pure logic lives in camera-free.ts / camera-draw.ts / camera-probes.ts / camera-lod.ts / camera-autoplay.ts / camera-frustum.ts; this file ties it to the running zone.
import type { Shell } from '../shell/shell.ts';
import type { ChaseCamera } from '../game/camera.ts';
import type { GameRecord } from '../game/record.ts';
import type { Renderer } from '../render/index.ts';
import { V } from '../game/vars.ts';
import { B } from '../game/input.ts';
import { savePhoto } from '../shell/screenshot.ts';
import type { DevCorner } from './corner.ts';
import type { RunCtx, RunHook, ZoneRun } from './types.ts';
import { FreeCam } from './camera-free.ts';
import { Autoplay } from './camera-autoplay.ts';
import { DebugQueue, drawQueue } from './camera-draw.ts';
import { makeCategories, ProbeSink, loadGraphs, queueGraph } from './camera-probes.ts';
import type { Category, GraphMap } from './camera-probes.ts';
import { AdaptiveDetail, readLodConsts } from './camera-lod.ts';
import { frustumObj, pyramidCorners } from './camera-frustum.ts';

/** the zones whose original code calls FUN_0088fd70 (0x6be13d z20DSP, 0x6f37c6 z21FSH, 0x706e0e z22BIP, 0x656b47 z15SSH): the free camera is "origineel" there */
export const FREE_CAM_ZONES = ['z20DSP', 'z21FSH', 'z22BIP', 'z15SSH'];

/** state that lives as long as the shell (the original's globals: DAT_00982d28.., DAT_009da634 / 638, DAT_05cb588c ...) */
export interface CameraState {
  free: FreeCam;
  freeOn: boolean;
  /** extension: the game's own tick does not see the pad bits while flying (the original keeps walking Pepper with the same keys) */
  pepperStill: boolean;
  /** start state: 'auto' = original start in the four original zones, the current camera elsewhere */
  start: 'auto' | 'origineel' | 'huidig';
  auto: Autoplay;
  /** what F8 does: the original's autoplay or the port's textured view plane */
  f8: 'autoplay' | 'kijkvlak';
  cats: Category[];
  sphereMarkers: boolean;
  gradient: boolean;
  /** extension: only draw graph nodes within this distance of the camera (0 = all, like the original) */
  graphRange: number;
  forceLod: boolean; forceLodLevel: number; forceLodAll: boolean;
  /** DAT_009e56b8 */
  adaptive: 0 | 1 | 2;
  detail: AdaptiveDetail;
  /** extension: the counter frequency assumed for FUN_00443e40's "10000 ticks" margin (Hz) */
  qpcHz: number;
  frustumDepth: number;
}

export function makeState(c: DevCorner): CameraState {
  const pe = c.sh.pe;
  return {
    free: new FreeCam(pe), freeOn: false, pepperStill: true, start: 'auto', auto: new Autoplay(), f8: 'autoplay',
    cats: makeCategories(), sphereMarkers: false, gradient: true, graphRange: 150,
    forceLod: false, forceLodLevel: readLodConsts(pe).debugLod, forceLodAll: false, adaptive: 0, detail: new AdaptiveDetail(readLodConsts(pe)), qpcHz: 1e6, frustumDepth: 100,
  };
}

export const stateOf = (c: DevCorner) => c.store<CameraState>('camera', () => makeState(c));

/** live numbers for the UI */
export interface LiveStats { lines: number; shapes: number; drawn: number; total: { lines: number; shapes: number }; overflows: number; screenLines: number; graphNodes: number; graphLinks: number }

export class CameraHook implements RunHook {
  readonly S: CameraState;
  readonly q = new DebugQueue();
  readonly sink: ProbeSink;
  stats: LiveStats = { lines: 0, shapes: 0, drawn: 0, total: { lines: 0, shapes: 0 }, overflows: 0, screenLines: 0, graphNodes: 0, graphLinks: 0 };
  private readonly sh: Shell;
  private readonly cam: ChaseCamera;
  private pad = 0;
  private saved: Float64Array | null = null;
  private pendingEnd = false;
  private leaveNext = false;
  private shot = false;
  private chaseOrig: ChaseCamera['chase'] | null = null;
  /** the camera FUN_0088fd70 wrote in the last tick (re-applied before every drawn frame: some zones update their camera after the hook's `afterSim`, e.g. z20DSP's loop does it in its `everyTick`) */
  private freeC = new Float64Array(18);
  private freeValid = false;
  private renderWrapped = false;
  private graphs: GraphMap[] | null = null;
  private bkd: { tick(q: DebugQueue, on: (t: string) => boolean): void } | null = null;
  private lastFrameAt = 0;
  private frame = 0;
  private farBase = 0; private farDelta = 0;
  private readonly lodsCache = new WeakMap<object, number[]>();
  private keyFn: ((e: KeyboardEvent) => void) | null = null;
  /** the pad word the free camera used last (for the UI) */
  lastPad = 0;
  readonly c: DevCorner;
  readonly run: RunCtx;

  constructor(c: DevCorner, run: RunCtx) {
    this.c = c; this.run = run;
    this.S = stateOf(c);
    this.sh = c.sh;
    this.cam = run.world.camera;
    this.sink = new ProbeSink(this.q, (t) => this.catOn(t));
    this.q.onOverflow = (w) => { c.toast(`Graph Queue has overflowed (${w}): wachtrij uitgezet voor dit beeld`); return false; };
    this.syncInstall();
    if (run.kind === 'zone') {
      this.keyFn = (e) => this.onKey(e);
      addEventListener('keydown', this.keyFn);
      if (run.info.id === 'z08BKD') void import('./camera-bkd.ts').then((m) => { this.bkd = m.bkdSource(run); }).catch((e) => console.warn('camera-bkd', e));
    }
    // a zone starts with the free camera still on when it was on before: take the start according to the setting
    if (this.S.freeOn) this.enableFree(true);
    if (this.S.auto.on) c.status('camera.auto', 'autoplay (F8) aan');
  }

  // ------------------------------------------------------------------------------------------------------------------ categories / install

  catOn(tag: string): boolean { return this.S.cats.find((k) => k.tag === tag)?.on ?? false; }
  anyDraw(): boolean { return this.S.cats.some((k) => k.on); }

  /** (re)install the sinks and hooks according to the switches: everything is null / unwrapped when nothing is on (default play: untouched) */
  syncInstall() {
    const any = this.anyDraw();
    this.q.master = any;
    this.run.world.col.debug = any ? this.sink : null;
    // the chase camera's target marker (FUN_00445c70 inside FUN_0042c227): wrap `chase` while the category is on
    if (this.catOn('camera') && !this.chaseOrig) {
      const cam = this.cam, orig = cam.chase;
      this.chaseOrig = orig;
      cam.chase = (...a: Parameters<ChaseCamera['chase']>) => {
        orig.apply(cam, a);
        if (this.catOn('camera')) this.q.shape([cam.c[3], cam.c[4] + 1, cam.c[5]], 1, 3.0, 0xff00ff00, 'camera');   // LE2.c:22021
      };
    } else if (!this.catOn('camera') && this.chaseOrig) { this.cam.chase = this.chaseOrig; this.chaseOrig = null; }
    this.syncLod();
  }

  syncLod() {
    const gr = this.run.gr, S = this.S;
    S.detail.mode = S.adaptive;
    gr.lodHook = S.forceLod || S.adaptive !== 0 ? (rec, parts, dist, zoom) => this.lodChoice(rec, parts, dist, zoom) : null;
    gr.farHook = S.adaptive !== 0 ? (base) => { this.farBase = base; S.detail.far = Math.fround(base + this.farDelta); return S.detail.far; } : null;
    if (S.adaptive === 0) this.farDelta = 0;
  }

  private lodChoice(rec: GameRecord, parts: readonly { lod: number }[], dist: number, zoom: number): number | null {
    const S = this.S;
    if (parts.length < 2) return null;
    if (S.forceLod && (rec.anim || S.forceLodAll)) return Math.min(S.forceLodLevel, parts.length - 1);   // FUN_0044d420: DAT_05d37024 -> DAT_008b6c54
    if (S.adaptive === 0) return null;
    let l = this.lodsCache.get(parts);
    if (!l) { l = parts.map((p) => p.lod); this.lodsCache.set(parts, l); }
    return S.detail.choose(l, 0, rec.name, Math.fround(dist * dist), zoom);   // FUN_00443f90 (the forced flag bits are handled by the renderer before)
  }

  // ------------------------------------------------------------------------------------------------------------------ free camera

  /** is the original's own code the one that has this camera in this zone (FUN_0088fd70 call sites) */
  isOriginalZone(): boolean { return this.run.kind === 'zone' && FREE_CAM_ZONES.includes(this.run.info.id); }

  enableFree(on: boolean) {
    const S = this.S, c = this.cam.c;
    if (on === S.freeOn && (on === !!this.saved)) return;
    S.freeOn = on;
    this.freeValid = false;
    this.wrapRender(on);
    if (on) {
      this.saved = Float64Array.from(c);
      const mode = S.start === 'auto' ? (this.isOriginalZone() ? 'origineel' : 'huidig') : S.start;
      if (mode === 'origineel') S.free.reset(); else S.free.takeOver([c[0], c[1], c[2]], [c[3], c[4], c[5]]);
    } else if (this.saved) {
      for (let i = 0; i < 18; i++) c[i] = this.saved[i];
      this.saved = null;
    }
    this.c.status('camera.free', on ? 'vrije camera aan (pijlen)' : '');
  }

  /**
   * the original calls FUN_0088fd70 at the end of the loop's camera code; the port's zones order their camera updates differently (z20DSP updates its camera in its `everyTick`, after
   * `afterSim`), so while the free camera is on the result is also put back right before each frame is drawn (an instance wrapper of `GameRenderer.render`, removed again when it is off)
   */
  private wrapRender(on: boolean) {
    const gr = this.run.gr;
    if (on && !this.renderWrapped) {
      const render = gr.render;
      gr.render = (alpha: number, dt: number) => { if (this.S.freeOn && this.freeValid) this.applyFree(); render.call(gr, alpha, dt); };
      this.renderWrapped = true;
    } else if (!on && this.renderWrapped) { delete (gr as unknown as { render?: unknown }).render; this.renderWrapped = false; }
  }

  /** write the free camera into the zone's camera record (eye, target, up, basis) and make it the previous one too: no smear between ticks */
  private applyFree() {
    const c = this.cam.c;
    for (let i = 0; i < 18; i++) c[i] = this.freeC[i];
  }

  // ------------------------------------------------------------------------------------------------------------------ RunHook

  private paused(): boolean { return this.c.isOpen && this.c.pause; }

  tick() {
    const S = this.S;
    if (this.shot) { this.shot = false; this.takeShot(); }
    if (this.paused()) return;
    // F8 autoplay: the end of the previous frame when a non-play mode gave it no afterSim / storyLeave (FUN_00423f7b runs in every mode)
    if (this.pendingEnd && S.auto.on) { if (S.auto.frameEnd(this.story())) this.leaveNext = true; }
    this.pendingEnd = true;
    const inp = this.sh.input;
    if (S.auto.on) { const r = S.auto.apply(inp.held, inp.pressed); inp.held = r.held; inp.pressed = r.pressed; }   // FUN_00423170's tail
    // free camera: the pad word is read by the flying camera; Pepper stands still meanwhile (extension, switchable)
    this.pad = inp.held;
    if (S.freeOn && S.pepperStill) { const m = ~(B.LEFT | B.RIGHT | B.UP | B.DOWN | B.CTRL) >>> 0; inp.held = (inp.held & m) >>> 0; inp.pressed = (inp.pressed & m) >>> 0; }
    this.q.beginTick();
    if (this.catOn('graph')) this.queueGraphs();
  }

  afterSim() {
    const S = this.S;
    if (this.bkd && this.catOn('bkd')) this.bkd.tick(this.q, (t) => this.catOn(t));
    if (S.freeOn) {
      this.lastPad = this.pad;
      S.free.step(this.pad, this.run.world.dt, this.cam.c);    // FUN_00890000 -> FUN_0088fd70(view, &DAT_009da5e8): overwrites the camera after the zone's own update
      this.freeC.set(this.cam.c); this.freeValid = true;
    }
  }

  storyLeave(): boolean {
    const S = this.S;
    this.pendingEnd = false;
    let r = false;
    if (S.auto.on) r = S.auto.frameEnd(this.story());
    if (this.leaveNext) { r = true; this.leaveNext = false; }
    return r;
  }

  private lastStep = -1;
  draw3d(r: Renderer, _eye: [number, number, number]) {
    const S = this.S;
    void _eye;
    // FUN_00443e40 runs once per loop pass = once per sim step, the render hook runs at the display rate: the frame time (wall clock, like the original's QueryPerformanceCounter) is taken once per sim step
    const step = this.run.world.tickCount;
    if (step !== this.lastStep) {
      this.lastStep = step;
      this.frame++;
      if (S.adaptive !== 0) {
        const now = performance.now();
        if (this.lastFrameAt) {
          const k = S.detail.k, ticksPerMs = S.qpcHz / 1000;
          S.detail.frameTime((now - this.lastFrameAt) * ticksPerMs, S.qpcHz * k.period, 10000, this.frame);
          this.farDelta = S.detail.far - this.farBase;
        }
        this.lastFrameAt = now;
      } else this.lastFrameAt = 0;
    }
    const q = this.q;
    this.stats.lines = q.lines.length; this.stats.shapes = q.shapes.length;
    this.stats.total = q.total; this.stats.overflows = q.overflows;
    this.stats.screenLines = q.lines.reduce((n, l) => n + (l.mode !== 0 ? 1 : 0), 0);
    if (!q.master) { this.stats.drawn = 0; return; }
    this.stats.drawn = drawQueue(r, q, { sphereMarkers: S.sphereMarkers, show: (t) => this.catOn(t), gradientPieces: S.gradient ? 8 : 1 });
  }

  destroy() {
    if (this.keyFn) removeEventListener('keydown', this.keyFn);
    this.enableFreeQuiet();
    this.run.world.col.debug = null;
    if (this.chaseOrig) { this.cam.chase = this.chaseOrig; this.chaseOrig = null; }
    this.run.gr.lodHook = null; this.run.gr.farHook = null;
    this.wrapRender(false);
    this.c.status('camera.free', '');
  }

  /** the run ends: the saved chase camera belongs to a zone that is gone; the flag stays on for the next zone (the original's globals) */
  private enableFreeQuiet() { this.saved = null; }

  // ------------------------------------------------------------------------------------------------------------------ F8, F10, graph, frustum

  private story() {
    const sh = this.sh;
    return { currentZone: () => sh.vars.get(V.CURRENT_SUBGAME), advance: () => sh.story.advance(), nodeZone: () => sh.story.zoneOf() };
  }

  /** the window's keydown: F8 (the corner owns the key, src/shell/playzone.ts skips its old view-plane toggle when the corner exists) */
  private onKey(e: KeyboardEvent) {
    if (e.code !== 'F8' || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (this.c.isOpen && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    e.preventDefault();
    this.pressF8();
  }
  pressF8() {
    const S = this.S;
    if (S.f8 === 'kijkvlak') {
      const gr = this.run.gr;
      gr.viewPlaneTextured = !gr.viewPlaneTextured;
      this.c.toast(`F8: gestructureerd kijkvlak ${gr.viewPlaneTextured ? 'aan' : 'uit'}`);
      return;
    }
    const on = S.auto.toggle();
    this.c.status('camera.auto', on ? 'autoplay (F8) aan' : '');
    this.c.toast(`F8: autoplay ${on ? 'aan' : 'uit'}`);
  }
  setAutoplay(on: boolean) { if (this.S.auto.on !== on) { this.S.auto.on = on; this.c.status('camera.auto', on ? 'autoplay (F8) aan' : ''); } }

  /** F10 (FUN_0040cd27): the picture is taken after this tick's frame has been drawn */
  requestShot() { this.shot = true; }
  private takeShot() {
    const inp = this.sh.input;
    if (inp.onScreenshot) inp.onScreenshot();
    else queueMicrotask(() => { try { savePhoto(this.sh.canvas); } catch (e) { console.warn('screenshot', e); } });
  }

  private queueGraphs() {
    const run = this.run;
    if (run.kind !== 'zone') return;
    if (!this.graphs) this.graphs = loadGraphs((run as ZoneRun).archive);
    const c = this.cam.c;
    const range = this.S.graphRange > 0 ? this.S.graphRange : Infinity;
    let nodes = 0, links = 0;
    for (const m of this.graphs) { const r = queueGraph(this.q, m, [c[0], c[1], c[2]], range); nodes += r.nodes; links += r.links; }
    this.stats.graphNodes = nodes; this.stats.graphLinks = links;
  }
  graphMaps(): string[] { return (this.graphs ?? []).map((g) => `${g.name} (${g.graph.nodes.length})`); }
  hasGraphs(): boolean { if (this.run.kind !== 'zone') return false; if (!this.graphs) this.graphs = loadGraphs((this.run as ZoneRun).archive); return this.graphs.length > 0; }

  /** FUN_00415497: the OBJ text for the current camera (eye = apex, corners at `depth`, target = p2) */
  frustumText(): string {
    const gr = this.run.gr, info = gr.info;
    const pts = pyramidCorners(info.eye, info.target, gr.fov, gr.renderer.aspect, this.S.frustumDepth);
    return frustumObj(this.sh.pe, info.eye, info.target, pts);
  }
}
