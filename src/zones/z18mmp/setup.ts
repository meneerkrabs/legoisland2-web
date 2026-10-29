// The per-run initialisation of the tomb (FUN_006a3861 + FUN_006a30c0 + the builder's animation binding): the symbols are shuffled (50 random swaps), the nodes get their
// state, the records the init code shows or hides are set, the animation instances are created. `setupZone` has already placed the records, hidden what the init hides (the
// extraction of FUN_006a30c0) and attached the nodes whose constructor address is registered; this adds what the extraction cannot see (the dynamic attaches of the 12 symbols,
// the mummies' arguments, Pepper's z + 15).
import { Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { REC, VAR, CLIP, RECORD_NAMES, K } from './consts.ts';
import { MmpShared } from './shared.ts';
import { PepperNode } from './pepper.ts';
import { CoffinNode } from './coffin.ts';
import type { ZoneParticles } from '../../fx/particles/zone.ts';
import { CameraNode, MummyNode, KeyNode, PageNode, RockNode, PillarNode, SpiderNode, RatNode, TorchNode } from './props.ts';

/** the record names the nodes rely on (the builder's table), differences listed */
export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(RECORD_NAMES)) {
    const r = records[+i];
    if (!r || r.name !== n) bad.push(`record ${i}: ${r?.name ?? 'missing'} (expected ${n})`);
  }
  return bad;
}

/** swap two records the way FUN_006a3861 does: the whole 0x68 byte record (name, model, collision object, matrix, flags ...) changes places, the position stays with the slot */
export function swapSymbols(a: GameRecord, b: GameRecord) {
  const pa = [a.x, a.y, a.z], pb = [b.x, b.y, b.z];
  const t = {
    name: a.name, model: a.model, colObj: a.colObj, anim: a.anim, flags: a.flags, variant: a.variant, face: a.face, scale: a.scale, m: new Float32Array(a.m), prev: new Float32Array(a.prev), rx: a.rx, ry: a.ry, rz: a.rz,
  };
  a.name = b.name; a.model = b.model; a.colObj = b.colObj; a.anim = b.anim; a.flags = b.flags; a.variant = b.variant; a.face = b.face; a.scale = b.scale; a.m.set(b.m); a.prev.set(b.prev); a.rx = b.rx; a.ry = b.ry; a.rz = b.rz;
  b.name = t.name; b.model = t.model; b.colObj = t.colObj; b.anim = t.anim; b.flags = t.flags; b.variant = t.variant; b.face = t.face; b.scale = t.scale; b.m.set(t.m); b.prev.set(t.prev); b.rx = t.rx; b.ry = t.ry; b.rz = t.rz;
  a.x = pa[0]; a.y = pa[1]; a.z = pa[2]; b.x = pb[0]; b.y = pb[1]; b.z = pb[2];
  a.savePrev(); b.savePrev();
}

/** the 50 swaps of the init: which symbol sits in which coffin (always two of each type) */
export function shuffleSymbols(sh: MmpShared, records: readonly GameRecord[], swaps = 50) {
  for (let k = 0; k < swaps; k++) {
    let a = 0, b = 0;
    while (a === b) { a = sh.rng.int(12); b = sh.rng.int(12); }
    swapSymbols(records[REC.SYMBOL[a]], records[REC.SYMBOL[b]]);
  }
}

export interface MmpNodes {
  pepper: PepperNode; camera: CameraNode; coffins: CoffinNode[]; guards: MummyNode[]; key: KeyNode; page: PageNode; rock: RockNode; pillars: PillarNode[]; spiders: SpiderNode[]; rats: RatNode[];
}

/** the node of a kind on a record */
function nodeOf<T>(rec: GameRecord, kind: string): T | undefined { return rec.ctrl?.nodes.find((n) => n.kind === kind) as T | undefined; }

export interface MmpRigs { MFIG: Blk | null; SPID: Blk | null; RATT: Blk | null }

/**
 * Everything the zone's constructors and init code do after `setupZone`. `sh` is the shared state the registered constructors created their nodes with. Returns the nodes by role.
 */
export function prepareMmp(world: World, sh: MmpShared, rigs: MmpRigs): MmpNodes {
  const rs = world.records;
  const bad = checkRecords(rs);
  if (bad.length) throw new Error(`z18MMP: record table differs from the builder: ${bad.slice(0, 4).join('; ')}`);
  sh.records = rs;
  world.col.groundRec = rs[REC.MMP];                       // FUN_004425e0(DAT_00983804): the ground is the tomb's own mesh
  for (const v of [VAR.NEAR, VAR.PENDING, VAR.OPEN, VAR.READY, VAR.MATCHED]) world.vars.set(v, 0);   // FUN_006a30c0: FUN_00417597(0xfc / 0xfb / 0xfe / 0xff / 0xfd, 0)
  // the animation instances of the builder (FUN_006b80f6): MFIG for Pepper and the 15 mummies (clip 1), SPID for the spiders, RATT for the rats
  const bind = (r: GameRecord, rig: Blk | null, clip: number) => { if (rig) { r.anim = new AnimInstance(rig); r.anim.start(clip, 0); } };
  for (let i = REC.MUMMY_FIRST; i <= REC.MUMMY_LAST; i++) bind(rs[i], rigs.MFIG, 1);
  REC.SPIDER.forEach((i) => bind(rs[i], rigs.SPID, 1));
  REC.RAT.forEach((i) => bind(rs[i], rigs.RATT, 1));
  // FUN_006a30c0: the coffin mummies sleep (clip 0x59, hidden: done by the extraction's flag writes), Pepper's z moves 15 forward after the camera's constructor
  for (const i of REC.MUMMY_OF) { rs[i].anim?.start(CLIP.M_SLEEP, 0); rs[i].flags &= ~2; rs[i].y = 4.35; }
  const pep = rs[REC.PEPPER];
  pep.z += K.PEPPER_START_Z;
  pep.ry = 0; pep.rebuildYaw();
  // 50 swaps of the symbols, then the constructors in the order of FUN_006a3861
  shuffleSymbols(sh, rs);
  const pepper = nodeOf<PepperNode>(pep, 'mmpWalk');
  const camera = nodeOf<CameraNode>(rs[REC.MMP], 'mmpCamera');
  if (!pepper || !camera) throw new Error('z18MMP: the Walk / camera nodes were not attached by the set-up');
  // Pepper runs only this node (the stub chain of setupZone is dropped)
  pep.ctrl!.nodes = [pepper]; pep.ctrl!.exclusive = null;
  pepper.init(pep);
  camera.init(world, pep);
  const coffins: CoffinNode[] = [];
  for (let n = 0; n < 12; n++) {
    const sym = rs[REC.SYMBOL[n]];
    const node = new CoffinNode(sh, n);
    node.init(world);
    sym.ctrl = new Controller();
    sym.ctrl.attach(node, 0);
    coffins.push(node);
  }
  const guards = REC.GUARD.map((i, k) => {
    const node = nodeOf<MummyNode>(rs[i], 'mmpMummy');
    if (!node) throw new Error(`z18MMP: no mummy node on record ${i}`);
    const home = rs[REC.GUARD_HOME[k]];
    node.init(rs[i], [home.x, home.y, home.z]);
    return node;
  });
  const key = nodeOf<KeyNode>(rs[REC.KEY], 'mmpKey')!, page = nodeOf<PageNode>(rs[REC.PAGE], 'mmpPage')!, rock = nodeOf<RockNode>(rs[REC.ROCK], 'mmpRock')!;
  key.init(rs[REC.KEY]); page.init(); rock.init(rs[REC.ROCK]);
  const pillars = REC.PILLAR.map((i) => { const n = nodeOf<PillarNode>(rs[i], 'mmpPillar')!; n.init(rs[i]); return n; });
  const spiders = REC.SPIDER.map((i) => { const n = nodeOf<SpiderNode>(rs[i], 'mmpSpider')!; n.init(rs[i]); return n; });
  const rats = REC.RAT.map((i) => { const n = nodeOf<RatNode>(rs[i], 'mmpRat')!; n.init(rs[i]); return n; });
  for (const r of rs) r.savePrev();
  world.camera.savePrev();
  return { pepper, camera, coffins, guards, key, page, rock, pillars, spiders, rats };
}

/**
 * The emitters of the constructors, in the order of FUN_006a3861's attach calls (the engine updates its sources in start order): the 12 coffins (symtwin + 2 x mummy02), the key (symtwin),
 * the page (twinkle01), the 12 torches (mmpfire). `sh.fx` is the engine the nodes' updates drive.
 */
export function startMmpEmitters(fx: ZoneParticles, world: World, sh: MmpShared, nodes: MmpNodes) {
  sh.fx = fx;
  nodes.coffins.forEach((c, n) => c.startFx(fx, world.records[REC.SYMBOL[n]], world));
  nodes.key.startFx(fx, world.records[REC.KEY]);
  nodes.page.startFx(fx, world.records[REC.PAGE]);
  for (const i of REC.TORCH) (world.records[i].ctrl?.nodes.find((n) => n.kind === 'mmpTorch') as TorchNode | undefined)?.startFx(fx, world.records[i]);
}
