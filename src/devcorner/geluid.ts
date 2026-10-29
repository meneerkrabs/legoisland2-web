// Ontwikkelaarshoek, section 8 "Geluid en muziek": a jukebox over everything the game ships in `_data/sounds`, with the finds of docs/re/unused.md 7.5-7.7 computed at run time.
//  (a) Losse geluiden: every wav / mid below `_data/sounds` (CUTSCENE included), badge "ongebruikt" for those no string of the EXE names (66 wavs + 2 .mid expected); the SND_* names of
//      the sound table (902 names the EXE registers in the dead initialiser FUN_00877550; `readExeSoundTable` reads them from that function's code) are the id labels;
//  (b) Muziek: the 50 .sgt segments and 229 .sty styles ("ongebruikt": 10 and 14 expected), played through the port's DirectMusic engine (src/audio/dm). A segment that is not in the
//      original's music table has no table DLS row: the bank is chosen here (audio-music.ts, "bij benadering"); a style is never played alone by the game: it plays as a synthetic
//      segment (port extension). "Alles testen" renders every segment offline through the engine and writes the verdict in the row;
//  (c) Spraak: all 1,732 table indices (1,635 distinct ids; the research says "1,730 ids" = the indices the .str lines use) with the transcript of the message tables, the 67 orphan
//      clips with the whisper transcripts (audio-orphans.ts, APPROXIMATE) and the 4 ids whose file is missing;
//  (d) Geluidstabel: the 902 SND_* / CSSND_* rows (id, name, file, volume, loop).
// The jukebox (audio-player.ts) is its own player: the game's music and sounds are untouched. Playback stops when the section is left.
import type { SectionDef, SectionView } from './types.ts';
import type { DevCorner } from './corner.ts';
import { h, btn, badge, block, bar, note, filterBox, bytes } from './ui.ts';
import { loadAudioData } from './audio-load.ts';
import type { AudioData } from './audio-load.ts';
import { jukeboxOf, playBtn, playStatus, playerBar, PagedList, syncPlayers } from './audio-ui.ts';
import type { JbSource } from './audio-player.ts';
import { loadStyleAssets, pickDls, pickMidiDls, probeMidi, probeSegment } from './audio-music.ts';
import { failText } from './audio-player.ts';
import type { Probe } from './audio-music.ts';
import { ORPHAN_TRANSCRIPTS } from './audio-orphans.ts';
import { parseAllStr } from './text-data.ts';
import type { StrEntry } from './text-data.ts';
import { textLoadOf } from './text-load.ts';
import type { TextBundle } from './text-load.ts';
import { expandMessage } from '../ui/strings.ts';
import { loadSegment } from '../audio/dm/assets.ts';
import type { LooseSound, MusicFile, SpeechRow } from './audio-data.ts';

const ORPHAN = new Map(ORPHAN_TRANSCRIPTS.map((o) => [o[0].toLowerCase(), o] as const));
const SUBS = ['Losse geluiden', 'Muziek', 'Spraak', 'Geluidstabel'] as const;

/** the corner may ask for the view twice while the first build is still reading files (the tab is chosen again): both asks get the same view */
function build(c: DevCorner): Promise<SectionView> {
  const holder = c.store('geluid-build', () => ({ p: null as Promise<SectionView> | null }));
  holder.p ??= buildOnce(c).catch((e) => { holder.p = null; throw e; });
  return holder.p;
}

function buildOnce(c: DevCorner): Promise<SectionView> {
  return (async () => {
    const jb = jukeboxOf(c);
    const sh = c.sh;
    const data = await loadAudioData(sh);
    const pb = playerBar(jb);
    const panels: HTMLElement[] = [];
    const root = h('div', {});
    const tabs = h('div', { className: 'dc-sub' });
    const body = h('div', {});
    const select = (i: number) => { panels.forEach((p, k) => { p.style.display = k === i ? '' : 'none'; }); [...tabs.children].forEach((t, k) => t.classList.toggle('on', k === i)); syncPlayers(jb, root); };
    const log: string[] = [];

    // ---------------------------------------------------------------------------------------------------------------- (a) loose sounds
    const looseP = (() => {
      const wavs = data.loose.filter((l) => l.ext === 'wav'), mids = data.loose.filter((l) => l.ext !== 'wav');
      const uw = wavs.filter((l) => l.unused).length, um = mids.filter((l) => l.unused).length;
      const groups = [...new Set(data.loose.map((l) => l.group))].sort((a, b) => a.localeCompare(b));
      let q = '', grp = '', only = false;
      const midiVerdict = new Map<string, string>();
      const src = (l: LooseSound): JbSource => {
        if (l.ext === 'wav') return { kind: 'wav', path: l.path, label: l.rel };
        const dls = pickMidiDls(l.rel, data.allRel);
        return { kind: 'midi', path: l.path, dls: dls ? `_data/sounds/${dls}` : '', label: l.rel };
      };
      const list = new PagedList<LooseSound>([
        { head: '', cell: (l) => playBtn(jb, src(l), l.size === 0 ? 'leeg bestand' : '') },
        { head: 'bestand', cell: (l) => h('span', { className: 'dc-mono', textContent: l.rel }) },
        { head: 'grootte', cell: (l) => bytes(l.size), cls: 'num' },
        { head: 'SND-id', cell: (l) => (l.snd.length ? h('span', { className: 'dc-mono', textContent: l.snd.slice(0, 2).map((s) => `${s.name} (${s.id})`).join(', ') + (l.snd.length > 2 ? ` +${l.snd.length - 2}` : '') }) : null) },
        { head: '', cell: (l) => h('span', {}, l.unused ? badge('ongebruikt', 'warn') : l.how === 'bestandsnaam' ? badge('naam in EXE (ander pad)') : null, l.group === 'CUTSCENE' ? badge('cutscene', 'info') : null, playStatus(src(l)), midiVerdict.has(l.path) ? h('span', { className: midiVerdict.get(l.path)!.startsWith('speelbaar') ? 'dc-jb-row' : 'dc-jb-row bad', textContent: midiVerdict.get(l.path) }) : null) },
      ], 120, (l) => (l.unused ? '' : 'dim'));
      const apply = () => {
        const items = data.loose.filter((l) => (!grp || l.group === grp) && (!only || l.unused) && (!q || `${l.rel} ${l.snd.map((s) => s.name).join(' ')}`.toLowerCase().includes(q)));
        list.setItems(items);
        syncPlayers(jb, list.el);
      };
      const gsel = h('select', { className: 'dc-select', onchange: () => { grp = gsel.value; apply(); } }, h('option', { value: '', textContent: 'alle mappen' }), ...groups.map((g) => h('option', { value: g, textContent: g === 'CUTSCENE' ? 'CUTSCENE (cutscene-geluiden)' : g })));
      const onlyBox = h('input', { type: 'checkbox', onchange: () => { only = onlyBox.checked; apply(); } });
      const exp = (n: number, e: number) => badge(`${n} (verwacht ${e})`, n === e ? 'ok' : 'warn');
      const p = h('div', {},
        note('Alle wav- en mid-bestanden onder _data/sounds. "ongebruikt" = geen tekst in de EXE noemt het pad of de bestandsnaam (zelfde methode als unused.md 7.5, nu berekend uit de EXE-tekst). SND-id = de naam in de geluidstabel van het spel.'),
        bar(h('b', { textContent: 'Ongebruikt:' }), ' wav ', exp(uw, 66), ' mid ', exp(um, 2), h('span', { className: 'dc-note', textContent: ` van ${wavs.length} wav + ${mids.length} mid; ${data.exeStrings.toLocaleString('nl-NL')} EXE-teksten gelezen` })),
        bar(filterBox('zoek bestand of SND-naam', (v) => { q = v; apply(); }), gsel, h('label', { className: 'dc-check' }, onlyBox, ' alleen ongebruikt'), btn('alleen CUTSCENE', () => { gsel.value = 'CUTSCENE'; grp = 'CUTSCENE'; apply(); }, 'de cutscene-geluiden')),
        list.el);
      apply();
      // the MIDI files are rendered offline once (4 s each through the port's DLS synth): a file without program changes (BBSGTRDRMS.mid: a raw drum track for a style) stays silent
      void (async () => {
        for (const l of data.loose.filter((x) => x.ext !== 'wav')) {
          const dls = pickMidiDls(l.rel, data.allRel);
          if (!dls) { midiVerdict.set(l.path, 'geen DLS-bank gevonden: niet te spelen'); continue; }
          try {
            const pr = probeMidi(await sh.files.read(l.path), await sh.files.read(`_data/sounds/${dls}`), 4);
            midiVerdict.set(l.path, pr.peak > 0.001 ? `speelbaar (piek ${pr.peak.toFixed(2)})` : 'stil: het bestand heeft geen programmawissels (een kale ritmespoor voor een stijl): de port kiest geen instrument');
          } catch (e) { midiVerdict.set(l.path, `niet speelbaar: ${e instanceof Error ? e.message : String(e)}`); }
        }
        apply();
      })();
      return p;
    })();

    // ---------------------------------------------------------------------------------------------------------------- (b) music
    const probes = new Map<string, string>();
    const musicP = (() => {
      let q = '', only = false;
      const read = (p: string) => sh.files.read(`_data/sounds/DirectMusic/${p}`);
      const dlsFor = (f: MusicFile) => pickDls(f.dir, f.name, data.dlsByDir.get(f.dir.toLowerCase()) ?? [], data.musicTable);
      const tableKey = (f: MusicFile) => data.musicTable.find((t) => t.dir.split('\\').pop()!.toLowerCase() === f.dir.toLowerCase() && t.segment.toLowerCase() === f.name.toLowerCase())?.key ?? '';
      const srcOf = (f: MusicFile): JbSource => {
        const d = dlsFor(f);
        return { kind: f.ext === 'sgt' ? 'sgt' : 'sty', dir: f.dir, file: f.name, dls: d?.dls ?? '', label: `${f.dir}/${f.name}` };
      };
      const verdict = (f: MusicFile): Node | null => {
        if (f.size === 0) return h('span', { className: 'dc-jb-row bad', textContent: 'leeg bestand (0 bytes): niet te spelen' });
        if (!dlsFor(f)) return h('span', { className: 'dc-jb-row bad', textContent: 'geen DLS-bank in de map: niet te spelen' });
        const v = probes.get(f.path);
        return v ? h('span', { className: v.startsWith('speelbaar') ? 'dc-jb-row' : 'dc-jb-row bad', textContent: v }) : null;
      };
      const cols = (kind: 'sgt' | 'sty') => [
        { head: '', cell: (f: MusicFile) => playBtn(jb, srcOf(f), f.size === 0 ? 'leeg bestand' : !dlsFor(f) ? 'geen DLS-bank' : '') },
        { head: kind === 'sgt' ? 'segment' : 'stijl', cell: (f: MusicFile) => h('span', { className: 'dc-mono', textContent: `${f.dir}/${f.name}` }) },
        { head: 'grootte', cell: (f: MusicFile) => bytes(f.size), cls: 'num' },
        { head: 'DLS-bank', cell: (f: MusicFile) => { const d = dlsFor(f); return d ? h('span', { className: 'dc-mono', title: d.how === 'tabel' ? 'uit de muziektabel van het spel' : 'gekozen door de hoek (bij benadering)', textContent: `${d.dls}${d.how === 'tabel' ? '' : ' *'}` }) : null; } },
        { head: '', cell: (f: MusicFile) => h('span', {}, f.unused ? badge('ongebruikt', 'warn') : null, kind === 'sgt' && tableKey(f) ? badge(tableKey(f), 'info') : null, kind === 'sty' ? badge('speelt als synthetisch segment') : null, playStatus(srcOf(f)), verdict(f)) },
      ];
      const sgtList = new PagedList<MusicFile>(cols('sgt'), 60, (f) => (f.unused ? '' : 'dim'));
      const styList = new PagedList<MusicFile>(cols('sty'), 60, (f) => (f.unused ? '' : 'dim'));
      const apply = () => {
        const ok = (f: MusicFile) => (!only || f.unused) && (!q || `${f.dir}/${f.name} ${tableKey(f)}`.toLowerCase().includes(q));
        sgtList.setItems(data.sgt.filter(ok)); styList.setItems(data.sty.filter(ok));
        syncPlayers(jb, sgtList.el); syncPlayers(jb, styList.el);
      };
      const exp = (n: number, e: number) => badge(`${n} (verwacht ${e})`, n === e ? 'ok' : 'warn');
      const status = h('span', { className: 'dc-note', textContent: '' });
      let busy = false;
      const testAll = async (which: 'sgt' | 'sty-unused') => {
        if (busy) return;
        busy = true;
        const set = which === 'sgt' ? data.sgt : data.sty.filter((f) => f.unused);
        let n = 0;
        for (const f of set) {
          status.textContent = `testen ${++n}/${set.length}: ${f.dir}/${f.name}`;
          await new Promise((r) => setTimeout(r, 0));
          let v: string;
          const d = dlsFor(f);
          if (f.size === 0) v = 'leeg bestand';
          else if (!d) v = 'geen DLS-bank';
          else {
            try {
              let pr: Probe;
              if (f.ext === 'sgt') pr = probeSegment(await loadSegment(read, f.dir, f.name, d.dls), 3);
              else pr = probeSegment(await loadStyleAssets(read, f.dir, f.name, d.dls), 3);
              v = pr.peak > 0.001 ? `speelbaar (piek ${pr.peak.toFixed(2)}, ${pr.events} gebeurtenissen${pr.unresolved ? `, ${pr.unresolved} instrument(en) niet in de DLS` : ''})` : `stil: geen geluid in de eerste 3 s (${pr.events} gebeurtenissen)`;
            } catch (e) { v = `niet speelbaar: ${failText(e, f.path)}`; }
          }
          probes.set(f.path, v);
        }
        status.textContent = `klaar: ${set.length} getest (offline door de DirectMusic-motor van de port)`;
        busy = false;
        apply();
      };
      const onlyBox = h('input', { type: 'checkbox', onchange: () => { only = onlyBox.checked; apply(); } });
      const p = h('div', {},
        note('Het spel speelt alleen de 41 sleutels van zijn muziektabel (elk = een segment + DLS-bank). Hier speelt elk segment door de DirectMusic-motor van de port. * = DLS-bank gekozen door deze hoek (het spel heeft voor dit segment geen tabelrij): bij benadering. Een stijl (.sty) speelt het spel nooit los: hij speelt hier als synthetisch segment (port-uitbreiding: eerste band, de stijltempo, C-groot akkoord, de groove-niveaus van de patronen achter elkaar).'),
        bar(h('b', { textContent: 'Ongebruikt:' }), ' segmenten ', exp(data.unusedSgt, 10), ' stijlen ', exp(data.unusedSty, 14),
          filterBox('zoek map of bestand', (v) => { q = v; apply(); }), h('label', { className: 'dc-check' }, onlyBox, ' alleen ongebruikt'),
          btn('alle segmenten testen', () => void testAll('sgt'), 'rendert elk segment 3 s offline en zet het oordeel in de rij'), btn('ongebruikte stijlen testen', () => void testAll('sty-unused'), 'idem voor de 14 ongebruikte stijlen'), status),
        block('Segmenten (.sgt)', sgtList.el), block('Stijlen (.sty)', styList.el));
      apply();
      return p;
    })();

    // ---------------------------------------------------------------------------------------------------------------- (c) speech
    const speechP = (() => {
      const tl = textLoadOf(c);
      let uses = new Map<number, StrEntry[]>();
      let bundle: TextBundle | null = tl.bundle;
      let q = '', mode = 'alles';
      const orphanInfo = (r: SpeechRow) => ORPHAN.get(r.id.toLowerCase());
      const usesOf = (r: SpeechRow) => (r.index >= 0 ? uses.get(r.index) ?? [] : []);
      const analysed = (r: SpeechRow) => (bundle && r.index >= 0 ? bundle.analysis.byVoice.get(r.index) ?? [] : []);
      const textOf = (r: SpeechRow): string => {
        if (r.kind === 'wees') return orphanInfo(r)?.[2] ?? '';
        const u = usesOf(r);
        return u.length ? expandMessage(u[0].text) : '';
      };
      const src = (r: SpeechRow): JbSource => ({ kind: 'speech', id: r.file ? r.file.replace(/\.mp3$/i, '') : r.id, label: `${r.id}${r.index >= 0 ? ` (#${r.index})` : ' (wees)'}` });
      const list = new PagedList<SpeechRow>([
        { head: '', cell: (r) => playBtn(jb, src(r), r.exists ? '' : 'het bestand ontbreekt in het spel') },
        { head: '#', cell: (r) => (r.index >= 0 ? String(r.index) : '-'), cls: 'num' },
        { head: 'id', cell: (r) => h('span', { className: 'dc-mono', textContent: r.id }) },
        { head: 'tekst', cls: 'dc-tx', cell: (r) => {
          const u = usesOf(r);
          const t = textOf(r);
          if (r.kind === 'wees') {
            const o = orphanInfo(r);
            return h('span', {}, h('span', { textContent: o ? o[2] : '(geen transcript)' }), ' ', badge('automatisch getranscribeerd, bij benadering', 'info'), o && /garbled|probable/.test(o[2]) ? badge('(garbled / probable: onzekere transcriptie)', 'warn') : null, o && o[1] ? h('span', { className: 'dc-note', textContent: ` ${o[1]} s` }) : null);
          }
          if (!u.length) return h('span', { className: 'dc-note', textContent: '(geen tekstregel gebruikt dit id)' });
          return h('span', {}, h('span', { textContent: t }), ' ', h('span', { className: 'dc-note', textContent: `[${u[0].tag} in ${u[0].file}${u.length > 1 ? `, +${u.length - 1}` : ''}]` }));
        } },
        { head: '', cell: (r) => {
          const a = analysed(r);
          return h('span', {},
            !r.exists ? badge('bestand ontbreekt', 'red') : null,
            r.kind === 'wees' ? badge('wees: niet in de spraaktabel', 'warn') : null,
            r.kind === 'tabel' && usesOf(r).length === 0 ? badge('stem zonder tekst', 'info') : null,
            r.dupOf >= 0 ? badge(`zelfde id als #${r.dupOf}`) : null,
            a.some((e) => e.unsaid) ? badge('opgenomen, nooit gezegd', 'warn') : null,
            a.length > 0 && a.every((e) => e.ref === null) ? badge('tekst nooit getoond', 'warn') : null,
            a.some((e) => e.shadowed) ? badge('schaduw-duplicaat', 'warn') : null,
            playStatus(src(r)));
        } },
      ], 100);
      const match = (r: SpeechRow): boolean => {
        const a = analysed(r);
        switch (mode) {
          case 'tabel': if (r.kind !== 'tabel') return false; break;
          case 'wees': if (r.kind !== 'wees') return false; break;
          case 'ontbreekt': if (r.exists) return false; break;
          case 'zonder': if (r.kind !== 'tabel' || usesOf(r).length > 0) return false; break;
          case 'ongezegd': if (!a.some((e) => e.unsaid)) return false; break;
          case 'nooit': if (!(a.length > 0 && a.every((e) => e.ref === null))) return false; break;
          default: break;
        }
        return !q || `${r.id} ${textOf(r)}`.toLowerCase().includes(q);
      };
      const apply = () => { list.setItems(data.speech.rows.filter(match)); syncPlayers(jb, list.el); };
      const msel = h('select', { className: 'dc-select', onchange: () => { mode = msel.value; apply(); } },
        ...[['alles', 'alle rijen'], ['tabel', 'spraaktabel (1.732 indices)'], ['wees', 'wezen (mp3 zonder tabelplek)'], ['ontbreekt', 'bestand ontbreekt'], ['zonder', 'stem zonder tekst'], ['ongezegd', 'opgenomen, nooit gezegd (8.7)'], ['nooit', 'tekst nooit getoond']].map(([v, t]) => h('option', { value: v, textContent: t })));
      const tstat = h('span', { className: 'dc-note', textContent: bundle ? '' : tl.progress });
      const distinct = new Set(data.speech.rows.filter((r) => r.kind === 'tabel').map((r) => r.id.toLowerCase())).size;
      const p = h('div', {},
        note('Alle ids van de spraaktabel van het spel (EXE, 0x979098) met de tekst uit de berichtentabellen waar een .str-regel het id gebruikt, de wezen (mp3-bestanden zonder tabelplek: automatisch getranscribeerd met whisper, bij benadering) en de ids waarvan het bestand ontbreekt. Speel = het bestand uit _data/sounds/speech/Data.'),
        bar(badge(`${data.speech.rows.filter((r) => r.kind === 'tabel').length} tabelindices`, 'info'), badge(`${distinct} verschillende ids`), badge(`${data.speech.orphans.length} wezen (verwacht 67)`, data.speech.orphans.length === 67 ? 'ok' : 'warn'), badge(`${data.speech.missing.length} zonder bestand: ${data.speech.missing.join(', ')}`, data.speech.missing.length === 4 ? 'ok' : 'warn')),
        bar(filterBox('zoek id of tekst', (v) => { q = v; apply(); }), msel, tstat),
        list.el);
      // transcripts: the message tables (quick); the flags once the full analysis is there
      void (async () => {
        try {
          const { entries } = parseAllStr(await sh.data.archive('messages'));
          uses = new Map();
          for (const e of entries) if (e.voice >= 0) { const l = uses.get(e.voice); if (l) l.push(e); else uses.set(e.voice, [e]); }
          apply();
        } catch (e) { log.push(String(e)); }
      })();
      const done = () => { bundle = tl.bundle; tstat.textContent = tl.error ? `vlaggen niet beschikbaar: ${tl.error}` : bundle ? 'vlaggen berekend' : tl.progress; if (bundle) apply(); };
      tl.listeners.push(done);
      if (tl.done) done();
      return p;
    })();

    // ---------------------------------------------------------------------------------------------------------------- (d) sound table
    const tableP = (() => {
      let q = '';
      const row = (r: AudioData['table'][number]): JbSource => ({ kind: 'wav', path: `_data/sounds/${r.rel}`, label: `${r.name || `#${r.id}`}` });
      const list = new PagedList<AudioData['table'][number]>([
        { head: '', cell: (r) => playBtn(jb, row(r), r.exists ? '' : r.undefinedPath ? 'geen bestand in de tabel (UNDEFINED / PSX)' : 'bestand ontbreekt') },
        { head: 'id', cell: (r) => String(r.id), cls: 'num' },
        { head: 'naam', cell: (r) => h('span', { className: 'dc-mono', textContent: r.name || '(geen naam)' }) },
        { head: 'bestand', cell: (r) => h('span', { className: 'dc-mono', textContent: r.undefinedPath ? r.path : r.rel }) },
        { head: 'vol / loop / Hz', cell: (r) => `${r.volume} / ${r.loop} / ${r.rate}`, cls: 'num' },
        { head: '', cell: (r) => h('span', {}, r.undefinedPath ? badge('geen bestand') : !r.exists ? badge('bestand ontbreekt', 'red') : null, /^CS/.test(r.name) ? badge('cutscene-geluid', 'info') : null, playStatus(row(r))) },
      ], 120);
      const apply = () => { list.setItems(data.table.filter((r) => !q || `${r.name} ${r.rel}`.toLowerCase().includes(q))); syncPlayers(jb, list.el); };
      const named = data.table.filter((r) => r.name).length;
      const p = h('div', {},
        note('De geluidstabel van het spel (EXE 0x969f80, 902 rijen). De SND_*-namen staan niet in die tabel maar worden door de dode initialiser FUN_00877550 geregistreerd (id + naam, nooit opgevraagd): ze zijn hier uit de code van die functie gelezen (het patroon push id; push naam; call FUN_0045bff4).'),
        bar(badge(`${named} namen gelezen (verwacht 902)`, named === 902 ? 'ok' : 'warn'), filterBox('zoek naam of bestand', (v) => { q = v; apply(); })),
        list.el);
      apply();
      return p;
    })();

    panels.push(looseP, musicP, speechP, tableP);
    SUBS.forEach((t, i) => tabs.append(btn(t, () => select(i), '', i === 0 ? 'on' : '')));
    body.append(...panels);
    root.append(pb.el, tabs, body);
    select(0);
    return {
      el: root,
      show() { select([...tabs.children].findIndex((t) => t.classList.contains('on')) || 0); pb.update(); },
      hide() { jb.stop(); },
      refresh() { pb.update(); },
    };
  })();
}

export const section: SectionDef = {
  id: 'geluid', title: 'Geluid en muziek',
  blurb: 'Jukebox over alle losse geluiden, muziek (DirectMusic) en spraak, met de ongebruikte bestanden gemarkeerd',
  build,
};
