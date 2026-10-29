// Ontwikkelaarshoek, section 10: the NEUTRAL STAGE. A cutscene of another zone (or a script no zone declares, like adv06) cannot run in place: its actors are records of its own zone's
// world. The stage is a minimal world of its own: an empty `World`, the script's actors as placeholder records (4-letter names, parked on a ring around the origin), and the port's real
// cutscene manager (`CutsceneHost` of src/shell/cutscene-host.ts) pointed at the script's archive: the real scheduler (wait / signal ids, delays), the camera commands (waypoints of the
// archive's W_CSM / W_PATH maps, `.man` splines), SETPOSITION / SETSWITCH / SETFOV, the texts (message table) and the voice through the game's speech player run exactly as in a zone.
// What does NOT run (stated in the UI from `report()`): no zone geometry or models (a top-down plot of the camera and the placeholders is drawn instead), no animations (SETANIM does
// nothing: the placeholders have no rig), actor walks (no walkers: the stage's waypoint system has no walker), the zone's own switch dictionary (SETSWITCH of SWITCH_<zone>_* names
// is reported as unknown) and the zone's FOV / near plane (stub values).
import type { Shell } from '../shell/shell.ts';
import type { Hud } from '../shell/hud.ts';
import type { GameRenderer } from '../game/render.ts';
import { World } from '../game/world.ts';
import { GameRecord } from '../game/record.ts';
import { CutsceneHost } from '../shell/cutscene-host.ts';
import type { CutsceneSlotSpec } from '../shell/cutscene-host.ts';

export interface StageSpec extends CutsceneSlotSpec {
  /** 4-letter actor codes the script uses (placeholders are made for them) */
  actors: string[];
}

export interface StageReport {
  ticks: number;
  seconds: number;
  /** commands that finished / total / never started */
  finished: number;
  total: number;
  dead: number;
  /** the runner's own log (unknown actors, unresolved waypoints, missing splines, unknown switches ...) */
  log: string[];
}

type Pt = [number, number, number];

export class Stage {
  readonly world = new World();
  readonly host: CutsceneHost;
  readonly spec: StageSpec;
  readonly actors: GameRecord[] = [];
  /** the fake renderer / HUD the host drives (FOV, near plane, letterbox) */
  readonly gr = { fov: 1, near: 0.3 };
  readonly hud = { letterbox: 0 };
  /** the camera eye and look-at of every tick since the start */
  eyeTrail: Pt[] = [];
  tgtTrail: Pt[] = [];
  ticks = 0;
  /** the stage's own copies of the speech / subtitle options (start from the game's options; the panel can switch them: a script says its lines instantly with speech off) */
  speechOn = false;
  textOn = false;
  private skip = false;
  private started = false;

  private constructor(sh: Shell, spec: StageSpec, archive: ConstructorParameters<typeof CutsceneHost>[2]) {
    this.spec = spec;
    const w = this.world;
    w.zone = spec.zone;
    spec.actors.forEach((code, i) => {
      const r = new GameRecord(code);
      r.index = w.records.length;
      const a = (i / Math.max(1, spec.actors.length)) * Math.PI * 2;
      r.setEuler(0, 0, 0, Math.cos(a) * 6, 0, Math.sin(a) * 6);
      w.records.push(r);
      this.actors.push(r);
    });
    this.resetCamera();
    this.host = new CutsceneHost(sh, w, archive, this.gr as unknown as GameRenderer, this.hud as unknown as Hud);
    // the Shift key skips a script in the game (its input is the real one); this flag is the panel's "Overslaan"
    const env = this.host.runner.env, orig = env.skipPressed;
    this.speechOn = sh.options.speechOn; this.textOn = sh.options.subtitlesOn;
    env.speechOn = () => this.speechOn; env.textOn = () => this.textOn;
    env.skipPressed = () => { if (this.skip) { this.skip = false; return true; } return orig(); };
  }

  /** build a stage for a script: loads the archive, declares the script as slot 0 (script + message table + the `.man` splines it names) */
  static async create(sh: Shell, spec: StageSpec): Promise<Stage> {
    const archive = await sh.data.archive(spec.zone);
    const st = new Stage(sh, spec, archive);
    await st.host.declare([{ slot: 0, zone: spec.zone, script: spec.script, strings: spec.strings, area: spec.area }]);
    return st;
  }

  resetCamera() {
    const c = this.world.camera.c;
    c.set([0, 8, -18, 0, 2, 0, 0, 1, 0]);
    this.world.camera.updateView();
    this.world.camera.savePrev();
  }

  /** FUN_0045c40c(0) */
  start(): boolean {
    this.eyeTrail = []; this.tgtTrail = []; this.ticks = 0;
    this.world.vars.set(0xb, 0);
    this.started = this.host.start(0);
    this.note();
    return this.started;
  }

  get active(): boolean { return this.host.active(); }
  /** the script ran to its end (or was stopped) after a start */
  get finished(): boolean { return this.started && !this.host.active(); }

  /** one 30 Hz tick of the manager (FUN_0045c402) */
  step() {
    if (!this.host.active()) return;
    this.host.tick();
    this.ticks++;
    this.note();
  }

  private note() {
    const c = this.world.camera.c;
    this.eyeTrail.push([c[0], c[1], c[2]]);
    this.tgtTrail.push([c[3], c[4], c[5]]);
  }

  /** the Shift key of the game */
  skipNow() { this.skip = true; }
  stop() { this.host.abort(); this.started = false; }

  report(): StageReport {
    const r = this.host.runner, cmds = r.inspect().commands;
    return { ticks: this.ticks, seconds: this.ticks / 30, finished: cmds.filter((m) => m.state === 3).length, total: cmds.length, dead: cmds.filter((m) => m.dead).length, log: [...r.log] };
  }
}
