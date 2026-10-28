import fs from 'node:fs';
import path from 'node:path';
import { readExeSoundTable, readExeMusicTable, readExeSpeechTable, readExeAmbienceTable, parseWav, countMp3Frames, parseFinderDat, parsePeakFile, parseMidiInfo, summarizeDirectMusic, parsePeInfo, WAVE_FORMAT_PCM, WAVE_FORMAT_MPEGLAYER3 } from '../../src/formats/sound.ts';

// Sound & music: every file under _data/sounds plus the redist/ Miles Sound System modules, cross-checked with
// the .str string tables, cutscene SayText ids and the DirectMusic segment references.
function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}
const u8 = (p) => new Uint8Array(fs.readFileSync(p));

export default {
  name: 'sound',
  run(ctx) {
    const failures = []; const notes = [];
    let checked = 0;
    const root = ctx.soundsDir;
    const rel = (p) => path.relative(root, p).split(path.sep).join('/');
    const counts = {};
    const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
    const files = [...walk(root)];
    const lower = new Set(files.map((p) => rel(p).toLowerCase()));
    const byLower = new Map(files.map((p) => [rel(p).toLowerCase(), p]));

    // ---- PCM wavs
    const rates = {}; let wavDur = 0, loops = 0, emptyWav = 0, oddPad = 0;
    for (const p of files.filter((f) => /\.wav$/i.test(f))) {
      checked++;
      const b = u8(p);
      if (b.length === 0) { emptyWav++; if (rel(p) !== 'CUTSCENE/go.wav') failures.push(`${rel(p)}: unexpected empty wav`); continue; } // shipped 0-byte file, the EXE does reference cutscene\go? (see doc)
      try {
        const w = parseWav(b);
        if (w.formatTag !== WAVE_FORMAT_PCM) failures.push(`${rel(p)}: formatTag ${w.formatTag}`);
        if (w.fmtSize !== 16) failures.push(`${rel(p)}: fmt size ${w.fmtSize}`);
        if (w.frames <= 0) failures.push(`${rel(p)}: no frames`);
        if (![8, 16].includes(w.bitsPerSample)) failures.push(`${rel(p)}: ${w.bitsPerSample} bits`);
        if (![1, 2].includes(w.channels)) failures.push(`${rel(p)}: ${w.channels} channels`);
        if (w.sampleRate < 4000 || w.sampleRate > 48000) failures.push(`${rel(p)}: rate ${w.sampleRate}`);
        if (w.dataOffset + w.dataSize > b.length) failures.push(`${rel(p)}: data past EOF`);
        if (w.problems.length) {
          // the single known quirk: RIFF size one byte larger than the file (missing pad byte)
          if (w.problems.length === 1 && /available/.test(w.problems[0])) oddPad++; else failures.push(`${rel(p)}: ${w.problems.join('; ')}`);
        }
        for (const l of w.loops) { loops++; if ((l.end >= w.frames && rel(p) !== 'z18MMP/Symbol Move.wav') || l.start > l.end) failures.push(`${rel(p)}: loop ${l.start}-${l.end} outside ${w.frames} frames`); }
        rates[`${w.sampleRate}/${w.channels}ch/${w.bitsPerSample}b`] = (rates[`${w.sampleRate}/${w.channels}ch/${w.bitsPerSample}b`] || 0) + 1;
        wavDur += w.duration;
      } catch (e) { failures.push(`${rel(p)}: ${e.message}`); }
    }
    notes.push(`wav: ${checked} files (${emptyWav} empty), total ${(wavDur / 60).toFixed(1)} min, sampler loops ${loops}, files with a truncated last chunk (odd size) ${oddPad}; formats ${JSON.stringify(rates)}`);

    // ---- speech mp3 (MPEG layer 3 in a WAVE container)
    const speech = files.filter((f) => /\.mp3$/i.test(f));
    const speechIds = new Set();
    let mp3dur = 0, partial = 0;
    for (const p of speech) {
      checked++;
      const b = u8(p);
      try {
        const w = parseWav(b);
        if (w.formatTag !== WAVE_FORMAT_MPEGLAYER3) failures.push(`${rel(p)}: formatTag ${w.formatTag}`);
        const m = w.mp3;
        if (w.channels !== 1 || w.sampleRate !== 44100 || w.avgBytesPerSec !== 6000 || w.blockAlign !== 1 || w.fmtSize !== 30 || m.id !== 1 || m.flags !== 2 || m.blockSize !== 156 || m.framesPerBlock !== 1 || m.codecDelay !== 1393) failures.push(`${rel(p)}: unexpected MP3 fmt`);
        if (w.problems.length) failures.push(`${rel(p)}: ${w.problems.join('; ')}`);
        const f = countMp3Frames(b, w);
        // 48 kbps mono 44.1 kHz = 156-byte frames; the data ends with one truncated frame
        if (f.frames === 0 || f.leftover >= 156 || f.frames * 156 + f.leftover !== w.dataSize) failures.push(`${rel(p)}: frame walk ${f.frames} frames + ${f.leftover}`);
        if (f.leftover) partial++;
        if (Math.abs(w.frames - f.frames * 1152) > 1152 * 2.5) failures.push(`${rel(p)}: fact ${w.frames} vs ${f.frames} frames`);
        if (w.chunkOrder.join() !== 'fmt ,fact,data,LIST:INFO') failures.push(`${rel(p)}: chunk order ${w.chunkOrder}`);
        mp3dur += w.duration;
      } catch (e) { failures.push(`${rel(p)}: ${e.message}`); }
      const base = path.basename(p, path.extname(p)).toUpperCase();
      if (rel(p) !== `speech/Data/${path.basename(p)}`) failures.push(`${rel(p)}: speech file outside speech/Data`);
      speechIds.add(base);
    }
    notes.push(`speech: ${speech.length} mp3-in-wav files, ${(mp3dur / 60).toFixed(1)} min, all 44.1 kHz mono 48 kbps, ${partial} with a truncated final frame`);

    // ---- speech ids vs .str tables vs cutscene SayText
    const messages = ctx.archives.find((a) => a.name === 'messages');
    const strIds = new Map();
    if (!messages) failures.push('messages archive not found');
    else {
      for (const e of messages.entries) {
        if (!/\.str$/i.test(e.path)) continue;
        for (const line of Buffer.from(messages.read(e)).toString('latin1').split(/\r?\n/)) {
          if (!line.trim()) continue;
          const m = /^([A-Za-z0-9_]+):(-?\d+)\s?(.*)$/.exec(line);
          if (!m) { failures.push(`${e.path}: unparsable .str line ${JSON.stringify(line)}`); continue; }
          strIds.set(m[1].toUpperCase(), e.path.split('/')[0]);
        }
      }
    }
    const say = new Set(); const sayPsx = new Set();
    for (const { entry, data } of ctx.entries(/cutscene\/[^/]*\.txt$/i)) {
      const psx = /psx\.txt$/i.test(entry.path);
      for (const line of Buffer.from(data).toString('latin1').split(/\r?\n/)) {
        if (/^\s*\/\//.test(line)) continue;
        const m = /\sSayText\s+(\S+)/i.exec(line);
        if (m) (psx ? sayPsx : say).add(m[1].toUpperCase());
      }
    }
    let sayMissing = 0; for (const id of say) if (!speechIds.has(id)) { sayMissing++; failures.push(`cutscene SayText ${id}: no speech/Data/${id}.mp3`); }
    let strWithMp3 = 0; for (const id of strIds.keys()) if (speechIds.has(id)) strWithMp3++;
    let mp3InStrOrSay = 0; for (const id of speechIds) if (strIds.has(id) || say.has(id)) mp3InStrOrSay++;
    // ids hard-coded in the EXE (NUL-terminated 8-char strings in .data)
    const exe = fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe')).toString('latin1');
    const exeIds = new Set(); for (const m of exe.matchAll(/(?<![A-Za-z0-9_])[A-Za-z]{6}\d{2}(?![A-Za-z0-9])/g)) exeIds.add(m[0].toUpperCase());
    let inExe = 0; for (const id of speechIds) if (exeIds.has(id)) inExe++;
    notes.push(`speech ids: ${speechIds.size} files; ${say.size} PC cutscene SayText ids (all resolve, ${sayMissing} missing), ${sayPsx.size} PSX-script ids; ${strIds.size} .str ids, of which ${strWithMp3} have an mp3; mp3s named by a .str line or cutscene ${mp3InStrOrSay}; mp3s whose id is also a string literal in the EXE ${inExe}`);
    if (speechIds.size - inExe - (mp3InStrOrSay) > speechIds.size) failures.push('speech id coverage impossible');

    // ---- FINDER.DAT
    let finder = 0, finderEntries = 0;
    for (const p of files.filter((f) => /FINDER\.DAT$/i.test(f))) {
      checked++; finder++;
      try {
        const es = parseFinderDat(u8(p));
        const dir = path.dirname(p);
        const wavs = fs.readdirSync(dir).filter((n) => /\.wav$/i.test(n));
        if (es.length !== wavs.length) failures.push(`${rel(p)}: ${es.length} entries vs ${wavs.length} wavs`);
        for (const e of es) {
          finderEntries++;
          if (!wavs.some((n) => n.toLowerCase() === e.name.toLowerCase())) failures.push(`${rel(p)}: entry ${e.name} has no file`);
          if (e.fileType !== '.WAV' || e.creator !== 'Sd2a') failures.push(`${rel(p)}: type/creator ${e.fileType}/${e.creator}`);
          { const dot = e.name.lastIndexOf('.'); const want = e.name.slice(0, dot).toUpperCase().padEnd(8, ' ') + e.name.slice(dot + 1).toUpperCase(); if (e.shortName !== want) failures.push(`${rel(p)}: short name ${JSON.stringify(e.shortName)} vs ${e.name}`); }
        }
      } catch (e) { failures.push(`${rel(p)}: ${e.message}`); }
    }
    notes.push(`FINDER.DAT: ${finder} files, ${finderEntries} entries (Mac desktop info for the footstep wavs; not read by the game)`);

    // ---- .pk
    let pk = 0;
    for (const p of files.filter((f) => /\.pk$/i.test(f))) {
      checked++; pk++;
      try { const k = parsePeakFile(u8(p)); if (!lower.has(rel(p).toLowerCase().replace(/\.pk$/, '.wav'))) failures.push(`${rel(p)}: no companion wav`); if (k.sampleRate !== 8000) failures.push(`${rel(p)}: word3 ${k.sampleRate}`); } catch (e) { failures.push(`${rel(p)}: ${e.message}`); }
    }
    notes.push(`.pk peak files: ${pk}`);

    // ---- MIDI
    const mids = files.filter((f) => /\.mid$/i.test(f));
    const midDiv = {};
    for (const p of mids) { checked++; try { const m = parseMidiInfo(u8(p)); if (m.tracks !== m.trackChunks) failures.push(`${rel(p)}: ${m.tracks} tracks declared, ${m.trackChunks} found`); midDiv[m.division] = (midDiv[m.division] || 0) + 1; } catch (e) { failures.push(`${rel(p)}: ${e.message}`); } }
    notes.push(`.mid: ${mids.length} files, divisions ${JSON.stringify(midDiv)}`);

    // ---- DirectMusic RIFF trees
    const dm = files.filter((f) => /\.(sty|sgt|dls)$/i.test(f));
    const forms = {}; const dmCounts = {}; let unresolved = 0; let refs = 0;
    const dmNames = [];
    for (const p of dm) {
      checked++;
      let s;
      try { s = summarizeDirectMusic(u8(p)); } catch (e) { failures.push(`${rel(p)}: ${e.message}`); continue; }
      if (s.problems.length) failures.push(`${rel(p)}: ${s.problems.join('; ')}`);
      const ext = path.extname(p).toLowerCase();
      const want = { '.sty': 'DMST', '.sgt': 'DMSG', '.dls': 'DLS ' }[ext];
      if (s.form !== want) failures.push(`${rel(p)}: form ${s.form}`);
      forms[ext] = (forms[ext] || 0) + 1;
      for (const [k, v] of Object.entries(s.counts)) { const d = (dmCounts[ext] ??= {}); d[k] = (d[k] || 0) + v; }
      if (ext === '.sgt') {
        const dir = path.dirname(p);
        const have = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
        for (const r of s.references) {
          refs++;
          if (!have.has(r.toLowerCase())) {
            // 5 shipped segments (ad1/*, z41MAP/BDanube) still point at the authoring name "DLS Collection1.dls"
            if (r === 'DLS Collection1.dls') unresolved++; else failures.push(`${rel(p)}: reference "${r}" not found`);
          }
        }
        dmNames.push(s.names[0] ?? '');
      }
      if (ext === '.dls' && !(s.counts['LIST:wvpl'] === 1 && s.counts['ptbl'] === 1 && s.counts['colh'] === 1)) failures.push(`${rel(p)}: DLS without colh/ptbl/wvpl`);
    }
    notes.push(`DirectMusic: ${JSON.stringify(forms)}; segment->style/dls references ${refs} (${unresolved} to the stale authoring name "DLS Collection1.dls"); chunk totals ${JSON.stringify(dmCounts)}`);

    // ---- redist / Miles Sound System
    const redist = path.join(ctx.dataRoot, 'redist', 'win32');
    const pes = {}; let peCount = 0;
    for (const n of fs.readdirSync(redist)) {
      checked++; peCount++;
      try {
        const pe = parsePeInfo(u8(path.join(redist, n)));
        const ext = path.extname(n).toLowerCase();
        if (!pe.isDll) failures.push(`${n}: not a DLL`);
        if (pe.machine !== 0x14c) failures.push(`${n}: machine ${pe.machine}`);
        if (!pe.imports.some((i) => /^mss32\.dll$/i.test(i)) && ext !== '.dll') failures.push(`${n}: does not import mss32.dll (${pe.imports})`);
        pes[ext] = (pes[ext] || 0) + 1;
      } catch (e) { failures.push(`${n}: ${e.message}`); }
    }
    for (const n of ['mss32.dll']) { checked++; try { parsePeInfo(u8(path.join(ctx.dataRoot, n))); } catch (e) { failures.push(`${n}: ${e.message}`); } }
    notes.push(`redist/win32 (Miles Sound System 6.0c plug-ins): ${peCount} PE files ${JSON.stringify(pes)}`);

    // ---- text files
    for (const n of ['LeesMij.txt', 'Fotos/Fotos.txt', '_data/GameSetup.txt', '_data/sounds/speech/Dutch.txt']) {
      checked++;
      if (!fs.existsSync(path.join(ctx.dataRoot, n))) failures.push(`${n}: missing`);
    }

    // ---- sound files named by the EXE
    const exeRefs = new Set();
    for (const m of exe.matchAll(/_data[\\/]+sounds[\\/][ -~]*/gi)) exeRefs.add(m[0].replace(/\\+/g, '/').replace(/^_data\/sounds\//i, '').toLowerCase());
    const refMiss = [];
    for (const r of exeRefs) {
      if (!/\.(wav|mid|dls)$/.test(r)) continue;
      if (lower.has(r) || lower.has(r.replace('ambience midi', 'ambience_midi'))) continue;
      refMiss.push(r);
    }
    // referenced on the PC build but not shipped: bonk.wav, snake_amb2.wav, 9 IsleStunts samples (PSX-era folder not on the disc)
    const expectMissing = new Set(['z08bkd/bonk.wav', 'z15ssh/snake_amb2.wav']);
    const unexpected = refMiss.filter((r) => !expectMissing.has(r) && !r.startsWith('islestunts/'));
    for (const r of unexpected) failures.push(`EXE names ${r}, not on disk`);
    const wavRefs = [...exeRefs].filter((r) => /\.wav$/.test(r));
    let unreferenced = 0; for (const p of files.filter((f) => /\.wav$/i.test(f))) if (!exeRefs.has(rel(p).toLowerCase())) unreferenced++;
    notes.push(`EXE sound path literals: ${exeRefs.size} (${wavRefs.length} wav); missing on disk (tolerated, ${refMiss.length}): ${refMiss.join(', ')}; wavs on disk not named by the EXE (loaded by pattern or unused): ${unreferenced}`);

    // ---- tables inside the EXE (SoundClass.cpp / DirectMusic.cpp)
    const exeBytes = u8(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'));
    const norm = (v) => v.replace(/\\+/g, '/').replace(/^_data\/sounds\//i, '').toLowerCase();
    const onDisk = (v) => { const r = norm(v); return lower.has(r) || lower.has(r.replace('ambience midi', 'ambience_midi')); };
    {
      const t = readExeSoundTable(exeBytes);
      checked++;
      const seen = new Set(); let oddPan = [], fastRates = 0, undefinedPaths = 0, missingFiles = [], rateDiff = 0, loopForever = 0, silence = 0;
      for (const e of t) {
        if (!e.name || !/^[A-Za-z0-9_]+$/.test(e.name) || !/(SND|SDN)_/.test(e.name)) failures.push(`sound table #${e.id}: bad name "${e.name}"`);
        if (seen.has(e.name)) failures.push(`sound table: duplicate name ${e.name}`); seen.add(e.name);
        if (e.volume > 127) failures.push(`${e.name}: volume ${e.volume}`);
        if (e.loopCount !== e.loopCount2) failures.push(`${e.name}: loop count fields differ`);
        if (!(e.minDist <= e.maxDist)) failures.push(`${e.name}: min ${e.minDist} > max ${e.maxDist}`);
        if (e.pan > 127) { oddPan.push(e.name + '=' + e.pan); if (e.name !== 'SND_CEDRIC_WALK') failures.push(`${e.name}: pan ${e.pan}`); } // CEDRIC_WALK has pan 512 (MSS clamps to 127)
        if (e.rate < 4000 || e.rate > 100000) failures.push(`${e.name}: rate ${e.rate}`);
        if (e.rate > 48000) fastRates++;
        if (e.loopCount === 0) loopForever++;
        if (e.path === 'UNDEFINED' || /PSX/i.test(e.path)) { undefinedPaths++; continue; }
        if (/silence\.wav$/i.test(e.path)) silence++;
        if (!onDisk(e.path)) missingFiles.push(`${e.name} -> ${e.path.replace(/\\+/g, '/')}`);
        else if (/\.wav$/i.test(e.path)) {
          const f = byLower.get(norm(e.path)) ?? byLower.get(norm(e.path).replace('ambience midi', 'ambience_midi'));
          if (f) { const b = u8(f); if (b.length) { try { if (parseWav(b).sampleRate !== e.rate) rateDiff++; } catch { /* reported above */ } } }
        }
      }
      // PSX-only stunt samples and two never-shipped PC samples
      const tolerated = (m) => /islestunts\//i.test(m) || /bonk\.wav|snake_amb2\.wav|\/$/i.test(m) || /(z01bpk|z02lgi)\/$/i.test(m) || /CSSND_HORSE_HOOVES/.test(m); // that path lacks the .wav extension in the EXE
      for (const m of missingFiles) if (!tolerated(m)) failures.push(`sound table: ${m} not on disk`);
      notes.push(`EXE sound table (902 x 32 bytes at VA 0x969f80): ${t.length} entries, all names unique; ${undefinedPaths} UNDEFINED/PSX placeholders, ${missingFiles.length} paths not shipped (tolerated: ${missingFiles.map((m) => m.split(' -> ')[0]).join(', ')}), ${loopForever} loop forever, ${silence} point at Silence.wav, playback-rate field != wav header rate in ${rateDiff}, rate > 48000 (pitch-shifted) in ${fastRates}, odd pan: ${oddPan.join(',')}`);
      if (t.length !== 902) failures.push('sound table length');
    }
    {
      const m = readExeMusicTable(exeBytes);
      checked++;
      let miss = [];
      for (const e of m) {
        const d = norm(e.dir);
        const dirFiles = files.map(rel).filter((r) => r.toLowerCase().startsWith(d + '/')).map((r) => r.slice(d.length + 1).toLowerCase());
        if (!dirFiles.length) failures.push(`music table ${e.key}: directory ${e.dir} empty`);
        if (!dirFiles.includes(e.dls.toLowerCase())) failures.push(`music table ${e.key}: ${e.dls} not found`);
        if (!dirFiles.includes(e.segment.toLowerCase())) miss.push(`${e.key}: ${e.segment}`);
      }
      // "Lego Town Bridge.sgt" is named by the EXE but not shipped (the bridge uses the town theme)
      for (const x of miss) if (!/Lego Town Bridge\.sgt/.test(x)) failures.push(`music table: ${x} not found`);
      notes.push(`EXE music table (41 x 16 bytes at VA 0x97fcb8): level key -> segment + dls; not shipped: ${miss.join(', ')}`);
    }
    {
      const sp = readExeSpeechTable(exeBytes);
      checked++;
      const uniq = new Set(sp.map((x) => x.toUpperCase()));
      const missing = [...uniq].filter((x) => !speechIds.has(x));
      const notInTable = [...speechIds].filter((x) => !uniq.has(x));
      const expectMissing = new Set(['CASGJO11', 'CARQAA03', 'CARQAA07', 'CARQBB06']);
      for (const x of missing) if (!expectMissing.has(x)) failures.push(`speech table names ${x}, no mp3`);
      for (const id of say) if (!uniq.has(id)) failures.push(`cutscene SayText ${id} not in the EXE speech table`);
      notes.push(`EXE speech table (VA 0x979098): ${sp.length} entries, ${uniq.size} distinct; no mp3 for ${missing.join(', ')}; ${notInTable.length} mp3 files not in the table (unused alternates)`);
    }
    {
      const a = readExeAmbienceTable(exeBytes);
      checked++;
      for (const e of a) { if (!onDisk(e.midi)) failures.push(`ambience ${e.key}: ${e.midi} missing`); if (!onDisk(e.dls)) failures.push(`ambience ${e.key}: ${e.dls} missing`); }
      notes.push(`EXE MIDI ambience table (6 x 16 bytes at VA 0x97ff48): ${a.map((e) => e.key + '/' + e.volume).join(', ')}`);
    }
    return { checked, failures, notes };
  },
};
