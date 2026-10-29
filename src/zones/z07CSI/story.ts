// FUN_00574e40 (z07CSI GameLoop, 111 lines): the castle's story handler, ported by hand. The loop (FUN_00572910) calls it after FUN_00423bad whenever var 0x58
// (FSM_CURRENT_STATE) differs from the node it last handled (`*prev`), and the set-up FUN_00573527 calls it once with an uninitialised `prev` (the "just advanced"
// branches never run at set-up). Per node band it selects the two message files of the node (the talking NPCs' lines `csifsmN.str` and the hologram hints
// `csiholN.str`), sets the objective arrow (objective.ts) and shows / hides / places a few records. While a cutscene runs it does nothing and `*prev` stays, so it
// runs again next frame. Unlike the island's handler it never leaves the zone itself (it always returns 1: the castle's exits come from the story FSM, the portal
// and the mini-game hand-overs) and has no hologram alert.
// Records are addressed as in the original: `DAT_00983804 + off` -> record `off / 0x68` for a record pointer, flags (+0x60) -> (off - 0x60) / 0x68.
import type { HubStoryEnv, StoryRef } from '../../hub/story.ts';
import { setRot, ensureAnim } from '../../island/ambient/common.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';

/** record indices of the castle (the scene's record array, the same in every story stage) */
export const REC = {
  /** BRGE, the broken bridge (objective of the bridge band, 0x1a0) */
  BRIDGE: 4,
  /** PEPP */
  PEPPER: 7,
  /** DRKK (0x9c0): the Dark Knight; placed at PATH node 0x96 in node 22 */
  DARK_KNIGHT: 24,
  /** JKIT, HORS (the horse, 0x1380), DRKH, RSAD, GSAD, CLOK (the horse / saddle / cloak set of the rides) */
  JKIT: 46, HORSE: 48, DRKH: 50, RSAD: 51, GSAD: 52, CLOK: 53,
  /** PORS (0x4308): the portal back to the island, the objective of the last nodes */
  PORTAL: 165,
  /** BCAS (0x5210) / LCAS (0x5278): the Bull castle / the Lion castle (objective of the two mini-game hand-overs) */
  BULL_CASTLE: 202, LION_CASTLE: 203,
} as const;

/** the radius argument 0x41800000 of FUN_00424270 / FUN_004242b9 */
const R16 = 16;
/** the PATH node the objective points at in the first and the node-26/27 bands (0x6f), and the node the Dark Knight / DRKH are put on (0x96) */
const PATH_OBJECTIVE = 0x6f, PATH_KNIGHT = 0x96;
/** var 0x112 (the cutscene gate of the hand-overs: a stage switch the castle's cutscene scripts read), var 0x5e = 0x10: PEPPER_CONTROL = riding the horse */
const VAR_STAGE_SWITCH = 0x112, VAR_PEPPER_CONTROL = 0x5e, CONTROL_HORSE = 0x10;
/** 0x3fc90f94: 1.5707964 rad (the Dark Knight turns to face the other way) */
const KNIGHT_YAW = new Float32Array(new Uint32Array([0x3fc90f94]).buffer)[0];

/** the message file path strings of the executable (the handler's `s__DATA_messages_ci_Data_csi..._s`): [npc table (csifsmN), hologram table (csiholN)] per band */
export const TEXT = {
  HOL1_ONLY: [0, 0x8f81e0], N16: [0x8f8204, 0x8f8228], N17: [0x8f824c, 0x8f8270], N19: [0x8f8294, 0x8f82b8], N21: [0x8f82dc, 0x8f8300],
  N22: [0x8f8324, 0x8f8348], N25: [0x8f836c, 0x8f8390], N26: [0x8f83b4, 0x8f83d8], N28: [0x8f83fc, 0x8f8420], N29: [0x8f8444, 0x8f8468],
} as const;

/** what the handler touches beyond the framework's `HubStoryEnv`: the engine calls on records the island's handler does not make */
export interface CsiStoryServices {
  /** FUN_00462be9(1, node, &rec + 0x3c): the record's translation := the PATH node's position */
  placeOnPath(rec: number, node: number): void;
  /** the record's Euler angles (+0x4c / +0x50 / +0x54) */
  euler(rec: number): [number, number, number];
  /** `*(float *)(rec + 0x50) = value` (the yaw field only) */
  setYaw(rec: number, v: number): void;
  /** FUN_0043a4a1(rec + 0xc, rx, ry, rz): the matrix from the Euler angles, translation kept */
  setRot(rec: number, rx: number, ry: number, rz: number): void;
  /** FUN_0043b6a3(*(rec + 8), clip, 0): start an animation clip of the record */
  animStart(rec: number, clip: number): void;
  /** the 16 dwords of the record's matrix block (+0x0c) copied from record `from` to record `to` */
  copyMatrix(to: number, from: number): void;
}

/** the live services: records of the hub's world (a set-up call changes nothing: its writes were made by the emulation) */
export function liveCsiServices(env: HubStoryEnv): CsiStoryServices {
  const w: World = env.ictx.world;
  const live = !env.setupCall;
  const rec = (i: number): GameRecord | undefined => w.records[i];
  return {
    placeOnPath(i, node) {
      const r = rec(i), p = env.ictx.pathPos(node);
      if (live && r && p) { r.x = p[0]; r.y = p[1]; r.z = p[2]; }
    },
    euler(i) { const r = rec(i); return r ? [r.rx, r.ry, r.rz] : [0, 0, 0]; },
    setYaw(i, v) { const r = rec(i); if (live && r) r.ry = v; },
    setRot(i, rx, ry, rz) { const r = rec(i); if (live && r) setRot(r.m, rx, ry, rz); },
    animStart(i, clip) { const r = rec(i); if (live && r) ensureAnim(w, r)?.start(clip, 0); },
    copyMatrix(to, from) { const a = rec(to), b = rec(from); if (live && a && b) { a.m.set(b.m); } },
  };
}

/** FUN_00574e40(&next, &prev, node); returns the loop's exit state (always 1: stay) */
export function csiStory(e: HubStoryEnv, ref: StoryRef, node: number, svc: CsiStoryServices = liveCsiServices(e)): number {
  const ret = 1;
  if (e.cutsceneActive()) return ret;
  const and2 = (rec: number) => e.setFlags(rec, e.flags(rec) & 0xfffd);
  const or2 = (rec: number) => e.setFlags(rec, e.flags(rec) | 2);
  const texts = (t: readonly number[]) => { if (t[0]) e.npcText(t[0]); e.holText(t[1]); };
  e.freeTexts();
  if (node < 0x10) {
    e.objNode(PATH_OBJECTIVE, R16);
    e.holText(TEXT.HOL1_ONLY[1]);
  } else if (node < 0x11) {
    texts(TEXT.N16);
  } else if (node < 0x13) {
    e.objRecord(REC.BRIDGE, R16);
    texts(TEXT.N17);
  } else if (node < 0x15) {
    e.objRecord(REC.BULL_CASTLE, R16);
    texts(TEXT.N19);
  } else if (node < 0x16) {
    e.objRecord(REC.LION_CASTLE, R16);
    or2(REC.HORSE); or2(REC.GSAD);
    if (ref.prev === 0x14) {
      e.vars.set(VAR_STAGE_SWITCH, 1);
      svc.copyMatrix(REC.HORSE, REC.PEPPER);        // the horse stands where Pepper is (16 dwords: matrix + translation)
      e.vars.set(VAR_PEPPER_CONTROL, CONTROL_HORSE);
    }
    texts(TEXT.N21);
  } else if (node < 0x17) {
    e.objRecord(REC.BRIDGE, R16);
    or2(REC.CLOK); or2(REC.JKIT); or2(REC.GSAD);
    and2(REC.RSAD);
    or2(REC.DARK_KNIGHT);
    svc.placeOnPath(REC.DARK_KNIGHT, PATH_KNIGHT);
    svc.setYaw(REC.DARK_KNIGHT, KNIGHT_YAW);
    const [rx, ry, rz] = svc.euler(REC.DARK_KNIGHT);
    svc.setRot(REC.DARK_KNIGHT, rx, ry, rz);
    svc.animStart(REC.DARK_KNIGHT, 0xb8);
    or2(REC.DRKH);
    svc.animStart(REC.DRKH, 2);
    svc.placeOnPath(REC.DRKH, PATH_KNIGHT);
    const [hx, hy, hz] = svc.euler(REC.DARK_KNIGHT);
    svc.setRot(REC.DRKH, hx, hy, hz);
    e.setFlags(REC.HORSE, 2);                       // `*(ushort *)(rec + 0x60) = 2` (assigned, not or-ed)
    texts(TEXT.N22);
  } else if (node < 0x19) {
    e.objRecord(REC.LION_CASTLE, R16);
    if (ref.prev === node - 1) e.vars.set(VAR_STAGE_SWITCH, 1);
  } else if (node < 0x1a) {
    e.objRecord(REC.BULL_CASTLE, R16);
    if (ref.prev === node - 1) { e.vars.set(VAR_STAGE_SWITCH, 1); e.vars.set(VAR_PEPPER_CONTROL, CONTROL_HORSE); }
    and2(REC.JKIT); and2(REC.GSAD); and2(REC.CLOK);
    or2(REC.RSAD);
    texts(TEXT.N25);
  } else if (node < 0x1c) {
    e.objNode(PATH_OBJECTIVE, R16);
    texts(TEXT.N26);
  } else if (node < 0x1d) {
    e.objRecord(REC.PORTAL, R16);
    texts(TEXT.N28);
  } else {
    e.objRecord(REC.PORTAL, R16);
    texts(TEXT.N29);
  }
  ref.prev = node;
  return ret;
}
