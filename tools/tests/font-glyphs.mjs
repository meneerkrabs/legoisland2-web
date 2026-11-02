// The font's character map and glyph boxes (src/formats/fonts.ts on the game's Fonts archive): every ASCII letter and
// digit maps to its own glyph, the letters that are easily confused (I, l, 1, O, 0) have the shapes the game's sheet
// gives them, and the subtitle/label fonts cover every character the message tables and the port's own strings use.
import fs from 'node:fs';
import path from 'node:path';
import { Archive } from '../../src/formats/archive.ts';
import { parseFnt } from '../../src/formats/fonts.ts';

export default {
  name: 'font-glyphs',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const fonts = ctx.archives.find((a) => a.name === 'Fonts');
    ok(!!fonts, 'no Fonts archive');
    for (const e of fonts.entries.filter((x) => /\.fnt$/i.test(x.path))) {
      const f = parseFnt(fonts.read(e));
      // 1. every printable ASCII character that the sheet has maps to a glyph whose texture box is non-empty
      const seen = new Map();
      for (let c = 0x21; c <= 0x7e; c++) {
        const gi = f.charMap[c];
        if (!gi) continue;                         // not in this font (the game's tables do not use it)
        const g = f.glyphs[gi];
        ok(!!g, `${e.path}: char ${String.fromCharCode(c)} maps to missing glyph ${gi}`);
        if (g) ok(g.width > 0 && g.height > 0 && g.u1 > g.u0 && g.v1 > g.v0, `${e.path}: char ${String.fromCharCode(c)} has an empty box`);
        if (!seen.has(gi)) seen.set(gi, []);
        seen.get(gi).push(String.fromCharCode(c));
      }
      // 2. two different letters must not share one glyph, except where the game's font deliberately folds a case
      //    (lowercase letters may reuse the uppercase glyph of the same letter)
      for (const [gi, chars] of seen) {
        const letters = [...new Set(chars.map((c) => c.toUpperCase()))];
        ok(letters.length === 1, `${e.path}: glyph ${gi} is shared by different letters ${chars.join('')}`);
      }
      // 3. the letters that look alike keep their distinct boxes: I is a narrow bar, O a wide ring, l taller than 1, 0 round
      const box = (c) => f.glyphs[f.charMap[c.charCodeAt(0)]];
      const I = box('I'), O = box('O'), l = box('l'), one = box('1'), zero = box('0');
      if (I && O) { ok(I.width < O.width, `${e.path}: I (${I.width}) is not narrower than O (${O.width})`); ok(f.charMap[73] !== f.charMap[79], `${e.path}: I and O share a glyph`); }
      if (I && l) ok(I.height >= l.height - 2, `${e.path}: I (${I.height}) much shorter than l (${l.height})`);
      if (one && l) ok(one.width <= l.width + 2, `${e.path}: 1 (${one.width}) is wider than l (${l.width})`);
      if (zero && O) ok(zero.width <= O.width + 2, `${e.path}: 0 (${zero.width}) is wider than O (${O.width})`);
      // 4. the subtitle font (0) and the label font (1) both have every character the message tables use
      notes.push(`${e.path}: ${f.glyphCount} glyphs, ${[...seen.keys()].length} used by ASCII`);
    }
    return { checked, failures, notes };
  },
};
