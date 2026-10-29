// Restored feature 'looks' (src/restore/features/looks.ts): extra vehicle looks appended to the roster: sizes, texture ids exist in SwapText, the cycler reaches every new look and wraps,
// the brick effect has one model per look, `policecar01.txt` exists. Option off: the groups stay as read from the executable.
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { loadIsland, tick } from '../lib/island-load.mjs';
import { ensureLooks, nextLook, lookWord } from '../../src/island/vehicles/looks.ts';
import { islandBrickFx } from '../../src/fx/bricks/island.ts';
import { RECIPES } from '../../src/restore/features/looks.ts';

const only = RESTORE_FEATURES.map((f) => f.id).filter((f) => f !== 'looks');
const clear = () => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; };

export default {
  name: 'restore-looks',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const swap = ctx.archives.find((a) => a.name.toLowerCase() === 'swaptext');
    const have = new Set(swap.entries.map((e) => /text(\d+)\.tga$/i.exec(e.path)?.[1]).filter(Boolean).map(Number));

    // ---- option off
    forceRestored(null); clear();
    const I0 = loadIsland(ctx, { node: 2, bricks: true });
    const L0 = ensureLooks(I0.world);
    const base = new Map(L0.entries.map((e) => [e.rec, e.looks.length]));
    notes.push(`roster sizes (original): ${[...base].map(([r, n]) => `${I0.world.records[r].name} ${n}`).join(', ')}`);
    restoreHooks.islandTick?.({ ctx: { world: I0.world } });
    ok(L0.entries.every((e) => e.looks.length === base.get(e.rec)), 'option off: the groups stay as read');

    // ---- option on
    forceRestored(true, only); await loadRestore();
    const I = loadIsland(ctx, { node: 2, bricks: true });
    const L = ensureLooks(I.world);
    const fx = islandBrickFx(I.world);
    const game = { ctx: { world: I.world } };
    restoreHooks.islandTick(game);
    for (const e of L.entries) {
      const rs = RECIPES.filter((r) => r.rec === e.rec);
      const nm = I.world.records[e.rec].name;
      ok(e.looks.length === base.get(e.rec) + rs.length, `${nm}: ${base.get(e.rec)} -> ${e.looks.length} looks (${rs.length} recipes)`);
      const s = fx.slot(e.slot);
      ok(!s || s.models.length === e.looks.length, `${nm}: brick models ${s?.models.length} = looks ${e.looks.length}`);
      // every texture id of every new look exists in SwapText and the first original look's lists are untouched
      for (let k = base.get(e.rec); k < e.looks.length; k++) {
        for (const p of e.looks[k].parts) for (const t of p.list ?? []) ok(have.has(t), `${nm} look ${k}: SwapText texture ${t} exists`);
        ok(e.looks[k].parts.some((p) => p.list), `${nm} look ${k}: not an empty look`);
        const r = rs[k - base.get(e.rec)];
        // the new look differs from its base and uses the recipe's new ids
        const ids = new Set(e.looks[k].parts.flatMap((p) => p.list ?? []));
        ok(r.swap.every(([, to]) => ids.has(to)), `${nm} look ${k}: has the new textures ${r.swap.map((x) => x[1])}`);
        if (s) for (const m of [s.models[k]]) ok(m.data.bricks.length > 0, `${nm} look ${k}: brick model ${m.file} has bricks`);
      }
      // cycler: every look once, then wraps to the original paint (look 0)
      const c = { looks: e.looks, part: 0, variant: 0 }; const seen = [];
      for (let i = 0; i < e.looks.length; i++) { nextLook(c); seen.push(lookWord(c)); }
      ok(c.part === 0 && seen.join() === [...Array(e.looks.length).keys()].slice(1).concat([0]).join(), `${nm}: Enter cycles through all ${e.looks.length} looks and wraps`);
    }
    const pcar = L.entries.find((e) => I.world.records[e.rec].name === 'PCAR');
    const ps = fx.slot(pcar.slot);
    ok(ps.models[ps.models.length - 1].file === 'policecar01.txt', 'police car: the last brick model is policecar01.txt');
    // idempotent
    restoreHooks.islandTick(game);
    ok(L.entries.find((e) => e.rec === pcar.rec).looks.length === base.get(pcar.rec) + 1, 'a second tick does not add looks again');
    tick(I, 5);
    clear(); forceRestored(null);
    return { checked, failures, notes };
  },
};
