// The generic overlay screens of the zone loop template (docs/re/m3/ui.md): the controls help of mode 9 (FUN_00461155 stores the request, FUN_00461347 draws it
// at the text flush, FUN_00461175 = the help panel, FUN_00460f31 = parser of a `CONTROLn` line), the panel itself (FUN_00460a66, requested through
// FUN_00460a3d(0x16, 0x14, 0) for the intro of mode 1 and the end banner of mode 4), the intro / banner text helpers (FUN_00439c6f calls of the loops) and the
// cutscene-style subtitle (FUN_0045d47f + FUN_00460003). Everything is drawn in the 640x480 virtual grid of the original with the 24 pixel tiles of the menu
// texture set (`menu/mOverlays`, the same tiles as the menus: shell/menudraw.ts); the "button icons" of the help are key caps (tile 0x3c, 4 tiles wide) that
// carry the NAME OF THE KEY the player bound to that button (FUN_004384c9 -> FUN_0043839f), not an icon texture.
import type { Ui2D, UiTextureSet } from '../ui/renderer2d.ts';
import type { MessageTable } from '../ui/strings.ts';
import { uiOffsets } from './uioffsets.ts';

const WHITE = 0xffffffff;
/** FUN_00460a3d(0x16, 0x14, 0): panel width in tiles (half width 0x16 / 2 = 11) and the height of the full screen panel (20 rows of 24 px = 480 px) */
export const PANEL_WIDTH = 0x16;
export const PANEL_FULL_ROWS = 0x14;
/** DAT_008a991c / DAT_008a9918: text offset of the row texts, of the title: the executable's globals (uioffsets.ts: 14 / -4 only before the first FUN_004201aa, 0x12 / -2 afterwards) */

/** what the panel functions need from the shell */
export interface PanelEnv {
  /** the menu texture set (`menu/mOverlays`, DAT_008a9604): null draws nothing (a missing set must not paint white boxes) */
  set: UiTextureSet | null;
  /** text of `!PRESS` (PAUSE.str: "Druk op een toets om door te gaan...") */
  press?: string;
  /** text of `!FECONTRL` (FRONTEND.str: "BESTURING"), the title of the help panel */
  title?: string;
  /** name of the key currently bound to a logical button bit (4 up, 8 down, 1 left, 2 right, 0x10 button 1 ... 0x80 button 4), FUN_004384c9; absent: the button token */
  keyName?(bit: number): string;
  /** raw text of a message id of the menu table (FUN_004396a0 on DAT_008a9600: localised key names such as SPACE -> SPATIE), null when missing */
  menuText?(id: string): string | null;
}
/** old signature of `drawHelp` took the texture set only */
export type HelpOpts = Omit<PanelEnv, 'set'> & { set?: UiTextureSet | null };

/**
 * FUN_00460a66(width, rows, withTitle): the panel of the intro / help / banner screens. Tile rows of 24 px, the panel is centred vertically and spans
 * 2 * (width / 2 + 1) + 2 tile columns around x = 320: top border (row 0), optionally a two row title bar with the title in the big font (`withTitle`, the
 * help), plain rows, the PRESS text on the last plain row and the bottom border. Tile numbers are the absolute indices of the menu set (theme 0 of the
 * menu panels: 0xf / 3 / 0x12 top, 9 / 0 / 0xc sides and fill, 0x15 / 6 / 0x18 bottom, 0x36 the 2 tile wide notch under the title).
 */
export function drawPanel(ui: Ui2D, env: PanelEnv, rows: number, withTitle: boolean, width = PANEL_WIDTH) {
  const hw = Math.trunc(width / 2);
  const yoff = Math.trunc((480 - rows * 0x18) / 2);   // iVar1
  const y2 = yoff + 0x18;                              // iVar2: the y origin of the tile rows
  const set = env.set;
  const tile = (tex: number, col: number, row: number) => { if (set) ui.sprite(set, tex, [col * 24 + 320, y2 + (row - 1) * 24, (col + 1) * 24 + 320, y2 + row * 24], WHITE); };
  const tile2 = (tex: number, col: number, row: number) => { if (set) ui.sprite(set, tex, [col * 24 + 320, y2 + (row - 1) * 24, (col + 2) * 24 + 320, y2 + (row + 1) * 24], WHITE); };
  // top border
  tile(0xf, -2 - hw, 0);
  for (let c = -1 - hw; c < hw + 1; c++) tile(3, c, 0);
  tile(0x12, hw + 1, 0);
  let row = 1;
  if (withTitle) {
    const title = env.title ?? 'BESTURING';
    const half = Math.trunc(ui.measure(1, title).w / 0x30);   // iVar4 = width / 0x30
    tile(9, -2 - hw, 1); tile(9, -2 - hw, 2);
    let c = -1 - hw;
    for (; c < -1 - (half + 1); c++) { tile(0, c, 1); tile(0, c, 2); }
    for (c = -1 - (half + 1); c < half + 2; c += 2) tile2(0x36, c, 1);
    for (c = half + 2; c < hw + 1; c++) { tile(0, c, 1); tile(0, c, 2); }
    tile(0xc, c, 1); tile(0xc, c, 2);
    ui.text(1, title, 320, y2 + 24 + uiOffsets.titleDy, { colour: 1, align: 'centre' });
    row = 3;
  }
  for (; row < rows - 1; row++) {
    tile(9, -2 - hw, row);
    for (let c = -1 - hw; c < hw + 1; c++) tile(0, c, row);
    tile(0xc, hw + 1, row);
  }
  ui.text(0, env.press ?? '', 320, y2 + (row - 1) * 24 + uiOffsets.itemDy, { colour: 1, align: 'centre' });
  tile(0x15, -2 - hw, row);
  for (let c = -1 - hw; c < hw + 1; c++) tile(6, c, row);
  tile(0x18, hw + 1, row);
}

// ---------------------------------------------------------------------------------------------------------------------------------- the help

/** FUN_00460f31: the button tokens of a `CONTROLn` line and the logical button bit each stands for (the order of its strcmp chain; bits as in game/input.ts) */
export const CONTROL_BUTTONS: readonly (readonly [string, number])[] = [
  ['BUTTON_UP', 4], ['BUTTON_DOWN', 8], ['BUTTON_LEFT', 1], ['BUTTON_RIGHT', 2], ['BUTTON_2', 0x20], ['BUTTON_1', 0x10], ['BUTTON_4', 0x80], ['BUTTON_3', 0x40],
];
export interface ControlLine {
  /** false: the line does not start with a known button token (the original then shows the whole raw line centred and stops listing) */
  ok: boolean;
  /** one or two logical button bits ("BUTTON_LEFT+BUTTON_4 label" has two) */
  buttons: number[];
  /** the text after the button token(s); the raw line when `ok` is false */
  label: string;
  raw: string;
}

/** FUN_00460f31 on the raw text (unexpanded, FUN_004396a0) of the line `CONTROLn`: token up to ' ' or '+'; a '+' announces a second token; the label starts after the last separator */
export function parseControlLine(raw: string): ControlLine {
  const token = (from: number): { bit: number; sep: string; next: number } | null => {
    let p = from;
    while (p < raw.length && raw[p] !== ' ' && raw[p] !== '+') p++;
    if (p >= raw.length) return null;           // hit the end of the text: the original returns 0
    const hit = CONTROL_BUTTONS.find(([name]) => name === raw.slice(from, p));
    return hit ? { bit: hit[1], sep: raw[p], next: p + 1 } : null;
  };
  const bad: ControlLine = { ok: false, buttons: [], label: raw, raw };
  const a = token(0);
  if (!a) return bad;
  if (a.sep !== '+') return { ok: true, buttons: [a.bit], label: raw.slice(a.next), raw };
  const b = token(a.next);   // the second call skips the first token and its separator (FUN_00460f31 with the flag set)
  if (!b) return bad;
  return { ok: true, buttons: [a.bit, b.bit], label: raw.slice(b.next), raw };
}

/**
 * Mode 9 of the zone loops: FUN_00461155(strfile, n) every frame, drawn by FUN_00461175: the panel (`n + 7` rows, title BESTURING) and per line `CONTROL<i>`
 * a 4 tile wide key cap (tile 0x3c) at tile column -8 (two buttons: another one at -12) with the key name centred on it (white, small font), the label left
 * aligned at tile column -3. A line that does not parse is drawn raw and centred and ends the list. `set` is the menu texture set (an `opts.set` wins).
 */
export function drawHelp(ui: Ui2D, set: UiTextureSet | null, strings: MessageTable | null, n: number, opts: HelpOpts = {}) {
  const env: PanelEnv = { set: opts.set ?? set, press: opts.press, title: opts.title, keyName: opts.keyName, menuText: opts.menuText };
  drawPanel(ui, env, n + 7, true);
  const y0 = Math.trunc((480 - (n + 7) * 0x18) / 2);
  const cap = (col: number, row: number) => { if (env.set) ui.sprite(env.set, 0x3c, [col * 24 + 320, y0 + (row - 1) * 24, (col + 4) * 24 + 320, y0 + row * 24], WHITE); };
  const textAt = (align: 'left' | 'centre', s: string, col: number, row: number) => ui.text(0, s, col * 24 + 320, y0 + row * 24 + uiOffsets.itemDy, { colour: 1, align });
  const name = (bit: number) => {
    const id = env.keyName ? env.keyName(bit) : (CONTROL_BUTTONS.find(([, b]) => b === bit)?.[0] ?? '--');
    return env.menuText?.(id) ?? id;
  };
  for (let i = 0; i < n; i++) {
    const raw = strings?.raw(`CONTROL${i}`) ?? `CONTROL${i}`;
    const line = parseControlLine(raw);
    const row = i + 4;
    if (!line.ok) { textAt('centre', raw, 0, row); return; }
    cap(-8, row);
    if (line.buttons.length === 1) textAt('centre', name(line.buttons[0]), -6, row);
    else {
      cap(-12, row);
      textAt('centre', name(line.buttons[0]), -10, row);
      textAt('centre', name(line.buttons[1]), -6, row);
    }
    textAt('left', line.label, -3, row);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- intro and banner

/** one text line of an intro / banner screen: FUN_00439c6f(table, font 1 (main), id, 1, colour 0, x 320, y, wrap) */
export interface ScreenLine {
  /** the finished (expanded) text */
  text: string;
  y: number;
  /** wrap width in characters (30 = 0x1e, 36 = 0x24, 28, 32 ...) */
  wrap?: number;
  /** x (default 320 = 0x140) */
  x?: number;
}

/** mode 1 of the zone loops: panel (FUN_00460a3d(0x16, 0x14, 0)) with the brief lines (big font, yellow, wrapped and centred) and the PRESS text */
export function drawIntroScreen(ui: Ui2D, env: PanelEnv, lines: readonly ScreenLine[]) {
  drawPanel(ui, env, PANEL_FULL_ROWS, false);
  for (const l of lines) ui.text(1, l.text, l.x ?? 320, l.y, { colour: 0, maxChars: l.wrap ?? 30 });
}

/** medal of a result for the banner: 0 none (failed), 1 bronze, 2 silver, 3 gold */
export type Medal = 0 | 1 | 2 | 3;
/** STD.str ids of the medal texts */
export const MEDAL_IDS = ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD'] as const;

export interface BannerSpec {
  /** the score line: `%d` of the score through the raw text path (FUN_00439c6f(0, font, "%d", ...)), default y 100 as in z38PAR; null: none */
  score?: { text: string; y?: number } | null;
  /** the medal (0: no medal text); its text comes from STD.str (`std`), default y 150 (0x96) as in z38PAR, wrap 30 */
  medal?: Medal;
  medalY?: number;
  /** the result lines of the zone table (LESGPT02 ...), default wrap 36 (0x24) and the y positions the zone gives (z38PAR: 200 / 280 / 320 / 380 ...) */
  lines?: readonly ScreenLine[];
}

/** the text lines of a banner in drawing order (pure, tested): the score, the medal text, the zone's result lines */
export function bannerLines(spec: BannerSpec, std: { text(id: string): string }): ScreenLine[] {
  const out: ScreenLine[] = [];
  if (spec.score) out.push({ text: spec.score.text, y: spec.score.y ?? 100, wrap: 30 });
  if (spec.medal) out.push({ text: std.text(MEDAL_IDS[spec.medal]), y: spec.medalY ?? 150, wrap: 30 });
  for (const l of spec.lines ?? []) out.push({ wrap: 36, ...l });
  return out;
}

/** mode 4: the end banner, the same panel as the intro (FUN_00460a3d(0x16, 0x14, 0)) with `bannerLines` on it */
export function drawBannerScreen(ui: Ui2D, env: PanelEnv, spec: BannerSpec, std: { text(id: string): string }) {
  drawIntroScreen(ui, env, bannerLines(spec, std));
}

// ---------------------------------------------------------------------------------------------------------------------------------- subtitle

/** the cutscene subtitle (HUD state of DrawHUD.c): four lines centred on x = 400 / 800 of the screen, y = 494 / 518 / 542 / 566 of the 600 high reference grid, small font (csm = Balloon12), yellow */
export const SUBTITLE_Y = [494, 518, 542, 566].map((y) => Math.trunc((y * 480) / 600));
/** FUN_004606e3: line width limit in pixels = ftol(280 * W / 800) * 2 (W = 640) */
export const SUBTITLE_MAX_WIDTH = Math.trunc((280 * 640) / 800) * 2;
export const SUBTITLE_LINES = 4;

/**
 * FUN_0045d47f + FUN_0045d34b: break `text` into at most four lines no wider than `maxWidth` pixels (`measure` = text width in the subtitle font): characters
 * are taken until the line is too wide, then it backs up to the last ' ' or '.', trailing spaces are dropped and the rest continues on the next line (leading
 * spaces skipped). The 0x92 character of the string tables is turned into an apostrophe first. Text beyond the fourth line is dropped.
 */
export function wrapSubtitle(text: string, measure: (s: string) => number, maxWidth = SUBTITLE_MAX_WIDTH): string[] {
  let rest = text.split('\x92').join("'");
  const lines: string[] = [];
  while (rest.length > 0 && lines.length < SUBTITLE_LINES) {
    rest = rest.replace(/^ +/, '');
    if (rest.length === 0) break;
    let n = 0;
    while (n < rest.length && measure(rest.slice(0, n + 1)) <= maxWidth) n++;
    let cut = n;                                  // everything fits: the whole rest
    if (n < rest.length) {
      let k = n;                                  // back up to a ' ' or '.'
      while (k > 0 && rest[k - 1] !== ' ' && rest[k - 1] !== '.') k--;
      // the original keeps the separator index as the next start; a break right after a space drops the space
      cut = k > 0 ? k : n;                        // no separator at all: hard break (the original would run off the buffer)
    }
    const line = rest.slice(0, cut).replace(/ +$/, '');
    lines.push(line);
    rest = rest.slice(cut);
  }
  return lines;
}

/** draw a subtitle (a spoken line shown while the subtitle option is on) like the cutscene HUD: wrapped to four lines, centred at x = 320 */
export function drawSubtitle(ui: Ui2D, text: string) {
  const lines = wrapSubtitle(text, (s) => ui.measure(0, s).w);
  lines.forEach((l, i) => ui.text(0, l, 320, SUBTITLE_Y[i], { colour: 0, align: 'centre' }));
}
