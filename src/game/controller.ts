// Controllers and behaviour nodes (docs/re/architecture.md 4.2). A record may own a controller; the controller holds a list of nodes; a node
// runs only while a game variable satisfies (var & mask) == value (mask 0 / value 0 = always). Three passes per frame:
//   1. update (FUN_0042226e)     run the nodes of every record with an enabled controller; the return code of a node decides what happens next
//   2. pre-render (FUN_004225c5) the pre-render hook of the nodes that ran, then the frame counter (DAT_009da5cc) advances
//   3. draw (FUN_0042271b)       the draw hook of the nodes that ran (1 = handled and stop, other non-zero = handled); the default mesh draw otherwise
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';
import type { ProbeCtrl } from './probe.ts';

/** update return codes */
export const NODE_NONE = 0;      // did not run
export const NODE_STOP = 1;      // ran, stop the chain
export const NODE_CONTINUE = 2;  // ran, continue with the next node
export const NODE_RERUN = 3;     // ran, then re-run the exclusive node's update

export interface BehaviourNode {
  /** name of the original constructor / source (diagnostics) */
  readonly kind: string;
  /** game variable gate: (get(var) & mask) == value */
  var: number; mask: number; value: number;
  /** frame stamp (+0x08): the frame counter + 1 after the pre-render hook; 0xFFFFFFFE initially */
  stamp: number;
  update(w: World, rec: GameRecord, ctrl: Controller): number;
  prerender?(w: World, rec: GameRecord, ctrl: Controller): void;
  draw?(w: World, rec: GameRecord, ctrl: Controller): number;
  /** the node's draw hook is FUN_00444940 (the blob shadow of the record, e.g. the island's Brikimal FUN_004bd41a): the renderer draws the record's shadow even when the record's mesh is hidden */
  readonly blobShadow?: boolean;
  /** a draw hook that draws other records at its own turn (the boat's FUN_00430c59): the records to draw before and after the record itself (forced: their own flags may be cleared); null = none this frame */
  drawSeq?(w: World, rec: GameRecord): { before: GameRecord[]; after: GameRecord[] } | null;
  destroy?(w: World, rec: GameRecord, ctrl: Controller): void;
}

export const CF_ENABLED = 2, CF_EXCLUSIVE_VALID = 4, CF_TARGETABLE = 0x40;

export class Controller {
  nodes: BehaviourNode[] = [];
  /** c[1]: the current exclusive node */
  exclusive: BehaviourNode | null = null;
  /** c[2]: which nodes ran this frame (by index) */
  ran: boolean[] = [];
  /** c[3]: flags, init 6 */
  flags = 6;
  /** +0x18: squared XZ distance to the focus record, computed each frame */
  distSq = 0;
  /** +0x10: waypoint walker handle */
  walker = 0;
  /** the probe block of the controller (+0x20..+0x64, FUN_00427014 arms it, the probe pass FUN_00427233 reads it; src/game/probe.ts, probehost.ts); null until a node arms it */
  probe: ProbeCtrl | null = null;

  /** FUN_00423532: pos 0 resets the list and makes the node the head, n inserts at index n (appends if the list is shorter) */
  attach(node: BehaviourNode, pos: number) {
    if (pos <= 0) { this.nodes = [node]; this.exclusive = null; }
    else if (pos >= this.nodes.length) this.nodes.push(node);
    else this.nodes.splice(pos, 0, node);
  }
  get enabled() { return (this.flags & CF_ENABLED) !== 0; }
  find<T extends BehaviourNode>(kind: string): T | undefined { return this.nodes.find((n) => n.kind === kind) as T | undefined; }
}

/** nodes are created by name so later milestones can register their own (and zone set-ups can be declarative) */
export type NodeFactory = (args: Record<string, unknown>) => BehaviourNode;
const registry = new Map<string, NodeFactory>();
export function registerNode(name: string, factory: NodeFactory) { registry.set(name, factory); }
export function createNode(name: string, args: Record<string, unknown> = {}): BehaviourNode {
  const f = registry.get(name);
  if (!f) throw new Error(`unknown behaviour node "${name}"`);
  return f(args);
}
export const registeredNodes = () => [...registry.keys()];

/**
 * FUN_0042382c + FUN_00423532: give the record a controller (if it has none) and attach a node created by `name` at position `pos` with the gate
 * (var & mask) == value. This is the call the 1,107 attach sites of the original's zone set-up code make.
 */
export function attachNode(rec: GameRecord, name: string, pos: number, v: number, mask: number, value: number, args: Record<string, unknown> = {}): BehaviourNode {
  const node = createNode(name, args);
  node.var = v; node.mask = mask; node.value = value;
  if (!rec.ctrl) rec.ctrl = new Controller();
  rec.ctrl.attach(node, pos);
  return node;
}

/** pass 1: FUN_0042226e */
export function updatePass(w: World) {
  if (w.frozen) return;
  const focus = w.focus;
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c || !c.enabled) continue;
    if (focus) { const dx = Math.fround(rec.x - focus.x), dz = Math.fround(rec.z - focus.z); c.distSq = Math.fround(Math.fround(dx * dx) + Math.fround(dz * dz)); }   // FUN_0042216f: float32 per operation (24-bit x87)
    c.ran.length = 0;
    // FUN_0042226e: the exclusive node (controller +4) runs first when its gate holds; a result of 1 ends the record's pass, anything else goes on with the chain, where the exclusive node
    // itself only gets its `ran` bit. A node returning 3 gets the exclusive node's update run again right away (when one is set and its gate holds; a result of 1 ends the chain, a
    // non-zero result marks it ran), and the chain CONTINUES with the next node: with no exclusive node a 3 is "ran, go on" like a 2 (z03PPH's ClimLadr, FUN_00542090).
    let first: BehaviourNode | null = null;
    if (c.exclusive && w.vars.gate(c.exclusive.var, c.exclusive.mask, c.exclusive.value)) {
      const r = c.exclusive.update(w, rec, c);
      first = c.exclusive;
      if (r === NODE_STOP) continue;   // no ran bit: the draw pass then only calls the exclusive node's hook (runDrawHooks)
    }
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      if (n === first) { c.ran[i] = true; continue; }
      if (!w.vars.gate(n.var, n.mask, n.value)) continue;
      const r = n.update(w, rec, c);
      if (r === NODE_NONE) continue;
      c.ran[i] = true;
      if (r === NODE_STOP) break;
      if (r === NODE_RERUN && c.exclusive && w.vars.gate(c.exclusive.var, c.exclusive.mask, c.exclusive.value)) {
        const r2 = c.exclusive.update(w, rec, c);
        if (r2 !== NODE_NONE) { c.ran[c.nodes.indexOf(c.exclusive)] = true; if (r2 === NODE_STOP) break; }
      }
    }
  }
}

/** pass 2: FUN_004225c5 */
export function prerenderPass(w: World) {
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c || !c.enabled) continue;     // FUN_004225c5: `piVar1[3] & 2`: a disabled controller (a cutscene actor with ENABLEAI off, flags bit 2 cleared) keeps its stale `ran` bits
    for (let i = 0; i < c.nodes.length; i++) {
      if (!c.ran[i]) continue;
      const n = c.nodes[i];
      n.prerender?.(w, rec, c);
      n.stamp = w.frame + 1;
    }
  }
  w.frame++;
}

/**
 * The per-record part of pass 3 (FUN_0042271b), the draw hooks. `hook(node)` calls a node's draw hook (default: `node.draw`) and returns its result, or `undefined` for a node without
 * one. Returns true when the record's default draw (FUN_00444480) must be skipped:
 *   * no controller / a disabled one (flags bit 2 clear): default draw;
 *   * no node ran this frame (the ran mask is 0): only an exclusive node (`ctrl.exclusive`, controller +4) with a draw hook is called, its result ignored and the default draw skipped;
 *     without one the default draw runs;
 *   * otherwise the hooks of the nodes that ran, in list order: result 1 = handled, stop; any other non-zero result = handled, go on; 0 = not handled, go on.
 * (DAT_009da5c8, the "frozen" switch of FUN_00422070, is never set by any code in the executable: the draw pass always runs.)
 */
export function runDrawHooks(w: World, rec: GameRecord, hook?: (n: BehaviourNode) => number | undefined): boolean {
  const c = rec.ctrl;
  if (!c || !c.enabled) return false;
  const call = hook ?? ((n: BehaviourNode) => n.draw?.(w, rec, c));
  let any = false;
  for (let i = 0; i < c.nodes.length; i++) if (c.ran[i]) { any = true; break; }
  if (!any) return c.exclusive ? call(c.exclusive) !== undefined : false;
  let handled = false;
  for (let i = 0; i < c.nodes.length; i++) {
    if (!c.ran[i]) continue;
    const r = call(c.nodes[i]);
    if (r === undefined) continue;
    if (r === 1) return true;
    if (r !== 0) handled = true;
  }
  return handled;
}

/** pass 3: FUN_0042271b. Calls `fallback(rec)` for records no node drew (the default mesh draw). */
export function drawPass(w: World, fallback: (rec: GameRecord) => void, hook?: (rec: GameRecord, n: BehaviourNode) => number | undefined) {
  for (const rec of w.records) {
    if (!runDrawHooks(w, rec, hook ? (n) => hook(rec, n) : undefined)) fallback(rec);
  }
}

/** FUN_00423ad4: destroy hooks of every node, controllers freed */
export function destroyNodes(w: World) {
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c) continue;
    for (const n of c.nodes) n.destroy?.(w, rec, c);
    rec.ctrl = null;
  }
}
