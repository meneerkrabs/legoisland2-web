// Set-up of the jousting zone beyond what the generic extraction gives (pure, no DOM; the tests use it on a node-side `loadZone`): animation instances for the
// animated records (the builder FUN_005e628a creates them with FUN_0043b4e2(rig) and starts clip 1), the start clips of FUN_005cdb60, the hidden soldiers, the model
// attachments the duel removes / puts back, the executable's tables and the `DuelHost` that connects the duel with a world.
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import type { Model } from '../../formats/exe.ts';
import type { Pe } from '../../formats/exe.ts';
import { AnimInstance } from '../../game/anim.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { CAM, END_ROWS_VA, HIDDEN_SOLDIERS, NAMES, REC, RIG_OF, SPECTATORS, START_CLIPS, TABLE_ENEMY_VA, TABLE_PLAYER_VA, hexf, readClipTable } from './consts.ts';
import { JoustDuel, crtRng } from './duel.ts';
import type { DuelHost, DuelRng, DuelSound } from './duel.ts';

/** the records the zone needs, checked against the names the builder gave them */
export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(NAMES)) { const r = records[+i]; if (!r || r.name !== n) bad.push(`record ${i}: ${r?.name ?? 'missing'} (expected ${n})`); }
  return bad;
}

/**
 * every animated record gets an instance of its rig (clip 1, frame 0, as FUN_005e628a does), then FUN_005cdb60's start clips; the four soldiers are hidden (flags = 0).
 * Returns the instances by rig name.
 */
export function giveAnimations(world: World, archive: Archive): Map<string, Blk> {
  const rigs = new Map<string, Blk>();
  const rig = (n: string): Blk | null => {
    if (rigs.has(n)) return rigs.get(n)!;
    const e = archive.find(`anim/${n}.blk`);
    if (!e) return null;
    const b = parseBlk(archive.read(e));
    rigs.set(n, b);
    return b;
  };
  for (const [idx, name] of Object.entries(RIG_OF)) {
    const r = world.records[+idx];
    const b = rig(name);
    if (!r || !b) continue;
    r.anim = new AnimInstance(b);
    r.anim.start(1, 0);
  }
  for (const [recs, clip] of START_CLIPS) for (const i of recs) world.records[i].anim?.start(clip, 0);
  for (const i of HIDDEN_SOLDIERS) world.records[i].flags = 0;
  return rigs;
}

/** the executable's tables of the duel */
export function readTables(pe: Pe) {
  const fl = (va: number) => hexf(pe.u32(va));
  const end: number[][] = [];
  for (let r = 0; r < 8; r++) end.push([0, 4, 8, 12].map((o) => fl(END_ROWS_VA + r * 16 + o)));
  const n = pe.u32(CAM.splineCountVa);
  const points: number[][] = [];
  for (let i = 0; i < n; i++) points.push([0, 4, 8].map((o) => fl(CAM.splineVa + i * 12 + o)));
  return {
    player: readClipTable(pe, TABLE_PLAYER_VA), enemy: readClipTable(pe, TABLE_ENEMY_VA), end,
    spline: { points, end: [0, 4, 8].map((o) => fl(CAM.endOffsetVa + o)), follow: [0, 4, 8].map((o) => fl(CAM.followOffsetVa + o)), blend: fl(CAM.blendVa) },
  };
}

/** the knights' gear: the builder's attachments of slots 7 (lance) and 9 (shield) can be removed (FUN_0043e970) and put back (FUN_0043e930) per knight */
export class Gear {
  private saved = new Map<number, Map<number, Model['attach'][number]>>();
  private models = new Map<number, Model>();
  private readonly onChange: () => void;
  /** the world's records of the knights get a private copy of their model so the cached scene is never changed */
  constructor(recs: readonly GameRecord[], onChange: () => void) {
    this.onChange = onChange;
    for (const i of [REC.DRKK, REC.JKIT]) {
      const r = recs[i];
      if (!r.model) continue;
      const m: Model = { ...r.model, attach: [...r.model.attach] };
      r.model = m; this.models.set(i, m);
      const s = new Map<number, Model['attach'][number]>();
      for (const slot of [7, 9]) s.set(slot, m.attach[slot]);
      this.saved.set(i, s);
    }
  }
  set(rec: number, slot: number, on: boolean) {
    const m = this.models.get(rec), s = this.saved.get(rec)?.get(slot);
    if (!m) return;
    const cur = m.attach[slot];
    const want = on ? s : undefined;
    if (cur === want) return;
    m.attach[slot] = want as Model['attach'][number];
    this.onChange();
  }
  has(rec: number, slot: number) { return !!this.models.get(rec)?.attach[slot]; }
  /** the original builder's attachments back (the zone ended / restarts) */
  restore() { for (const [rec, s] of this.saved) for (const [slot, a] of s) { const m = this.models.get(rec); if (m) m.attach[slot] = a; } }
}

export interface DuelEnv {
  world: World;
  pe: Pe;
  sound: DuelSound;
  say(a: string, b?: string): void;
  stopSpeech(): void;
  gear: Gear | null;
  rng?: DuelRng;
}

/** the host the duel runs on: the world's records, camera and variables */
export function makeHost(env: DuelEnv): DuelHost {
  const tables = readTables(env.pe);
  return {
    recs: env.world.records,
    snd: env.sound,
    say: env.say,
    stopSpeech: env.stopSpeech,
    vars: env.world.vars,
    cam: env.world.camera.c,
    gear: (rec, slot, on) => env.gear?.set(rec, slot, on),
    tables: { player: tables.player, enemy: tables.enemy, end: tables.end },
    spline: tables.spline,
    rng: env.rng ?? crtRng,
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ behaviour nodes

/** `JSTGame` (constructor 0x5d1f64, record 4): update = FUN_005ce506, draw = FUN_005d1e8f (the default draw) */
export class JstGameNode implements BehaviourNode {
  readonly kind = 'JSTGame';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  duel: JoustDuel | null = null;
  ran = 0;
  /** the analogue stick (DAT_0098384c / DAT_00983850, -128..127): the input mapper has no stick yet, so it stays 0 (the tests set it); only read by the duel while no key is held */
  stick: [number, number] = [0, 0];
  update(w: World): number {
    if (!this.duel) return NODE_NONE;
    this.duel.dt = w.dt;
    this.duel.update(w.input.held, w.input.pressed, this.stick[0], this.stick[1]);
    this.ran++;
    return NODE_STOP;
  }
}
/** `Flag` (0x5d3e7c: records 5..10): the flags wave, FUN_0043b76a(anim, 1.0) every tick (FUN_005d3d90) */
export class FlagNode implements BehaviourNode {
  readonly kind = 'Flag';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  update(w: World, rec: GameRecord): number { rec.anim?.advance(1.0, w.dt); return NODE_STOP; }
}
/** `Anims` (0x5d3cc1: the eight spectators): FUN_005d3b80 advances the clip by 1.0 only while the duel's level (+0x44) is 1, 2 or 3 */
export class AnimsNode implements BehaviourNode {
  readonly kind = 'Anims';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  duel: (() => JoustDuel | null) = () => null;
  update(w: World, rec: GameRecord, _c: Controller): number {
    const d = this.duel();
    if (d && d.level >= 1 && d.level <= 3) rec.anim?.advance(1.0, w.dt);
    return NODE_STOP;
  }
}
/** `Drkk` (0x5d3ad4: record 11): update FUN_005d27e0 does nothing; its draw hook FUN_005d2814 draws the aim marker (the zone game's 2D layer) */
export class DrkkNode implements BehaviourNode {
  readonly kind = 'Drkk';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  update(): number { return NODE_STOP; }
}

/**
 * The restart of the zone (exit state 3: retry / pause menu "restart"): the original does not rebuild the node, FUN_00423532 calls the constructor FUN_005d1f64 with the existing node
 * (else branch: the two managers re-initialised, points and score reset, FUN_005d4860). Every node field that neither the constructor nor the round set-up writes keeps its value
 * (tools/tests/m7-z09JST-cover.mjs lists them from the oracle). Only `level` (+0x44) has a visible effect before it is overwritten: the `Anims` nodes advance the spectators' clips while it is
 * 1 .. 3, so after a retry the crowd's idle clips run until the next round's reset; the others are all written (clash, ride, popup, end of the tournament) before anything reads them. The port
 * rebuilds the zone, so these fields are carried over by hand.
 */
const CARRIED = ['level', 'variant', 'popup', 'rider', 'splineRate', 'splineT', 'aimSq', 'bonusSpeed', 'precision', 'roundPts', 'medal'] as const;
export const restartCarry: Partial<Record<(typeof CARRIED)[number], number>> = {};
/** remember the fields a restart keeps (the zone is left) */
export function rememberRestart(duel: JoustDuel) { for (const k of CARRIED) restartCarry[k] = duel[k]; }
/** put them back (`attempt` > 0 = the zone restarts in place) */
export function applyRestart(duel: JoustDuel, attempt: number) { if (attempt > 0) for (const k of CARRIED) { const v = restartCarry[k]; if (v !== undefined) duel[k] = v; } }

/** FUN_005ce1c6: the camera of the intro / help (eye and target literals) */
export const INTRO_CAMERA = [0x41dbf766, 0x41a00069, 0xc2a66b44, 0x43506c4a, 0x418de4f7, 0xc29e3b4a].map(hexf);

/**
 * the whole zone set-up of the zone game (and of the tests): animations, focus record, gear, the duel with its host, the nodes of the set-up bound to it, the camera of the intro.
 * `throwOnBad`: the record names are checked first.
 */
export function startDuel(env: Omit<DuelEnv, 'gear'> & { archive: Archive; onGear?: () => void }) {
  const { world } = env;
  const bad = checkRecords(world.records);
  if (bad.length) throw new Error(`z09JST: ${bad.join('; ')}`);
  giveAnimations(world, env.archive);
  world.focus = world.records[REC.JKIT];                      // DAT_009da5d8 = records + 0x618 + 0xc
  const gear = new Gear(world.records, env.onGear ?? (() => {}));
  const host = makeHost({ ...env, gear });
  const duel = new JoustDuel(host);
  duel.dt = world.dt;                                          // DAT_008b1718; the JSTGame node refreshes it every tick
  const node = world.records[REC.LAND].ctrl?.find<JstGameNode>('JSTGame') ?? null;
  if (node) node.duel = duel;
  for (const i of SPECTATORS) { const a = world.records[i].ctrl?.find<AnimsNode>('Anims'); if (a) a.duel = () => duel; }
  for (let i = 0; i < 6; i++) world.camera.c[i] = INTRO_CAMERA[i];
  world.camera.updateView(); world.camera.savePrev();
  return { duel, node, gear, host };
}
