// z01BPK: the state the zone's nodes and the zone loop share (the globals of the original's z01BPK code: DAT_05d58004 trick score, DAT_05d58008 trick flag, DAT_05d57fc4 result,
// DAT_05d580bc final score, DAT_05d580c0 medal of this run, DAT_05d580c4 new hi-score flag, DAT_05d580c8 time shown, DAT_009daa7c the board record), the timer / score node
// ("PepSwitc" of the zone: constructor FUN_00494091, handler table 0x8d23e0 = { update FUN_00493dd8, pre-render FUN_00493fdd, destroy FUN_00494152, draw FUN_00493ff7 }) with
// the clock FUN_00493ba0 and the result FUN_00493ecd, and the intro walk ("Walk" of the zone: constructor FUN_004944f3, table 0x8d2468, update FUN_00494190).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { GameVars } from '../../game/vars.ts';

/** the constructor addresses the zone's set-up attaches to PEPP (FUN_004933c4: FUN_00494091 @ 0, FUN_004944f3 @ 1 [PEPPER_CONTROL & 1], FUN_00492cc2 @ 2 [PEPPER_CONTROL & 4]) */
export const CTOR = { SWITCH: 0x494091, WALK: 0x4944f3, SKATE: 0x492cc2 } as const;
/** the record indices of the zone: Pepper 0x23, the board 0x24 (DAT_009daa7c), the spectators 0x25 .. 0x37 (the last one, 0x37, is the judge SKEL) */
export const REC = { PEPPER: 35, BOARD: 36, SPECTATOR_FIRST: 37, SPECTATOR_LAST: 55 } as const;
/** game variables: PEPPER_CONTROL, TROPHY_BPK, HISCORE_BPK (tools/gamevars.tsv) */
export const VAR = { PEPPER_CONTROL: 0x5e, TROPHY: 0x8d, HISCORE: 0xc0 } as const;

/** the game lasts 3600 ticks = 2 minutes (the constructor writes 0x45610000 = 3600.0 to node +0x1c) */
export const GAME_TICKS = 3600.0;
/** the trophy thresholds of FUN_00493ecd (0x1389 / 0x9c4): gold from 5001, silver from 2501, bronze from 1 */
export const MEDAL = { GOLD: 5001, SILVER: 2501, BRONZE: 1 } as const;
/** score counting up: +10 per tick of the pending trick score (0x892060), the clock text divides by 30 ticks / second (0x892038) and 60 seconds / minute (0x892388) */
export const SCORE_STEP = 10.0, TICKS_PER_SECOND = 30.0, SECONDS_PER_MINUTE = 60.0;
/** the walk-in target of Pepper (FUN_00494190: 0x4207999a, 0x41826666, 0xc1e80000) and its tests (0x892084 = 0.8 arrival, 0x892530 = 6.8 / 0x89228c = 6.0 facing, 0x89252c = 45 degrees a tick, 0x8920f0 = 0.2 a tick) */
export const WALK_TARGET = [Math.fround(33.9), Math.fround(16.3), -29.0] as const;
export const WALK = { ARRIVE: Math.fround(0.8), FACING_GO: Math.fround(6.8), FACING_TURNED: 6.0, TURN: Math.fround(0.785398), STEP: Math.fround(0.2) } as const;

/**
 * FUN_0048d52b: the text id of the stunt Pepper's clip is (the strings "BPK3" .. "BPK23" at 0x8d1fc0 + 8 * (n - 3); BPK3 "Mooie vis!" ... BPK23 "Sluwe Sam Sinister"); other clips: no text.
 * The first name of each trick of FUN_0048e840 (src/zones/z01bpk/skate.ts `TRICKS`).
 */
export const TRICK_NAMES: Readonly<Record<number, string>> = {
  0x52: 'BPK3', 0x0f: 'BPK4', 0x11: 'BPK5', 0x0a: 'BPK6', 0x10: 'BPK7', 0x19: 'BPK8', 0x5e: 'BPK9', 0x54: 'BPK10', 0x67: 'BPK11', 0x5c: 'BPK12', 0x60: 'BPK13', 0x5f: 'BPK14',
  0x69: 'BPK15', 0x68: 'BPK16', 0x65: 'BPK17', 0x6b: 'BPK18', 0x66: 'BPK19', 100: 'BPK20', 0x6a: 'BPK21', 0x6d: 'BPK22', 0x6c: 'BPK23',
};

/** the sounds the zone plays; a stub when there is no audio */
export interface BpkSounds {
  /** FUN_004435a0: start a sound slot by sound-table id */
  play(id: number): void;
  /** FUN_004435b0: stop it */
  stop(id: number): void;
  /** the wheels: one positional loop (DAT_05d5804c = FUN_004433b0(0x94)); on: FUN_004433f0(handle, board position) every tick, off: FUN_004434b0 */
  wheels(on: boolean, pos: readonly number[]): void;
}
export const SILENT: BpkSounds = { play() {}, stop() {}, wheels() {} };

export class BpkRun {
  /** DAT_05d58004: the score of the running stunt, DAT_05d58008: set when a landing was judged good (the clock then moves the score over to the total) */
  trickScore = 0;
  trickFlag = 0;
  /** DAT_009daa7c: the board record (0x24) */
  board: number = REC.BOARD;
  sounds: BpkSounds = SILENT;
  /** DAT_05d57fc4: 0 running, 1 / 2 = the game ended (1: the stored trophy is not 0 = success) */
  result = 0;
  /** DAT_05d580bc: the final score, DAT_05d580c0: the medal of this run (0 none), DAT_05d580c4: a new hi-score */
  finalScore = 0; medal = 0; newHiscore = 0;
  /** DAT_05d580c8: the time left in ticks, as the clock shows it */
  timeLeft: number = GAME_TICKS;
  /** the HUD texts the clock writes (DAT_05d4dd60 "M:SS" and DAT_05d4dd20 the total score; DAT_05d4dfec the stunt score is not drawn by the HUD) */
  clockText = ''; scoreText = ''; trickText = '';
  /** the zone's nodes */
  clock: BpkSwitch | null = null;
}

/** FUN_00493ecd(score): the trophy and hi-score of the finished game; `result` = DAT_05d57fc4 */
export function finishGame(run: BpkRun, vars: GameVars, score: number) {
  const hi = vars.get(VAR.HISCORE);
  let tier = 0;
  if (score >= MEDAL.GOLD) { tier = 3; run.medal = 3; }
  else if (score >= MEDAL.SILVER) { tier = 2; run.medal = 2; }
  else if (score >= MEDAL.BRONZE) { tier = 1; run.medal = 1; }
  let old = vars.get(VAR.TROPHY);
  if (old <= tier) { vars.set(VAR.TROPHY, tier); old = tier; }
  run.result = 2 - (old !== 0 ? 1 : 0);
  run.finalScore = score;
  if (hi < score) { vars.set(VAR.HISCORE, score); run.newHiscore = 1; }
}

/** FUN_00494091 + FUN_00493dd8 + FUN_00493ba0: the clock and the score of the game; runs while PEPPER_CONTROL == 4 (the skateboard) */
export class BpkSwitch implements BehaviourNode {
  readonly kind = 'bpkSwitch';
  var = VAR.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly run: BpkRun;
  /** node + 0x18: a stunt score is being counted into the total */
  counting = 0;
  /** node + 0x19: the time is up */
  over = 0;
  /** node + 0x1a: the animation result of the final tick */
  ended = 0;
  /** node + 0x1c: the time left in ticks, + 0x20 the total score, + 0x24 the stunt score still to be counted */
  time: number = GAME_TICKS;
  score = 0;
  pending = 0;
  /** where the end of the game is judged (the zone game hooks this: FUN_00493ecd) */
  onEnd: ((score: number) => void) | null = null;

  constructor(run: BpkRun) { this.run = run; run.clock = this; }

  /** FUN_00493dd8 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    // `FUN_00417575(*node) == 4`: exactly PEPPER_CONTROL == 4, not a bit test
    if (w.vars.get(this.var) === 4) {
      this.clock(w, rec);
      if (this.over !== 0) {
        const score = Math.trunc(this.score);
        this.onEnd?.(score);
        this.over = 0;
        this.ended = rec.anim?.advance(1.0, w.dt) ?? 0;
        w.records[this.run.board]?.anim?.advance(1.0, w.dt);
      }
    }
    return NODE_CONTINUE;
  }
  prerender(): void { /* FUN_00493fdd: returns 1 */ }

  /** FUN_00493ba0: the clock runs down while Pepper is not getting on (clip 0x16), the trick score of a good landing moves into the total 10 per tick */
  private clock(w: World, rec: GameRecord) {
    const run = this.run, dt = w.dt;
    if (0 < this.time && rec.anim?.clip !== 0x16) this.time = this.time - 1.0 * dt;
    else if (this.time <= 0) { this.time = 0; run.trickScore = 0; }
    run.timeLeft = this.time;
    if (this.time <= 0) this.over = 1;
    const secs = Math.trunc(this.time / TICKS_PER_SECOND);
    if (run.trickFlag !== 0) {
      this.counting = 1; run.trickFlag = 0;
      this.pending = run.trickScore + this.pending;
      run.trickScore = 0;
    }
    if (this.counting !== 0 && 0 < this.pending) {
      this.score = this.score + SCORE_STEP;
      this.pending = this.pending - SCORE_STEP;
      if (this.pending < 0) { this.score = this.score + this.pending; this.pending = 0; this.counting = 0; }
    }
    if (0 <= this.time) run.clockText = `${Math.trunc(secs / SECONDS_PER_MINUTE)}:${String(secs % 60).padStart(2, '0')}`;
    run.scoreText = String(Math.trunc(this.score));
    run.trickText = run.trickScore === 0 ? '' : String(Math.trunc(run.trickScore));
  }
}

/** FUN_004944f3 + FUN_00494190: Pepper walks to the board at the start of the platform, turns to face it, gets on (PEPPER_CONTROL 4, state 0x16) */
export class BpkWalk implements BehaviourNode {
  readonly kind = 'bpkWalk';
  var = VAR.PEPPER_CONTROL; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly run: BpkRun;
  /** node + 0x15: the state (clip): 0x1b idle at first, 0x0d walking once the idle clip has wrapped, 0x16 getting on */
  state = 0x1b;
  /** node + 0x16: the clip wrapped this tick; + 0x17: Pepper has turned far enough towards the board and walks on without turning */
  wrapped = 0;
  turned = 0;
  /** the camera follows Pepper's position with this offset (FUN_00422c7e preset 0: the target = Pepper + (0, 3, 0), the eye stays) */
  constructor(run: BpkRun) { this.run = run; }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const g = w.pep;
    const [tx, ty, tz] = WALK_TARGET;
    const dx = tx - rec.x, dy = ty - rec.y, dz = tz - rec.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
    if (dist <= WALK.ARRIVE) {
      rec.anim?.start(0x16, 0);
      w.records[this.run.board]?.anim?.start(1, 0);
      w.vars.set(VAR.PEPPER_CONTROL, 4);
      this.state = 0x16;
      g.mailbox = this.state;
      const b = w.records[this.run.board];
      if (b) b.show();
    } else {
      const dot = fx * dx + fy * dy + fz * dz;
      if (WALK.FACING_GO <= dot || this.turned !== 0) {
        rec.ry = Math.atan2(dx, dz);
        rec.x = fx * WALK.STEP + rec.x;
        rec.z = fz * WALK.STEP + rec.z;
      } else {
        rec.ry = rec.ry + WALK.TURN;
        if (WALK.FACING_TURNED < dot) this.turned = 1;
      }
      rec.rebuildYaw();
      this.wrapped = rec.anim?.advance(1.0, w.dt) ?? 0;
      if (this.wrapped !== 0 && this.state === 0x1b) { rec.anim?.start(0x0d, 0); this.state = 0x0d; }
    }
    // FUN_00422c7e(camera, Pepper's matrix, preset 0, 0): the target follows Pepper
    const c = w.camera.c;
    c[3] = rec.x; c[4] = rec.y + 3.0; c[5] = rec.z;
    return NODE_STOP;
  }
  prerender(): void { /* FUN_0049443f: returns 1 */ }
}
