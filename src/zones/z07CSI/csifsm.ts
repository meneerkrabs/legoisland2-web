// CSIFSM, the castle's switch processor (ctor FUN_00575b44, "CSIFSM.c" at 0x8f848c; one node on the hologram record HOLO, the zone's cutscene-effects director like the island's
// src/island/trigger/lgifsm.ts): handler table 0x8f80f8 = { update FUN_005753b0 (returns 2), pre-render FUN_00575673 (returns 1), destroy FUN_00575c1e }. The gate is always open (var 2 = 1).
// Node (100 bytes): +0x00 var (2) / +0x0c mask (1) / +0x0e value (1), +0x18 the music activity level (1 / 2 / 3), +0x1c the level the groove was last set for, +0x20 the handle of the
// cedric.par emitter, +0x24 a private copy of the matrix of the record CEDR (47; the 64 bytes at +0x24..0x64), replaced while the cutscene's switch 0x113 is set by CEDR's bone 0x10.
//   * update (every tick):
//       - the cutscene sound table at 0x8f8110 (12 bytes: game variable, sound slot, record; ends with a variable <= 0, 15 entries = SWITCH_GME_CSM_SFX1..14): the csi01..09 scripts
//         `setswitch SWITCH_GME_CSM_SFXn 1` and this loop plays the sound the switch stands for at the record (3D sound handle 0x5d58904 + 4 * slot: FUN_004433f0) and sets the
//         variable to 2 (1 = start, 4 = keep playing at the record, 8 = stop (FUN_004434b0) and set 2);
//       - while a cutscene runs (FUN_0045c432) the records HORS (48) and BAR1 (29) get flag 0x10 (no collision), else it is cleared;
//       - var 0x113 (SWITCH_CSI_*, the knight's cedric.par smoke): 1 = the emitter's matrix := CEDR's bone 0x10 in the world (FUN_0043a9e5(node + 0x24, CEDR matrix, FUN_0043bc58(anim, 0x10))),
//         the emitter on (FUN_0044ea60(h, 2, 1, 1)) + FUN_0044ea00(h, matrix), var := 2; 2 = the matrix follows the bone; 3 = the emitter off, var := 0;
//   * pre-render (every tick the node ran): seven footstep sounds (3D) of the citizens: record, clip and the animation frame (truncated) that play `DAT_05d588f0 / ec / f4`, and the
//     music's activity level: while the horse HORS is in the frustum the clip 3 whose frame changed gives 3, else 1; otherwise Pepper's mode: walking (PEPPER_CONTROL & 1) clips 0x24 / 0x3f /
//     0x40 give 2, else 1; not walking: skateboard (& 4) 3, else 1; a change sets the DirectMusic groove `level - 3` (FUN_00443310).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Pe } from '../../formats/exe.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { NO_HANDLE } from '../../fx/particles/zone.ts';
import { inView } from '../../island/ambient/common.ts';
import { ctxOf, playAt, stop, f32, fb, boneWorld32 } from './common.ts';

export const CTOR_CSIFSM = 0x575b44;
/** the cutscene sound table (12 bytes per entry, ends with a variable <= 0) and the handle array its slots index (`_DAT_05d58904 + 4 * slot`, copies of the sound handles FUN_00572ef0 loaded) */
export const SOUND_TABLE_VA = 0x8f8110, SOUND_HANDLES = 0x5d58904;
export interface SoundCue { var: number; slot: number; record: number }
/** the table, read from the executable at run time */
export function readSoundTable(pe: Pe): SoundCue[] {
  const out: SoundCue[] = [];
  for (let va = SOUND_TABLE_VA; (pe.u32(va) | 0) > 0; va += 12) out.push({ var: pe.u32(va) | 0, slot: pe.u32(va + 4) | 0, record: pe.u32(va + 8) | 0 });
  return out;
}
/** the records the node reads (`DAT_00983804 + off`): CEDR (0x1318 = 47), HORS (0x1380 = 48), BAR1 (0xbc8 = 29: flags at +0x60 = 0xc28), PEPP (7), and the citizens whose footsteps are played */
const R = { CEDR: 47, HORS: 48, BAR1: 29, PEPPER: 7 } as const;
/** the footstep cues of the pre-render: [record index, clip, frame, sound handle global]; the position is the record's translation */
export const STEP_CUES: readonly (readonly [number, number, number, number])[] = [
  [37, 0x79, 2, 0x5d588f0], [38, 0x91, 1, 0x5d588ec], [26, 0x91, 3, 0x5d588f4], [27, 0x92, 3, 0x5d588ec], [28, 0x91, 1, 0x5d588f4], [39, 0x92, 6, 0x5d588f0], [40, 0x91, 4, 0x5d588f4],
];
/** the node's cedric.par: local position (0, -0.4, 1.6) (0xbecccccd / 0x3fcccccd), gate (1,1,1) = idle */
export const CEDRIC_EMITTER = 'cedric.par';
const CEDRIC_POS: readonly [number, number, number] = [0, fb(0xbecccccd), fb(0x3fcccccd)];
/** the bone of CEDR that carries the emitter (FUN_0043bc58(anim, 0x10)) */
const CEDRIC_BONE = 0x10;
/** DAT_008f81dc (initial 100) / DAT_05d5895c (initial 0) / DAT_05d58950 / DAT_05d5894c: the horse's clip and frame the pre-render remembers (globals of the executable: they survive the node) */
export interface FsmGlobals { lastFrame: number; lastClip: number }
const globals = new WeakMap<World, FsmGlobals>();

export class CsiFsmNode implements BehaviourNode {
  readonly kind = 'CSIFSM';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  /** +0x18 / +0x1c */
  level = 1; levelSet = 1;
  /** +0x20 */
  fxh = NO_HANDLE;
  /** +0x24 */
  readonly m = new Float32Array(16);
  private table: SoundCue[] | null = null;
  private built = false;

  /** `registerHub` calls this right after the set-up: FUN_00575b44's copy of the CEDR matrix */
  ctorInit(w: World, _rec: GameRecord): void {
    void _rec;
    if (this.built) return;
    this.built = true;
    const cedr = w.records[R.CEDR];
    if (cedr) this.m.set(cedr.m);
  }

  /** the constructor's emitter start (`FUN_00442960(cedric.par, node + 0x24, 0, -0.4, 1.6, 0, 0, 0, 1, 1, 1)`) */
  startEmitter(fx: ZoneParticles): void {
    this.fxh = fx.start(CEDRIC_EMITTER, this.m, CEDRIC_POS, [0, 0, 0], [1, 1, 1]);
  }

  private cues(w: World): SoundCue[] {
    if (this.table) return this.table;
    const pe = ctxOf(w)?.pe;
    return (this.table = pe ? readSoundTable(pe) : []);
  }

  /** FUN_005753b0 (returns 2) */
  update(w: World, _rec: GameRecord, _ctrl: Controller): number {
    void _rec; void _ctrl;
    const vars = w.vars, c = ctxOf(w);
    for (const e of this.cues(w)) {
      const v = vars.get(e.var);
      const pos = (): [number, number, number] => { const r = w.records[e.record]; return r ? [r.m[12], r.m[13], r.m[14]] : [0, 0, 0]; };
      if (v === 1) { playAt(w, SOUND_HANDLES + 4 * e.slot, pos()); vars.set(e.var, 2); }
      else if (v === 4) playAt(w, SOUND_HANDLES + 4 * e.slot, pos());
      else if (v === 8) { stop(w, SOUND_HANDLES + 4 * e.slot); vars.set(e.var, 2); }
    }
    const horse = w.records[R.HORS], bar = w.records[R.BAR1];
    if (!c?.cutsceneActive()) {
      if (horse) horse.flags &= ~0x10;
      if (bar) bar.flags &= ~0x10;
    } else {
      if (horse) horse.flags |= 0x10;
      if (bar) bar.flags |= 0x10;
    }
    const sw = vars.get(0x113);
    const cedr = w.records[R.CEDR];
    if (sw === 1) {
      if (cedr) boneWorld32(this.m, cedr, CEDRIC_BONE);
      const fx = c?.fx;
      if (fx) { fx.on(this.fxh); fx.setMatrix(this.fxh, this.m); }
      vars.set(0x113, 2);
    } else if (sw === 2) {
      if (cedr) boneWorld32(this.m, cedr, CEDRIC_BONE);
    } else if (sw === 3) {
      c?.fx?.off(this.fxh);
      vars.set(0x113, 0);
    }
    return NODE_CONTINUE;
  }

  /** FUN_00575673 (returns 1) */
  prerender(w: World, _rec: GameRecord, _ctrl: Controller): void {
    void _rec; void _ctrl;
    const g = globalsOf(w);
    for (const [ri, clip, frame, handle] of STEP_CUES) {
      const r = w.records[ri];
      if (!r || !inView(w, r)) continue;   // record flag 1 (FUN_00444370: in the view frustum)
      const a = r.anim;
      const cl = a ? a.clip : 0;
      const fr = Math.trunc(a ? a.frame : 0);                  // FUN_0043b73f -> __ftol
      if (cl === clip && fr === frame) playAt(w, handle, [r.m[12], r.m[13], r.m[14]]);
    }
    const horse = w.records[R.HORS];
    if (horse && inView(w, horse)) {
      const a = horse.anim;
      const clip = a ? a.clip : 0, frame = Math.trunc(a ? a.frame : 0);
      if (clip === g.lastClip && frame === g.lastFrame) return;   // (the original leaves the node's level alone and skips the groove change)
      this.level = clip === 3 && g.lastFrame !== frame ? 3 : 1;
      g.lastClip = clip; g.lastFrame = frame;
    } else {
      const ctrl = w.vars.get(0x5e);
      if ((ctrl & 1) !== 0) {
        const pc = w.records[R.PEPPER]?.anim?.clip ?? 0;
        this.level = pc === 0x24 || pc === 0x3f || pc === 0x40 ? 2 : 1;
      } else this.level = (ctrl & 4) !== 0 ? 3 : 1;
    }
    if (this.level !== this.levelSet) {
      ctxOf(w)?.musicGroove?.(((this.level - 3) << 24) >> 24);   // FUN_00443310((byte) (level - 3)): a signed byte
      this.levelSet = this.level;
    }
  }

  /** FUN_00575c1e: the node is freed */
  destroy(): void { /* nothing the port keeps */ }
}

export function globalsOf(w: World): FsmGlobals {
  let g = globals.get(w);
  if (!g) { g = { lastFrame: 100, lastClip: 0 }; globals.set(w, g); }
  return g;
}

export const csifsmFactory = (_a: Attach) => new CsiFsmNode();
export { f32 };
