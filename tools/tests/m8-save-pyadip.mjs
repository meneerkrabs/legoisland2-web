// WP-SAVE, z16PYA PeppSw (0x677350, saver FUN_006772ed / loader FUN_00677312) and z23DIP PeppSw (0x727e84, saver FUN_00727e21 / loader FUN_00727e46): the save block AFTER GAMEPLAY and the load round trip.
// The original's node (built by its own constructor, debug heap 0xCD fill) runs its pre-render natively (tools/lib/m8-save-hubs.mjs `PeppSwDuel`) next to the port's node on scripted states
// (buttons, PEPPER_CONTROL, mailbox, clips, Pepper's place and heading, a scripted ground with water, the sea level); after every pre-render `compareBlocks` (saver native vs `saveBlock`, tolerance 0)
// and the world words are compared; every so often the ORIGINAL's block of the moment is kept, the duel runs on, and `restoreBlocks` puts it back into both (native loader / `loadBlock`), the
// blocks must be equal again and the duel keeps comparing equal for a few hundred more pre-renders (the node must act like the original's node loaded from the same bytes).
import { PeppSwDuel, withCdAlloc, eraDiff, ERA_VARS } from '../lib/m8-save-hubs.mjs';
import { compareBlocks, snapshotBlocks, restoreBlocks } from '../lib/m8-save.mjs';
import { B } from '../lib/m5-z14OSD-duel.mjs';
import { guarded } from '../lib/inject-guard.mjs';

function stream(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (r, l) => l[Math.floor(r() * l.length)];

const __test = {
  name: 'm8-save-pyadip',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0, moments = 0, loads = 0;
    const fail = (m) => { if (failures.length < 60) failures.push(m); };
    for (const [zone, node, sea] of [['z16PYA', 36, -400], ['z23DIP', 50, -80], ['z23DIP', 47, -80]]) {
      const label = `${zone} node ${node}`;
      const D = withCdAlloc(() => new PeppSwDuel(ctx, zone, { node }));
      const only = new Set([D.S.ctor]);
      const rnd = stream(zone.length * 977 + node);
      // a scripted ground: water (below the sea) west of x = 0, a shelf, dry land and holes (no ground) in places
      D.script((x, z) => (x < -30 ? sea - 20 : Math.abs(z - 40) < 15 ? sea + 6 : Math.floor(x / 25 + z / 25) % 7 === 0 ? null : sea + 40 + 5 * Math.sin(x / 9)));
      D.setVar(0x5e, 1);
      const blk = (what) => { const r = compareBlocks(D.W, D.emu, `${label} ${what} t${D.t}`, only); checked += r.checked; moments++; for (const f of r.failures) fail(f); };
      const modes = [1, 1, 1, 2, 4, 4, 8, 0x1001, 0x1004, 0x1002, 0x41], states = [0x1b, 0x1b, 0, 1, 2, 0x20, 0x21, 0x32, 0x57, 0x1f, 0x38, 0x16, 0x1c], clips = [0x1b, 0x3a, 99, 0x62, 0x24, 0x3f, 0x40, 0x16, 0x20, 0x1c, 0x0d];
      const seen = { groove: {}, safe: 0 };
      const step = () => {
        D.setVar(0x5e, pick(rnd, modes));
        D.setMailbox(pick(rnd, states));
        D.setClip(pick(rnd, clips));
        D.setPressed(rnd() < 0.5 ? B.CTRL : 0);                 // (never Enter: the roster's look cycler is not mirrored here)
        const a = rnd() * 6.283;
        D.place((rnd() - 0.5) * 160, pick(rnd, [sea - 30, sea - 0.01, sea, sea + 0.01, sea + 5, sea + 60, sea + 45.5]), (rnd() - 0.5) * 120, a, (rnd() - 0.5) * 0.6);
        D.rec(D.S.board).flags &= ~2; D.orec(D.S.board).flags &= ~2; D.emu.putRecord(D.S.board, D.orec(D.S.board));
        D.pre();
        D.compareWorld(fail, `${label} t${D.t}`); checked += 6;
        const g = D.sw.groove; seen.groove[g] = (seen.groove[g] ?? 0) + 1;
      };
      blk('constructor');
      const N = 1500;
      for (let t = 0; t < N; t++) { step(); blk('play'); }
      // the load round trip, three times at different moments: keep the original's block, run on, put it back, compare, run on
      for (let k = 0; k < 3; k++) {
        const snap = snapshotBlocks(D.emu, D.W, only);
        for (let i = 0; i < 60; i++) step();
        for (const [v, x] of ERA_VARS) D.setVar(v, x);
        loads += restoreBlocks(D.W, D.emu, snap);
        { const e = eraDiff(D.emu, D.W); checked++; if (e) fail(`${label}: decor era table after the load: ${e}`); }
        blk('after load');
        const again = snapshotBlocks(D.emu, D.W, only);
        if (Buffer.compare(Buffer.from(snap[0].bytes), Buffer.from(again[0].bytes)) !== 0) fail(`${label}: the original's block changed by its own load`);
        for (let i = 0; i < 300; i++) { step(); blk('run-on'); }
      }
      // a fresh world gets the played world's blocks (the real load path: constructors at the set-up, then the file)
      {
        const snap = snapshotBlocks(D.emu, D.W, only);
        const E = withCdAlloc(() => new PeppSwDuel(ctx, zone, { node }));
        E.script((x, z) => (x < -30 ? sea - 20 : Math.abs(z - 40) < 15 ? sea + 6 : Math.floor(x / 25 + z / 25) % 7 === 0 ? null : sea + 40 + 5 * Math.sin(x / 9)));
        loads += restoreBlocks(E.W, E.emu, snap);
        const r = compareBlocks(E.W, E.emu, `${label} fresh load`, only); checked += r.checked; for (const f of r.failures) fail(f);
        const rnd2 = stream(5); const r0 = rnd;
        void r0;
        for (let i = 0; i < 400; i++) {
          E.setVar(0x5e, pick(rnd2, modes)); E.setMailbox(pick(rnd2, states)); E.setClip(pick(rnd2, clips)); E.setPressed(rnd2() < 0.5 ? B.CTRL : 0);
          E.place((rnd2() - 0.5) * 160, pick(rnd2, [sea - 30, sea, sea + 5, sea + 60]), (rnd2() - 0.5) * 120, rnd2() * 6.283, (rnd2() - 0.5) * 0.6);
          E.pre(); E.compareWorld(fail, `${label} fresh t${E.t}`); checked += 6;
          const q = compareBlocks(E.W, E.emu, `${label} fresh t${E.t}`, only); checked += q.checked; for (const f of q.failures) fail(f);
        }
      }
      notes.push(`${label}: ${N} pre-renders compared, groove levels ${JSON.stringify(seen.groove)}`);
    }
    notes.push(`${moments} comparison moments, ${loads} node loads`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
