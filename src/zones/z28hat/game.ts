// z28HAT: what the zone's set-up does after the records are built (FUN_007a6bf3 loads the animation rigs, FUN_00791990 attaches the nodes and writes the nest of the baby
// dinosaurs): `prepareHat` runs the nodes' constructor effects in the order of the attach calls and returns the shared state. Pure (no DOM): node tests call it.
import { parseBlk, parseMan } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { V } from '../../game/vars.ts';
import { SoundBank } from '../parachute/sound.ts';
import type { SoundBackend } from '../parachute/sound.ts';
import { HAT_KEY, HAT_SOUNDS, HatShared, REC, VAR, WINCH, checkRecords, findRecords } from './rules.ts';
import type { HatSound } from './rules.ts';
import { BABY_START_FRAME, mouthOf, HatBalloon, HatBaby, HatBronty, HatDino, HatFireball, HatMrHates, HatPepp, HatPtera, HatSandbag, HatWinch, fx } from './nodes.ts';

/** the rig of each animated record (FUN_007a6bf3 loads the seven rigs, 0x7adc76 onwards gives a record each an instance started on clip 1) */
export const RIGS: { rec: number; rig: string }[] = [
  { rec: REC.PEPP, rig: 'MFIG' }, { rec: REC.HATE, rig: 'MFIG' }, { rec: REC.BRON, rig: 'BRON' },
  { rec: REC.DINOS[0], rig: 'STEG' }, { rec: REC.BABIES[0], rig: 'BREX' }, { rec: REC.DINOS[2], rig: 'STEG' }, { rec: REC.DINOS[3], rig: 'TRIC' },
  { rec: REC.DINOS[5], rig: 'TREX' }, { rec: REC.DINOS[1], rig: 'STEG' }, { rec: REC.DINOS[4], rig: 'TRIC' }, { rec: REC.PTER, rig: 'PTER' },
  { rec: REC.BABIES[1], rig: 'BREX' }, { rec: REC.BABIES[2], rig: 'BREX' }, { rec: REC.BABIES[3], rig: 'BREX' }, { rec: REC.BABIES[4], rig: 'BREX' }, { rec: REC.HOLO, rig: 'MFIG' },
];

export interface HatNodes {
  pepp: HatPepp; balloon: HatBalloon; bronty: HatBronty; winch: HatWinch; hates: HatMrHates;
  dinos: HatDino[]; babies: HatBaby[]; fireball: HatFireball; sandbags: HatSandbag[]; ptera: HatPtera;
}

/** the sound bank of the zone (FUN_00792950); the backend is the audio engine's `sfx` or null (tests) */
export const hatSounds = (backend: SoundBackend | null) => new SoundBank<HatSound>(HAT_SOUNDS, backend);

/**
 * The state the zone's constructors leave: animation instances, the nodes' constructor effects (the balloon over the drop zone, the hook under it, the camera, the
 * pterodactyl, Bronty's heading ...), the nest of the babies = REX1's place (FUN_00791990), var 0xfa cleared, the player's own node chain replaced by the rider's node.
 */
export function prepareHat(world: World, archive: Archive | null, sound: SoundBank<HatSound>, opts: { total?: number } = {}): { shared: HatShared; nodes: HatNodes } {
  const bad = checkRecords(world.records);
  if (bad.length) throw new Error(`z28HAT: ${bad.join('; ')}`);
  const recs = findRecords(world.records);
  const S = new HatShared(recs, sound);
  if (opts.total !== undefined) S.total = opts.total;
  world.ext.set(HAT_KEY, S);
  const nodeOf = <T>(rec: GameRecord, kind: string): T => {
    const n = rec.ctrl?.nodes.find((x) => x.kind === kind);
    if (!n) throw new Error(`z28HAT: record ${rec.name} has no ${kind} node (the set-up's attaches are not registered)`);
    return n as unknown as T;
  };
  // animation instances (the port gives only the player one when it builds the world)
  if (archive) {
    const rigs = new Map<string, Blk | null>();
    const rig = (n: string): Blk | null => {
      if (!rigs.has(n)) { const e = archive.find(`anim/${n}.blk`); rigs.set(n, e ? parseBlk(archive.read(e)) : null); }
      return rigs.get(n)!;
    };
    for (const { rec, rig: name } of RIGS) {
      const r = world.records[rec];
      const blk = rig(name);
      if (!r || !blk) continue;
      if (!r.anim) r.anim = new AnimInstance(blk);
      r.anim.start(1, 0);
    }
    for (const [i, f] of Object.entries(BABY_START_FRAME)) world.records[+i]?.anim?.seek(f);
  }
  // the player's chain is the rider's node only (the set-up's M1 walk / swim stub is not part of this zone)
  const pep = recs.pepp;
  const pepp = nodeOf<HatPepp>(pep, 'hatpepp');
  pep.ctrl!.nodes = [pepp];
  pep.ctrl!.exclusive = null;
  // FUN_00791990 end: the babies' nest = REX1's start place
  S.nest = [recs.babies[0].x, recs.babies[0].y, recs.babies[0].z];
  const balloon = nodeOf<HatBalloon>(recs.hotb, 'hatballoon');
  const bronty = nodeOf<HatBronty>(recs.bron, 'hatbronty');
  const winch = nodeOf<HatWinch>(recs.winch, 'hatwinch');
  const hates = nodeOf<HatMrHates>(recs.hate, 'hatmrhates');
  const dinos = recs.dinos.map((r) => nodeOf<HatDino>(r, 'hatdino'));
  const babies = recs.babies.map((r) => nodeOf<HatBaby>(r, 'hatbaby'));
  const fireball = nodeOf<HatFireball>(recs.frb1, 'hatfireball');
  const sandbags = recs.sandbags.map((r) => nodeOf<HatSandbag>(r, 'hatsandbag'));
  const ptera = nodeOf<HatPtera>(recs.pter, 'hatptera');
  // constructor effects, in the order of FUN_00791990's attach calls
  pepp.init(world, pep);
  balloon.init(world, recs.hotb);
  bronty.init(world, recs.bron);
  winch.init(world, recs.winch);
  recs.dinos.forEach((r, i) => dinos[i].init(world, r));
  recs.babies.forEach((r, i) => babies[i].init(world, r));
  fireball.init(world);
  sandbags.forEach((n) => n.init());
  ptera.init(world, recs.pter);
  world.vars.set(VAR.WINCH, WINCH.TOP);
  world.vars.set(V.PEPPERSSHADOW, 4);      // FUN_00790fc0 sets var 0xc5 = 4 before its cutscenes: the blob shadow type
  if (archive) {
    const e = archive.find('matanim/Food.man');
    if (e) { try { bronty.food = parseMan(archive.read(e)); } catch (err) { console.warn('Food.man', err); } }
  }
  fx.rumble = 0; fx.fireball.length = 0;
  S.winchLast = 0; S.brontyVar = 0;
  return { shared: S, nodes: { pepp, balloon, bronty, winch, hates, dinos, babies, fireball, sandbags, ptera } };
}
/** the state a scripted player decides from (tools/lib/hat-bot.mjs): plain data */
export function hatSnapshot(world: World) {
  const S = world.ext.get(HAT_KEY) as HatShared;
  const R = S.recs;
  const at = (r: GameRecord) => ({ x: r.x, y: r.y, z: r.z, on: (r.flags & 2) !== 0 });
  const st = (r: GameRecord) => ({ ...at(r), state: (r.ctrl?.nodes[0] as unknown as { state?: number })?.state ?? -1 });
  const sandbag = (r: GameRecord) => ({ ...at(r), active: (r.ctrl?.nodes[0] as unknown as { active?: boolean })?.active ?? false });
  const m = mouthOf(R.bron);
  return {
    balloon: { ...at(R.hotb), fx: R.hotb.fx, fz: R.hotb.fz }, hook: at(R.winch), bronty: at(R.bron), mouth: m ? { x: m[12], y: m[13], z: m[14] } : null, drop: at(R.drop), nest: { x: S.nest[0], y: S.nest[1], z: S.nest[2] }, fireball: at(R.frb1),
    dinos: R.dinos.map(st), babies: R.babies.map(st), sandbags: R.sandbags.map(sandbag),
    winch: world.vars.get(VAR.WINCH), brontyState: world.vars.get(VAR.BRONTY), control: world.vars.get(VAR.CONTROL),
    score: S.score, delivered: S.delivered, total: S.total, allDone: S.allDone, carrying: S.carrying, result: S.result, mom: [...S.mom], eatCount: S.eatCount, fade: S.fade,
  };
}

/**
 * FUN_007928a0 (the loop's per-tick part after the update pass): the HUD strings (score, dinosaurs left), and `DAT_05d5d32d` = every dinosaur is counted
 * (the sandbags work from the next tick). Returns the game's result (0 running, 1 won, 2 lost) for the loop (`DAT_05d5d2cc`).
 */
export function hatUpdate(world: World): { score: string; left: string; leftIcon: number; result: number } {
  const S = world.ext.get(HAT_KEY) as HatShared;
  if (S.total <= S.delivered) S.allDone = true;
  return { score: String(S.score), left: String(S.total - S.delivered), leftIcon: S.allDone ? 2 : -1, result: S.result };
}
