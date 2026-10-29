// z22BIP: what the zone's loop and set-up functions do before play (FUN_00706bee / FUN_00708457 / FUN_0070814f / FUN_00707800 / FUN_00707da6): the course (spline), the
// nodes the original attaches from tables (monkeys, rope targets, propellers), the animation rigs of the creatures, the helper records that draw the projectiles, the
// mode variable and the camera's 50 settling steps. DOM-free (the renderer is optional): the node tests and the zone game both call `prepareBip`.
import type { World } from '../../game/world.ts';
import { Controller } from '../../game/controller.ts';
import { GameRecord, RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import { AnimInstance } from '../../game/anim.ts';
import { V } from '../../game/vars.ts';
import { parseBlk, parseMan } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import type { Pe } from '../../formats/exe.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { BipSpline } from './spline.ts';
import { bipRun, dropBipRun, REC, MODE, VAR_MODE } from './run.ts';
import type { BipRun } from './run.ts';
import { PlaneNode, PLANE } from './plane.ts';
import { TakeoffNode, parseSrc } from './takeoff.ts';
import type { SrcPoints } from './takeoff.ts';
import { LandingNode } from './landing.ts';
import { JohnnyNode } from './johnny.ts';
import { MonkeyNode, melonMatrix } from './monkey.ts';
import { RockyNode, stoneMatrix } from './rocky.ts';
import { PropsNode, RiverNode, RopeSlideNode } from './props.ts';

/** tables of the executable the loop's set-up reads (FUN_00707800 / FUN_0070814f) */
export const BIP_TABLES = {
  MONKEYS: 0x931aa0,        // { record, a, clip while awake, clip after a hit } * n, record -1 ends (stride 0x10)
  ROPES: 0x9318a0,          // { DTH record, SLD record, DTR record, ptr to "DTHn.SRC" } * n (stride 0x10)
  PROP_OFFSETS: 0x931a38,   // three (x, y, z): the propellers of the plane and of Johnny's two
} as const;

const f32u = (() => { const d = new DataView(new ArrayBuffer(4)); return (u: number) => { d.setUint32(0, u >>> 0); return d.getFloat32(0); }; })();

/** a record that draws another record's model at a matrix of its own (the original draws these with FUN_0043f1a0(mesh, matrix)) */
function helperOf(world: World, tpl: GameRecord, name: string): GameRecord {
  const h = new GameRecord(name);
  h.model = tpl.model;
  h.scale = [...tpl.scale];
  h.flags = RF_NO_COLLIDE;                   // hidden (not enabled), never solid
  h.index = world.records.length;
  world.records.push(h);
  return h;
}

export interface BipSetup {
  run: BipRun;
  plane: GameRecord; johnny: GameRecord;
  walk: PlaneNode; takeoff: TakeoffNode; landing: LandingNode; johnnyNode: JohnnyNode;
  monkeys: { rec: GameRecord; node: MonkeyNode }[];
  ropes: RopeSlideNode[];
  rockies: RockyNode[];
  props: PropsNode | undefined;
  /** the projectiles' helper records follow the nodes' state (call once per tick) */
  syncDraw(): void;
  /** the helper records that were added (a renderer has to refresh its views) */
  helpers: GameRecord[];
}

/**
 * Set the zone up on a world built by `setupZone` (the nodes with a known constructor address are attached already). `gr.groupCount` / `scrollGroup` (the river) are
 * optional through `river`.
 */
export function prepareBip(world: World, archive: Archive, pe: Pe, opts: { scrollRiver?: (rec: GameRecord, dv: number) => void } = {}): BipSetup {
  const recs = world.records;
  dropBipRun(world);
  const R = bipRun(world);
  const plane = recs[REC.PLANE], johnny = recs[REC.JOHNNY], propRec = recs[REC.PROP];
  if (plane?.name !== 'PEPP' || johnny?.name !== 'SEPL' || propRec?.name !== 'PROP') throw new Error('z22BIP: the records of the plane are not where the zone code expects them');

  // ---- the player record: the biplane. The scene's stub walk chain (SGwalk / swim / guard) is not wanted; the plane is solid for the stones
  const ctrl = plane.ctrl as Controller;
  ctrl.nodes = ctrl.nodes.filter((n) => !['StubGuard', 'SGwalk', 'sgswim', 'PepSwitc'].includes(n.kind));
  ctrl.flags = 0xb;                          // FUN_004238b7(PEPP controller, 0xb)
  plane.flags &= ~RF_NO_COLLIDE;
  world.vars.set(V.PEPPERSSHADOW, -1);       // no blob shadow of the walking player
  const walk = ctrl.find<PlaneNode>('Walk'), takeoff = ctrl.find<TakeoffNode>('Takeoff'), landing = ctrl.find<LandingNode>('Landing');
  const jn = johnny.ctrl?.find<JohnnyNode>('csplane');
  if (!walk || !takeoff || !landing || !jn) throw new Error('z22BIP: the nodes of the plane are not attached');

  // ---- the course (FUN_00707da6) and the runway files (the take-off / landing constructors read them)
  const src = (name: string): number[][] => { const e = archive.find(`source/${name}`); if (!e) throw new Error(`z22BIP: source/${name} is missing`); return parseSrc(archive.read(e)); };
  const manFile = archive.find('matanim/bippath.man');
  if (!manFile) throw new Error('z22BIP: matanim/bippath.man is missing');
  const rs = src('Runwaystart.src'), re = src('Runwayend.src');
  const asPoints = (v: number[][]): SrcPoints => ({ pos0: v[0] as [number, number, number], rot0: v[1] as [number, number, number], pos1: v[2] as [number, number, number], rot1: v[3] as [number, number, number] });
  takeoff.src = asPoints(rs);
  landing.bind(asPoints(re));
  R.spline = BipSpline.fromMan(parseMan(archive.read(manFile)), rs[0], re[2]);
  R.takeoff = takeoff;
  R.recs = { plane, johnny, prop: propRec };
  walk.init(world);
  jn.init(world);

  // ---- animation rigs of the scene's creatures (the port gives only the player a rig): by the first three letters of the record's name
  const rigs = new Map<string, Blk | null>();
  const rigOf = (n: string): Blk | null => {
    if (!rigs.has(n)) { const e = archive.find(`anim/${n}.blk`); rigs.set(n, e ? parseBlk(archive.read(e)) : null); }
    return rigs.get(n)!;
  };
  for (const r of recs) {
    const pre = r.name.slice(0, 3);
    const rig = pre === 'MNK' ? 'MONK' : pre === 'PRT' ? 'PRRT' : pre === 'CRC' ? 'CROC' : pre === 'ROC' ? 'ROCK' : null;
    if (!rig || r.anim) continue;
    const blk = rigOf(rig);
    if (blk) { r.anim = new AnimInstance(blk); r.anim.start(0, 0); }
  }

  // ---- the monkeys (the table at 0x931aa0) and the rope targets (the table at 0x9318a0)
  const monkeys: { rec: GameRecord; node: MonkeyNode }[] = [];
  for (let a = BIP_TABLES.MONKEYS; ; a += 0x10) {
    const idx = pe.u32(a) | 0;
    if (idx === -1 || !recs[idx]) break;
    const node = new MonkeyNode(pe.u32(a + 8), pe.u32(a + 12));
    const rec = recs[idx];
    if (!rec.ctrl) rec.ctrl = new Controller();
    rec.ctrl.attach(node, 0);
    monkeys.push({ rec, node });
  }
  const ropes: RopeSlideNode[] = [];
  for (let a = BIP_TABLES.ROPES; ; a += 0x10) {
    const ia = pe.u32(a) | 0;
    if (ia === -1 || !recs[ia]) break;
    const node = new RopeSlideNode();
    node.bind(asPoints(src(pe.cstr(pe.u32(a + 12)))), recs[pe.u32(a + 4)], recs[pe.u32(a + 8)]);
    const rec = recs[ia];
    if (!rec.ctrl) rec.ctrl = new Controller();
    rec.ctrl.attach(node, 0);
    ropes.push(node);
  }
  // ---- the three propellers (the node on PROP): the plane's nose and Johnny's two
  const props = propRec.ctrl?.find<PropsNode>('prop');
  if (props) {
    props.owners = [REC.PLANE, REC.JOHNNY, REC.JOHNNY];
    props.offsets = [0, 1, 2].map((i) => [0, 1, 2].map((k) => f32u(pe.u32(BIP_TABLES.PROP_OFFSETS + (i * 3 + k) * 4))));
    props.angles = [0, 0, 0];
  }
  const river = recs.find((r) => r.ctrl?.find('River'))?.ctrl?.find<RiverNode>('River');
  if (river && opts.scrollRiver) river.scroll = opts.scrollRiver;

  // ---- helper records for the projectiles (bananas of BANN, melons of MELN, stones of G011) and the first two propellers
  const ban = recs[REC.BANANA], mel = recs[REC.MELON];
  const stoneTpl = recs.find((r) => r.name === 'G011')!;
  const helpers: GameRecord[] = [];
  const mk = (tpl: GameRecord, name: string) => { const h = helperOf(world, tpl, name); helpers.push(h); return h; };
  const bananaH = walk.bananas.map((_, i) => mk(ban, `BN${i}`));
  const melonH = monkeys.map((m) => m.node.melons.map((_, i) => mk(mel, `ML${i}`)));
  const rockies = recs.map((r) => r.ctrl?.find<RockyNode>('Rocky')).filter((n): n is RockyNode => !!n);
  const stoneH = rockies.map((n) => n.stones.map((_, i) => mk(stoneTpl, `ST${i}`)));
  const propH = [mk(propRec, 'PR0'), mk(propRec, 'PR1')];
  const place = (h: GameRecord, on: boolean, m?: Float32Array) => {
    if (on && m) { const was = h.enabled; h.m.set(m); if (!was) h.prev.set(m); h.flags |= RF_ENABLED; } else h.flags &= ~RF_ENABLED;
  };
  const out = new Float32Array(16);
  const syncDraw = () => {
    walk.bananas.forEach((b, i) => {
      if (!b.active) { place(bananaH[i], false); return; }
      // scale 4 and the spin first, then the heading and the place (FUN_0070b58c: (spin * scale) * (Euler(0, heading, 0) + position))
      const rot = buildMatrix(b.ax, b.ay, b.az, 0, 0, 0);
      for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) rot[k] *= PLANE.BANANA_SCALE;
      const hm = buildMatrix(0, b.heading, 0, 0, 0, 0);
      out.fill(0);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 4 + c] = rot[r * 4] * hm[c] + rot[r * 4 + 1] * hm[4 + c] + rot[r * 4 + 2] * hm[8 + c];
      out[12] = b.x; out[13] = b.y; out[14] = b.z; out[15] = 1;
      place(bananaH[i], true, out);
    });
    monkeys.forEach((m, k) => m.node.melons.forEach((ml, i) => place(melonH[k][i], ml.active, ml.active ? melonMatrix(ml) : undefined)));
    rockies.forEach((rk, k) => rk.stones.forEach((s, i) => place(stoneH[k][i], s.active, s.active ? stoneMatrix(s) : undefined)));
    if (props && props.matrices.length === 3) {
      place(propH[0], true, props.matrices[0]); place(propH[1], true, props.matrices[1]);
      propRec.m.set(props.matrices[2]);
    }
  };

  // ---- the plane's mode: PSwitch's constructor sets variable 0xfa to 8 (the take-off); the camera starts at height 500 and settles in 50 steps of the take-off's camera
  world.vars.set(VAR_MODE, MODE.TAKEOFF);
  const c = world.camera.c;
  c[1] = c[4] = 500; c[0] = plane.x; c[2] = plane.z - 100;           // DAT_009da5ec / 5f8 = 500 (FUN_00708457)
  for (let i = 0; i < 50; i++) takeoff.camera(world, plane);
  world.camera.updateView(); world.camera.savePrev();
  plane.prev.set(plane.m);
  syncDraw();
  return { run: R, plane, johnny, walk, takeoff, landing, johnnyNode: jn, monkeys, ropes, rockies, props, syncDraw, helpers };
}
