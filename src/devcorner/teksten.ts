// Ontwikkelaarshoek, section 9 "Teksten": a browser over all message tables (the `messages` archive: 162 `.str` files / 2,370 lines) with the flags of docs/re/unused.md 8.6 / 8.7,
// computed at run time by text-data.ts (pure, tested against the numbers of the research):
//  - "nooit getoond": no static evidence that the line is ever shown (EXE string, cutscene SayText, runtime patterns CONTROL%i / LEV<zone> / NPC lines / HOLO<letter> / IFC<code><nn>);
//  - "schaduw-duplicaat": a second line with the same tag in the same file that the original's binary search (FUN_004396a0 over the stable-sorted table) never returns;
//  - "Engels": the English leftovers inside the zone archives z38PAR (PARSTR.str), z40aPO (APOSTR.str) and z27TRX (english.txt), not part of the game's tables;
//  - "tekst met stem" / "tekst zonder stem" / "stem zonder tekst": the 4 character field of a line is the index into the EXE's speech table (FUN_00439bf8): the clip id and its file;
//    voice clips no line uses (the 67 orphan mp3 files and any table index without a line) are the "stem zonder tekst" rows;
//  - "opgenomen, nooit gezegd" (8.7): lines of a cutscene's text table with a clip that no cutscene says (13 expected), with the three battery lines LECSRS06-08 and the UNUSED joke.
// Each line with a clip has a play button (the jukebox of section 8). The flags need the nine cutscene archives (about 200 MB, read once): the line at the top says where it is.
import type { SectionDef, SectionView } from './types.ts';
import type { DevCorner } from './corner.ts';
import { h, badge, block, bar, note, filterBox } from './ui.ts';
import { jukeboxOf, playBtn, playStatus, playerBar, PagedList, syncPlayers } from './audio-ui.ts';
import type { JbSource } from './audio-player.ts';
import { textLoadOf } from './text-load.ts';
import type { TextBundle } from './text-load.ts';
import { REF_LABEL, RESEARCH_NEVER_SAID, neverSaid, shownText } from './text-data.ts';
import type { AnalysedEntry } from './text-data.ts';
import { speechRows } from './audio-data.ts';
import type { SpeechRow } from './audio-data.ts';
import { ORPHAN_TRANSCRIPTS } from './audio-orphans.ts';
import { readExeSpeechTable } from '../formats/sound.ts';

const ORPHAN = new Map(ORPHAN_TRANSCRIPTS.map((o) => [o[0].toLowerCase(), o] as const));

/** a row of the browser: a text line or a voice clip without a line */
type Row = { kind: 'tag'; e: AnalysedEntry } | { kind: 'clip'; r: SpeechRow };

const MODES: [string, string][] = [
  ['alles', 'alle regels'], ['nooit', 'nooit getoond'], ['schaduw', 'schaduw-duplicaat'], ['engels', 'Engels (resten in zone-archieven)'],
  ['metstem', 'tekst met stem'], ['zonderstem', 'tekst zonder stem'], ['stemzonder', 'stem zonder tekst'], ['ongezegd', 'opgenomen, nooit gezegd'],
];

function build(c: DevCorner): SectionView {
  const jb = jukeboxOf(c);
  const tl = textLoadOf(c);
  const pb = playerBar(jb);
  const status = h('div', { className: 'dc-note', textContent: tl.progress });
  const root = h('div', {}, pb.el, status);
  let built = false;

  const clipSrc = (clip: string, label: string): JbSource => ({ kind: 'speech', id: clip, label });

  const buildBody = (b: TextBundle) => {
    built = true;
    const sh = c.sh;
    const a = b.analysis, st = a.stats;
    const mp3 = sh.files.list().filter((p) => /^_data\/sounds\/speech\/data\/[^/]+\.mp3$/i.test(p)).map((p) => /([^/]+)$/.exec(p)![1]);
    const sp = speechRows(readExeSpeechTable(sh.pe.data), mp3);
    const clipRows: SpeechRow[] = sp.rows.filter((r) => (r.kind === 'wees' || (r.dupOf < 0 && !a.byVoice.has(r.index) && !sp.rows.some((o) => o.kind === 'tabel' && o.index !== r.index && o.id.toLowerCase() === r.id.toLowerCase() && a.byVoice.has(o.index)))));
    const exp = (n: number, e: number, tol = 0) => badge(`${n} (onderzoek: ${e})`, Math.abs(n - e) <= tol ? 'ok' : 'warn');

    // ------------------------------------------------------------------------------------------------ numbers
    const never = neverSaid(a);
    const shadow = a.entries.filter((e) => e.shadowed && !e.english);
    const stats = block('Wat er is berekend',
      bar(badge(`${st.files} bestanden`), exp(st.files, 162), badge(`${st.total} regels`), exp(st.total, 2370)),
      bar('nooit getoond: ', exp(st.neverShown, 171, 0), h('span', { className: 'dc-note', textContent: 'het onderzoek noemt geen totaal; de bekende gevallen (BIP7-15, JST2/3/16/17, WAB1-3, WAS1-4, FSH5, UNUSED, FRONTEND 29, PAUSE 31, BROWSER 7) zitten er allemaal in; de rest zijn 81 naamregels van CREDITS.str' })),
      bar('schaduw-duplicaten: ', exp(shadow.length, 11), h('span', { className: 'dc-note', textContent: 'het onderzoek telde 11 (LIHOL6, LIHOL9, FRONTEND 6, CREDITS 3); de simulatie vindt er 3 meer: LEVLGI en LEVIFC in IFC.str (zelfde logica) en de tweede UNUSED-regel van CSIFSM4.str' })),
      bar('Engels: ', badge(`${st.english} regels in ${new Set(a.entries.filter((e) => e.english).map((e) => e.file)).size} bestanden`), h('span', { className: 'dc-note', textContent: 'alleen z27TRX, z38PAR en z40aPO zijn doorzocht (een test heeft alle archieven gecontroleerd)' })),
      bar('met stem: ', exp(st.withVoice, 1730), badge(`${st.distinctVoices} verschillende indices (onderzoek: 1730)`), ' zonder stem: ', badge(String(st.withoutVoice)), ' stem zonder bestand: ', exp(st.voiceClipMissing, 4)),
      bar('opgenomen, nooit gezegd: ', exp(never.length, 13), h('span', { className: 'dc-note', textContent: `${b.cuts} cutscenes gelezen, ${b.saytext} SayText-id's` })));

    // ------------------------------------------------------------------------------------------------ the special blocks
    const sayRow = (e: AnalysedEntry, extra: string) => [
      e.clipFile ? playBtn(jb, clipSrc(e.clip, `${e.tag} (${e.clip})`)) : null,
      h('span', { className: 'dc-mono', textContent: `${e.tag} / ${e.clip}` }),
      h('span', { className: 'dc-tx', textContent: shownText(e) }),
      h('span', { className: 'dc-note', textContent: `${e.file}${extra ? `: ${extra}` : ''}` }),
    ];
    const whereOf = new Map(RESEARCH_NEVER_SAID.map((r) => [r[0], r[1]]));
    const neverTable = h('table', { className: 'dc-table' }, h('thead', {}, h('tr', {}, h('th'), h('th', { textContent: 'id' }), h('th', { textContent: 'tekst' }), h('th', { textContent: 'waar' }))),
      h('tbody', {}, ...never.map((e) => { const tr = h('tr', {}); for (const x of sayRow(e, whereOf.get(e.clip) ?? '')) tr.append(h('td', {}, x)); return tr; })));
    const battery = never.filter((e) => /^LECSRS0[678]$/.test(e.tag));
    const joke = a.entries.filter((e) => e.tag === 'UNUSED');
    const specials = h('div', {},
      block(`Opgenomen maar nooit gezegd (${never.length})`,
        note('Regels van de tekstbestanden van cutscenes (csi01, lgi04, adv04 ...) met een stemopname die geen enkele cutscene zegt: uitgecommentarieerd in het script, alleen in een PlayStation-bron, of nooit geschreven. De spelzones (minigames) zeggen hun regels met een spraakindex uit de code en worden hier niet beoordeeld.'),
        neverTable),
      block('Batterijregels LECSRS06-08 (de radio van DJ)',
        note('Eilandrecords BTB0..BTB9 (batterijen, Battery*.msh) worden verborgen en nooit opgepakt; var 22 SWITCH_GME_BATTERY_LEVEL wordt niet gelezen of geschreven. lgi10.txt heeft de drie DJ-regels uitgecommentarieerd: "Oh eh, voor ik het vergeet, die radio werkt op batterijen." / "Misschien heb je deeeeeze nodig." / "Oh sorry, Pepper, je moet ze onderweg maar oprapen." (spraak 728-730). Tekst en audio bestaan; LECSRS05 en SWITCH_GME_RADIO_ON zijn wel in gebruik.'),
        h('table', { className: 'dc-table' }, h('tbody', {}, ...(battery.length ? battery : []).map((e) => { const tr = h('tr', {}); for (const x of sayRow(e, '')) tr.append(h('td', {}, x)); return tr; })))),
      block('De UNUSED-regel (grap)',
        note('CSIFSM4.str heeft de tag UNUSED twee keer (1293 en 1303): "Hoe lang is een touwtje?". Zes tekens: onbereikbaar voor het schema van vier tekens + suffix, en de tweede regel verliest bovendien de binaire zoekactie.'),
        h('table', { className: 'dc-table' }, h('tbody', {}, ...joke.map((e) => { const tr = h('tr', {}); for (const x of sayRow(e, `voice-index ${e.voice}${e.shadowed ? ', schaduw-duplicaat' : ''}`)) tr.append(h('td', {}, x)); return tr; })))));

    // ------------------------------------------------------------------------------------------------ the browser
    let q = '', mode = 'alles', file = '';
    const rowsAll: Row[] = a.entries.map((e) => ({ kind: 'tag', e }));
    const clipSet: Row[] = clipRows.map((r) => ({ kind: 'clip', r }));
    const files = [...new Set(a.entries.map((e) => e.file))].sort((x, y) => x.localeCompare(y));
    const textOf = (r: Row): string => (r.kind === 'tag' ? shownText(r.e) : r.r.kind === 'wees' ? ORPHAN.get(r.r.id.toLowerCase())?.[2] ?? '' : '');
    const list = new PagedList<Row>([
      { head: '', cell: (r) => (r.kind === 'tag' ? (r.e.clipFile ? playBtn(jb, clipSrc(r.e.clip, `${r.e.tag} (${r.e.clip})`)) : null) : playBtn(jb, clipSrc(r.r.file.replace(/\.mp3$/i, ''), r.r.id), r.r.exists ? '' : 'bestand ontbreekt')) },
      { head: 'bestand', cell: (r) => (r.kind === 'tag' ? h('span', { className: 'dc-mono', textContent: r.e.file.replace(/^([A-Z]{2})\/Data\//, '$1/') }) : h('span', { className: 'dc-note', textContent: 'spraak/Data' })) },
      { head: 'tag', cell: (r) => (r.kind === 'tag' ? h('span', { className: 'dc-mono', title: r.e.ref ? REF_LABEL[r.e.ref] : r.e.english ? 'Engels restant, geen onderdeel van de spelregeltabellen' : 'geen aanwijzing dat de regel ooit getoond wordt', textContent: r.e.tag }) : h('span', { className: 'dc-mono', textContent: r.r.id })) },
      { head: 'tekst', cls: 'dc-tx', cell: (r) => {
        if (r.kind === 'tag') return h('span', { textContent: textOf(r) });
        const o = ORPHAN.get(r.r.id.toLowerCase());
        return r.r.kind === 'wees' ? h('span', {}, o ? o[2] : '(geen transcript)', ' ', badge('automatisch getranscribeerd, bij benadering', 'info')) : h('span', { className: 'dc-note', textContent: '(geen tekstregel)' });
      } },
      { head: 'stem', cell: (r) => (r.kind === 'tag' ? (r.e.voice >= 0 ? h('span', { className: 'dc-mono', textContent: `${r.e.clip || '?'} #${r.e.voice}` }) : h('span', { className: 'dc-note', textContent: '-' })) : h('span', { className: 'dc-mono', textContent: r.r.index >= 0 ? `#${r.r.index}` : 'wees' })) },
      { head: '', cell: (r) => {
        if (r.kind === 'clip') return h('span', {}, r.r.kind === 'wees' ? badge('wees: niet in de spraaktabel', 'warn') : badge('stem zonder tekst', 'info'), !r.r.exists ? badge('bestand ontbreekt', 'red') : null, playStatus(clipSrc(r.r.file.replace(/\.mp3$/i, ''), r.r.id)));
        const e = r.e;
        return h('span', {},
          e.english ? badge('Engels', 'red') : null,
          !e.english && e.ref === null ? badge('nooit getoond', 'warn') : null,
          e.shadowed ? badge('schaduw-duplicaat', 'warn') : null,
          e.unsaid ? badge('opgenomen, nooit gezegd', 'warn') : null,
          e.voice >= 0 ? badge(e.clipFile ? 'tekst met stem' : 'stem zonder bestand', e.clipFile ? 'ok' : 'red') : null,
          e.shadowed && e.winner ? h('span', { className: 'dc-note', textContent: `wint: #${e.winner.line} "${shownText(e.winner).slice(0, 40)}"` }) : null,
          e.clipFile ? playStatus(clipSrc(e.clip, `${e.tag} (${e.clip})`)) : null);
      } },
    ], 120, (r) => (r.kind === 'tag' && r.e.shadowed ? 'dim' : ''));
    const match = (r: Row): boolean => {
      if (r.kind === 'clip') { if (mode !== 'stemzonder') return false; if (file) return false; return !q || `${r.r.id} ${textOf(r)}`.toLowerCase().includes(q); }
      const e = r.e;
      switch (mode) {
        case 'alles': if (e.english) return false; break;
        case 'nooit': if (e.english || e.ref !== null) return false; break;
        case 'schaduw': if (!e.shadowed) return false; break;
        case 'engels': if (!e.english) return false; break;
        case 'metstem': if (e.english || e.voice < 0) return false; break;
        case 'zonderstem': if (e.english || e.voice >= 0) return false; break;
        case 'stemzonder': return false;
        case 'ongezegd': if (!e.unsaid) return false; break;
        default: break;
      }
      if (file && e.file !== file) return false;
      return !q || `${e.tag} ${e.file} ${e.clip} ${shownText(e)}`.toLowerCase().includes(q);
    };
    const apply = () => {
      const src = mode === 'stemzonder' ? clipSet : rowsAll;
      list.setItems(src.filter(match));
      syncPlayers(jb, list.el);
    };
    const msel = h('select', { className: 'dc-select', onchange: () => { mode = msel.value; apply(); } }, ...MODES.map(([v, t]) => h('option', { value: v, textContent: t })));
    const fsel = h('select', { className: 'dc-select', onchange: () => { file = fsel.value; apply(); } }, h('option', { value: '', textContent: 'alle bestanden' }), ...files.map((f) => h('option', { value: f, textContent: f })));
    const browser = block('Alle regels',
      note('De regel die het spel toont is de eerste die zijn binaire zoekactie vindt; een schaduw-duplicaat (grijs) wordt nooit getoond. Engelse resten komen niet in de spelregeltabellen voor. Zet de keuzelijst op "stem zonder tekst" voor de stemopnames zonder regel (de 67 wezen met transcript).'),
      bar(filterBox('zoek tag, bestand, id of tekst', (v) => { q = v; apply(); }), msel, fsel),
      list.el);
    root.append(stats, specials, browser);
    apply();
    status.textContent = `klaar: ${b.entries.length} regels uit ${b.files.length} bestanden, ${b.english.length} Engelse regels`;
  };

  const run = () => {
    if (tl.bundle && !built) buildBody(tl.bundle);
    else if (tl.error) status.textContent = `kon de teksten niet laden: ${tl.error}`;
    else if (!built) status.textContent = tl.progress;
  };
  tl.listeners.push(run);
  void tl.promise.then(run, run);
  run();

  return {
    el: root,
    show() { pb.update(); },
    hide() { jb.stop(); },
    refresh() { pb.update(); if (!built) status.textContent = tl.progress; },
  };
}

export const section: SectionDef = {
  id: 'teksten', title: 'Teksten',
  blurb: 'Alle berichtentabellen met vlaggen: nooit getoond, schaduw-duplicaat, Engels, stem met of zonder tekst',
  build,
};
