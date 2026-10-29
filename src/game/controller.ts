// Controllers and behaviour nodes (docs/re/architecture.md 4.2). A record may own a controller; the controller holds a list of nodes; a node
// runs only while a game variable satisfies (var & mask) == value (mask 0 / value 0 = always). Three passes per frame:
//   1. update (FUN_0042226e)     run the nodes of every record with an enabled controller; the return code of a node decides what happens next
//   2. pre-render (FUN_004225c5) the pre-render hook of the nodes that ran, then the frame counter (DAT_009da5cc) advances
//   3. draw (FUN_0042271b)       the draw hook of the nodes that ran (1 = handled and stop, other non-zero = handled); the default mesh draw otherwise
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';

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
    if (focus) { const dx = rec.x - focus.x, dz = rec.z - focus.z; c.distSq = dx * dx + dz * dz; }
    c.ran.length = 0;
    let rerun = false;
    if (c.exclusive && w.vars.gate(c.exclusive.var, c.exclusive.mask, c.exclusive.value)) {
      const r = c.exclusive.update(w, rec, c);
      if (r !== NODE_NONE) c.ran[c.nodes.indexOf(c.exclusive)] = true;
      if (r !== NODE_NONE) continue;
    }
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      if (!w.vars.gate(n.var, n.mask, n.value)) continue;
      const r = n.update(w, rec, c);
      if (r === NODE_NONE) continue;
      c.ran[i] = true;
      if (r === NODE_STOP) break;
      if (r === NODE_RERUN) { rerun = true; break; }
    }
    if (rerun && c.exclusive) { const r = c.exclusive.update(w, rec, c); if (r === NODE_NONE) c.ran[c.nodes.indexOf(c.exclusive)] = false; }
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

/** pass 3: FUN_0042271b. Calls `fallback(rec)` for records no node drew (the default mesh draw). */
export function drawPass(w: World, fallback: (rec: GameRecord) => void) {
  for (const rec of w.records) {
    const c = rec.ctrl;
    let handled = false;
    if (c && c.enabled) {     // FUN_0042271b: a disabled controller takes the default draw
      for (let i = 0; i < c.nodes.length; i++) {
        if (!c.ran[i]) continue;
        const r = c.nodes[i].draw?.(w, rec, c) ?? 0;
        if (r !== 0) { handled = true; if (r === 1) break; }
      }
    }
    if (!handled) fallback(rec);
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
