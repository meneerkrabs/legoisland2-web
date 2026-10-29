// FUN_004b7040 (z02LGI GameLoop, 206 lines): the island's story handler, ported by hand. The island loop (FUN_004afaf7) calls it after FUN_00423bad whenever
// var 0x58 (FSM_CURRENT_STATE) differs from the node it last handled (`*prev`), and the set-up FUN_004b6475 calls it once with an uninitialised `prev`.
// Per node band it selects the two message files of the node (the talking NPCs' lines `lifsmN.str` and the hologram hints `liholN.str`), sets the objective
// (objective.ts), shows / hides a few records and, when the node was entered from the node before it ("just advanced"), runs the one-shot actions (the
// hologram alert, var writes, re-pinning the era-3 walkers). While a cutscene runs it does nothing and `*prev` stays, so it runs again next frame.
// Returns the loop's exit state: 1 = stay; 2 = leave with the next zone in `*next` (node 7: zone 0x1f).
// Records are addressed as in the original: `DAT_00983804 + off` -> record (off - field) / 0x68; flags at +0x60.

/** record index of a record pointer `DAT_00983804 + off` */
const R = (off: number) => off / 0x68;
/** record index of the flags word `DAT_00983804 + off` (+0x60) */
const F = (off: number) => (off - 0x60) / 0x68;
/** record index of the controller word `DAT_00983804 + off` (+0x5c) */
const C = (off: number) => (off - 0x5c) / 0x68;

/** the radius argument 0x41800000 of FUN_00424270 / FUN_004242b9 */
const R16 = 16;
/** 0x41000000 of FUN_00424230 */
const R8 = 8;

/** what the handler touches; the zone game binds it to the live world, the tests to a recorder */
export interface StoryEnv {
  /** FUN_0045c432 */
  cutsceneActive(): boolean;
  vars: { get(i: number): number; set(i: number, v: number): void; or(i: number, v: number): void; andNot(i: number, v: number): void };
  /** record flags word (+0x60) */
  flags(rec: number): number;
  setFlags(rec: number, v: number): void;
  /** FUN_00423ff6 + FUN_0088d296 (free both tables), FUN_00423fe0(path) (npc table) / FUN_0088d280(path) (hologram table): `addr` = VA of the path string */
  freeTexts(): void;
  npcText(addr: number): void;
  holText(addr: number): void;
  /** the objective setters (objective.ts): FUN_00424270 / FUN_00424230 / FUN_0042419f / FUN_004242b9 */
  objRecord(rec: number, r: number): void;
  objPair(a: number, b: number, r: number): void;
  objFour(a: number, b: number, c: number, d: number): void;
  objNode(node: number, r: number): void;
  /** FUN_0088d2bc: the hologram's 90-frame alert */
  holoAlert(): void;
  /** FUN_00429638(rec->ctrl, 0, 0): reset the Pizza node (0x429d1b) of the record: +0x24 = 0, +0x20 = 0, +0x34 = 0, +0x2e = 0 */
  pizzaReset(rec: number): void;
  /** FUN_0046140f(walker, node, rec) + FUN_004625d7(walker, rec, node): the record's walker (controller +0x10) stands on PATH node `node`, the record is put there */
  walkerPin(rec: number, node: number): void;
}

export interface StoryRef { prev: number; next: number }

/** FUN_004b7040(&next, &prev, node) */
export function storyHandler(e: StoryEnv, ref: StoryRef, node: number): number {
  let ret = 1;
  if (e.cutsceneActive()) return ret;
  const and2 = (off: number) => e.setFlags(F(off), e.flags(F(off)) & 0xfffd);
  const or2 = (off: number) => e.setFlags(F(off), e.flags(F(off)) | 2);
  const just = ref.prev === node - 1;
  const texts = (npc: number, hol: number | null) => { e.npcText(npc); if (hol !== null) e.holText(hol); };
  const pag4 = () => e.objFour(R(0x1c08), R(0x1c70), R(0x1cd8), R(0x1d40));
  e.freeTexts();
  if (node < 4) {
    e.objRecord(-1, R16);
    texts(0x8d9600, 0x8d9624);
  } else if (node < 5) {
    if (just) e.holoAlert();
    e.vars.set(0xb3, 100);
    e.vars.or(0x50, 9);
    e.objRecord(R(13000), R16);
    texts(0x8d9648, 0x8d966c);
  } else if (node < 6) {
    e.objRecord(R(0x31f8), R16);
    texts(0x8d9690, 0x8d96b4);
  } else if (node < 7) {
    e.objRecord(R(0x3190), R16);
    texts(0x8d96d8, 0x8d96fc);
  } else if (node < 8) {
    ref.next = 0x1f;
    ret = 2;
    pag4();
    texts(0x8d9720, 0x8d9744);
  } else if (node < 9) {
    e.objRecord(-1, R16);
    texts(0x8d9768, 0x8d978c);
  } else if (node < 10) {
    if (just) e.holoAlert();
    and2(0x4d8);
    e.vars.set(0x62, 0x4000);
    e.objRecord(R(0x3260), R16);
    texts(0x8d97b0, 0x8d97d4);
  } else if (node < 0xd) {
    e.vars.andNot(0x62, 0x4000);
    e.objRecord(R(0x2f20), R16);
    texts(0x8d97f8, 0x8d981c);
  } else if (node < 0x1e) {
    e.objPair(R(0x41d0), R(0x4238), R8);
    texts(0x8d9840, 0x8d9864);
  } else if (node < 0x1f) {
    pag4();
    texts(0x8d9888, 0x8d98ac);
    and2(0x610); and2(0xc28);
  } else if (node < 0x20) {
    if (just) e.holoAlert();
    e.objRecord(R(0x3128), R16);
    texts(0x8d98d0, 0x8d98f4);
    and2(0x610); and2(0xc28);
  } else if (node < 0x34) {
    e.objPair(R(0x4168), R(0x4308), R8);
    texts(0x8d9918, 0x8d993c);
    and2(0x610); and2(0xc28);
  } else if (node < 0x35) {
    pag4();
    texts(0x8d9960, 0x8d9984);
  } else if (node < 0x36) {
    pag4();
    texts(0x8d99a8, 0x8d99cc);
  } else if (node < 0x37) {
    or2(0x2de0);
    and2(0x5a8);
    e.pizzaReset(C(0x5a4));
    and2(0x540);
    e.pizzaReset(C(0x53c));
    if (just) {
      // the era-3 walkers back on their PATH nodes (controller +0x10 of the record = the walker; the record pointer passed is the same record)
      for (const [rec, n] of WALKER_PINS) e.walkerPin(rec, n);
    }
    pag4();
    and2(0xd60);
    texts(0x8d99f0, 0x8d9a14);
  } else if (node < 0x38) {
    if (just) e.holoAlert();
    or2(0x2de0);
    and2(0xd60);
    e.objRecord(R(0x30c0), R16);
    texts(0x8d9a38, 0x8d9a5c);
  } else if (node < 0x39) {
    or2(0x2de0);
    e.objRecord(-1, R16);
    texts(0x8d9a80, 0x8d9aa4);
  } else if (node < 0x3a) {
    or2(0x2de0);
    e.objRecord(R(0x3128), R16);
    texts(0x8d9ac8, 0x8d9aec);
  } else if (node < 0x3b) {
    or2(0x2de0);
    and2(0xcf8);
    e.objRecord(R(0x2eb8), R16);
    texts(0x8d9b10, 0x8d9b34);
  } else if (node < 0x3e) {
    or2(0x2de0);
    and2(0xcf8);
    e.objRecord(R(0x2eb8), R16);
    texts(0x8d9b58, 0x8d9b7c);
  } else if (node < 0x45) {
    e.objNode(0x1a5, R16);
    e.objRecord(-1, R16);
    texts(0x8d9ba0, null);
  }
  // record 68 (+0x1c00) is shown for nodes 0x37..0x3a, hidden otherwise
  if (node < 0x37 || 0x3a < node) and2(0x1c00); else or2(0x1c00);
  ref.prev = node;
  return ret;
}

/** node 0x36 entered from 0x35: (record, PATH node) of the ten walkers (controller offsets 0x744 .. 0xaec, in the original's order) */
export const WALKER_PINS: readonly (readonly [number, number])[] = [
  [C(0x744), 0x171], [C(0x7ac), 0x185], [C(0x814), 0x171], [C(0x87c), 0xe5], [C(0x8e4), 0x2f],
  [C(0x94c), 0x77], [C(0xa84), 0x9f], [C(0xa1c), 0x2c], [C(0x9b4), 0x71], [C(0xaec), 0x133],
];
