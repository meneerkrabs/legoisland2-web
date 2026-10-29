// z27TRX: what the zone set-up code leaves behind (FUN_0076649a: every record's behaviour by its name, FUN_00766b85 / FUN_00766e19: the first camera, the animation
// rigs the builder FUN_0076b230 binds), as one function the zone game and the node tests share. Pure TypeScript.
import type { Pe, Model } from '../../formats/exe.ts';
import type { Blk } from '../../formats/anim.ts';
import { AnimInstance } from '../../game/anim.ts';
import { Controller } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_SOLID_HIDDEN } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { V } from '../../game/vars.ts';
import { CLIP, END_CLIP, PHASE, REC, SCORE, VAR } from './consts.ts';
import { TrxRun, makeRandom, NullSound, nameOf } from './run.ts';
import type { TrxSound, TrxRandom } from './run.ts';
import { TrexNode } from './trex.ts';
import { GateNode, VolcNode, SlogNode, BldrNode, EggNode, BrontyNode, SpectatorNode, FlyNode } from './props.ts';

export interface TrxRigs { TREX: Blk; MFIG: Blk; TRIC?: Blk | null; STEG?: Blk | null; BREX?: Blk | null; BRON?: Blk | null }

export interface PrepareDeps {
  rigs: TrxRigs;
  /** the scene's models (the egg models are found by their index in the global model array 0x98380c) */
  models?: readonly Model[];
  /** the executable: the rumble, medal and end-clip tables are read from it */
  pe?: Pe | null;
  sound?: TrxSound;
  rng?: TrxRandom;
  say?: (id: string) => boolean;
}

export interface TrxGame {
  world: World;
  run: TrxRun;
  node: TrexNode;
  gate: GateNode | null; gateRec: GameRecord | null;
  eggs: { rec: GameRecord; node: EggNode }[];
  bldrs: { rec: GameRecord; node: BldrNode }[];
  slogs: { rec: GameRecord; node: SlogNode }[];
  volcs: { rec: GameRecord; node: VolcNode }[];
  spectators: { rec: GameRecord; node: SpectatorNode }[];
  bronty: BrontyNode | null;
}

const f32 = (pe: Pe, va: number) => { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, pe.u32(va), true); return dv.getFloat32(0, true); };
/** the zone's tables of the executable */
export const TABLES = { RUMBLE_TIME: 0x93db68, RUMBLE_STRENGTH: 0x93db80, MEDALS: 0x93db98, END_CLIP: 0x93dbe4 } as const;

export function prepareTrx(world: World, pepper: GameRecord, d: PrepareDeps): TrxGame {
  const recs = world.records;
  const check = (i: number, name: string) => { if (recs[i]?.name !== name) throw new Error(`z27TRX: record ${i} is ${recs[i]?.name}, expected ${name}`); return recs[i]; };
  const pepp = check(REC.PEPP, 'PEPP'), drkr = check(REC.DRKR, 'DRKR');
  if (pepper !== pepp) throw new Error('z27TRX: the player record is not PEPP');
  const run = new TrxRun();
  run.pepp = pepp; run.drkr = drkr;
  run.sound = d.sound ?? new NullSound();
  run.rng = d.rng ?? makeRandom();
  if (d.say) run.say = d.say;
  const pe = d.pe ?? null;
  if (pe) {
    for (let i = 0; i < 6; i++) { run.rumbleTime[i] = f32(pe, TABLES.RUMBLE_TIME + 4 * i); run.rumbleStrength[i] = pe.u32(TABLES.RUMBLE_STRENGTH + 4 * i) | 0; }
  }
  // animation: PEPP is the rex (TREX.blk), DRKR the rider (MFIG.blk); the spectators have their own rigs
  // FUN_0076b230 (the builder, run by the loop's FUN_00766e19 before every start) resets the rex's flags to 2; FUN_0076649a(0) then adds LOD part 1 (0x200): the rex is 0x202 (the scene's
  // 0x10 'non-solid' bit is gone); the rider keeps what the zone's extraction gave it (0x202). Found by the differential test (tools/tests/m7-z27TRX-emu.mjs).
  pepp.flags = RF_ENABLED | 0x200;
  pepp.anim = new AnimInstance(d.rigs.TREX); pepp.anim.start(CLIP.WAIT, 0);
  drkr.anim = new AnimInstance(d.rigs.MFIG); drkr.anim.start(8, 0);
  for (const r of recs) r.ctrl = null;

  const trex = new TrexNode();
  trex.run = run; trex.rider = drkr;
  if (pe) {
    trex.thresholds = { gold: pe.u32(TABLES.MEDALS) | 0, silver: pe.u32(TABLES.MEDALS + 4) | 0, bronze: pe.u32(TABLES.MEDALS + 8) | 0 };
    trex.endClip = [0, 1, 2, 3].map((i) => pe.u32(TABLES.END_CLIP + 4 * i) | 0);
  } else { trex.thresholds = { gold: SCORE.GOLD, silver: SCORE.SILVER, bronze: SCORE.BRONZE }; trex.endClip = END_CLIP; }
  pepp.ctrl = new Controller();
  attach(pepp, trex);

  const model = (index: number) => d.models?.find((m) => m.array === 'g98380c' && m.index === index) ?? null;
  const eggModels = { falling: model(0x2e), landed: model(0x121), broken: model(0x2d) };
  const g: TrxGame = { world, run, node: trex, gate: null, gateRec: null, eggs: [], bldrs: [], slogs: [], volcs: [], spectators: [], bronty: null };
  // FUN_0076649a's loop over the records, by name (the dword compares of the decompile are the upper-cased names)
  for (const rec of recs) {
    if (rec === pepp || rec === drkr) continue;
    switch (nameOf(rec)) {
      case 'TRIC': case 'STEG': case 'BREX': {
        const clip = nameOf(rec) === 'TRIC' ? 3 : nameOf(rec) === 'STEG' ? 4 : 1;
        const rig = d.rigs[nameOf(rec) as 'TRIC' | 'STEG' | 'BREX'];
        if (rig) rec.anim = new AnimInstance(rig);
        const n = new SpectatorNode(); n.run = run; n.bind(rec, clip);
        attach(rec, n); g.spectators.push({ rec, node: n });
        break;
      }
      case 'GATE': { const n = new GateNode(); n.run = run; attach(rec, n); g.gate = n; g.gateRec = rec; break; }
      case 'VOLC': { const n = new VolcNode(); n.run = run; attach(rec, n); g.volcs.push({ rec, node: n }); break; }
      case 'BRDG': run.bridge = rec; break;
      case 'SLOG': { const n = new SlogNode(); n.run = run; attach(rec, n); g.slogs.push({ rec, node: n }); break; }
      case 'BLDR': { const n = new BldrNode(); n.run = run; n.bind(world, rec); attach(rec, n); g.bldrs.push({ rec, node: n }); break; }
      case 'YOLK': case 'EGGS': { const n = new EggNode(); n.run = run; n.models = eggModels; n.bind(world, rec); attach(rec, n); g.eggs.push({ rec, node: n }); break; }
      case 'BURN': rec.flags &= ~RF_SOLID_HIDDEN; break;
      case 'BRON': {
        if (d.rigs.BRON) rec.anim = new AnimInstance(d.rigs.BRON);
        const n = new BrontyNode(); n.run = run; n.bind(rec); attach(rec, n); g.bronty = n;
        break;
      }
      default: break;
    }
  }
  { const ptra = recs[REC.PTRA]; if (ptra && nameOf(ptra) === 'PTRA') { const n = new FlyNode(); n.run = run; attach(ptra, n); } }     // FUN_00768188 (the original gives record 2 alone a controller + the no-op `fly`)
  world.vars.set(VAR.PHASE, PHASE.WAIT);
  for (const v of [VAR.STATUE, VAR.VOLCANO, VAR.EGG, VAR.BOULDER, VAR.MEDAL]) world.vars.set(v, 0);
  world.vars.set(V.PEPPER_CONTROL, 1);
  world.focus = pepp;
  trex.init(world, pepp);
  return g;
}

function attach(rec: GameRecord, node: BehaviourNode) {
  if (!rec.ctrl) rec.ctrl = new Controller();
  rec.ctrl.attach(node, 0);
}
