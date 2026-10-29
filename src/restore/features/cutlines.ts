// Restored feature 'cutlines' (docs/re/restore-plan.md items 5b + section 9, docs/re/restore.md): island cutscene lines that were recorded and written but never scripted.
//   * LEINVS04 "Erop af." in lgici25 (Pepper brings Valerie Stubbins her pizza)
// (the radio-battery lines of lgi10 belong to the 'battery' feature; the hub scripts to 'hubcuts')
//
// ORIGINAL: `LGICI25.str` has the tag LEINVS04 (voice 35, clip LEINVS04.mp3) right behind LEINVS03, the script stops after LEINVS03; the cutscene format code compiles the patched text.
// RECONSTRUCTION: the place of the line (block 40, while the pizza changes hands) and the SPEAKER: the plan guessed Valerie; the recording's pitch (median F0 of the clip about 267 Hz, Pepper's
//   LEINVS01 about 286 Hz, Valerie's LEINVS02 / 03 about 356 / 327 Hz, measured with an autocorrelation on the decoded mp3) fits Pepper handing the pizza over ("Erop af!" = "dig in!").
import type { Feature } from '../feature.ts';

export const feature: Feature = {
  id: 'cutlines',
  scripts: [
    // lgici25.txt line 25 is `40 0.0 Vals setanim PEP_HandsPizza1 45` (both actors hand the pizza over at block 40, block 45 waits for both): the new line signals 45 as well,
    // so block 45 (Valerie takes the pizza) starts when the line is spoken. RECONSTRUCTION (inserted line).
    { zone: 'z02LGI', script: 'lgici25', insert: [{ after: 25, lines: ['40\t0.0\t\tPepp\t\tSayText\t\tLEINVS04\t\t\t\t\t45'] }], note: 'LEINVS04 "Erop af." while Pepper hands Valerie the pizza' },
  ],
};
