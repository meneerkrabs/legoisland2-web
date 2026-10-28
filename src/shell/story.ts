// The story FSM and the zone loop glue, ported function by function from the executable (architecture.md 2.1, 2.2, 6.3).
// Pure logic on top of GameVars; the tables come from tables.ts (read from the EXE at run time).
import { GameVars, V } from '../game/vars.ts';
import type { StoryNode, ZoneInfo } from './tables.ts';

/** vars 15..234 (0x370 bytes at 0x8a2d68) are what _data\sw.dat holds (FUN_00417820 / FUN_0041786a) */
export const SW_FIRST = 15;
export const SW_COUNT = 0x370 / 4;
/** FSM node the New game command starts at (FUN_0041a8f9) and the zone of that node */
export const NEW_GAME_NODE = 2;
export const NEW_GAME_ZONE = 2;

/** named game vars used here (gamevars.tsv) */
export const GV = {
  NUM_BRICKS: 0x4f, COMPLETE_SUB_GAME: 0x53, PAGES_SET: 0x26, NUM_PIZZAS: 0xb0, PEPPHOUSE_SIZE: 0xb3, MOVE_PIZ3: 0xb4, MOVE_CNST: 0xb5,
  STARTEDFROMMENU: 0xb, LGI_GAMELOOP: 0x120, PPH_MENU_INTERNALS: 0x4d,
} as const;

/** FUN_004b6475: the island era of a story node (0..4) */
export function eraOfNode(node: number): number {
  return node < 7 ? 0 : node < 0x1e ? 1 : node < 0x34 ? 2 : node < 0x3d ? 3 : 4;
}

/** "SDDEBUG" classification of a variable (FUN_004176c1): 0 volatile NS, 0xf GME (saved), 0xeb MS, 0xfa zone-local */
export function varClass(i: number): number { return i < 0xf ? 0 : i < 0xeb ? 0xf : i < 0xfa ? 0xeb : 0xfa; }

export class StoryFsm {
  readonly vars: GameVars;
  readonly nodes: StoryNode[];
  readonly zones: ZoneInfo[];
  /** DAT_00983854: per node, the value of the node's variable when the node was entered (restored on rewind) */
  readonly snap: Int32Array;

  constructor(vars: GameVars, nodes: StoryNode[], zones: ZoneInfo[]) {
    this.vars = vars; this.nodes = nodes; this.zones = zones;
    this.snap = new Int32Array(Math.max(nodes.length, 128));
  }

  /** current node = game var 0x58 FSM_CURRENT_STATE */
  get node(): number { return this.vars.get(V.FSM_CURRENT_STATE); }

  /** FUN_00404be7: zone table index of the current node (or of `node`) */
  zoneOf(node: number = this.node): number { return this.nodes[node]?.zone ?? 0; }

  /** FUN_00404aa0: `(var & mask) == value` for the current node */
  complete(): boolean {
    const n = this.nodes[this.node];
    if (!n) return false;
    return (this.vars.get(n.var) & n.mask) === n.value;
  }

  /** FUN_00404bb2: next node; stores the new node's variable in the snapshot */
  advance() {
    this.vars.add(V.FSM_CURRENT_STATE, 1);
    const n = this.node, nd = this.nodes[n];
    if (nd) this.snap[n] = this.vars.get(nd.var);
  }

  /** FUN_00404b43: go back to the previous node whose zone has kind 1 and restore that node's variable from the snapshot */
  rewind() {
    let n = this.node;
    do { n--; } while (n > 0 && this.zones[this.nodes[n].zone].kind !== 1);
    const nd = this.nodes[n];
    this.vars.set(nd.var, this.snap[n]);
    this.vars.set(V.FSM_CURRENT_STATE, n);
  }

  /** FUN_00404af6: one node back, restoring that node's variable */
  stepBack() {
    const n = this.node - 1;
    this.vars.set(this.nodes[n].var, this.snap[n]);
    this.vars.set(V.FSM_CURRENT_STATE, n);
  }

  /**
   * FUN_00404c07: jump to node `n`. Forward: every skipped node's variable (GME 15..234 and MS 235..249 only) is forced to the node's value
   * (the full s16 value, not masked) and snapshotted; backward: the variables are restored from the snapshots. Also sets NEXT_SUBGAME (var 5) to the node's zone.
   */
  jump(n: number) {
    let c = this.node;
    if (c < n) {
      for (; c < n; c++) {
        const nd = this.nodes[c], cls = varClass(nd.var);
        if (cls < 0xfa && cls > 0) {
          this.vars.set(nd.var, nd.value);
          this.snap[c] = this.vars.get(nd.var);
        }
      }
    } else if (n < c) {
      while (c--, n <= c) this.vars.set(this.nodes[c].var, this.snap[c]);
    }
    this.vars.set(V.FSM_CURRENT_STATE, n);
    this.vars.set(V.NS_NEXT_SUBGAME, this.nodes[n].zone);
  }

  /** FUN_00423bad (every frame in hubs / mini-games): 6 = the story moved to another zone (leave, next = zoneOf()), else 1 */
  frame(): number {
    const cur = this.vars.get(V.CURRENT_SUBGAME);
    if (cur === this.zoneOf() && this.complete()) {
      this.advance();
      if (cur !== this.zoneOf()) return 6;
    }
    return 1;
  }

  /**
   * FUN_00404d14(&next, completed, success): every mini-game calls it on exit and returns `next`.
   * Current zone == the node's zone: completed && success -> COMPLETE_SUB_GAME = 1 and advance, otherwise rewind to the last hub; next = zone of the node.
   * Otherwise (replay from a menu): next = PREV_SUBGAME.
   */
  miniGameExit(completed: boolean, success: boolean): number {
    const cur = this.vars.get(V.CURRENT_SUBGAME);
    if (cur === this.zoneOf()) {
      if (!completed || !success) this.rewind();
      else { this.vars.set(GV.COMPLETE_SUB_GAME, 1); this.advance(); }
      return this.zoneOf();
    }
    return this.vars.get(V.PREV_SUBGAME);
  }

  /**
   * New game / start-up defaults (FUN_0041786a): vars 15..234 come from the sw.dat snapshot (`sw` = 220 values), then NUM_BRICKS = NUM_PIZZAS = 11,
   * PEPPHOUSE_SIZE = MOVE_PIZ3 = 0, MOVE_CNST = 1, PAGES_SET = 0.
   */
  applyNewGameDefaults(sw: Int32Array) {
    for (let i = 0; i < SW_COUNT; i++) this.vars.a[SW_FIRST + i] = sw[i];
    this.vars.set(GV.NUM_BRICKS, 0xb);
    this.vars.set(GV.NUM_PIZZAS, 0xb);
    this.vars.set(GV.PEPPHOUSE_SIZE, 0);
    this.vars.set(GV.MOVE_PIZ3, 0);
    this.vars.set(GV.MOVE_CNST, 1);
    this.vars.set(GV.PAGES_SET, 0);
  }
}

/** pending "go to node/zone" override of the zone loop (DAT_009d9c10 node s16, DAT_009d9c18 zone u8, DAT_009d9c19 kind) */
export interface PendingLoad { kind: 0 | 1 | 2; node: number; zone: number }

export const ZONE_QUIT = -2;

/**
 * FUN_00404dc9 as a state machine. Usage:
 *   const loop = new ZoneLoopState(story); let z = loop.begin(sw);
 *   while (z >= 0) { const ret = await runZone(z); z = loop.afterZone(ret); }
 * `begin` / `afterZone` return the next zone that has to RUN (the empty zones 22 and 23 are skipped here as in the original) or a negative number
 * to leave the program. The zone's own `exit` conditions (var 5 != var 0x59 etc.) stay in the zone loops.
 */
export class ZoneLoopState {
  readonly story: StoryFsm;
  /** zone that is (about to be) running */
  zone = 0;
  pending: PendingLoad = { kind: 0, node: 0, zone: 0 };
  /** the _data\sw.dat snapshot: vars 15..234 at launch */
  sw: Int32Array = new Int32Array(SW_COUNT);

  constructor(story: StoryFsm) { this.story = story; }

  private get vars() { return this.story.vars; }

  /** start-up: FUN_00417820 (snapshot), FUN_0041786a (defaults), zone = zone of the current node. Pass `sw` to override the snapshot (default: current vars). */
  begin(sw?: Int32Array): number {
    this.sw = sw ? sw.slice(0, SW_COUNT) : this.vars.a.slice(SW_FIRST, SW_FIRST + SW_COUNT);
    this.story.applyNewGameDefaults(this.sw);
    const z = this.story.zoneOf();
    this.vars.set(V.CURRENT_SUBGAME, z);
    return this.enter(z);
  }

  /**
   * the loop head for zone `z`: zones without code advance the FSM (FUN_00404bb2) and continue with the next node's zone;
   * a zone with code gets FUN_004177ed (clear vars 0xfa..0x13e), NEXT_SUBGAME = zone, PIZZAS_THROWN = 0, COMPLETE_SUB_GAME = 0.
   */
  private enter(z: number): number {
    let guard = 0;
    while (z >= 0 && !this.story.zones[z]?.hasRun && guard++ < 80) {
      this.story.advance();
      const next = this.story.zoneOf();
      this.vars.set(V.PREV_SUBGAME, z);
      this.vars.set(V.CURRENT_SUBGAME, next);
      z = next;
    }
    if (z < 0) return z;
    this.clearZoneLocals();
    this.vars.set(V.NS_NEXT_SUBGAME, z);
    this.vars.set(V.PIZZAS_THROWN, 0);
    this.vars.set(GV.COMPLETE_SUB_GAME, 0);
    this.zone = z;
    return z;
  }

  /** FUN_004177ed: zone-local scratch vars 0xfa..0x13e = 0 */
  clearZoneLocals() { for (let i = 0xfa; i < 0x13f; i++) this.vars.a[i] = 0; }

  /** FUN_0041ad43: the pending override; applies the node to var 0x58 and returns the zone, -1 = none */
  takeOverride(): number {
    if (this.pending.kind === 0) return -1;
    this.vars.set(V.FSM_CURRENT_STATE, this.pending.node);
    return this.pending.zone & 0xff;
  }

  /** the code after the zone run function returned `returned` (= the next zone index, -1 front end, <= -2 quit); returns the next zone to run (< 0 = quit) */
  afterZone(returned: number): number {
    let next = returned | 0;
    if (next === -1) { next = 0; this.vars.set(V.FSM_CURRENT_STATE, 0); }
    const o = this.takeOverride();
    if (o !== -1) next = o;
    this.vars.set(V.PREV_SUBGAME, this.zone);
    this.vars.set(V.CURRENT_SUBGAME, next);
    if (next < 0) return next;
    return this.enter(next);
  }

  /** FUN_0041adb5 (called by every zone set-up): returns the pending kind (1 = a loaded save must now be applied by the caller) and clears it */
  loadDone(): number { const k = this.pending.kind; this.pending.kind = 0; return k; }

  /** FUN_0041a8f9 + FUN_0041786a + var 5 = 2 (front end "New game" slot): defaults, pending override node 2 / zone 2 (kind 2) */
  newGame() {
    this.pending = { kind: 2, node: NEW_GAME_NODE, zone: NEW_GAME_ZONE };
    this.story.applyNewGameDefaults(this.sw);
    this.vars.set(V.NS_NEXT_SUBGAME, NEW_GAME_ZONE);
  }

  /**
   * FUN_00419bb9 decision after the save header was read: 1 = same zone and FSM node, restore the game in place (the caller applies the save);
   * 2 = leave the zone: the override (kind 1) takes the loop to the saved node and zone, whose set-up calls `loadDone()` and applies the save.
   */
  beginLoad(subgame: number, fsmState: number): 1 | 2 {
    if (fsmState === this.vars.get(V.FSM_CURRENT_STATE) && subgame === this.vars.get(V.CURRENT_SUBGAME)) return 1;
    this.pending = { kind: 1, node: fsmState << 16 >> 16, zone: subgame & 0xff };
    return 2;
  }
}
