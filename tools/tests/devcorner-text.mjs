// Ontwikkelaarshoek, section 9 (teksten): the run-time flags of src/devcorner/text-data.ts against the numbers and examples of docs/re/unused.md 8.6 / 8.7: 162 message files / 2,370 lines,
// tags never referenced (BIP7-15, HUD popups, FRONTEND 29, PAUSE 31, BROWSER 7, UNUSED), shadowed duplicates (the binary search of FUN_004396a0: LIHOL6 HOLOA 177 loses to 182, LIHOL9, the
// FRONTEND and CREDITS pairs), the three English leftovers, the 13 lines recorded but never said, LEDTHT03 (audio, no table slot). Differences to the research are reported in the notes.
import fs from 'node:fs';
import path from 'node:path';
import { loadExe } from '../lib/engine-load.mjs';
import { ZONES } from '../../src/viewer/data.ts';
import { MessageTable } from '../../src/ui/strings.ts';
import { analyseTexts, CUTSCENE_ARCHIVES, cutsOf, exeTagSets, exeTextIndex, neverSaid, parseAllStr, parseEnglish, RESEARCH_NEVER_SAID, saytextIds, shownText } from '../../src/devcorner/text-data.ts';
import { speechRows } from '../../src/devcorner/audio-data.ts';

export default {
  name: 'devcorner-text',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());

    // parse
    const msgs = arc('messages');
    const { entries, files } = parseAllStr(msgs);
    ok(msgs.entries.filter((e) => /\.str$/i.test(e.path)).length === 164, 'messages has 164 .str members (162 with lines + the two empty LIFSM9 / LIFSM11)');
    ok(files.filter((f) => f.count > 0).length === 162, `files with lines ${files.filter((f) => f.count > 0).length} != 162`);
    ok(entries.length === 2370, `lines ${entries.length} != 2370`);
    ok(files.filter((f) => f.count === 0).map((f) => f.name).sort().join() === 'LIFSM11,LIFSM9', 'empty files LIFSM9 / LIFSM11');

    // the EXE side and the cutscenes
    const ex = exeTextIndex(pe);
    const sets = exeTagSets(ex);
    ok(ex.speech.length === 1732, `speech table ${ex.speech.length}`);
    ok(ex.strings.size === 46954, `EXE strings ${ex.strings.size}`);
    const withCuts = ctx.archives.filter((a) => a.entries.some((e) => /\.cut$/i.test(e.path))).map((a) => a.name).sort();
    ok(withCuts.join() === [...CUTSCENE_ARCHIVES].sort().join(), `archives with .cut: ${withCuts.join()} vs the list ${CUTSCENE_ARCHIVES.join()}`);
    const cuts = CUTSCENE_ARCHIVES.flatMap((n) => cutsOf(arc(n)));
    ok(cuts.length === 87, `compiled cutscenes ${cuts.length} != 87`);
    const saytext = saytextIds(cuts.map((c) => c.data), (e) => failures.push(`cut parse: ${e.message}`));
    const cutNames = new Set(cuts.map((c) => c.name.toLowerCase()));
    ok(saytext.has('LECSRS05') && !saytext.has('LECSRS06'), 'LECSRS05 is said, LECSRS06 is not');
    notes.push(`${cuts.length} cutscenes, ${saytext.size} SayText ids`);

    // English leftovers: exactly three archives hold messages/english (checked over all 39 archives)
    const engArch = ctx.archives.filter((a) => a.entries.some((e) => /(^|\/)messages\/english\//i.test(e.path))).map((a) => a.name).sort();
    ok(engArch.join() === 'z27TRX,z38PAR,z40aPO', `English leftovers in ${engArch.join()}`);
    const english = engArch.flatMap((n) => parseEnglish(n, arc(n)));
    ok(new Set(english.map((e) => e.file)).size === 3, 'three English files');
    ok(english.some((e) => e.tag === 'TRX_INST1' && e.text === 'T-Rex Racing'), 'english.txt TRX_INST1 "T-Rex Racing"');
    ok(english.some((e) => e.tag === 'TRX_LOSE3' && e.text === 'Try again'), 'english.txt TRX_LOSE3');
    ok(english.some((e) => e.tag === 'LESGPT01' && /^Land safely on the target/.test(e.text) && e.voice === 761), 'PARSTR.str LESGPT01 = speech 761 "Land safely on the target ..."');
    ok(english.some((e) => e.tag === 'OGSGPO01' && /^Looks like all of that parachute practice/.test(e.text) && e.voice === 1816), 'APOSTR.str OGSGPO01 = speech 1816');
    ok(english.filter((e) => e.file.endsWith('PARSTR.str')).length >= 20 - 6 && english.every((e) => e.english), 'English PARSTR.str lines (LESGPT01-14 + 6 CONTROLn)');

    // the analysis
    const mp3 = new Set(fs.readdirSync(path.join(ctx.dataRoot, '_data/sounds/speech/Data')).map((f) => f.replace(/\.mp3$/i, '').toLowerCase()));
    const a = analyseTexts([...entries, ...english], { exe: sets.literal, pooled: sets.pooled, cutNames, saytext, speech: ex.speech, mp3, zoneCodes: ZONES.map((z) => z.slice(3).toUpperCase()), controlFormat: ex.strings.has('CONTROL%i') });
    const st = a.stats;
    ok(st.total === 2370 && st.files === 162, `stats ${st.total} / ${st.files}`);
    ok(st.distinctVoices === 1730, `distinct speech indices used by .str lines ${st.distinctVoices} != 1730 (unused.md 7.7 "1,730 ids")`);
    ok(st.voiceClipMissing === 4, `lines whose clip file is missing ${st.voiceClipMissing} != 4`);
    const missingIds = [...new Set(a.entries.filter((e) => !e.english && e.voice >= 0 && !e.clipFile).map((e) => e.clip))].sort();
    ok(missingIds.join() === 'CARQAA03,CARQAA07,CARQBB06,CASGJO11', `missing clip ids ${missingIds.join()}`);

    // never shown (8.6)
    const never = a.entries.filter((e) => !e.english && e.ref === null);
    const nf = (f) => never.filter((e) => e.file === f).length;
    const nt = (t) => never.some((e) => e.tag === t);
    for (let i = 7; i <= 15; i++) ok(nt(`BIP${i}`), `BIP${i} must be never shown`);
    for (let i = 1; i <= 6; i++) ok(!nt(`BIP${i}`), `BIP${i} is a literal of the code (shown)`);
    for (const t of ['WAB1', 'WAB2', 'WAB3', 'WAS1', 'WAS2', 'WAS3', 'WAS4', 'FSH5', 'JST2', 'JST3', 'JST16', 'JST17']) ok(nt(t), `${t} must be never shown`);
    ok(nf('FE/Data/FRONTEND.str') === 29, `FRONTEND never shown ${nf('FE/Data/FRONTEND.str')} != 29`);
    ok(nf('FE/Data/PAUSE.str') === 31, `PAUSE never shown ${nf('FE/Data/PAUSE.str')} != 31`);
    ok(nf('FE/Data/BROWSER.str') === 7, 'BROWSER.str 7');
    ok(never.filter((e) => e.tag === 'UNUSED').length === 2, 'two UNUSED lines');
    for (const t of ['FENEW', 'FELOAD', 'LEVSKB', 'CtrlM3', 'CutM0', 'PPHM3', 'SCROLLLOCK', 'QUIT', 'MCREADING', 'PABTC']) ok(nt(t), `${t} never shown`);
    for (const t of ['FEHIGH', 'LEVSSH', 'CONTROL0', 'HOLOB', 'BRIKA', 'LECSRS05', 'FRECR00']) ok(!nt(t), `${t} is referenced`);
    ok(st.neverShown === 171, `never shown total ${st.neverShown} (computed 171: no total in the research)`);
    notes.push(`never shown: ${st.neverShown} lines in ${new Set(never.map((e) => e.file)).size} files (CREDITS.str name lines ${nf('FE/Data/CREDITS.str')}, FRONTEND ${nf('FE/Data/FRONTEND.str')}, PAUSE ${nf('FE/Data/PAUSE.str')}, BIP ${nf('AI/Data/BIP.str')}, BROWSER ${nf('FE/Data/BROWSER.str')})`);

    // shadowed duplicates (8.6): the simulated binary search
    const sh = a.entries.filter((e) => e.shadowed && !e.english);
    const find = (file, tag, field) => sh.find((e) => e.file === file && e.tag === tag && e.field.trim() === field);
    const shadow = (file, tag) => sh.filter((e) => e.file === file && e.tag === tag);
    const h177 = find('LI/Data/LIHOL6.str', 'HOLOA', '177');
    ok(!!h177 && h177.winner.field.trim() === '182' && shownText(h177).trim() === 'Pas op voor de Blokbotten!' && /^Vlug Pepper, grijp de koppen/.test(shownText(h177.winner)), 'LIHOL6 HOLOA 177 "Pas op voor de Blokbotten!" is shadowed by 182');
    const h681 = find('LI/Data/LIHOL9.str', 'HOLOA', '681');
    ok(!!h681 && h681.winner.field.trim() === '682' && /^Je moet de bladzijden nu terugbrengen/.test(shownText(h681)) && /^Breng deze helikopter naar/.test(shownText(h681.winner)), 'LIHOL9 HOLOA 681 is shadowed by 682');
    const pairs = [['FE/Data/FRONTEND.str', 'FEHIGH', 'HOOG', 'HOGE RES'], ['FE/Data/FRONTEND.str', 'FELOW', 'LAAG', 'LAGE RES'], ['FE/Data/FRONTEND.str', 'LEVSSH', 'Slangen schieten', 'SLANGENJACHT'], ['FE/Data/FRONTEND.str', 'LEVOSD', 'Adventure eiland', 'WOESTIJNOASE'],
      ['FE/Data/FRONTEND.str', 'EndGame3M0', 'Jammer!', 'Mislukt'], ['FE/Data/FRONTEND.str', 'LEVOGL', 'OGEL eiland', 'OGEL'], ['FE/Data/CREDITS.str', 'FRECR81', 'Producer', 'Senior Producer'], ['FE/Data/CREDITS.str', 'FRECR83', 'Assistant Producer', 'Producer'],
      ['FE/Data/CREDITS.str', 'FRECR90', 'Andrew Donnelly - Testers', 'Testers']];
    // (the research lists each pair as "A vs B" without saying which wins: the winner depends on the positions in the sorted table, so the check is: exactly these two texts, one of them shadowed)
    const winners = [];
    for (const [f, t, x, y] of pairs) {
      const s = shadow(f, t);
      const both = s.length === 1 && [shownText(s[0]).trim(), shownText(s[0].winner).trim()].sort().join('|') === [x, y].sort().join('|');
      ok(both, `${f} ${t}: expected "${x}" / "${y}" (got ${s.map((e) => `${shownText(e)} -> ${shownText(e.winner)}`).join('; ')})`);
      if (s[0]) winners.push(`${t}: "${shownText(s[0].winner).trim()}" wins over "${shownText(s[0]).trim()}"`);
    }
    notes.push(`winners of the binary search: ${winners.join('; ')}`);
    // the table's own search agrees (simulation = MessageTable.find)
    const t6 = new MessageTable([msgs.read(msgs.find('LI/Data/LIHOL6.str'))]);
    ok(t6.voice('HOLOA') === 182, 'MessageTable.find returns HOLOA 182 for LIHOL6');
    ok(sh.length === 14, `shadowed ${sh.length} != 14 (11 of the research + 3)`);
    const extra = sh.filter((e) => !pairs.some(([f, t]) => f === e.file && t === e.tag) && !/LIHOL[69]/.test(e.file)).map((e) => `${e.file} ${e.tag}`);
    notes.push(`shadowed duplicates: ${sh.length}; the research lists 11, extra found by the same simulation: ${extra.join(', ')}`);
    ok(extra.sort().join() === 'CI/Data/CSIFSM4.str UNUSED,FE/Data/IFC.str LEVIFC,FE/Data/IFC.str LEVLGI', `extra shadows ${extra.join()}`);

    // recorded but never said (8.7) + the battery lines + the UNUSED joke
    const said = neverSaid(a).map((e) => e.clip).sort();
    ok(said.join() === RESEARCH_NEVER_SAID.map((r) => r[0]).sort().join(), `never said: ${said.join()} vs the 13 of the research`);
    ok(said.length === 13, `never said ${said.length} != 13`);
    for (const id of ['LECSRS06', 'LECSRS07', 'LECSRS08']) ok(neverSaid(a).some((e) => e.tag === id && e.clipFile), `${id} (battery line) has text + clip and is never said`);
    const joke = a.entries.filter((e) => e.tag === 'UNUSED');
    ok(joke.length === 2 && joke.map((e) => e.voice).sort().join() === '1293,1303' && joke.every((e) => /touwtje/.test(shownText(e))) && joke.every((e) => e.clipFile), 'UNUSED:1293 / 1303 "Hoe lang is een touwtje?" with audio');
    ok(joke.filter((e) => e.shadowed).length === 1, 'one of the UNUSED lines is shadowed');

    // voice versus clips: every voice index resolves; LEDTHT03 has audio but no table slot
    const sp = speechRows(ex.speech, [...mp3].map((m) => `${m}.mp3`));
    const ledtht = a.entries.filter((e) => /^LEDTHT/.test(e.clip));
    ok(sp.orphans.some((o) => o.toUpperCase() === 'LEDTHT03') && !ex.speech.includes('LEDTHT03') && !a.entries.some((e) => e.clip === 'LEDTHT03'), 'LEDTHT03: mp3 exists, no speech table slot, no line');
    ok(ledtht.length > 0, 'LEDTHT01 etc. have lines');
    // clips with no line at all: the research says every table id is used by some .str
    const used = new Set(a.entries.filter((e) => !e.english).map((e) => e.voice));
    const unusedIdx = sp.rows.filter((r) => r.kind === 'tabel' && !used.has(r.index));
    notes.push(`table indices no line uses: ${unusedIdx.length} (${unusedIdx.slice(0, 6).map((r) => `#${r.index} ${r.id}`).join(', ')}${unusedIdx.length > 6 ? ' ...' : ''}) of ${ex.speech.length}; the research says every id is used (1,730 distinct indices are)`);
    ok(unusedIdx.length === ex.speech.length - 1730, `unused table indices ${unusedIdx.length} != ${ex.speech.length - 1730}`);
    // text with voice / without
    ok(st.withVoice === 1730 && st.withoutVoice === 640, `with voice ${st.withVoice} / without ${st.withoutVoice} (audio.md 6.3: 640 have -1)`);
    return { checked, failures, notes };
  },
};
