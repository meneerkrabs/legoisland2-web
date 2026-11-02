// Language pack (src/lang, docs/re/language.md): the English edition laid over the Dutch game. Needs the English Game folder (LE2_EN_DIR, default public/data/le2-en = the unpacked
// English cabinet's Game group); without it the test only checks the Dutch side (no pack = the identical tables) and says so.
//   - the pack's files under their Dutch names (speech/English -> speech/Data, three aliased ids, messages / Fonts / the voice wav), nothing else replaced
//   - the renamed `messages` archive: every Dutch `.str` path exists, the English text is in it, tags / voice fields agree with the Dutch tables but for the known exceptions
//   - the speech table of the Dutch executable resolves in English for every id the English executable's table has (and the three renamed ones)
//   - the Dutch side stays byte for byte what it is: the base's files, the messages archive of the Dutch data, the input of `renameLanguageDir` is not touched
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Archive } from '../../src/formats/archive.ts';
import { FileSet } from '../../src/files.ts';
import { EN_PACK, LanguageFiles, isPackEdition, packRedirects, renameLanguageDir } from '../../src/lang/pack.ts';
import { MessageTable, parseMessageFile } from '../../src/ui/strings.ts';
import { readExeSpeechTable } from '../../src/formats/sound.ts';
import { restoredOn } from '../../src/restore/flag.ts';
import { setActiveLanguage } from '../../src/lang/state.ts';

const md5 = (b) => createHash('md5').update(b).digest('hex');
function dirFiles(root) {
  const refs = [];
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else refs.push({ path: r, size: fs.statSync(path.join(root, r)).size, read: async () => new Uint8Array(fs.readFileSync(path.join(root, r))) });
    }
  })('');
  return new FileSet('dev', refs, async () => null);
}

export default {
  name: 'lang-en',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const nlRoot = ctx.dataRoot;
    const enRoot = process.env.LE2_EN_DIR ?? path.join(ctx.dataRoot, '..', 'le2-en');
    const nl = dirFiles(nlRoot);

    // ---- the Dutch side without a pack: nothing replaced, the editions are told apart
    ok(!isPackEdition(nl.list(), EN_PACK), 'the Dutch data is not the English edition');
    ok(packRedirects(nl.list(), EN_PACK).size === 5, 'the Dutch data has only the five members that share a name (messages x2, Fonts x2, the wav), no speech');
    const nlBod = fs.readFileSync(path.join(nlRoot, '_data/messages.bod'));
    const nlBodSum = md5(nlBod);
    const renamedNl = renameLanguageDir(nlBod, 'English');
    ok(md5(nlBod) === nlBodSum, 'renameLanguageDir leaves its input alone');
    ok(md5(renamedNl) === nlBodSum, 'a Dutch directory has no "English" folder: the rename changes nothing');

    // "Herstelde inhoud" (Dutch transcripts) is off in another language, on as chosen in Dutch
    const mem = new Map([['le2-display', JSON.stringify({ restored: true })]]);
    globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    ok(restoredOn() === true, 'restored content: on in Dutch when chosen');
    setActiveLanguage('en'); ok(restoredOn() === false, 'restored content: off in English');
    setActiveLanguage('nl'); delete globalThis.localStorage;

    if (!fs.existsSync(enRoot)) { notes.push(`no English Game folder at ${enRoot} (LE2_EN_DIR): only the Dutch side was checked`); return { checked, failures, notes }; }
    const en = dirFiles(enRoot);
    ok(isPackEdition(en.list(), EN_PACK), 'the English folder is the English edition');
    const lf = new LanguageFiles(nl, en, EN_PACK);
    const red = packRedirects(en.list(), EN_PACK);
    const enSpeech = en.list().filter((p) => /^_data\/sounds\/speech\/English\/.+\.mp3$/i.test(p));
    ok(enSpeech.length === 1793, `1793 English speech clips (${enSpeech.length})`);
    ok(red.size === enSpeech.length + 3 + 5, `redirects = clips + 3 aliases + messages x2, Fonts x2, the wav (${red.size})`);
    ok([...red.keys()].every((k) => /^_data\/(sounds\/speech\/data\/[^/]+\.mp3|messages\.bo[bd]|fonts\.bo[bd]|sounds\/z07csi\/cedric defeat\.wav)$/.test(k)), 'only the language members are replaced');
    notes.push(`pack: ${red.size} files replaced (${enSpeech.length} speech clips)`);

    // ---- the Dutch tables stay the Dutch ones outside the pack
    for (const p of ['_data/Bricks.bob', '_data/z02LGI.bod', '_data/Overlays.bob', '_data/sounds/z02LGI/Silence.wav', 'LEGO eiland 2.exe']) {
      if (!nl.has(p)) continue;
      ok(lf.has(p) && lf.size(p) === nl.size(p) && md5(await lf.read(p)) === md5(await nl.read(p)), `${p}: the base's file`);
    }
    ok(md5(await lf.read('_data/messages.bob')) === md5(fs.readFileSync(path.join(enRoot, '_data/messages.bob'))), 'messages.bob = the English one');
    ok(md5(await lf.read('_data/Fonts.bob')) === md5(fs.readFileSync(path.join(enRoot, '_data/Fonts.bob'))), 'Fonts.bob = the English one');
    ok(lf.size('_data/messages.bod') === en.size('_data/messages.bod'), 'messages.bod keeps its size (in-place rename)');

    // ---- the renamed messages archive
    const nlMsg = new Archive('messages', fs.readFileSync(path.join(nlRoot, '_data/messages.bod')), fs.readFileSync(path.join(nlRoot, '_data/messages.bob')));
    const enMsg = new Archive('messages', await lf.read('_data/messages.bod'), await lf.read('_data/messages.bob'));
    const enPlain = new Archive('messages', fs.readFileSync(path.join(enRoot, '_data/messages.bod')), fs.readFileSync(path.join(enRoot, '_data/messages.bob')));
    let missing = 0;
    for (const e of nlMsg.entries) if (!enMsg.has(e.path) && !/dutch\.txt$/i.test(e.path)) { missing++; failures.push(`English archive lacks ${e.path}`); }
    ok(missing === 0, 'every Dutch .str path exists in the renamed English archive');
    const tags = (a, p) => parseMessageFile(a.read(p)).map((x) => x.tag).join('|');
    let same = 0, differ = 0; const voiceDiff = [];
    const exceptions = new Set(['FE/Data/FRONTEND.str', 'FE/Data/STD.str']);   // the English tables lack the key names / ACTION / SET / HISCORE / PHOTOS ... tags the Dutch ones have
    for (const e of nlMsg.entries) {
      if (!/\.str$/i.test(e.path) || !enMsg.has(e.path)) continue;
      const A = parseMessageFile(nlMsg.read(e)), B = parseMessageFile(enMsg.read(e.path));
      if (tags(nlMsg, e.path) === tags(enMsg, e.path)) same++; else { differ++; ok(exceptions.has(e.path), `${e.path}: tags differ`); }
      const mb = new Map(B.map((x) => [x.tag, x]));
      for (const x of A) { const y = mb.get(x.tag); if (y && y.field !== x.field) voiceDiff.push(`${e.path} ${x.tag} ${x.field.trim()}->${y.field.trim()}`); }
    }
    ok(same === 162 && differ === 2, `162 tables with the same tags, 2 with fewer (${same} / ${differ})`);
    ok(voiceDiff.length === 3, `3 voice fields differ (${voiceDiff.join('; ')})`);
    const T = (a, p) => new MessageTable([a.read(p)]);
    ok(T(enMsg, 'FE/Data/FRONTEND.str').text('FESTART') === 'START' && T(nlMsg, 'FE/Data/FRONTEND.str').text('FESTART') !== 'START', 'frontend FESTART is English (the Dutch one differs)');
    ok(T(enMsg, 'FE/Data/STD.str').text('SGGOLD') === 'Gold!', 'STD SGGOLD = Gold!');
    ok(enPlain.has('fe/English/FRONTEND.str') && !enPlain.has('FE/Data/FRONTEND.str'), 'the unrenamed English archive has fe/English only');
    // a missing tag returns the id itself, exactly as in the English game (the Dutch key-name tags are not in the English table)
    ok(T(enMsg, 'FE/Data/FRONTEND.str').text('SPACE') === 'SPACE', 'a tag the English table lacks answers with its id');

    // ---- speech: the Dutch executable's table (index -> id) against the English clips
    const ids = readExeSpeechTable(await nl.read('LEGO eiland 2.exe'));
    let have = 0, lack = 0; const lacking = [];
    for (const id of ids) {
      const p = `_data/sounds/speech/Data/${id}.mp3`;
      if (lf.has(p)) { have++; ok(lf.size(p) > 0, `${id}: size`); } else { lack++; lacking.push(id); }
    }
    notes.push(`speech table: ${ids.length} ids, English clip for ${have}, none for ${lack}`);
    const nlHave = ids.filter((id) => nl.has(`_data/sounds/speech/Data/${id}.mp3`)).length;
    ok(lack === 0, `the English clips cover every id of the table (${have} of ${ids.length}; the Dutch ones cover ${nlHave}): ${lacking.slice(0, 5)}`);
    ok(lf.has('_data/sounds/speech/Data/MAN_1b.mp3') && lf.has('_data/sounds/speech/Data/MAN_2b.mp3') && lf.has('_data/sounds/speech/Data/MAN_3b.mp3'), 'the three renamed clips answer to their Dutch ids');
    ok(md5(await lf.read('_data/sounds/speech/Data/MAN_1b.mp3')) === md5(fs.readFileSync(path.join(enRoot, '_data/sounds/speech/English/MAN_1c.mp3'))), 'MAN_1b = the English MAN_1c');
    ok(md5(await lf.read('_data/sounds/speech/Data/LECSIN01.mp3')) === md5(fs.readFileSync(path.join(enRoot, '_data/sounds/speech/English/LECSIN01.mp3'))), 'LECSIN01 = the English clip');
    ok(md5(await lf.read('_data/sounds/speech/Data/LECSIN01.mp3')) !== md5(await nl.read('_data/sounds/speech/Data/LECSIN01.mp3')), 'LECSIN01 differs from the Dutch clip');
    // listing: speech/Data is exactly the English set, no Dutch-only clip is visible
    const listed = lf.list().filter((p) => /^_data\/sounds\/speech\/data\/.+\.mp3$/i.test(p));
    ok(listed.length === enSpeech.length + 3, `listing: ${listed.length} clips under speech/Data`);
    // the unreferenced Dutch-only clips are not reachable
    const nlOnly = nl.list().filter((p) => /^_data\/sounds\/speech\/data\/.+\.mp3$/i.test(p) && !red.has(p.toLowerCase()));
    ok(nlOnly.length > 0 && nlOnly.every((p) => !lf.has(p)), `${nlOnly.length} Dutch-only clips are hidden`);
    // ready() maps paths and ignores the hidden ones
    await lf.ready(['_data/sounds/speech/Data/LECSIN01.mp3', nlOnly[0]]);
    ok(true, 'ready() ran');
    ok(lf.has('_data/sounds/z07CSI/cedric defeat.wav') && md5(await lf.read('_data/sounds/z07CSI/cedric defeat.wav')) === md5(fs.readFileSync(path.join(enRoot, '_data/sounds/z07CSI/cedric defeat.wav'))), "Cedric's voice is the English wav");
    return { checked, failures, notes };
  },
};
