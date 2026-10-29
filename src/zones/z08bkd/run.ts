// The set-up of one run of the zone, DOM-free (node tests and the zone game both use it): the animation rigs (FUN_005ca0a5 / the binding block after FUN_005c2940),
// the waypoint graph (FUN_005b9430: FUN_004630c0(1, W_OTH) + FUN_005bb2da), the hurt zones (FUN_005ba570), the nodes' constructors' second halves, the swaying plants
// (FUN_005b8ac0 / FUN_005b8d97) and the sounds.
import type { Archive } from '../../formats/archive.ts';
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Model, ZoneScene } from '../../formats/exe.ts';
import { parseCompiledWaypoints } from '../../formats/waypoints.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { SoundBank } from '../parachute/sound.ts';
import type { SoundBackend } from '../parachute/sound.ts';
import { REC, RIG_OF_RECORD, SND, SOUNDS_3D, VAR, WEED_RATE, WEED_START_FRAMES } from './consts.ts';
import { BkdNode } from './env.ts';
import type { Env, SoundName } from './env.ts';
import { WaypointGraph } from './graph.ts';
import { HurtZones } from './hurt.ts';
import { Rng, ZoneClock } from './math.ts';
import { BkdState } from './state.ts';

/** the record names the code relies on (the builder FUN_005c2940's order); checked at set-up */
export const RECORD_NAMES: Record<number, string> = {
  1: 'LAND', 2: 'SHRK', 3: 'DLPH', 4: 'MANT', 5: 'PEPP', 6: 'SKEL', 16: 'SORD', 17: 'WEED', 21: 'PIRO', 25: 'OCTO', 26: 'WEET', 32: 'WEID', 42: 'SOR1', 43: 'SEAE',
  51: 'BRK1', 52: 'CTOP', 53: 'CBOT', 54: 'ANCH', 56: 'BLA1', 57: 'CBAR', 67: 'BLA0', 69: 'OCTC', 72: 'OCTH', 82: 'PAG5', 83: 'BRT1', 87: 'BRT5', 89: 'BRK2', 92: 'BRK5',
};
export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(RECORD_NAMES)) if (records[+i]?.name !== n) bad.push(`record ${i} is ${records[+i]?.name}, expected ${n}`);
  return bad;
}

/** the sound slot table of the zone (FUN_005cd0d0): name -> id and kind */
export const SOUND_DEFS = Object.fromEntries(Object.entries(SND).map(([name, id]) => [name, { id, kind: SOUNDS_3D.includes(id) ? '3d' as const : '2d' as const }])) as Record<SoundName, { id: number; kind: '2d' | '3d' }>;

/** constructors register their node here in call order (= the attach order of FUN_005b9430); `prepareBkd` binds them in that order */
let sequence = 0;
export const created = new Map<BehaviourNode, number>();
export function track<T extends BehaviourNode>(n: T): T { created.set(n, sequence++); return n; }

export interface BkdRun {
  env: Env;
  state: BkdState;
  clock: ZoneClock;
  sound: SoundBank<SoundName>;
  nodes: BkdNode[];
  /** ticks of mode 2 run so far (the fish move as a function of this alone: bots and tests predict them) */
  ticks: number;
  /** before the update pass of a tick of mode 2: FUN_005baf8f + FUN_005ba5d7 */
  beforeTick(): void;
  /** after the pre-render pass: the plants (FUN_005b8d97) and the HUD / clock update (FUN_005b92d3) */
  afterTick(): void;
  /** 0 running, 1 all bricks delivered, 2 out of time (FUN_005b8fa4 / FUN_005b8ffa) */
  result(): number;
}

/** the plain-data view of a run the bots and the tests decide from (the zone game's `debug()` adds the shell's variables) */
export function snapshot(run: BkdRun) {
  const { env, state } = run;
  const R = env.records;
  const rec = R[REC.PEPP];
  const d = env.nodeOf<import('./diver.ts').DiverNode>(rec);
  const flying = REC.BALLS.filter((i) => env.nodeOf<import('./bodies.ts').BallNode>(R[i]).active);
  return {
    ticks: run.ticks, elapsed: state.elapsed, percent: state.percentLeft(), bricks: state.bricks, page: state.page, score: state.score(), result: run.result(),
    pos: [rec.x, rec.y, rec.z] as [number, number, number], heading: d.w.heading, angVel: d.w.angVel, vel: [d.w.vx, d.w.vy] as [number, number],
    held: d.held?.index ?? -1, stun: d.stun, view: d.view, shape: d.shape,
    /** [x, y, still there, record] of the five bricks, the page */
    brickList: REC.BRICKS.map((i) => [R[i].x, R[i].y, (R[i].flags & 2) !== 0 ? 1 : 0, i] as [number, number, number, number]),
    pageAt: (R[REC.PAGE].flags & 2) !== 0 ? ([R[REC.PAGE].x, R[REC.PAGE].y] as [number, number]) : null,
    /** seconds until the cannon's next shot (it only counts down while the diver is in its range) */
    cannon: env.nodeOf<import('./bodies.ts').CannonNode>(R[REC.CANNON]).timer,
    /** the cannon balls in flight: [x, y, velocity x, velocity y (units / s)] */
    balls: flying.map((i) => [R[i].x, R[i].y, env.nodeOf<import('./bodies.ts').BallNode>(R[i]).b.vx, env.nodeOf<import('./bodies.ts').BallNode>(R[i]).b.vy] as [number, number, number, number]),
    /** the creatures that hurt: [x, y, velocity x, velocity y (units / s), radius of the anchor sphere, category]; the pirates only once the last brick is taken */
    hazards: env.hurt.entries.filter((e) => e.category !== 4 || env.nodeOf<import('./bodies.ts').PirateNode>(e.rec).alerted).map((e) => [e.rec.x, e.rec.y, (e.rec.m[12] - e.rec.prev[12]) * 30, (e.rec.m[13] - e.rec.prev[13]) * 30, e.tpl.anchorRadius, e.category] as [number, number, number, number, number, number]),
  };
}

export interface PrepareOptions {
  /** the sound engine (null: silent) */
  backend?: SoundBackend | null;
  /** FUN_00439bf8 + FUN_00435a11: speak a line */
  speak?: (id: string) => void;
  /** FUN_0043e930 / FUN_0043e970 at run time (the renderer's `setAttach`) */
  attach?: Env['setAttach'];
  seed?: number;
}

export function prepareBkd(world: World, archive: Archive, scene: ZoneScene, o: PrepareOptions = {}): BkdRun {
  const records = world.records;
  const bad = checkRecords(records);
  if (bad.length) throw new Error(`z08BKD: ${bad.join('; ')}`);

  // the player's controller keeps only the zone's own nodes (the stub set-up adds the walk / swim chain of the island)
  const pepper = records[REC.PEPP];
  if (pepper.ctrl) pepper.ctrl.nodes = pepper.ctrl.nodes.filter((n) => n instanceof BkdNode);

  // animation rigs: every animated record starts clip 1 at frame 0 (FUN_0043b4e2(rig, 1) + FUN_0043b6a3(anim, 1, 0))
  const rigs = new Map<string, Blk>();
  const rig = (name: string): Blk | null => {
    if (!rigs.has(name)) { const e = archive.find(`anim/${name}.blk`); if (e) rigs.set(name, parseBlk(archive.read(e))); }
    return rigs.get(name) ?? null;
  };
  for (const [i, name] of Object.entries(RIG_OF_RECORD)) {
    const b = rig(name), r = records[+i];
    if (b && r) { r.anim = new AnimInstance(b); r.anim.start(1, 0); r.anim.prevFrame = 0; r.anim.prevClip = 1; }
  }
  // FUN_005b8ac0: the plants sway out of step
  for (const [i, frame] of WEED_START_FRAMES) records[i].anim?.seek(frame);

  const wp = archive.find('waypoints/W_OTH_C.wpt');
  if (!wp) throw new Error('z08BKD: no waypoints/W_OTH_C.wpt');
  const graph = new WaypointGraph(parseCompiledWaypoints(archive.read(wp)));
  const hurt = new HurtZones();
  hurt.registerAll(records);
  const state = new BkdState();
  state.records = records;
  state.speak = o.speak ?? (() => { /* silent */ });
  const clock = new ZoneClock();
  const rng = new Rng(o.seed ?? 20011);
  const sound = new SoundBank<SoundName>(SOUND_DEFS, o.backend ?? null);
  void sound.load();
  const bank = scene.models.filter((m: Model) => m.array === 'g983838+44').sort((a, b) => a.index - b.index);
  world.vars.set(VAR.GOT_PAGE, 0);

  const env: Env = {
    world, records, clock, rng, graph, hurt, state, sound, bank,
    setAttach: o.attach ?? (() => { /* no renderer */ }),
    nodeOf: <T extends BehaviourNode>(rec: GameRecord) => rec.ctrl!.nodes[0] as T,
  };
  // bind the nodes in the order the constructors ran
  const nodes: BkdNode[] = [];
  for (const rec of records) for (const n of rec.ctrl?.nodes ?? []) if (n instanceof BkdNode) nodes.push(n);
  nodes.sort((a, b) => (created.get(a) ?? 0) - (created.get(b) ?? 0));
  const seen = new Set<BkdNode>();
  for (const n of nodes) {
    if (seen.has(n)) continue;
    seen.add(n);
    const owner = records.find((r) => r.ctrl?.nodes.includes(n))!;
    n.bind(env, owner);
  }
  for (const n of nodes) created.delete(n);

  const weeds = WEED_START_FRAMES.map(([i]) => records[i]);
  const run: BkdRun = {
    env, state, clock, sound, nodes, ticks: 0,
    beforeTick() { clock.tick(world.dt); hurt.update(); run.ticks++; },
    afterTick() {
      for (const w of weeds) w.anim?.advance(WEED_RATE, world.dt);
      state.tickHud(clock.dt);
    },
    result() { return state.over() ? (state.success() ? 1 : 2) : 0; },
  };
  return run;
}
