// What the zone's behaviour nodes share (the globals of the original: record array, waypoint graph, hurt zones, the zone state, sounds ...). The nodes are created
// by `registerCtor` while the scene is set up (before the zone game exists); the zone game binds them to an `Env` right after (`BkdNode.bind` = the rest of the
// original's constructors) so that they can reach the archive-dependent parts (the waypoint graph).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Model } from '../../formats/exe.ts';
import type { SoundBank } from '../parachute/sound.ts';
import type { SND } from './consts.ts';
import type { WaypointGraph } from './graph.ts';
import type { HurtZones } from './hurt.ts';
import type { BkdState } from './state.ts';
import type { Rng, ZoneClock } from './math.ts';

export type SoundName = keyof typeof SND;

export interface Env {
  world: World;
  records: GameRecord[];
  clock: ZoneClock;
  rng: Rng;
  graph: WaypointGraph;
  hurt: HurtZones;
  state: BkdState;
  sound: SoundBank<SoundName>;
  /** the models of the part bank (FUN_0043eaf0(DAT_00983838 + 0x2c, i)): 0 airtank, 1 mask, 2 right hand, 3 brick, 4 ZRRTZZ, 5 mask, 6 / 7 the skeleton's hands, 8 left hand */
  bank: Model[];
  /** FUN_0043e930(record's model, child, bone, slot): the model attached to a slot of a record (null: FUN_0043e970 detaches it) */
  setAttach(rec: GameRecord, slot: number, bone: number, child: Model | null): void;
  /** the node of a record (the first node of its controller, like `**(rec + 0x5c)`) */
  nodeOf<T extends BehaviourNode>(rec: GameRecord): T;
}

export abstract class BkdNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  protected env!: Env;
  /** the part of the original's constructor that needs the zone (waypoint graph, records of other nodes); called once by the zone game in attach order */
  bind(env: Env, rec: GameRecord): void { this.env = env; void rec; }
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}
