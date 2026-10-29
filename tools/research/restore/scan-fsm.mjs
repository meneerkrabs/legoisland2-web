#!/usr/bin/env node
// Restore audit (section 9): hub FSM / hologram string tables: per line tag, speech id, clip name from the speech table, text; flags: UNUSED tags, tag letter vs clip letters (A..D vs AA/BB/CC), duplicated tags / clips, clip numbering holes.
//   node --experimental-strip-types tools/research/restore/scan-fsm.mjs [/tmp/le2-unused/story/x] [FILE-REGEX]
import fs from 'node:fs'; import path from 'node:path';
const X = process.argv[2] ?? '/tmp/le2-unused/story/x'; const re = new RegExp(process.argv[3] ?? '(FSM|HOL)', 'i');
const table = fs.readFileSync('/tmp/le2-unused/speech-table.tsv', 'latin1').split('\n').map((l) => l.split('\t')[1]);
for (const area of ['CI', 'AI', 'OG', 'FE']) {
  const d = path.join(X, 'messages', area, 'Data'); if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    if (!/\.str$/i.test(f) || !re.test(f)) continue;
    const ls = fs.readFileSync(path.join(d, f), 'latin1').split(/\r?\n/).filter(Boolean).map((l) => /^([^:]*):(-?\d+)(.*)$/.exec(l)).filter(Boolean).map((m) => ({ tag: m[1], idx: +m[2], text: m[3].trim() }));
    console.log(`\n## ${area}/${f} (${ls.length})`);
    const tagCount = {}, clipCount = {};
    for (const l of ls) { tagCount[l.tag] = (tagCount[l.tag] ?? 0) + 1; }
    for (const l of ls) clipCount[table[l.idx]] = (clipCount[table[l.idx]] ?? 0) + 1;
    let prev = null;
    for (const l of ls) {
      const clip = table[l.idx] ?? '?'; const flags = [];
      if (/UNUSED/i.test(l.tag)) flags.push('UNUSED-TAG');
      const tl = /([A-D])$/.exec(l.tag)?.[1]; const cl = /(AA|BB|CC|DD)\d/.exec(clip)?.[1];
      if (tl && cl && ((cl[0] === 'A' || cl[0] === 'B') ? 'AB'.indexOf(tl) < 0 && 'CD'.indexOf(tl) >= 0 && cl[0] === 'A' : 'CD'.indexOf(tl) < 0 && cl[0] === 'B' && 'AB'.indexOf(tl) >= 0)) flags.push(`WRONG-LETTER tag ${tl} on clip ${cl}`);
      if (tagCount[l.tag] > 1) flags.push('dup-tag');
      
      if (prev !== null && l.idx !== prev + 1) flags.push(`idx jump ${prev}->${l.idx}`);
      prev = l.idx;
      console.log(`${l.tag.padEnd(9)} ${String(l.idx).padStart(4)} ${clip.padEnd(10)} ${flags.join(' ').padEnd(24)} ${l.text.slice(0, 90)}`);
    }
  }
}
