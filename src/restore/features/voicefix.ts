// Restored feature 'voicefix' (item 7a of docs/re/restore-plan.md, docs/re/restore.md): a voice-slot bug of the island's NPC table.
//
// ORIGINAL: `LI/Data/LIFSM5.str` line `TBOBA` (Tom Bob, band of story node 7) carries speech index 520 = `LEBEBB07`, the clip of its OWN `TBOBC` line (500 is `LEBEBB07` too); the text of
//   `TBOBA` repeats `TBOBC`'s. The band's numbering has the hole `LEBEAA07` (an audio-only orphan file, `sounds/speech/Data/LEBEAA07.mp3`): the A line was recorded but never wired.
// RECONSTRUCTION: the text of the subtitle (typed from a Whisper transcript, lines.nl.ts `LEBEAA07`; the transcript is garbled: flagged in DOUBTFUL_LINES) and the decision that the clip belongs to TBOBA.
//   Nothing else changes (TBOBC stays as shipped).
import type { Feature } from '../feature.ts';
import { line } from '../overlay.ts';

export const feature: Feature = {
  id: 'voicefix',
  messages: { 'LI/Data/lifsm5.str': () => [line('TBOBA', 'LEBEAA07')] },
};
