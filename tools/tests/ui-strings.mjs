// src/ui/strings.ts: message tables with the lookup semantics of the original (SDText.c), menu label resolution, which files exist.
import { MessageTable, MenuStrings, expandMessage, parseMessageFile, loadMessages, FRONTEND_FILES, PAUSE_FILES, IFC_FILES, STD_FILES, CREDITS_FILES, MENU_FILES, ZONE_FILES, findStrPath } from '../../src/ui/strings.ts';
import { parseStr } from '../../src/formats/text.ts';

const enc = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

// every `!` label of the menu pages (tools/gs_menu.py of decomp-le2: 24+ pages) -> index of the table it resolves in (0 frontend, 1 pause, 2 ifc), -1 = in none of the three
const MENU_IDS = {
  MAINMENU: 0, FESTART: 0, FEOPTION: 0, CREDITS: 0, FEQUIT: 0, KeysM2: 0, KeysM1: 0, FELODGAM: 0, FileM1: -1, FileM2: -1, BACK: 1, SAVE: 1, FECONTRL: 0, FEGRAPHC: 0, FESOUND: 0, FECUTSCE: 0,
  Pause: -1, PauseM4: 0, LEVPPH: 1, FENEWGAM: 0, FEERAGAM: 0, FEKEYS: 0, CtrlM2: 0, FEMOUSEN: 0, FOG: 1, GraphM1: 0, FERESOLN: 0, FEMUSVOL: 0, FESNDVOL: 0, FESPCVOL: 0, FESPEECH: 0, FESUBTLE: 0,
  FEEXIT: 0, EndGameM2: 0, MCDESCCOMP: 1, CONTINUE: 1, EndGame2M2: 0, PPHSUBGAME: 0, PauseM6: 0, PauseM7: 0, EndGame3M0: 0, EndGame3M2: 0, EndGame3M1: 0, PPHM0: 0, PPHSOUND: 0, PPHMOVIES: 0, FECREDIT: 0,
};
const MENU_TEXT = { FESTART: 'STARTEN', FEQUIT: 'STOPPEN', KeysM1: 'OK', BACK: 'TERUG', PauseM4: 'DOORGAAN', LEVPPH: 'Huis van Pepper', PPHMOVIES: 'Film ', MAINMENU: 'HOOFDMENU', FOG: 'Vervagingseffect' };

export default {
  name: 'ui-strings',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0;
    const eq = (what, got, want) => { checked++; if (got !== want) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
    const ok = (what, cond) => { checked++; if (!cond) failures.push(what); };

    // ---- loader (FUN_00439126): tags, comments, lines without ':', 4 char id field
    const t = new MessageTable([enc('B:-1  bee\r\nA:12  aap\\nnoot\r\n#c:x\r\nno colon here\r\n\r\nC:  1 $$ %% && \\\\ \\t \\q x\r\nD:99  caf\xe9 \xff \x9c\r\nE:5   $s1|%x2|&y3|$a$\r\n')]);
    eq('entries', t.size, 5);
    eq('sorted', t.entries.map((e) => e.tag).join(','), 'A,B,C,D,E');
    eq('plain', t.text('B'), 'bee');
    eq('escape \\n', t.text('A'), 'aap\nnoot');
    eq('escapes $$ %% && \\\\ \\t, unknown \\q dropped', t.text('C'), '$ % & \\ \t  x');
    eq('fold >= 0xE0 to upper case (0xE9 -> 0xC9, 0xFF -> 0xDF, 0x9C stays)', t.text('D'), 'caf\xc9 \xdf \x9c');
    eq('missing id returns the id', t.text('NOPE'), 'NOPE');
    eq('missing id is expanded like text', t.text('a\\nb'), 'a\nb');
    ok('has(A)', t.has('A')); ok('!has(NOPE)', !t.has('NOPE')); ok('lookup is case sensitive', !t.has('a'));
    eq('voice A', t.voice('A'), 12); eq('voice -1 field', t.voice('B'), -1); eq('voice D', t.voice('D'), 99); eq('voice missing', t.voice('NOPE'), -1);
    eq('voice field must start with a digit', new MessageTable([enc('V:  7 x\r\n')]).voice('V'), -1);
    // argument markers $x1 -> arg 1 as string, %x2 decimal, &y3 hex, $a$ literal
    eq('args', t.text('E', 'zero', 'one', 42.9, 255), 'one|42|ff|$');
    eq('args missing -> empty', expandMessage('[$x0]'), '[]');
    // duplicates: sort is stable, binary search returns one of them
    const d = new MessageTable([enc('K:-1  first\r\nK:-1  second\r\nJ:-1  j\r\n')]);
    ok('duplicate tag found', d.text('K') === 'first' || d.text('K') === 'second');
    // merge of several files
    const m = new MessageTable([enc('A:-1  a1\r\n'), enc('B:-1  b2\r\n')]);
    eq('merge', m.text('A') + m.text('B'), 'a1b2');
    // control byte before the colon drops the tag; a TAB ends the value
    eq('control byte in a tag drops that tag (a new one may start after it)', parseMessageFile(enc('AB\tC:-1  x\r\nZ:-1  y\r\n')).map((e) => e.tag).join(','), 'C,Z');
    eq('TAB ends a value', parseMessageFile(enc('Z:-1  ab\tcd\r\n'))[0].text, 'ab');
    eq('last line without newline', parseMessageFile(enc('Z:-1  end'))[0].text, 'end');

    // ---- the shipped files
    const arc = ctx.archives.find((a) => a.name === 'messages');
    let files = 0, tags = 0, voiceDiffs = 0;
    for (const e of arc.entries.filter((x) => /\.str$/i.test(x.path))) {
      const data = arc.read(e);
      files++;
      const table = new MessageTable([data]);
      const ref = parseStr(data);
      // our loader finds exactly the tags of the reference parser (the reference reads the id field strictly; compare tag lists)
      if (table.size !== ref.length) failures.push(`${e.path}: ${table.size} entries, parseStr ${ref.length}`);
      const dup = new Map(); for (const r of ref) dup.set(r.tag, (dup.get(r.tag) ?? 0) + 1);
      for (const r of ref) {
        tags++; checked++;
        const f = table.find(r.tag);
        if (!f || f.tag !== r.tag) { failures.push(`${e.path}: binary search misses ${r.tag}`); continue; }
        if (dup.get(r.tag) === 1) {
          if (table.voice(r.tag) !== (r.soundId >= 0 ? r.soundId : -1)) voiceDiffs++;
        }
      }
    }
    eq('voice ids = parseStr sound ids (unique tags)', voiceDiffs, 0);
    notes.push(`${files} .str files, ${tags} tags found by the binary search`);

    // ---- presets
    const all = (names) => names.every((n) => arc.has(n));
    ok('FRONTEND/PAUSE/IFC/STD/CREDITS files exist', all([...FRONTEND_FILES, ...PAUSE_FILES, ...IFC_FILES, ...STD_FILES, ...CREDITS_FILES]));
    for (const [z, fs] of Object.entries(ZONE_FILES)) ok(`ZONE_FILES ${z} exist (${fs})`, all(fs));
    eq('findStrPath CSI02', findStrPath(arc, 'CSI02'), 'CI/Data/CSI02.str');
    const fe = loadMessages(arc, FRONTEND_FILES);
    eq('FESTART', fe.text('FESTART'), 'STARTEN'); eq('LOADING (loading card)', fe.text('LOADING'), 'LADEN');
    eq('STD SGGOLD voice 775', loadMessages(arc, STD_FILES).voice('SGGOLD'), 775);
    eq('CREDITS FRECR01', loadMessages(arc, CREDITS_FILES).text('FRECR01'), 'LEGO ISLAND II');

    // ---- menu labels: FUN_0041c270 order frontend, pause, ifc
    const tabs = MENU_FILES.map((f) => loadMessages(arc, f));
    const ms = new MenuStrings(...tabs);
    for (const [id, want] of Object.entries(MENU_IDS)) {
      const k = tabs.findIndex((x) => x.has(id));
      eq(`menu id ${id} resolves in table`, k, want);
      eq(`resolves('!${id}')`, ms.resolves('!' + id), want >= 0);
      if (want < 0) eq(`unresolved !${id} shows the id`, ms.label('!' + id), id);
    }
    for (const [id, text] of Object.entries(MENU_TEXT)) eq(`label !${id}`, ms.label('!' + id), text);
    eq('literal label', ms.label('Key XX'), 'Key XX');
    eq('@prefix!ID = "%s%s"(text, prefix)', ms.label('@ 1!PPHMOVIES'), 'Film  1');
    eq('empty label', ms.label(''), '');
    // pause table only (Spec: PAUSE.str keys are upper case, `!Pause` does not hit PAUSE: lookup is case sensitive)
    ok('PAUSE key is upper case only', tabs[1].has('PAUSE') && !tabs[1].has('Pause'));
    return { checked, failures, notes };
  },
};
