// Restored feature 'popups' (docs/re/restore-plan.md item 10, docs/re/restore.md): the zone messages that exist in the game's string tables and are never shown.
// ORIGINAL: the texts (WAB1-3 in LI/Data/WAB.str, WAS1-2 in AI/Data/WAS.str, FSH5 in AI/Data/FSH.str, BIP10 / 11 / 14 / 15 in AI/Data/BIP.str) and, for FSH5, the zone's own message-slot facility (FUN_006f48c9).
// RECONSTRUCTION: when / where / how long each text appears (the original has no call for any of them): WAB1-3 match the three whack events by meaning (hit, miss, Infomaniac); WAS1-2 hit / miss;
// FSH5 on a catch next to FSH3 "Mooie worp!"; BIP15 with the low-fuel speech ADSGBI09, BIP10 when the fuel reaches 0, BIP11 on the failed-by-fuel banner, BIP14 on a medal banner.
// Not restored: WAS3 / WAS4 (go with the unplayed big swing), BIP12 / 13 (the result code they would belong to cannot occur), BIP1-9 (a stunt-flight draft: class C).
import type { Feature } from '../feature.ts';
import type { CueCtx } from '../cuectx.ts';
import { hudPopup } from '../popup.ts';

const say = (c: CueCtx, id: string, y = 130, ms = 900) => { const t = c.strings?.text(id); if (t && c.hud) hudPopup(c.hud, t, { y, ms }); };

const HANDLERS: Record<string, (c: CueCtx) => void> = {
  'wab-hit': (c) => say(c, 'WAB1'),
  'wab-miss': (c) => say(c, 'WAB2'),
  'wab-info': (c) => say(c, 'WAB3'),
  'was-hit': (c) => say(c, 'WAS1'),
  'was-miss': (c) => say(c, 'WAS2'),
  // z21FSH: the zone's own blinking message slots, above the "13kg = 1014pts" popup (x 300, y 0x1b8), clear of the speech subtitle (y ~ 384)
  'fsh-catch': (c) => c.addPopup?.('FSH5', 5, 10, 2, 300, 0x15e),
  'bip-lowfuel': (c) => say(c, 'BIP15', 130, 2500),
  'bip-outoffuel': (c) => say(c, 'BIP10', 130, 2500),
  // the end banner (called from the zone's drawBanner every frame): result 1 = out of fuel, 3+ = a medal
  'bip-banner': (c) => {
    const ui = c.ui, t = (id: string) => c.strings?.text(id);
    if (!ui) return;
    if (c.result === 1) { const a = t('BIP10'), b = t('BIP11'); if (a) ui.text(1, a, 320, 0x5a, { colour: 0, maxChars: 30 }); if (b) ui.text(1, b, 320, 0x178, { colour: 0, maxChars: 30 }); }
    else if ((c.result ?? 0) >= 3) { const a = t('BIP14'); if (a) ui.text(1, a, 320, 0x178, { colour: 0, maxChars: 30 }); }
  },
};

export const feature: Feature = {
  id: 'popups',
  cue(name, ctx) { HANDLERS[name]?.((ctx ?? {}) as CueCtx); },
};
