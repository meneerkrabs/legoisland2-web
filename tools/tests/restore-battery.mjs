// Restored content, feature 'battery' (docs/re/restore.md): the radio battery side quest at story node 56.
// Option off: nothing changes (the BTB records stay hidden, no controller, var 22 / 225 / the radio untouched). Option on (the feature's nodes attached like the set-up replay attaches):
// ten records visible with y - terrain in [1.5, 1.9]; pickup raises var 22 by CELLS and sets the bit in var 225 and plays the pickup sound; the level drains only while a bot dances
// (ambient.botDance); var 0x22 follows the level; the HUD gauge follows var 22 (only during the quest); the patched lgi10 compiles and carries LECSRS06-08 + dj_throw; a save keeps level + mask.
import { loadIsland, tick } from '../lib/island-load.mjs';
import { restoreHooks, forceRestored } from '../../src/restore/flag.ts';
import { patchedCut } from '../../src/restore/scripts.ts';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { RF_ENABLED } from '../../src/game/record.ts';
import { islandEnv, islandSlots, prepareActors, newRunner } from '../lib/m4-wp2-fixture.mjs';
import { Hud } from '../../src/shell/hud.ts';
import { newSaveFromGame, encodeSave, decodeSave, captureVars, applySaveVars } from '../../src/shell/save.ts';
import { GameVars } from '../../src/game/vars.ts';

export default {
  name: 'restore-battery',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const B = await import('../../src/restore/features/battery.ts');
    forceRestored(null);
    ok(Object.values(restoreHooks).every((v) => v === undefined), 'option off: no hook set');

    // ---- option off: the game is the original
    {
      const I = loadIsland(ctx, { node: 56 });
      tick(I, 120);
      const recs = B.batteryRecords(I.world);
      ok(recs.length === 10 && recs.map((r) => r.index).join() === '295,296,297,298,299,300,301,302,303,304', 'ten BTB records = 295..304');
      ok(recs.every((r) => (r.flags & RF_ENABLED) === 0 && !r.ctrl), 'off: the batteries stay hidden and have no controller');
      ok(I.vars.get(22) === 0 && I.vars.get(225) === 0, 'off: var 22 / 225 untouched');
      ok(I.vars.get(0x22) === 1, 'off: the radio is on in node 56 (GETO)');
    }

    // ---- on: placement
    const I = loadIsland(ctx, { node: 56 });
    const w = I.world;
    ok(B.attachBatteries(w) === 10 && B.attachBatteries(w) === 10, 'attach: ten records, idempotent');
    ok(w.records[295].ctrl.nodes.map((n) => n.kind).join() === 'RestoreRadioPower,RestoreBattery' && w.records[296].ctrl.nodes.length === 1, 'BTB0 carries the radio power + its battery node, the others one node');
    tick(I, 2);
    const recs = B.batteryRecords(w);
    ok(recs.every((r) => (r.flags & RF_ENABLED) !== 0), 'node 56: all ten batteries visible');
    let worst = 'ok';
    for (const r of recs) {
      const t = w.col.terrainHeight(r.x, 300, r.z, 0), d = r.y - t;
      // the bob is on top of the resting height 1.5 .. 1.9 above the terrain (docs/re/restore-plan.md section 3 point 2)
      const base = r.ctrl.nodes.find((n) => n.kind === 'RestoreBattery').baseY - t;
      if (!(base >= 1.5 && base <= 1.9)) worst = `${r.name} rests ${base.toFixed(2)} above the terrain`;
      if (Math.abs(d - base) > B.BOB + 1e-3) worst = `${r.name} bob ${d.toFixed(2)} vs ${base.toFixed(2)}`;
    }
    ok(worst === 'ok', `battery heights: ${worst}`);
    const ry0 = recs[3].ry; tick(I, 10);
    ok(recs[3].ry !== ry0, 'a battery spins');
    ok(I.vars.get(0x22) === 0, 'level 0: the radio is off (var 0x22 = 0)');

    // ---- pickup (Pepper moved next to BTB0)
    const P = I.pepper;
    const b0 = w.records[295];
    P.x = b0.x + 1; P.z = b0.z; P.y = b0.y - 1.7; P.savePrev();
    tick(I, 2);
    ok(I.vars.get(22) === B.CELLS, `pickup: level ${I.vars.get(22)} = CELLS ${B.CELLS}`);
    ok((I.vars.get(225) & 1) === 1 && (I.vars.get(225) & 0x3fe) === 0, `pickup: mask bit 0 set (${I.vars.get(225)})`);
    ok((b0.flags & RF_ENABLED) === 0, 'pickup: the battery disappears');
    ok(I.ictx.sounds.some((s) => s.id === B.PICKUP_SOUND), 'pickup: the sound plays');
    tick(I, 2);
    ok(I.vars.get(0x22) === 1, 'level > 0: the radio is on (var 0x22 = 1)');
    // a far battery is not picked up, a taken one never comes back
    P.x = 5000; P.z = 5000; P.savePrev(); tick(I, 20);
    ok(I.vars.get(22) === B.CELLS && (b0.flags & RF_ENABLED) === 0, 'away: nothing more picked up; BTB0 stays gone');
    // full radio: the battery stays on the ground
    I.vars.set(22, B.MAX_CELLS);
    const b1 = w.records[296];
    P.x = b1.x + 1; P.z = b1.z; P.y = b1.y - 1.7; P.savePrev(); tick(I, 3);
    ok(I.vars.get(22) === B.MAX_CELLS && (I.vars.get(225) & 2) === 0 && (b1.flags & RF_ENABLED) !== 0, 'full radio: the battery is left on the ground');
    P.x = 5000; P.z = 5000; P.savePrev();

    // ---- drain only while the bots dance
    I.vars.set(22, 3);
    tick(I, B.DRAIN_TICKS + 100);   // Pepper is far from every bot: nothing dances
    ok(I.vars.get(22) === 3, `no dance, no drain (level ${I.vars.get(22)} after ${B.DRAIN_TICKS + 100} ticks)`);
    const bot = w.records.find((r) => r.name === 'BBT0');
    P.x = bot.x + 3; P.z = bot.z; P.y = bot.y; P.savePrev();
    let danced = 0, lost = -1;
    for (let i = 1; i <= 3 * B.DRAIN_TICKS + 50 && lost < 0; i++) { tick(I, 1); if ((I.vars.get(161) & 0x4000000) !== 0) danced++; if (I.vars.get(22) < 3) lost = i; }
    ok(danced > 0, 'Pepper next to a bot: it dances');
    ok(lost > 0 && lost >= B.DRAIN_TICKS - 5 && lost <= B.DRAIN_TICKS + 30, `dancing: a cell goes after about DRAIN_TICKS ticks (${lost})`);
    // run the radio empty: level 0 -> off, the bots stop
    I.vars.set(22, 1);
    for (let i = 0; i < B.DRAIN_TICKS + 20; i++) tick(I, 1);
    ok(I.vars.get(22) === 0 && I.vars.get(0x22) === 0, `drained: level ${I.vars.get(22)}, radio ${I.vars.get(0x22)}`);
    tick(I, 120);
    ok(I.vars.get(22) === 0, 'level stays 0 (no negative levels)');

    // ---- other story nodes: the quest is over, batteries hidden again, the radio left to the original
    I.vars.set(0x58, 57); tick(I, 3);
    ok(recs.every((r) => (r.flags & RF_ENABLED) === 0), 'node 57: batteries hidden again');
    ok(I.vars.get(0x22) === 1, 'node 57: GETO owns var 0x22 again (1)');

    // ---- the HUD gauge
    const hud = new Hud(null);
    const vars = I.vars; vars.set(0x58, 56);
    vars.set(22, 0); B.updateGauge(w, hud);
    ok(hud.gauge && hud.gauge.value === 0 && hud.gauge.max === 12 && hud.gauge.segments.length === 12 && hud.gauge.segments[0] === 9 && hud.gauge.segments[4] === 11 && hud.gauge.segments[8] === 10, 'gauge: 12 cells red / yellow / green, level 0');
    vars.set(22, 6); B.updateGauge(w, hud); B.updateGauge(w, hud);
    ok(hud.gauge.value === 6 && hud.extras.length === 1, 'gauge follows var 22, one extras callback');
    vars.set(0x58, 57); B.updateGauge(w, hud);
    ok(hud.gauge === null, 'gauge off after the quest');

    // ---- the patched script
    const arc = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    const cut = patchedCut(arc, [B.LGI10_PATCH]);
    ok(!!cut, 'lgi10 patch compiles (the unpatched text reproduces the .cut)');
    if (cut) {
      const orig = parseCutscene(arc.read(arc.find('cutscene/lgi10.cut'))), pat = parseCutscene(cut);
      const say = (c) => c.commands.filter((x) => x.textId).map((x) => x.textId);
      ok(say(orig).join() === 'LECSRS01,LECSRS02,LECSRS03,LECSRS04,LECSRS05', `original says ${say(orig)}`);
      ok(say(pat).join() === 'LECSRS01,LECSRS02,LECSRS03,LECSRS04,LECSRS05,LECSRS06,LECSRS07,LECSRS08', `patched says ${say(pat)}`);
      const l5 = pat.commands.find((x) => x.textId === 'LECSRS05'), l6 = pat.commands.find((x) => x.textId === 'LECSRS06');
      ok(l5.signalId === 50 && l6.waitId === 50 && l6.signalId === 60, 'LECSRS05 signals 50, LECSRS06 waits for it');
      ok(pat.commands.some((x) => x.anim === 'dj_throw' || x.anim?.toLowerCase() === 'dj_throw') && pat.commands.length === orig.commands.length + 9, `dj_throw present, +9 commands (${pat.commands.length - orig.commands.length})`);
      ok(I.ictx.animClip('DJ_THROW') !== undefined || I.ictx.setup.dictionaries.anims.has('DJ_THROW'), 'dj_throw is in the island animation dictionary');
    }

    // ---- the patched scene run by the cutscene runner on the node-55 island: it ends, DJ says LECSRS06-08, `dj_throw` (clip 274) is looked up and started on DJAB
    if (cut) {
      const J = loadIsland(ctx, { node: 55 });
      const env = islandEnv(ctx, J), slots = islandSlots(ctx, J);
      const sl = slots.slots.find((x) => x.name.toLowerCase() === 'lgi10');
      ok(!!sl, 'lgi10 is a slot of the island set-up');
      if (sl) {
        sl.script = parseCutscene(cut);
        const asked = [];
        const lookup = env.animClip; env.animClip = (a, n) => { const c = lookup(a, n); asked.push([a?.name, n, c]); return c; };
        prepareActors(J, sl.script);
        env.text = (id) => sl.table?.text(id) ?? id;
        const r = newRunner(env, slots);
        ok(r.start(sl.slot), 'the patched lgi10 starts');
        let t = 0; while (r.active() && t < 6000) { r.tick(); env.tickSpeech(); t++; }
        const said = env.log.filter((l) => l.startsWith('say ')).map((l) => l.slice(4));
        ok(!r.active() && said.join() === 'LECSRS01,LECSRS02,LECSRS03,LECSRS04,LECSRS05,LECSRS06,LECSRS07,LECSRS08', `the runner plays all eight lines in order and ends (${t} ticks): ${said}`);
        ok(asked.some((a) => a[0]?.startsWith('DJAB') && /dj_throw/i.test(a[1]) && a[2] === 274), `dj_throw resolves to clip 274 on DJAB (${JSON.stringify(asked.filter((a) => /throw/i.test(a[1])))})`);
        ok(!r.log.some((l) => /no animation instance/.test(l) && /DJAB/.test(l)), 'DJAB has an animation instance for the throw');
        notes.push(`patched lgi10 runs ${t} ticks`);
      }
    }

    // ---- saves keep level + mask
    const v = new GameVars(); v.a.set(I.vars.a); v.set(22, 7); v.set(225, 0x15);
    const s = encodeSave({ ...newSaveFromGame({ vars: v.a, subgame: 2, fsmState: 56 }) });
    const back = new GameVars(); applySaveVars(decodeSave(s), back);
    ok(back.get(22) === 7 && back.get(225) === 0x15, 'save round trip keeps var 22 and var 225');
    ok(captureVars(v).length === 304, 'captureVars covers 22 and 225');

    notes.push(`CELLS ${B.CELLS}, DRAIN_TICKS ${B.DRAIN_TICKS}, first cell lost after ${lost} dance ticks`);
    return { checked, failures, notes };
  },
};
