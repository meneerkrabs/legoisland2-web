// Zone set-up: what the zone's set-up function does after the loader and builder (docs/re/architecture.md 3.2, 3.3) for the zones the engine core supports.
// Pure (no DOM). A profile holds the per-zone numbers the original code writes into globals and records (sea level, gravity, the ground record, hidden
// records, box colliders for trees / vehicles, the player's node chain). Later milestones add zones and extract more of this from the EXE.
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
import { attachNode } from './controller.ts';
import './nodes.ts';
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
  start?(archive: Archive, records: GameRecord[], from: string): { pos: [number, number, number]; yaw: number } | null;
}

/** position of a node of the island's PATH waypoint map (FUN_00462be9) */
function pathNode(archive: Archive, index: number): [number, number, number] | null {
  const e = archive.find('Waypoints/W_PATH_C.wpt');
  if (!e) return null;
  const n = parseCompiledWaypoints(archive.read(e)).nodes[index];
  return n ? [n.x, n.y, n.z] : null;
}

const byName = (records: GameRecord[], n: string) => records.filter((r) => r.name === n);

/** z02LGI: FUN_004b6475 + FUN_004b4220 (the hide lists are the record indices those functions clear; the story handler FUN_004b7040 hides more per era) */
export const PROFILE_LGI: ZoneProfile = {
  zone: 'z02LGI', subgame: 2, seaLevel: 2.4, gravity: -10, hub: true, ground: 'LAND', rig: 'MFIG',
  hide: [66, 157, 75, 76, 77, 78, 79, 294, 380, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 9, 68,
    350, 351, 352, 353, 354, 355, 356, 357, 358, 359],
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
    at(112)?.setBoxRadiusHeight(2.667, 16.0); at(360)?.setBoxRadiusHeight(2.667, 16.0);
    for (const i of [163, 164, 171]) if (rs[i]) rs[i].y = 2.4;     // boats float at the sea level
    for (const i of [81, 82]) if (rs[i]) rs[i].flags |= RF_NO_COLLIDE;
    if (rs[125]) rs[125].flags |= RF_SOLID_HIDDEN;
    if (rs[112]) { rs[112].x = -25.0; rs[112].z = 230.4; }
    if (rs[360]) { rs[360].x = -35.0; rs[360].z = 220.0; }
    for (const r of byName(rs, 'PEPP')) { r.flags &= ~RF_NPC; r.flags |= RF_NO_COLLIDE; }
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

export const PROFILES: Record<string, ZoneProfile> = { z02LGI: PROFILE_LGI, z03PPH: PROFILE_PPH };

export interface Loaded { world: World; data: ZoneData; pepper: GameRecord; profile: ZoneProfile; walk: WalkNode; rigs: Map<string, Blk> }

/** Build the world of a zone: records (with the profile's tweaks), the player with its node chain and animation, the camera. */
export function setupZone(scene: ZoneScene, archive: Archive, profile: ZoneProfile, opts: { pos?: [number, number, number]; yaw?: number; from?: string; world?: World } = {}): Loaded {
  const data = buildRecords(profile.zone, scene, archive);
  const world = opts.world ?? new World();
  world.zone = profile.zone;
  world.records = data.records;
  world.col.records = data.records;
  world.col.groundRec = profile.ground ? data.records.find((r) => r.name === profile.ground) ?? null : null;
  world.seaLevel = profile.seaLevel;
  world.gravity = profile.gravity;
  world.hub = profile.hub;
  world.vars.set(V.CURRENT_SUBGAME, profile.subgame);
  world.vars.set(V.PEPPER_CONTROL, 1);
  world.pep.mailbox = ST.IDLE;
  profile.tweak?.(data.records);
  for (const i of profile.hide) data.records[i]?.hide();
  const pepper = data.records.find((r) => r.name === 'PEPP');
  if (!pepper) throw new Error(`${profile.zone}: no PEPP record`);
  const st = profile.start?.(archive, data.records, opts.from ?? '');
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
  if (mf) { pepper.anim = new AnimInstance(mf); pepper.anim.start(ST.IDLE, 0); }
  pepper.rebuildYaw();
  // the player's node chain (FUN_004b4220): PepSwitc always, SGwalk for mode 1, sgswim for mode 2
  pepper.ctrl = null;
  attachNode(pepper, 'PepSwitc', 0, V.PEPPER_CONTROL, 0, 0);
  const walk = attachNode(pepper, 'SGwalk', 1, V.PEPPER_CONTROL, 1, 1) as WalkNode;
  const swim = attachNode(pepper, 'sgswim', 2, V.PEPPER_CONTROL, 2, 2) as SwimNode;
  // the skateboard record is hidden while walking / swimming (DAT_009daa7c = 9 in the island)
  walk.accessory = profile.zone === 'z02LGI' ? data.records[9] ?? null : null;
  swim.accessory = walk.accessory;
  world.focus = pepper;
  world.camera.vehicle = false;
  world.camera.init(pepper);
  return { world, data, pepper, profile, walk, rigs };
}
