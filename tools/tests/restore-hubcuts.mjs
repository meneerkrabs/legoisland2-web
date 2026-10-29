// Restored content, feature 'hubcuts' (src/restore/features/hubcuts.ts, docs/re/restore.md): every rule-P patch of the hub cutscenes (R-A1 .. R-A6, the cosmetic R-A8 / R-A10 inactive): the unpatched compile equals the archive's .cut,
// the patched script compiles and parses, the saytext ids of the new lines appear in the expected order, every block can start (FUN_00458c15 counters), the new ids exist in the .str / as mp3 / in the speech table
// (R-A5: as orphan overlay), the hook returns the patched bytes (case-insensitive zone / script), the hub's own cutscene declaration names the same zone / script, and with the feature off nothing is patched.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { PATCHES, COSMETIC } from '../../src/restore/features/hubcuts.ts';
import { patchText } from '../../src/restore/scripts.ts';
import { compileCutscene, parseCutscene } from '../../src/formats/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { SPEECH_BASE, orphanIndex } from '../../src/restore/overlay.ts';

const ALL = RESTORE_FEATURES.map((f) => f.id);
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** FUN_00458c15: a block starts when every command that signals its id sits in a block that starts */
function deadBlocks(cut) {
  const sig = new Map();
  for (const c of cut.commands) if (c.signalId) (sig.get(c.signalId) ?? sig.set(c.signalId, []).get(c.signalId)).push(c);
  const blocks = new Set(cut.commands.map((c) => c.waitId)), reach = new Set([0]);
  for (let ch = true; ch;) { ch = false; for (const b of blocks) if (!reach.has(b)) { const q = sig.get(b); if (q && q.every((c) => reach.has(c.waitId))) { reach.add(b); ch = true; } } }
  return [...blocks].filter((b) => !reach.has(b));
}
const ids = (cut) => cut.commands.filter((c) => c.textId).map((c) => c.textId.toUpperCase());
/** what each patch must add: command delta and the new saytext ids with the id they follow */
const EXPECT = {
  'z07CSI/csi02': { delta: 6, add: ['CACSBR11'], after: 'CACSBR10', str: 'CI/Data/csi02.str' },
  'z07CSI/csi02a': { delta: 6, add: ['CACSBR11'], after: 'CACSBR07', str: 'CI/Data/csi02.str' },
  'z40OGL/ogl01': { delta: 5, add: [], str: 'OG/Data/ogl01.str' },
  'z07CSI/csi01': { delta: 1, add: ['CACSAR02'], after: 'CACSAR01', str: 'CI/Data/csi01.str' },
  'z16PYA/adv02': { delta: 6, add: ['ADCSAM05', 'ADCSAM06'], after: 'ADCSAM04', str: 'AI/Data/ADV02.str', orphan: true },
  'z07CSI/csi08': { delta: 1, add: ['CACSCS08'], after: 'CACSCS07', str: 'CI/Data/csi08.str' },
  'z07CSI/csi07': { delta: 1, add: [], str: 'CI/Data/csi07.str' },
  'z07CSI/csi09': { delta: 1, add: [], str: 'CI/Data/csi09.str' },
};

export default {
  name: 'restore-hubcuts',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const cleanup = () => { forceRestored(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; };
    const exe = new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe')));
    const speechFiles = new Set(fs.readdirSync(path.join(ctx.soundsDir, 'speech', 'Data')).map((f) => f.replace(/\.[^.]+$/, '').toUpperCase()));
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const base = readAudioTables(exe);
    const arcOf = (z) => ctx.archives.find((a) => a.name.toLowerCase() === z.toLowerCase());
    const patched = new Map();
    for (const p of [...PATCHES, ...COSMETIC]) {
      const key = `${p.zone}/${p.script}`, ex = EXPECT[key], arc = arcOf(p.zone);
      ok(!!ex && !!arc, `${key}: archive and expectation exist`);
      if (!ex || !arc) continue;
      const txt = arc.find(`cutscene/${p.script}.txt`), cutE = arc.find(`cutscene/${p.script}.cut`);
      ok(!!txt && !!cutE, `${key}: .txt and .cut in the archive`);
      const text = latin1(arc.read(txt)), shipped = arc.read(cutE);
      const baseBytes = compileCutscene(text, { splineStart: 12 });
      ok(same(baseBytes, shipped), `${key}: the unpatched compile equals the archive's .cut (baseline)`);
      const bytes = compileCutscene(patchText(text, p), { splineStart: 12 });
      const b0 = parseCutscene(shipped), cut = parseCutscene(bytes);
      patched.set(key, bytes);
      ok(cut.commands.length - b0.commands.length === ex.delta, `${key}: ${b0.commands.length} -> ${cut.commands.length} commands (+${ex.delta})`);
      ok(deadBlocks(b0).length === 0, `${key}: the original has no block that never starts`);
      ok(deadBlocks(cut).length === 0, `${key}: every block of the patched script can start (${deadBlocks(cut)})`);
      const before = ids(b0), after = ids(cut), added = after.filter((x, i) => before[i] !== x).length;
      // the new ids appear in order: the old sequence with the new ids inserted after `ex.after`
      const wanted = [...before]; if (ex.add.length) wanted.splice(wanted.indexOf(ex.after) + 1, 0, ...ex.add);
      ok(after.join() === wanted.join(), `${key}: saytext ids ${ex.add.length ? 'gain ' + ex.add.join(' + ') + ' after ' + ex.after : 'unchanged'} (${added} moved)`);
      // the new ids have a text line and an mp3
      const tb = loadMessages(messages, [ex.str]);
      for (const id of ex.add) {
        ok(ex.orphan ? !tb.has(id) : tb.has(id) && tb.text(id).length > 0, `${key}: ${id} ${ex.orphan ? 'has no .str line (overlay)' : 'is in ' + ex.str}`);
        ok(speechFiles.has(id), `${key}: ${id}.mp3 exists`);
        ok(ex.orphan ? !base.speech.includes(id) : base.speech.includes(id), `${key}: ${id} ${ex.orphan ? 'is not' : 'is'} in the speech table`);
      }
      // actors / animations of the new lines were already used in the script (no new actor appears except through the patch's own lines)
      const old = new Set(b0.commands.map((c) => c.actor.toLowerCase()));
      const newActors = [...new Set(cut.commands.map((c) => c.actor.toLowerCase()))].filter((a) => !old.has(a));
      ok(newActors.length === 0, `${key}: no actor that the original script does not use (${newActors})`);
    }

    // ---- the hook: only the active patches, only with the feature on
    cleanup();
    forceRestored(true, ALL.filter((i) => i !== 'hubcuts'));
    await loadRestore();
    for (const p of PATCHES) {
      const arc = arcOf(p.zone), got = restoreHooks.script(arc, p.zone, p.script);
      ok(!!got && same(got, patched.get(`${p.zone}/${p.script}`)), `hook: ${p.zone}/${p.script} gives the patched bytes`);
      const got2 = restoreHooks.script(arc, p.zone.toUpperCase(), p.script.toUpperCase());
      ok(!!got2 && same(got2, got), `hook: ${p.zone}/${p.script} case-insensitive`);
    }
    for (const p of COSMETIC) ok(restoreHooks.script(arcOf(p.zone), p.zone, p.script) === undefined, `hook: cosmetic ${p.script} is not active`);
    ok(restoreHooks.script(arcOf('z07CSI'), 'z07CSI', 'csi04') === undefined, 'hook: csi04 (R-A9, class C) stays unpatched');
    // R-A5: the overlay of ADV02.str gives the two clips their orphan index and the table has their names there
    const adv = loadMessages(messages, ['AI/Data/ADV02.str']);
    const ov = restoreHooks.messages('AI/Data/ADV02.str', adv);
    for (const n of ['ADCSAM05', 'ADCSAM06']) {
      ok(ov.voice(n) === orphanIndex(n) && ov.voice(n) >= SPEECH_BASE && (ov.text(n) ?? '').length > 0, `overlay: ${n} voice ${ov.voice(n)} text "${ov.text(n)}"`);
    }
    const t = readAudioTables(exe);
    ok(t.speech[orphanIndex('ADCSAM05')] === 'ADCSAM05' && t.speech[orphanIndex('ADCSAM06')] === 'ADCSAM06', 'the speech table names the two orphan clips at their indices');
    ok(ov.text('ADCSAM04') === adv.text('ADCSAM04'), 'overlay: the other lines of ADV02.str are unchanged');
    // the hub declares these scripts (emulated set-up of the node where the scene plays; csi02a is NOT declared by the emulation: see docs/re/restore.md)
    try {
      const { standaloneCtx } = await import('../lib/ctx-standalone.mjs');
      const { loadExe, sceneOf } = await import('../lib/engine-load.mjs');
      const { profileFor } = await import('../../src/game/setup.ts');
      const { hubSlotSpecs } = await import('../../src/hub/game.ts');
      await import('../../src/zones/index.ts');
      const sctx = standaloneCtx(ctx.dataRoot), pe = loadExe(ctx.dataRoot);
      const nodes = [['z07CSI', 16, 'csi01'], ['z07CSI', 19, 'csi02'], ['z07CSI', 25, 'csi08'], ['z07CSI', 25, 'csi07'], ['z07CSI', 25, 'csi09'], ['z16PYA', 36, 'adv02'], ['z40OGL', 66, 'ogl01']];
      for (const [zone, node, script] of nodes) {
        const m = new Map([[0x58, node], [2, 1]]);
        const emu = profileFor(zone, pe, sceneOf(sctx, zone), undefined, { emuVars: { get: (i) => m.get(i) ?? 0, set: (i, v) => m.set(i, v) }, archive: arcOf(zone) }).emu;
        const specs = hubSlotSpecs(emu, zone);
        ok(specs.some((s) => s.script.toLowerCase() === script && s.zone.toLowerCase() === zone.toLowerCase()), `the hub declares ${zone}/${script} at node ${node} (${specs.map((s) => s.script).join(',')})`);
      }
    } catch (e) { failures.push(`hub declaration check crashed: ${e.stack || e}`); }
    // ---- feature off: nothing patched
    cleanup(); forceRestored(true, ALL); await loadRestore();
    for (const p of PATCHES) ok(restoreHooks.script(arcOf(p.zone), p.zone, p.script) === undefined, `feature off: ${p.script} unpatched`);
    ok(restoreHooks.messages('AI/Data/ADV02.str', adv) === adv, 'feature off: ADV02.str unchanged');
    cleanup();
    notes.push(`${PATCHES.length} active patches + ${COSMETIC.length} cosmetic (inactive); csi02a is not declared by the hub (port) yet`);
    return { checked, failures, notes };
  },
};
