// The loose context object the zones hand to `restoreHooks.cue(name, ctx)` (RECONSTRUCTION plumbing, docs/re/restore.md). Every member is optional: each zone passes what it has.
import type { Ui2D } from '../ui/renderer2d.ts';
import type { PopupHud } from './popup.ts';

export interface CueCtx {
  /** a sound by sound-table id: 2D / the zone's default path (`ZoneGameCtx.sfx`, `sfxAt` of the island) */
  sfx?(id: number): void;
  /** a positional sound by sound-table id (`sh.audio.playAt`) */
  sfxAt?(id: number, pos: readonly number[]): void;
  /** a zone's named sound bank (z22BIP, z28HAT: the names of their SOUNDS tables) */
  sound?: { play(name: string): void; at?(name: string, pos: ArrayLike<number>): void };
  /** the HUD (popups ride on `hud.extras`) and the zone's message table (`text(id)`) */
  hud?: PopupHud;
  strings?: { text(id: string): string } | null;
  /** z21FSH: `Popups.add(id, count, on, off, x, y)` of the zone's own message slots */
  addPopup?(id: string, count: number, on: number, off: number, x: number, y: number): void;
  /** the 2D draw layer while a banner is drawn */
  ui?: Ui2D;
  /** stop a sound by sound-table id (`sh.audio.stop`) */
  stop?(id: number): void;
  /** an object that identifies the zone run (the zone game): cues that keep state between calls (edges) key it on this */
  key?: object;
  /** a flag of the event (z03PPH: the computer menu is active) */
  active?: boolean;
  /** a position / a kind / a number of the event (zone specific) */
  pos?: readonly number[];
  kind?: string;
  result?: number;
}
