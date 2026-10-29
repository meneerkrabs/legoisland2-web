// Pepper's house (z03PPH): the behaviour nodes the set-up attaches (FUN_0053ea4d, docs/re/m3/z03PPH.md) and the state they share. DOM-free.
//
//   record PEPP (33)  ClimLadr 0x5421af  @0 always      update 3; draw hook: Pepper is drawn only while walking (y clamp 12.8 never matters)
//                     SGwalk   0x42f470  @1 var 0x5e & 1  the M1 walk
//                     PeppComp 0x5400d5  @2 var 0x5e & 4  the computer (position, camera; the menu is stepped by the zone game: ComputerMenu)
//                     browser  0x541b79  @3 var 0x5e & 2  the trophy browser (update FUN_005414b0, camera FUN_005419dc)
//                     map view 0x541f94  @4 var 0x5e & 0x20  the wall map (update FUN_00541c98, camera FUN_00541e71)
//   record PHSE (6)   PeppHse  0x5408c4  hotspots (FUN_0054042d), the fixed cameras (FUN_00540733)
//   record DOOR (2)   0x540db1 the door (FUN_00540b96), record LND1 (0) 0x540f4e (always drawn)
//   records 8..30     Trophy 0x54116c / island trophy 0x5413c4: the trophy shown by the value of a TROPHY_xxx variable (FUN_00541034 / FUN_0054128c)
// Mode word var 0x5e (PEPPER_CONTROL): 1 walking, 4 computer, 2 trophy browser, 0x20 map view.
import { NODE_RERUN, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import type { ComputerMenu } from './computer.ts';
import { f32, subf, addf, easeToward, toWorldExact, eulerExact } from '../f32math.ts';
const F3 = (a: readonly (readonly number[])[]) => a.map((v) => v.map(f32) as unknown as readonly [number, number, number]);

/** PEPPER_CONTROL values of the house */
export const MODE = { WALK: 1, TROPHIES: 2, COMPUTER: 4, MAP: 0x20 } as const;
export const PEPPER_CONTROL = 0x5e;

/** constructor addresses (FUN_00423532's second argument) */
export const CTOR = {
  CLIMLADR: 0x5421af, PEPPCOMP: 0x5400d5, BROWSER: 0x541b79, MAPVIEW: 0x541f94, HOTSPOTS: 0x5408c4, DOOR: 0x540db1, LAND: 0x540f4e, TROPHY: 0x54116c, ISLAND_TROPHY: 0x5413c4,
} as const;

/** record indices of the house (builder order, FUN_00542b30: `DAT_00983804 + index * 0x68`) */
export const REC = { LND1: 0, DOOR: 2, PHSE: 6, FIRST_TROPHY: 8, LAST_TROPHY: 30, TIMM: 32, PEPP: 33 } as const;

// ---------------------------------------------------------------------------------------------------------------------------------- constants
/** FUN_005408c4: the two fixed camera positions (0x41266666 ...): [0] ground floor, [1] the start / upper floor; `cur` starts at [1] */
export const CAM_POS: readonly (readonly [number, number, number])[] = F3([[10.4, 8.8, -8.0], [0.0, 18.4, 8.48]]);
/** FUN_005408c4: hotspot centres (node +0x34, 12 bytes each), types (+0x70) and box half sizes (+0x84) */
export const HOTSPOT_POS: readonly (readonly [number, number, number])[] = F3([
  [-6.52, 0.96, -6.568], [-15.0, 0.96, 6.0], [-6.0, 0.96, 10.0], [10.772, 0.96, 3.8], [-6.0, 0.96, 10.0],
]);
/** 0 = just the box, 1 = the player has to face +z within 0.78 rad (|ry| <= 0.78), 2 = face -z (|ry - pi| <= 0.78) */
export const HOTSPOT_TYPE: readonly number[] = [0, 0, 1, 0, 0];
export const HOTSPOT_RADIUS: readonly number[] = [8.0, 8.0, 8.0, 80.0, 1.6].map(f32);
/** 0.78 (0x892600): the heading tolerance of FUN_005402ac */
export const HEADING_TOLERANCE = f32(0.78);
/** hotspot results (FUN_005402ac's return, 5 = none) -> what the player can do there */
export const HOTSPOT = { COMPUTER: 0, MAP: 1, DOOR: 2, TROPHIES: 3, DOOR_NEAR: 4, NONE: 5 } as const;
/** the HUD icon (column slot 0, Overlays/z03PPH) per hotspot: _DAT_05d4e144 */
export const ICON = { NONE: -1, DOOR: 0, TROPHIES: 1, COMPUTER: 2 } as const;
/** walking out of the door: z > 15.0 (0x892074) leaves the house */
export const EXIT_Z = 15.0;
/** camera easing factor of FUN_0054042d (0x8920cc = 0.1 per tick of the distance) and its snap distance */
export const CAM_EASE = f32(0.1);
/** FUN_00540b96: the door opens 5 degrees per tick up to 90 (0x892070 / 0x892598); position (-3.763, 0, 14.598) (FUN_00540b96's FUN_0043a5e4 call) */
export const DOOR_STEP = 5, DOOR_MAX = 90, DEG = 0.01745319925248623;
export const DOOR_POS: readonly [number, number, number] = [f32(-3.763), 0.0, f32(14.598)];
/** the computer: Pepper's place (FUN_0053ff69) and camera (FUN_0053ffa1: eye, look-at) */
export const COMPUTER_POS: readonly [number, number, number] = [f32(-6.52), f32(0.96), f32(-6.704)];
export const COMPUTER_EYE: readonly [number, number, number] = [f32(-8.4), f32(4.88), f32(-6.704)];
export const COMPUTER_LOOK: readonly [number, number, number] = [f32(-10.92), f32(4.88), f32(-6.704)];
/** trophy browser / map view: the camera starts and ends at this point (0x41266666, 0x41200000, 0xc13851ec) */
export const BROWSE_HOME: readonly [number, number, number] = [f32(10.4), 10.0, f32(-11.52)];
/** the browser camera follows the trophy with 0.2 of the distance per tick (0x8920f0), arrives within 0.1 (0x8920cc) */
export const BROWSE_EASE = f32(0.2), BROWSE_SNAP = f32(0.1);
/** FUN_005419dc: camera 2.24 in front of the trophy (z - 2.24), eye 1.44 and look-at 0.64 above the trophy for the mini-game trophies (kind 0) */
export const BROWSE_BACK = f32(2.24), BROWSE_EYE_UP = f32(1.44), BROWSE_LOOK_UP = f32(0.64);
/** FUN_00541f94 / FUN_00541e71: the wall map (TIMM) is looked at from 2.8 to its +x side */
export const MAP_TARGET: readonly [number, number, number] = [-15.0, 7.0, 6.0];
export const MAP_EYE_DX = f32(2.8);
/** the trophy sounds of the browser: the sound ids FUN_0053e7c0 loads into DAT_05d58714 + index * 4 (index = the third word of the attach), no trophy / no index */
export const TROPHY_SOUND: readonly number[] = [0x28a, 0x298, 0x28b, 0x28e, 0x292, 0x293, 0x297, 0x28f, 0x28d, 0x288, 0x296, 0x290, 0x28c, 0x294, 0x295, 0x291, 0x2e, 0xe3, 0x152, 0x102, 0x29d, 0x2fc, 0x32e];
export const SOUND_NO_TROPHY = 0x29a, SOUND_NO_INDEX = 0x299;
/** the record flags the trophy draw maps onto (FUN_00443f90: 0x100 / 0x200 / 0x400 force part 0 / 1 / 2): value 3 gold = part 0, 2 silver = part 1, 1 bronze = part 2 */
export const FORCE_PART = [0x8000, 0x400, 0x200, 0x100] as const;
export const FORCE_MASK = 0x8700;
/** the score line of the HUD stays on the screen after the browser is left (the original never clears DAT_05d4de4c): kept */
export const KEEP_STALE_SCORE_LINE = true;

// ---------------------------------------------------------------------------------------------------------------------------------- shared state
export interface HudLines { line1: string; line2: string; line3: string }

/** the globals of the house loop (DAT_05d587b0 / 05d587ac / 05d4e144 / 05d58784, the HUD text slots) */
export class HouseState {
  /** DAT_05d587b0: leave the house (the door, or walking out of it) */
  leave = false;
  /** DAT_05d587ac: the door is to be open */
  doorOpen = false;
  /** _DAT_05d4e144: HUD icon of the nearest hotspot */
  icon: number = ICON.NONE;
  /** the HUD text lines (message ids / strings): line 1 / 3 are message ids, line 2 a plain number; empty = not drawn */
  lines: HudLines = { line1: '', line2: '', line3: '' };
  /** the computer menu (set by the zone game; null in node tests without a menu) */
  computer: ComputerMenu | null = null;
  /** PeppComp ran this tick: the zone game steps the menu (the original does it in the draw hook) */
  computerRan = false;
  /** the browser: the trophy record shown (index into world.records; initially the first, TOGL) */
  trophyIndex: number = REC.FIRST_TROPHY;
  /** the browser / map camera focus points and their states (-1 fresh, 0 browsing, 1 leaving) */
  browseFocus: [number, number, number] = [0, 0, 0];
  browseState = -1;
  mapFocus: [number, number, number] = [0, 0, 0];
  mapState = -1;
  /** the camera easing point of the hotspot node (node +0x98) and the floor camera index (+0xa4) */
  camCur: [number, number, number] = [...CAM_POS[1]];
  camIdx = 1;
  /** diagnostics: hotspot of the last tick, trophy sounds played */
  lastHotspot: number = HOTSPOT.NONE;
  sounds: number[] = [];
}
const houses = new WeakMap<World, HouseState>();
export function houseOf(w: World): HouseState {
  let h = houses.get(w);
  if (!h) { h = new HouseState(); houses.set(w, h); }
  return h;
}

function setCam(w: World, eye: ArrayLike<number>, look: ArrayLike<number>) {
  const c = w.camera.c;
  c[0] = eye[0]; c[1] = eye[1]; c[2] = eye[2]; c[3] = look[0]; c[4] = look[1]; c[5] = look[2];
  c[6] = 0; c[7] = 1; c[8] = 0;
  w.camera.updateView();
}

/** the pepper record the nodes follow: the world's focus */
const pepperOf = (w: World): GameRecord => w.focus as GameRecord;

abstract class HouseNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord): number;
}

// ---------------------------------------------------------------------------------------------------------------------------------- ClimLadr
/**
 * ClimLadr (FUN_005421af, vtable 0x8eb7b8, record PEPP, no gate): its update returns 3 (FUN_00542090: ran, go on: the house has no exclusive node) and its draw hook (FUN_005420c4)
 * draws the record itself while Pepper walks (var 0x5e bit 0) with y clamped to 12.8 and returns 1; otherwise it draws nothing and returns 3: either way the default draw is skipped,
 * so **Pepper is only drawn while walking** (not at the computer, in the trophy browser or at the wall map). The clamp never matters: the ground of the house is at y = 0 everywhere
 * (the ladder code at 0x542259 is not attached by the set-up), so the port returns 0 ("not handled") while walking and the default draw does what the hook's FUN_00444480 does.
 */
export class ClimLadrNode extends HouseNode {
  readonly kind = 'ClimLadr';
  update(): number { return NODE_RERUN; }
  draw(w: World): number { return (w.vars.get(PEPPER_CONTROL) & 1) === 1 ? 0 : 3; }
}

// ---------------------------------------------------------------------------------------------------------------------------------- PeppComp
/** PeppComp (FUN_005400d5 / vtable 0x8eb480): while the computer is in use Pepper is put on the chair and the camera looks at the screen */
export class PeppCompNode extends HouseNode {
  readonly kind = 'PeppComp';
  update(w: World, rec: GameRecord): number {
    const st = houseOf(w);
    // FUN_0053ff69
    rec.x = COMPUTER_POS[0]; rec.y = COMPUTER_POS[1]; rec.z = COMPUTER_POS[2];
    st.computerRan = true;
    return NODE_STOP;
  }
  prerender(w: World) { setCam(w, COMPUTER_EYE, COMPUTER_LOOK); }   // FUN_0053ffa1
}

// ---------------------------------------------------------------------------------------------------------------------------------- hotspots / fixed cameras
/** FUN_005402ac: the first of the 5 hotspots whose box contains the player (and whose heading test holds), 5 = none */
export function scanHotspots(toWorld: (p: readonly number[]) => number[], px: number, pz: number, ry: number): number {
  for (let i = 0; i < 5; i++) {
    const t = HOTSPOT_TYPE[i];
    const heading = t === 2 ? Math.abs(subf(ry, f32(Math.PI))) : Math.abs(ry);
    if (t === 0 || heading <= HEADING_TOLERANCE) {
      const p = toWorld(HOTSPOT_POS[i]);
      if (Math.abs(subf(p[0], px)) <= HOTSPOT_RADIUS[i] && Math.abs(subf(p[2], pz)) <= HOTSPOT_RADIUS[i]) return i;
    }
  }
  return HOTSPOT.NONE;
}

/**
 * PeppHse on record PHSE (FUN_005408c4 / vtable 0x8eb538): the update (FUN_0054042d) eases the camera position towards the fixed camera of the player's floor
 * and, while walking, looks at the hotspots; the pre-render hook (FUN_00540733) writes the camera (eye = the eased position, look-at = the player, up = +y).
 *
 * Which camera is drawn (settled by the differential test m7-z03PPH-emu): the loop sets the view from the camera after the update pass (FUN_0053dfa2), but the camera
 * functions of the nodes (this one, PeppComp, the browser, the map) call FUN_0043cc5c themselves in the pre-render pass, which sets the device's view again, and the draw hook of
 * PeppHse (FUN_005407eb) re-applies the camera once more at record 6. Every record is therefore drawn with the camera the PRE-RENDER pass left, i.e. the real camera state:
 * eye = the eased fixed camera, look-at = the player's position (his feet). (Before WP-VERIFY the port drew the camera of the update pass, which looks 4 above the player.)
 */
export class HotspotNode extends HouseNode {
  readonly kind = 'PeppHse';
  update(w: World, rec: GameRecord): number {
    const st = houseOf(w), pep = pepperOf(w);
    // FUN_005401e0: the camera look-at is the player; the floor camera index is 0 when the player is not above the height of camera 0 (+0x18 = 8.8)
    st.camIdx = subf(pep.y, CAM_POS[0][1]) <= 0 ? 0 : 1;
    // ease the camera position
    easeToward(st.camCur, CAM_POS[st.camIdx], CAM_EASE, CAM_EASE);     // FUN_0054042d: the normalised delta scaled by dist * 0.1, snap below 0.1 (float32)
    const v = w.vars;
    if (v.get(PEPPER_CONTROL) === MODE.WALK) {
      if (EXIT_Z < pep.z) st.leave = true;
      const act = (w.input.pressed & B.SHIFT) !== 0;
      const h = scanHotspots((p) => toWorldExact(rec.m, p), pep.x, pep.z, pep.ry);
      st.lastHotspot = h;
      switch (h) {
        case HOTSPOT.COMPUTER:
          st.icon = ICON.COMPUTER; st.doorOpen = false;
          if (act) openComputer(w);
          break;
        case HOTSPOT.MAP:
          st.icon = ICON.NONE; st.doorOpen = false;
          if (act) v.set(PEPPER_CONTROL, MODE.MAP);
          break;
        case HOTSPOT.DOOR:
          st.icon = ICON.DOOR; st.doorOpen = true;
          if (act) st.leave = true;
          break;
        case HOTSPOT.TROPHIES:
          st.icon = ICON.TROPHIES; st.doorOpen = false;
          if (act) v.set(PEPPER_CONTROL, MODE.TROPHIES);
          break;
        case HOTSPOT.DOOR_NEAR:
          st.icon = ICON.DOOR; st.doorOpen = true;
          if (act) st.leave = true;
          break;
        default:
          st.icon = ICON.NONE; st.doorOpen = false;
      }
    }
    return NODE_STOP;       // FUN_0054042d returns 1 (alone in its chain)
  }
  prerender(w: World) {
    const st = houseOf(w), pep = pepperOf(w);
    // FUN_00540733
    setCam(w, st.camCur, [pep.x, pep.y, pep.z]);
  }
}

/** FUN_0053fed3(0): the player opens the computer (the menu starts from its root page) */
export function openComputer(w: World) {
  const st = houseOf(w);
  st.computer?.reset();
  w.vars.set(PEPPER_CONTROL, MODE.COMPUTER);
}

// ---------------------------------------------------------------------------------------------------------------------------------- door
/** the door record (FUN_00540db1 / vtable 0x8eb568): FUN_00540b96 swings it open while a door hotspot is active and closes it again */
export class DoorNode extends HouseNode {
  readonly kind = 'Door';
  /** node +0x18 (0 closed, 1 opening, 2 open, 3 closing) and +0x1c (angle in degrees) */
  state = 0; angle = 0;
  update(w: World, rec: GameRecord): number {
    const open = houseOf(w).doorOpen;
    switch (this.state) {
      case 0: this.angle = 0; if (open) this.state = 1; break;
      case 1:
        this.angle = f32(this.angle + DOOR_STEP);
        if (DOOR_MAX <= this.angle) this.state = 2;
        if (!open) this.state = 3;
        break;
      case 2: this.angle = DOOR_MAX; if (!open) this.state = 3; break;
      case 3:
        this.angle = f32(this.angle - DOOR_STEP);
        if (this.angle <= 0) this.state = 0;
        if (open) this.state = 1;
        break;
    }
    rec.m.set(eulerExact(0, f32(this.angle * DEG), 0)); rec.m[12] = DOOR_POS[0]; rec.m[13] = DOOR_POS[1]; rec.m[14] = DOOR_POS[2];   // FUN_0043a5e4
    return NODE_STOP;       // FUN_00540b96 returns 1 (the node is alone in its chain)
  }
}

/** LND1 (FUN_00540f4e): always drawn; nothing to do in the port */
export class LandNode extends HouseNode {
  readonly kind = 'PeppHseLand';
  update(): number { return NODE_STOP; }
}

// ---------------------------------------------------------------------------------------------------------------------------------- trophies
/**
 * Trophy / island trophy (FUN_0054116c / FUN_005413c4 -> vtable 0x8eb640 / 0x8eb658): the record shows the part of its model that the value of the trophy variable
 * selects: 3 gold = part 0, 2 silver = part 1, 1 bronze = part 2, 0 = nothing (FUN_00541034 / FUN_0054128c: `FUN_0043f160/180(model, part)` + `FUN_0043f1a0`).
 * The port draws every record itself, so the node sets the record's forced-part flags (0x100 / 0x200 / 0x400, FUN_00443f90) or hides it (0x8000).
 */
export class TrophyNode extends HouseNode {
  readonly kind: string;
  /** +0x14 kind: 0 = mini-game trophy, 1 = island trophy */
  readonly islandKind: number;
  /** +0x1c trophy variable, +0x20 high-score variable, +0x24 the sound index */
  trophyVar: number; hiscoreVar: number; sound: number;
  constructor(islandKind: number, args: number[]) {
    super();
    this.islandKind = islandKind;
    this.kind = islandKind ? 'TrophyIsland' : 'Trophy';
    [this.trophyVar, this.hiscoreVar, this.sound] = [args[0] ?? -1, args[1] ?? -1, args[2] ?? -1];
  }
  /** the tier shown for the current value (0 none ... 3 gold) */
  tier(w: World): number { return this.trophyVar === -1 ? 0 : Math.max(0, Math.min(3, w.vars.get(this.trophyVar))); }
  update(w: World, rec: GameRecord): number {
    rec.flags = (rec.flags & ~FORCE_MASK) | FORCE_PART[this.tier(w)];
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- the trophy browser
/** the level name id of a trophy (FUN_005414b0): LEVxxx from the record name; the skate park, the Adventurers' island and the palace are special */
export function trophyLevelId(recName: string): string {
  const n = recName.slice(1, 4);
  if (n === 'SKP') return 'LEVBPK';
  if (n === 'ADV') return 'LEVCAI';
  if (n === 'BPL') return 'LEVBRP';
  return 'LEV' + n;
}

/**
 * Trophy browser (FUN_00541b79 / vtable 0x8eb670, gate var 0x5e & 2): Left / Right step through the 23 trophies (records 8..30, wrapping), the camera flies to the
 * trophy (FUN_005414b0 update, FUN_005419dc camera), any other button leaves (the camera flies home, then PEPPER_CONTROL = 1). While the camera is on a trophy the
 * HUD shows its name and high score and the trophy jingle plays once.
 */
export class TrophyBrowserNode extends HouseNode {
  readonly kind = 'TrophyBrowser';
  /** node +0x54: the camera moved since the last arrival */
  moved = false;
  update(w: World): number {
    const st = houseOf(w), pressed = w.input.pressed;
    // the text slots 1 and 3 are cleared every frame (and not slot 2: a stale score line stays)
    st.lines.line1 = ''; st.lines.line3 = '';
    // FUN_005414b0 fetches the trophy node of the CURRENT record first (`local_10 = **(rec + 0x5c)`); a Left / Right in the same tick changes the record but the hi-score line, the sound and
    // the value test of this tick still use the old record's node (found by the oracle test: two trophies on the same spot let the camera arrive in the tick of the step)
    const node = w.records[st.trophyIndex].ctrl?.nodes[0] as TrophyNode | undefined;
    if (st.browseState === 0 && (pressed & ~3) !== 0) st.browseState = 1;     // any button but Left / Right (incl. Esc: the pause menu opens as well)
    if ((pressed & B.ALT) !== 0) st.browseState = 1;
    if ((pressed & B.SPACE) !== 0) st.browseState = 1;
    if ((pressed & B.LEFT) !== 0) { st.trophyIndex--; if (st.trophyIndex < REC.FIRST_TROPHY) st.trophyIndex = REC.LAST_TROPHY; }
    if ((pressed & B.RIGHT) !== 0) { st.trophyIndex++; if (st.trophyIndex > REC.LAST_TROPHY) st.trophyIndex = REC.FIRST_TROPHY; }
    if (st.browseState === -1) { st.browseFocus = [...BROWSE_HOME]; st.browseState = 0; }
    const cur = w.records[st.trophyIndex];
    const target: [number, number, number] = st.browseState === 1 ? [...BROWSE_HOME] : [cur.x, cur.y, cur.z];
    const f = st.browseFocus;
    if (easeToward(f, target.map(f32), BROWSE_EASE, BROWSE_SNAP)) {
      this.moved = true;
    } else {
      if (st.browseState === 0) {
        st.lines.line1 = 'HISCORE';
        st.lines.line2 = String(node && node.hiscoreVar >= 0 ? w.vars.get(node.hiscoreVar) : 0);
        st.lines.line3 = trophyLevelId(cur.name);
        if (this.moved && node) {
          const value = node.trophyVar >= 0 ? w.vars.get(node.trophyVar) : 0;
          let snd: number;
          if (value === 0) snd = SOUND_NO_TROPHY;
          else if (node.sound === -1) snd = SOUND_NO_INDEX;
          else snd = TROPHY_SOUND[node.sound] ?? SOUND_NO_INDEX;
          st.sounds.push(snd);
          w.playSound(snd);
        }
        this.moved = false;
      }
      if (st.browseState === 1) { st.browseState = -1; w.vars.set(PEPPER_CONTROL, MODE.WALK); }
    }
    return NODE_STOP;
  }
  prerender(w: World) {
    const st = houseOf(w), f = st.browseFocus;
    const tn = w.records[st.trophyIndex].ctrl?.nodes[0] as TrophyNode | undefined;
    // FUN_005419dc
    if (tn && tn.islandKind === 1) setCam(w, [f[0], f[1], subf(f[2], BROWSE_BACK)], f);
    else setCam(w, [f[0], addf(f[1], BROWSE_EYE_UP), subf(f[2], BROWSE_BACK)], [f[0], addf(f[1], BROWSE_LOOK_UP), f[2]]);
  }
}

/** the wall map (FUN_00541f94 / vtable 0x8eb688, gate var 0x5e & 0x20): the camera flies to the map (TIMM); any button flies it back, then PEPPER_CONTROL = 1 */
export class MapViewNode extends HouseNode {
  readonly kind = 'MapView';
  update(w: World): number {
    const st = houseOf(w), pressed = w.input.pressed;
    if (st.mapState === 0 && pressed !== 0) st.mapState = 1;
    if (st.mapState === -1) { st.mapFocus = [...BROWSE_HOME]; st.mapState = 0; }
    const target: readonly number[] = st.mapState === 1 ? BROWSE_HOME : MAP_TARGET;
    const f = st.mapFocus;
    if (!easeToward(f, target, BROWSE_EASE, BROWSE_SNAP)) {
      if (st.mapState === 1) { st.mapState = -1; w.vars.set(PEPPER_CONTROL, MODE.WALK); }
    }
    return NODE_STOP;
  }
  prerender(w: World) {
    const f = houseOf(w).mapFocus;
    setCam(w, [addf(f[0], MAP_EYE_DX), f[1], f[2]], f);     // FUN_00541e71
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- constructors by address
/** the node factories `registerCtor` takes (see src/zones/z03PPH.ts) */
export const FACTORIES: Record<number, (a: Attach) => BehaviourNode> = {
  [CTOR.CLIMLADR]: () => new ClimLadrNode(),
  [CTOR.PEPPCOMP]: () => new PeppCompNode(),
  [CTOR.BROWSER]: () => new TrophyBrowserNode(),
  [CTOR.MAPVIEW]: () => new MapViewNode(),
  [CTOR.HOTSPOTS]: () => new HotspotNode(),
  [CTOR.DOOR]: () => new DoorNode(),
  [CTOR.LAND]: () => new LandNode(),
  [CTOR.TROPHY]: (a) => new TrophyNode(0, a.argWords ?? []),
  [CTOR.ISLAND_TROPHY]: (a) => new TrophyNode(1, a.argWords ?? []),
};
