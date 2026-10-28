// src/ui/layout.ts + fonts.ts: text layout of the original (glyph quads, advances, centring, wrapping, colours, shadow, clipping) against hand-computed values.
// Hand-computed from the .fnt data (Balloon12: cell 20, A = 10x13 at offset (0,4), B = 11x13, kern(A,A) = kern(A,B) = kern(O,E) = 10, kern(space,A) = 6;
// Balloon24: cell 40, A = 18x25 at (0,8), kern(A,A) = 18, kern(O,E) = 19, kern(space,A) = 11) and the scales of FUN_00413fbd (slot 1 = float32 0.7).
import { loadFontData, fontSlotForName, FONT_SCALE, WRAP_SCALE } from '../../src/ui/fonts.ts';
import { drawString, glyphQuad, stringWidth, measureText, lineHeight, alignedX, wrapLines, layoutMessage, layoutTextCmd, resolveColour, TEXT_COLOURS, VIRTUAL } from '../../src/ui/layout.ts';

export default {
  name: 'ui-layout',
  run(ctx) {
    const failures = []; let checked = 0;
    const eq = (what, got, want) => { checked++; if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    const near = (what, got, want, eps = 1e-6) => { checked++; if (!(Math.abs(got - want) <= eps)) failures.push(`${what}: got ${got}, want ${want}`); };
    const fonts = loadFontData(ctx.archives.find((a) => a.name === 'Fonts'));
    const [f12, f24] = fonts;

    // ---- font slots (FUN_00413dae)
    eq('slot main', fontSlotForName('data/fonts/main/main'), 1); eq('slot menu', fontSlotForName('data/fonts/menu/menu'), 0); eq('slot csm', fontSlotForName('data/fonts/csm/csm'), 0);
    eq('slot bknw', fontSlotForName('data/fonts/bknw/bknw'), 1); eq('slot test', fontSlotForName('data/fonts/test'), 0);
    eq('slot Balloon12', fontSlotForName('_data/fonts/Balloon12'), 0); eq('slot Balloon24', fontSlotForName('_data/fonts/Balloon24'), 1); eq('slot unknown', fontSlotForName('_data/fonts/Nope'), 0);
    eq('scales', [FONT_SCALE[0], FONT_SCALE[1]], [1, Math.fround(0.7)]); near('wrap scale 1.4286', WRAP_SCALE[1], 1.4285715, 1e-6);
    eq('font data', [f12.font.lineHeight, f12.font.glyphCount, f24.font.lineHeight, f24.font.glyphCount, f12.image.width, f12.image.height, f24.image.width, f24.image.height], [20, 124, 40, 119, 256, 128, 256, 256]);

    // ---- metrics at 640x480
    eq('lineHeight 12', lineHeight(f12), 20);
    eq('lineHeight 24 = trunc(40 * float32(0.7)) = 27 (27.9999995, not 28)', lineHeight(f24), 27);
    eq('width AAAA 12', stringWidth(f12, 'AAAA'), 40);
    eq('width AAAA 24: 18 * 0.7 = 12.6 truncated every step -> 12, 24, 36, 48', stringWidth(f24, 'AAAA'), 48);
    eq('width empty', stringWidth(f12, ''), 0);
    eq('width "A A" 12 = 10 (A, space) + 6 (space, A) + 10 (A, NUL)', stringWidth(f12, 'A A'), 26);
    eq('measureText', measureText(f24, 'AAAA'), { w: 48, h: 27 });
    eq('width scales with W/640 (1280 wide: sx = 2)', stringWidth(f12, 'AAAA', { w: 1280, h: 960 }), 80);

    // ---- glyph quads
    const col = [0xffffff00, 0xffffff00, 0xffffff00, 0xffffff00];
    let q = drawString(f12, VIRTUAL, 100, 100, 'AB', 0);
    eq('AB: 2 quads', q.quads.length, 2);
    eq('A quad = x 100..110, y 84..97 (top = y + offsetY - cell = 100 + 4 - 20, height 13)', [q.quads[0].x0, q.quads[0].y0, q.quads[0].x1, q.quads[0].y1], [100, 84, 110, 97]);
    eq('B quad starts at the pair advance 10, width 11', [q.quads[1].x0, q.quads[1].x1], [110, 121]);
    near('A uv u0', q.quads[0].u0, 0.259765625); near('A uv u1', q.quads[0].u1, 0.298828125);
    near('A uv v: top = 1 - v0', q.quads[0].v0, 1 - 0.36328125); near('A uv v: bottom = 1 - v1', q.quads[0].v1, 1 - 0.46484375);
    eq('corner colours (yellow x4)', q.quads[0].c, col);
    q = drawString(f24, VIRTUAL, 100, 100, 'A', 1);
    // x1 = trunc(100 + 18 * 0.7f) = 112; y0 = trunc((8 - 40) * 0.7f + 100) = trunc(77.6) = 77; y1 = trunc(77.6 + 25 * 0.7f) = trunc(95.1) = 95
    eq('Balloon24 A at scale 0.7', [q.quads[0].x0, q.quads[0].y0, q.quads[0].x1, q.quads[0].y1], [100, 77, 112, 95]);
    q = drawString(f12, { w: 1280, h: 960 }, 200, 200, 'A', 1);
    eq('Balloon12 A at 1280x960 (sx = sy = 2): 200..220, y = 200 + (4 - 20) * 2 = 168 .. 194', [q.quads[0].x0, q.quads[0].y0, q.quads[0].x1, q.quads[0].y1], [200, 168, 220, 194]);
    // folding: 0xE9 draws the glyph of 0xC9; "(c)" = O (pad 3) + c (pad -3); 0x9C = O, E at + kern(O,E) * 0.5
    eq('fold quad count and uv (e-acute = E-acute)', drawString(f12, VIRTUAL, 10, 50, '\xe9', 0).quads[0].u0, drawString(f12, VIRTUAL, 10, 50, '\xc9', 0).quads[0].u0);
    q = drawString(f12, VIRTUAL, 100, 100, '\xa9', 0);
    eq('(c): two quads', q.quads.length, 2);
    // O: x0 = (0 - 3) + 100 = 97, width 11 + 6 = 17 -> x1 = 114; c: x0 = (0 + 3) + 100 = 103, width 10 - 6 = 4 -> 107; y0 O = (4 - 20 - 3) + 100 = 81, h 13 + 6 = 19 -> 100
    eq('(c) O quad (pad +3)', [q.quads[0].x0, q.quads[0].y0, q.quads[0].x1, q.quads[0].y1], [97, 81, 114, 100]);
    eq('(c) c quad (pad -3)', [q.quads[1].x0, q.quads[1].y0, q.quads[1].x1, q.quads[1].y1], [103, 87, 107, 94]);
    q = drawString(f12, VIRTUAL, 100, 100, '\x9c', 0);
    eq('0x9C = O, then E at x + trunc(10 * 0.5) = 105', [q.quads.length, q.quads[0].x0, q.quads[1].x0], [2, 100, 105]);
    eq('empty string draws nothing', drawString(f12, VIRTUAL, 5, 5, '', 0).quads.length, 0);
    // clipping: a glyph left of the screen is cut at x = 0 and u0 moves
    q = drawString(f12, VIRTUAL, -4, 100, 'A', 0);
    eq('clip left: x0 = 0', q.quads[0].x0, 0); near('clip left: u0 = 0.259765625 - (u1 - u0) * (-4) / 10', q.quads[0].u0, 0.259765625 + (0.298828125 - 0.259765625) * 4 / 10, 1e-9);
    eq('outside: nothing', drawString(f12, VIRTUAL, -40, 100, 'A', 0).quads.length, 0);
    eq('clip bottom edge', glyphQuad(f12, VIRTUAL, 65, 100, 483, 0, col).y1, 480);
    eq('clip right: nothing beyond', drawString(f12, VIRTUAL, 640, 100, 'A', 0).quads.length, 0);

    // ---- colours
    eq('colour table size', TEXT_COLOURS.length, 11);
    eq('colour 0', resolveColour(0), [0xffffff00, 0xffffff00, 0xffffff00, 0xffffff00]); eq('colour 5 gradient', resolveColour(5), [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff]);
    eq('colour 7', resolveColour(7), [0xffff0000, 0xffff0000, 0xff220000, 0xff220000]); eq('colour 8 black', resolveColour(8)[0], 0xff000000); eq('colour 9 grey', resolveColour(9)[0], 0xff3f3f3f);
    eq('colour 10', resolveColour(10)[0], 0x3f000000);
    eq('raw ARGB >= 11', resolveColour(0xff112233), [0xff112233, 0xff112233, 0xff112233, 0xff112233]);

    // ---- alignment (FUN_0043a25c / 0043a091 / 0043a167)
    eq('left', alignedX(f12, VIRTUAL, 320, 'AAAA', 'left'), 320); eq('centre = x - w / 2', alignedX(f12, VIRTUAL, 320, 'AAAA', 'centre'), 300); eq('right = x - w', alignedX(f12, VIRTUAL, 320, 'AAAA', 'right'), 280);
    eq('centre, odd width (AAAAA... 3 glyphs: 30 -> 15; "A A" 26 -> 13)', alignedX(f12, VIRTUAL, 100, 'A A', 'centre'), 87);

    // ---- shadow: black copy at (+2, +2) first, then the text
    const cmd = { font: 0, colour: 1, x: 100, y: 100, text: 'A' };
    const sq = layoutTextCmd(fonts, VIRTUAL, cmd);
    eq('shadow first', [sq.length, sq[0].x0, sq[0].y0, sq[0].c[0], sq[1].x0, sq[1].y0, sq[1].c[0]], [2, 102, 86, 0xff000000, 100, 84, 0xffffffff]);
    eq('no shadow option', layoutTextCmd(fonts, VIRTUAL, cmd, false).length, 1);

    // ---- wrapping (FUN_00439c6f): break at the last space at index <= maxChars, strictly longer than maxChars
    eq('fits', wrapLines('aaa bbb', 7), ['aaa bbb']);
    eq('space exactly at maxChars', wrapLines('aaa bbb ccc', 7), ['aaa bbb', 'ccc']);
    eq('back to the previous space', wrapLines('aaa bbb ccc', 5), ['aaa', 'bbb', 'ccc']);
    eq('maxChars 4 on "aaa bbb ccc"', wrapLines('aaa bbb ccc', 4), ['aaa', 'bbb', 'ccc']);
    eq('no space: hard cut (original reads garbage)', wrapLines('abcdefgh', 3), ['abc', 'def', 'gh']);
    eq('empty', wrapLines('', 5), ['']);
    eq('slot 1: 42 chars fit on a line, the 43rd breaks', wrapLines('a'.repeat(20) + ' ' + 'b'.repeat(21) + ' ' + 'c', 30, WRAP_SCALE[1]), ['a'.repeat(20) + ' ' + 'b'.repeat(21), 'c']);
    eq('slot 0 keeps 30', wrapLines('a'.repeat(20) + ' ' + 'b'.repeat(21) + ' ' + 'c', 30, 1), ['a'.repeat(20), 'b'.repeat(21) + ' c']);

    // ---- layoutMessage: centred lines, pitch = lineHeight - 8, coordinates scaled with W / 640 (integer arithmetic, y with the width factor too)
    let cmds = layoutMessage(fonts, VIRTUAL, { font: 0, colour: 1, text: 'AAAA AAAA', x: 320, y: 100, maxChars: 4 });
    eq('2 lines, centred on x = 320 (width 40 -> 300), pitch 20 - 8 = 12', cmds.map((c) => [c.x, c.y, c.text]), [[300, 100, 'AAAA'], [300, 112, 'AAAA']]);
    cmds = layoutMessage(fonts, VIRTUAL, { font: 1, colour: 1, text: 'AAAA AAAA', x: 320, y: 100, maxChars: 3 });
    // slot 1: maxChars 3 * 1.4286 = 4: wraps after "AAAA"; width 48 -> x = 320 - 24; pitch = 27 - 8 = 19
    eq('slot 1: width 48 -> 296, pitch 19', cmds.map((c) => [c.x, c.y]), [[296, 100], [296, 119]]);
    cmds = layoutMessage(fonts, { w: 800, h: 600 }, { font: 0, colour: 1, text: 'AAAA', x: 320, y: 100 });
    eq('800x600: x = 320 * 800 / 640 = 400 minus half the width, y = 100 * 800 / 640 = 125', [cmds[0].y, cmds[0].x], [125, 400 - Math.trunc(stringWidth(f12, 'AAAA', { w: 800, h: 600 }) / 2)]);
    eq('800x600 width AAAA: each step trunc(x + 12.5): 12, 24, 36, 48', stringWidth(f12, 'AAAA', { w: 800, h: 600 }), 48);
    eq('align right through layoutMessage', layoutMessage(fonts, VIRTUAL, { font: 0, text: 'AAAA', x: 320, y: 0, align: 'right' })[0].x, 280);
    eq('maxChars 0 does not hang', wrapLines('abc def', 0), ['abc def']);
    return { checked, failures };
  },
};
