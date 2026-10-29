// Restored feature 'cave' (docs/re/restore-plan.md item 13, docs/re/restore.md): the developers' cave (z50LTC) reachable without typing the cheat SDREAMS, with its two Teleport sounds.
//
// ORIGINAL: the WORM portal record (370) and its scale-in by the island director (`FUN_004b7c78`, src/island/trigger/lgifsm.ts: var 0xd 1 -> 2 -> 5 at story node >= 0x3d), the box portal that leads
//   to z50LTC (var 5 = 0x22), the room z50LTC itself (src/zones/z50LTC.ts), Darren's hint at era 2 (LEDTHT25/26), the two sound files `z02LGI/Teleport.wav` / `Teleport2.wav` (unused by the original).
// RECONSTRUCTION: (1) that the unlock is the ending: with the option on var 0xd := 1 once when the story sits at node 68 (the free-roam island after the credits; the data only shows the hint and
//   the cheat); (2) the two sound events: `Teleport` when Pepper steps into the portal box (var 5 becomes 0x22 = z50LTC), `Teleport2` on arrival in the cave; the two table entries are new
//   (ids behind the executable's 902; `SND_CAI_PORTAL`, the half-finished entry that points at the directory `z02lgi\`, is left alone).
import type { Feature } from '../feature.ts';
import type { SoundTableEntry } from '../../formats/sound.ts';

/** story node of the ending (free roam), the variable that opens the portal, the variable that names the next zone and the cave's zone id */
const NODE_ENDING = 68, VAR_NODE = 0x58, VAR_CAVE = 0xd, VAR_NEXT_ZONE = 5, ZONE_LTC = 0x22;

interface GameLike {
  ctx: { vars: { get(i: number): number; set(i: number, v: number): void } };
  ictx: { sfx(id: number): void };
}

/** the sound-table ids of the two new entries (set by `soundPatch`; -1 until the table was read) */
export const TELEPORT = { enter: -1, arrive: -1 };
const ENTRY = (id: number, name: string, file: string): SoundTableEntry =>
  // volume / rate: the values of the half-finished `SND_CAI_PORTAL` entry (64, 22050 Hz = the wavs' own rate); once, 2D, centred
  ({ id, name, path: `_Data\\sounds\\\\z02LGI\\${file}`, volume: 64, loopCount: 1, minDist: 1, maxDist: 200, pan: 64, rate: 22050, loopCount2: 1 });

let unlocked = false;   // var 0xd was set by us this session
let entered = false;    // the enter sound played for this portal visit
let viaPortal = false;  // Pepper left the island through the portal: the cave's arrival sound is due (not for the story's own way to the cave, node 71)

export const feature: Feature = {
  id: 'cave',
  soundPatch(sounds) {
    const have = (name: string) => sounds.find((s) => s.name === name);
    const add = (name: string, file: string) => { let e = have(name); if (!e) { e = ENTRY(sounds.length, name, file); sounds.push(e); } return e.id; };
    TELEPORT.enter = add('SND_RESTORED_TELEPORT', 'Teleport.WAV');
    TELEPORT.arrive = add('SND_RESTORED_TELEPORT2', 'Teleport2.WAV');
  },
  islandStart() { entered = false; },
  islandTick(g) {
    const { ctx, ictx } = g as GameLike, v = ctx.vars;
    // the unlock: the ending opens the portal once (the director scales WORM in over 30 ticks and sets 5)
    if (!unlocked && v.get(VAR_NODE) === NODE_ENDING && v.get(VAR_CAVE) === 0) { v.set(VAR_CAVE, 1); unlocked = true; }
    // Pepper stepped into the portal box: the box portal wrote the cave's zone id to var 5
    const into = v.get(VAR_NEXT_ZONE) === ZONE_LTC;
    if (into && !entered && TELEPORT.enter >= 0) ictx.sfx(TELEPORT.enter);
    if (into) viaPortal = true;
    entered = into;
  },
  cue(name, ctx) {
    if (name !== 'ltc-arrive' || !viaPortal) return;
    viaPortal = false;
    if (TELEPORT.arrive >= 0) (ctx as { sfx?(id: number): void } | undefined)?.sfx?.(TELEPORT.arrive);
  },
};

/** test aid */
export function resetCave() { unlocked = false; entered = false; viaPortal = false; TELEPORT.enter = TELEPORT.arrive = -1; }
