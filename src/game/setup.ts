// Zone set-up: what the zone's set-up function does after the loader and builder (docs/re/architecture.md 3.2, 3.3), for every zone.
// Pure (no DOM). The per-zone numbers the original code writes into globals and records (sea level, gravity, the ground record, hidden records, box colliders
// for trees / vehicles, the behaviour nodes attached to records ...) are read out of the executable at run time by src/formats/zonesetup.ts
// (`extractZoneSetup`, docs/re/zone-setup.md); `profileFor(zone, pe, scene)` turns that into a ZoneProfile and `setupZone` builds the world from it
// (FUN_004b6475 / FUN_004b4220 for the island, FUN_0053fb1f / FUN_0053ea4d for Pepper's house, the equivalent function of every other zone).
// The two hand-written M1 profiles below (PROFILE_LGI / PROFILE_PPH, `PROFILES`) are kept as the reference the extraction is tested against
// (tools/tests/zonesetup.mjs) and as a fallback when no executable is at hand.
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene } from '../formats/exe.ts';
import { parseBlk } from '../formats/anim.ts';
import { parseCompiledWaypoints } from '../formats/waypoints.ts';
import type { Blk } from '../formats/anim.ts';
import { GameRecord, RF_NO_COLLIDE, RF_SOLID_HIDDEN, RF_NPC } from './record.ts';
import { buildRecords } from './zone.ts';
import type { ZoneData } from './zone.ts';
import { World } from './world.ts';
import { AnimInstance } from './anim.ts';
import { Controller, createNode, NODE_CONTINUE } from './controller.ts';
import type { BehaviourNode } from './controller.ts';
import './nodes.ts';
import { extractZoneSetup, activeEntries, hiddenRecords, nameOfEntry, nameMatches, readZoneTable, ZONE_ARCHIVES, RF } from '../formats/zonesetup.ts';
import type { Attach, Base, ZoneSetup } from '../formats/zonesetup.ts';
import { emulateIslandSetup } from '../formats/emusetup.ts';
import type { EmuEnv, IslandSetup } from '../formats/emusetup.ts';
import { extractZone } from '../formats/exe.ts';
import type { Pe } from '../formats/exe.ts';
import { ST } from './walk.ts';
import type { WalkNode } from './walk.ts';
import type { SwimNode } from './swim.ts';
import { V } from './vars.ts';

export interface ZoneProfile {
  zone: string;
  /** value of CURRENT_SUBGAME (the zone table index: island 2, Pepper's house 3) */
  subgame: number;
  /** DAT_009da858 */
  seaLevel: number;
  gravity: number;
  /** kind-1 zone: the draw pass pulls the camera in front of walls */
  hub: boolean;
  /** name of the ground record (FUN_004425e0) or null (the house uses plain sweeps) */
  ground: string | null;
  /** record indices hidden at set-up (flags &= ~2) */
  hide: number[];
  /** the rig of the characters */
  rig: string;
  tweak?(records: GameRecord[]): void;
  /** arrival place of the player (FUN_004c2d22 for the island): `from` = zone the player comes from */
  start?(archive: Archive, records: GameRecord[], from: string, getVar?: (v: number) => number): { pos: [number, number, number]; yaw: number } | null;
  /** the extraction result (`profileFor`): `setupZone` applies its tables (flags, boxes, field writes, node attaches) instead of `hide` / `tweak` */
  setup?: ZoneSetup;
  /** `profileFor(..., { islandVars })`: the full emulation result of the island's set-up (argument blocks, dictionaries, story-handler calls ...) */
  island?: IslandSetup;
  /** index of the ground record (FUN_004425e0) when known; wins over `ground` */
  groundIndex?: number | null;
  /** a placeholder from `PROFILES` for a zone without a hand-written profile: `setupZone` needs `opts.pe` to extract it */
  stub?: boolean;
}

/** position of a node of the island's PATH waypoint map (FUN_00462be9) */
function pathNode(archive: Archive, index: number): [number, number, number] | null {
  const e = archive.find('Waypoints/W_PATH_C.wpt');
  if (!e) return null;
  const n = parseCompiledWaypoints(archive.read(e)).nodes[index];
  return n ? [n.x, n.y, n.z] : null;
}

const byName = (records: GameRecord[], n: string) => records.filter((r) => r.name === n);

/**
 * z02LGI, hand-written in M1 from FUN_004b6475 + FUN_004b4220 and kept as the reference for the extraction (era 0). Corrections after comparing with the
 * extraction (docs/re/zone-setup.md 5): the hide list lacked the records FUN_004b4907 (42, 367, 369 at 0x4b4c3b / 0x4b4c97 / 0x4b4cf7) and FUN_004b7040
 * (370 at 0x4b8dd9) hide; the umbrella UMB1 is record 111 (0x2d18 / 0x68, not 112) with box radius 0x402a7efa = 2.664 and z = 230.0 (0x43660000).
 */
export const PROFILE_LGI: ZoneProfile = {
  zone: 'z02LGI', subgame: 2, seaLevel: 2.4, gravity: -10, hub: true, ground: 'LAND', rig: 'MFIG',
  hide: [66, 157, 75, 76, 77, 78, 79, 294, 380, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 9, 68,
    350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 42,
    // the era-0 NPC / prop set the set-up reaches through FUN_004c0ca9 -> FUN_004c0750 -> FUN_0052bc9b / FUN_0052cba0 (0x52c30c, 0x52c424, 0x52f5b5)
    15, 69, 70, 71, 72, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304],
  tweak(rs) {
    // box shapes by record name (FUN_004b6475): rocks, trees, palms, oaks, some props
    for (const r of rs) {
      const o = r.colObj;
      if (!o) continue;
      switch (r.name) {
        case 'ROCK': case 'GAR3': case 'PLAT': case 'CTRL': o.setBoxFromFile(); break;
        case 'TREE': o.setBoxRadiusHeight(4.0, 16.0); break;
        case 'OAKS': case 'PALM': o.setBoxRadiusHeight(1.6, 16.0); break;
      }
    }
    const at = (i: number) => rs[i]?.colObj;
    at(165)?.setBox(4, 8, 4); at(170)?.setBox(4, 8, 6);
    at(66)?.setBox(4, 5.93, 2.78);
    at(73)?.setBoxFromFile(); at(163)?.setBoxFromFile(); at(171)?.setBoxFromFile(); at(164)?.setBoxFromFile();
    at(111)?.setBoxRadiusHeight(2.664, 16.0); at(360)?.setBoxRadiusHeight(2.664, 16.0);
    for (const i of [163, 164, 171]) if (rs[i]) rs[i].y = 2.4;     // boats float at the sea level
    for (const i of [81, 82]) if (rs[i]) rs[i].flags |= RF_NO_COLLIDE;
    if (rs[125]) rs[125].flags |= RF_SOLID_HIDDEN;
    if (rs[111]) { rs[111].x = -25.0; rs[111].z = 230.0; }
    if (rs[360]) { rs[360].x = -35.0; rs[360].z = 220.0; }
    for (const r of byName(rs, 'PEPP')) { r.flags &= ~RF_NPC; r.flags |= RF_NO_COLLIDE; }
    if (rs[367]) rs[367].flags = 0x20;   // FUN_004b4907: `flags = 0x20` (hidden, solid) / `flags = 0`
    if (rs[369]) rs[369].flags = 0;
  },
  /** arrival from Pepper's house: at PHSE's door (node 239), from anywhere else at the skate park (SKTP, node 246); facing away from the building */
  start(archive, rs, from) {
    const house = from === 'z03PPH';
    const pos = pathNode(archive, house ? 239 : 246);
    const bld = rs.find((r) => r.name === (house ? 'PHSE' : 'SKTP'));
    if (!pos || !bld) return null;
    return { pos, yaw: Math.atan2(pos[0] - bld.x, pos[2] - bld.z) };
  },
};

/** z03PPH: Pepper's house (FUN_0053ea4d): no ground record, no sea (level 0), gravity as left by the previous zone (-10), jumping disabled by the walk code */
export const PROFILE_PPH: ZoneProfile = {
  zone: 'z03PPH', subgame: 3, seaLevel: 0, gravity: -10, hub: false, ground: null, hide: [], rig: 'MFIG',
  tweak(rs) { for (const r of byName(rs, 'PEPP')) r.flags |= RF_NO_COLLIDE; },
};


/** the hand-written M1 profiles (reference); every other zone gets a stub: `profileFor(zone, pe, scene)` builds the real profile from the executable */
export const PROFILES: Record<string, ZoneProfile> = { z02LGI: PROFILE_LGI, z03PPH: PROFILE_PPH };
for (const z of ZONE_ARCHIVES) if (!PROFILES[z]) PROFILES[z] = { zone: z, subgame: -1, seaLevel: 0, gravity: -10, hub: false, ground: null, hide: [], rig: 'MFIG', stub: true };

// ---------------------------------------------------------------------------------------------------
// behaviour constructors by address (FUN_00423532's second argument)

/** what a constructor factory gets: the attach entry (record, argument, gate ...) of the extraction */
export type CtorFactory = (attach: Attach) => BehaviourNode;
const ctorRegistry = new Map<number, CtorFactory>();
/**
 * Register the port of the behaviour whose constructor sits at `address` in the executable (the `ctor` of an extracted attach). Later milestones register
 * theirs here; `setupZone` skips attaches whose constructor is unknown (listed in `Loaded.skipped`). The factory's node gets the gate (var, mask, value)
 * of the attach site and is inserted at the site's position (controller.ts `Controller.attach`).
 */
export function registerCtor(address: number, factory: CtorFactory) { ctorRegistry.set(address, factory); }
export function unregisterCtor(address: number) { ctorRegistry.delete(address); }
export function ctorFactory(address: number): CtorFactory | undefined { return ctorRegistry.get(address); }
export const registeredCtors = () => [...ctorRegistry.keys()];

/** constructors of the shared library and of the island that the engine core ports (nodes.ts registers them by source name) */
export const CTOR = { SGWALK: 0x42f470, SGSWIM: 0x88cf13, ISLAND_PEPSWITC: 0x4bbef8 } as const;
registerCtor(CTOR.SGWALK, () => createNode('SGwalk'));
registerCtor(CTOR.SGSWIM, () => createNode('sgswim'));
registerCtor(CTOR.ISLAND_PEPSWITC, () => createNode('PepSwitc'));

export interface Skipped { record: number; ctor: number; ctorName: string | null; pos: number; at: number }

// ---------------------------------------------------------------------------------------------------
// profile from the extraction

const waypointNode = (archive: Archive, path: string | null, node: number): [number, number, number] | null => {
  if (!path) return null;
  const base = path.split('\\').pop()!;
  const e = archive.find(`Waypoints/${base}_C.wpt`);
  if (!e) return null;
  const n = parseCompiledWaypoints(archive.read(e)).nodes[node];
  return n ? [n.x, n.y, n.z] : null;
};

export interface ProfileOptions {
  /** z02LGI only: run the island's set-up in the x86 emulation for these game variables (story node 0x58, 0x4f ...); the variables are read and
   * written (the set-up's own `FUN_00417597` writes land here). Without it the symbolic extraction is used (default). */
  islandVars?: EmuEnv['vars'];
  /** the island's archive (the set-up loads the compiled waypoint maps from it); needed with `islandVars` */
  archive?: Archive;
}

/**
 * The profile of any zone from the executable: sea level, gravity, ground record, hub flag (zone table kind 1), hidden records at the default game
 * variables (story state 0), the extraction itself (`setup`) and a start place. `scene` = `extractZone` of the zone (extracted here when missing).
 */
export function profileFor(zone: string, pe: Pe, scene?: ZoneScene, starts?: number[], opts: ProfileOptions = {}): ZoneProfile {
  starts ??= pe.functionStarts();
  scene ??= extractZone(pe, zone, undefined, starts);
  // the island with concrete game variables: the set-up is RUN out of the executable (emusetup.ts, docs/re/m4/emu.md) instead of interpreted symbolically
  const emu = zone === 'z02LGI' && opts.islandVars ? emulateIslandSetup(pe, scene, { vars: opts.islandVars, archive: opts.archive }) : null;
  const setup = emu ? emu.toZoneSetup() : extractZoneSetup(pe, zone, scene, starts);
  const kind = readZoneTable(pe).find((t) => t.index === setup.subgame)?.kind ?? 0;
  const names = scene.records.map((r) => r.name);
  const ref = zone === 'z02LGI' ? PROFILE_LGI : undefined;
  const p: ZoneProfile = {
    zone: setup.zone, subgame: setup.subgame, seaLevel: setup.seaLevel ?? 0, gravity: setup.gravity ?? -10, hub: kind === 1,
    ground: setup.groundName, groundIndex: setup.groundRecord, hide: hiddenRecords(setup, () => 0, names), rig: 'MFIG', setup,
  };
  if (emu) p.island = emu;
  // arrival place: the island keeps the hand-written one (FUN_004c2d22 picks the node from the zone the player comes from: not extracted); the other zones
  // use the waypoint place the set-up code puts the player record at, when there is one
  if (ref?.start) p.start = ref.start;
  else {
    p.start = (archive, records, _from, getVar) => {
      const vars = getVar ?? (() => 0);
      const player = records.findIndex((r) => r.name === 'PEPP');
      const pl = activeEntries(setup.places, vars).filter((x) => x.record === player && x.field === RF.X).pop();
      if (!pl) return null;
      const map = activeEntries(setup.waypointMaps, vars).filter((m) => m.index === pl.map).pop();
      const pos = waypointNode(archive, map?.path ?? null, pl.node);
      return pos ? { pos, yaw: records[player].ry } : null;
    };
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------
// applying the extracted tables

/** record indices an entry applies to: the record itself, or every record of the name a record loop is restricted to */
function targets(records: GameRecord[], e: Pick<Base, 'cond'> & { record: number }): GameRecord[] {
  if (e.record >= 0) return records[e.record] ? [records[e.record]] : [];
  const n = nameOfEntry(e);
  return n === null ? [] : records.filter((r) => nameMatches(n, r.name));
}

/** flag writes, field writes (positions), box colliders of the set-up code against the game variables of the world */
export function applySetup(setup: ZoneSetup, records: GameRecord[], world: World) {
  const getVar = (v: number) => world.vars.get(v);
  for (const w of activeEntries(setup.flagWrites, getVar)) {
    for (const r of targets(records, w)) {
      if (w.op === 'and') r.flags &= w.mask | ~0xffff;       // 16-bit field: the upper bits of the port's flags stay
      else if (w.op === 'or') r.flags |= w.mask;
      else if (w.op === 'set') r.flags = w.mask;
    }
  }
  for (const f of activeEntries(setup.fieldWrites, getVar)) {
    if (f.size === 4 && f.field === RF.VARIANT && f.value !== null) { for (const r of targets(records, f)) r.variant = f.value | 0; continue; }   // +0x64: the variant / phase word
    if (f.size !== 4 || (f.field !== RF.X && f.field !== RF.Y && f.field !== RF.Z)) continue;
    const v = f.float !== null ? f.float : f.ref === 0x9da858 ? world.seaLevel : null;
    if (v === null) continue;
    for (const r of targets(records, f)) { r.m[12 + (f.field - RF.X) / 4] = v; r.savePrev(); }
  }
  for (const b of activeEntries(setup.boxes, getVar)) {
    for (const r of targets(records, b)) {
      const o = r.colObj;
      if (!o) continue;
      if (b.kind === 'file') o.setBoxFromFile();
      else if (b.kind === 'radiusHeight') o.setBoxRadiusHeight(b.dims[0], b.dims[1]);
      else o.setBox(b.dims[0], b.dims[1], b.dims[2]);
    }
  }
}

/**
 * Safety net of the stub zones (the player walks around a scene whose own gameplay is not ported): the original keeps the player inside by invisible
 * walls, mode switches and the zone's own code. Without them a walk off the edge of a platform, or into a sea the zone has no swim switch for, falls for
 * ever. This node puts the player back to where it stood about a second ago when it sinks well below everything solid in the zone.
 */
class StubGuard implements BehaviourNode {
  readonly kind = 'StubGuard';
  var: number = V.NS_ON; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** respawns so far (diagnostics) */
  respawns = 0;
  private safe: [number, number, number] | null = null;
  private tick = 0;
  private floor: number;
  private walk: WalkNode;
  constructor(floor: number, walk: WalkNode) { this.floor = floor; this.walk = walk; }
  update(w: World, rec: GameRecord): number {
    if (!(rec.y >= this.floor)) {
      if (this.safe) {
        [rec.x, rec.y, rec.z] = this.safe;
        this.walk.t = 0; this.walk.vy = 0; this.walk.speed = 0; this.walk.state = ST.IDLE;
        w.pep.mailbox = ST.IDLE;
        rec.anim?.start(ST.IDLE, 0);
        w.camera.init(rec);
        this.respawns++;
      }
      return NODE_CONTINUE;
    }
    if (this.tick++ % 30 === 0 && this.walk.t === 0 && (w.vars.get(V.PEPPER_CONTROL) & 0xfff) === 1) this.safe = [rec.x, rec.y, rec.z];
    return NODE_CONTINUE;
  }
}
/** y below which a falling player is put back: 60 below the lowest solid thing of the zone (and below the sea) */
function fallFloor(records: GameRecord[], sea: number, startY: number): number {
  let lo = Infinity;
  for (const r of records) {
    const o = r.colObj;
    if (!o || (r.flags & RF_NO_COLLIDE)) continue;
    lo = Math.min(lo, r.y + (o.col.center[1] - o.col.halfExtents[1]) * (r.scale[1] || 1));
  }
  if (!Number.isFinite(lo)) lo = startY - 100;
  return Math.min(lo, sea, startY) - 60;
}

export interface SetupOptions {
  pos?: [number, number, number];
  yaw?: number;
  /** the zone the player comes from (the island starts at the door of the house / the skate park) */
  from?: string;
  world?: World;
  /** CURRENT_SUBGAME (zone table index); default: the zone's own (the island's story eras 31..33 are `ZoneSetup.variants`) */
  subgame?: number;
  /** game variables to set before the set-up runs (the island's era: `{ 0x58: story state }`) */
  vars?: Record<number, number>;
  /** the executable: needed for a stub profile (`PROFILES[zone]` of a zone without a hand-written profile) */
  pe?: Pe;
}

/**
 * Build the world of a zone: records (with the set-up code's flag / position / box writes), the player with the node chain the set-up code attaches
 * (constructors the port knows, see `registerCtor`; the others are listed in `skipped`) and animation, the camera.
 *
 * Zones without a ported player behaviour (no SGwalk among the attaches of the player record) get the M1 walk node (PepSwitc / SGwalk / sgswim) on the player
 * record, so every zone can be walked around as a stub. A zone without a record named PEPP gets an invisible dummy record (`hasPlayer` false): the shell
 * should use a fly camera there. `pepper` is never null.
 */
export function setupZone(scene: ZoneScene, archive: Archive, profile: ZoneProfile, opts: SetupOptions = {}): Loaded {
  if (profile.stub) {
    if (!opts.pe) throw new Error(`${profile.zone}: no hand-written profile; pass opts.pe or use profileFor(zone, pe, scene)`);
    profile = profileFor(profile.zone, opts.pe, scene);
  }
  const setup = profile.setup ?? null;
  const data = buildRecords(profile.zone, scene, archive);
  const world = opts.world ?? new World();
  const records = data.records;
  world.zone = profile.zone;
  world.records = records;
  world.col.records = records;
  const gi = profile.groundIndex ?? (profile.ground ? records.findIndex((r) => r.name === profile.ground) : -1);
  world.col.groundRec = gi !== null && gi >= 0 ? records[gi] ?? null : null;
  world.seaLevel = profile.seaLevel;
  world.gravity = profile.gravity;
  world.hub = profile.hub;
  world.vars.set(V.CURRENT_SUBGAME, opts.subgame ?? profile.subgame);
  world.vars.set(V.PEPPER_CONTROL, 1);
  for (const [k, v] of Object.entries(opts.vars ?? {})) world.vars.set(+k, v);
  world.pep.mailbox = ST.IDLE;
  const notes: string[] = [];
  if (setup) {
    applySetup(setup, records, world);
    // the visibility rule of the original: records the set-up cleared (flags & ~2) stay hidden; `hide()` of the port is the same bit
  } else {
    profile.tweak?.(records);
    for (const i of profile.hide) records[i]?.hide();
  }
  // the player: the record named PEPP
  let pepper = records.find((r) => r.name === 'PEPP');
  const hasPlayer = !!pepper;
  if (!pepper) {
    pepper = new GameRecord('PEPP');
    pepper.index = records.length;
    pepper.flags = RF_NO_COLLIDE;
    records.push(pepper);
    notes.push('no record named PEPP: invisible dummy player');
  }
  pepper.flags |= RF_NO_COLLIDE;     // the walker's own sweeps ignore its record anyway; keeps other records' sweeps (cameras, NPCs) from stopping at it
  const st = profile.start?.(archive, records, opts.from ?? '', (v) => world.vars.get(v));
  if (st) { pepper.x = st.pos[0]; pepper.y = st.pos[1]; pepper.z = st.pos[2]; pepper.ry = st.yaw; }
  if (opts.pos) { pepper.x = opts.pos[0]; pepper.y = opts.pos[1]; pepper.z = opts.pos[2]; }
  if (opts.yaw !== undefined) pepper.ry = opts.yaw;
  // animation rigs
  const rigs = new Map<string, Blk>();
  const rig = (name: string): Blk | null => {
    if (rigs.has(name)) return rigs.get(name)!;
    const e = archive.find(`anim/${name}.blk`);
    if (!e) return null;
    const b = parseBlk(archive.read(e));
    rigs.set(name, b);
    return b;
  };
  const mf = rig(profile.rig);
  if (mf) { pepper.anim = new AnimInstance(mf); pepper.anim.start(ST.IDLE, 0); } else notes.push(`no ${profile.rig} rig in the archive: static player`);
  pepper.rebuildYaw();
  // behaviour nodes: every attach of the set-up code whose constructor the port knows
  pepper.ctrl = null;
  const skipped: Skipped[] = [];
  const attached = (a: Attach, rec: GameRecord) => {
    const f = ctorFactory(a.ctor);
    if (!f) return false;
    const node = f(a);
    node.var = a.var; node.mask = a.mask; node.value = a.value;
    if (!rec.ctrl) rec.ctrl = new Controller();
    // the controller flags the set-up code wrote (FUN_004238b7(ctrl, flags): 0x13 / 0x43 / 0x83 ... bit 2 enabled, 0x40 targetable) before this attach: the
    // emulated island set-up records them (the symbolic extraction of the other zones does not)
    const cf = (a as { ctrlFlags?: number }).ctrlFlags;
    if (cf !== undefined) rec.ctrl.flags = cf;
    rec.ctrl.attach(node, a.pos);
    return true;
  };
  if (setup) {
    for (const a of activeEntries(setup.attaches, (v) => world.vars.get(v))) {
      const rec = a.record >= 0 ? records[a.record] : undefined;
      if (!rec || (rec === pepper && !hasPlayer) || !attached(a, rec)) skipped.push({ record: a.record, ctor: a.ctor, ctorName: a.ctorName, pos: a.pos, at: a.at });
    }
  }
  let walk: WalkNode | undefined;
  if (!hasPlayer) {
    // a dummy record: no behaviours (the shell flies a camera instead)
    walk = createNode('SGwalk') as WalkNode;
    pepper.ctrl = null;
  } else {
    const chain = () => pepper.ctrl as Controller | null;
    walk = chain()?.find<WalkNode>('SGwalk');
    let swim = chain()?.find<SwimNode>('sgswim');
    if (!walk) {
      // no ported player behaviour in the zone's set-up (a mini-game with its own walk code, the player is a vehicle ...): the M1 walk as a stub
      const c = pepper.ctrl ?? (pepper.ctrl = new Controller());
      const sea = !setup || setup.seaLevel !== null;
      if (sea) { const sw = createNode('PepSwitc'); sw.var = V.PEPPER_CONTROL; sw.mask = 0; sw.value = 0; c.attach(sw, c.nodes.length); }
      walk = createNode('SGwalk') as WalkNode; walk.var = V.PEPPER_CONTROL; walk.mask = 1; walk.value = 1; c.attach(walk, c.nodes.length);
      if (sea) { swim = createNode('sgswim') as SwimNode; swim.var = V.PEPPER_CONTROL; swim.mask = 2; swim.value = 2; c.attach(swim, c.nodes.length); }
      if (setup) notes.push('player node chain: M1 stub (no SGwalk among the attaches of the player record)');
    } else {
      if (walk.var !== V.PEPPER_CONTROL && walk.var !== V.NS_ON) {
        // the zone's own mode switch (not ported) normally sets the zone-local mode variable the walk node is gated by: set it to the walking value
        world.vars.set(walk.var, walk.value);
        notes.push(`walk node gated by var 0x${walk.var.toString(16)}: set to ${walk.value}`);
      }
      if (swim && !chain()!.find('PepSwitc')) {
        // the zone has the swim node but its own copy of the mode switch (PepSwitc.c family, not ported): the M1 switch (walk <-> swim at the sea level)
        const sw = createNode('PepSwitc'); sw.var = V.PEPPER_CONTROL; sw.mask = 0; sw.value = 0; chain()!.nodes.unshift(sw);
        notes.push('mode switch: M1 PepSwitc added (the zone has its own copy)');
      }
    }
    pepper.ctrl!.nodes.unshift(new StubGuard(fallFloor(records, profile.seaLevel, pepper.y), walk));
    if ((opts.subgame ?? profile.subgame) === 9) notes.push('sub-game 9: the walk node does not move the camera (the zone has its own camera, not ported)');
  }
  const swimNode = (pepper.ctrl as Controller | null)?.find<SwimNode>('sgswim');
  // the accessory record (DAT_009daa7c: the skateboard of the island) is hidden while walking / swimming
  const acc = setup?.accessoryRecord ?? (profile.zone === 'z02LGI' ? 9 : null);
  walk.accessory = acc !== null && acc !== undefined ? records[acc] ?? null : null;
  if (swimNode) swimNode.accessory = walk.accessory;
  world.focus = pepper;
  world.camera.vehicle = false;
  world.camera.init(pepper);
  return { world, data, pepper, profile, walk, rigs, setup, skipped, hasPlayer, notes };
}

export interface Loaded {
  world: World; data: ZoneData; pepper: GameRecord; profile: ZoneProfile; walk: WalkNode; rigs: Map<string, Blk>;
  /** the extraction the world was built from (null for a hand-written reference profile): attaches by constructor address for the ports of M3+ */
  setup: ZoneSetup | null;
  /** attaches of the set-up code (active for the game variables) whose constructor is not registered (`registerCtor`) or whose record is not constant */
  skipped: Skipped[];
  /** false: the zone has no record named PEPP, `pepper` is an invisible dummy and the shell should show a fly camera */
  hasPlayer: boolean;
  /** what the set-up approximated (stub chain, dummy player, gate variables set) */
  notes: string[];
}

