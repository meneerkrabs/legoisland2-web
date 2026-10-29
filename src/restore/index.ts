// The optional mode "Herstelde inhoud": the implementation, loaded by `loadRestore()` (flag.ts) only when the option is on. `installRestore()` composes the enabled features into `restoreHooks`.
import { restoreHooks, restoredFeature } from './flag.ts';
import type { Feature } from './feature.ts';
import { extendSpeech, overlay } from './overlay.ts';
import { patchedCut } from './scripts.ts';
import type { ScriptPatch } from './scripts.ts';
import { feature as lgi11 } from './features/lgi11.ts';
import { feature as battery } from './features/battery.ts';
import { feature as arrow } from './features/arrow.ts';
import { feature as tips } from './features/tips.ts';
import { feature as cutlines } from './features/cutlines.ts';
import { feature as hubcuts } from './features/hubcuts.ts';
import { feature as voicefix } from './features/voicefix.ts';
import { feature as voiceswap } from './features/voiceswap.ts';
import { feature as joke } from './features/joke.ts';
import { feature as cues } from './features/cues.ts';
import { feature as popups } from './features/popups.ts';
import { feature as looks } from './features/looks.ts';
import { feature as swimmer } from './features/swimmer.ts';
import { feature as cave } from './features/cave.ts';
import { feature as holo } from './features/holo.ts';
import { feature as page } from './features/page.ts';
import { feature as hubnpc } from './features/hubnpc.ts';

export const ALL_FEATURES: readonly Feature[] = [lgi11, battery, arrow, tips, cutlines, hubcuts, voicefix, voiceswap, joke, cues, popups, looks, swimmer, cave, holo, page, hubnpc];

/** the enabled features (the option and the player's per-feature switches are read when asked) */
export const enabled = (): Feature[] => ALL_FEATURES.filter((f) => restoredFeature(f.id));

export function installRestore() {
  const h = restoreHooks;
  h.extraSpeech = (speech) => { if (enabled().length > 0) extendSpeech(speech); };   // (all features off: the table stays as it is)
  h.script = (arc, zone, name) => {
    const ps: ScriptPatch[] = [];
    for (const f of enabled()) for (const p of f.scripts ?? []) if (p.zone.toLowerCase() === zone.toLowerCase() && p.script.toLowerCase() === name.toLowerCase()) ps.push(p);
    return patchedCut(arc, ps);
  };
  h.messages = (path, table) => {
    const key = path.replace(/\\/g, '/').toLowerCase();
    let t = table;
    for (const f of enabled()) for (const [p, fn] of Object.entries(f.messages ?? {})) if (p.toLowerCase() === key) t = overlay(t, fn());
    return t;
  };
  h.say = (table, id, id2, speak) => { for (const f of enabled()) { const r = f.say?.(table, id, id2, speak); if (r !== undefined) return r; } return undefined; };
  h.startCutscene = (slot, start) => { for (const f of enabled()) { const r = f.startCutscene?.(slot, start); if (r !== undefined) return r; } return undefined; };
  h.cutsceneActive = (active) => active || enabled().some((f) => f.cutscenePending?.() === true);
  h.islandStart = (g) => { for (const f of enabled()) f.islandStart?.(g); };
  h.islandTick = (g) => { for (const f of enabled()) f.islandTick?.(g); };
  h.soundPatch = (s) => { for (const f of enabled()) f.soundPatch?.(s); };
  h.cue = (name, ctx) => { for (const f of enabled()) f.cue?.(name, ctx); };
}
