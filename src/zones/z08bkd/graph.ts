// The waypoint graph of the zone (FUN_005bb2da builds it from the compiled map `Waypoints/W_OTH_C.wpt`, map slot 1) and the walks over it used by the fish and the dolphin
// (FUN_005bb600 follows a closed loop, FUN_005bb588 / FUN_005bb3b0 search the cheapest path, FUN_005bb867 / 005bb919 / 005bb9eb look nodes up by tag).
// A graph node (0x54 bytes in the original): +0 position, +0xc neighbour count, +0x10 neighbours, +0x4c visited mark, +0x50 tag (starts as the node's group; -1 for link nodes).
import type { CompiledWaypoints } from '../../formats/waypoints.ts';
import { dist2 } from './math.ts';

export interface GraphNode { pos: [number, number, number]; nbr: number[]; visited: boolean; tag: number }

/** FUN_004639a7(map, a, b): is `b` the next hop from `a` (the compiled matrices hold the next hop of every pair of a group; a link node has the node it joins in its index field) */
export function adjacent(wp: CompiledWaypoints, a: number, b: number): boolean {
  const nb = wp.nodes[b], na = wp.nodes[a];
  if (nb.group < 0) return a === nb.index;
  if (na.group < 0) return na.index === b;
  const m = wp.matrices[na.group];
  const col = na.group === nb.group ? nb.index : nb.group + m.h;
  return m.hops[na.index * m.w + col] === b;
}

export class WaypointGraph {
  nodes: GraphNode[] = [];
  private best = 3e38;
  private bestPath: number[] = [];
  private acc = 0;
  private stack: number[] = [];

  /** FUN_005bb2da: every node of the map with its position, group and the list FUN_00462c48 gives (a link node: its single partner; else every adjacent node) */
  constructor(wp: CompiledWaypoints) {
    for (let i = 0; i < wp.nodes.length; i++) {
      const n = wp.nodes[i];
      const nbr: number[] = [];
      if (n.group < 0) nbr.push(n.index);
      else for (let c = 0; c < wp.nodes.length; c++) if (adjacent(wp, i, c)) nbr.push(c);
      this.nodes.push({ pos: [n.x, n.y, n.z], nbr, visited: false, tag: n.group });
    }
  }

  /** FUN_005bb867(tag): the first node carrying the tag, -1 when none */
  firstWithTag(tag: number): number { return this.nodes.findIndex((n) => n.tag === tag); }

  /** FUN_005bb919(tag, pos): the nearest node with the tag (squared distance), -1 when none */
  nearestWithTag(tag: number, pos: ArrayLike<number>): number {
    let best = 999999.9, idx = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.tag !== tag) continue;
      const d = dist2(pos, n.pos);
      if (d < best) { best = d; idx = i; }
    }
    return idx;
  }

  /** FUN_005bb9eb(tag): give every untagged (-1) node the tag; returns the (node, first neighbour) pairs of those nodes */
  tagUntagged(tag: number): number[] {
    const out: number[] = [];
    this.nodes.forEach((n, i) => { if (n.tag === -1) { n.tag = tag; out.push(i, n.nbr[0]); } });
    return out;
  }

  /**
   * FUN_005bb600(tag, firstNode, linkIndex, frac): the closed loop that starts at `firstNode`, leaves through its neighbour number `linkIndex` and keeps going to the neighbour that is
   * not the node it came from, until it is back at the neighbour it started with. Returns the node list, the index of the first node whose cumulative squared length reaches
   * frac * (total squared length) and that node.
   */
  loop(firstNode: number, linkIndex: number, frac: number): { path: number[]; index: number; node: number } {
    const goal = this.nodes[firstNode].nbr[linkIndex];
    const path: number[] = [];
    let cur = firstNode, prev = goal;
    while (cur !== goal) {
      path.push(cur);
      const n = this.nodes[cur];
      const next = n.nbr[0] === prev ? n.nbr[1] : n.nbr[0];
      prev = cur;
      cur = next;
      if (path.length > this.nodes.length) break;   // a path that never closes (never in the shipped data)
    }
    path.push(goal);
    const cum: number[] = [];
    let total = 0;
    for (let i = 0; i < path.length; i++) {
      cum.push(total);
      const a = this.nodes[path[i]], b = this.nodes[i + 1 === path.length ? path[0] : path[i + 1]];
      total = Math.fround(dist2(a.pos, b.pos) + total);
    }
    const want = Math.fround(total * frac);
    let index = path.length - 1;
    for (let i = 0; i < path.length; i++) if (want <= cum[i]) { index = i; break; }
    return { path, index, node: path[index] };
  }

  /**
   * FUN_005bb588(_, from, to): depth first over simple paths, keeping the one with the least sum of squared segment lengths (ties keep the first); a node that is reached as the goal
   * makes its parent stop trying further neighbours (the recursion returns 1), so it is not an exhaustive search. The route includes both ends.
   */
  route(from: number, to: number): number[] {
    this.best = 3e38;   // 0x47c34f80
    this.bestPath = [];
    this.acc = 0;
    this.stack = [];
    for (const n of this.nodes) n.visited = false;
    this.walk(from, to, 0);
    for (const n of this.nodes) n.visited = false;
    return this.bestPath.slice();
  }

  /** FUN_005bb3b0(node, step): returns true (1) when this node is the goal; the caller then stops trying its other neighbours */
  private walk(i: number, goal: number, step: number): boolean {
    const n = this.nodes[i];
    if (n.visited) return false;
    n.visited = true;
    this.acc = Math.fround(this.acc + step);
    this.stack.push(i);
    let hit = false;
    if (i === goal) {
      if (this.acc < this.best) { this.bestPath = this.stack.slice(); this.best = this.acc; }
      hit = true;
    } else {
      for (const j of n.nbr) {
        if (this.walk(j, goal, dist2(n.pos, this.nodes[j].pos))) break;
      }
    }
    this.acc = Math.fround(this.acc - step);
    this.stack.pop();
    n.visited = false;
    return hit;
  }
}
