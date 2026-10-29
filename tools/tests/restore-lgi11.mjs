// Restored feature 'lgi11' (src/restore/features/lgi11.ts; docs/re/restore.md): the LGI09 line LECSBK24 (rule P) and the LGI11 -> LGI12 chain at the police station (node 57, POLB).
// Option off: the unpatched scripts, slot 8 alone. Option on: lgi09 gets LECSBK24 after LECSBK23, StartCSM POLB starts slot 7 then 8 (speech ids 731-733 then 734-739), S277 == 7 afterwards.
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { compileCutscene, parseCutscene } from '../../src/formats/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { loadIsland, tick } from '../lib/island-load.mjs';
import { waypoints as WP } from '../../src/game/walker.ts';
import { resetLgi11 } from '../../src/restore/features/lgi11.ts';

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const only = RESTORE_FEATURES.map((f) => f.id).filter((f) => f !== 'lgi11');   // the other restored features are off in this test
const clear = () => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; resetLgi11(); };

/** a mock of the cutscene manager with the original's one-deep queue (FUN_00458d15); `inspect` is only there when `withQueue` */
function manager(len, withQueue) {
  const m = { running: -1, left: 0, queued: -1, started: [], len };
  m.active = () => m.running >= 0;
  m.start = (slot) => {
    if (m.running >= 0) { if (m.queued < 0) m.queued = slot; return false; }
    m.running = slot; m.left = len; m.started.push(slot); return true;
  };
  m.step = () => {
    if (m.running < 0) return;
    if (--m.left > 0) return;
    m.running = -1;
    if (m.queued >= 0) { const q = m.queued; m.queued = -1; m.running = q; m.left = len; m.started.push(q); }
  };
  if (withQueue) m.inspect = () => ({ queued: m.queued });
  return m;
}

export default {
  name: 'restore-lgi11',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const zarc = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const cmds = (bytes) => parseCutscene(bytes).commands;
    const saytexts = (bytes) => cmds(bytes).filter((c) => c.cmd === 2);

    // ---- option off: nothing changes
    forceRestored(null); clear();
    ok(restoreHooks.script === undefined && restoreHooks.startCutscene === undefined, 'option off: hooks unset');
    const rawCut = (n) => zarc.read(zarc.find(`cutscene/${n}.cut`));
    const txt09 = latin1(zarc.read(zarc.find('cutscene/lgi09.txt')));
    ok(compileCutscene(txt09, { splineStart: 12 }).length === rawCut('lgi09').length, 'lgi09.txt compiles to the archive .cut (size)');
    const base09 = saytexts(rawCut('lgi09')).map((c) => c.textId);
    ok(!base09.includes('LECSBK24'), 'option off: lgi09 has no LECSBK24');

    // ---- option on: the patched script
    forceRestored(true, only);
    ok(await loadRestore(), 'option on: restore installed');
    const patched = restoreHooks.script(zarc, 'z02LGI', 'lgi09');
    ok(patched instanceof Uint8Array, 'lgi09 patch applies (the unpatched text compiles to the archive .cut)');
    if (patched) {
      const sy = saytexts(patched);
      const ids = sy.map((c) => c.textId);
      const i23 = ids.indexOf('LECSBK23'), i24 = ids.indexOf('LECSBK24');
      ok(i24 === i23 + 1 && i24 > 0, `lgi09: LECSBK24 follows LECSBK23 (${ids.slice(i23 - 1, i24 + 2)})`);
      ok(ids.length === base09.length + 1 && ids.filter((x) => x !== 'LECSBK24').join() === base09.join(), 'lgi09: exactly one saytext added, the rest in order');
      ok(sy[i24].actor === 'PEPP' && sy[i23].signalId === sy[i24].waitId && sy[i24].signalId === 350, `lgi09: 330 -> 340 -> 350 chain (signal ${sy[i23].signalId} wait ${sy[i24].waitId} -> ${sy[i24].signalId})`);
      const t = loadMessages(messages, ['LI/Data/LGI09.str']);
      ok(t.has?.('LECSBK24') ?? t.text('LECSBK24') !== undefined, 'LGI09.str has LECSBK24');
      notes.push(`lgi09: ${base09.length} -> ${ids.length} saytexts, LECSBK24 "${t.text('LECSBK24')}" (voice ${t.voice('LECSBK24')})`);
    }
    // the other scripts stay alone
    ok(restoreHooks.script(zarc, 'z02LGI', 'lgi11') === undefined && restoreHooks.script(zarc, 'z02LGI', 'lgi12') === undefined, 'lgi11 / lgi12 are not patched');

    // ---- the speech ids of the two scenes
    const vo = (file, script) => { const t = loadMessages(messages, [file]); return saytexts(rawCut(script)).map((c) => t.voice(c.textId)); };
    ok(vo('LI/Data/LGI11.str', 'lgi11').join() === '731,732,733', `LGI11 speech ids ${vo('LI/Data/LGI11.str', 'lgi11')}`);
    ok(vo('LI/Data/LGI12.str', 'lgi12').join() === '734,735,736,737,738,739', `LGI12 speech ids ${vo('LI/Data/LGI12.str', 'lgi12')}`);

    // ---- the chain on the mock manager (with and without the manager's queue), era 3
    for (const withQueue of [true, false]) {
      clear(); forceRestored(true, only); await loadRestore();
      const mgr = manager(20, withQueue);
      const game = { ictx: { era: 3 }, ctx: { cutscene: mgr } };
      restoreHooks.islandStart(game);
      const start = (s) => mgr.start(s);
      ok(restoreHooks.startCutscene(8, start) === true && mgr.started[0] === 7, `chain (${withQueue ? 'queue' : 'tick'}): slot 8 starts slot 7 first`);
      ok(restoreHooks.cutsceneActive(false) === !withQueue, `chain (${withQueue ? 'queue' : 'tick'}): pending flag ${restoreHooks.cutsceneActive(false)}`);
      let gap = 0;
      for (let t = 0; t < 80; t++) { mgr.step(); restoreHooks.islandTick(game); if (t > 2 && t < 38 && !mgr.active() && !restoreHooks.cutsceneActive(false)) gap++; }
      ok(mgr.started.join() === '7,8', `chain (${withQueue ? 'queue' : 'tick'}): started ${mgr.started}`);
      ok(gap === 0 && !restoreHooks.cutsceneActive(false), `chain (${withQueue ? 'queue' : 'tick'}): no idle gap between the scenes (${gap}), nothing pending at the end`);
      // other slots and other eras pass through
      ok(restoreHooks.startCutscene(5, start) === undefined, 'slot 5 passes through');
      game.ictx.era = 2;
      ok(restoreHooks.startCutscene(8, start) === undefined, 'era 2: slot 8 passes through');
    }

    // ---- the real StartCSM of POLB (node 57) with the hooks wired into the mock context
    for (const on of [false, true]) {
      clear(); forceRestored(on, only); if (on) await loadRestore();
      const I = loadIsland(ctx, { node: 57, vars: { 0x54: 4, 0x115: 0xc, 0x26: 15, 0x8e: 15 } });
      const mgr = manager(25, false);
      const game = { ictx: { era: 3 }, ctx: { cutscene: mgr } };
      I.ictx.startCutscene = function (slot) { const s = (x) => { this.cutscenes.push({ slot: x, tick: I.world.tickCount }); return mgr.start(x); }; return restoreHooks.startCutscene?.(slot, s) ?? s(slot); };
      I.ictx.cutsceneActive = () => (restoreHooks.cutsceneActive ? restoreHooks.cutsceneActive(mgr.active()) : mgr.active());
      restoreHooks.islandStart?.(game);
      tick(I, 2);
      const n = I.rec('POLB').ctrl.nodes.find((x) => x.kind === 'StartCSM' && x.value === 57);
      const q = WP.nodePos(n.a.map, n.a.waypoints[0]);
      I.pepper.x = q[0]; I.pepper.y = q[1]; I.pepper.z = q[2]; I.pepper.savePrev();
      for (let t = 0; t < 120; t++) { tick(I, 1); mgr.step(); restoreHooks.islandTick?.(game); }
      const slots = I.ictx.cutscenes.map((c) => c.slot);
      if (!on) ok(slots.join() === '8' && I.vars.get(0x115) === 7, `option off: POLB starts slot 8 alone (${slots}), S277 ${I.vars.get(0x115)}`);
      else ok(mgr.started.join() === '7,8' && I.vars.get(0x115) === 7, `option on: POLB -> ${mgr.started} (asked ${slots}), S277 == ${I.vars.get(0x115)}`);
    }
    clear(); forceRestored(null);
    return { checked, failures, notes };
  },
};
