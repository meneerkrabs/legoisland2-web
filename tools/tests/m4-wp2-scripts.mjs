import { loadIsland } from '../lib/island-load.mjs';
import { islandEnv, islandSlots, prepareActors, newRunner } from '../lib/m4-wp2-fixture.mjs';
import { END_HEIGHT, SIDE_VEC_END } from '../../src/shell/cutscene.ts';
import { V } from '../../src/game/vars.ts';

// M4 WP2: EVERY island cutscene script of every era, run to its end by the runner (src/shell/cutscene.ts) on the real island world of the era's story node
// (2 / 7 / 30 / 52 / 61): the script ends within a bounded time, no exception / NaN, the actors' positions change only through the scripted commands (+ the
// ground snap of FUN_0045965d, y only), the game variables written are exactly the SETSWITCH values in execution order, the end-of-script rule puts the camera
// behind Pepper when she took part, the FOV / bars / PEPPER_CONTROL are restored; then each script again with Shift pressed every frame (it must end quickly).
// Run: node tools/test-formats.mjs --only m4-wp2-scripts -v

const ERAS = [2, 7, 30, 52, 61];
const MAX_TICKS = 30000;          // 1000 s
const SKIP_TICKS = 400;
const finite = (a) => { for (const v of a) if (!Number.isFinite(v)) return false; return true; };

function runOne(ctx, node, slotIndex, skip) {
  const I = loadIsland(ctx, { node });
  const env = islandEnv(ctx, I);
  const slots = islandSlots(ctx, I);
  const s = slots.slots[slotIndex];
  const added = prepareActors(I, s.script);
  const r = newRunner(env, slots);
  env.text = (id) => slots.slots.find((x) => x.slot === r.currentSlot)?.table?.text(id) ?? id;
  const w = I.world, cam = w.camera.c;
  const vars0 = Int32Array.from(w.vars.a);
  const pc0 = w.vars.get(V.PEPPER_CONTROL);
  cam.set([10, 20, 30, 11, 21, 31]);
  env.fov = 1.1;
  const res = { name: s.name, ok: true, ticks: 0, problems: [], notes: [], added };
  const fail = (m) => { res.ok = false; res.problems.push(m); };
  if (s.script.commands.length === 0) {
    r.start(s.slot);
    res.ticks = 0;
    if (r.active()) fail('an empty script is active');
    if (!r.inspect().selected) fail('an empty script must leave the slot selected (the original blocks the manager)');
    res.notes.push('empty: blocks the manager');
    return res;
  }
  if (!r.start(s.slot)) { fail('did not start'); return res; }
  const expected = new Map();            // var -> value in execution order
  const resolve = env.varIndex;
  let t = 0;
  const recs = w.records;
  try {
    while (r.active() && t < (skip ? SKIP_TICKS : MAX_TICKS)) {
      env.skip = skip;
      const before = recs.map((x) => [x.x, x.y, x.z]);
      const st0 = r.inspect().commands.map((c) => c.state);
      r.tick(); env.tickSpeech(); t++;
      const ins = r.inspect();
      const active = ins.commands.filter((c, i) => c.state !== st0[i] || st0[i] === 1);
      // SETSWITCH: the first run sets the variable (commands run in index order inside a tick)
      ins.commands.forEach((c, i) => {
        if (c.cmd === 8 && st0[i] === 0 && c.state !== 0) {
          const cmd = s.script.commands[i];
          const v = resolve(cmd.switchName);
          if (v !== null) expected.set(v, cmd.switchValue | 0);
        }
      });
      const movers = new Set(active.filter((c) => c.record && (c.cmd === 5 || c.cmd === 6)).map((c) => c.record));
      for (const k of r.carried.keys()) movers.add(k);
      recs.forEach((x, i) => {
        const b = before[i];
        if (!finite(x.m)) fail(`tick ${t}: ${x.name} matrix not finite`);
        const dxz = Math.abs(x.x - b[0]) + Math.abs(x.z - b[2]), dy = Math.abs(x.y - b[1]);
        if ((dxz > 1e-4 || dy > 1e-4) && !movers.has(x)) {
          const snapped = dxz <= 1e-4 && x.ctrl && ins.actors.includes(x);
          if (!snapped) fail(`tick ${t}: ${x.name} moved (${b.map((v) => v.toFixed(2))} -> ${[x.x, x.y, x.z].map((v) => v.toFixed(2))}) without a command`);
        }
      });
      if (!finite(cam)) fail(`tick ${t}: camera not finite`);
      if (res.problems.length > 5) break;
    }
  } catch (e) { fail(`exception at tick ${t}: ${e.stack}`); }
  res.ticks = t;
  if (r.active()) fail(`still running after ${t} ticks`);
  // variables: exactly the SETSWITCH writes (PEPPER_CONTROL's 0x100 is back)
  for (let i = 0; i < vars0.length; i++) {
    const v = w.vars.get(i);
    if (expected.has(i)) { if (v !== expected.get(i)) fail(`var ${i} = ${v}, the script set ${expected.get(i)}`); }
    else if (i !== V.PEPPER_CONTROL && v !== w.vars.get(i) /* noop */) { /* */ }
    else if (i !== V.PEPPER_CONTROL && v !== vars0[i]) fail(`var ${i} changed ${vars0[i]} -> ${v} without SETSWITCH`);
  }
  for (let i = 0; i < vars0.length; i++) if (!expected.has(i) && i !== V.PEPPER_CONTROL && w.vars.get(i) !== (vars0[i] | 0) && i !== 1 && i !== 2) fail(`var ${i} changed ${vars0[i]} -> ${w.vars.get(i)} without SETSWITCH`);
  if (w.vars.get(V.PEPPER_CONTROL) !== pc0) fail(`PEPPER_CONTROL ${w.vars.get(V.PEPPER_CONTROL)} != ${pc0}`);
  if (env.bars !== 0) fail('the bars are still on');
  if (env.fov !== 1.1) fail(`FOV ${env.fov} not restored to 1.1`);
  if (env.near !== null) fail('near plane not handed back');
  // the end-of-script rule: Pepper took part (and has her walker) -> look at her + 3.2, eye 20.4 away
  const ins = r.inspect();
  const pep = I.pepper;
  if (ins.actors.includes(pep)) {
    const lookOk = Math.abs(cam[3] - pep.x) < 1e-3 && Math.abs(cam[4] - (pep.y + END_HEIGHT)) < 1e-3 && Math.abs(cam[5] - pep.z) < 1e-3;
    const d = Math.hypot(cam[0] - cam[3], cam[1] - cam[4], cam[2] - cam[5]), want = Math.hypot(...SIDE_VEC_END);
    if (!lookOk || Math.abs(d - want) > 1e-3) fail(`end camera not behind Pepper: look ${[cam[3], cam[4], cam[5]].map((v) => v.toFixed(2))} pep ${[pep.x, pep.y, pep.z].map((v) => v.toFixed(2))} dist ${d.toFixed(2)}`);
    res.notes.push('PEPP');
  }
  const approx = [...new Set(r.log.filter((l) => !/^(start|end) /.test(l)).map((l) => l.replace(/^SETANIM (\S+) \S+:/, 'SETANIM $1:')))];
  res.notes.push(...approx);
  return res;
}

export default {
  name: 'm4-wp2-scripts',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    let total = 0, ended = 0, skipEnded = 0;
    for (const node of ERAS) {
      const I = loadIsland(ctx, { node });
      const slots = islandSlots(ctx, I);
      for (let k = 0; k < slots.slots.length; k++) {
        total++;
        const a = runOne(ctx, node, k, false);
        checked++;
        if (a.ok) ended++;
        else for (const p of a.problems.slice(0, 4)) failures.push(`node ${node} ${a.name}: ${p}`);
        const b = runOne(ctx, node, k, true);
        checked++;
        if (b.ok) skipEnded++;
        else for (const p of b.problems.slice(0, 3)) failures.push(`node ${node} ${b.name} (Shift held): ${p}`);
        notes.push(`node ${String(node).padStart(2)} ${a.name.padEnd(8)} ${a.ok ? 'ends' : 'FAILS'} ${String(a.ticks).padStart(5)} ticks (${(a.ticks / 30).toFixed(1)} s), Shift: ${String(b.ticks).padStart(3)}` +
          `${a.notes.length ? ' | ' + a.notes.join('; ') : ''}${a.added.length ? ' | fixture: ' + a.added.join(', ') : ''}`);
      }
    }
    notes.unshift(`${total} scripts: ${ended} run to their end, ${skipEnded} end with Shift held`);
    return { checked, failures, notes };
  },
};
