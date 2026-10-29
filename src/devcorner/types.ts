// The Ontwikkelaarshoek (developer corner): shared types. Everything under src/devcorner is only ever loaded and run in the port's debug mode (src/game/debug.ts);
// the shared files only call it through `dev?.` hooks that are null without the debug option (docs/re/devcorner.md).
import type { Shell } from '../shell/shell.ts';
import type { World } from '../game/world.ts';
import type { GameRenderer } from '../game/render.ts';
import type { Loaded } from '../game/setup.ts';
import type { LoopMachine } from '../shell/loopmachine.ts';
import type { ZoneInfo } from '../shell/tables.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import type { CutsceneHost } from '../shell/cutscene-host.ts';
import type { Hud } from '../shell/hud.ts';
import type { Archive } from '../formats/archive.ts';
import type { Renderer } from '../render/index.ts';
import type { DevCorner } from './corner.ts';

/** a running playable zone (`runPlayZone`): what the sections may use while the zone runs */
export interface ZoneRun {
  kind: 'zone';
  sh: Shell;
  info: ZoneInfo;
  world: World;
  gr: GameRenderer;
  loaded: Loaded;
  machine: LoopMachine;
  game: ZoneGame;
  ctx: ZoneGameCtx;
  cutscene: CutsceneHost;
  archive: Archive;
  hud: Hud | null;
  /** leave this zone for zone-table index `zone` (and story node `node` when given), the way the front end's checkpoint list does (pending override + exit to the zone loop) */
  leaveTo(zone: number, node?: number): void;
}
/** the running front end (`runFrontEnd`) */
export interface FrontRun {
  kind: 'front';
  sh: Shell;
  world: World;
  gr: GameRenderer;
  machine: LoopMachine;
  /** open page `n` of the menu engine (the original's pages 17 / 25 / 26 included) */
  openPage(page: number): void;
  /** leave the front end for zone `zone` / node `node` (like choosing a checkpoint) */
  leaveTo(zone: number, node?: number): void;
}
export type RunCtx = ZoneRun | FrontRun;

/** per-run hooks a section can install (they run while the corner is closed as well: free camera, autoplay, debug draw ...). Every member is optional. */
export interface RunHook {
  /** every tick right after `sh.input.update()`, before the game's own tick (may change `sh.input.held`, like the original's autoplay does in FUN_00423170) */
  tick?(): void;
  /** every tick of the play mode after the zone's simulation (world.tick + zone update): the free camera overwrites the camera here, like the original's calls after the update pass */
  afterSim?(): void;
  /** the story is forced on and the zone is left (F8 autoplay: FUN_00423f7b returns 1) */
  storyLeave?(): boolean;
  /** drawn inside the 3D frame after the effects (the debug-draw queue): the renderer is in frame, `viewProj` the frame's matrix */
  draw3d?(r: Renderer, eye: [number, number, number], viewProj: Float32Array | number[]): void;
  destroy?(): void;
}

/** the UI of one section */
export interface SectionView {
  el: HTMLElement;
  /** the tab was selected (refresh live values here) */
  show?(): void;
  hide?(): void;
  /** about 10 times a second while the section is visible and the corner is open */
  refresh?(): void;
}

export interface SectionDef {
  id: string;
  /** the Dutch label of the tab */
  title: string;
  /** one line under the title */
  blurb?: string;
  /** build the UI (called on the first time the tab is shown) */
  build(c: DevCorner): SectionView | Promise<SectionView>;
  /** hooks for a running zone / the front end; called when the run starts (also while the corner is closed) */
  attach?(c: DevCorner, run: RunCtx): RunHook | null;
}
