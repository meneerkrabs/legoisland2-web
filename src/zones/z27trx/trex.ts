// z27TRX: the player's rex (`trex`, constructor FUN_0076adc5, update FUN_0076a39b with the phases FUN_00769cb0 / FUN_00768510 / FUN_00769d6e / FUN_0076a05c, the two
// probes FUN_007692a1 / FUN_007698cf, the footsteps FUN_00769b26, the rider copy FUN_0076a194, the cameras FUN_0076ab5e / FUN_0076ac33). The node sits on the record
// PEPP (335: the rex mesh, anim/TREX.blk); the rider (DRKR, 336: Pepper's body with head, hat, hands and bag attached, anim/MFIG.blk) copies its pose every tick.
// Pure TypeScript: the node tests and the browser game build the same node. Field comments give the node offsets of the original.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { V } from '../../game/vars.ts';
import { B } from '../../game/input.ts';
import { BUTTON, CAM, CLIP, END_CLIP, MSG, PHASE, REC, RIDER_CLIP, RUMBLE, RUN, SCORE, SND, TREX, VAR } from './consts.ts';
import { groundAt, nameOf } from './run.ts';
import type { TrxRun } from './run.ts';
import type { EggNode, SlogNode } from './props.ts';

type Vec3 = [number, number, number];
const NO_GROUND_LIMIT = -1;
/** the original's x87 runs in 24-bit mode and every node field is a float: every store / operation below rounds to a float32 (the differential test's parallel run replays the original's accumulations) */
const F = Math.fround;
/** _DAT_008920cc = 0.1f: the force of the trexfeet emitter is the speed times this */
const FEET_FORCE = Math.fround(0.1);

export function medalOf(score: number, t: { gold: number; silver: number; bronze: number } = { gold: SCORE.GOLD, silver: SCORE.SILVER, bronze: SCORE.BRONZE }): 0 | 1 | 2 | 3 {
  return score > t.gold ? 3 : score > t.silver ? 2 : score > t.bronze ? 1 : 0;
}
/** FUN_0076a39b's score: 10000 - (5 * max(0, ftol(clock - 5400)) + 250 * hits), at least 0. The clock term is never positive (the clock counts down from 5400): the time costs nothing. */
export function scoreOf(clock: number, hits: number): number {
  let t = Math.trunc(F(clock - SCORE.CLOCK_REF)) * SCORE.CLOCK_FACTOR;
  if (t < 0) t = 0;
  const s = SCORE.MAX - (t + hits * SCORE.HIT_COST);
  return s < 0 ? 0 : s;
}

export class TrexNode implements BehaviourNode {
  readonly kind = 'trex';
  var: number = V.NS_ON; mask = 0; value = 0;
  stamp = 0xfffffffe;
  run!: TrxRun;
  /** the rider record (+0x38) */
  rider!: GameRecord;
  /** +0x14 / +0x18 / +0x24: minimum speed, maximum speed, speed step */
  minSpeed: number = F(TREX.MIN_SPEED); maxSpeed: number = F(TREX.MAX_SPEED); accel: number = F(TREX.ACCEL);
  /** +0x28: lane smoothing of this tick */
  laneRate: number = F(TREX.LANE_RATE0);
  /** +0x2c: the x of the middle lane (the record's x) */
  baseX = 16;
  /** +0x3c: the clock in ticks (counts down) */
  clock: number = TREX.CLOCK;
  /** +0x40 / +0x44 / +0x48 / +0x4c / +0x50 / +0x54: jump launch speed, gravity, ground height at the launch, height now, jumping, ticks since the launch */
  jumpV: number = TREX.JUMP_V; jumpG: number = TREX.JUMP_G; jumpBase = 0; jumpY = 0; jumping = false; jumpTime = 0;
  /** +0x58: crashed (a crash clip is playing, no steering); +0x5c: standing in fire */
  stunned = false; burning = false;
  /** +0x60: speed (units per tick) */
  speed: number = F(TREX.MIN_SPEED);
  /** +0x64: the buttons held at the previous tick */
  prevHeld = 0;
  /** +0x68: the camera's z (never goes back); +0x6c: the rex's z */
  camZ: number = TREX.START_Z; z: number = TREX.START_Z;
  /** +0x70: the lane offset now (smoothed), +0x74 / +0x78: the lane (-1, 0, 1) and the one before */
  offset = 0; lane = 0; prevLane = 0;
  /** +0xb8: 0 free, 1 blinking after a crash (cannot be hit), 2 blink over (hit again once clear of everything); +0xbc: blink ticks left */
  blink = 0; blinkT = 0;
  /** +0xc0: the number of hits (HUD counter, 250 points each) */
  hits = 0;
  /** +0xc8 / +0xcc / +0xd0: the rumble (active, ticks left, strength) */
  rumbleOn = false; rumbleT = 0; rumbleS = 0;
  /** +0xd4: toggled by a roar (unused); +0xd8: the bridge line was spoken; +0xdc: footstep state */
  roarToggle = 0; bridgeSpoken = false; stepState = 0;
  /** +0xc4: the trexfeet emitter's matrix has to be set again (FUN_00442a00 after the gate went on) */
  feetDirty = false;
  /** the world's tick counter of the last update (diagnostics) */
  ticks = 0;

  /** FUN_0076adc5: the node's state at the start of a run (the constructor also puts both records on the "wait" clip and sets the camera) */
  init(w: World, rec: GameRecord) {
    const run = this.run;
    this.baseX = rec.x; this.z = rec.z; this.camZ = rec.z;
    this.clock = TREX.CLOCK; run.clock = TREX.CLOCK; run.timeout = false;
    this.speed = this.minSpeed; this.laneRate = F(TREX.LANE_RATE0);
    this.jumping = false; this.stunned = false; this.burning = false; this.prevHeld = 0;
    this.offset = 0; this.lane = 0; this.prevLane = 0; this.blink = 0; this.blinkT = 0; this.hits = 0;
    this.rumbleOn = false; this.rumbleT = 0; this.rumbleS = 0; this.roarToggle = 0; this.bridgeSpoken = false; this.stepState = 0; this.feetDirty = false;
    run.hitsText = '0'; run.hudDim = false; run.arrivalCamera = false; run.arrivalFog = false; run.score = 0;
    rec.anim?.start(CLIP.WAIT, 0);
    this.mirror(rec);
    this.sideCamera(w, rec);
  }

  update(w: World, rec: GameRecord, _ctrl?: Controller): number {
    if (!this.run) return NODE_NONE;     // not bound by prepareTrx (the generic stub run)
    const run = this.run;
    this.ticks++;
    let phase = w.vars.get(VAR.PHASE);
    const anim = rec.anim!;
    if (phase === PHASE.RUN) {
      if (RUN.ARRIVAL_Z < this.z) {
        // the end zone: both records are shown (a blink may have hidden them), the run clip restarts, the rumble stops
        rec.flags |= RF_ENABLED; this.rider.flags |= RF_ENABLED;
        phase = PHASE.ARRIVE; w.vars.set(VAR.PHASE, phase);
        anim.start(CLIP.RUN, 0);
        this.rumbleOff();
      }
      if (run.timeout) { phase = PHASE.ARRIVE; w.vars.set(VAR.PHASE, phase); }
    } else if (phase === PHASE.ARRIVE) {
      if (this.z <= RUN.FINISH_Z) {
        if (this.speed <= 0) {
          // the rex stopped before the camp: lost
          w.vars.set(VAR.MEDAL, 0);
          run.sound.play(SND.LOSE);
          anim.start(CLIP.LOSE, 0);
          phase = PHASE.FINAL; w.vars.set(VAR.PHASE, phase);
          run.score = 0;
        }
      } else {
        this.z = RUN.FINISH_Z;
        phase = PHASE.FINAL; w.vars.set(VAR.PHASE, phase);
        run.score = scoreOf(this.clock, this.hits);
        const medal = this.finish(w, run.score);
        run.sound.play(SND.VICTORY);
        anim.start(this.endClip[medal], 0);
        run.fx.feetOff();                       // FUN_0076a39b: FUN_00442a20(feet, 1, 1, 1)
      }
    }
    switch (phase) {
      case PHASE.WAIT: case PHASE.WAIT2: this.waitTick(w, rec); this.sideCamera(w, rec); break;
      case PHASE.RUN: this.runTick(w, rec); this.sideCamera(w, rec); break;
      case PHASE.ARRIVE: this.arriveTick(w, rec); this.arrivalCamera(w); break;
      case PHASE.FINAL: this.finalTick(w, rec); this.arrivalCamera(w); break;
      default: break;
    }
    run.hitsText = String(this.hits);
    run.hudDim = this.blink !== 0;
    this.mirror(rec);
    return NODE_STOP;
  }

  /** the clips of the end by medal (read from 0x93dbe4 when the executable is at hand) */
  endClip: readonly number[] = END_CLIP;
  /** the totals of the finished run: FUN_0076a73b writes the best medal and the best score (only ever raised); returns the medal */
  thresholds: { gold: number; silver: number; bronze: number } = { gold: SCORE.GOLD, silver: SCORE.SILVER, bronze: SCORE.BRONZE };
  private finish(w: World, score: number): 0 | 1 | 2 | 3 {
    const medal = medalOf(score, this.thresholds);
    if (w.vars.get(VAR.TROPHY) < medal) w.vars.set(VAR.TROPHY, medal);
    if (w.vars.get(VAR.HISCORE) < score) w.vars.set(VAR.HISCORE, score);
    w.vars.set(VAR.MEDAL, medal);
    return medal;
  }

  // ------------------------------------------------------------------------------------------------------------------- rumble (FUN_00769200 / FUN_00769859 / FUN_0076ab2b)

  private rumbleTick(dt: number) {
    if (!this.rumbleOn) return;
    this.rumbleT -= dt;
    if (this.rumbleT >= 0) this.run.rumble(this.rumbleS, this.rumbleS);
    else { this.rumbleOn = false; this.rumbleS = 0; this.run.rumble(0, 0); }
  }
  private rumbleStart(kind: number) {
    if (this.rumbleOn) return;
    this.rumbleOn = true;
    this.rumbleT = this.run.rumbleTime[kind]; this.rumbleS = this.run.rumbleStrength[kind];
    this.run.rumble(this.rumbleS, this.rumbleS);
  }
  private rumbleOff() { if (this.rumbleOn) { this.rumbleOn = false; this.run.rumble(0, 0); } }

  // ------------------------------------------------------------------------------------------------------------------- phase 0 / 1 (FUN_00769cb0)

  private waitTick(w: World, rec: GameRecord) {
    rec.anim?.advance(1.0, w.dt);
    this.prevHeld = w.input.held;
    w.vars.set(VAR.PHASE, PHASE.RUN);
    rec.anim?.start(CLIP.RUN, 0);
    this.run.fx.feetOn(); this.run.fx.feetMatrix();       // FUN_00769cb0: gate (2, 1, 1), then the record's matrix (twice)
  }

  // ------------------------------------------------------------------------------------------------------------------- phase 4 (FUN_00768510)

  private runTick(w: World, rec: GameRecord) {
    const run = this.run, snd = run.sound, dt = w.dt, anim = rec.anim!;
    const dtc = F(1.0 * dt);
    this.clock = F(this.clock - dtc);
    if (this.clock < 0) { this.clock = 0; run.timeout = true; }
    run.clock = this.clock;
    this.rumbleTick(dt);
    const held = w.input.held;
    const newly = (held ^ this.prevHeld) & held;
    this.prevHeld = held;
    let clipReq: number = CLIP.RUN;
    const oldOffset = this.offset;
    let animRate: number;
    if (!this.stunned) {
      this.z = F(F(this.speed * dt) + this.z);
      animRate = F(this.speed / this.maxSpeed);
      if (held & B.RIGHT) { this.speed = F(this.speed + this.accel); if (this.maxSpeed < this.speed) this.speed = this.maxSpeed; }
      if (held & B.LEFT) { this.speed = F(this.speed - F(this.accel * RUN.BRAKE_FACTOR)); if (this.speed < this.minSpeed) this.speed = this.minSpeed; }
      const frac = F(0.5 * F(F(this.speed - this.minSpeed) / F(this.maxSpeed - this.minSpeed)));
      this.laneRate = F(F(1 - frac) * F(RUN.LANE_SMOOTH));
      if ((newly & B.UP) && -1 < this.lane) { this.prevLane = this.lane; this.lane -= 1; }
      if ((newly & B.DOWN) && this.lane < 1) { this.prevLane = this.lane; this.lane += 1; }
      if (newly & BUTTON.ROAR) {
        // the roar: one of four sounds, the roar clip only while running
        if (anim.clip === CLIP.RUN) { clipReq = CLIP.ROAR; this.roar(); this.roarToggle ^= 1; } else this.roar();
      }
    } else animRate = 1.0;
    run.fx.feetForce(Math.fround(this.speed * FEET_FORCE));     // FUN_0044ebd0(feet, 0, speed * 0.1)
    // the lane offset follows the lane
    const target = F(this.lane * RUN.LANE_WIDTH);
    const step = F(F(this.laneRate * RUN.LANE_STEP) * dt);
    if (this.offset < target) this.offset = Math.min(target, F(step + this.offset));
    if (target < this.offset) this.offset = Math.max(target, F(this.offset - step));
    const p: Vec3 = [F(this.baseX + this.offset), 0, this.z];
    let g = F(groundAt(w, p[0], 0, p[2]));
    if (g < F(RUN.MIN_Y)) g = F(RUN.MIN_Y);
    p[1] = g;
    // the bridge: a ray 32 up from the ground; its hit is the new height; the waterfall plays while the zone has a bridge
    const bridge = run.bridge;
    if (bridge) {
      const h = w.col.rayRecord(bridge, p, [0, 32, 0], 3, 0.01, 0);
      if (h) {
        p[1] = h.point[1];
        if (!this.bridgeSpoken) { this.bridgeSpoken = true; run.speak(MSG.BRIDGE); }
      }
      snd.at(SND.WATERFALL, [bridge.x, bridge.y, bridge.z]);
    }
    // the jump
    if (!this.stunned && (newly & BUTTON.JUMP) && !this.jumping) {
      this.jumping = true; this.jumpBase = p[1]; this.jumpV = F(TREX.JUMP_V); this.jumpG = F(TREX.JUMP_G); this.jumpTime = 0;
      run.fx.feetOff();
      snd.play(run.rng.int(2) ? SND.SHOUT2 : SND.SHOUT1);
      snd.play(run.rng.int(2) ? SND.JUMP2 : SND.JUMP1);
      snd.stop(SND.BREATHE);
      snd.play(SND.CATCHBREATH);
      clipReq = CLIP.JUMP;
      const r = run.rng.int(7);
      if (r === 0) run.speak(MSG.JUMP[0]); else if (r === 1) run.speak(MSG.JUMP[1]);
    }
    if (!snd.playing(SND.CATCHBREATH) && !snd.playing(SND.BREATHE)) snd.play(SND.BREATHE);
    if (this.jumping) {
      const t = F(this.jumpTime * F(RUN.JUMP_T));
      this.jumpY = F(F(F(F(F(this.jumpG * t) * t) * 0.5) + F(this.jumpV * t)) + this.jumpBase);
      if (p[1] <= this.jumpY) p[1] = this.jumpY;
      else {
        if (!this.stunned) { clipReq = CLIP.LAND; snd.play(SND.LANDGRAVEL); }
        this.feetDirty = true; run.fx.feetOn();
        this.jumping = false;
      }
      this.jumpTime = F(this.jumpTime + dtc);
    }
    // the blink after a crash: the rex and the rider are hidden / shown every two ticks
    if (this.blink === 1) {
      this.blinkT = F(this.blinkT - dtc);
      if (0 <= this.blinkT) {
        if (RUN.BLINK_EPS <= this.blinkT) this.setShown(rec, (Math.trunc(this.blinkT) & 2) !== 0);
        else this.setShown(rec, true);
      } else { this.setShown(rec, true); this.blink = 2; }
    }
    const out = { clip: clipReq };
    if (!this.stunned && this.blink !== 1) {
      const up = this.probeUp(w, rec, p, out);
      if (!up && !this.probeForward(w, rec, p, out, oldOffset)) this.blink = 0;
    }
    clipReq = out.clip;
    if (clipReq === CLIP.RUN) {
      const cur = anim.clip;
      if (cur === CLIP.BURN2 || cur === CLIP.BURN) animRate = 1.0;
      const res = anim.advance(animRate, dt);
      if (res !== 0) {
        switch (cur) {
          case CLIP.CRASH_BOULDER: case CLIP.CRASH_EGG: case CLIP.CRASH_ROCK: case CLIP.CRASH_LOG_A: case CLIP.CRASH_LOG_B:
            // the crash is over: carried 24 on, back to minimum speed, blinking
            this.stunned = false;
            this.z = F(this.z + F(RUN.RECOVER_Z));
            p[0] = F(this.baseX + this.offset); p[2] = this.z;
            p[1] = F(groundAt(w, p[0], p[1], p[2]));     // FUN_0043ce45 from the height of this tick (+ 4); no clamp here
            this.speed = this.minSpeed;
            this.blink = 1; this.blinkT = RUN.BLINK_TICKS;
            this.feetDirty = true; run.fx.feetOn();
            break;
          case CLIP.ROAR: case CLIP.LAND: clipReq = CLIP.RUN; break;
          case CLIP.BURN: case CLIP.BURN2:
            this.speed = this.minSpeed;
            if (!this.burning) { this.feetDirty = true; run.fx.feetOn(); } else clipReq = CLIP.BURN2;     // the fire is out: back to the run clip
            break;
          case CLIP.AIR: clipReq = CLIP.FALL_STOP; break;
          case CLIP.FALL_STOP: clipReq = CLIP.FALL_STOP; break;
          case CLIP.JUMP: clipReq = CLIP.AIR; break;
          case CLIP.BUMP_LEFT: case CLIP.BUMP_RIGHT: clipReq = CLIP.RUN; break;
          default: clipReq = cur; break;
        }
        if (clipReq !== cur) anim.start(clipReq, 0);
      }
    } else anim.start(clipReq, 0);
    this.footsteps(rec, dt);
    rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
    // (the original writes the record's position fields and the matrix is built from them before the draw: the emitter keeps the record's live matrix)
    if (this.feetDirty) { run.fx.feetMatrix(); this.feetDirty = false; }
    run.fx.feetMatrix();
  }
  private setShown(rec: GameRecord, on: boolean) {
    if (on) { rec.flags |= RF_ENABLED; this.rider.flags |= RF_ENABLED; } else { rec.flags &= ~RF_ENABLED; this.rider.flags &= ~RF_ENABLED; }
  }
  private roar() {
    const r = this.run.rng.float(4);
    const id = r <= 1 ? SND.ROAR1 : r <= 2 ? SND.ROAR2 : r <= 3 ? SND.ROAR3 : SND.ROAR4;
    this.run.sound.play(id);
  }

  // ------------------------------------------------------------------------------------------------------------------- the probes

  /** FUN_007692a1: the forward probe (a sweep from 6 ahead and 0.4 up back to 2.56 behind): lane bumps and the crashes; returns the record it hit (or null) */
  probeForward(w: World, rec: GameRecord, p: Vec3, out: { clip: number }, oldOffset: number): GameRecord | null {
    const run = this.run, snd = run.sound;
    const from: Vec3 = [p[0], p[1] + RUN.FWD_AHEAD_Y, p[2] + RUN.FWD_AHEAD_Z];
    const delta = RUN.FWD_DELTA;
    const hit = w.col.sweep(rec, from, delta, 3, 0.01, 0);
    if (!hit || this.blink !== 0) return hit ? hit.rec : null;
    const target = hit.rec;
    if (oldOffset !== this.offset) {
      // a lane change in progress: when the old lane is free, the new one is blocked and the rex bounces back
      const back: Vec3 = [oldOffset + this.baseX, from[1], from[2]];
      const hit2 = w.col.sweep(rec, back, delta, 3, 0.01, 0);
      if (!hit2) {
        const name = nameOf(target);
        if (name !== 'LAND') {
          if (name === 'STAT') w.vars.set(VAR.STATUE, 1);
          out.clip = this.offset <= oldOffset ? CLIP.BUMP_LEFT : CLIP.BUMP_RIGHT;
          p[0] = oldOffset + this.baseX;
          this.offset = oldOffset;
          this.lane = this.prevLane;
          snd.play(SND.WAHEY);
          this.rumbleStart(RUMBLE.LANE);
        }
        return target;
      }
    }
    const name = nameOf(target);
    if (name !== 'LAND') run.fx.feetOff();       // FUN_007692a1: anything but the ground puts the trexfeet emitter out (gate 1 / 1 / 1)
    switch (name) {
      case 'ROCK': case 'STP2': case 'VOLC': case 'STMP':
        run.speak(MSG.ROCK);
        snd.play(SND.BUMPROCK);
        this.stunned = true; out.clip = CLIP.CRASH_ROCK; this.rumbleStart(RUMBLE.ROCK); this.hits++;
        return target;
      case 'FENC':
        snd.play(SND.BUMPFENCE);
        this.stunned = true; out.clip = CLIP.CRASH_ROCK; this.rumbleStart(RUMBLE.ROCK); this.hits++;
        return target;
      case 'BLDF': case 'BLDR': case 'LOGS':
        this.jumpY = 0; this.jumping = false;
        this.stunned = true; out.clip = CLIP.CRASH_BOULDER; this.rumbleStart(RUMBLE.ROCK); this.hits++;
        snd.play(SND.BUMPTREE);
        snd.play(run.rng.int(2) ? SND.FALL2 : SND.FALL1);
        snd.play(run.rng.int(2) ? SND.SQUEAL2 : SND.SQUEAL1);
        return target;
      case 'STAT':
        this.stunned = true; out.clip = CLIP.CRASH_ROCK;
        w.vars.set(VAR.STATUE, 1);
        this.rumbleStart(RUMBLE.ROCK); this.hits++;
        snd.at(SND.PILLARBREATH, [target.x, target.y, target.z]);
        snd.play(SND.BUMPROCK);
        return target;
      default:
        return null;
    }
  }

  /** FUN_007698cf: the upward probe (0 .. 4 above the rex, radius 2): fire, swinging logs and eggs; returns the record it hit (or null) */
  probeUp(w: World, rec: GameRecord, p: Vec3, out: { clip: number }): GameRecord | null {
    const run = this.run, snd = run.sound;
    const hit = w.col.sweep(rec, p, [0, RUN.UP_PROBE, 0], 3, RUN.UP_RADIUS, RUN.UP_SKIN);
    if (!hit || this.blink !== 0) { this.burning = false; return hit ? hit.rec : null; }
    const target = hit.rec;
    const name = nameOf(target);
    if (name !== 'LAND') run.fx.feetOff();       // FUN_007698cf: as the forward probe
    let ret: GameRecord | null = target;
    switch (name) {
      case 'BURN':
        if (!this.burning) {
          this.burning = true; out.clip = CLIP.BURN; this.speed = this.minSpeed;
          this.rumbleStart(RUMBLE.BURN); this.hits++;
          snd.play(SND.JUMP1);
          run.fx.feetOff();
        }
        break;
      case 'SLOG': {
        this.stunned = true;
        this.rumbleStart(RUMBLE.LOG); this.hits++;
        snd.play(SND.BUMPPEND);
        const node = target.ctrl?.find<SlogNode>('trx-slog');
        out.clip = node && node.phase < 0 ? CLIP.CRASH_LOG_A : CLIP.CRASH_LOG_B;   // FUN_007676ea: 1 when the swing phase is below 0 (clip 0x1c), else -1 (0x1d)
        break;
      }
      case 'YOLK': case 'EGGS': {
        const egg = target.ctrl?.find<EggNode>('trx-egg');
        egg?.hitByRex(w, target);
        this.stunned = true; out.clip = CLIP.CRASH_EGG;
        snd.play(SND.EGGSPIN);
        this.rumbleStart(RUMBLE.EGG); this.hits++;
        break;
      }
      default: ret = null; break;
    }
    if (name !== 'BURN') this.burning = false;
    return ret;
  }

  // ------------------------------------------------------------------------------------------------------------------- footsteps (FUN_00769b26)

  private footsteps(rec: GameRecord, dt: number) {
    const anim = rec.anim!;
    const clip = anim.clip;
    if (clip !== CLIP.ROAR && clip !== CLIP.RUN) return;
    const f = Math.trunc(anim.frame);
    if (this.jumping || this.burning) return;
    const snd = this.run.sound;
    const nearEnd = () => anim.frameCount < 1.0 * dt + 1.0 + anim.frame;     // FUN_0043b92a(anim, 1.0): rate * DAT_008b1718 + 1.0 + frame
    switch (this.stepState) {
      case 0: if (1 < f) { snd.play(SND.FS1); this.stepState = 1; } break;
      case 1: if (11 < f) { snd.play(SND.FS2); this.stepState = 2; } break;
      case 2: if (nearEnd()) this.stepState = 3; break;
      case 3: if (1 < f) { snd.play(SND.FS3); this.stepState = 4; } break;
      case 4: if (11 < f) { snd.play(SND.FS4); this.stepState = 5; } break;
      case 5: if (nearEnd()) this.stepState = 0; break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- phase 5 (FUN_00769d6e) and 6 (FUN_0076a05c)

  private arriveTick(w: World, rec: GameRecord) {
    const run = this.run, dt = w.dt;
    if (!run.timeout) {
      // the autopilot: maximum speed down the middle lane to the camp
      this.z = F(F(this.maxSpeed * dt) + this.z);
      rec.x = this.baseX; rec.z = this.z;
      rec.y = groundAt(w, rec.x, rec.y, rec.z);
      rec.anim?.advance(1.0, dt);
      this.footsteps(rec, dt);
      return;
    }
    // the clock ran out: the rex shows and slows down (the probe of the original is handed an uninitialised position and never hits anything)
    rec.flags |= RF_ENABLED; this.rider.flags |= RF_ENABLED;
    let x: number, y: number;
    if (!this.jumping) {
      if (0 < this.speed) {
        this.speed = F(this.speed - F(F(RUN.COAST_DECEL) * dt));
        if (this.speed < 0) this.speed = 0;
        x = rec.x; y = rec.y;
        this.z = F(F(this.speed * dt) + this.z);
      } else { x = rec.x; y = rec.y; }
      run.fx.feetForce(Math.fround(this.speed * FEET_FORCE));
    } else {
      x = F(this.baseX + this.offset);
      let g = groundAt(w, x, 0, this.z);
      const t = F(this.jumpTime * F(RUN.JUMP_T));
      this.jumpY = F(F(F(F(F(this.jumpG * t) * t) * 0.5) + F(this.jumpV * t)) + this.jumpBase);
      if (g <= this.jumpY) {
        g = this.jumpY;
        const out = { clip: 0 };
        const hit = this.probeUp(w, rec, [x, g, this.z], out);
        if (!hit) this.jumpTime = F(F(1 * dt) + this.jumpTime);
      } else { this.jumping = false; run.fx.feetMatrix(); run.fx.feetOn(); }
      y = g;
      this.z = F(F(this.speed * dt) + this.z);
    }
    rec.x = x; rec.y = y; rec.z = this.z;
  }

  private finalTick(w: World, rec: GameRecord) {
    const anim = rec.anim!;
    const res = anim.advance(1.0, w.dt);
    if (res !== 0) {
      switch (anim.clip) {
        case CLIP.LOSE: anim.start(CLIP.LOSE2, 0); break;
        case CLIP.LOSE2: anim.start(CLIP.LOSE2, 0); w.vars.set(VAR.PHASE, PHASE.OVER); break;
        case CLIP.CHEER_BRONZE: anim.start(8, 0); w.vars.set(VAR.PHASE, PHASE.OVER); break;
        case CLIP.CHEER_SILVER: w.vars.set(VAR.PHASE, PHASE.OVER); break;
        case CLIP.CHEER_GOLD: anim.start(CLIP.CHEER_GOLD2, 0); w.vars.set(VAR.PHASE, PHASE.OVER); break;
        default: break;
      }
      this.run.fx.feetOff();
    }
  }

  // ------------------------------------------------------------------------------------------------------------------- rider and cameras

  /** FUN_0076a194: the rider takes the rex's clip (through the table), frame and matrix */
  mirror(rec: GameRecord) {
    const r = this.rider;
    const ra = r.anim, pa = rec.anim;
    if (ra && pa) {
      const mapped = RIDER_CLIP[pa.clip];
      if (mapped !== undefined) ra.start(mapped, pa.frame);
    }
    r.variant = rec.variant;
    r.m.set(rec.m);
  }

  /** FUN_0076ab5e: the side camera (phases 0, 1 and 4) */
  sideCamera(w: World, _rec?: GameRecord) {
    const c = w.camera.c;
    if (this.camZ < this.z) this.camZ = this.z;
    const ez = F(this.camZ + CAM.AHEAD_Z);
    c[2] = ez;
    c[0] = F(this.baseX + CAM.SIDE_X);
    c[1] = CAM.EYE_Y;
    c[3] = F(this.baseX + this.offset);
    c[5] = ez;
    const g = groundAt(w, c[3], c[4], c[5]);
    if (NO_GROUND_LIMIT < g) c[4] = g;
  }

  /** FUN_0076ac33: the camp camera of phases 5 and 6 (only when the clock has not run out): in front of the gate looking back; the zone game switches the fog */
  arrivalCamera(w: World) {
    const run = this.run;
    if (run.timeout || run.arrivalCamera) return;
    run.arrivalCamera = true;
    const c = w.camera.c;
    c[0] = this.baseX; c[1] = CAM.ARRIVAL_EYE[1]; c[2] = CAM.ARRIVAL_EYE[2];
    c[3] = c[0]; c[4] = CAM.ARRIVAL_Y; c[5] = CAM.ARRIVAL_TARGET_Z;
    this.camZ = CAM.ARRIVAL_EYE[2];
    run.arrivalFog = true;
  }
}

export { REC };
