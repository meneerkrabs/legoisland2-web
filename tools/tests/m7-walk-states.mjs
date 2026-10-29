import { createRunner, makeScript, constScript } from '../lib/m7-walk-run.mjs';
import { B } from '../../src/game/input.ts';
import { ST } from '../../src/game/walk.ts';

// M7 / WP-VERIFY: the states other nodes request through the mailbox (DAT_008ae088: knock-back 0x1a, off the board 0x1c, crash 0x23, out of the water 0x25, pizza throws 0x0b / 0x0c / 0x42, the
// run-left / run-right variants 0x3f / 0x40, a jump with a velocity handed over in DAT_009da9a8), the sub-games in which jumping is disabled (3, 0x11), the pad stick (analog speeds), the beach
// (walking into the sea without the swim node), the idle gag turn in both directions: injected into the port's state at a given tick; the original starts from the same state (sync mode),
// runs the original code and the results must be identical. (The Space branch of FUN_0042d514 is a hook of the island's pizza code, see walkHooks.space: not exercised here.)
export default {
  name: 'm7-walk-states',
  async run(ctx) {
    const R = await createRunner(ctx);
    const walkUp = (n = 80) => [...constScript([[B.UP, n]])];
    const inj = (tick, fn) => (t, w, walk, rec) => { if (t === tick) fn(w, walk, rec); };
    const S = (name, zone, dt, held, o = {}) => R.scenario({ name, zone, dt, held, ...o });
    for (const dt of [1, 0.5]) {
      S('mailbox 0x1a knock-back (no arc)', 'z03PPH', dt, walkUp(40), { inject: inj(8, (w) => { w.pep.mailbox = ST.KNOCKBACK; }) });
      S('mailbox 0x1a knock-back with an arc', 'z03PPH', dt, walkUp(60), { inject: inj(8, (w, walk, rec) => { w.pep.mailbox = ST.KNOCKBACK; walk.t = Math.fround(0.05); walk.y0 = rec.y; walk.v0 = 5; }), subgame: 0 });
      S('mailbox 0x1c off the board', 'z03PPH', dt, walkUp(50), { inject: inj(6, (w) => { w.pep.mailbox = ST.OFFBOARD; }) });
      S('mailbox 0x23 crash', 'z03PPH', dt, walkUp(50), { inject: inj(6, (w) => { w.pep.mailbox = ST.CRASH; }) });
      S('mailbox 0x25 out of the water', 'z03PPH', dt, walkUp(50), { inject: inj(6, (w) => { w.pep.mailbox = ST.OUTOFWATER; }) });
      S('mailbox 0x0b throw while walking', 'z03PPH', dt, walkUp(70), { inject: inj(12, (w) => { w.pep.mailbox = ST.THROW; }) });
      S('mailbox 0x0c hand over', 'z03PPH', dt, walkUp(70), { inject: inj(12, (w) => { w.pep.mailbox = ST.THROW2; }) });
      S('mailbox 0x42 throw while running', 'z03PPH', dt, walkUp(70), { inject: inj(14, (w) => { w.pep.mailbox = ST.THROWRUN; }) });
      S('mailbox 0x3f / 0x40 run variants', 'z03PPH', dt, walkUp(90), { inject: (t, w) => { if (t === 20) w.pep.mailbox = ST.RUNLEFT; if (t === 45) w.pep.mailbox = ST.RUNRIGHT; } });
      S('mailbox 0x1b idle while running', 'z03PPH', dt, walkUp(40), { inject: inj(10, (w) => { w.pep.mailbox = ST.IDLE; }) });
      S('jump with a velocity handed over', 'z03PPH', dt, new Array(50).fill(0), { subgame: 0, inject: inj(3, (w) => { w.pep.mailbox = ST.JUMP; w.pep.jumpVelocity = [0.5, 0, Math.fround(0.2)]; }) });
      S('idle gag turn right (state 3, dirFlag 1)', 'z03PPH', dt, new Array(30).fill(0), { inject: inj(4, (w, walk) => { w.pep.mailbox = ST.TURN; walk.dirFlag = 1; }) });
      S('idle gag turn left (state 3, dirFlag 0)', 'z03PPH', dt, new Array(30).fill(0), { inject: inj(4, (w, walk) => { w.pep.mailbox = ST.TURN; walk.dirFlag = 0; }) });
      // jumping disabled: the Alt key in sub-games 3 and 0x11, enabled in 0
      for (const sg of [3, 0x11, 0]) S(`Alt taps in sub-game 0x${sg.toString(16)}`, 'z03PPH', dt, constScript([[B.UP, 8], [B.UP | B.ALT, 1], [B.UP, 6], [B.ALT, 1], [0, 10], [B.ALT, 1], [0, 20]]), { subgame: sg });
      // the pad stick: analog deflections from the dead zone to full (speed factors 0 .. 1), directions all around, with and without the camera orbit
      S('pad stick sweep', 'z03PPH', dt, makeScript(61, 220, { dir: [[0, 1]], jump: 0 }), { inject: (t, w, walk) => { walk.padY = [-20, -34, -48, -60, -90, -127, 0, 50, 0][Math.floor(t / 25) % 9]; walk.padX = [0, 0, 20, -40, 60, -80, 0, 0, 90][Math.floor(t / 25) % 9]; } });
    }
    // sub-game 9 (the cannon duel's bridge): the original's walk node moves the camera with Pepper's velocity (FUN_0042d4b1) instead of the chase camera; the port's walk node leaves the camera to the
    // zone's own node (src/zones/z10rgb), so the camera fields are not compared here (the walk itself is: velocity, heading, ground, states)
    for (const dt of [1, 0.5]) S('sub-game 9 (camera not compared)', 'z03PPH', dt, makeScript(81, 120, { jump: 0.02 }), { subgame: 9, noCamera: true });
    // the beach: walking into the sea without the swim node (y below the sea level: the walk node keeps the feet on the sea level), the water edge, the camera over the water
    for (const dt of [1, 0.5]) S('island beach into the sea', 'z02LGI', dt, constScript([[B.UP, 70], [0, 5], [B.UP | B.LEFT, 30], [0, 5]]), { pos: [505, 3.5, -88], yaw: Math.PI / 2 });
    return { checked: R.checked, failures: R.failures, notes: R.summary() };
  },
};
