// Restored feature 'voiceswap' (item 7b of docs/re/restore-plan.md, docs/re/restore.md): the policemen of band 2 get their own recordings.
//
// ORIGINAL: `LI/Data/LIFSM2.str` `NICKA:362` / `LICKA:363` reuse the band-1 clips `LEDPAA05` / `LEDPAA06` (speech table), while the band's own numbering has the holes `LEPHAA03` / `LEPHAA04`, two audio-only
//   orphan files (`sounds/speech/Data`) of the same actor.
// RECONSTRUCTION: that those two orphans belong to NICKA / LICKA (they fit policemen: "lekker aan het joggen", "je bent klaar met je ronde") and their subtitles (Whisper transcripts, lines.nl.ts; LEPHAA03 is
//   in DOUBTFUL_LINES). This is a swap of recordings, not a bug repair, therefore its own feature id (the player can keep the shipped lines).
import type { Feature } from '../feature.ts';
import { line } from '../overlay.ts';

export const feature: Feature = {
  id: 'voiceswap',
  messages: { 'LI/Data/lifsm2.str': () => [line('NICKA', 'LEPHAA03'), line('LICKA', 'LEPHAA04')] },
};
