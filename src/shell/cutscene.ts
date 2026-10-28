// The cutscene manager ("CSM", Common\CSM, Manager.c; docs/re/architecture.md 5): a minimal runner of the compiled `.cut` scripts (src/formats/cutscene.ts), DOM-free.
// A zone declares script slots (`FUN_0045c310(n)` + `FUN_0045c397(slot, script, messages)`), starts one (`FUN_0045c40c(slot)`) and calls `tick()` every frame of the modes that
// run it (`FUN_0045c402`); `active()` is `FUN_0045c432`. Commands are scheduled by wait / signal ids exactly like `FUN_00459119` (3 passes: start pending commands whose wait counter
// is 0, run the running ones, finish the done ones); the script ends in the frame in which no command ran.
//
// INSTRUCTION COVERAGE (ids of FUN_0045988b; see docs/re/m3/z40aPO.md for the table with the handler addresses)
//   done, ported 1:1 from the decompile : SETVISIBILITY (0), SAYTEXT (2: speech, subtitle lines, min. time (len + 20 + duration) / 20 s, Shift skips), SETTARGET (3: actor yaw / camera look-at),
//                                         SETPOSITION (5, waypoint targets: actor teleport / camera eye), MOVEPOSITION and MOVETARGET of the CAMERA to a waypoint or an actor (6 / 4: the eased
//                                         move of FUN_0045edae / 0045eff9 / 0045f1bc / 0045f2f4), SETSWITCH (8), SETMOVESPEED / SETTARGETSPEED (10 / 11), SETFOV (12), ENABLEAI (15), the delays,
//                                         the wait / signal scheduling, the skip key (Shift) and the end of the script (FOV, bars, PEPPER_CONTROL)
//   approximated                        : SETPOSITION with actor targets and sides (camera placed behind / in front / beside the actor at 3.37 height instead of FUN_00422f21), MOVEPOSITION of an actor
//                                         (walks straight to the waypoint at `ACTOR_SPEED` instead of the waypoint walker), SETANIM (starts the clip the env maps the name to and waits for its end;
//                                         the per-zone name dictionaries are not extracted: without a mapping it is a no-op), FOLLOW of the camera (look-at follows the actor at +3.37)
//   no-ops (done at once)               : FOLLOW of actors, SETEXPRESSION (mouth / face frames), ATTACH, WAV / MIDI (never emitted), spline targets (kind 2), commands of unknown actors
//   not done                            : the end-of-script clean-up of Pepper (idle animation, camera behind her, walker re-pin), the random mouth frames of speaking actors
import type { Cutscene, CutCommand } from '../formats/cutscene.ts';
import type { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { V } from '../game/vars.ts';

/** units per tick of an actor's MOVEPOSITION (approximation of the waypoint walker) */
export const ACTOR_SPEED = 0.5;
/** the camera looks at an actor 3.37 above its position (0x892380) */
export const ACTOR_LOOK_HEIGHT = 3.37;
/** seconds per tick: 0.03333 (0x8922bc) */
export const SEC_PER_TICK = 0.03333;

export interface CutsceneEnv {
  world: World;
  /** FUN_00462b4e: waypoint position by name (the CSM map first, then PATH, prefix match), null when unknown */
  waypoint(name: string): [number, number, number] | null;
  /** the message text of the script's table (for the subtitle and the minimum time) */
  text(id: string): string;
  /** FUN_00435a11: start the line's voice (muted / unavailable: false is fine); returns false while another line is still playing */
  say(id: string): boolean;
  /** FUN_00435ad3 */
  speechIdle(): boolean;
  /** FUN_00435b07 */
  stopSpeech(): void;
  /** FUN_0040cd1a: set the projection's FOV (radians) */
  setFov(fov: number): void;
  /** the Shift key went down this tick (pressed edge of mask 0x40) */
  skipPressed(): boolean;
  /** options: var 9 (speech on) and var 0 (subtitles on) */
  speechOn(): boolean;
  textOn(): boolean;
  /** letterbox bars (FUN_0045f750): 0 off, 1 top + bottom */
  letterbox(mode: 0 | 1 | 2): void;
  /** SETANIM: the clip number of an animation name for this actor, null = unknown (the command is then a no-op) */
  animClip?(actor: GameRecord, name: string): number | null;
  /** game variable index of a SETSWITCH name (the zone's switch dictionary, then the SWITCH_GME table); null = unknown */
  varIndex?(name: string): number | null;
  /** the current FOV (saved at the start, restored at the end) */
  getFov?(): number;
}

export interface CutsceneSlot { name: string; script: Cutscene }

/** command states: 0 pending, 1 running, 2 done (its signal id is released next), 3 finished */
const St = { Pending: 0, Running: 1, Done: 2, Finished: 3 } as const;
type St = (typeof St)[keyof typeof St];

interface Cmd {
  c: CutCommand;
  state: St;
  /** seconds left of the start delay */
  delay: number;
  /** seconds left of the command's own timer (duration / speech) */
  timer: number;
  actor: GameRecord | null;
  global: boolean;
  started: boolean;
  /** per command scratch */
  x: Record<string, unknown>;
}

/** the camera's eased move (FUN_0045edae / 0045eff9 / 0045f1bc / 0045f2f4): ease-in to `maxStep` per tick, ease-out in the last stretch */
export class EasedMove {
  private to: [number, number, number];
  private v: [number, number, number] = [0, 0, 0];
  private unit: [number, number, number] = [0, 0, 0];
  private remaining: number;
  private travelled = 0;
  private phase = 0;
  private easeStep: number;
  private lastRemaining = 0;
  constructor(from: ArrayLike<number>, to: ArrayLike<number>, maxStep: number, easeStep: number) {
    this.to = [to[0], to[1], to[2]];
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    this.unit = l ? [(d[0] / l) * maxStep, (d[1] / l) * maxStep, (d[2] / l) * maxStep] : [0, 0, 0];
    this.remaining = l;
    this.easeStep = easeStep;
  }
  /** one tick; moves `p` (the camera eye or look-at); true when it has arrived */
  step(p: number[]): boolean {
    if (this.travelled < this.remaining) {
      // FUN_0045eff9: accelerate until the phase reaches 1, then cruise
      if (this.phase < 1) {
        this.phase += this.easeStep;
        this.v = [this.unit[0] * this.phase, this.unit[1] * this.phase, this.unit[2] * this.phase];
        this.travelled += Math.hypot(this.v[0], this.v[1], this.v[2]);
      }
      p[0] += this.v[0]; p[1] += this.v[1]; p[2] += this.v[2];
      this.remaining = Math.hypot(p[0] - this.to[0], p[1] - this.to[1], p[2] - this.to[2]);
      return false;
    }
    if (0.01 < this.remaining) {
      // FUN_0045f1bc: slow down by easeStep per tick (not below one step), keep moving
      if (0 < this.phase) this.phase = this.easeStep <= this.phase - this.easeStep ? this.phase - this.easeStep : this.easeStep;
      this.v = [this.unit[0] * this.phase, this.unit[1] * this.phase, this.unit[2] * this.phase];
      p[0] += this.v[0]; p[1] += this.v[1]; p[2] += this.v[2];
      this.remaining = Math.hypot(p[0] - this.to[0], p[1] - this.to[1], p[2] - this.to[2]);
      if (this.remaining !== this.lastRemaining) { this.lastRemaining = this.remaining; return this.arrived(p); }
      this.lastRemaining = 0;
    }
    this.remaining = 0;
    return this.arrived(p, true);
  }
  private arrived(p: number[], force = false): boolean {
    const speed = Math.hypot(this.v[0], this.v[1], this.v[2]);
    if (force || this.remaining <= speed) { this.remaining = 0; p[0] = this.to[0]; p[1] = this.to[1]; p[2] = this.to[2]; return true; }
    return false;
  }
}

export class CutsceneRunner {
  readonly env: CutsceneEnv;
  private slots: (CutsceneSlot | null)[] = [];
  private cmds: Cmd[] = [];
  private counters = new Uint8Array(0x201);
  private current = -1;
  /** the slot of the script that runs (or ran last) */
  get currentSlot() { return this.current; }
  private queued = -1;
  private running = false;
  /** DAT_05d4dc8c: a zone / dialog holds the "cutscene active" state on (FUN_0045c456) */
  override = false;
  /** the camera block (18 floats) and FOV saved at the start */
  savedCamera: Float64Array | null = null;
  private savedFov = 1;
  /** DAT_05d482f8 / fc / 300 / 304: camera ease constants (SETMOVESPEED / SETTARGETSPEED) */
  moveSpeed = { ease: 0.08, max: 0.4 };
  targetSpeed = { ease: 0.08, max: 0.4 };
  /** the registered actors (FUN_00458fa6) */
  private actors = new Set<GameRecord>();
  /** the subtitle of the SAYTEXT that is running (4 lines are drawn by the HUD in the original) */
  subtitle: { id: string; text: string } | null = null;
  /** diagnostics for tests */
  log: string[] = [];
  /** the camera's look-at follows this record (FOLLOW of CMRA) */
  private follow: GameRecord | null = null;
  private camMove: { move: EasedMove; target: number; done: boolean } | null = null;
  ticks = 0;

  constructor(env: CutsceneEnv) { this.env = env; }

  /** FUN_0045c310(n) */
  allocate(n: number) { this.slots = new Array(n).fill(null); }
  /** FUN_0045c397(slot, script, messages): the zone loads the compiled script (`parseCutscene`) and gives the runner the table lookup through the env */
  define(slot: number, name: string, script: Cutscene) { this.slots[slot] = { name, script }; }
  get slotCount() { return this.slots.length; }

  /** FUN_0045c432: a script is running (or a zone holds the flag) */
  active(): boolean { return this.override || this.running; }

  /** FUN_0045c40c / FUN_00458d15: start a script; ignored while the game was started from the menu (var 0xb) */
  start(slot: number): boolean {
    const w = this.env.world;
    if (w.vars.get(0xb) !== 0) return false;
    if (slot < 0 || slot >= this.slots.length || !this.slots[slot]) return false;
    if (this.running) { if (this.queued < 0) this.queued = slot; return false; }
    this.begin(slot);
    return true;
  }

  private begin(slot: number) {
    const w = this.env.world;
    const sc = this.slots[slot]!;
    this.current = slot;
    this.savedCamera = Float64Array.from(w.camera.c);
    this.savedFov = this.env.getFov?.() ?? 1;
    this.moveSpeed = { ease: 0.08, max: 0.4 };
    this.targetSpeed = { ease: 0.08, max: 0.4 };
    this.follow = null; this.camMove = null; this.subtitle = null;
    this.actors.clear();
    this.cmds = sc.script.commands.map((c) => {
      // the global handler (FUN_0045eaf0) serves the commands whose actor pointer is null: the camera and the switch actor
      const global = c.actor === 'CMRA' || c.actor === 'SWCH';
      const actor = global ? null : (w.records.find((r) => r.name === c.actor) ?? null);
      return { c, state: St.Pending, delay: c.delay, timer: 0, actor, global, started: false, x: {} };
    });
    // FUN_00458c15: how many commands signal each id (0xff = nobody)
    this.counters.fill(0xff); this.counters[0] = 0;
    for (const m of this.cmds) {
      const s = m.c.signalId;
      if (s !== 0) { if (this.counters[s] === 0xff) this.counters[s] = 0; this.counters[s]++; }
    }
    this.running = true;
    this.env.letterbox(1);
    w.vars.or(V.PEPPER_CONTROL, 0x100);
    this.log.push(`start ${sc.name}`);
  }

  /** FUN_0045c402 / FUN_00458f50: one tick */
  tick() {
    if (!this.running) return;
    this.ticks++;
    const ran = this.schedule();
    // FUN_00459740: the actors' animations advance
    for (const a of this.actors) a.anim?.advance(1);
    if (this.follow) this.setLookAt(this.follow);
    this.syncCamera();
    if (!ran) this.end();
  }

  private syncCamera() { this.env.world.camera.updateView(); }

  /** FUN_00459119: the three passes; true when a command ran */
  private schedule(): boolean {
    let ran = false;
    for (const m of this.cmds) {
      if (m.state === St.Pending && this.counters[m.c.waitId] === 0) {
        m.state = St.Running;
        if (m.actor && !m.global) this.register(m.actor);
      }
    }
    for (const m of this.cmds) {
      if (m.state !== St.Running) continue;
      if (m.c.cmd === 7) {           // FOLLOW: runs on, never keeps the script alive, finishing does not count
        const r = this.run(m);
        if (r !== 1) m.state = r === 2 ? St.Done : St.Running;
      } else {
        ran = true;
        const r = this.run(m);
        m.state = r === 2 ? St.Done : St.Running;
      }
    }
    for (const m of this.cmds) {
      if (m.state === St.Done) { if (m.c.signalId !== 0) this.counters[m.c.signalId]--; m.state = St.Finished; }
    }
    return ran;
  }

  /** FUN_00458fa6: an actor takes part: its AI is switched off while the script runs */
  private register(a: GameRecord) {
    if (this.actors.size >= 48) return;
    this.actors.add(a);
    if (a.ctrl) a.ctrl.flags &= ~2;
  }

  /** FUN_00459597: the delay, then the command's handler; 1 = running, 2 = done */
  private run(m: Cmd): number {
    if (this.env.skipPressed()) m.delay = 0;
    if (m.delay > 0) { m.delay -= SEC_PER_TICK * this.env.world.dt; return 1; }
    return m.global ? this.runGlobal(m) : this.runActor(m);
  }

  private dt() { return this.env.world.dt; }
  private timerTick(m: Cmd): boolean {
    if (this.env.skipPressed()) m.timer = 0;
    m.timer -= SEC_PER_TICK * this.dt();
    return m.timer > 0;
  }

  // ---------------------------------------------------------------------------------------------------------------- actor commands (FUN_0045c49d)
  private runActor(m: Cmd): number {
    const c = m.c, a = m.actor;
    if (!a) return 2;                                              // unknown actor: the loader zeroes the rest of the script, the command does nothing
    switch (c.cmd) {
      case 0: { if (c.flag) a.show(); else a.hide(); return 2; }    // FUN_0045c595
      case 1: return this.setAnim(m, a);                            // FUN_0045ce77 (approximated)
      case 2: return this.sayText(m, a);                            // FUN_0045cf83
      case 3: {                                                     // FUN_0045cd23: yaw towards a point
        let p: number[] | null = null;
        if (c.targetKind === 'waypoint') p = this.env.waypoint(c.target ?? '');
        else if (c.targetKind === 'actor') { const t = this.env.world.records.find((r) => r.name === c.target); p = t ? [t.x, t.y, t.z] : null; if (!t) return 2; }
        if (!p) return 2;
        a.ry = -Math.atan2(-(p[0] - a.x), p[2] - a.z);
        a.setEuler(a.rx, a.ry, a.rz, a.x, a.y, a.z);
        return 2;
      }
      case 5: {                                                     // FUN_0045c5e2: teleport to a waypoint
        if (c.targetKind !== 'waypoint') return 2;
        const p = this.env.waypoint(c.target ?? '');
        if (p) { a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]); }
        return 2;
      }
      case 6: return this.moveActor(m, a);                          // FUN_0045c66b (approximated)
      case 13: case 14: case 7: return 2;                           // SETEXPRESSION / ATTACH / FOLLOW: no-ops
      case 15: { if (a.ctrl) { if (c.flag) a.ctrl.flags |= 2; else a.ctrl.flags &= ~2; } return 2; }   // FUN_0045d301
      default: return 2;
    }
  }

  private setAnim(m: Cmd, a: GameRecord): number {
    if (!m.started) {
      m.started = true;
      const clip = this.env.animClip?.(a, m.c.anim ?? '') ?? null;
      if (clip === null || !a.anim) return 2;
      a.anim.start(clip, 0);
      m.x.clip = clip;
      m.timer = m.c.duration;
    }
    if (m.x.clip === undefined) return 2;
    // done when the clip has played out (a one-shot wraps: frame returns near 0 after the end) and the extra duration is over
    const an = a.anim!;
    const len = an.frameCount;
    if (an.frame < len - 2 && !(m.x.ended)) { if (this.env.skipPressed()) m.x.ended = true; return 1; }
    m.x.ended = true;
    return this.timerTick(m) ? 1 : 2;
  }

  private moveActor(m: Cmd, a: GameRecord): number {
    const c = m.c;
    if (c.targetKind !== 'waypoint') return 2;
    const p = this.env.waypoint(c.target ?? '');
    if (!p) return 2;
    if (!m.started) { m.started = true; m.timer = c.duration; }
    if (this.env.skipPressed()) { a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]); }
    const dx = p[0] - a.x, dy = p[1] - a.y, dz = p[2] - a.z, d = Math.hypot(dx, dy, dz);
    if (d > ACTOR_SPEED * this.dt()) {
      const k = (ACTOR_SPEED * this.dt()) / d;
      a.ry = -Math.atan2(-dx, dz);
      a.setEuler(a.rx, a.ry, a.rz, a.x + dx * k, a.y + dy * k, a.z + dz * k);
      return 1;
    }
    a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]);
    return this.timerTick(m) ? 1 : 2;
  }

  // ---------------------------------------------------------------------------------------------------------------- SAYTEXT
  /**
   * FUN_0045cf83: the line is spoken (when speech is on) and shown (when subtitles are on); it lasts until the voice has finished AND (strlen + 20 + duration) / 20 seconds are
   * over; Shift stops the voice and ends it at once. `m.x.speaking` = node +0x30 == 0.
   */
  private sayText(m: Cmd, _a: GameRecord): number {
    const env = this.env, c = m.c, id = c.textId ?? '';
    if (!m.started) {
      m.started = true;
      const t = env.text(id);
      m.timer = (t.length + 20 + c.duration) / 20;
      this.subtitle = env.textOn() ? { id, text: t } : null;
      m.x.speaking = env.speechOn();
      m.x.said = false;
    }
    if (m.x.speaking) {
      if (!m.x.said) { if (env.say(id)) m.x.said = true; }                      // the voice starts when no other speech plays
      else if (env.speechIdle()) m.x.speaking = false;                          // the voice finished
    }
    if (env.skipPressed()) { env.stopSpeech(); m.x.speaking = false; m.timer = 0; }
    m.timer -= SEC_PER_TICK * this.dt();
    if (m.x.speaking || m.timer > 0) return 1;
    this.subtitle = null;
    return 2;
  }

  // ---------------------------------------------------------------------------------------------------------------- global / camera commands (FUN_0045eaf0)
  private runGlobal(m: Cmd): number {
    const c = m.c, w = this.env.world, cam = w.camera.c;
    switch (c.cmd) {
      case 3: return this.camSetTarget(m);                           // FUN_0045ec4f
      case 4: return this.camMoveTarget(m);                          // FUN_0045eeaa
      case 5: return this.camSetPosition(m);                         // FUN_0045ebc8
      case 6: return this.camMovePosition(m);                        // FUN_0045ecec
      case 7: { const t = w.records.find((r) => r.name === c.other); if (t) this.follow = t; return 1; }   // FUN_0045f543 (camera follows the actor)
      case 8: {                                                      // FUN_0045f670: SETSWITCH
        if (!m.started) {
          m.started = true;
          const idx = this.env.varIndex?.(c.switchName ?? '') ?? w.vars.indexOf(c.switchName ?? '');
          if (idx !== null && idx !== undefined && idx >= 0) w.vars.set(idx, c.switchValue ?? 0);
          else this.log.push(`switch ${c.switchName}: unknown`);
          m.timer = c.duration;
        }
        return this.timerTick(m) ? 1 : 2;
      }
      case 9: return 2;                                              // WAV / MIDI: a stub
      case 10: { this.moveSpeed = { ease: (c.speedB ?? 0) * 0.02, max: (c.speedA ?? 0) * 0.1 }; return 2; }   // FUN_0045f5b8: +0x26 (b) * 0.02, +0x24 (a) * 0.1
      case 11: { this.targetSpeed = { ease: (c.speedB ?? 0) * 0.02, max: (c.speedA ?? 0) * 0.1 }; return 2; }
      case 12: { this.env.setFov(c.fov ?? 1); return 2; }           // FUN_0045f64b
      default: void cam; return 2;
    }
  }

  private setLookAt(t: GameRecord) {
    const c = this.env.world.camera.c;
    c[3] = t.x; c[4] = t.y + ACTOR_LOOK_HEIGHT; c[5] = t.z;
  }

  private camSetTarget(m: Cmd): number {
    const c = m.c, cam = this.env.world.camera.c;
    if (c.targetKind === 'actor') {
      const t = this.env.world.records.find((r) => r.name === c.target);
      if (!t) return 2;
      cam[3] = t.x; cam[4] = t.y + ACTOR_LOOK_HEIGHT; cam[5] = t.z;
    } else {
      const p = this.env.waypoint(c.target ?? '');
      if (p) { cam[3] = p[0]; cam[4] = p[1]; cam[5] = p[2]; }
    }
    this.camMove = this.camMove?.target === 1 ? null : this.camMove;
    return 2;
  }

  private camSetPosition(m: Cmd): number {
    const c = m.c, cam = this.env.world.camera.c;
    if (c.targetKind === 'actor') {
      // FUN_00422f21 (side flags, 3.37 height): approximated by a place behind / in front of / beside the actor
      const t = this.env.world.records.find((r) => r.name === c.target);
      if (!t) return 2;
      const side = c.side ?? 0, d = 4, h = ACTOR_LOOK_HEIGHT;
      const fwd = [Math.sin(t.ry), Math.cos(t.ry)], right = [Math.cos(t.ry), -Math.sin(t.ry)];
      const o = side === 1 ? [fwd[0] * d, fwd[1] * d] : side === 2 ? [-fwd[0] * d, -fwd[1] * d] : side === 3 ? [-right[0] * d, -right[1] * d] : side === 4 ? [right[0] * d, right[1] * d] : [0, 0];
      cam[0] = t.x + o[0]; cam[1] = t.y + h; cam[2] = t.z + o[1];
    } else {
      const p = this.env.waypoint(c.target ?? '');
      if (p) { cam[0] = p[0]; cam[1] = p[1]; cam[2] = p[2]; }
    }
    this.camMove = this.camMove?.target === 0 ? null : this.camMove;
    return 2;
  }

  private camMovePosition(m: Cmd): number {
    const c = m.c, w = this.env.world;
    if (c.targetKind === 'spline') return 2;                      // spline tracks (.man): not done
    if (!m.started) {
      m.started = true; m.timer = c.duration;
      const p = this.destination(c);
      if (!p) return 2;
      m.x.eye = [w.camera.c[0], w.camera.c[1], w.camera.c[2]];
      m.x.move = new EasedMove(m.x.eye as number[], p, this.moveSpeed.max, this.moveSpeed.ease);
    }
    const mv = m.x.move as EasedMove | undefined;
    if (!mv) return 2;
    if (this.env.skipPressed()) { const p = this.destination(c)!; w.camera.c[0] = p[0]; w.camera.c[1] = p[1]; w.camera.c[2] = p[2]; m.timer = 0; return 2; }
    const eye = m.x.eye as number[];
    eye[0] = w.camera.c[0]; eye[1] = w.camera.c[1]; eye[2] = w.camera.c[2];
    const done = mv.step(eye);
    w.camera.c[0] = eye[0]; w.camera.c[1] = eye[1]; w.camera.c[2] = eye[2];
    if (!done) return 1;
    return this.timerTick(m) ? 1 : 2;
  }

  private camMoveTarget(m: Cmd): number {
    const c = m.c, w = this.env.world;
    if (c.targetKind === 'spline') return 2;
    if (!m.started) {
      m.started = true; m.timer = c.duration;
      const p = this.destination(c, true);
      if (!p) return 2;
      m.x.look = [w.camera.c[3], w.camera.c[4], w.camera.c[5]];
      m.x.move = new EasedMove(m.x.look as number[], p, this.targetSpeed.max, this.targetSpeed.ease);
    }
    const mv = m.x.move as EasedMove | undefined;
    if (!mv) return 2;
    if (this.env.skipPressed()) { const p = this.destination(c, true)!; w.camera.c[3] = p[0]; w.camera.c[4] = p[1]; w.camera.c[5] = p[2]; m.timer = 0; return 2; }
    const look = m.x.look as number[];
    look[0] = w.camera.c[3]; look[1] = w.camera.c[4]; look[2] = w.camera.c[5];
    const done = mv.step(look);
    w.camera.c[3] = look[0]; w.camera.c[4] = look[1]; w.camera.c[5] = look[2];
    if (!done) return 1;
    return this.timerTick(m) ? 1 : 2;
  }

  private destination(c: CutCommand, lookAt = false): number[] | null {
    if (c.targetKind === 'waypoint') return this.env.waypoint(c.target ?? '');
    if (c.targetKind === 'actor') {
      const t = this.env.world.records.find((r) => r.name === c.target);
      return t ? [t.x, t.y + (lookAt ? ACTOR_LOOK_HEIGHT : 0), t.z] : null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------------------------- the end (FUN_00459119's last branch)
  private end() {
    const env = this.env, w = env.world;
    for (const a of this.actors) if (a.ctrl) a.ctrl.flags |= 2;
    this.actors.clear();
    env.setFov(this.savedFov);
    this.running = false;
    this.subtitle = null;
    this.follow = null;
    const next = this.queued;
    this.queued = -1;
    this.log.push(`end ${this.slots[this.current]?.name}`);
    if (next >= 0 && w.vars.get(0xb) === 0) { this.begin(next); return; }
    env.letterbox(0);
    w.vars.andNot(V.PEPPER_CONTROL, 0x100);
  }

  /** stop at once (the zone ends while a script runs) */
  abort() {
    if (!this.running) return;
    this.queued = -1;
    this.end();
  }
}
