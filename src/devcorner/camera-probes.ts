// Section 4 "Camera en tekenen", part 2b: what feeds the debug-draw queue (camera-draw.ts) in the port.
//
// The original's dormant callers of FUN_00445ba0 / FUN_00445c70 (docs/re/unused.md 6.6) and what the port can show of them:
//   probe      ground-normal probes: FUN_00429e00 (LE2.c:20573 / 20644, Pepper's walk node, every tick), FUN_0048e1b0 (LE2.c:67891 / 67964, the skateboard): two lines white -> black and red -> green
//              between the four ground probes.   port: `CollisionWorld.debug` (a null-by-default sink, called by WalkNode.alignToGround and the skate node's alignToGround).
//              (FUN_00432820 at LE2.c:24570 / 24626 is the dead 4-point probe, 0 callers, nothing in the port to call it.)
//   collision  FUN_00440ac0 (LE2.c:34864-34875, called by the box shape's sweep FUN_00440f30 when it hits): the 12 edges of the box that was hit, white.   port: the same sink, called by
//              CollisionWorld.box when an analytic box (shape 3) becomes the best hit.
//   camera     FUN_0042c227 (LE2.c:22021): FUN_00445c70(target + (0, 1, 0), 1, 3.0, green): a green + of size 3 at the chase camera's target, every tick.   port: wraps `ChaseCamera.chase`.
//   graph      FUN_005bbb62 (z08BKD, 0 callers): the waypoint graph: every node a green X of size 0.5 (type 0, r 0x3f000000), white lines to its neighbours.   port: the maps `Waypoints/W_<MAP>_C.wpt`
//              of the zone's archive with the neighbour rule of FUN_005bb2da (z08bkd/graph.ts); z08BKD = original (its graph is the OTH map), every other zone = extension.
//   bkd        FUN_005babc9 (z08BKD, 0 callers): closed white polygons of the body quads (the diver, bricks, cannon balls), red X at the hurt-zone anchors (r = anchor radius), blue X at the hurt spheres.
//   zone       FUN_00537689 (island speeder: the obstacle segment blue -> red and white X markers at both ends, LE2.c:91188 / 91212), FUN_006c2627 (z20DSP speedster: the two side probes white / blue,
//              LE2.c:176990 / 176994), FUN_007e5448 (z40OGL slugs: the three feeler lines, LE2.c:246400 / 246422 / 246441), FUN_007e6542 (z40OGL citizens: a magenta X of size 3 at every citizen,
//              LE2.c:246986).   port: the same sink, called by those nodes.
// Not ported: FUN_00442a70 (LE2.c:36207-36214: the 8 lines of a pyramid probe, but both callers pass `draw = 0`: it never draws), FUN_00432820 (the dead 4-point probe, 0 callers), the per-point
//   list DAT_022e5914 (DAT_05cb5890 is never set), the screen-space lines (mode != 0: z08BKD's own 2D UI).
import type { DebugSink } from '../game/collision.ts';
import type { Archive } from '../formats/archive.ts';
import type { RunCtx, ZoneRun } from './types.ts';
import { DebugQueue } from './camera-draw.ts';
import { WaypointGraph } from '../zones/z08bkd/graph.ts';
import { parseCompiledWaypoints } from '../formats/waypoints.ts';
import { MAP_NAMES } from '../game/walker.ts';

export type Origin = 'origineel' | 'uitbreiding' | 'niet geport' | 'z08BKD origineel, elders uitbreiding';
export interface Category { tag: string; label: string; origin: Origin; note: string; on: boolean }

export function makeCategories(): Category[] {
  return [
    { tag: 'probe', label: 'Grondsondes (Pepper, skateboard)', origin: 'origineel', on: false, note: 'FUN_00429e00 (LE2.c:20573, 20644), FUN_0048e1b0 (67891, 67964): twee lijnen wit-zwart en rood-groen tussen de vier grondmetingen, elke tick' },
    { tag: 'collision', label: 'Geraakte botsingsdoos', origin: 'origineel', on: false, note: 'FUN_00440f30 -> FUN_00440ac0 (34864-34875): de 12 ribben van de doos die een sweep raakt, wit (alleen analytische dozen, shape 3)' },
    { tag: 'camera', label: 'Doel van de volgcamera', origin: 'origineel', on: false, note: 'FUN_0042c227 (LE2.c:22021): groen plusteken, grootte 3, op doel + (0, 1, 0)' },
    { tag: 'graph', label: 'Waypoint-graaf', origin: 'z08BKD origineel, elders uitbreiding', on: false, note: 'FUN_005bbb62 (z08BKD, 0 aanroepers): groene X (0,5) op elk punt, witte lijnen naar de buren. In z08BKD origineel (de OTH-kaart); in elke andere zone met kaart een uitbreiding.' },
    { tag: 'bkd', label: 'z08BKD: botsvlakken en schadebollen', origin: 'origineel', on: false, note: 'FUN_005babc9 (0 aanroepers): witte veelhoeken van de lichamen, rode X bij de ankers, blauwe X bij de schadebollen. Stenen en ballen: bij benadering (uit hun positie berekend, alleen als actief).' },
    { tag: 'zone', label: 'Zone-sondes (autos, Speedster, slakken, burgers)', origin: 'origineel', on: false, note: 'FUN_00537689 (91188, 91212), FUN_006c2627 (176990, 176994), FUN_007e5448 (246400-246441), FUN_007e6542 (246986): lijnen en X-markeringen van de eilandauto, de zijsondes van de Speedster (z20DSP), de slakken en de burgers van z40OGL' },
  ];
}

/** the facts for the UI list "niet geport" */
export const NOT_PORTED: { what: string; why: string }[] = [
  { what: 'FUN_00442a70 (LE2.c:36207-36214)', why: 'de acht lijnen van een piramide-sonde, maar beide aanroepers (FUN_004686a3 58933, FUN_007d3187 240808) geven draw = 0 mee: tekent nooit' },
  { what: 'FUN_00432820 (LE2.c:24570, 24626)', why: 'de dode 4-puntssonde: 0 aanroepers, de port heeft er geen tegenhanger van (alleen de levende FUN_00429e00 hierboven)' },
  { what: 'puntenlijst DAT_022e5914', why: 'DAT_05cb5890 wordt nooit gezet en de lijst wordt nergens gevuld' },
  { what: 'schermlijnen (modus != 0, FUN_0087da91)', why: 'alleen z08BKD gebruikt ze voor zijn 2D-UI (FUN_005d2814); de port tekent die UI zelf. De wachtrij telt ze wel.' },
];

/** the sink the shared code calls: filters by category and forwards to the queue (box = FUN_00440ac0's 12 lines) */
export class ProbeSink implements DebugSink {
  private q: DebugQueue; private on: (tag: string) => boolean;
  constructor(q: DebugQueue, on: (tag: string) => boolean) { this.q = q; this.on = on; }
  line(tag: string, a: ArrayLike<number>, b: ArrayLike<number>, c0: number, c1: number) { if (this.on(tag)) this.q.line(a, b, c0, c1, tag); }
  shape(tag: string, pos: ArrayLike<number>, type: number, r: number, color: number) { if (this.on(tag)) this.q.shape(pos, type, r, color, tag); }
  box(tag: string, m: ArrayLike<number> | null, c: ArrayLike<number>, h: ArrayLike<number>, color: number) {
    if (!this.on(tag)) return;
    // FUN_00440ac0: the corners (p0 .. p3 at z - hz, p4 .. p7 at z + hz), moved by the record's matrix (FUN_0043ab72: v * M + translation) when there is one
    const lo = [c[0] - h[0], c[1] - h[1], c[2] - h[2]], hi = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
    const raw = [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]], [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]];
    const P = m ? raw.map((p) => [0, 1, 2].map((k) => p[0] * m[k] + p[1] * m[4 + k] + p[2] * m[8 + k] + m[12 + k])) : raw;
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) this.q.line(P[i], P[j], color, color, tag);
  }
}

/** the waypoint maps of the zone's archive as graphs (FUN_005bb2da's neighbour rule): slot, name, nodes */
export interface GraphMap { slot: number; name: string; graph: WaypointGraph }
export function loadGraphs(archive: Archive): GraphMap[] {
  const out: GraphMap[] = [];
  MAP_NAMES.forEach((name, slot) => {
    const e = archive.find(`Waypoints/W_${name}_C.wpt`);
    if (!e) return;
    try { out.push({ slot, name, graph: new WaypointGraph(parseCompiledWaypoints(archive.read(e))) }); } catch { /* an invalid map: the original refuses it as well (count 0) */ }
  });
  return out;
}

/** node colours: the original's green for the zone's own map; the extension colours the other maps */
export const GRAPH_COLORS: Record<string, number> = { ROAD: 0xffffff00, PATH: 0xff00ff00, CSM: 0xff00ffff, OTH: 0xff00ff00 };

/**
 * FUN_005bbb62 for one map: every node a type-0 marker of size 0x3f000000 (0.5) in green, then white lines to each neighbour; `range` limits the drawing to nodes within that distance of `eye`
 * (Infinity = all, like the original); `maxLines` is a safety cap for the renderer. Returns the numbers of nodes and lines queued.
 */
export function queueGraph(q: DebugQueue, map: GraphMap, eye: ArrayLike<number>, range: number, tag = 'graph'): { nodes: number; links: number } {
  let nodes = 0, links = 0;
  const r2 = range * range;
  const col = GRAPH_COLORS[map.name] ?? 0xff00ff00;
  const ns = map.graph.nodes;
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    const dx = n.pos[0] - eye[0], dy = n.pos[1] - eye[1], dz = n.pos[2] - eye[2];
    if (range !== Infinity && dx * dx + dy * dy + dz * dz > r2) continue;
    q.shape(n.pos, 0, 0.5, col, tag); nodes++;
    for (const k of n.nbr) { const m = ns[k]; if (m) { q.line(n.pos, m.pos, 0xffffffff, 0xffffffff, tag); links++; } }
  }
  return { nodes, links };
}

/** the zone run narrowed to what the graph needs */
export const isZone = (r: RunCtx): r is ZoneRun => r.kind === 'zone';
