// Ontwikkelaarshoek, section 8 (geluid en muziek): the run-time analysis of src/devcorner/audio-data.ts against the numbers of docs/re/unused.md 7.5-7.7 (66 wavs + 2 .mid unused,
// 10 .sgt + 14 .sty, 67 orphan clips, 4 table ids without a file, 902 SND_ names), the DLS choice of audio-music.ts for every segment, offline renders of every segment / the 14 unused
// styles / the MIDI files through the port's DirectMusic engine, and the jukebox (audio-player.ts) against a fake AudioContext.
import fs from 'node:fs';
import path from 'node:path';
import { loadExe } from '../lib/engine-load.mjs';
import { readExeMusicTable, readExeSoundTable, readExeSpeechTable } from '../../src/formats/sound.ts';
import { exeNames, exeStrings, looseSounds, musicFiles, soundFiles, soundTableRows, speechRows } from '../../src/devcorner/audio-data.ts';
import { pickDls, pickMidiDls, probeMidi, probeSegment, loadStyleAssets } from '../../src/devcorner/audio-music.ts';
import { ORPHAN_TRANSCRIPTS } from '../../src/devcorner/audio-orphans.ts';
import { Jukebox, sourceKey } from '../../src/devcorner/audio-player.ts';
import { loadSegment } from '../../src/audio/dm/assets.ts';

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/${e.name}`, out); else out.push(`${rel}/${e.name}`);
  }
  return out;
}

/** a fake AudioContext: enough for Jukebox and the DirectMusic engine's SynthStream */
function fakeCtx() {
  const node = () => ({ connect() {}, disconnect() {}, gain: { value: 1 } });
  const sources = [];
  const ctx = {
    currentTime: 0, sampleRate: 22050, state: 'running', sources,
    createGain: node,
    createBuffer: (ch, n) => ({ copyToChannel() {}, duration: n / 22050 }),
    createBufferSource() { const s = { ...node(), buffer: null, onended: null, started: false, stopped: false, start() { s.started = true; }, stop() { s.stopped = true; } }; sources.push(s); return s; },
    decodeAudioData: async (ab) => { if (ab.byteLength < 100) throw new Error('bad data'); return { duration: 1.5, length: 33075 }; },
  };
  return ctx;
}

export default {
  name: 'devcorner-audio',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const root = ctx.dataRoot;
    const exe = new Uint8Array(fs.readFileSync(path.join(root, 'LEGO eiland 2.exe')));
    const listed = walk(path.join(root, '_data/sounds'), '_data/sounds', []);
    const byLower = new Map(listed.map((p) => [p.toLowerCase(), p]));
    const files = {
      read: async (p) => { const real = byLower.get(p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()); if (!real) throw new Error(`no ${p}`); return new Uint8Array(fs.readFileSync(path.join(root, real))); },
      has: (p) => byLower.has(p.replace(/\\/g, '/').toLowerCase()),
    };
    const sizeOf = (p) => fs.statSync(path.join(root, p)).size;

    // ---------------------------------------------------------------------------------------------- unused loose sounds (7.5)
    const strings = exeStrings(exe);
    ok(strings.length === 46954, `EXE strings ${strings.length} != 46954 (unused.md 7.5)`);
    const n = exeNames(strings);
    const sf = soundFiles(listed, sizeOf);
    const table = readExeSoundTable(exe);
    const loose = looseSounds(sf, n, table);
    const uw = loose.filter((l) => l.unused && l.ext === 'wav'), um = loose.filter((l) => l.unused && l.ext !== 'wav');
    ok(uw.length === 66, `unused wavs ${uw.length} != 66`);
    ok(um.length === 2 && um.some((l) => /BBSGTRDRMS\.mid$/i.test(l.rel)) && um.some((l) => /Birds'n'Bees\.MID$/i.test(l.rel)), `unused mid: ${um.map((l) => l.rel).join(', ')}`);
    for (const need of ['z01BPK/pep_rap.wav', 'z01BPK/Railslide.wav', 'z07CSI/sword1.wav', 'z22BIP/turbo.wav', 'z09JST/powermeter.wav', 'z28HAT/winch1.wav', 'CUTSCENE/rip1.wav', 'z40OGL/space_cow.wav'])
      ok(uw.some((l) => l.rel.toLowerCase() === need.toLowerCase()), `${need} should be unused`);
    ok(!uw.some((l) => /silence/i.test(l.rel)), 'Silence.wav is used (named)');
    const cut = loose.filter((l) => l.group === 'CUTSCENE');
    notes.push(`loose: ${loose.length} wav/mid, ${uw.length} wav + ${um.length} mid unused (research 66 + 2); CUTSCENE ${cut.length} files, ${cut.filter((l) => l.unused).length} unused (research: Deconstruct, House, best_deconstruct_32, go, mystical, rip1)`);
    ok(cut.filter((l) => l.unused).length === 6, `CUTSCENE unused ${cut.filter((l) => l.unused).length} != 6`);
    ok(loose.some((l) => l.snd.some((s) => s.name === 'SND_FLOWER_GROWING')), 'SND_FLOWER_GROWING labels a file');

    // ---------------------------------------------------------------------------------------------- sound table names (FUN_00877550)
    ok(table.length === 902, `sound table ${table.length}`);
    const named = table.filter((e) => e.name);
    ok(named.length === 902 && new Set(named.map((e) => e.name)).size === 902, `SND names ${named.length} / distinct ${new Set(named.map((e) => e.name)).size} != 902`);
    ok(table[0].name === 'SND_FLOWER_GROWING' && table[1].name === 'SND_PEPP_ACCDECC', 'SND ids 0 / 1');
    // (audio.md: SND_* 0..821, CSSND_* 822..901; the real names have two typos in the first range and 29 later SND_ rows among the CSSND_ ones: the registry is the truth)
    ok(table[16].name === 'xxSND_TREX_ROAR' && table[703].name === 'SDN_THROW_ON_MOVE' && table[822].name === 'CSSND_BRICK_LAND4' && table[901].name === 'CSSND_SHUTTLE', 'typo names of the registry (xxSND_TREX_ROAR, SDN_THROW_ON_MOVE) and the CSSND_ range ends');
    notes.push(`SND names: ${table.filter((e) => /^CS/.test(e.name)).length} CSSND_/CS_ names, ${table.filter((e, i) => i >= 822 && /^SND_/.test(e.name)).length} SND_ names above id 821 (the cutscene range holds more than CSSND_ rows)`);
    const strSet = new Set(strings);
    ok(table.every((e) => strSet.has(e.name)), 'every SND name is a string of the EXE');
    const trows = soundTableRows(table, (p) => files.has(p));
    notes.push(`sound table: 902 names read from FUN_00877550, ${trows.filter((r) => r.undefinedPath).length} rows without a file (UNDEFINED / PSX), ${trows.filter((r) => !r.undefinedPath && !r.exists).length} rows whose file is missing`);

    // ---------------------------------------------------------------------------------------------- music (7.6)
    const mt = readExeMusicTable(exe);
    ok(mt.length === 41, 'music table 41');
    const music = await musicFiles(sf, n, (p) => files.read(p));
    ok(music.sgt.length === 50 && music.unusedSgt === 10, `sgt ${music.sgt.length} / unused ${music.unusedSgt} != 50 / 10`);
    ok(music.sty.length === 229 && music.unusedSty === 14, `sty ${music.sty.length} / unused ${music.unusedSty} != 229 / 14`);
    const us = music.sgt.filter((f) => f.unused).map((f) => f.rel.replace(/^DirectMusic\//, '').toLowerCase());
    for (const x of ['flying/control mute no str.sgt', 'z140sd/adventurers.sgt', 'ad1/advvartn.sgt', 'ad1/adventurertheme.sgt', 'dance/125bpm temmpo.sgt', 'dance/125bpm tempo.sgt', 'z01bpk/skate park vartn.sgt', 'z15ssh/adv.race.sgt', 'z41map/bdanube.sgt'])
      ok(us.includes(x), `unused sgt ${x}`);
    ok(us.includes('z01bpk/skate park.sgt'), 'Skate Park.sgt: the EXE asks for "Skate Park Theme.sgt" only (the 10th unused segment)');
    const uy = music.sty.filter((f) => f.unused).map((f) => f.rel.replace(/^DirectMusic\//, ''));
    ok(uy.filter((x) => x.startsWith('Flying/Flybar')).length === 8 && uy.includes('ad2/Adv1.sty') && uy.includes('z02LGI/MidiDrumsMain.sty') && uy.includes('z05WAB/Wak3pt1.sty') && uy.includes('z05WAB/Wak3pt2.sty') && uy.includes('z07CSI/DrumsMain.sty') && uy.includes('z07CSI/MainInsts.sty'), `unused sty ${uy.join(', ')}`);

    // the DLS bank: every segment finds one, every table key keeps its own row
    const dlsByDir = new Map();
    for (const f of sf) if (f.group === 'DirectMusic' && f.ext === 'dls') { const k = f.sub.toLowerCase(); dlsByDir.set(k, [...(dlsByDir.get(k) ?? []), f.name]); }
    let tableHits = 0;
    for (const f of music.sgt) {
      const p = pickDls(f.dir, f.name, dlsByDir.get(f.dir.toLowerCase()) ?? [], mt);
      ok(!!p, `${f.rel}: no DLS bank`);
      if (p?.how === 'tabel') tableHits++;
    }
    const inTable = music.sgt.filter((f) => mt.some((t) => t.dir.split('\\').pop().toLowerCase() === f.dir.toLowerCase() && t.segment.toLowerCase() === f.name.toLowerCase()));
    ok(tableHits === inTable.length, `table DLS rows used ${tableHits} / segments in the table ${inTable.length}`);
    notes.push(`music: 50 sgt (${music.unusedSgt} unused), 229 sty (${music.unusedSty} unused); ${tableHits} segments have a music-table row, the other ${music.sgt.length - tableHits} get a chosen DLS bank (not original)`);

    // offline renders through the DirectMusic engine
    const readDm = (p) => files.read(`_data/sounds/DirectMusic/${p}`);
    const silent = [], broken = [], unresolved = [];
    for (const f of music.sgt) {
      if (f.size === 0) { broken.push(`${f.dir}/${f.name} (0 bytes)`); continue; }
      const d = pickDls(f.dir, f.name, dlsByDir.get(f.dir.toLowerCase()) ?? [], mt);
      try {
        const pr = probeSegment(await loadSegment(readDm, f.dir, f.name, d.dls), 3);
        if (pr.peak <= 0.001) silent.push(`${f.dir}/${f.name}`);
        if (pr.unresolved) unresolved.push(`${f.dir}/${f.name}:${pr.unresolved}`);
      } catch (e) { broken.push(`${f.dir}/${f.name}: ${e.message}`); }
    }
    ok(broken.length === 0, `segments that fail to load: ${broken.join('; ')}`);
    ok(silent.length <= 4, `silent segments ${silent.length}: ${silent.join(', ')}`);
    notes.push(`all ${music.sgt.length} segments loaded and rendered 3 s; silent: ${silent.join(', ') || 'none'}; segments with instruments missing in the DLS: ${unresolved.length}`);
    const stySilent = [];
    for (const f of music.sty.filter((x) => x.unused)) {
      const d = pickDls(f.dir, f.name, dlsByDir.get(f.dir.toLowerCase()) ?? [], mt);
      try {
        const pr = probeSegment(await loadStyleAssets(readDm, f.dir, f.name, d.dls), 3);
        ok(pr.events > 0, `${f.dir}/${f.name}: the synthetic segment produced no events`);
        if (pr.peak <= 0.001) stySilent.push(`${f.dir}/${f.name} (${pr.unresolved} instruments missing)`);
      } catch (e) { ok(false, `${f.dir}/${f.name}: ${e.message}`); }
    }
    ok(stySilent.length < 14, 'at least one unused style is audible');
    notes.push(`14 unused styles through the synthetic segment: audible ${14 - stySilent.length}, silent ${stySilent.length}: ${stySilent.join('; ')}`);
    // MIDI
    for (const m of um) {
      const rel = m.rel;
      const dls = pickMidiDls(rel, sf.map((f) => f.rel));
      ok(!!dls, `${rel}: no DLS bank`);
      if (!dls) continue;
      const pr = probeMidi(await files.read(m.path), await files.read(`_data/sounds/${dls}`), 4);
      notes.push(`${rel} + ${dls}: peak ${pr.peak.toFixed(3)}${pr.peak > 0.001 ? '' : ' (silent: no program changes in the file)'}`);
      if (/Birds'n'Bees/i.test(rel)) ok(pr.peak > 0.001, 'Birds\'n\'Bees.MID should be audible');
    }

    // ---------------------------------------------------------------------------------------------- speech (7.7)
    const speech = readExeSpeechTable(exe);
    const mp3 = sf.filter((f) => f.group === 'speech' && f.ext === 'mp3').map((f) => f.name);
    const sp = speechRows(speech, mp3);
    const tabRows = sp.rows.filter((r) => r.kind === 'tabel');
    ok(tabRows.length === 1732, `speech table ${tabRows.length}`);
    const distinct = new Set(speech.map((s) => s.toLowerCase())).size;
    ok(distinct === 1635, `distinct ids ${distinct}`);
    ok(sp.orphans.length === 67, `orphans ${sp.orphans.length} != 67`);
    ok(sp.missing.length === 4 && ['CASGJO11', 'CARQAA03', 'CARQAA07', 'CARQBB06'].every((x) => sp.missing.includes(x)), `missing ${sp.missing.join(',')}`);
    ok(sp.orphans.includes('LEDTHT03') && !speech.includes('LEDTHT03') && speech.includes('LEDTHT01'), 'LEDTHT03 is an orphan, LEDTHT01 is in the table');
    ok(speech[105] === 'LECSPP02', 'speech[105] = LECSPP02 (audio.md 6.3)');
    // the transcript table of unused.md 7.7 versus the computed orphans
    const tr = new Set(ORPHAN_TRANSCRIPTS.map((o) => o[0].toLowerCase()));
    const orphanSet = new Set(sp.orphans.map((o) => o.toLowerCase()));
    ok(ORPHAN_TRANSCRIPTS.length === 67, `transcripts ${ORPHAN_TRANSCRIPTS.length} != 67`);
    const noTr = [...orphanSet].filter((x) => !tr.has(x)), noFile = [...tr].filter((x) => !orphanSet.has(x));
    ok(noTr.length === 0 && noFile.length === 0, `orphans without transcript: ${noTr.join(',')}; transcripts without orphan file: ${noFile.join(',')}`);
    notes.push(`speech: ${tabRows.length} table indices = ${distinct} distinct ids (research: "1,730 ids" = the indices the .str lines use, see devcorner-text), ${sp.orphans.length} orphans, ${sp.missing.length} without file`);

    // ---------------------------------------------------------------------------------------------- jukebox (fake AudioContext)
    const actx = fakeCtx();
    const jb = new Jukebox(actx, {}, files);
    const wav = { kind: 'wav', path: '_data/sounds/z01BPK/pep_rap.wav', label: 'pep_rap' };
    await jb.play(wav);
    ok(jb.state.phase === 'playing' && jb.state.kind === 'wav' && jb.state.duration === 1.5 && jb.isPlaying(wav), `wav: ${JSON.stringify(jb.state)}`);
    actx.sources.at(-1).onended();
    ok(jb.state.phase === 'ended', 'wav ended -> phase ended');
    await jb.play({ kind: 'speech', id: 'LEDTHT03', label: 'LEDTHT03' });
    ok(jb.state.phase === 'playing' && jb.state.kind === 'speech', `speech orphan: ${JSON.stringify(jb.state)}`);
    jb.stop();
    ok(jb.state.phase === 'idle' && actx.sources.at(-1).stopped, 'stop');
    await jb.play({ kind: 'wav', path: '_data/sounds/zz/none.wav', label: 'none' });
    ok(jb.state.phase === 'error' && /ontbreekt/.test(jb.state.error), `missing file: ${JSON.stringify(jb.state)}`);
    await jb.play({ kind: 'wav', path: '_data/sounds/CUTSCENE/go.wav', label: 'go.wav' });
    ok(jb.state.phase === 'error' || jb.state.phase === 'playing', 'go.wav (the one file that is not a RIFF) either plays or reports');
    const seg = music.sgt.find((f) => f.name === 'Lego Town Main.sgt');
    await jb.play({ kind: 'sgt', dir: seg.dir, file: seg.name, dls: 'LI2 Town Custom.dls', label: 'z02LGI/Lego Town Main.sgt' });
    ok(jb.state.phase === 'playing' && jb.state.kind === 'sgt' && jb.state.loops, `sgt: ${JSON.stringify(jb.state)}`);
    jb.stop();
    ok(jb.state.phase === 'idle', 'sgt stop');
    await jb.play({ kind: 'sty', dir: 'z07CSI', file: 'MainInsts.sty', dls: 'Medieval.dls', label: 'z07CSI/MainInsts.sty' });
    ok(jb.state.phase === 'playing' && jb.state.kind === 'sty', `sty: ${JSON.stringify(jb.state)}`);
    jb.stop();
    await jb.play({ kind: 'sgt', dir: 'dance', file: '125bpm temmpo.sgt', dls: 'BBotdance.dls', label: 'empty sgt' });
    notes.push(`125bpm temmpo.sgt through the jukebox: ${jb.state.phase}${jb.state.error ? ` (${jb.state.error})` : ''}`);
    jb.stop();
    await jb.play({ kind: 'midi', path: `_data/sounds/z02LGI/MidiAmbient/Birds'n'Bees.MID`, dls: '_data/sounds/z02LGI/MidiAmbient/DLS Birds.dls', label: 'mid' });
    ok(jb.state.phase === 'playing' && jb.state.kind === 'midi', `midi: ${JSON.stringify(jb.state)}`);
    jb.stop();
    ok(sourceKey(wav) === 'wav:_data/sounds/z01bpk/pep_rap.wav', 'sourceKey');
    return { checked, failures, notes };
  },
};
