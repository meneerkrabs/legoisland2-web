// M3 generic UI: the controls help (mode 9), intro / banner panels, subtitle, and the per-zone intro table (src/shell/helpscreen.ts, zoneintro.ts, docs/re/m3/ui.md).
// Checks: CONTROLn line parsing (FUN_00460f31), the panel / help geometry (FUN_00460a66 / FUN_00461175 / FUN_004607c4) through a recording stub of Ui2D, the banner
// line list, the subtitle wrapping (FUN_0045d34b), and every value of ZONE_INTRO against the `.str` tables and against the executable (the push immediates of the
// FUN_00461155 / FUN_00439c6f call sites).
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { loadMessages, ZONE_FILES, FRONTEND_FILES, STD_FILES } from '../../src/ui/strings.ts';
import { readZoneTable } from '../../src/shell/tables.ts';
import { readKeyNames, keyCodeName } from '../../src/shell/dik.ts';
import { readKeyTable } from '../../src/game/input.ts';
import {
  parseControlLine, CONTROL_BUTTONS, drawPanel, drawHelp, drawIntroScreen, bannerLines, wrapSubtitle, drawSubtitle, SUBTITLE_Y, SUBTITLE_MAX_WIDTH, MEDAL_IDS,
} from '../../src/shell/helpscreen.ts';
import { ZONE_INTRO, zoneIntroFor } from '../../src/shell/zoneintro.ts';
import { resetUiOffsets } from '../../src/shell/uioffsets.ts';

/** a recording stand-in for Ui2D: every sprite / text call is kept; text is 10 px per character */
function stubUi() {
  const sprites = [], texts = [];
  return {
    sprites, texts,
    sprite: (set, tex, rect, argb) => { sprites.push({ tex, rect, argb }); },
    text: (font, s, x, y, o = {}) => { texts.push({ font, s, x, y, o }); return 1; },
    measure: (font, s) => ({ w: s.length * (font === 1 ? 14 : 10), h: 20 }),
  };
}

/** call sites of FUN_00461155 (address of the `call`), expected number of controls */
const HELP_CALLS = {
  z38PAR: [[0x46698a, 6]], z05WAB: [[0x569981, 4]], z08BKD: [[0x5b8891, 5]], z09JST: [[0x5cd8fe, 7]], z10RGB: [[0x5f46b4, 0xb]], z15SSH: [[0x657252, 5]], z17WAS: [[0x699742, 5]],
  z18MMP: [[0x6a2ed2, 5]], z20DSP: [[0x6be1a0, 5]], z21FSH: [[0x6f3b32, 4]], z22BIP: [[0x7071e4, 5]], z27TRX: [[0x765e2a, 6]], z28HAT: [[0x79168a, 5]], z36CNT: [[0x7af595, 4]],
  z39ASB: [[0x7b69e5, 4]], z40aPO: [[0x7d0579, 6]], z41MAP: [[0x8120a4, 7]], z42BRP: [[0x8208c3, 3], [0x8208f6, 5]],
};

export default {
  name: 'm3-ui',
  run(ctx) {
    resetUiOffsets();   // the geometry below is the one with the executable's start-up offsets (14 / -4); FUN_004201aa makes them 0x12 / -2 (uioffsets.ts)
    const failures = [], notes = [];
    let checked = 0;
    const ok = (msg, c) => { checked++; if (!c) failures.push(msg); };
    const eq = (what, got, want) => { checked++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

    // ---- CONTROL line parser (FUN_00460f31)
    eq('one button', parseControlLine('BUTTON_UP Vooruit draaien'), { ok: true, buttons: [4], label: 'Vooruit draaien', raw: 'BUTTON_UP Vooruit draaien' });
    eq('two buttons', parseControlLine('BUTTON_LEFT+BUTTON_4 Vulling gooien (links)'), { ok: true, buttons: [1, 0x80], label: 'Vulling gooien (links)', raw: 'BUTTON_LEFT+BUTTON_4 Vulling gooien (links)' });
    eq('every token', CONTROL_BUTTONS.map(([n]) => parseControlLine(`${n} x`).buttons[0]), [4, 8, 1, 2, 0x20, 0x10, 0x80, 0x40]);
    ok('no token: not ok, raw label', !parseControlLine('Druk tweemaal voor de edelsteen').ok && parseControlLine('Druk tweemaal voor de edelsteen').label === 'Druk tweemaal voor de edelsteen');
    ok('unknown token fails', !parseControlLine('BUTTON_9 x').ok);
    ok('token without separator fails', !parseControlLine('BUTTON_UP').ok);
    ok('second token unknown fails', !parseControlLine('BUTTON_UP+FOO x').ok);
    eq('label keeps its inner spaces', parseControlLine('BUTTON_3 Op deksel kloppen (openen)').label, 'Op deksel kloppen (openen)');

    // ---- panel geometry (FUN_00460a66) on the stub
    {
      const ui = stubUi();
      drawIntroScreen(ui, { set: {}, press: 'PRESS' }, [{ text: 'brief', y: 120, wrap: 30 }]);
      eq('intro panel: 20 rows x 26 columns', ui.sprites.length, 520);
      eq('intro panel spans the whole screen', [Math.min(...ui.sprites.map((s) => s.rect[1])), Math.max(...ui.sprites.map((s) => s.rect[3]))], [0, 480]);
      eq('intro panel columns 8..632', [Math.min(...ui.sprites.map((s) => s.rect[0])), Math.max(...ui.sprites.map((s) => s.rect[2]))], [8, 632]);
      eq('top left / right corner tiles', [ui.sprites[0].tex, ui.sprites[25].tex], [0xf, 0x12]);
      ok('bottom border tiles 0x15 / 6 / 0x18', ui.sprites.slice(-26)[0].tex === 0x15 && ui.sprites.slice(-26)[1].tex === 6 && ui.sprites.slice(-1)[0].tex === 0x18);
      const press = ui.texts.find((t) => t.s === 'PRESS');
      eq('PRESS text: small font, white, centred, y 452', press && [press.font, press.o.colour, press.x, press.y], [0, 1, 320, 452]);
      const brief = ui.texts.find((t) => t.s === 'brief');
      eq('brief: big font, yellow, wrap 30 at (320, 120)', brief && [brief.font, brief.o.colour, brief.o.maxChars, brief.x, brief.y], [1, 0, 30, 320, 120]);
      const u2 = stubUi();
      drawPanel(u2, { set: {} }, 20, false);
      ok('panel with a missing texture set draws no sprite', (() => { const u = stubUi(); drawPanel(u, { set: null }, 20, false); return u.sprites.length === 0; })());
    }
    // ---- help on the stub: n = 6 (z38PAR), real texts
    const dataDir = ctx.dataDir ?? path.join(ctx.dataRoot, '_data');
    const messages = ctx.archives.find((a) => a.name === 'messages');
    ok('messages archive', !!messages);
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!messages || !fs.existsSync(exePath)) return { checked, failures: [...failures, 'missing data'], notes };
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));
    const tables = {};
    const tableOf = (z) => (tables[z] ??= (ZONE_FILES[z]?.length ? loadMessages(messages, ZONE_FILES[z]) : null));
    const std = loadMessages(messages, STD_FILES);
    const front = loadMessages(messages, FRONTEND_FILES);
    const keyNames = readKeyNames(pe), keyTable = readKeyTable(pe);
    const keyName = (bit) => { const b = keyTable.find((x) => x.bit === bit); return b ? keyCodeName(0x10000 | b.dik, keyNames) : '---'; };
    {
      const ui = stubUi();
      drawHelp(ui, {}, tableOf('z38PAR'), 6, { press: 'PRESS', title: 'BESTURING', keyName, menuText: (id) => front.raw(id) });
      // panel: n + 7 = 13 rows, 26 columns, plus 6 key caps (tile 0x3c) and the title notch
      const caps = ui.sprites.filter((s) => s.tex === 0x3c);
      eq('6 key caps', caps.length, 6);
      const y0 = Math.trunc((480 - 13 * 24) / 2);
      eq('first cap at x 128..224, y of panel row 3', [caps[0].rect[0], caps[0].rect[2], caps[0].rect[1], caps[0].rect[3]], [128, 224, y0 + 72, y0 + 96]);
      const texts = ui.texts.map((t) => t.s);
      eq('key name on the first cap (UP is localised by FRONTEND.str: OMHOOG), then the label', texts.slice(2, 4), ['OMHOOG', 'Vooruit draaien']);
      ok('title and press', texts.includes('BESTURING') && texts.includes('PRESS'));
      const label = ui.texts.find((t) => t.s === 'Vooruit draaien');
      eq('label left aligned at tile column -3 (x 248)', [label.x, label.o.align], [248, 'left']);
      const key = ui.texts.find((t) => t.s === 'OMHOOG');
      eq('key name centred on the cap (x 176)', [key.x, key.o.align, key.o.colour, key.font], [176, 'centre', 1, 0]);
      eq('key text y = cap bottom - 4', key.y, y0 + 4 * 24 - 4);
    }
    {
      // two buttons: second cap at tile column -12, names at -10 / -6
      const ui = stubUi();
      const tbl = loadMessages(messages, ZONE_FILES.z41MAP);
      drawHelp(ui, {}, tbl, 7, { keyName });
      const caps = ui.sprites.filter((s) => s.tex === 0x3c);
      eq('z41MAP: 7 lines, two with 2 buttons -> 9 caps', caps.length, 9);
      const l = ui.texts.find((t) => t.s === 'Vulling gooien (links)');
      ok('two-button label drawn', !!l && l.x === 248);
      const xs = ui.texts.filter((t) => t.font === 0 && t.o.align === 'centre').map((t) => t.x);
      ok('centres at -10 (80) and -6 (176)', xs.includes(80) && xs.includes(176));
    }
    {
      // z17WAS: CONTROL4 has no token: drawn raw and centred at column 0
      const ui = stubUi();
      drawHelp(ui, {}, tableOf('z17WAS'), 5, { keyName });
      const raw = ui.texts.find((t) => t.s === 'Druk tweemaal voor de edelsteen');
      ok('unparsable line drawn centred', !!raw && raw.x === 320 && raw.o.align === 'centre');
    }
    // default key bindings -> names (FUN_004384c9 -> FUN_0043839f)
    eq('key names of the default bindings', [4, 8, 1, 2, 0x10, 0x20, 0x40, 0x80].map(keyName), ['UP', 'DOWN', 'LEFT', 'RIGHT', 'LCTRL', 'LALT', 'LSHIFT', 'SPACE']);
    eq('localised key names (FRONTEND.str)', [4, 8, 1, 2, 0x10, 0x20, 0x40, 0x80].map((b) => front.raw(keyName(b)) ?? keyName(b)), ['OMHOOG', 'OMLAAG', 'LINKS', 'RECHTS', 'L CTRL', 'L ALT', 'L SHIFT', 'SPATIE']);
    eq('an unknown name falls back to itself (FUN_004396a0)', front.raw('NUM7') ?? 'NUM7', front.raw('NUM7') ?? 'NUM7');

    // ---- banner lines (z38PAR mode 4: score y 100, medal y 150 wrap 30, result lines wrap 36)
    {
      const lines = bannerLines({ score: { text: '4200' }, medal: 3, lines: [{ text: 'a', y: 200 }, { text: 'b', y: 320, wrap: 20 }] }, std);
      eq('banner list', lines, [{ text: '4200', y: 100, wrap: 30 }, { text: std.text('SGGOLD'), y: 150, wrap: 30 }, { wrap: 36, text: 'a', y: 200 }, { wrap: 20, text: 'b', y: 320 }]);
      eq('no medal, no score', bannerLines({ lines: [{ text: 'x', y: 200 }] }, std).length, 1);
      eq('medal ids', [...MEDAL_IDS], ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD']);
      ok('medal texts exist in STD.str', MEDAL_IDS.slice(1).every((id) => std.has(id)));
    }

    // ---- subtitle (FUN_0045d34b): width limit in pixels, break after a space or period, four lines at y 395 / 414 / 433 / 452
    {
      eq('subtitle y', SUBTITLE_Y, [395, 414, 433, 452]);
      eq('subtitle width limit', SUBTITLE_MAX_WIDTH, 448);
      const m = (s) => s.length * 10;   // 44 characters per line
      eq('short text one line', wrapSubtitle('Hallo Pepper', m), ['Hallo Pepper']);
      const lines = wrapSubtitle('Dit is een lange regel tekst die zeker over meerdere regels verdeeld moet worden omdat hij te breed is', m);
      ok('all lines fit', lines.every((l) => m(l) <= 448));
      ok('no words are cut', lines.join(' ').replace(/ +/g, ' ') === 'Dit is een lange regel tekst die zeker over meerdere regels verdeeld moet worden omdat hij te breed is');
      eq('at most four lines', wrapSubtitle('woord '.repeat(100), m).length, 4);
      eq('0x92 becomes an apostrophe', wrapSubtitle('zo\x92n', m), ["zo'n"]);
      eq('empty', wrapSubtitle('   ', m), []);
      const ui = stubUi();
      drawSubtitle(ui, 'Hallo Pepper');
      eq('drawSubtitle: small font, yellow, centred at (320, 395)', [ui.texts[0].font, ui.texts[0].o.colour, ui.texts[0].x, ui.texts[0].y, ui.texts[0].o.align], [0, 0, 320, 395, 'centre']);
    }

    // ---- the intro table
    const zones = readZoneTable(pe);
    const archives = new Set(zones.map((z) => z.archive).filter(Boolean));
    const keys = Object.keys(ZONE_INTRO);
    eq('19 mini-game zones', keys.length, 19);
    for (const z of keys) {
      const zi = ZONE_INTRO[z];
      ok(`${z}: a zone of the zone table`, archives.has(z));
      ok(`${z}: has a .str file`, (ZONE_FILES[z]?.length ?? 0) > 0);
      const t = tableOf(z);
      if (!t) continue;
      for (const l of zi.lines) ok(`${z}: intro line ${l.id} exists in ${ZONE_FILES[z]}`, t.has(l.id));
      for (const id of zi.speech ?? []) ok(`${z}: speech ${id} exists`, t.has(id));
      ok(`${z}: introId is the first line`, zi.introId === (zi.lines[0]?.id ?? null));
      // z08BKD asks for 5 lines but BKD.str has 4: the original draws the id "CONTROL4" itself (FUN_004396a0 returns the id, the parser returns 0, the raw text is shown centred)
      for (let i = 0; i < zi.helpControls; i++) { if (z === 'z08BKD' && i === 4) ok('z08BKD: CONTROL4 is missing (the original shows the id)', !t.has('CONTROL4')); else ok(`${z}: CONTROL${i} exists`, t.has(`CONTROL${i}`)); }
      // the parser accepts every shown line, except the one raw hint line of z17WAS
      for (let i = 0; i < zi.helpControls; i++) {
        const raw = t.raw(`CONTROL${i}`) ?? '';
        const p = parseControlLine(raw);
        if (z === 'z08BKD' && i === 4) continue;
        if (z === 'z17WAS' && i === 4) ok('z17WAS CONTROL4 is the raw hint', !p.ok); else ok(`${z}: CONTROL${i} parses (${raw})`, p.ok);
      }
      ok(`zoneIntroFor(${z.toLowerCase()})`, zoneIntroFor(z.toLowerCase()) === zi);
    }
    eq('help counts', Object.fromEntries(keys.map((z) => [z, ZONE_INTRO[z].helpControls])), {
      z38PAR: 6, z05WAB: 4, z08BKD: 5, z09JST: 7, z10RGB: 11, z15SSH: 5, z17WAS: 5, z18MMP: 5, z20DSP: 5, z21FSH: 4, z22BIP: 5, z27TRX: 6, z28HAT: 5, z36CNT: 4, z39ASB: 4,
      z40aPO: 6, z41MAP: 7, z42BRP: 3, z01BPK: 0,
    });
    eq('z42BRP second help', ZONE_INTRO.z42BRP.help2, 5);
    ok('BRP2.str has CONTROL4', loadMessages(messages, ['OG/Data/BRP2.str']).has('CONTROL4'));
    // zones with a table: ZONE_FILES covers every zone of the intro table (z01BPK / z39ASB added for this)
    ok('ZONE_FILES covers the intro table', keys.every((z) => ZONE_FILES[z]));

    // ---- the executable: button tokens, labels, call sites
    eq('PRESS / FECONTRL / CONTROL labels in the exe', [pe.cstr(0x8b928c), pe.cstr(0x8b9298), pe.cstr(0x8b92a0)], ['!FECONTRL', '!PRESS', 'CONTROL%i']);
    // FUN_00460f31 strcmp chain: UP 4, DOWN 8, LEFT 1, RIGHT 2, BUTTON_2 0x20, BUTTON_1 0x10, BUTTON_4 0x80, BUTTON_3 0x40 (strings at 0x8b92ac ..)
    const tokAt = [[0x8b92ac, 'BUTTON_UP'], [0x8b92b8, 'BUTTON_DOWN'], [0x8b92c4, 'BUTTON_LEFT'], [0x8b92d0, 'BUTTON_RIGHT'], [0x8b92e0, 'BUTTON_2'], [0x8b92ec, 'BUTTON_1'], [0x8b92f8, 'BUTTON_4'], [0x8b9304, 'BUTTON_3']];
    for (const [va, name] of tokAt) eq(`token string at ${va.toString(16)}`, pe.cstr(va), name);
    eq('token order = CONTROL_BUTTONS', CONTROL_BUTTONS.map(([n]) => n), tokAt.map(([, n]) => n));
    // the bit constants: `mov dword ptr [ebp-8], imm` right before the shared tail 0x46113a, in the strcmp chain order
    // each compare is followed by `jne next; mov dword ptr [ebp-8], bit; jmp tail`
    const found = [];
    for (let a = 0x46103b; a < 0x461146; a++) if (pe.at(a) === 0xc7 && pe.at(a + 1) === 0x45 && pe.at(a + 2) === 0xf8) found.push(pe.u32(a + 3));
    eq('button bits in the strcmp chain order', found, [4, 8, 1, 2, 0x20, 0x10, 0x80, 0x40]);
    eq('exe key table: 13 keyboard entries', keyTable.length, 13);

    // FUN_00461155 call sites: `push n` (6a nn) shortly before `call 0x461155`
    for (const [z, sites] of Object.entries(HELP_CALLS)) {
      for (const [va, n] of sites) {
        const rel = (pe.u32(va + 1) | 0);
        const target = (va + 5 + rel) >>> 0;
        let pushed = -1;
        for (let a = va - 12; a < va - 5; a++) if (pe.at(a) === 0x6a && ((pe.at(a + 2) === 0x8b && pe.at(a + 8) <= 0x57 && pe.at(a + 8) >= 0x50) || (pe.at(a + 2) === 0xa1 && pe.at(a + 7) === 0x50))) pushed = pe.at(a + 1);
        ok(`${z}: call at ${va.toString(16)} targets FUN_00461155`, pe.at(va) === 0xe8 && target === 0x461155);
        ok(`${z}: n = ${n} at ${va.toString(16)} (found ${pushed})`, pushed === n);
        if (z !== 'z42BRP') ok(`${z}: table helpControls`, ZONE_INTRO[z].helpControls === n);
      }
    }
    // intro lines: some `push id` of the line is a FUN_00439c6f call with that y and wrap (pushes: wrap, y, 0x140, 0, 1, id)
    const pushImm = (a) => (pe.at(a) === 0x6a ? { v: (pe.at(a + 1) << 24) >> 24, len: 2 } : pe.at(a) === 0x68 ? { v: pe.u32(a + 1) | 0, len: 5 } : null);
    for (const z of keys) {
      const zi = ZONE_INTRO[z];
      for (const l of zi.lines) {
        const strs = pe.findStrings(l.id).filter((va) => pe.cstr(va) === l.id);
        let hit = false;
        for (const sva of strs) for (const p of pe.pushXrefs(sva)) {
          // p = `push id`; before it: push 1 (6a 01), push 0 (6a 00), push 0x140 (68 40 01 00 00), push y, push wrap
          if (pe.at(p - 2) !== 0x6a || (pe.at(p - 1) !== 1 && pe.at(p - 1) !== 3) || pe.at(p - 4) !== 0x6a || pe.at(p - 3) !== 0) continue;   // z42BRP / z08BKD helper pass 3 as the (ignored) 4th argument
          const px = p - 9;
          if (pe.at(px) !== 0x68 || pe.u32(px + 1) !== 0x140) continue;
          // y: 6a imm8 (2 bytes) or 68 imm32 (5 bytes), then wrap 6a imm8
          let y = pushImm(px - 2), yLen = 2;
          if (!(pe.at(px - 2) === 0x6a)) { y = pushImm(px - 5); yLen = 5; }
          if (!y || (yLen === 2 && pe.at(px - 2) !== 0x6a) || (yLen === 5 && pe.at(px - 5) !== 0x68)) continue;
          const w = pe.at(px - yLen - 2) === 0x6a ? pe.at(px - yLen - 1) : -1;
          if (y.v === l.y && w === l.wrap) hit = true;
        }
        ok(`${z}: ${l.id} drawn at y ${l.y} wrap ${l.wrap} by a FUN_00439c6f call`, hit);
      }
    }
    notes.push(`${keys.length} zones in ZONE_INTRO, help call sites verified in the executable`);
    return { checked, failures, notes };
  },
};
