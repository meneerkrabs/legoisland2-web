// Whack-A-Bot (z05WAB, "Botten meppen"): the game logic of the zone, pure TypeScript (no DOM) so node tests can drive it with scripted input.
//
// The original keeps the whole game in two behaviour nodes: `pepwab` (constructor FUN_0056cd3b, update FUN_0056c950) on Pepper and `botwab` (constructor FUN_0056b2d5,
// update FUN_00569f50, helpers FUN_0056bb20 / FUN_0056c6a5 / FUN_0056c8f1 / FUN_0056b1dc) on the room record `LAND`. Both are ported here field by field: the node struct
// offsets of the original are noted next to the fields (`+0x..`), constants carry their address in the executable. The zone loop (FUN_0056905a: intro, help, banner,
// result menu) is the shared loop template; what is zone specific in it (score = hit percentage x 100, medals 5000 / 8000 / 9000, texts) is in `game.ts`.
//
// How the game works: four trap doors (lids) around Pepper, one per direction button (hole 0 = up / far, 1 = left, 2 = right, 3 = down / near). One bot at a time pops up
// out of a random hole (1 in 8 is the Infomaniac, whom Pepper must not hit); Pepper whacks with the four direction buttons, the hammer lands on frame 12 of the 27-frame
// swing clip. A bot that is fully up and whacked counts as a hit; a bot that goes down unhit is a miss (the Infomaniac neither way; hitting him stuns Pepper for 90 ticks).
// 2700 ticks (90 s) per game, the bots get quicker in four stages (`hold` / `gap`).
import { NODE_CONTINUE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';

const f32 = Math.fround;

/** behaviour constructors of the zone (attached by `ZoneSetup.attaches`: `pepwab` on record 0 = PEPP, `botwab` on record 1 = LAND) */
export const CTOR = { PEPWAB: 0x56cd3b, BOTWAB: 0x56b2d5 } as const;

/** record indices of the zone (FUN_0056b2d5 reaches them through DAT_00983804 + index * 0x68; the names are checked when the nodes start) */
export const REC = {
  PEPP: 0, LAND: 1, G000: 2, G001: 3, LIDD: 4, LIDR: 5, LIDU: 6, LIDL: 7,
  /** BOT1..BOTG: the 16 stages of the bot being whacked (only 9 are shown, 0x18e & 0xf) */
  BOT1: 8,
  /** INF1..INFG: the same for the Infomaniac */
  INF1: 24,
  /** INFO: the Infomaniac that pops up in place of a bot */
  INFO: 40,
  /** BOTT x4: the resting bot of hole 0 (up), 1 (left), 2 (right), 3 (down) = records 44, 42, 41, 43 */
  HOLE: [44, 42, 41, 43] as const,
  FLSH: 45,
} as const;
/** the lid record of every hole: up = LIDU, left = LIDL, right = LIDR, down = LIDD (FUN_0056bb20 switch on the hole) */
export const LID_OF_HOLE = [REC.LIDU, REC.LIDL, REC.LIDR, REC.LIDD] as const;

/** sound-table ids (FUN_00569dd0: FUN_00443580 / FUN_004433b0 with these ids; names from the EXE's table) */
export const SND = {
  HAMMER_MOVE: 0x1dd, HIT_BOT: 0x1de, HIT_INFO: 0x1df, MISS: 0x1e0, AMBIENT: 0x1e1,
  OPEN_LEFT: 0x1e6, CLOSE_LEFT: 0x1e7, OPEN_TOP: 0x1e8, CLOSE_TOP: 0x1e9, OPEN_RIGHT: 0x1ea, CLOSE_RIGHT: 0x1eb, OPEN_BOTTOM: 0x1ec, CLOSE_BOTTOM: 0x1ed,
  ALARM1: 0x1ee, ALARM2: 0x1ef,
} as const;
/** FUN_00569f50 / FUN_0056bb20: the sound a hole plays when its bot pops up (hole 0..3) and when it goes down (the original's hole 2 / 3 open sounds are bottom / right) */
export const OPEN_SOUND = [SND.OPEN_TOP, SND.OPEN_LEFT, SND.OPEN_BOTTOM, SND.OPEN_RIGHT] as const;
export const CLOSE_SOUND = [SND.CLOSE_TOP, SND.CLOSE_LEFT, SND.CLOSE_BOTTOM, SND.CLOSE_RIGHT] as const;
export const ALL_SOUNDS: readonly number[] = Object.values(SND);

/** speech lines (messages/LI/Data/wab.str) */
export const LINE = { GOLD: 'LESGWB01', SILVER: 'LESGWB02', BRONZE: 'LESGWB03', NEAR1: 'LESGWB04', NEAR2: 'LESGWB05', INFO_SORRY: 'LESGWB06', INFO_LOOK: 'LESGWB07', INFO_BREATH: 'LESGWB08', BOT_SEA: 'LESGWB09', BOT_MOAN: 'LESGWB10', INTRO: 'LESGWB11' } as const;

/** tuning constants (botwab constructor FUN_0056b2d5 and FUN_00569f50; floats are the .rdata / immediate values) */
export const WAB = {
  /** +0xec: game time in ticks (0x4528c000 = 2700.0 = 90 s) */
  TIME: 2700,
  /** +0xbc: how far a bot rises (0x3fcccccd) and +0xc0: its hidden y (0xbfb851ec) */
  RANGE: f32(1.6), BASE_Y: f32(-1.44),
  /** +0x130: ticks to rise (10.0), +0x134: ticks base of the fall (13.0: falls twice as fast, 6.5 ticks) */
  RISE: 10, FALL: 13,
  /** +0x138 / +0x13c at the start: ticks a bot stays up (29.0) and the pause before the next one (12.0) */
  HOLD0: 29, GAP0: 12,
  /** the four difficulty stages of FUN_00569f50 on the time left: >= 1830 (the start values), < 1830, < 930, < 480; [hold, gap] */
  STAGES: [[29, 12], [25, 10], [22, 8], [20, 8]] as const,
  /** time-left limits of the stages (0x892630 = 1830, 0x892634 = 930, 0x892044 = 480) */
  STAGE_LIMITS: [1830, 930, 480] as const,
  /** the alarm / flashing light / blinking clock start below this time left (0x892044 = 480.0 = the last 16 s) */
  ALARM_AT: 480,
  /** Pepper whacks on frame 12 of a swing (0x892... 12.0) */
  HIT_FRAME: 12,
  /** Pepper is stunned for 90 ticks after whacking the Infomaniac (0x42b40000) */
  STUN: 90,
  /** +0x150..: whack animation of the bot, stages 0..8 of BOT1.. / INF1.. (`8 < frame` ends it) */
  HIT_STAGES: 8,
  /** Pepper's clips of MFIG.blk in this zone: idle, stunned, win, lose is 2, swings down / up / left / right */
  CLIP: { IDLE: 1, STUN: 2, WIN: 3, SWING_DOWN: 4, SWING_UP: 5, SWING_LEFT: 6, SWING_RIGHT: 7 },
  /** score = hit percentage (truncated, max 100) x 100; the medal thresholds of FUN_0056905a (`< 9000`, `< 8000`, `< 5000`) */
  BRONZE: 5000, SILVER: 8000, GOLD: 9000,
  /** the win clip / "50 percent" test of FUN_00569f50 (0x42480000) */
  WIN_PCT: 50,
} as const;

const u32f = (u: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u, true); return d.getFloat32(0, true); };
/** the lid animation (FUN_0056bb20): per step (every 2nd tick) the lid moves 8 * range / rise = 1.28 along its axis and 0.25 in y; the clamps are the open / closed positions */
export const LID = {
  /** y when open / closed (0x40000000 = 2.0, 0x4016e979 = 2.358) */
  OPEN_Y: 2, CLOSED_Y: u32f(0x4016e979), Y_STEP: 0.25,
  /** open / closed position along the lid's axis for hole 0 (LIDU, z), 1 (LIDL, x), 2 (LIDR, x), 3 (LIDD, z): 0x40bc6a7f / 0 / 0 / 0x40b80000 and 0x407ea7f0 / 0x3fe33333 / 0xbfdf1aa0 / 0x40f04189 */
  OPEN: [u32f(0x40bc6a7f), 0, 0, u32f(0x40b80000)] as readonly number[],
  CLOSED: [u32f(0x407ea7f0), u32f(0x3fe33333), u32f(0xbfdf1aa0), u32f(0x40f04189)] as readonly number[],
  /** LIDL closes when x passes 1.773 (0x3fe2f1aa), the clamp then is 1.775 (0x3fe33333) */
  LIDL_LIMIT: u32f(0x3fe2f1aa),
  /** the end of the game puts the lids' z back (LIDD 0x40f04189, LIDR 0x40b74396, LIDU 0x407ea7f0, LIDL 0x40b753f8) */
  END_Z: { LIDD: u32f(0x40f04189), LIDR: u32f(0x40b74396), LIDU: u32f(0x407ea7f0), LIDL: u32f(0x40b753f8) },
};

/** the camera of the zone (FUN_00422b50 / FUN_00422c7e / FUN_00422ddc with preset 4 = DAT_009da5e0): eye = offset 4 of the table 0x8adbf8 in Pepper's frame (0, 10.4, 24) */
export const CAMERA_OFFSET = [0, f32(10.4), 24] as const;
/** the start target = Pepper + (0, 4, 9.6) (0x8adc60..68); while playing the target is Pepper's position */
export const CAMERA_START_TARGET = [0, 4, f32(9.6)] as const;

/** the whole-game score: `ftol(percentage)` capped at 100, times 100 (FUN_0056905a mode 2 / 4 / 5); the percentage of a game without any hit or miss is NaN: `ftol(NaN)` = INT_MIN, times 100 wraps to 0 */
export function scoreOf(pct: number): number {
  let v = Number.isNaN(pct) || !Number.isFinite(pct) ? -2147483648 : Math.trunc(pct);
  if (v > 100) v = 100;
  return Math.imul(v, 100);
}
/** medal of a score: 3 gold (>= 9000), 2 silver (>= 8000), 1 bronze (>= 5000), 0 none */
export function medalOfScore(score: number): 0 | 1 | 2 | 3 { return score >= WAB.GOLD ? 3 : score >= WAB.SILVER ? 2 : score >= WAB.BRONZE ? 1 : 0; }
/** hits / (hits + misses) x 100, stored as a single (the division and the product run in the x87's extended precision, only the result is rounded); NaN without any bot */
export function percentOf(hits: number, misses: number): number { return f32((hits / (hits + misses)) * 100); }

// ---------------------------------------------------------------------------------------------------- host

/** what the game needs from the shell around it (sound, speech, texture frames, random numbers); the zone game binds the real ones, tests bind mocks */
export interface WabHost {
  /** FUN_004435a0: play a sound by sound-table id (called every tick for the loops, like the original) */
  play(id: number): void;
  /** FUN_004435b0: stop a sound */
  stop(id: number): void;
  /** FUN_004433f0: play at a position; `pos` null when the original's position is uninitialised (it then plays nothing) */
  play3d(id: number, pos: readonly [number, number, number] | null): void;
  /** FUN_00439bf8 + FUN_00435a11: speak a line of wab.str */
  say(id: string): void;
  /** FUN_00443120(model, 0, slot, 2, frame): freeze the animated texture of slot `slot` of the first part of the LAND / FLSH model on entry `frame` of its sequence */
  setFrame(target: 'land' | 'flsh', slot: number, frame: number): void;
  /** FUN_0043ebe0(model, 0x1642, group, dv): scroll the V coordinates of mesh group `group` of the LAND model by `dv` */
  scrollV?(group: number, dv: number): void;
  /** `ftol(random(ticks)) % n`: an integer in [0, n) */
  random(n: number): number;
}
/** a host that does nothing (the default until the zone game binds the real one); `random` is a small seedable generator */
export class NullHost implements WabHost {
  private seed: number;
  constructor(seed = 12345) { this.seed = seed >>> 0; }
  play() { /* silent */ } stop() { /* silent */ } play3d() { /* silent */ } say() { /* silent */ } setFrame() { /* none */ }
  random(n: number): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((this.seed / 4294967296) * n);
  }
}

/** state shared by the two nodes (the original's globals DAT_05d5885c / DAT_008f6c00 / DAT_05d58864 / DAT_05d58860) */
export class WabShared {
  host: WabHost = new NullHost();
  /** DAT_05d5885c: ticks Pepper is stunned (> 0: no input) */
  stun = 0;
  /** DAT_008f6c00: Pepper's current clip (the botwab node looks at it for the hit moment) */
  clip: number = WAB.CLIP.IDLE;
  /** DAT_05d58864: the game is over (the loop goes to the banner) */
  over = 0;
  /** DAT_05d58860: the final hit percentage (NaN when nothing happened) */
  pct = NaN;
  bot: BotNode | null = null;
  pep: PepNode | null = null;
  /** the score of the finished game (0 while running) */
  get score(): number { return this.over ? scoreOf(this.pct) : 0; }
}

// ---------------------------------------------------------------------------------------------------- pepwab

/** FUN_0056cd3b + FUN_0056c950: Pepper's hammer. The four direction buttons start a 27-frame swing (clips 4..7), input is locked while swinging and stunned */
export class PepNode implements BehaviourNode {
  readonly kind = 'pepwab';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  readonly sh: WabShared;
  /** +0x15: current clip; +0x16: result of the last advance; +0x17: busy (input locked); +0x18: start-up lock counter (15 ticks) */
  clip: number = WAB.CLIP.IDLE; ret = 0; busy = 1; lock = 15;
  private started = false;
  constructor(sh: WabShared) { this.sh = sh; sh.pep = this; }

  /** the constructor part (FUN_0056cd3b): idle clip, camera preset 4 */
  init(w: World, rec: GameRecord) {
    if (this.started) return;
    this.started = true;
    this.clip = WAB.CLIP.IDLE; this.busy = 1; this.lock = 15;
    rec.anim?.start(this.clip, 0);
    this.sh.stun = 0; this.sh.clip = WAB.CLIP.IDLE;
    initCamera(w, rec);
  }

  update(w: World, rec: GameRecord, _ctrl?: Controller): number {
    this.init(w, rec);
    const sh = this.sh;
    if (sh.over !== 1) {
      rec.rebuildYaw();                                     // FUN_0043a5e4(rec + 0xc, 0, ry, 0, x, y, z)
      this.ret = rec.anim ? rec.anim.advance(1) : 0;        // FUN_0043b76a(anim, 1.0)
      if (this.ret === 2 && this.clip !== WAB.CLIP.IDLE) {
        this.clip = WAB.CLIP.IDLE;
        if (sh.stun <= 0) { this.busy = 0; sh.stun = 0; }
        if (0 < sh.stun) this.clip = WAB.CLIP.STUN;
        rec.anim?.start(this.clip, 0);
        sh.clip = this.clip;
      }
      if (0 < sh.stun) {
        sh.stun = f32(sh.stun - 1);
        if (0 < sh.stun) this.busy = 1; else { this.busy = 0; sh.stun = 0; }
      }
      const pressed = w.input.pressed;
      if (this.busy === 0 && pressed !== 0) {
        // the later tests win when several buttons went down in the same tick (the original tests left, down, right, up in this order)
        const swing = (clip: number) => { this.clip = clip; this.busy = 1; sh.host.play(SND.HAMMER_MOVE); rec.anim?.start(clip, 0); sh.clip = clip; };
        if (pressed & B.LEFT) swing(WAB.CLIP.SWING_LEFT);
        if (pressed & B.DOWN) swing(WAB.CLIP.SWING_DOWN);
        if (pressed & B.RIGHT) swing(WAB.CLIP.SWING_RIGHT);
        if (pressed & B.UP) swing(WAB.CLIP.SWING_UP);
      }
      if (this.lock !== 0 && --this.lock === 0) this.busy = 0;
      // the camera (FUN_00422c7e(cam, focus, 4, 0) + FUN_00422ddc(cam, 0, 4)): the target is Pepper's position; the eye keeps its set-up place (its height is held at the offset's)
      const c = w.camera.c;
      c[3] = rec.x; c[4] = rec.y; c[5] = rec.z;
      const p2 = CAMERA_OFFSET[1];
      if (p2 <= c[1]) { if (32 < c[1] - p2) c[1] = f32(c[1] - 0.8); } else c[1] = p2;
    }
    return NODE_STOP;
  }
}

/** FUN_00422b50 with preset 4: the start view of the zone (also used by the zone game before the first tick) */
export function initCamera(w: World, rec: GameRecord) {
  const c = w.camera.c;
  c[6] = 0; c[7] = 1; c[8] = 0;
  c[3] = CAMERA_START_TARGET[0] + rec.x; c[4] = CAMERA_START_TARGET[1] + rec.y; c[5] = CAMERA_START_TARGET[2] + rec.z;
  const e = rec.toWorld(CAMERA_OFFSET);
  c[0] = e[0]; c[1] = e[1]; c[2] = e[2];
  w.camera.preset = 4;
  w.camera.updateView();
  w.camera.savePrev();
}

// ---------------------------------------------------------------------------------------------------- botwab

/** copy a record's matrix (FUN_0085c0b0(dst + 0xc, src + 0xc, 0x40)); the port also restarts the render interpolation so the model does not smear across the room */
function copyMatrix(dst: GameRecord, src: GameRecord) { dst.m.set(src.m); dst.prev.set(dst.m); }

/** FUN_0056b2d5 + FUN_00569f50: the bots, the lids, the clock, the score */
export class BotNode implements BehaviourNode {
  readonly kind = 'botwab';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  readonly sh: WabShared;
  private ready = false;
  private recs: GameRecord[] = [];
  /** the resting bot of every hole (+0x14..), the record currently shown for each hole (+0xdc) */
  base: GameRecord[] = [];
  cur: GameRecord[] = [];
  // ---- game state
  /** +0xec: ticks left (counts down from 2700); +0xf0: ticks played */
  timeLeft: number = WAB.TIME; elapsed = 0;
  /** +0xf4: state of each hole (0 hidden, 1 rising, 2 up, 3 falling); +0xfc: whacked; +0x104: the bot is the Infomaniac; +0x10c: y; +0x11c: the tick it came up */
  state = [0, 0, 0, 0]; whacked = [0, 0, 0, 0]; isInfo = [0, 0, 0, 0]; y = [WAB.BASE_Y, WAB.BASE_Y, WAB.BASE_Y, WAB.BASE_Y]; tUp = [0, 0, 0, 0];
  /** +0x12e / +0x12f: hits and misses (bytes) */
  hits = 0; misses = 0;
  /** +0x12c: the clock is shown (it blinks in the last 16 s) */
  clockOn = true;
  /** +0x138 / +0x13c: ticks a bot stays up, ticks between two bots; +0x188: the tick the last bot went down (-1: none yet) */
  hold: number = WAB.HOLD0; gap: number = WAB.GAP0; lastDown = -1;
  // ---- presentation state (the counters of FUN_0056bb20)
  /** +0x16c: countdown to the next step of the 2-tick animations; +0x158 / +0x15c / +0x160 / +0x164 / +0x168: the free-running animation counters */
  c16c = 1; c158 = 0; c15c = 0; c160 = 0; c164 = 0; c168 = 0;
  /** +0x170 / +0x17e: the Infomaniac's TV reaction (timer -1 = idle, kind 0..3 = the whacked hole's arrow, 4 = the red cross) */
  reactT = -1; reactKind = -1;
  /** +0x174 / +0x180: the opening lid (timer -1 = none, hole); +0x178 / +0x182: the closing lid; +0x184: 1 once the last lid finished closing */
  openT = -1; openHole = -1; closeT = -1; closeHole = -1; lidDone = 1;
  /** +0x18e / +0x190: the whack animation (stage, timer; -1 = none) */
  hitStage = -1; hitT = -1;
  /** +0x17c / +0x17d: the two time marks (1740 / 780 left) of the original; they are only written */
  mark1740 = false; mark780 = false;
  /** the strings the HUD shows (DAT_05d4dd20 / DAT_05d4dd44 / DAT_05d4dd60 and the percentage line) */
  hitsText = '0'; missText = '0'; timeText = '01:30'; pctText = '0%%';
  /** diagnostics: the ticks the node has updated */
  ticks = 0;

  constructor(sh: WabShared) { this.sh = sh; sh.bot = this; }

  private rec(i: number): GameRecord { return this.recs[i]; }

  /** the constructor part (FUN_0056b2d5): the resting bots at y = -1.44, the clock, the flashing light frozen on its first frame */
  init(w: World) {
    if (this.ready) return;
    this.ready = true;
    this.recs = w.records;
    const expect: [number, string][] = [[REC.PEPP, 'PEPP'], [REC.LAND, 'LAND'], [REC.LIDD, 'LIDD'], [REC.INFO, 'INFO'], [REC.FLSH, 'FLSH'], [REC.BOT1, 'BOT1'], [REC.INF1, 'INF1'], ...REC.HOLE.map((r): [number, string] => [r, 'BOTT'])];
    for (const [i, n] of expect) if (this.recs[i]?.name !== n) throw new Error(`z05WAB: record ${i} is ${this.recs[i]?.name}, expected ${n}`);
    this.base = REC.HOLE.map((i) => this.rec(i));
    this.cur = this.base.slice();
    for (let i = 0; i < 4; i++) { this.y[i] = WAB.BASE_Y; this.cur[i].y = WAB.BASE_Y; this.cur[i].savePrev(); }
    this.sh.host.setFrame('flsh', 0, 0);
  }

  /** FUN_00569f50 */
  update(w: World, _rec?: GameRecord, _ctrl?: Controller): number {
    this.init(w);
    const sh = this.sh, host = sh.host;
    this.ticks++;
    this.presentation(w);                                      // FUN_0056bb20
    host.play(SND.AMBIENT);
    if (this.hitStage >= 0) this.hitAnimation();               // FUN_0056c6a5
    if (this.timeLeft < WAB.ALARM_AT) {
      this.c168 = f32(this.c168 + 1);                          // FUN_0056c8f1: the flashing light of FLSH
      host.setFrame('flsh', 0, Math.trunc(this.c168) % 6);
      host.play(SND.ALARM1); host.play(SND.ALARM2);
    }
    const snap = this.elapsed;
    if (this.timeLeft <= 0) this.endGame(w);
    else this.playTick(w, snap);
    return NODE_CONTINUE;
  }

  /** the end of the game: bots and lids put back, the percentage, Pepper's win / lose clip */
  private endGame(w: World) {
    const host = this.sh.host;
    for (let i = 0; i < 4; i++) { this.cur[i].y = WAB.BASE_Y; }
    this.rec(REC.LIDL).m[14] = LID.END_Z.LIDL; this.rec(REC.LIDR).m[14] = LID.END_Z.LIDR;
    this.rec(REC.LIDU).m[14] = LID.END_Z.LIDU; this.rec(REC.LIDD).m[14] = LID.END_Z.LIDD;
    this.sh.over = 1;
    for (let i = 0; i < 4; i++) this.cur[i].flags = 0;         // FUN_0056b1dc
    this.sh.pct = percentOf(this.hits, this.misses);
    host.stop(SND.ALARM1); host.stop(SND.ALARM2);
    const pep = w.records[REC.PEPP];
    if (WAB.WIN_PCT <= this.sh.pct) pep.anim?.start(WAB.CLIP.WIN, 0); else pep.anim?.start(WAB.CLIP.STUN, 0);
    this.sh.clip = WAB.CLIP.IDLE;
  }

  /** the running part of FUN_00569f50 (time left > 0); `snap` = the tick counter at the start of the call (`local_5c`) */
  private playTick(w: World, snap: number) {
    const sh = this.sh, host = sh.host;
    const R = WAB.RANGE, base = WAB.BASE_Y;
    this.timeLeft = f32(this.timeLeft - 1);
    this.elapsed = f32(this.elapsed + 1);
    // the HUD strings
    if (!this.clockOn) this.timeText = '';
    else { const secs = Math.trunc(this.timeLeft / 30); this.timeText = `${String(Math.trunc(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`; }
    this.hitsText = String(this.hits); this.missText = String(this.misses);
    this.pctText = this.hits === 0 && this.misses === 0 ? '0%%' : `${String(Math.trunc(percentOf(this.hits, this.misses))).padStart(2, ' ')}%%`;
    if (this.timeLeft < WAB.ALARM_AT && Math.trunc(this.elapsed) % 5 === 0) this.clockOn = !this.clockOn;
    if (780 < this.timeLeft || this.mark780) { if (this.timeLeft <= 1740 && !this.mark1740) this.mark1740 = true; } else this.mark780 = true;
    // the four difficulty stages
    const t = this.timeLeft;
    if (t >= WAB.STAGE_LIMITS[2]) {
      if (t >= WAB.STAGE_LIMITS[1]) { if (t < WAB.STAGE_LIMITS[0]) { this.hold = WAB.STAGES[1][0]; this.gap = WAB.STAGES[1][1]; } }
      else { this.hold = WAB.STAGES[2][0]; this.gap = WAB.STAGES[2][1]; }
    } else { this.hold = WAB.STAGES[3][0]; this.gap = WAB.STAGES[3][1]; }

    // the four holes
    let active = 0;
    let pos: [number, number, number] | null = null;
    for (let i = 0; i < 4; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      pos = [this.cur[i].x, this.cur[i].y, this.cur[i].z];
      active++;
      if (st === 1) {
        this.y[i] = f32(this.y[i] + (R / WAB.RISE) * 1);
        if (base + R <= this.y[i]) { this.y[i] = f32(base + R); this.state[i] = 2; this.tUp[i] = Math.trunc(snap); }
        this.cur[i].y = this.y[i];
      } else if (st === 2) {
        if (this.hold < snap - this.tUp[i]) {
          this.state[i] = 3;
          host.play(CLOSE_SOUND[i]);
        }
      } else if (st === 3) {
        const d = R / WAB.FALL;
        this.y[i] = f32(this.y[i] - (d + d) * 1);
        this.cur[i].y = this.y[i];
        if (this.y[i] <= base && this.closeT === -1 && this.lidDone === 0) { this.closeT = 0; this.closeHole = i; }
        if (this.y[i] <= base) {
          this.y[i] = base;
          this.cur[i].y = base;
          this.state[i] = 0;
          this.lastDown = Math.trunc(this.elapsed);
          this.cur[i].flags = 0;
          if (this.isInfo[i] === 0 && this.whacked[i] === 0) {
            this.misses = (this.misses + 1) & 0xff;
            this.reactT = 0; this.reactKind = 4;               // the TV shows the red cross
          }
          this.cur[i] = this.base[i];
          this.isInfo[i] = 0;
          this.cur[i].flags = 0;
        }
      }
    }
    if (active === 0) {
      for (let i = 0; i < 4; i++) { this.cur[i].flags = 0; this.cur[i] = this.base[i]; }
      if (this.lastDown + this.gap < this.elapsed) this.spawn();
    }

    // Pepper's hammer lands on frame 12 of a swing
    const pep = w.records[REC.PEPP];
    const frame = pep.anim?.frame ?? 0;
    if (WAB.HIT_FRAME <= frame && frame < 1 + WAB.HIT_FRAME && sh.clip !== WAB.CLIP.IDLE) {
      const hole = [3, 0, 1, 2][sh.clip - 4] ?? -1;            // clip 4 (down) -> hole 3, 5 (up) -> 0, 6 (left) -> 1, 7 (right) -> 2
      if (hole >= 0) this.whack(hole, pos);
    }
    // (the original's +0x18c / +0x18d counters after a hit only feed an unused local)
    host.scrollV?.(23, f32(0.0003 * 1));
  }

  /** a bot comes out of a random hole (FUN_00569f50: `random & 3` picks the hole, `random & 7 == 0` makes it the Infomaniac) */
  private spawn() {
    const host = this.sh.host;
    const h = host.random(4);
    this.state[h] = 1;
    host.play(OPEN_SOUND[h]);
    this.whacked[h] = 0;
    if (host.random(8) === 0) {
      const info = this.rec(REC.INFO);
      copyMatrix(info, this.cur[h]);
      this.cur[h] = info;
      this.isInfo[h] = 1;
    }
    this.cur[h].flags |= 1; this.cur[h].flags |= 2;
    this.openT = 0; this.openHole = h;
    this.cur[h].y = this.y[h];
  }

  /** the hammer lands on `hole` */
  private whack(hole: number, pos: [number, number, number] | null) {
    const sh = this.sh, host = sh.host;
    if (this.y[hole] < WAB.BASE_Y + WAB.RANGE) { host.play3d(SND.MISS, pos); return; }   // not fully up: a miss (sound only)
    if (this.whacked[hole] !== 0) return;
    if (this.isInfo[hole] === 0) {
      this.hits = (this.hits + 1) & 0xff;
      const r = host.random(8);
      if (r === 0) host.say(LINE.BOT_SEA); else if (r === 1) host.say(LINE.BOT_MOAN);
      this.reactT = 0; this.reactKind = hole;
      this.hitStage = 0; this.hitT = 0;
      host.play3d(SND.HIT_BOT, pos);
    } else {
      host.play3d(SND.HIT_INFO, pos);
      const r = host.random(3);
      host.say(r === 0 ? LINE.INFO_SORRY : r === 1 ? LINE.INFO_LOOK : LINE.INFO_BREATH);
      sh.stun = WAB.STUN;
      this.reactT = 0; this.reactKind = 4;
      this.hitStage = 0; this.hitT = 0;
    }
    this.whacked[hole] = 1;
    // (the original also tests `state[hole] == 1 || state[stale local] == 2` here: a bot that is fully up is in state 2, the test never holds)
    if (this.state[hole] === 1) { this.state[hole] = 3; host.play(CLOSE_SOUND[hole]); }
  }

  /** FUN_0056c6a5: the stage of the whack animation swaps the model of the hole's bot (BOT1.. / INF1..) and moves the timer on */
  private hitAnimation() {
    let h = -1;
    for (let i = 0; i < 4; i++) if (this.state[i] !== 0) h = i;
    if (h >= 0) {
      this.cur[h].flags = 0;
      const k = this.hitStage & 0xf;
      const r = this.rec((this.isInfo[h] === 0 ? REC.BOT1 : REC.INF1) + k);
      copyMatrix(r, this.cur[h]);
      this.cur[h] = r;
      r.flags |= 1; r.flags |= 2;
    }
    this.hitT = f32(this.hitT + 1);
    this.hitStage = Math.trunc(this.hitT);
    if (WAB.HIT_STAGES < this.hitStage) { this.hitStage = -1; this.hitT = -1; }
  }

  /** FUN_0056bb20: the room's animations, every 2nd tick: spinning gears, the Infomaniac's TV, the radar, the lids */
  private presentation(w: World) {
    const host = this.sh.host;
    this.c16c = f32(this.c16c - 1);
    if (this.c16c > 0) return;
    this.c158 = f32(this.c158 + 1); this.c15c = f32(this.c15c + 1); this.c160 = f32(this.c160 + 1);
    let pct = 0;
    if (this.hits !== 0 || this.misses !== 0) pct = percentOf(this.hits, this.misses);
    const pep = w.records[REC.PEPP];
    const stunned = pep.anim?.clip === WAB.CLIP.STUN;
    if (!stunned) {
      this.c164 = f32(this.c164 + 2.25);
      if (8 < this.c164) this.c164 = 0;
      for (const g of [this.rec(REC.G000), this.rec(REC.G001)]) {
        g.rz = f32(g.rz + 0.009 * pct * 1);
        g.setEuler(g.rx, g.ry, g.rz, g.x, g.y, g.z);
      }
    }
    // (slot 0x1c of LAND is a plain texture in this build: the original's call has no effect)
    if (10 < this.c160) this.c160 = 0;
    host.setFrame('land', 0x1b, stunned ? Math.trunc(this.c160) % 5 + 10 : Math.trunc(this.c160));
    if (this.reactT < 0) host.setFrame('land', 10, Math.trunc(this.c158) % 6);
    else {
      const n = Math.trunc(this.c158);
      switch (this.reactKind) {
        case 0: host.setFrame('land', 10, n % 3 + 6); break;
        case 1: host.setFrame('land', 10, n % 3 + 0xc); break;
        case 2: host.setFrame('land', 10, n % 3 + 0xf); break;
        case 3: host.setFrame('land', 10, n % 3 + 9); break;
        case 4: host.setFrame('land', 10, n % 5 + 0x12); break;
      }
      this.reactT = f32(this.reactT + 1);
      if (9 < this.reactT) this.reactT = -1;
    }
    if (this.openT >= 0) {
      this.moveLid(this.openHole, true);
      this.openT = f32(this.openT + 1);
      if (2 < this.openT) { this.openT = -1; this.lidDone = 0; }
    }
    if (this.closeT >= 0) {
      this.moveLid(this.closeHole, false);
      this.closeT = f32(this.closeT + 1);
      if (2 < this.closeT) { this.closeT = -1; this.lidDone = 1; }
    }
    this.c16c = 2;
  }

  /** one step of a lid opening (away from the hole) or closing */
  private moveLid(hole: number, open: boolean) {
    const lid = this.rec(LID_OF_HOLE[hole]);
    const step = (WAB.RANGE / WAB.RISE) * 1 * 8;
    const axis = hole === 0 || hole === 3 ? 14 : 12;               // LIDU / LIDD slide in z, LIDL / LIDR in x
    let v = lid.m[axis];
    let y = lid.m[13];
    if (open) {
      // hole 0: z grows to 5.888; 1: x falls to 0; 2: x grows to 0; 3: z falls to 5.75
      if (hole === 0) { v = v + step; if (LID.OPEN[0] < v) v = LID.OPEN[0]; }
      else if (hole === 1) { v = v - step; if (v < 0) v = 0; }
      else if (hole === 2) { v = v + step; if (0 < v) v = 0; }
      else { v = v - step; if (v < LID.OPEN[3]) v = LID.OPEN[3]; }
      y = y - LID.Y_STEP; if (y < LID.OPEN_Y) y = LID.OPEN_Y;
    } else {
      if (hole === 0) { v = v - step; if (v < LID.CLOSED[0]) v = LID.CLOSED[0]; }
      else if (hole === 1) { v = v + step; if (LID.LIDL_LIMIT < v) v = LID.CLOSED[1]; }
      else if (hole === 2) { v = v - step; if (v < LID.CLOSED[2]) v = LID.CLOSED[2]; }
      else { v = v + step; if (LID.CLOSED[3] < v) v = LID.CLOSED[3]; }
      y = y + LID.Y_STEP; if (LID.CLOSED_Y < y) y = LID.CLOSED_Y;
    }
    lid.m[axis] = v; lid.m[13] = y;
  }
}
