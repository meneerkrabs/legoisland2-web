// Cutscenes: every SayText line of every compiled script (87 `.cut` of the nine archives) resolves like FUN_0045cf83 does: its id is in the script's message table, the 4-character field
// is the speech index (FUN_00439bf8, 6.3 of docs/re/audio.md), the index is inside the EXE's speech table (1732 ids) and the clip file `_Data/sounds/speech/Data/<id>.mp3` exists; a line without
// a voice (-1) or whose table is missing is listed as a note (text only: the subtitle's timer alone). The table of a script is the message file of the same name (`LI/Data/LGI01.str` for
// `z02LGI/cutscene/lgi01.cut`); the island's slot table pairs a few scripts with other files (LGIPH09..11 use the strings of 08..10): those scripts are tried against every file of the area and must
// resolve in at least one. Also reports the voiced lines per archive (the numbers of the QA report) and the clips no script says (they are the Orphan / battery lines of docs/re/unused.md 8.7).
import fs from 'node:fs';
import path from 'node:path';
import { readExeSpeechTable } from '../../src/formats/sound.ts';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { MessageTable } from '../../src/ui/strings.ts';

export default {
  name: 'cutscene-voices',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    if (!fs.existsSync(exePath) || !messages) return { checked: 0, failures: ['missing EXE or messages archive'] };
    const speech = readExeSpeechTable(new Uint8Array(fs.readFileSync(exePath)));
    const dir = path.join(ctx.dataDir, 'sounds', 'speech', 'Data');
    const have = fs.existsSync(dir) ? new Set(fs.readdirSync(dir).map((f) => f.toLowerCase())) : null;
    // every message file by stem
    const files = [];
    for (const e of messages.entries) { const m = /^(\w+)\/data\/([^/]+)\.str$/i.exec(e.path); if (m) files.push({ area: m[1].toUpperCase(), stem: m[2].toLowerCase(), table: new MessageTable([messages.read(e)]), path: e.path }); }
    ok(files.length > 100, `message files found (${files.length})`);
    const perArchive = new Map();
    let scripts = 0, lines = 0, voiced = 0, renamed = 0;
    const said = new Set();
    for (const { archive, entry, data } of ctx.entries(/(^|\/)cutscene\/[^/]+\.cut$/i)) {
      const name = path.basename(entry.path).replace(/\.cut$/i, '').toLowerCase();
      const cut = parseCutscene(data);
      const ids = cut.commands.filter((c) => c.cmd === 2).map((c) => c.textId).filter(Boolean);
      scripts++;
      const same = files.filter((f) => f.stem === name);
      for (const id of ids) {
        lines++;
        let t = same.find((f) => f.table.has(id));
        if (!t) { t = files.find((f) => f.table.has(id)); if (t) notes.push(`${archive.name}/${name}: ${id} is not in ${same.map((f) => f.path).join(', ') || 'a file of that name'}; found in ${t.path}`); }
        if (!t) { notes.push(`${archive.name}/${name}: ${id} is in no message table`); continue; }
        const v = t.table.voice(id);
        if (v < 0) { notes.push(`${archive.name}/${name}: ${id} has no voice (text only)`); continue; }
        voiced++;
        const clip = speech[v];
        ok(!!clip, `${archive.name}/${name}: ${id} -> speech index ${v} is outside the speech table (${speech.length})`);
        if (!clip) continue;
        said.add(clip.toLowerCase());
        // the clip of a cutscene line is named like its message id in every shipped script (LECSIN01 -> LECSIN01): another name would be a line that speaks another line's recording
        if (clip.toLowerCase() !== id.toLowerCase()) { renamed++; notes.push(`${archive.name}/${name}: ${id} speaks clip ${clip} (index ${v})`); }
        if (have) ok(have.has(clip.toLowerCase() + '.mp3'), `${archive.name}/${name}: ${id} -> ${clip}.mp3 is missing`);
        const k = archive.name; const s = perArchive.get(k) ?? { scripts: 0, lines: 0, voiced: 0 }; s.lines++; s.voiced++; perArchive.set(k, s);
      }
      const k = archive.name; const s = perArchive.get(k) ?? { scripts: 0, lines: 0, voiced: 0 }; s.scripts++; perArchive.set(k, s);
    }
    ok(scripts === 87, `87 compiled scripts (${scripts})`);
    notes.unshift(`${scripts} scripts, ${lines} SayText lines, ${voiced} with a voice clip, ${renamed} whose clip is not named like the line`);
    notes.push(`per archive: ${[...perArchive].map(([k, s]) => `${k} ${s.scripts} scripts / ${s.voiced} voiced`).join(', ')}`);
    return { checked, failures, notes };
  },
};
