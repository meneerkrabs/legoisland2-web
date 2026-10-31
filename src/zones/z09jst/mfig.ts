// "mfigman" (Common\...\mfigman, FUN_005f3a90 and friends, 0x74 bytes): a group of records that act as one animated rider on a horse. The first record (the horse) is the
// master: the manager builds its matrix from a position and an Euler vector it points at, advances its animation and gives the other records of the group (saddle,
// cloak) the same matrix and frame; the last record (the knight) either does the same (mode 1) or runs its own animation without a matrix (mode 0, the knight
// falls off / is lifted while the horse goes on and the zone code places him itself). The group's clip numbers come from a table (a row of four dwords per animation
// state: the clip of each record).
//   FUN_005f3a90 / FUN_005f3aef  create / re-init          FUN_005f3b61  bind records + start row `row`      FUN_005f3c66  start the clips of a row
//   FUN_005f3d78  advance(rate, noWrap)                     FUN_005f3f1b  seek(frame)                        FUN_005f3d6a  mode
//   FUN_005f3ce1  matrix of the last record                 FUN_005f3cf6  matrix of bone `i` of the last record's pose
import type { GameRecord } from '../../game/record.ts';
import { toWorld } from '../exact.ts';

export class MfigMan {
  /** *manager (the position the master is placed at) and manager[1] (its Euler angles): references to the duel node's vectors */
  readonly pos: number[];
  readonly rot: number[];
  readonly table: readonly (readonly number[])[];
  recs: GameRecord[] = [];
  /** manager + 0x30 + 4 i: the clip each record plays now */
  clip: number[] = [];
  /** manager + 8: 1 = the last record follows the master, 0 = it runs on its own */
  mode = 1;
  /** the frame step of the engine's advance function (FUN_0043b76a multiplies the rate by DAT_008b1718 = `world.dt`); the duel sets it every tick before it advances anything */
  dt = 1;

  constructor(table: readonly (readonly number[])[], pos: number[], rot: number[]) { this.table = table; this.pos = pos; this.rot = rot; }

  /** FUN_005f3b61(mgr, n, recs, row): records of a previous binding are hidden (flag 2 cleared), the new ones start their clips of `row` and are shown */
  bind(recs: GameRecord[], row: number) {
    for (const r of this.recs) r.flags &= ~2;
    this.recs = recs;
    this.mode = 1;
    this.clip = recs.map((_, i) => this.table[row]?.[i] ?? 0);
    recs.forEach((r, i) => { r.anim?.start(this.clip[i], 0); r.flags |= 2; });
  }

  /** FUN_005f3c66 */
  setClips(row: number) {
    for (let i = 0; i < this.recs.length; i++) {
      this.clip[i] = this.table[row]?.[i] ?? 0;
      this.recs[i].anim?.start(this.clip[i], 0);
    }
  }

  /** FUN_005f3d6a */
  setMode(m: number) { this.mode = m; }

  get master(): GameRecord { return this.recs[0]; }
  get rider(): GameRecord { return this.recs[this.recs.length - 1]; }
  /** FUN_005f3ce1: the matrix of the last record (the position of the knight, `+0xc` of the record) */
  riderRec(): GameRecord { return this.rider; }

  private placeMaster() {
    const m = this.master;
    m.setEuler(this.rot[0], this.rot[1], this.rot[2], this.pos[0], this.pos[1], this.pos[2]);
  }

  /** the master's matrix to the records in between (and, in mode 1, the last one), their animations to the master's frame `t` */
  private follow(t: number) {
    const m = this.master, n = this.recs.length;
    for (let i = 1; i < n - 1; i++) { this.recs[i].m.set(m.m); this.recs[i].anim?.seek(t); }
  }

  /**
   * FUN_005f3d78(&t, mgr, rate, noWrap): the master's matrix from position / angles, its animation advanced by `rate`; `t` = the frame it is at, the result of the master's
   * advance is kept in a local (asm 0x5f3df7 `mov [ebp-8], eax`; the decompile hides it). Mode 0: the last record runs its own animation by `rate` and, when a one-shot ends
   * (result 2) and `noWrap` is 0, holds on its last frame; the result is that animation's. Mode 1: the last record copies the matrix and the frame, the result is the master's.
   */
  advance(rate: number, noWrap = 0): { t: number; res: number } {
    this.placeMaster();
    const ma = this.master.anim;
    const mres = ma ? ma.advance(rate, this.dt) : 0;
    const t = ma ? ma.frame : 0;
    this.follow(t);
    const last = this.rider;
    if (this.mode === 0) {
      const la = last.anim;
      const res = la ? la.advance(rate, this.dt) : 0;
      if (la && res === 2 && !noWrap) la.seek(la.frameCount - 1);
      return { t, res };
    }
    last.m.set(this.master.m);
    last.anim?.seek(t);
    return { t, res: mres };
  }

  /** FUN_005f3f1b(&t, mgr, frame): like `advance`, but the master's animation is put on `frame` instead (the last record: mode 0 seeks `frame` itself) */
  seek(frame: number): number {
    this.placeMaster();
    const ma = this.master.anim;
    ma?.seek(frame);
    const t = ma ? ma.frame : 0;
    this.follow(t);
    const last = this.rider;
    if (this.mode === 0) last.anim?.seek(frame);
    else { last.m.set(this.master.m); last.anim?.seek(t); }
    return t;
  }

  /** FUN_005f3cf6(mgr, bone): the pose of the last record's animation with an identity root, the translation of bone `bone` (matrix elements 12..14) */
  boneLocal(bone: number): [number, number, number] | null {
    const p = this.rider.anim?.pose(1);
    if (!p || p.length < (bone + 1) * 16) return null;
    return [p[bone * 16 + 12], p[bone * 16 + 13], p[bone * 16 + 14]];
  }
  /** the bone's position in the world: the original multiplies the bone with the last record's matrix (FUN_0043ab72 / FUN_0043a9e5) */
  boneWorld(bone: number): [number, number, number] | null {
    const l = this.boneLocal(bone);
    if (!l) return null;
    return toWorld(this.rider.m, l);                      // FUN_0043ab72 per operation in float32
  }
}
