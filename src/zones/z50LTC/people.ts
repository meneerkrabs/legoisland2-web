// z50LTC, the "Meet the team" cave (easter egg room, zone table index 34): the 26 developer minifigs ("People.c"), Pepper's mode switch of the room ("PepSwitc"
// copy at 0x83ab7b) and the state they share. Pure logic (no DOM): runs on the engine's World / GameRecord / Controller, so the node tests can drive it.
// Docs: docs/re/m3/z50LTC.md. Addresses are VAs of the NL retail build.
//
//   People constructor  0x83a7d2  vtable 0x95d990 { update 0x839e20, prerender 0x83a292, destroy 0x83a9a4, draw 0x83a735 (FUN_00444480) }
//   attach loop         0x839748  for every row of the people table (0x95d2c0): controller flags 0x13, FUN_00423532(rec, People, {row}, pos 0, var 2, mask 0, value 0),
//                                 record flags |= 0x40
//   pepswitc constructor 0x83ab7b vtable 0x95da00 { update 0x83a9e0, prerender 0x83aa48, destroy 0x83ac19, draw 0x83aa8d }
//   sounds of the people 0x839560 (27 x FUN_004433b0(sound id) into DAT_05d5f660[])
import type { Pe } from '../../formats/exe.ts';
import { NODE_CONTINUE, NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { B } from '../../game/input.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { V } from '../../game/vars.ts';
import type { World } from '../../game/world.ts';

/** the table of the people: 0x24 bytes per row from 0x95d2c0, terminated by a row whose record is -1 (the loop of FUN_00839748 tests the word at +4) */
export const PEOPLE_TABLE_VA = 0x95d2c0;
export const PEOPLE_ROW = 0x24;

export interface PersonEntry {
  /** +0x00: which set of people the row belongs to: -2 / -1 always present (-1 = talking to this person swaps the two sets), 0 / 1 = only while DAT_05d5f6dc has that value */
  cond: number;
  /** +0x04: record index of the zone (PBAK = 12 ...) */
  record: number;
  /** +0x08 / +0x0c: name and job strings of the executable (read at run time: they are English in every release) */
  name: string;
  role: string;
  /** +0x10: clip of the idle pose (a single frame) */
  idleClip: number;
  /** +0x12: clip of the talk animation of the minifig */
  talkClip: number;
  /** +0x14: 0 plain, 1 Paul Scully (two `paul01` particle emitters at the hand bones 0xe / 0x10), 2 Andy Bray (Pepper reacts at frame 32), 3 / 4 / 5 the talk clip plays 2 / 3 / 4 times */
  type: number;
  /** +0x1c: index of the sound of the row (sound ids of FUN_00839560: `readPersonSounds`) */
  sound: number;
  /** +0x20: clip Pepper plays while listening */
  pepperClip: number;
}

const rd16 = (pe: Pe, va: number) => { const v = pe.at(va) | (pe.at(va + 1) << 8); return v & 0x8000 ? v - 0x10000 : v; };
const rd32 = (pe: Pe, va: number) => pe.u32(va) | 0;

/** read the people table out of the executable */
export function readPeopleTable(pe: Pe): PersonEntry[] {
  const out: PersonEntry[] = [];
  for (let i = 0; i < 64; i++) {
    const va = PEOPLE_TABLE_VA + i * PEOPLE_ROW;
    const record = rd32(pe, va + 4);
    if (record === -1) break;
    out.push({
      cond: rd32(pe, va), record, name: pe.cstr(pe.u32(va + 8)), role: pe.cstr(pe.u32(va + 12)),
      idleClip: rd16(pe, va + 0x10), talkClip: rd16(pe, va + 0x12), type: rd16(pe, va + 0x14), sound: rd32(pe, va + 0x1c), pepperClip: rd16(pe, va + 0x20),
    });
  }
  return out;
}

/**
 * The sound ids FUN_00839560 loads (`push id; call FUN_004433b0; mov [DAT_05d5f660 + 4 * k], eax`): scanned out of the code, result indexed by k (the `sound` field of the rows).
 * 300 = SND_SILENCE (no file).
 */
export function readPersonSounds(pe: Pe): number[] {
  const start = 0x839560, end = 0x839748, base = 0x5d5f660;
  const out: number[] = [];
  for (let va = start; va < end - 16; va++) {
    // push imm32 (68) or push imm8 (6a), call FUN_004433b0, add esp, 4, mov [addr], eax (a3)
    let id: number, len: number;
    if (pe.at(va) === 0x68) { id = pe.u32(va + 1); len = 5; } else if (pe.at(va) === 0x6a) { id = pe.at(va + 1); len = 2; } else continue;
    const c = va + len;
    if (pe.at(c) !== 0xe8 || pe.at(c + 5) !== 0x83 || pe.at(c + 6) !== 0xc4 || pe.at(c + 7) !== 0x04 || pe.at(c + 8) !== 0xa3) continue;
    if (c + 5 + (pe.u32(c + 1) | 0) !== 0x4433b0) continue;
    out[(pe.u32(c + 9) - base) / 4] = id;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// constants (the .rdata floats of the functions above)

/** 0x8920c0: squared distance beyond which a pushed-back person returns to its place (2.08 units) */
export const RELEASE_DIST2 = 4.3264;
/** 0x8920b8: nearest distance Pepper is allowed to talk from (the person is pushed back by the difference) */
export const TALK_DISTANCE = 1.28;
/** 0x892088: frame of Andy Bray's talk clip after which Pepper reacts */
export const REACT_FRAME = 32;
/** 0x8920bc: Pepper falling below this height is put back to where the node was created */
export const FALL_LIMIT = -80;
/** DAT_008ae330 as the walk node leaves it (0x44100000 = 576.0: 24 units, squared) and as the pepswitc draw hook resets it (0x42800000 = 64.0) */
export const CANDIDATE_WALK = 576;
export const CANDIDATE_IDLE = 64;
/** the appear / vanish effect: DAT_05d5f6e0 is set to 5.0 (one person per 5 ticks changes), the twinkle stops 3 ticks later (node + 0x25) */
export const CHANGE_DELAY = 5;
export const TWINKLE_TICKS = 3;
/** Pepper's idle pose clip while talking (0x78) and the clip the walk node resumes with (0x1b) */
export const CLIP_HOLD = 0x78;
export const CLIP_IDLE = 0x1b;
/** PEPPER_CONTROL while talking */
export const PC_TALK = 0x20;

const PI = Math.PI, TWO_PI = 2 * Math.PI;
/** the single wrap of the original: `if (a >= -pi) { if (a > pi) a -= 2 pi } else a += 2 pi` */
export const wrapAngle = (a: number) => (a >= -PI ? (a > PI ? a - TWO_PI : a) : a + TWO_PI);

/** the globals of the room (DAT_05d5f6dc, 05d5f6e0, 009daa80, 008ae330 and the HUD text slots of FUN_0045f750 / DAT_05d4df1c / 05d4dfec) */
export class LtcGlobals {
  /** DAT_05d5f6dc: which set of people is present (0 / 1); it survives the zone like the process global does (see `persistedToggle`) */
  toggle = 0;
  /** DAT_05d5f6e0: ticks until the next person may appear / vanish (set to 5 by every change, counted down by the pepswitc node) */
  timer = 0;
  /** DAT_009daa80: the person the next Shift press talks to (null = nobody) */
  candidate: PeopleNode | null = null;
  /** DAT_008ae330: squared distance of the candidate (a new candidate has to be nearer); .data initial 12.0 */
  candDist = 12;
  /** FUN_0045f750(mode): the cinematic bars (0 off, 1 top + bottom) */
  letterbox: 0 | 1 | 2 = 0;
  /** the HUD text slots DAT_05d4df1c (name) and DAT_05d4dfec (job): empty = nothing drawn */
  name = '';
  role = '';
  /** effects of the port (the original starts particles: `TWINKLE01.par` and the `paul01` hand emitters); `start` false = stop */
  onTwinkle?: (rec: GameRecord, start: boolean) => void;
  onPaul?: (rec: GameRecord, start: boolean) => void;
  /** FUN_004433f0(DAT_05d5f660[k], Pepper's position): the minifig's sound by sound-table id */
  playSound?: (id: number) => void;
  /** the sound ids by index (`readPersonSounds`) */
  sounds: number[] = [];
  /** log of the talks (diagnostics, tests) */
  talks = 0;
  reset(toggle = 0) {
    this.toggle = toggle; this.timer = 0; this.candidate = null; this.candDist = 12; this.letterbox = 0; this.name = ''; this.role = ''; this.talks = 0;
  }
}

/** the room's toggle as the process keeps it between visits (the original never resets DAT_05d5f6dc) */
export const persisted = { toggle: 0 };

/** People.c: one per row of the table, attached to the record of the minifig */
export class PeopleNode implements BehaviourNode {
  readonly kind = 'People';
  var = V.NS_ON; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly entry: PersonEntry;
  readonly index: number;
  readonly g: LtcGlobals;
  /** +0x34: talk loops still to play (0 = not talking) */
  talk = 0;
  /** +0x36: Pepper's reaction clip of type 2 was started */
  reacted = 0;
  /** +0x24 / +0x28..0x30: the person was pushed back from Pepper at `saved` */
  pushed = false;
  saved: [number, number, number] = [0, 0, 0];
  /** +0x25: ticks of the twinkle effect left */
  twinkle = 0;

  constructor(entry: PersonEntry, index: number, g: LtcGlobals) { this.entry = entry; this.index = index; this.g = g; }

  get talking() { return this.talk > 0; }

  /** FUN_00839e20 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const g = this.g, e = this.entry;
    if (this.pushed && ctrl.distSq > RELEASE_DIST2) { rec.y = this.saved[1]; rec.x = this.saved[0]; rec.z = this.saved[2]; }
    if (this.twinkle > 0 && --this.twinkle === 0) g.onTwinkle?.(rec, false);
    const present = e.cond < 0 || e.cond === g.toggle;
    if (!present) {
      if ((rec.flags & RF_ENABLED) !== 0 && g.timer <= 0) {
        rec.flags &= ~RF_ENABLED;
        g.onTwinkle?.(rec, true);
        this.twinkle = TWINKLE_TICKS; g.timer = CHANGE_DELAY;
      }
      return NODE_NONE;
    }
    if ((rec.flags & RF_ENABLED) === 0 && g.timer <= 0) {
      rec.flags |= RF_ENABLED;
      g.onTwinkle?.(rec, true);
      this.twinkle = TWINKLE_TICKS; g.timer = CHANGE_DELAY;
    }
    const shift = (w.input.pressed & B.SHIFT) !== 0;
    if (this.talk <= 0) {
      rec.anim?.advance(1, w.dt);
      if (shift && !(g.candDist <= ctrl.distSq)) { g.candidate = this; g.candDist = ctrl.distSq; }
      return NODE_CONTINUE;
    }
    if (rec.anim && rec.anim.advance(1, w.dt) !== 0) this.talk--;
    if (e.type === 2) {
      const p = w.focus;
      if (rec.anim && rec.anim.frame > REACT_FRAME && this.reacted === 0 && p?.anim) { p.anim.start(e.pepperClip, 0); this.reacted = 1; }
    }
    if (shift || this.talk <= 0) {
      // the talk ends (Shift again, or the loops are played): back to the idle pose, Pepper walks on
      if (e.type === 1) { g.onPaul?.(rec, false); }
      rec.anim?.start(e.idleClip, 0);
      if (e.cond === -1) g.toggle = g.toggle === 0 ? 1 : 0;       // Lara Sweeney / Rich Hancock / Darren Drabwell: the other half of the team shows up
      this.talk = 0;
      g.candidate = null; g.candDist = -1;
      g.name = ''; g.role = '';
      g.letterbox = 0;
      w.vars.set(V.PEPPER_CONTROL, 1);
      w.focus?.anim?.start(CLIP_IDLE, 0);
      if (rec.anim && rec.anim.clip !== e.idleClip) rec.anim.start(e.idleClip, 0);
      this.afterTalk?.(w);
      return NODE_CONTINUE;
    }
    return NODE_STOP;
  }

  /** hook of the port: the walk node resumes in the idle state after a talk (the original's walk code finds its state byte unchanged) */
  afterTalk?: (w: World) => void;

  /** FUN_0083a292: the person turns to Pepper; the chosen one starts the talk */
  prerender(w: World, rec: GameRecord, _ctrl: Controller) {
    const g = this.g, e = this.entry;
    const p = w.focus;
    if (!p) return;
    let ang = wrapAngle(Math.atan2(p.x - rec.x, p.z - rec.z));
    rec.ry = ang;
    rec.setEuler(0, ang, 0, rec.x, rec.y, rec.z);
    if (!((w.input.pressed & B.SHIFT) !== 0 && g.candidate === this)) return;
    // ---- the talk starts
    w.vars.set(V.PEPPER_CONTROL, PC_TALK);
    ang = wrapAngle(Math.atan2(rec.x - p.x, rec.z - p.z));
    p.ry = ang;
    p.setEuler(0, ang, 0, p.x, p.y, p.z);
    const dx = rec.x - p.x, dz = rec.z - p.z;
    const dist = Math.sqrt(dz * dz + dx * dx);
    if (dist < TALK_DISTANCE) {
      const over = TALK_DISTANCE - dist;
      if (!this.pushed) this.saved = [rec.x, rec.y, rec.z];
      this.pushed = true;
      rec.x -= rec.fx * over; rec.y -= rec.fy * over; rec.z -= rec.fz * over;
    }
    g.letterbox = 1;
    g.name = e.name; g.role = e.role;
    rec.anim?.start(e.talkClip, 0);
    p.anim?.start(e.pepperClip, 0);
    this.talk = 1;
    switch (e.type) {
      case 1: g.onPaul?.(rec, true); break;
      case 2: this.reacted = 0; p.anim?.start(CLIP_HOLD, 0); break;
      case 3: this.talk = 2; break;
      case 4: this.talk = 3; break;
      case 5: this.talk = 4; break;
      default: break;
    }
    g.talks++;
    const snd = g.sounds[e.sound];
    if (snd !== undefined) g.playSound?.(snd);
  }
}

/** Pepper's mode switch of the room (the zone's own PepSwitc copy): the listening animation, the appear timer, the fall guard, the reset of the talk candidate */
export class LtcPepSwitch implements BehaviourNode {
  readonly kind = 'pepswitc';
  var = V.PEPPER_CONTROL; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly g: LtcGlobals;
  /** +0x14..0x1c: the position of the record when the node was created (FUN_0083ab7b) */
  home: [number, number, number] = [0, 0, 0];
  homeSet = false;
  /** how often the fall guard put Pepper back (diagnostics) */
  respawns = 0;
  constructor(g: LtcGlobals) { this.g = g; }

  /** FUN_0083a9e0: while talking (PEPPER_CONTROL == 0x20) Pepper's animation advances here and falls back to the hold pose when a clip ends; the walk node does not run then */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.homeSet) { this.home = [rec.x, rec.y, rec.z]; this.homeSet = true; }
    const pc = w.vars.get(V.PEPPER_CONTROL);
    if (pc !== PC_TALK) {
      // the walk node (SGwalk, 0x42d514) starts its update with DAT_008ae330 = 576.0
      if ((pc & 1) !== 0) this.g.candDist = CANDIDATE_WALK;
      return NODE_CONTINUE;
    }
    if (rec.anim && rec.anim.advance(1, w.dt) !== 0) rec.anim.start(CLIP_HOLD, 0);
    return NODE_STOP;
  }

  /** FUN_0083aa48 */
  prerender(w: World, _rec: GameRecord, _ctrl: Controller) {
    if (this.g.timer >= 0) this.g.timer -= 1 * w.dt;
  }

  /** the draw hook FUN_0083aa8d (the port's renderer does not call node draw hooks: the zone game calls this after every tick) */
  draw(_w: World, rec: GameRecord, _ctrl: Controller): number {
    if (rec.y < FALL_LIMIT) { rec.x = this.home[0]; rec.y = this.home[1]; rec.z = this.home[2]; this.respawns++; }
    this.g.candDist = CANDIDATE_IDLE;
    this.g.candidate = null;
    return 0;
  }
}
