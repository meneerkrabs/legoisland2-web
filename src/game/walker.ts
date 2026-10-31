// Waypoint walker (Common\WayPt, 0x461xxx-0x465xxx; docs/re/architecture.md 4.6, formats.md 7.1): the original's road / path follower used by NPCs,
// cars and animals. 60 walkers (stride 0x84, handle = index + 1) walk over 4 loaded waypoint maps (slot 0 ROAD, 1 PATH, 2 CSM, 3 OTH).
//
// All maths of the walker is done in "walker units" = world units / 8 (0.125 at 0x89208c, 8.0 at 0x892090): positions are scaled in and out by
// `step`, speeds, radii and thresholds are in walker units (a speed of 0.01667 = 0.133 world units per 1/30 s tick). Yaw: forward = (sin yaw, cos yaw).
//
// Ported functions (VA -> member):
//   0x4630c0 load map            -> loadMap / load          0x463701 unload all    -> unload        0x4613d0 reset table -> reset
//   0x4614d5 create              -> create                  0x461a3b free          -> free          0x46140f set node    -> setNode
//   0x461c24 go to node          -> goTo                    0x462729 follow rec    -> follow        0x4627e2 face point  -> turnToPoint
//   0x462918 face node           -> turnToNode              0x462952 face heading  -> turnToHeading 0x462a11 move to pt  -> moveToPoint
//   0x4625d7 / 0x462686          -> teleport / reregister   0x46265d unregister    -> unregister
//   0x4626d0 step (-> 0x4659b6)  -> step                    0x461fe4 apply         -> apply
//   0x463b49 route lookup        -> route                   0x462be9 node position -> nodePos       0x462b4e name lookup -> findNode
//   0x462206 speed / 0x462324 turn rate / 0x461ad6 lane / 0x4623aa,0x4623cd radii / 0x462436 / 0x4623f0 / 0x4621c7 -> set* tuning
//   internals: 0x465781 prepare, 0x46555e seek, 0x465353 advance, 0x464f7a steer, 0x464918 turnToward, 0x464517 plan, 0x4643fe recompute,
//   0x46410c setTo, 0x4642b0 setNext, 0x46407e setFrom, 0x463e11/0x463d50 list add/remove, 0x463f9d/0x463ec8 register/unregister,
//   0x464e16 blocked (0x464bbf ahead, 0x464b4b crossing, 0x464a7a yield, 0x4649d2 car), 0x4651d4 follow/point step, 0x465146 heading step,
//   0x465416 move-to-point step.
// 0x462d8b / 0x462e75 save game writer / loader of the table -> src/game/walkersave.ts. Not ported: the debug overlay (0x461155..0x461347: draws only in the original's debug view) and trivial accessors
// that only read a field (they are plain properties of `Walker` here).
import { buildMatrix } from '../formats/matrix.ts';
import { ad, ml, sq } from '../zones/common/f32.ts';
import { nextHop, parseCompiledWaypoints } from '../formats/waypoints.ts';
import type { CompiledWaypoints, WaypointNode } from '../formats/waypoints.ts';
import type { Archive } from '../formats/archive.ts';
import { NODE_CONTINUE, registerNode } from './controller.ts';
import type { BehaviourNode, Controller } from './controller.ts';
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';
import './walkersave.ts';   // registers the save game part 'walkers' (FUN_00462d8b / FUN_00462e75)

// ----------------------------------------------------------------------------- constants

/** map slots */
export const MAP_ROAD = 0, MAP_PATH = 1, MAP_CSM = 2, MAP_OTH = 3;
export const MAP_NAMES = ['ROAD', 'PATH', 'CSM', 'OTH'] as const;
export const MAX_WALKERS = 60;               // 0x3c, FUN_004614d5 / FUN_004613d0

/** world units -> walker units (_DAT_0089208c = 0.125) and back (_DAT_00892090 = 8.0) */
export const TO_WALK = 0.125, FROM_WALK = 8;
// The original is an MSVC debug build: every C float variable / field is a float32 in memory and each operation rounds (the x87 runs in 24-bit precision, see docs/re/engine-m1.md "Differential test"), so this module
// stores with `fr` (Math.fround) exactly where the original stores; the constants are the float32 values of the executable's data (tools/tests/m7-walker-emu.mjs compares bit for bit).
const fr = Math.fround;
const U32 = new Uint32Array(1), F32V = new Float32Array(U32.buffer);
/** the float32 with these bits (the immediates of the original's code) */
const bitsToF32 = (b: number) => { U32[0] = b; return F32V[0]; };
const PI = fr(3.1415927), TWO_PI = fr(6.2831855);    // _DAT_0089207c, _DAT_00892094 (-PI: _DAT_00892098)

// defaults written by FUN_004614d5 (immediates in the function)
export const DEFAULT_TURN_RATE = bitsToF32(0x3db2b884);   // 0x3db2b884 (5 degrees per tick), +0x40
export const DEFAULT_RADIUS_MAX = 200;          // 0x43480000, +0x50
export const DEFAULT_RADIUS_MIN = 20;           // 0x41a00000, +0x4c
export const DEFAULT_RADIUS_LIMIT = 20;         // 0x41a00000, +0x74
export const DEFAULT_STOP_DIST2_ROAD = 3.75;    // 0x40700000, +0x78 on map 0 (squared distance)
export const DEFAULT_STOP_DIST2 = bitsToF32(0x3eb851ec);         // 0x3eb851ec, +0x78 on the other maps
// settings of the generic talking NPC (FUN_00426151, immediates before its calls to FUN_00462206 / 0x462324 / 0x4623aa / 0x4623cd / 0x462436)
export const NPC_SPEED = bitsToF32(0x3c888888);           // 0x3c888888
export const NPC_TURN_RATE = bitsToF32(0x3f060a63);          // 0x3f060a63 (30 degrees)
export const NPC_RADIUS_MIN = bitsToF32(0x3e4ccccd);              // 0x3e4ccccd
export const NPC_RADIUS_MAX = 0.75;             // 0x3f400000
export const NPC_RADIUS_LIMIT = 0.25;           // 0x3e800000

// .rdata thresholds
const SPEED_RESCALE_MIN = fr(0.01);      // _DAT_00892030 (FUN_00462206)
const LANE_MIN = fr(0.01);               // _DAT_00892030 (FUN_004643fe: lane offset large enough for a circular lane)
const LANE_EPS = fr(0.001);              // _DAT_008923c4 (FUN_00464517 / FUN_00461fe4)
const CLONE_EPS = fr(0.05);              // _DAT_00892034 (FUN_0046248a)
const BEND_MIN = fr(0.17453199);         // _DAT_0089211c (10 degrees: smaller bends need no curve)
const BEND_MAX = fr(2.967043876647949);           // _DAT_008923c8 (170 degrees: sharper turns are not curved)
const HALF = 0.5, QUARTER = 0.25;    // _DAT_0089204c, _DAT_00892134
const EIGHTH = 0.125;                // _DAT_0089208c

// flag word (+0x00)
export const WF_ACTIVE = 0x1;           // set by create / teleport; the slot is in use while the whole word is non-zero
export const WF_STOPPED = 0x2;          // no order: step returns -1
export const WF_RUNNING = 0x4;          // the route state (from/to/next) is valid
export const WF_GO = 0x8;               // pending order "go to goal" (restart or turn around allowed)
export const WF_GO_CONT = 0x10;         // pending order "go to goal, continue smoothly"
export const WF_PHASE = 0x7000;         // curve planning phase: 0 not planned, 0x1000 done, 0x2000 / 0x3000 retry with other radii
export const WF_NOCROSS = 0x100000;     // ignore crossings (FUN_0046190f arg 2)
export const WF_NOYIELD = 0x200000;     // do not stop for walkers ahead (FUN_0046190f arg 1)
export const WF_AHEAD_IGN = 0x400000;   // a walker ahead was ignored this tick (WF_NOYIELD)
export const WF_BLOCKED = 0x1000000;    // blocked / yielding this tick
/** mode = top nibble */
export const MODE_NONE = 0, MODE_POINT_GO = 0x10000000, MODE_FOLLOW = 0x20000000, MODE_HEADING = 0x40000000, MODE_POINT = 0x60000000, MODE_ROUTE = 0x80000000;

/** step() results besides a node index (>= 0: the node the walker is approaching) */
export const STEP_ARRIVED = -1, STEP_TURNING = -2, STEP_FACING = -3, STEP_MOVING_TO_POINT = -4;
/** FUN_00461b92 */
export const STATUS_IDLE = 0, STATUS_ROUTE = 2, STATUS_POINT_GO = 3, STATUS_OTHER = 4;

const WF_RECORD_ENABLED = 0x0002;       // GameRecord flag RF_ENABLED (+0x60 & 2)

// ----------------------------------------------------------------------------- types

/** what the walker needs from a record: position, yaw and matrix (GameRecord satisfies this) */
export interface WalkerRecord {
  name?: string;
  x: number; y: number; z: number;
  ry: number; rx?: number; rz?: number;
  m: Float32Array;
  flags?: number;
  rebuildYaw?(): void;
}

export interface StepOut { yaw: number; dist: number }

/** one walker (0x84 bytes in the original, offsets in the comments) */
export class Walker {
  /** +0x00 */ flags = 0;
  /** +0x04 */ map = 0;
  /** +0x08 */ rec: WalkerRecord | null = null;
  /** +0x0c: first 4 characters of the record's name */ recName = '';
  /** +0x10: the walker found ahead (FUN_00464bbf) */ blocker: Walker | null = null;
  /** +0x14: record to follow / face */ follow: WalkerRecord | null = null;
  /** +0x18: destination node */ goal = 0;
  /** +0x1a: node being approached */ to = 0;
  /** +0x1c: the node after `to` on the route (-1 none) */ next = 0;
  /** +0x1e: node passed last */ from = 0;
  /** +0x20: lane offset (walker units, + = right) */ lane = 0;
  /** +0x24 / +0x28 / +0x2c: next walker in the node lists 0 / 1 / 2 */ link: (Walker | null)[] = [null, null, null];
  /** +0x30..+0x38 target point (world units) */ point: [number, number, number] = [0, 0, 0];
  /** +0x3c */ pointSet = 0;
  /** +0x40: turn rate when turning on the spot (rad per tick) */ turnRate = 0;
  /** +0x44: speed (walker units per tick) */ speed = 0;
  /** +0x48: speed while still turning */ speedReduced = 0;
  /** +0x4c: first (tight) curve radius */ radiusMin = 0;
  /** +0x50: second curve radius */ radiusMax = 0;
  /** +0x54: current turn rate (rad per tick) */ curTurn = 0;
  /** +0x58: heading of the next segment */ headingNext = 0;
  /** +0x5c: heading of the current segment */ headingCur = 0;
  /** +0x60: desired heading */ heading = 0;
  /** +0x68: squared length of the segment last set */ segLen2 = 0;
  /** +0x6c: reach: the walker advances to the next node when closer than this */ reach = 1;
  /** +0x70: shift of the lane point past the node (curve) */ curve = 0;
  /** +0x74: largest accepted radius excess R/cos - R */ radiusLimit = 0;
  /** +0x78: squared distance at which a walker ahead blocks */ stopDist2 = 0;
  /** +0x7c: squared distance to the lane point */ dist2 = 0;
  /** +0x80: speed scale */ speedScale = 1;
  /** +0x64: a word of the struct no walker function reads or writes (zero in the original's table; kept so that a loaded table saves back byte for byte, src/game/walkersave.ts) */ pad64 = 0;
  /**
   * save game only (src/game/walkersave.ts): the raw words of a walker slot the loader FUN_00462e75 leaves as the file had them while the slot is NOT in use (flags 0): +0x08 (stale record
   * pointer) and +0x10 (stale blocker pointer). null = derive them from `rec` / `blocker` like the original's own stale words. A create (memset of the slot) clears it.
   */
  stale: { rec: number; blocker: number } | null = null;
}

class WalkerMap {
  wp: CompiledWaypoints;
  nodes: WaypointNode[];
  /** node +0x14 / +0x18 / +0x1c: heads of the walker lists 0 / 1 / 2 per node */
  heads: (Walker | null)[];
  constructor(wp: CompiledWaypoints) {
    this.wp = wp; this.nodes = wp.nodes;
    this.heads = new Array(wp.nodes.length * 3).fill(null);
  }
  get count() { return this.nodes.length; }
}

/** the working copy of FUN_004659b6's stack frame: yaw, position / 8, angle difference, distance moved */
interface StepState { yaw: number; x: number; z: number; diff: number; dist: number }

/** the angle wrap of the original (inline in every function that stores an angle difference): the argument is a float32 value, the result is stored as one */
const normAngle = (a: number) => (a < -PI ? fr(a + TWO_PI) : a > PI ? fr(a - TWO_PI) : a);
/** FUN_00465bf6: |(dx, dz)|^2 of two float locals (each square is stored as a float, the sum is returned in the FPU: the callers store or cast it) */
const len2 = (dx: number, dz: number) => fr(fr(dx * dx) + fr(dz * dz));
const modeOf = (w: Walker) => (w.flags & 0xf0000000) >>> 0;
const setMode = (w: Walker, m: number) => { w.flags = (w.flags & 0x0fffffff) | m; };
const recEnabled = (r: WalkerRecord) => r.flags === undefined || (r.flags & WF_RECORD_ENABLED) !== 0;

// ----------------------------------------------------------------------------- the system

export class WaypointSystem {
  /** the 4 map slots (null = not loaded) */
  maps: (WalkerMap | null)[] = [null, null, null, null];
  /** the walker table */
  walkers: (Walker | null)[] = new Array(MAX_WALKERS).fill(null);
  /** the original's static table (DAT_05d4e1b0, 60 x 0x84 bytes): a freed walker stays in memory, and a node list that still points at it keeps doing so (teleport / free leave such stale entries); a new walker reuses the slot */
  readonly slots: Walker[] = Array.from({ length: MAX_WALKERS }, () => Object.assign(new Walker(), { reach: 0, speedScale: 0 }));   // (static BSS: all zero until a create)
  /** DAT_008b1718: time step of a tick (1.0) */
  dt = 1;
  /** _DAT_05d57cdc: y of the last stepped position (written by the original, read by nobody in this module) */
  lastY = 0;

  // ------------------------------------------------------------------- maps (FUN_004630c0, FUN_00463701, FUN_004613d0)

  /** FUN_004630c0 for the 4 slots: `Waypoints/W_<MAP>_C.wpt` of the archive. Returns the node counts (0 = missing / invalid). */
  load(archive: Archive): number[] {
    return MAP_NAMES.map((n, slot) => {
      const e = archive.find(`Waypoints/W_${n}_C.wpt`);
      if (!e) return 0;
      try { this.loadMap(slot, archive.read(e)); } catch { this.maps[slot] = null; return 0; }
      return this.maps[slot]?.count ?? 0;
    });
  }
  /** FUN_004630c0 for one slot */
  loadMap(slot: number, data: Uint8Array) {
    this.maps[slot] = new WalkerMap(parseCompiledWaypoints(data));
  }
  /** FUN_00463701: free the maps, FUN_004613d0: clear the walker table */
  unload() { this.maps = [null, null, null, null]; this.reset(); }
  reset() { this.walkers.fill(null); for (const s of this.slots) s.flags = 0; this.ghost = new Walker(); }
  /** FUN_00462c34 */
  mapCount(map: number) { return this.maps[map]?.count ?? 0; }
  /** FUN_00463880: valid node index of the map (the original accepts 0..count inclusive) */
  validNode(map: number, n: number) { return n >= 0 && n <= this.mapCount(map); }
  node(map: number, n: number): WaypointNode | undefined { return this.maps[map]?.nodes[n]; }

  /** FUN_00462be9 */
  nodePos(map: number, n: number, out: number[] = [0, 0, 0]): number[] {
    const nd = this.maps[map]?.nodes[n];
    if (nd) { out[0] = nd.x; out[1] = nd.y; out[2] = nd.z; }
    return out;
  }
  /** FUN_00462b4e: first node whose name starts with `name` (strncmp), -1 if none */
  findNode(map: number, name: string): number {
    const m = this.maps[map];
    if (!m) return -1;
    for (let i = 0; i < m.nodes.length; i++) if (m.nodes[i].name.startsWith(name)) return i;
    return -1;
  }
  /** nearest node by 3D distance (the search of FUN_004614d5 for start node -1; first minimum wins) */
  nearestNode(map: number, x: number, y: number, z: number): number {
    const m = this.maps[map];
    if (!m) return -1;
    let best = fr(1e38), bi = -1;
    for (let i = 0; i < m.nodes.length; i++) {
      const n = m.nodes[i];
      const dx = fr(x - n.x), dy = fr(y - n.y), dz = fr(z - n.z), d = fr(fr(fr(dx * dx) + fr(dy * dy)) + fr(dz * dz));
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }

  /** FUN_00463b49: next node on the route from a to b (a for a == b); out of range indices are clamped like the original */
  route(map: number, a: number, b: number): number {
    const m = this.maps[map];
    if (!m) return a;
    const n = m.count;
    if (a >= n) a = n - 1;
    if (b >= n) b = n - 1;
    return nextHop(m.wp, a, b);
  }
  /** FUN_004639a7: b is the first hop from a to b (direct neighbours) */
  isAdjacent(map: number, a: number, b: number): boolean {
    const m = this.maps[map];
    if (!m) return false;
    const nb = m.nodes[b], na = m.nodes[a];
    if (nb.group < 0) return a === nb.index;
    if (na.group < 0) return na.index === b;
    const mat = m.wp.matrices[na.group];
    const col = na.group === nb.group ? nb.index : nb.group + mat.h;
    return mat.hops[na.index * mat.w + col] === b;
  }
  /** FUN_00462c48: the nodes adjacent to `node` (and its group) */
  neighbors(map: number, node: number): { group: number; nodes: number[] } {
    const m = this.maps[map]!;
    const nd = m.nodes[node];
    const nodes: number[] = [];
    if (nd.group < 0) nodes.push(nd.index);
    else for (let i = 0; i < m.count; i++) if (this.isAdjacent(map, node, i)) nodes.push(i);
    return { group: nd.group, nodes };
  }

  // ------------------------------------------------------------------- the table

  /** walker of a handle (handle = index + 1) or null */
  get(handle: number): Walker | null { return handle === 0 ? this.ghost : (this.walkers[handle - 1] ?? null); }
  /**
   * handle 0 (a node on a record whose controller never got a walker: SPD0's Human1 nodes): the original's calls compute `DAT_05d4e1b0 + (0 - 1) * 0x84`, the 0x84 bytes in front of the walker table,
   * zero at set-up: the functions read and write it like a walker (flags, route state, list links ...), so handle 0 is a walker of its own that is never created.
   */
  ghost = new Walker();

  /**
   * FUN_004614d5(map, rec, startNode) -> handle (0 = failed). startNode -1 = the nearest node (needs a record), -3 = no node,
   * else the node index; a record is moved onto the start node (FUN_0046140f), the walker gets its first neighbour as `to`.
   */
  create(map: number, rec: WalkerRecord | null, startNode: number): number {
    const m = this.maps[map];
    if (!m || m.count < 1) return 0;
    let slot = 0;
    while (slot < MAX_WALKERS && this.walkers[slot]) slot++;
    if (slot === MAX_WALKERS) return 0;
    const w = this.slots[slot];
    Object.assign(w, new Walker());      // (the original's memset of the 0x84 bytes: the links go, the nodes' lists keep their pointers to the slot)
    this.walkers[slot] = w;
    w.map = map;
    w.turnRate = DEFAULT_TURN_RATE;
    w.radiusMax = DEFAULT_RADIUS_MAX;
    w.radiusMin = DEFAULT_RADIUS_MIN;
    w.radiusLimit = DEFAULT_RADIUS_LIMIT;
    w.curTurn = 0;
    w.speedScale = 1;
    w.rec = rec;
    w.recName = rec?.name?.slice(0, 4) ?? '';
    w.to = startNode;
    w.stopDist2 = map === MAP_ROAD ? DEFAULT_STOP_DIST2_ROAD : DEFAULT_STOP_DIST2;
    w.flags = WF_ACTIVE | WF_STOPPED | WF_GO;      // 0xb
    w.reach = 1;
    if (startNode === -1 && rec) startNode = this.nearestNode(map, rec.x, rec.y, rec.z);
    if (startNode < 0) {
      if (startNode === -3) { w.from = 0; w.to = 0; } else { w.from = -1; w.to = -1; }
    } else {
      this.setNode(slot + 1, startNode, rec);
      for (let i = 0; i < m.count; i++) {
        if (i !== startNode && this.route(map, startNode, i) === i) { this.setTo(w, i); w.next = -1; break; }
      }
    }
    return slot + 1;
  }

  /** FUN_00461a3b */
  free(handle: number) {
    const w = this.get(handle);
    if (!w) return;
    if (w.flags !== 0 && this.mapCount(w.map) > 0) this.unregister(w);
    w.flags = 0;
    if (handle > 0) this.walkers[handle - 1] = null;
  }

  /** FUN_0046140f(handle, node, rec): the walker stands on `node` (from), the record is moved there; the route has to be restarted */
  setNode(handle: number, node: number, rec: WalkerRecord | null) {
    const w = this.get(handle);
    if (!w) return;
    w.flags &= ~WF_RUNNING;
    w.from = node;
    if (rec) { const n = this.node(w.map, node); if (n) { rec.x = n.x; rec.y = n.y; rec.z = n.z; } }
  }

  // ------------------------------------------------------------------- orders

  /**
   * FUN_00461c24(handle, node, cont): go to `node` along the route matrix. cont = 1 keeps going smoothly when the walker is already heading
   * for that goal (and re-routes from the current segment instead of restarting); 0 may turn around.
   */
  goTo(handle: number, node: number, cont: number) {
    const w = this.get(handle);
    if (!w) return;
    const count = this.mapCount(w.map);
    let local = cont;
    if (node < 0) node = 0;
    else if (count < node) node = count - 1;          // (sic: the original clamps only above count)
    if (w.flags & WF_STOPPED) { w.flags &= ~WF_STOPPED; local = 0; }
    if (modeOf(w) === MODE_FOLLOW) { w.flags &= 0x0fffffff; local = 0; }
    if (modeOf(w) === MODE_POINT_GO) { w.flags &= 0x0fffffff; local = 0; }
    if (w.goal === node) { if (cont === 1) local = 1; } else w.goal = node;
    w.flags &= 0x0fffffff;
    w.flags |= local === 0 ? (MODE_ROUTE | WF_GO) : (MODE_ROUTE | WF_GO_CONT);
  }
  /** FUN_00462729: turn towards a record (mode follow; step returns -2 while turning, -3 when facing it) */
  followRecord(handle: number, rec: WalkerRecord | null) {
    const w = this.get(handle);
    if (!w) return;
    w.follow = rec;
    if (rec) {
      w.flags &= ~WF_STOPPED;
      setMode(w, MODE_FOLLOW);
    }
  }
  /** FUN_004627e2: turn towards a point (world units; mode point); null stops */
  turnToPoint(handle: number, p: ArrayLike<number> | null) {
    const w = this.get(handle);
    if (!w) return;
    if (!p) { w.pointSet = 0; w.flags &= 0x0fffffff; w.flags |= WF_STOPPED; return; }
    w.point = [p[0], p[1], p[2]];
    w.pointSet = 1;
    w.flags &= ~WF_STOPPED;
    setMode(w, MODE_POINT);
  }
  /** FUN_00462918: turn towards a node of the walker's map */
  turnToNode(handle: number, node: number) {
    const w = this.get(handle);
    if (!w) return;
    const n = this.node(w.map, node);
    this.turnToPoint(handle, n ? [n.x, n.y, n.z] : null);
  }
  /** FUN_00462952: turn to a heading (mode heading) */
  turnToHeading(handle: number, heading: number) {
    const w = this.get(handle);
    if (!w) return;
    w.heading = heading;
    w.flags &= ~WF_STOPPED;
    setMode(w, MODE_HEADING);
  }
  /** FUN_00462a11: walk to a point (mode 1; null stops). NB: the arrival test of the original (FUN_00465416) never succeeds, see `pointStep`. */
  moveToPoint(handle: number, p: ArrayLike<number> | null) {
    const w = this.get(handle);
    if (!w) return;
    if (!p) { w.flags &= 0x0fffffff; w.flags |= WF_STOPPED; return; }
    w.point = [p[0], p[1], p[2]];
    w.flags &= 0x0fffffff;
    w.flags &= ~WF_BLOCKED;
    w.flags &= ~WF_PHASE;
    w.flags &= ~WF_STOPPED;
    w.flags |= MODE_POINT_GO;
    // (the original relies on the turn rate left in +0x54 by an earlier route order; a fresh walker would never turn)
    if (w.curTurn === 0) this.recompute(w);
  }
  /** FUN_004625d7(handle, _, node): re-pin the walker on `node` (from = to = next = node) */
  teleport(handle: number, node: number) {
    const w = this.get(handle);
    if (!w) return;
    w.flags |= WF_ACTIVE;
    w.from = node; w.to = node; w.next = node;
    this.reregister(w);
  }
  /** FUN_00462686: re-enter the walker into the node lists */
  reregister(w: Walker | number) {
    const x = typeof w === 'number' ? this.get(w) : w;
    if (!x) return;
    x.flags |= WF_ACTIVE;
    this.unregister(x); this.register(x);
  }
  /** FUN_0046265d */
  unregister(w: Walker | number) {
    const x = typeof w === 'number' ? this.get(w) : w;
    if (!x) return;
    this.removeAll(x);
  }

  // ------------------------------------------------------------------- tuning and queries (FUN_00462206 etc.)

  /** FUN_00462206: speed; a running walker keeps its reduced speed / turn rate proportional */
  setSpeed(handle: number, s: number) {
    const w = this.get(handle);
    if (!w) return;
    s = fr(s);
    if (w.speed !== s) {
      if (Math.abs(w.speed) > SPEED_RESCALE_MIN && (w.flags & 0x1000) !== 0) {
        const red = fr(fr(w.speedReduced * s) / w.speed);
        const old = w.speedReduced;
        w.speedReduced = red;
        // (the original divides by the old value unguarded: 0 / 0 gives NaN there, and so it does here)
        w.curTurn = fr(fr(w.curTurn * red) / old);
      }
    }
    w.speed = s;
  }
  /** FUN_00462324: turn rate (absolute value) */
  setTurnRate(handle: number, r: number) { const w = this.get(handle); if (w) w.turnRate = Math.abs(fr(r)); }
  /** FUN_00461ad6 / FUN_00461af9 / FUN_00461b2a */
  setLane(handle: number, v: number) { const w = this.get(handle); if (w) w.lane = fr(v); }
  flipLane(handle: number) { const w = this.get(handle); if (w) w.lane = -w.lane; }
  flipLanes(map: number) { for (const w of this.walkers) if (w && w.map === map) w.lane = -w.lane; }
  /** FUN_004623aa / FUN_004623cd / FUN_00462436 / FUN_004623f0 (squares the distance) / FUN_004621c7 */
  setRadiusMin(handle: number, v: number) { const w = this.get(handle); if (w) w.radiusMin = fr(v); }
  setRadiusMax(handle: number, v: number) { const w = this.get(handle); if (w) w.radiusMax = fr(v); }
  setRadiusLimit(handle: number, v: number) { const w = this.get(handle); if (w) w.radiusLimit = fr(v); }
  setStopDistance(handle: number, d: number) { const w = this.get(handle); if (w) w.stopDist2 = fr(d * d); }
  setSpeedScale(handle: number, v: number) { const w = this.get(handle); if (w) w.speedScale = fr(v); }
  /** FUN_0046190f(handle, noYield, noCross): 1 sets, 0 clears, other values leave the flag */
  setIgnore(handle: number, noYield: number, noCross: number) {
    const w = this.get(handle);
    if (!w) return;
    if (noYield === 1) w.flags |= WF_NOYIELD; else if (noYield === 0) w.flags &= ~WF_NOYIELD;
    if (noCross === 1) w.flags |= WF_NOCROSS; else if (noCross === 0) w.flags &= ~WF_NOCROSS;
  }
  /** FUN_004618a5: the original tests `flags | bit` against 0, which is never true: both answers are always 1 (checked by tools/lib/m7-walker-api.mjs) */
  getIgnore(handle: number): { noYield: boolean; noCross: boolean } {
    void handle;
    return { noYield: true, noCross: true };
  }
  /** FUN_00461b92 */
  status(handle: number): number {
    const w = this.get(handle);
    if (!w || (w.flags & WF_STOPPED) || !(w.flags & WF_RUNNING)) return STATUS_IDLE;
    if (modeOf(w) === MODE_POINT_GO) return STATUS_POINT_GO;
    if ((w.flags & 0x60000000) === 0) return STATUS_ROUTE;
    return STATUS_OTHER;
  }
  /** FUN_00461e69: stop and mark blocked (talking) / FUN_00461f42: resume / FUN_00461f98: not stopped / FUN_00461fc0: flags = 9 */
  pause(handle: number) { const w = this.get(handle); if (w) w.flags |= WF_BLOCKED | WF_STOPPED; }
  resume(handle: number) { const w = this.get(handle); if (w) { w.flags |= WF_BLOCKED; w.flags &= ~WF_STOPPED; } }
  /** plain stop (flag 2; step returns -1 until the next order) */
  halt(handle: number) { const w = this.get(handle); if (w) w.flags |= WF_STOPPED; }
  isMoving(handle: number) { const w = this.get(handle); return !!w && (w.flags & WF_STOPPED) === 0; }
  isBlocked(handle: number) { const w = this.get(handle); return !!w && (w.flags & WF_BLOCKED) !== 0; }
  isYielding(handle: number) { const w = this.get(handle); return !!w && (w.flags & WF_AHEAD_IGN) !== 0; }
  clearFlags(handle: number) { const w = this.get(handle); if (w) w.flags = WF_ACTIVE | WF_GO; }
  /** FUN_00461f09: the record of the walker found ahead */
  blockerRecord(handle: number): WalkerRecord | null { return this.get(handle)?.blocker?.rec ?? null; }
  /** FUN_00461e06 / FUN_00461e27 / FUN_00461e48 */
  goalOf(handle: number) { return this.get(handle)?.goal ?? 0; }
  fromOf(handle: number) { return this.get(handle)?.from ?? 0; }
  toOf(handle: number) { return this.get(handle)?.to ?? 0; }

  /** FUN_0046248a(src, dst, delta): copy a walker onto another (keeps the destination's record) */
  clone(srcHandle: number, dstHandle: number, delta: number) {
    const s = this.get(srcHandle), d = this.get(dstHandle);
    if (!s || !d) return;
    const rec = d.rec, name = d.recName;
    Object.assign(d, s);
    d.link = [null, null, null];
    d.point = [s.point[0], s.point[1], s.point[2]];
    d.rec = rec; d.recName = name;
    if (Math.abs(delta) > CLONE_EPS) { const r = ad(sq(d.dist2), delta); d.dist2 = ml(r, r); }   // (x87 at 24 bit: sqrt, the sum, the product, each rounded)
  }

  // ------------------------------------------------------------------- node lists (FUN_00463e11 / FUN_00463d50 / FUN_00463f9d / FUN_00463ec8)

  private listAdd(w: Walker, map: number, node: number, k: number) {
    const m = this.maps[map];
    if (!m || node < 0 || node >= m.count) return;
    for (let p = m.heads[node * 3 + k]; p; p = p.link[k]) if (p === w) return;
    w.link[k] = m.heads[node * 3 + k];
    m.heads[node * 3 + k] = w;
  }
  private listRemove(w: Walker, map: number, node: number, k: number) {
    const m = this.maps[map];
    if (!m || node < 0 || node >= m.count) return;
    let prev: Walker | null = null;
    for (let p = m.heads[node * 3 + k]; p; p = p.link[k]) {
      if (p === w) {
        if (!prev) m.heads[node * 3 + k] = p.link[k]; else prev.link[k] = p.link[k];
        return;
      }
      prev = p;
    }
  }
  /** the road node a path walker on a kind-4 node is registered at (list 2), or -1 */
  private crossingLink(w: Walker, node: number): number {
    if (w.map !== MAP_PATH || node < 0) return -1;
    const n = this.maps[MAP_PATH]?.nodes[node];
    return n && n.kind === 4 ? n.link : -1;
  }
  /** the guard of FUN_00463ec8 / FUN_00463f9d's list 2: a path walker whose `from` is a kind-4 node with a link */
  private crossingFrom(w: Walker): boolean {
    if (w.map !== MAP_PATH || w.from < 0) return false;
    const n = this.maps[MAP_PATH]?.nodes[w.from];
    return !!n && n.kind === 4 && n.link >= 0;
  }
  /**
   * FUN_00463f9d: unregister, then enter list 1 at `to`, list 0 at `next` and (path walker on a crossing) list 2 at the ROAD node numbered `to` (the original uses the walker's own `to`
   * index in the road map where FUN_0046410c uses the crossing's link: the lists of a walker entered here and one entered by FUN_0046410c differ, and FUN_00463ec8 removes the same wrong entry)
   */
  register(w: Walker) {
    this.removeAll(w);
    if (w.to >= 0) this.listAdd(w, w.map, w.to, 1);
    if (w.next >= 0) this.listAdd(w, w.map, w.next, 0);
    if (this.crossingFrom(w)) this.listAdd(w, MAP_ROAD, w.to, 2);
  }
  /** FUN_00463ec8 */
  private removeAll(w: Walker) {
    if (w.to >= 0) this.listRemove(w, w.map, w.to, 1);
    if (w.next >= 0) this.listRemove(w, w.map, w.next, 0);
    if (this.crossingFrom(w)) this.listRemove(w, MAP_ROAD, w.to, 2);
  }

  // ------------------------------------------------------------------- route state (FUN_0046410c / FUN_004642b0 / FUN_0046407e / FUN_004643fe)

  private pos2(w: Walker, a: number, b: number) {
    // vector from node b to node a in walker units (x, z), each stored as a float
    const m = this.maps[w.map]!;
    const na = m.nodes[a], nb = m.nodes[b >= 0 ? b : a];
    return { dx: fr((na.x - nb.x) * TO_WALK), dz: fr((na.z - nb.z) * TO_WALK) };
  }
  /** FUN_0046410c: `to` = n; heading and length of the segment from -> to */
  private setTo(w: Walker, n: number) {
    this.listRemove(w, w.map, n, 1);
    this.listRemove(w, w.map, w.to, 1);
    w.to = n;
    if (n >= 0) {
      this.listAdd(w, w.map, w.to, 1);
      const l = this.crossingLink(w, w.to);
      if (l >= 0) this.listAdd(w, MAP_ROAD, l, 2);
      const { dx, dz } = this.pos2(w, w.to, w.from);
      w.headingCur = fr(Math.atan2(dx, dz));
      w.segLen2 = len2(dx, dz);
    }
  }
  /** FUN_004642b0: `next` = n; heading of the segment to -> next and its squared length */
  private setNext(w: Walker, n: number) {
    if (w.next >= 0) this.listRemove(w, w.map, w.next, 0);
    w.next = n;
    if (n < 0) w.headingNext = w.headingCur;
    else {
      this.listRemove(w, w.map, n, 0);
      const { dx, dz } = this.pos2(w, w.next, w.to);
      w.headingNext = fr(Math.atan2(dx, dz));
      w.segLen2 = len2(dx, dz);
      this.listAdd(w, w.map, w.next, 0);
    }
  }
  /** FUN_0046407e: `from` = n (leaves the crossing list of the old from) */
  private setFrom(w: Walker, n: number) {
    if (n < 0) n = 0;
    const l = this.crossingLink(w, w.from);
    if (l >= 0) this.listRemove(w, MAP_ROAD, l, 2);
    w.from = n;
  }
  /** FUN_004643fe: reset the curve and derive the speed / turn rate of a lane of radius |lane| (or of a turn on the spot) */
  private recompute(w: Walker) {
    w.curve = 0;
    w.reach = 1;
    const al = Math.abs(w.lane);
    if (LANE_MIN <= al) {
      w.curTurn = fr(w.speed / al);
      const a = fr(w.curTurn * QUARTER), b = fr(w.curTurn * EIGHTH);
      w.speedReduced = fr(Math.cos(b) * fr(Math.cos(a) * w.speed));
      w.curTurn = fr(w.speedReduced / al);
    } else {
      w.curTurn = w.turnRate;
      w.speedReduced = 0;
    }
  }

  // ------------------------------------------------------------------- the step

  /**
   * FUN_004626d0(handle, pos, yaw, out): advance a walker by one tick. `pos` ([x, y, z] in world units) and the yaw are the record's; `pos` is
   * updated in place (x, z), `out.yaw` is the new yaw, `out.dist` the distance moved (walker units).
   * Returns the node being approached (>= 0), STEP_ARRIVED (-1; the walker has stopped), STEP_TURNING (-2) / STEP_FACING (-3) for the follow / point /
   * heading modes, STEP_MOVING_TO_POINT (-4) for moveToPoint.
   */
  step(handle: number, pos: number[] | Float32Array, yaw: number, out: StepOut, dt: number = this.dt): number {
    const w = this.get(handle);
    out.yaw = yaw; out.dist = 0;
    if (!w || (w.flags & WF_STOPPED)) return STEP_ARRIVED;
    const saved = this.dt;
    this.dt = dt;
    try { return this.stepWalker(w, pos, yaw, out); } finally { this.dt = saved; }
  }

  /** FUN_004659b6 */
  private stepWalker(w: Walker, pos: number[] | Float32Array, yaw: number, out: StepOut): number {
    this.prepare(w);
    const s: StepState = { yaw: normAngle(fr(yaw)), x: fr(pos[0] * TO_WALK), z: fr(pos[2] * TO_WALK), diff: 0, dist: 0 };
    this.lastY = fr(pos[1]);
    let ret = 0;
    let tail = false;                      // fall through to FUN_004651d4
    const mode = modeOf(w);
    if (mode === MODE_ROUTE) {
      if (!(w.flags & WF_RUNNING)) ret = STEP_ARRIVED;
      else if (this.seek(w, s)) { this.steer(w, s); ret = w.to; }
      else if (modeOf(w) !== MODE_FOLLOW) { ret = STEP_ARRIVED; w.flags |= WF_STOPPED; w.flags &= ~WF_PHASE; }
      else tail = true;
    } else if (mode === MODE_POINT_GO) {
      if (!this.pointStep(w, s)) { w.flags |= WF_STOPPED; w.flags &= ~WF_PHASE; ret = STEP_ARRIVED; }
      else { this.steer(w, s); ret = STEP_MOVING_TO_POINT; }
    } else if (mode === MODE_FOLLOW || mode === MODE_POINT) tail = true;
    else if (mode === MODE_HEADING) { w.curTurn = w.turnRate; ret = this.headingStep(w, s); }
    if (tail) ret = this.followStep(w, s);
    pos[0] = fr(s.x * FROM_WALK);
    pos[2] = fr(s.z * FROM_WALK);
    out.yaw = s.yaw;
    out.dist = s.dist;
    return ret;
  }

  /** FUN_00465781: turn a pending order (flags 8 / 0x10) into route state */
  private prepare(w: Walker) {
    if (!(w.flags & (WF_GO | WF_GO_CONT)) || (w.flags & 0x60000000)) return;
    const map = w.map;
    const fresh = () => {
      this.setTo(w, this.route(map, w.from, w.goal));
      this.setNext(w, this.route(map, w.to, w.goal));
      this.recompute(w);
    };
    if (!(w.flags & WF_RUNNING)) fresh();
    else if (!(w.flags & WF_GO)) this.setNext(w, this.route(map, w.to, w.goal));
    else if (w.to === w.from) fresh();
    else {
      const hop = this.route(map, w.to, w.goal);
      if (hop === w.from) {          // the route leads back: turn around
        this.setFrom(w, w.to);
        this.setTo(w, hop);
        this.setNext(w, this.route(map, hop, w.goal));
        this.recompute(w);
      } else this.setNext(w, this.route(map, w.to, w.goal));
    }
    w.flags |= WF_RUNNING;
    w.flags &= ~WF_PHASE;
    w.flags &= ~(WF_GO | WF_GO_CONT);
  }

  /** FUN_00465353: the walker reached `to`: from = to, to = next, plan the next hop */
  private advance(w: Walker) {
    if (w.to < 0) {
      if (!w.follow) { w.flags &= ~WF_RUNNING; w.flags |= WF_STOPPED; }
      else setMode(w, MODE_FOLLOW);
    } else {
      this.setFrom(w, w.to);
      this.setTo(w, w.next);
      w.flags &= ~WF_PHASE;
      if (w.to >= 0) this.setNext(w, this.route(w.map, w.to, w.goal));
    }
  }

  /** FUN_0046555e: aim at the lane point of node `to`; advances over nodes already reached. 0 = no (more) route, 1 = on the way */
  private seek(w: Walker, s: StepState): number {
    const m = this.maps[w.map]!;
    for (let guard = 0; guard < 4096; guard++) {      // (guard: a broken route matrix must not hang the tick)
      if (w.to < 0) return 0;
      if (w.goal === w.from) return 0;
      if (w.to === w.from) { this.advance(w); continue; }
      const sn = fr(Math.sin(w.headingCur)), cs = fr(Math.cos(w.headingCur));
      const k = fr(1 + w.curve);
      const ox = fr(fr(w.lane * cs) + fr(k * sn));
      const oz = fr(fr(-sn * w.lane) + fr(k * cs));
      const nd = m.nodes[w.to];
      const ax = fr(nd.x * TO_WALK), az = fr(nd.z * TO_WALK);
      const dx = fr(fr(ax + ox) - s.x), dz = fr(fr(az + oz) - s.z);
      w.heading = fr(Math.atan2(dx, dz));
      s.diff = normAngle(fr(s.yaw - w.heading));
      w.dist2 = len2(dx, dz);
      if (w.dist2 < fr(w.reach * w.reach)) { this.advance(w); continue; }
      return 1;
    }
    return 0;
  }

  /** FUN_00464918: turn the yaw towards the desired heading by the current turn rate. 0 = reached it, 1 = still turning */
  private turnToward(w: Walker, s: StepState): number {
    const f = fr(fr(w.curTurn * w.speedScale) * fr(this.dt));
    // (x87 compares: an unordered result - the turn rate is NaN after FUN_00462206 divided 0 by 0 - sets C0 and C3, so `<=` is true; written as the negated `>`)
    if (!(s.diff > f)) {
      if (!(-f > s.diff)) { s.yaw = w.heading; return 0; }
      s.yaw = fr(f + s.yaw);
    } else s.yaw = fr(s.yaw - f);
    s.yaw = normAngle(s.yaw);
    return 1;
  }

  /**
   * FUN_00464517: plan the curve into the next segment with radius R (phase 0: radiusMin, 0x2000: radiusMax, 0x3000: the mean).
   * Sets the lane shift / reach / turn rate. 0 = does not fit, 1 = curve planned, 2 = (almost) straight or special node.
   */
  private plan(w: Walker, s: StepState, phase: number): number {
    const m = this.maps[w.map]!;
    const bend = normAngle(fr(w.headingNext - w.headingCur));
    const ab = Math.abs(bend);
    if (!(BEND_MIN <= ab)) {
      w.curve = 0;
      w.curTurn = fr(w.speed / w.radiusMin);
      return 2;
    }
    if (!(ab <= BEND_MAX)) return 0;
    const half = fr(bend * HALF);
    const sinH = fr(Math.sin(half)), cosH = fr(Math.cos(half));
    const tanH = fr(sinH / cosH);
    if (phase === 0) w.curve = LANE_EPS <= Math.abs(w.lane) ? fr(-w.lane * tanH) : 0;
    const kind = m.nodes[w.to].kind;
    let special = false;
    let R = w.radiusMin;
    if (phase === 0x2000) {
      R = w.radiusMax;
      if (w.map === MAP_ROAD && kind === 1) {
        special = true;
        if (w.lane < 0 && half < 0) R = w.radiusMax;
        else if (w.lane > 0 && half > 0) R = w.radiusMax;
        else R = fr(w.radiusMax + w.radiusMax);
      }
    } else if (phase === 0x3000) R = fr(fr(fr(w.radiusMax - w.radiusMin) * HALF) + w.radiusMin);
    const excess = fr(fr(R / cosH) - R);
    if (!(excess <= w.radiusLimit) && !special) return 0;
    const t = fr(Math.abs(tanH) * R);
    if (!(fr(t * t) <= w.dist2)) return 0;
    if (!(fr((t + t) * (t + t)) <= w.segLen2)) return 0;
    w.reach = fr(1 + t);
    w.curTurn = fr(w.speed / R);
    const a = fr(w.curTurn * QUARTER), b = fr(w.curTurn * EIGHTH);
    w.speedReduced = fr(Math.cos(b) * fr(Math.cos(a) * Math.abs(w.speed)));
    w.curTurn = fr(w.speedReduced / R);
    if (w.map === MAP_ROAD && kind === 2) return 2;
    if (special) return 2;
    return 1;
  }

  /** FUN_00464f7a: turn towards the lane point, plan curves and move (unless blocked) */
  private steer(w: Walker, s: StepState) {
    const phase = w.flags & WF_PHASE;
    if (this.blocked(w, s)) return;
    let mode: number;
    if (this.turnToward(w, s) === 1) mode = 2;
    else {
      mode = 1;
      if (phase !== 0x1000) {
        w.flags &= ~WF_PHASE;
        const r = this.plan(w, s, phase);
        if (phase === 0) {
          if (r === 0) { this.recompute(w); w.flags |= 0x1000; }
          else if (r === 2) w.flags |= 0x1000;
          else w.flags |= 0x2000;
        } else if (phase === 0x2000) {
          if (r === 0) w.flags |= 0x3000; else w.flags |= 0x1000;
        } else if (phase === 0x3000) w.flags |= 0x1000;
      }
    }
    const d = fr(fr((mode === 2 ? w.speedReduced : w.speed) * w.speedScale) * fr(this.dt));
    s.dist = fr(d + s.dist);
    const sx = fr(Math.sin(s.yaw) * d), sz = fr(Math.cos(s.yaw) * d);
    s.x = fr(sx + s.x);
    s.z = fr(sz + s.z);
  }

  // ------------------------------------------------------------------- traffic (FUN_00464e16 and friends)

  /** FUN_00464e16: true when the walker has to wait this tick (sets WF_BLOCKED) */
  private blocked(w: Walker, s: StepState): boolean {
    w.flags &= ~WF_BLOCKED;
    w.flags &= ~WF_AHEAD_IGN;
    if (this.aheadBlocked(w)) return true;
    const m = this.maps[w.map]!;
    if (w.map === MAP_ROAD) {
      if (!(w.flags & WF_NOCROSS) && w.to >= 0 && m.nodes[w.to].kind === 4 && this.crossingBlocked(w)) return true;
      if (w.next >= 0 && m.nodes[w.next].kind === 2 && this.yieldBlocked(w)) return true;
    } else if (w.map === MAP_PATH && !(w.flags & WF_NOCROSS) && w.to >= 0 && m.nodes[w.to].kind === 4 && this.carBlocked(w, s)) return true;
    return false;
  }
  /** FUN_00464bbf: the walker ahead on the same segment (or on the next one) and whether it is too close */
  private aheadBlocked(w: Walker): boolean {
    const m = this.maps[w.map]!;
    let best = fr(-1e38);
    w.blocker = null;
    if (w.to >= 0) {
      for (let p = m.heads[w.to * 3 + 1]; p; p = p.link[1]) {
        if (p !== w && p.rec && recEnabled(p.rec) && p.from === w.from && p.dist2 < w.dist2 && best < p.dist2) { best = p.dist2; w.blocker = p; }
      }
    }
    if (!w.blocker && w.next >= 0 && w.rec) {
      best = fr(-1e38);
      for (let p = m.heads[w.next * 3 + 1]; p; p = p.link[1]) {
        if (p === w || !p.rec || !recEnabled(p.rec) || p.from !== w.to) continue;
        const dx = fr(w.rec.x - p.rec.x), dy = fr(w.rec.y - p.rec.y), dz = fr(w.rec.z - p.rec.z);
        const d = fr(fr(fr(dx * dx) + fr(dy * dy)) + fr(dz * dz));
        if (best < d) { w.blocker = p; best = d; }
      }
    }
    if (w.blocker && w.blocker.rec && w.rec) {
      const dx = fr((w.rec.x - w.blocker.rec.x) * TO_WALK), dz = fr((w.rec.z - w.blocker.rec.z) * TO_WALK);
      if (len2(dx, dz) < w.stopDist2) {
        if (!(w.flags & WF_NOYIELD)) { w.flags |= WF_BLOCKED; return true; }
        w.flags |= WF_AHEAD_IGN;
      }
    }
    return false;
  }
  /** FUN_00464b4b: a road walker waits for path walkers registered at its crossing node */
  private crossingBlocked(w: Walker): boolean {
    const m = this.maps[w.map]!;
    for (let p = m.heads[w.to * 3 + 2]; p; p = p.link[2]) {
      if (p !== w && p.map === MAP_PATH && !(p.flags & WF_BLOCKED)) { w.flags |= WF_BLOCKED; return true; }
    }
    return false;
  }
  /** FUN_00464a7a: yield at a kind-2 node to a walker approaching `next` from another side with an equal or higher priority (mask) */
  private yieldBlocked(w: Walker): boolean {
    const m = this.maps[w.map]!;
    for (let p = m.heads[w.next * 3 + 0]; p; p = p.link[0]) {
      if (p !== w && !(p.flags & WF_BLOCKED) && p.to !== w.to && m.nodes[w.to].mask <= m.nodes[p.to].mask) { w.flags |= WF_BLOCKED; return true; }
    }
    return false;
  }
  /** FUN_004649d2: a path walker waits at a crossing while a road walker is approaching the linked road node */
  private carBlocked(w: Walker, s: StepState): boolean {
    if (Math.abs(s.diff) > w.curTurn) return false;     // fabs(diff) <= curTurn (true for an unordered compare, see turnToward)
    const road = this.maps[MAP_ROAD];
    const link = this.maps[MAP_PATH]!.nodes[w.to].link;
    if (!road || link < 0 || link >= road.count) return false;
    for (let p = road.heads[link * 3 + 1]; p; p = p.link[1]) {
      if (p !== w && !(p.flags & WF_BLOCKED)) { w.flags |= WF_BLOCKED; return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------- follow / point / heading modes

  /** FUN_004651d4: turn on the spot towards the followed record or the point. -3 = facing it, -2 = turning */
  private followStep(w: Walker, s: StepState): number {
    let dx: number, dz: number;
    if ((w.flags & 0x60000000) === 0x60000000) {
      if (w.pointSet === 0) { w.flags |= WF_STOPPED; w.flags &= 0x0fffffff; return STEP_ARRIVED; }
      dx = fr(w.point[0] * TO_WALK - s.x); dz = fr(w.point[2] * TO_WALK - s.z);
    } else {
      if (!w.follow) { w.flags |= WF_STOPPED; w.flags &= 0x0fffffff; return STEP_ARRIVED; }
      dx = fr(w.follow.x * TO_WALK - s.x); dz = fr(w.follow.z * TO_WALK - s.z);
    }
    w.heading = fr(Math.atan2(dx, dz));
    s.diff = normAngle(fr(s.yaw - w.heading));
    w.curTurn = w.turnRate;
    return this.turnToward(w, s) === 0 ? STEP_FACING : STEP_TURNING;
  }
  /** FUN_00465146: turn on the spot to the heading set by turnToHeading */
  private headingStep(w: Walker, s: StepState): number {
    s.diff = normAngle(fr(s.yaw - w.heading));
    w.curTurn = w.turnRate;
    return this.turnToward(w, s) === 0 ? STEP_FACING : STEP_TURNING;
  }
  /**
   * FUN_00465416: aim at the point of moveToPoint. The original's arrival test measures |d + unit(d)|^2 against 1.0 (d = vector to the point,
   * unit(d) its direction), which is (|d| + 1)^2 >= 1: it never reports arrival, so this walker keeps going until the caller stops it.
   */
  private pointStep(w: Walker, s: StepState): boolean {
    let dx = fr(w.point[0] * TO_WALK - s.x), dz = fr(w.point[2] * TO_WALK - s.z);
    w.heading = fr(Math.atan2(dx, dz));
    const ux = fr(Math.sin(w.heading)), uz = fr(Math.cos(w.heading));
    s.diff = normAngle(fr(s.yaw - w.heading));
    dx = fr(dx + ux); dz = fr(dz + uz);
    w.dist2 = len2(dx, dz);
    const go = 1 <= w.dist2;
    if (!go) { w.flags &= ~WF_RUNNING; w.flags |= WF_STOPPED; }
    return go;
  }

  // ------------------------------------------------------------------- apply (FUN_00461fe4)

  /**
   * FUN_00461fe4(handle, rec): place the record: face the first lane point of the route (the walker may advance over nodes) and, with a lane
   * offset, stand beside the `from` node (to the right of the record's heading).
   */
  apply(handle: number, rec: WalkerRecord | null) {
    const w = this.get(handle);
    if (!w || !rec) return;
    if (w.to >= 0) {
      const s: StepState = { yaw: fr(rec.ry), x: fr(rec.x * TO_WALK), z: fr(rec.z * TO_WALK), diff: 0, dist: 0 };
      this.seek(w, s);
      rec.ry = w.heading;
      setYaw(rec);
    }
    if (Math.abs(w.lane) > LANE_EPS && w.from >= 0) {
      // FUN_0043abe6 rotates the vector (lane * 8, 0, 0) by the record's matrix (each component stored), then the node position is added
      const v = fr(w.lane * FROM_WALK), m = rec.m;
      const n = this.node(w.map, w.from);
      if (n) { rec.x = fr(fr(v * m[0] + 0 * m[4] + 0 * m[8]) + n.x); rec.y = fr(fr(v * m[1] + 0 * m[5] + 0 * m[9]) + n.y); rec.z = fr(fr(v * m[2] + 0 * m[6] + 0 * m[10]) + n.z); }
    }
  }
}

/** yaw only matrix rebuild at the record's position (FUN_0043a5e4 / FUN_0043a4a1) */
function setYaw(rec: WalkerRecord) {
  // FUN_0043a4a1(rec + 0xc, +0x4c, +0x50, +0x54): the rotation from the record's own Euler angles (a record standing on a slope keeps its pitch / roll), the translation of the matrix kept
  const set = (rec as { setEuler?: (rx: number, ry: number, rz: number, x: number, y: number, z: number) => void }).setEuler;
  if (set) { set.call(rec, rec.rx ?? 0, rec.ry, rec.rz ?? 0, rec.m[12], rec.m[13], rec.m[14]); return; }
  rec.m.set(buildMatrix(rec.rx ?? 0, rec.ry, rec.rz ?? 0, rec.m[12], rec.m[13], rec.m[14]));
}

/** the original's single table (globals at 0x5d4e1b0 / 0x5d500b0) */
export const waypoints = new WaypointSystem();

// ----------------------------------------------------------------------------- behaviour node

export interface WalkerArgs {
  /** which system / map slot (default: the global table, PATH) */
  system?: WaypointSystem;
  map?: number;
  /** waypoint nodes to visit: indices or names (prefix match, FUN_00462b4e) */
  route?: (number | string)[];
  /** go round the route forever (default) or stop at the last node */
  loop?: boolean;
  /** start node: index, name, -1 = nearest to the record (default), -3 = none; the record is moved onto it */
  start?: number | string;
  speed?: number; turnRate?: number; lane?: number;
  radiusMin?: number; radiusMax?: number; radiusLimit?: number;
  /** distance (walker units) at which a walker ahead stops this one */
  stopDistance?: number;
  /** gate of the node (game variable, mask, value) */
  var?: number; mask?: number; value?: number;
  /** called when a route node is reached (index into the route) */
  onNode?(index: number, node: number): void;
  /** called every tick with the step result and the distance moved (animation hook) */
  onStep?(code: number, dist: number): void;
}

/**
 * Behaviour node that drives a record along a waypoint route: the movement mechanics of the original's NPC nodes (FUN_004be20f Human1, the walker
 * part of FUN_00426151 / FUN_00425c13): create the walker, order the next route node when the goal is reached (continue flag 1), step, write the
 * position and yaw back into the record. Conversation / animation / terrain snapping are not part of it.
 */
export class WalkerNode implements BehaviourNode {
  readonly kind = 'Walker';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  sys: WaypointSystem;
  args: WalkerArgs;
  route: number[] = [];
  /** index into the route of the current goal */
  index = 0;
  handle = 0;
  /** the route has ended (loop = false) */
  done = false;
  lastCode = 0;
  private resolved = false;
  private pos: number[] = [0, 0, 0];
  private out: StepOut = { yaw: 0, dist: 0 };

  constructor(args: WalkerArgs = {}) {
    this.args = args;
    this.sys = args.system ?? waypoints;
    this.var = args.var ?? 2; this.mask = args.mask ?? 0; this.value = args.value ?? 0;
  }

  private resolve() {
    const a = this.args, map = a.map ?? MAP_PATH;
    this.route = (a.route ?? []).map((r) => (typeof r === 'string' ? this.sys.findNode(map, r) : r)).filter((n) => n >= 0);
    this.resolved = true;
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const a = this.args, sys = this.sys, map = a.map ?? MAP_PATH;
    if (!this.resolved) this.resolve();
    if (!this.handle || !sys.get(this.handle)) {
      const start = typeof a.start === 'string' ? sys.findNode(map, a.start) : (a.start ?? -1);
      this.handle = ctrl.walker && sys.get(ctrl.walker) ? ctrl.walker : sys.create(map, rec, start);
      ctrl.walker = this.handle;
      if (!this.handle) return NODE_CONTINUE;
      sys.setSpeed(this.handle, a.speed ?? NPC_SPEED);
      sys.setTurnRate(this.handle, a.turnRate ?? NPC_TURN_RATE);
      sys.setLane(this.handle, a.lane ?? 0);
      sys.setRadiusMin(this.handle, a.radiusMin ?? NPC_RADIUS_MIN);
      sys.setRadiusMax(this.handle, a.radiusMax ?? NPC_RADIUS_MAX);
      sys.setRadiusLimit(this.handle, a.radiusLimit ?? NPC_RADIUS_LIMIT);
      if (a.stopDistance !== undefined) sys.setStopDistance(this.handle, a.stopDistance);
      sys.apply(this.handle, rec);
      this.index = 0;
      if (this.route.length) sys.goTo(this.handle, this.route[0], 0);
    }
    if (this.done || !this.route.length) return NODE_CONTINUE;
    const h = this.handle;
    // a stopped walker (arrived, or stopped from outside) is sent to the current goal again
    if (!sys.isMoving(h)) sys.goTo(h, this.route[this.index], 0);
    const pos = this.pos, out = this.out;
    pos[0] = rec.x; pos[1] = rec.y; pos[2] = rec.z;
    const goal = sys.goalOf(h);
    const code = sys.step(h, pos, rec.ry, out, w.dt);
    this.lastCode = code;
    rec.ry = out.yaw;
    rec.x = pos[0]; rec.z = pos[2];
    rec.rebuildYaw();
    a.onStep?.(code, out.dist);
    // the goal node is the one being approached (or the walker has arrived): next route node, continuing smoothly
    const last = this.index === this.route.length - 1;
    if (a.loop === false && last) {
      // the end of a one-way route: wait until the walker really arrived
      if (code === STEP_ARRIVED) { a.onNode?.(this.index, this.route[this.index]); this.done = true; sys.halt(h); }
    } else if (code === goal || code === STEP_ARRIVED) {
      a.onNode?.(this.index, this.route[this.index]);
      this.index = last ? 0 : this.index + 1;
      sys.goTo(h, this.route[this.index], 1);
    }
    return NODE_CONTINUE;
  }

  destroy(_w: World, _rec: GameRecord, ctrl: Controller) {
    if (this.handle) this.sys.free(this.handle);
    this.handle = 0;
    if (ctrl.walker) ctrl.walker = 0;
  }
}

registerNode('Walker', (args) => new WalkerNode(args as WalkerArgs));
