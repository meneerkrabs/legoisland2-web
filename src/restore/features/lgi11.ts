// Restored feature 'lgi11' (docs/re/restore-plan.md item 1, docs/re/restore.md): the finished cutscene LGI11 "BBs_Dance_Dizzy" (Agent Nick arrests the radio) that nothing starts, and the
// commented-out LGI09 line LECSBK24 "Pepper, de rattenvanger van Pizza."
//
// ORIGINAL: `lgi11.txt/.cut` + `LGI11.str` + the three mp3 (731-733), the slot 7 = LGI11 declaration of the era-3 set-up, the POLB `StartCSM` (node 0x39, gate S277) that starts slot 8,
//           the cutscene manager's own one-deep start queue (FUN_00458d15), and the developers' commented block `//340 ... LECSBK24` of `lgi09.txt` (rule P: un-comment it, point 330's next at it).
// RECONSTRUCTION: only the decision that the arrest scene precedes the Infomaniac's praise (slot 7 before slot 8: slot numbers + the shared stage `CSM_police01`, S1LPAT2/3 with mirrored roles).
import type { Feature } from '../feature.ts';

/** the minimal view of the island game this feature needs (src/zones/z02LGI/index.ts `IslandGame`) */
interface GameLike {
  ictx: { era: number };
  ctx: { cutscene: { active(): boolean; start(slot: number): boolean; inspect?(): { queued: number } } };
}

const SLOT_ARREST = 7, SLOT_PRAISE = 8, ERA = 3;

let game: GameLike | null = null;
/** the slot still to start once the manager is idle (the chain) */
let pending: number | null = null;

export const feature: Feature = {
  id: 'lgi11',
  scripts: [
    // lgi09.txt: `330 0.0 pepp saytext LECSBK23 350` (the developers' cut skipped the block) -> next 340; `//340 0.0 pepp saytext LECSBK24 350` un-commented. The two commented `info setvisibility`
    // lines (330 / 350) stay commented: they hide / show the Infomaniac, which the shipped scene does not do. ORIGINAL data, compiled by the original's format code.
    { zone: 'z02LGI', script: 'lgi09', unComment: [484], setNext: [{ line: 482, from: 350, to: 340 }], note: 'LECSBK24 "Pepper, de rattenvanger van Pizza." after LECSBK23' },
  ],
  islandStart(g) { game = g as GameLike; pending = null; },
  startCutscene(slot, start) {
    if (slot !== SLOT_PRAISE || !game || game.ictx.era !== ERA) return undefined;
    if (pending !== null) return undefined;               // (our own follow-up is being started: the normal path)
    const ok = start(SLOT_ARREST);
    // the original's manager queues one script behind the running one (FUN_00458d15): slot 8 then follows without a gap (no letterbox flicker, the StartCSM node sees "active" throughout).
    // Without that queue (or when it was taken by another script) the island tick starts slot 8 once the manager is idle.
    const cs = game.ctx.cutscene;
    if (cs.inspect) { start(SLOT_PRAISE); if (cs.inspect().queued !== SLOT_PRAISE) pending = SLOT_PRAISE; }
    else pending = SLOT_PRAISE;
    return ok;
  },
  cutscenePending: () => pending !== null,
  islandTick(g) {
    if (pending === null) return;
    const cs = (g as GameLike).ctx.cutscene;
    if (cs.active()) return;
    const slot = pending; pending = null;
    cs.start(slot);
  },
};

/** test aid: forget the captured game */
export function resetLgi11() { game = null; pending = null; }
