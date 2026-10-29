// The decor / outfit swap of the island (Enter next to a record whose variant word is of type 1): FUN_00420bb7 (start), FUN_00420dc4 (every tick), FUN_00421bbe (apply the stored
// decor at the zone start), FUN_00421eb3 (store it), with the resolution FUN_00420837 does at set-up. Data in the executable:
//   sets   0x8acb98 + 0x18 s: +0 variant COUNT (FUN_00420674 rewrites it per era / trophies / BAATAT: src/island/decorsets.ts), +4 entry list (0x18 bytes each), +8 / +0xc / +0x10 / +0x14:
//          DAT_008acba0 / a4 / a8 / ac = the bone argument, the attachment slot (-1 = the whole record's model is swapped), the second attachment slot, the list of second models.
//   entry  +0 model group (-1 = the model of RECORD +4), +4 model index / record index; resolved at set-up: +8 model, +0xc collision object, +0x10 / +0x14 the second model + its bone.
//   decor  groups 0x8acdc0 {first, count} -> entries 0x8acdf0 (record, set | variant << 8), the record variant word (+0x64) = set << 8 | 1 | variant << 16, 0x1c0 stored (set, variant) bytes.
// Even sets swap the record's model + collision object for another record's (the hidden template records: BS00 .. FL00 ...); odd sets attach a model of group 0 / 1 to the minifig's skeleton
// (hat / hair / accessory, slot 5, bone 10) and optionally a second one (slot 0). The change is hidden by a 30 tick pop animation (scale and a half turn about y).
// Render side (FUN_0043e930 attach, FUN_0043e970 detach, FUN_0043e910 attachment matrix, FUN_00444600 shiny, record model pointer +4) goes through `DecorHost`.
import type { Pe } from '../formats/exe.ts';
import type { Model } from '../formats/exe.ts';
import type { GameRecord } from '../game/record.ts';
import type { ColObject } from '../game/collision.ts';
import { buildMatrix } from '../formats/matrix.ts';
import { readDecorTables } from '../shell/tables.ts';
import { composeBone } from './emitters.ts';

export const SETS_VA = 0x8acb98, SET_STRIDE = 0x18, ENTRY_STRIDE = 0x18;
const SLOTS = 8, FRAMES = 0x1e, MID = 0xf;
const PI_F = 3.1415927410125732, K_TURN = 8.5, K_SCALE_REC = 15, K_SCALE_ATT = 5;   // 0x89207c / 0x892078 / 0x892074 / 0x892070

export interface DecorRow { bone: number; slot: number; slot2: number; list: number }
export interface DecorEntry { group: number; index: number; model: Model | null; col: ColObject | null; child: Model | null; childBone: number }

/** what the swap needs of the world and the renderer */
export interface DecorHost {
  records: readonly GameRecord[];
  /** FUN_0043eaf0(model table group `group`, index) */
  model(group: number, index: number): Model | null;
  sfx(id: number): void;
  /** the record's model pointer (+4) */
  setModel(rec: GameRecord, model: Model | null): void;
  /** FUN_0043e930(model, child, bone, slot) / FUN_0043e970(model, slot): child null = detach */
  setAttach(rec: GameRecord, slot: number, bone: number, child: Model | null): void;
  /** FUN_0043e910(model, slot, matrix): the matrix the attachment is drawn with (null = none) */
  attachLocal(rec: GameRecord, slot: number, m: Float32Array | null): void;
  /** FUN_00444600(model, 1) */
  shiny(model: Model): void;
}

export class DecorState {
  /** DAT_009da350 + 0x48 s: the remaining ticks (-1 free, -2 waiting for Pepper to step away) */
  readonly cnt = new Int32Array(SLOTS).fill(-1);
  /** DAT_009da354: the record */
  readonly rec = new Int32Array(SLOTS).fill(-1);
  /** DAT_009da358: its matrix saved at the start (a whole-record swap) / the attachment's animation matrix */
  readonly mat: Float32Array[] = Array.from({ length: SLOTS }, () => new Float32Array(16));
  readonly rows: DecorRow[] = [];
  readonly entries: DecorEntry[][] = [];
  readonly counts: number[];
  readonly pe: Pe;
  readonly host: DecorHost;
  constructor(pe: Pe, host: DecorHost, counts: readonly number[]) {
    this.pe = pe; this.host = host;
    this.counts = counts as number[];
    const r = (a: number) => pe.u32(a) | 0;
    for (let s = 0; r(SETS_VA + s * SET_STRIDE) !== -1; s++) {
      const b = SETS_VA + s * SET_STRIDE;
      this.rows.push({ bone: r(b + 8), slot: r(b + 0xc), slot2: r(b + 0x10), list: r(b + 0x14) });
    }
  }

  /** FUN_00420837's resolution of every entry (once, at set-up) */
  resolve(): void {
    const pe = this.pe, h = this.host, r = (a: number) => pe.u32(a) | 0;
    for (let s = 0; s < this.rows.length; s++) {
      const row = this.rows[s], ent = r(SETS_VA + s * SET_STRIDE + 4), n = r(0x8accd0 + s * 0x14 + 16);   // the column 4 of the era table = the full entry count
      const list: DecorEntry[] = [];
      for (let k = 0; k < n; k++) {
        const e = ent + k * ENTRY_STRIDE, group = r(e), index = r(e + 4);
        const d: DecorEntry = { group, index, model: null, col: null, child: null, childBone: 0 };
        if (group === -1) { const rec = h.records[index]; d.model = rec?.model ?? null; d.col = rec?.colObj ?? null; }
        else {
          d.model = h.model(group, index);
          if (d.model) h.shiny(d.model);
          if (row.list !== 0) for (let j = 0; r(row.list + j * 12) !== -1; j++) {
            if (r(row.list + j * 12) === index) { d.child = h.model(group, r(row.list + j * 12 + 4)); d.childBone = r(row.list + j * 12 + 8); if (d.child) h.shiny(d.child); }
          }
        }
        list.push(d);
      }
      this.entries.push(list);
    }
  }

  private variantOf(rec: GameRecord) { return { set: (rec.variant >>> 8) & 0xff, idx: (rec.variant >>> 16) & 0xff }; }
  private colorOf(set: number, idx: number): DecorEntry | undefined { return this.entries[set]?.[idx]; }

  /** FUN_00420bb7(record): start the swap animation of a type-1 record (the Enter) */
  enter(recIdx: number): void {
    const H = this.host;
    H.sfx(LOOK_SOUND);
    let i = 0;
    for (; i < SLOTS && (this.rec[i] !== recIdx || this.cnt[i] === -2); i++) { /* find the record's own running slot */ }
    if (i !== SLOTS) return;
    let low = 0x5b, lowAt = 0;
    for (i = 0; ; i++) {
      if (7 < i) break;
      if (this.cnt[i] < low) { low = this.cnt[i]; lowAt = i; }
      if (this.cnt[i] < 0) break;
    }
    const rec = H.records[recIdx];
    if (i !== SLOTS) {   // a free slot
      this.cnt[i] = FRAMES; this.rec[i] = recIdx; this.mat[i].set(rec.m);
      if (this.rows[this.variantOf(rec).set]?.slot === -1) rec.colObj = null;   // FUN_00420bb7: +0x58 = NO_HANDLE while the whole record swaps
      return;
    }
    // all busy: the slot with the fewest ticks left is taken over (a whole-record swap in it is finished abruptly: its saved matrix back, no collision)
    const old = H.records[this.rec[lowAt]];
    if (old && this.rows[this.variantOf(old).set]?.slot === -1) { old.m.set(this.mat[lowAt]); old.colObj = null; }
    this.cnt[lowAt] = FRAMES; this.rec[lowAt] = recIdx; this.mat[lowAt].set(rec.m);
  }

  /** the box of a record (FUN_00442570) rotated into the world and its XZ radius: the centre and the larger of the x / z half extents */
  private box(rec: GameRecord, out: Float32Array): number {
    const c = rec.colObj?.col;
    if (!c) return 0;
    const m = rec.m, x = c.center[0], y = c.center[1], z = c.center[2];
    out[0] = z * m[8] + y * m[4] + x * m[0] + rec.x;           // FUN_0043abe6 (3 x 3 only) + the position
    out[1] = z * m[9] + y * m[5] + x * m[1] + rec.y;
    out[2] = z * m[10] + y * m[6] + x * m[2] + rec.z;
    return c.halfExtents[0] <= c.halfExtents[2] ? c.halfExtents[2] : c.halfExtents[0];
  }

  /** FUN_00420dc4(…, pepper): one tick of every running swap */
  tick(pepper: GameRecord): void {
    const H = this.host;
    const pc = new Float32Array(3), rc = new Float32Array(3);
    const pr = this.box(pepper, pc);
    for (let s = 0; s < SLOTS; s++) {
      if (this.cnt[s] === -1) continue;
      const rec = H.records[this.rec[s]];
      const { set, idx } = this.variantOf(rec);
      const row = this.rows[set];
      let k = idx;
      if (this.cnt[s] === MID) {
        k = (idx + 1) & 0xff;
        if (this.counts[set] <= k) k = 0;
        const e = this.colorOf(set, k);
        if (row.slot === -1) { if (e) H.setModel(rec, e.model); }
        else {
          if (e) H.setAttach(rec, row.slot, row.bone, e.model);
          if (row.slot2 !== -1) H.setAttach(rec, row.slot2, 0, null);
          if (e?.child) H.setAttach(rec, row.slot2, e.childBone, e.child);
        }
        rec.variant = (set << 8 | 1 | k << 16) >>> 0;
        this.store(rec);
      }
      const e = this.colorOf(set, k);
      if (this.cnt[s] !== -2) {
        const c = this.cnt[s];
        if (row.slot === -1) {
          const a = c < 0x10 ? c : FRAMES - c, b = c < 0x10 ? MID - c : c - MID;
          const turn = Math.fround(Math.fround(a * PI_F) / K_TURN), sc = Math.fround(b / K_SCALE_REC);
          composeBone(rec.m as Float32Array, this.mat[s], buildMatrix(0, turn, 0, 0, 0, 0, sc, sc, sc));
        } else {
          const a = c < 0x10 ? c : FRAMES - c, b = c < 0x10 ? c + 5 : 0x23 - c;
          const turn = Math.fround(Math.fround(a * PI_F) / K_TURN), sc = Math.fround(b / K_SCALE_ATT);
          this.mat[s].set(buildMatrix(0, turn, 0, 0, 0, 0, sc, sc, sc));
          H.attachLocal(rec, row.slot, this.mat[s]);
          if (e?.child) H.attachLocal(rec, row.slot2, this.mat[s]);
        }
        this.cnt[s] = c - 1;
      }
      if (this.cnt[s] === -1) {
        if (row.slot === -1) {
          rec.m.set(this.mat[s]);
          rec.colObj = e?.col ?? null;
          const rr = this.box(rec, rc);
          if (this.overlap(pr, rr, pc, rc)) { rec.colObj = null; this.cnt[s] = -2; }   // Pepper stands inside: wait
          else this.rec[s] = -1;
        } else {
          H.attachLocal(rec, row.slot, null);
          if (e?.child) H.attachLocal(rec, row.slot2, null);
          this.rec[s] = -1;
        }
      }
      if (this.cnt[s] === -2) {
        rec.colObj = e?.col ?? null;
        const rr = this.box(rec, rc);
        if (!this.overlap(pr, rr, pc, rc)) { this.cnt[s] = -1; this.rec[s] = -1; }
        else rec.colObj = null;
      }
    }
  }
  /** (rp + rr)^2 > the squared XZ-and-Y distance of the two box centres = the boxes' circles overlap */
  private overlap(pr: number, rr: number, pc: Float32Array, rc: Float32Array): boolean {
    const r = Math.fround(pr + rr), q = Math.fround(r * r);
    const dx = rc[0] - pc[0], dy = rc[1] - pc[1], dz = rc[2] - pc[2];
    return !(q <= dz * dz + dy * dy + dx * dx);
  }

  /** the stored decor (the 0x1c0 x (set, variant) bytes the game saves, FUN_00421eb3 writes the records' state into it) and the entry of each record */
  blob: Uint8Array | null = null;
  private entryOfRecord = new Map<number, number>();
  private store(rec: GameRecord) {
    const i = this.entryOfRecord.get(rec.index);
    if (this.blob && i !== undefined) { this.blob[i * 2] = (rec.variant >>> 8) & 0xff; this.blob[i * 2 + 1] = (rec.variant >>> 16) & 0xff; }
  }

  /** FUN_00421bbe(group): the stored (set, variant) of every decor entry of `group` applied to its record (variant word, model / collision or attachments) */
  applyStored(pe: Pe, group: number, blob: Uint8Array): void {
    const H = this.host, t = readDecorTables(pe), g = t.groups[group];
    if (!g) return;
    this.blob = blob;
    for (let i = g.first; i < g.first + g.count; i++) {
      const rec = H.records[t.entries[i].record];
      if (!rec) continue;
      this.entryOfRecord.set(rec.index, i);
      let set = blob[i * 2], v = blob[i * 2 + 1];
      if (this.counts[set] < v) { v = t.entries[i].variant; blob[i * 2 + 1] = v; }   // `count < variant` (not <=: the original's test)
      rec.variant = (set << 8 | 1 | v << 16) >>> 0;
      const row = this.rows[set], e = this.colorOf(set, v);
      if (row.slot === -1) { if (e) { H.setModel(rec, e.model); rec.colObj = e.col; } }
      else {
        if (e) H.setAttach(rec, row.slot, row.bone, e.model);
        if (row.slot2 !== -1) H.setAttach(rec, row.slot2, 0, null);
        if (e?.child) H.setAttach(rec, row.slot2, e.childBone, e.child);
      }
      this.store(rec);
    }
  }
}
export const LOOK_SOUND = 0x2c0;

/** the process-wide stored decor (the 0x1c0 x (set, variant) bytes of the game state: the original's DAT_009d9fd0, saved by FUN_00421f56 / loaded by FUN_00421f7b); null = a new game's defaults */
export const decorStore: { blob: Uint8Array | null } = { blob: null };

/** FUN_0043eaf0(DAT_00983838 + 8 + group * 0xc, index): the model `index` of model group 0 (the zone's record models, array g98380c) or 1 (array g983838+20) */
export function decorModel(scene: { models: readonly Model[] }, group: number, index: number): Model | null {
  const name = group === 0 ? 'g98380c' : `g983838+${8 + group * 12}`;
  return scene.models.find((m) => m.array === name && m.index === index) ?? null;
}
