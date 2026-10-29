// Restored feature 'cave' (src/restore/features/cave.ts): the ending (node 68) opens the WORM portal (var 0xd 1 -> 2 -> 5), the portal box leads to z50LTC (var 5 = 0x22) and plays Teleport;
// the cave plays Teleport2 on arrival through the portal. Option off: nothing of it.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadIsland, tick } from '../lib/island-load.mjs';
import { resetCave, TELEPORT } from '../../src/restore/features/cave.ts';

const only = RESTORE_FEATURES.map((f) => f.id).filter((f) => f !== 'cave');   // the other restored features are off in this test
const clear = () => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; resetCave(); };

export default {
  name: 'restore-cave',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exe = fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'));
    const soundsDir = path.join(ctx.dataRoot, '_data', 'sounds');

    // ---- option off: the sound table has its 902 entries, nothing opens the portal
    forceRestored(null); clear();
    const base = readAudioTables(exe);
    ok(base.sounds.length === 902, 'option off: 902 sound entries');
    {
      const I = loadIsland(ctx, { node: 68 });
      const game = { ctx: { vars: I.vars }, ictx: I.ictx };
      tick(I, 60, () => restoreHooks.islandTick?.(game));
      ok(I.vars.get(0xd) === 0, `option off: var 0xd stays 0 at node 68 (${I.vars.get(0xd)})`);
      const w = I.rec('WORM');
      ok(!w || (w.flags & 2) === 0, 'option off: the wormhole stays hidden');
    }

    // ---- option on
    forceRestored(true, only); await loadRestore();
    const t = readAudioTables(exe);
    ok(t.sounds.length === 904 && TELEPORT.enter === 902 && TELEPORT.arrive === 903, `two new sound entries (${t.sounds.length}, ids ${TELEPORT.enter}/${TELEPORT.arrive})`);
    for (const id of [TELEPORT.enter, TELEPORT.arrive]) {
      const e = t.sounds[id];
      const file = path.join(soundsDir, 'z02LGI', e.path.split('\\').pop());
      const have = fs.existsSync(file) || fs.readdirSync(path.join(soundsDir, 'z02LGI')).some((f) => f.toLowerCase() === e.path.split('\\').pop().toLowerCase());
      ok(have, `sound ${e.name}: ${e.path} exists`);
    }
    ok(JSON.stringify(base.sounds) === JSON.stringify(t.sounds.slice(0, 902)), 'the original 902 entries are untouched');
    const t2 = readAudioTables(exe);
    ok(t2.sounds.length === 904, 'reading the table again does not add more entries (each read starts from the exe)');

    // the island at the ending
    const I = loadIsland(ctx, { node: 68 });
    const game = { ctx: { vars: I.vars }, ictx: I.ictx };
    restoreHooks.islandStart(game);
    ok(I.vars.get(0xd) === 0, 'node 68: var 0xd starts at 0');
    const seen = new Set();
    tick(I, 120, () => { restoreHooks.islandTick(game); seen.add(I.vars.get(0xd)); });
    ok(I.vars.get(0xd) === 5 && seen.has(1) || seen.has(2), `var 0xd 1 -> 2 -> 5 (seen ${[...seen]}, now ${I.vars.get(0xd)})`);
    ok(I.vars.get(0xd) === 5, `the director's scale-in finished (var 0xd = ${I.vars.get(0xd)})`);
    const worm = I.rec('WORM');
    ok(worm && (worm.flags & 2) !== 0, 'the wormhole is visible');
    // other nodes do not open it
    {
      const J = loadIsland(ctx, { node: 61 });
      const g2 = { ctx: { vars: J.vars }, ictx: J.ictx };
      restoreHooks.islandStart(g2);
      tick(J, 60, () => restoreHooks.islandTick(g2));
      ok(J.vars.get(0xd) === 0, 'node 61 (not the ending): the portal stays closed');
    }
    // walk into the portal box: var 5 = 0x22 and the enter sound plays once
    ok(I.vars.get(5) !== 0x22, 'before: var 5 is not the cave');
    const p = I.pepper;
    let cave = false, played = 0;
    // the portal fires when Pepper approaches (each tick closer than the last) inside its box: walk in from 12 units
    for (let d = 12; d >= 0 && !cave; d -= 1) {
      p.x = worm.x; p.y = worm.y; p.z = worm.z + d; p.savePrev();
      tick(I, 2, () => { restoreHooks.islandTick(game); });
      if (I.vars.get(5) === 0x22) cave = true;
    }
    played = I.ictx.sounds.filter((s) => s.id === TELEPORT.enter).length;
    ok(cave, `the portal box sets var 5 = 0x22 (${I.vars.get(5)})`);
    ok(played === 1, `Teleport played once on entering (${played})`);
    tick(I, 30, () => restoreHooks.islandTick(game));
    ok(I.ictx.sounds.filter((s) => s.id === TELEPORT.enter).length === 1, 'and not again while var 5 stays');
    // the cave's arrival cue (only after the portal)
    const heard = [];
    restoreHooks.cue('ltc-arrive', { sfx: (id) => heard.push(id) });
    ok(heard.join() === String(TELEPORT.arrive), `arrival in z50LTC through the portal plays Teleport2 (${heard})`);
    restoreHooks.cue('ltc-arrive', { sfx: (id) => heard.push(id) });
    ok(heard.length === 1, 'the arrival sound plays once per portal use');
    clear(); forceRestored(null);
    return { checked, failures, notes };
  },
};
