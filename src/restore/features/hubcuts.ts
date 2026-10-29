// Restored feature 'hubcuts' (docs/re/restore-plan.md section 9 items R-A1 .. R-A10, docs/re/restore.md): cut or missing lines of the hub cutscenes (castle, Oasis, Pizza Palace, Ogel's island), by rule P (src/restore/scripts.ts).
// ORIGINAL (rule P on the game's own script text, compiled by the original format code): R-A1 csi02 / R-A2 csi02a (CACSBR11, the developers' commented block 60), R-A3 ogl01 (the fourth sleeper cit4: commented blocks 40 / 45),
//   R-A5 adv02 (the Dr. Pepper gag: the block that adv02psx.txt, the PlayStation script of the same scene, still has).
// RECONSTRUCTION (a line inserted where the numbering of the ids leaves a hole, the speaker is guessed): R-A4 csi01 (CACSAR02, speaker Lar2), R-A6 csi08 (CACSCS08 "Aha, bijna!", speaker bar2: DOUBTFUL, a listen decides).
// R-A5 also needs two subtitles (the lines have audio only): ADCSAM05 / 06 from src/restore/lines.nl.ts (D1: typed from a transcript; ADCSAM06 is flagged doubtful; the gag is probably the soft-drink brand, D2).
// NOT included: R-A9 csi04 CACSBP17 (class C: contradicts the PC staging), R-A7 (the page, feature 'page'), R-A8 csi07 / R-A10 csi09 (cosmetic, `COSMETIC` below: only for a hub scene that was looked at, see docs/re/restore.md).
// Zone names are the hub's archive names (what cutscene-host `declare()` passes as `s.zone`; the hook compares case-insensitively).
import type { Feature } from '../feature.ts';
import type { ScriptPatch } from '../scripts.ts';
import { line } from '../overlay.ts';

export const PATCHES: ScriptPatch[] = [
  // R-A1: `50 ... CACSBR10 70` skips the commented block 60 (lines 111-116: Lion LSD1 "Hoera, Pepper, Pepper, nu kunnen we gaan vechten!")
  { zone: 'z07CSI', script: 'csi02', unComment: [111, 112, 113, 114, 115, 116], setNext: [{ line: 109, from: 70, to: 60 }], note: 'R-A1 CACSBR11 (original block)' },
  // R-A2: the same block in the variant that is started when the page was already won (var 0xc2 != 0)
  { zone: 'z07CSI', script: 'csi02a', unComment: [109, 110, 111, 112, 113, 114], setNext: [{ line: 93, from: 70, to: 60 }], note: 'R-A2 CACSBR11 in csi02a (original block)' },
  // R-A3: cit4 falls asleep between cit5 and cit2 (line 24 stays commented: it would move cit4 to holo01)
  { zone: 'z40OGL', script: 'ogl01', unComment: [48, 49, 50, 51, 53], setNext: [{ line: 46, from: 50, to: 40 }], note: 'R-A3 the fourth sleeper (original blocks 40 / 45)' },
  // R-A4: RECONSTRUCTION: ids 01, [02], 03-07: Lar2 says CACSAR02 right after CACSAR01 (the commented lines 54-56 show Lar2 as the cheering speaker)
  { zone: 'z07CSI', script: 'csi01', setNext: [{ line: 47, from: 11, to: 8 }], insert: [{ after: 47, lines: ['8\t\t0.0\t\tLar2\t\tsaytext\t\t\tCACSAR02\t11'] }], note: 'R-A4 CACSAR02 (reconstruction: slot and speaker)' },
  // R-A5: the Dr. Pepper gag: ADCSAM04 ends "... en hij is"; the PlayStation script still has the cut block 40 / 50 (original script text, reconstruction of the two subtitles)
  { zone: 'z16PYA', script: 'adv02', setNext: [{ line: 32, from: 60, to: 40 }],
    insert: [{ after: 34, lines: ['40\t0.0\t\tjthn\tsetanim\t\txidle', '40\t0.0\t\tdrkl\tsetanim\t\txtalk', '40\t0.0\t\tdrkl\tSayText\t\tADCSAM05\t\t50', '50\t0.0\t\tdrkl\tsetanim\t\txidle', '50\t0.0\t\tjthn\tsetanim\t\txtalk', '50\t0.0\t\tjthn\tSayText\t\tADCSAM06\t\t60'] }],
    note: 'R-A5 Dr. Pepper gag (PSX block; subtitles D1 / D2)' },
  // R-A6: RECONSTRUCTION, doubtful: "Aha, bijna!" between CACSCS07 and CACSCS09; speaker bar2 is a guess (the three lines before it are bar2's)
  { zone: 'z07CSI', script: 'csi08', setNext: [{ line: 64, from: 50, to: 36 }], insert: [{ after: 64, lines: ['36\t\t0.0\t\tbar2\t\tsaytext\t\t\tcacscs08\t\t50'] }], note: 'R-A6 CACSCS08 (reconstruction, speaker doubtful)' },
];

/** cosmetic patches, NOT active (a patched scene has to be looked at in the runner first): R-A8 csi07 Pepper catches the flag (clip 156), R-A10 csi09 the page flutters along Flutter.man */
export const COSMETIC: ScriptPatch[] = [
  { zone: 'z07CSI', script: 'csi07', unComment: [97], note: 'R-A8 PEP_CATCHBULLFLAG' },
  { zone: 'z07CSI', script: 'csi09', unComment: [26], note: 'R-A10 Flutter.man' },
];

export const feature: Feature = {
  id: 'hubcuts',
  scripts: PATCHES,
  messages: {
    // R-A5: the two clips are audio only (speech indices behind the executable's table, src/restore/overlay.ts); RECONSTRUCTION: the subtitle texts
    'AI/Data/ADV02.str': () => [line('ADCSAM05', 'ADCSAM05'), line('ADCSAM06', 'ADCSAM06')],
  },
};
