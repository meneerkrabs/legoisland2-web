// Ported zone gameplay (M3+): what a zone module provides to the generic zone runner (playzone.ts). The runner owns the zone loop template (fade in / out,
// intro, help, pause, banner, result menu, exits: loopmachine.ts, docs/re/architecture.md 2.3), the scene (records, camera, 3D draw) and the shell state; a
// `ZoneGame` adds the zone's own rules on top of it: the update of mode 2 (behaviours that need a custom record set-up, scoring, timers, results) and the
// 2D layer. Behaviour nodes themselves are attached by constructor address (`registerCtor`, src/game/setup.ts) while the scene is set up.
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene } from '../formats/exe.ts';
import type { Loaded, ProfileOptions, ZoneProfile } from '../game/setup.ts';
import type { World } from '../game/world.ts';
import type { GameVars } from '../game/vars.ts';
import type { GameRenderer } from '../game/render.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { Ui2D, TextOpts } from '../ui/renderer2d.ts';
import type { Hud } from './hud.ts';
import type { CutsceneHost, CutsceneHostOptions } from './cutscene-host.ts';
import type { PanelEnv, BannerSpec, ScreenLine } from './helpscreen.ts';
import type { LoopConfig } from './loopmachine.ts';
import type { Shell } from './shell.ts';
import type { ZoneInfo } from './tables.ts';
import type { EntityRecord, SaveGame } from './save.ts';

/** a subtitle shown while a speech line plays (FUN_00435a11 + the subtitle option of the options menu) */
export interface Subtitle { id: string; text: string; ticksLeft: number }

/** what the runner hands to a zone game at construction (after the zone's set-up ran) */
export interface ZoneGameCtx {
  sh: Shell;
  info: ZoneInfo;
  cfg: LoopConfig;
  world: World;
  loaded: Loaded;
  archive: Archive;
  scene: ZoneScene;
  gr: GameRenderer;
  hud: Hud;
  vars: GameVars;
  /** the zone's own `.str` table(s) (`ZONE_FILES`), null when the zone has none */
  strings: MessageTable | null;
  /** STD.str (SGGOLD / SGSILVER / SGBRONZE) */
  std: MessageTable;
  /** 2D scale helpers: the 2D layer is the 640x480 virtual grid of the original's 0x280 x 0x1e0 mode (FUN_00439c6f scales by DAT_008a9920 / 0x280) */
  /** FUN_00439bf8 + FUN_00435a11: speak the zone-table lines `a` (and `b`) by message id (speech index = the id's voice field); the lines are shown as subtitles when the option is on. False while speech is busy. */
  say(a: string | null, b?: string | null): boolean;
  /** `say` with the lines of another message table (the island's story tables `lifsmN.str`: IslandCtx.say) */
  sayFrom(table: MessageTable | null, a: string | null, b?: string | null, voice?: boolean): boolean;   // voice false: the subtitle only (the hologram with the speech option off)
  /** FUN_00435ad3: true when no speech is playing (always true without audio, after the subtitle time) */
  speechIdle(): boolean;
  /** FUN_00435b07: stop the speech */
  stopSpeech(): void;
  /** the subtitle currently shown, if any */
  subtitle(): Subtitle | null;
  /** draw message `id` of the zone table (or STD with `std`) like FUN_00439c6f: wrapped at `maxChars`, centred at x, first baseline y (640x480 grid) */
  text(ui: Ui2D, id: string, x: number, y: number, o?: TextOpts & { font?: number; table?: 'zone' | 'std' | 'menu' }): void;
  /** play a sound by sound-table id (`world.sfx.play`) */
  sfx(id: number): void;
  /** the panel environment of the intro / help / banner screens (menu texture set, PRESS text, the key names of the player's bindings; helpscreen.ts) */
  panelEnv(): PanelEnv;
  /** draw the controls help panel for `n` `CONTROLn` lines of `table` (default: the zone table); a zone with a second help (z42BRP, loop mode 10) calls this from `draw2d` with its second table */
  help(ui: Ui2D, n: number, table?: MessageTable | null): void;
  /** a banner text line: message `id` of the zone table (`'std'`: STD.str), finished text at y, wrapped at `wrap` characters (default 36 = 0x24, the zone result lines) */
  line(id: string, y: number, wrap?: number, table?: 'zone' | 'std'): ScreenLine;
  /** draw the end banner of mode 4 (FUN_00460a3d panel + score / medal text / result lines, helpscreen.ts `BannerSpec`); a zone's `drawBanner` calls this */
  banner(ui: Ui2D, spec: BannerSpec): void;
  /** the cutscene manager (src/shell/cutscene.ts, cutscene-host.ts): `declare` the slots in the factory, `start` / `tick` where the zone loop calls FUN_0045c40c / FUN_0045c402 */
  cutscene: CutsceneHost;
  /** a run of the zone: 0 for the first start, +1 per restart (exit state 3) */
  attempt: number;
}

/** mode ids as in loopmachine.ts `MODE` */
export interface ZoneGame {
  /** overrides of the zone's loop config (intro / help on or off, pause kind ...) */
  config?: Partial<LoopConfig>;
  /** message id of the one-line brief of mode 1 (e.g. `LESGPT01`): drawn on the intro panel (helpscreen.ts `drawIntroScreen`) at y 120 (or the y zoneintro.ts has for that id), wrapped at 30; spoken when the loop starts (a button stops it). null / omitted: no brief. Ports with another layout set `introLines` */
  introId?: string | null;
  /** all text lines of the intro panel when the zone has more than one (z08BKD: CASGBD13 y 50 + CASGBD14 y 200); overrides `introId` (zoneintro.ts has every zone's values) */
  introLines?: { id: string; y: number; wrap?: number }[];
  /** number of `CONTROLn` lines of the controls help (mode 9, FUN_00461155(strfile, n)); omitted / 0: no help screen */
  helpControls?: number;
  /** false: mode 1 waits for ANY button (direction keys included, not Esc) without drawing the intro panel or speaking a brief (the island: FUN_004afaf7 mode 1 waits for DAT_00983840 != 0) */
  introPanel?: boolean;
  /** called every tick of mode 1 (the intro), before the button check; optional */
  introTick?(): void;
  /** the intro mode shows a cutscene first (z40aPO): while this returns true the runner draws no intro panel, speaks no brief (`introId` is spoken the tick it turns false) and ignores the buttons (the cutscene's skip key is handled by the cutscene) */
  introHold?(): boolean;
  /** mode 5 (the result menu) first runs a cutscene (z28HAT's outro ADV09): `resultTick` is called every tick of mode 5, the menu neither opens nor draws while `resultHold` returns true */
  resultHold?(): boolean;
  resultTick?(): void;
  /** mode 2 starts (after intro / help): music, sounds, timers */
  onStart?(): void;
  /**
   * One simulation tick of mode 2, called after `world.tick()` (behaviour nodes, camera). Returns the result when the game ended: 0 / undefined = running,
   * 1 = success, 2 = failed. The game writes its scores / trophies / game variables itself (as the original does before the end banner).
   */
  update(): number | undefined;
  /** called in mode 2 right before `world.tick()` (the island: the cutscene frame FUN_0045c402 runs before the controller update FUN_0042226e) */
  beforeTick?(): void;
  /** called in mode 2 after the story FSM's frame (FUN_00423bad) when it did not leave: the hub's story handler (z02LGI FUN_004b7040); a returned exit state leaves through the fade out */
  storyTick?(): number | undefined;
  /** the game ended (the loop went to mode 4): stop sounds, start the result speech (LESGPT0x lines) */
  onBanner?(result: number): void;
  /** draw the 2D layer: the HUD of mode 2 and the zone's overlays; `mode` = loop mode (2 play, 1 intro, 9 help, 4 banner ...), not called in the pause menu */
  draw2d?(ui: Ui2D, dt: number, mode: number): void;
  /** draw the end banner (mode 4: medal text, result lines); default: nothing (the runner draws a generic banner when this is missing) */
  drawBanner?(ui: Ui2D, result: number): void;
  /** the zone's loop runs its update in the end banner (mode 4) as well (the original updates in modes 2 and 4): the runner then ticks the world and calls `bannerTick` instead of `update` */
  tickInBanner?: boolean;
  /** called every tick of mode 4 (the end banner): with `tickInBanner` after the runner ticked the world; without it just a hook, e.g. to keep animating the player (z17WAS: Pepper's cheer / sad clip) */
  bannerTick?(): void;
  /** the end banner (mode 4) is left to the result menu without waiting for a button while this is true (z01BPK FUN_0048d8bd case 4: `DAT_05d580bc < 1`, no points) */
  skipBanner?(): boolean;
  /** called before every 3D render (camera / interpolation tweaks) */
  beforeRender?(alpha: number): void;
  /** called once at the end of every tick in every loop mode (fade, intro, help, play, pause, banner, result): zones whose camera / HUD code runs every pass of the original's loop (z20DSP FUN_006bd776) */
  everyTick?(mode: number): void;
  /** the zone ends (any exit): free what the game created */
  destroy?(): void;
  /** debug state for tests (exposed as `window.__zone.game.debug()`) */
  debug?(): unknown;
  /** rooms with their own menu (z04IFC): true while the zone's menu owns Esc, the pause trigger of FUN_00423170 is then skipped (FUN_00549911: `if (DAT_05d587c8 == 0)`) */
  blockPause?(): boolean;
  /**
   * a confirm dialog of mode 5 that the zone asks for from mode 2 (z04IFC: FUN_0041c080 + mode = 5, the exit question, page 15): `wanted()` true in play opens menu page `page`;
   * its result goes to `done`: true = the dialog's first action (page 15: "OK", the zone is left, exit state 2), false = the second one (page 15: "Annuleren", back to play)
   */
  dialog?: { page: number; wanted(): boolean; done(ok: boolean): void };
  /** overrides the zone a run ends with (the exit states of loopmachine.ts `EXIT`): undefined = the runner's mapping (`nextAfterExit`) */
  exitNext?(exit: number): number | undefined;
  /** a room asks to leave through the fade-out with this exit state (loopmachine.ts `EXIT`, 2 = finished): polled every tick of mode 2 after `update()` (z03PPH: the door, `DAT_05d587b0`) */
  leaveRequest?(): number | undefined;
  /** a zone with a second controls help (z42BRP, loop mode 10, `draw2d` is called with mode 10): polled every tick of mode 2 after `update()`; true = show it now (the world stands still until a button is pressed) */
  wantsHelp2?(): boolean;
  /** the second help was dismissed (z42BRP: the music groove changes) */
  onHelp2End?(): void;
}

export type ZoneGameFactory = (ctx: ZoneGameCtx) => ZoneGame | Promise<ZoneGame>;

/** hooks of a zone into the runner's set-up (before the zone game exists): the island runs its set-up in the x86 emulation and installs its context first */
export interface ZoneSetupHooks {
  /** options for `profileFor` (the island: `{ islandVars, archive }`) */
  profileOptions?(sh: Shell, archive: Archive): ProfileOptions;
  /** after `profileFor`, before `setupZone` (the profile may be adjusted: start place) */
  beforeSetup?(sh: Shell, world: World, profile: ZoneProfile, archive: Archive, scene: ZoneScene): void;
  /** right after `setupZone` */
  afterSetup?(sh: Shell, world: World, loaded: Loaded, archive: Archive): void;
  /** options of the zone's cutscene host (the island: the shared walker system with its maps, the set-up's name dictionaries) */
  cutsceneOptions?(sh: Shell, world: World, loaded: Loaded): CutsceneHostOptions;
  /** extra entities a save writes besides Pepper's (the island: the vehicle Pepper sits in; FUN_00418ec7 writes every record's) */
  saveEntities?(world: World): EntityRecord[];
  /** after a load was applied (variables + Pepper's place): restore what the entities / node state of the original's save would (the island: Pepper's vehicle) */
  restoreSave?(world: World, loaded: Loaded, save: SaveGame): void;
}
const setups = new Map<string, ZoneSetupHooks>();
export function registerZoneSetup(archive: string, hooks: ZoneSetupHooks) { setups.set(archive.toLowerCase(), hooks); }
export function zoneSetupFor(archive: string): ZoneSetupHooks | undefined { return setups.get(archive.toLowerCase()); }
const games = new Map<string, ZoneGameFactory>();
/** register the gameplay of a zone (archive name such as 'z05WAB', case-insensitive) */
export function registerZoneGame(archive: string, factory: ZoneGameFactory) { games.set(archive.toLowerCase(), factory); }
export function zoneGameFor(archive: string): ZoneGameFactory | undefined { return games.get(archive.toLowerCase()); }
export const registeredZoneGames = () => [...games.keys()];

/** medal level from a score and the (bronze, silver, gold) thresholds: 0 none, 1 bronze, 2 silver, 3 gold; `score >= t` (the zones that test `<` write their thresholds one higher) */
export function medalOf(score: number, bronze: number, silver: number, gold: number): 0 | 1 | 2 | 3 {
  return score >= gold ? 3 : score >= silver ? 2 : score >= bronze ? 1 : 0;
}
