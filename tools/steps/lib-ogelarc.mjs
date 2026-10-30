// The Ogel arc of the story (nodes 62..67 and the end), played IN PLACE by the chapter bots with real key input, no stub aids (F9 / F10):
//   z39ASB (62)  m3-z39ASB.mjs    the asteroid belt, the dodging page-side bot, result menu Continue
//   z40aPO (63)  m3-z40aPO.mjs    the parachute landing on Ogel
//   z40OGL (64)  m5-z40OGL.mjs    the hub: walk the PATH route to the pizzeria
//   z41MAP (65)  m3-z41MAP.mjs    pizza making
//   z40OGL (66)  m5-z40OGL.mjs    the hub: climb to the palace
//   z42BRP (67)  m6-z42BRP.mjs    the palace, the outro movie, then the island at node 68
// Shared by tools/steps/m4-era3.mjs (its asb phase) and tools/steps/full-story.mjs. `R` is a lib-story runner. Returns { ok, fails, log }.
import { probe, waitProbe, installStoryTrace, storyTrace, playMini } from './lib-story.mjs';

const D = new URL('.', import.meta.url).pathname;
const leftZone = (arch) => (st) => st.arch && st.arch !== arch && st.mode >= 0;

export const OGEL = [
  { id: 'z39ASB', mini: true, node: 62, file: 'm3-z39ASB.mjs', env: {}, until: leftZone('z39ASB'), arrive: (st) => st.arch === 'z40aPO' && st.node === 63 },
  { id: 'z40aPO', mini: true, node: 63, file: 'm3-z40aPO.mjs', env: {}, until: leftZone('z40aPO'), arrive: (st) => st.arch === 'z40OGL' && st.node === 64 },
  { id: 'z40OGL-64', node: 64, file: 'm5-z40OGL.mjs', env: { NODE: 64 }, until: null, arrive: (st) => st.arch === 'z41MAP' && st.node === 65 },
  { id: 'z41MAP', mini: true, node: 65, file: 'm3-z41MAP.mjs', env: {}, until: leftZone('z41MAP'), arrive: (st) => st.arch === 'z40OGL' && st.node === 66 },
  { id: 'z40OGL-66', node: 66, file: 'm5-z40OGL.mjs', env: { NODE: 66 }, until: null, arrive: (st) => st.arch === 'z42BRP' && st.node === 67 },
  { id: 'z42BRP', node: 67, file: 'm6-z42BRP.mjs', env: {}, until: null, arrive: (st) => st.arch === 'z02LGI' && st.node === 68 },
];

/** play the arc from the chapter whose node is `fromNode` (the game is at that zone / node); stops at the island node 68 */
export async function ogelArc(h, R, { fromNode = 62, stamp = () => '', onChapter = () => {} } = {}) {
  const { page, log } = h;
  const fails = [];
  await installStoryTrace(page);
  for (const c of OGEL) {
    if (c.node < fromNode) continue;
    const st0 = await probe(page);
    log(stamp(), `--- Ogel arc: ${c.id} (story node ${c.node}); the game is at ${st0.arch}:${st0.node} mode ${st0.mode}`);
    const r = c.mini
      ? await playMini(R, h, { file: D + c.file, env: c.env, zone: c.id, label: c.id, stamp })
      : await R.runModule(D + c.file, { env: c.env, until: c.until, label: c.id, ms: 50 * 60000 });
    const st = await waitProbe(page, (p) => c.arrive(p), 120000) ?? await probe(page);
    const arrived = !!st && !st.hung && c.arrive(st);
    log(stamp(), `--- Ogel arc: ${c.id}: ${r.ok ? 'steps ok' : 'STEP FAILURES: ' + r.fails.join(' | ')}; ${arrived ? 'arrived' : 'DID NOT ARRIVE'} at ${st?.arch}:${st?.node} (${(r.ms / 60000).toFixed(1)} min)`);
    if (!r.ok) fails.push(`${c.id}: ${r.fails.join(' | ')}`);
    if (!arrived) {
      fails.push(`${c.id}: the story is at ${st?.arch}:${st?.node}, expected the next chapter`);
      log('story trace (every move of the story FSM):', JSON.stringify(await storyTrace(page)));
      break;
    }
    onChapter(c, st);
  }
  return { ok: fails.length === 0, fails };
}
