// The per-zone loop template of the original (docs/re/architecture.md 2.3, verified on FUN_00465d39, FUN_00470ac3, FUN_004afaf7): every zone loop has a
// `mode` and an `exit state`. This is that state machine without any drawing or simulation, so a zone only supplies its hooks. Pure, runs at the
// 30 Hz game tick (dt = 1): a fade takes 16 ticks (`f += 0.0625 * dt`).
//
// modes: 7 fade in, 0 init, 1 intro (one-line brief, wait for a button), 9 controls help, 2 play, 3 pause menu (FUN_0041bd3d), 4 end banner,
//        5 result menu (FUN_0041c092), 6 "pause requested" marker (FUN_00423170 maps it to 3), 8 fade out, 10 second help screen.
// exit state: 1 running, 0 quit to the front end, 2 finished, 3 restart, 4 left without completing, 6 story advanced, 8 var 5 != var 0x59.
import { B } from '../game/input.ts';

export const MODE = { PLAY: 2, PAUSE: 3, FADE_IN: 7, INIT: 0, INTRO: 1, HELP: 9, BANNER: 4, RESULT: 5, MARK: 6, FADE_OUT: 8, HELP2: 10 } as const;
export const EXIT = { RUNNING: 1, QUIT: 0, FINISHED: 2, RESTART: 3, ABANDON: 4, STORY: 6, VAR5: 8 } as const;

/** fade step per tick (0x8923cc = 0.0625) */
export const FADE_STEP = 0.0625;

export interface LoopConfig {
  /** kind-1 zone (hub): never reaches the banner / result modes */
  hub: boolean;
  /** pause page kind of FUN_0041bd3d: 0 = island pause (page 5), 1 = mini-game pause (page 18), 2 = page 29 */
  pauseKind: 0 | 1 | 2;
  /** the pause menu's disable mask (0x80 hides Abort / Restart in the island, 0x40 disables Save in mini-games) */
  pauseMask: number;
  /** show a one-line brief (mode 1) before play and wait for a button */
  intro: boolean;
  /** show the controls help (mode 9) before play */
  help: boolean;
  /** mini-game: results go through the banner (4) and the result menu (5) */
  results: boolean;
}

export const HUB_CONFIG: LoopConfig = { hub: true, pauseKind: 0, pauseMask: 0x80, intro: false, help: false, results: false };
export const MINIGAME_CONFIG: LoopConfig = { hub: false, pauseKind: 1, pauseMask: 0x40, intro: true, help: false, results: true };

/** what the host reports each tick */
export interface LoopInput {
  /** buttons that went down this tick */
  pressed: number;
  /** result of the pause menu step while mode 3 (FUN_0041bd3d): 0 stay, 1 resume, -1 quit to the menu, -2 restart, -3 abort */
  pauseResult?: number;
  /** result of the result menu step while mode 5 (FUN_0041c092): 0 stay, 1 continue, -2 retry, -3 quit, 99 back to play (a zone's own dialog) */
  resultResult?: number;
  /** the zone's own play state: the mini-game ended with this result (0 = still going, 1 = success, 2 = failed) -> banner */
  gameOver?: number;
  /** story advanced to another zone (FUN_00423bad returned 6) */
  storyAdvanced?: boolean;
  /** var 5 (NEXT_SUBGAME) differs from var 0x59 (CURRENT_SUBGAME) */
  varChanged?: boolean;
  /** the zone asks for its confirm dialog (mode 5 from mode 2: z04IFC's exit question) */
  dialog?: boolean;
}

export class LoopMachine {
  mode: number = MODE.FADE_IN;
  exit: number = EXIT.RUNNING;
  /** scene visibility 0..1 (FUN_0043ec80) */
  fade = 0;
  /** DAT_009da630: the mode to return to after the pause */
  saved: number = MODE.PLAY;
  /** exit state to take when the fade out ends (the original's local_14) */
  pending: number = EXIT.QUIT;
  cfg: LoopConfig;
  /** ticks spent in the current mode */
  age = 0;
  done = false;
  /** the mode of the previous tick (hosts react to transitions, e.g. opening the pause menu) */
  prevMode: number = MODE.FADE_IN;

  constructor(cfg: LoopConfig) { this.cfg = cfg; }

  private set(mode: number) { if (mode !== this.mode) { this.mode = mode; this.age = 0; } }

  /** leave through the fade out with `exit` as the final exit state */
  leave(exit: number) {
    if (this.mode === MODE.FADE_OUT) return;
    this.pending = exit;
    this.set(MODE.FADE_OUT);
  }

  /** FUN_00423170's pause trigger: Esc in any mode except 7, 8, 3 and 6 */
  private pauseTrigger(pressed: number) {
    if (this.mode === MODE.MARK) this.set(MODE.PAUSE);
    if ((pressed & B.ESC) && this.mode !== MODE.FADE_IN && this.mode !== MODE.FADE_OUT && this.mode !== MODE.PAUSE && this.mode !== MODE.MARK) {
      this.saved = this.mode;
      this.set(MODE.PAUSE);
    }
  }

  tick(inp: LoopInput) {
    this.prevMode = this.mode;
    this.age++;
    this.pauseTrigger(inp.pressed);
    switch (this.mode) {
      case MODE.FADE_IN:
        this.fade += FADE_STEP;
        if (this.fade >= 1) { this.fade = 1; this.set(this.cfg.intro ? MODE.INIT : MODE.INIT); }
        break;
      case MODE.INIT:
        this.set(this.cfg.intro ? MODE.INTRO : this.cfg.help ? MODE.HELP : MODE.PLAY);
        break;
      case MODE.INTRO:
        if (inp.pressed & (B.ENTER | B.SPACE | B.SHIFT | B.ALT | B.CTRL | B.ANY)) this.set(this.cfg.help ? MODE.HELP : MODE.PLAY);
        break;
      case MODE.HELP:
        if (inp.pressed & (B.ENTER | B.SPACE | B.SHIFT | B.ALT | B.CTRL | B.ANY)) this.set(MODE.PLAY);
        break;
      case MODE.PLAY:
        if (inp.dialog) { this.set(MODE.RESULT); break; }
        if (inp.gameOver && this.cfg.results) { this.set(MODE.BANNER); break; }
        if (inp.storyAdvanced) this.leave(EXIT.STORY);
        else if (inp.varChanged) this.leave(EXIT.VAR5);
        break;
      case MODE.PAUSE: {
        const r = inp.pauseResult ?? 0;
        if (r === 1) this.set(this.saved);
        else if (r === -1) this.leave(EXIT.QUIT);
        else if (r === -2) this.leave(EXIT.RESTART);
        else if (r === -3) this.leave(EXIT.ABANDON);
        break;
      }
      case MODE.BANNER:
        if (inp.pressed & (B.ENTER | B.SPACE | B.SHIFT | B.ALT | B.CTRL | B.ANY)) this.set(MODE.RESULT);
        break;
      case MODE.RESULT: {
        const r = inp.resultResult ?? 0;
        if (r === 1) this.leave(EXIT.FINISHED);
        else if (r === 99) this.set(MODE.PLAY);   // a zone's own dialog was cancelled: back to play (FUN_0054996a case 3: `-2` -> mode 2)
        else if (r === -2) this.leave(EXIT.RESTART);
        else if (r === -3) this.leave(EXIT.ABANDON);
        break;
      }
      case MODE.FADE_OUT:
        this.fade -= FADE_STEP;
        if (this.fade <= 0) { this.fade = 0; this.exit = this.pending; this.done = true; }
        break;
    }
  }
}
