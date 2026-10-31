import { parseCutscene } from '../../src/formats/cutscene.ts';
import { parseCompiledWaypoints } from '../../src/formats/waypoints.ts';
import { CutsceneRunner, EasedMove, SEC_PER_TICK } from '../../src/shell/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { GameRecord } from '../../src/game/record.ts';
import { World } from '../../src/game/world.ts';
import { Controller } from '../../src/game/controller.ts';
import { GameVars } from '../../src/game/vars.ts';

// The cutscene manager (src/shell/cutscene.ts, docs/re/architecture.md 5): the scheduler (wait / signal ids, delays, 3 passes), the commands, the skip key, the end; synthetic
// scripts for the rules, the real ogl02 (z40OGL) for the shape. Run with `node tools/test-formats.mjs --only m3-cutscene`.

const cmd = (o) => ({ cmd: 0, name: '', actor: 'PEPP', waitId: 0, signalId: 0, delay: 0, duration: 0, body: new Uint8Array(0x40), trailer: [0, 0], ...o });
const script = (commands) => ({ name: 'T', version: 4, declaredCount: commands.length, commands, splineNames: [] });

function makeEnv(world, over = {}) {
  const log = [];
  let speaking = false, speakTicks = 0;
  const env = {
    world,
    waypoint: (n) => ({ A: [10, 0, 0], B: [0, 0, 20], CAMA: [100, 50, 100], CAMB: [0, 60, 0] }[n.toUpperCase()] ?? null),
    text: (id) => 'x'.repeat(+id.slice(1) || 10),
    say: (id) => { log.push(`say ${id}`); speaking = true; speakTicks = 10; return true; },
    speechIdle: () => !speaking,
    stopSpeech: () => { log.push('stop'); speaking = false; },
    setFov: (f) => log.push(`fov ${f}`),
    skipPressed: () => env.skip,
    speechOn: () => true,
    textOn: () => true,
    letterbox: (m) => log.push(`bars ${m}`),
    animClip: (a, n) => ({ WAVE: 3 }[n] ?? null),
    skip: false,
    tickSpeech() { if (speaking && --speakTicks <= 0) speaking = false; },
    ...over,
  };
  return { env, log };
}
function makeWorld() {
  const w = new World();
  const mk = (name, x = 0, y = 0, z = 0) => { const r = new GameRecord(name); r.index = w.records.length; r.setEuler(0, 0, 0, x, y, z); w.records.push(r); return r; };
  const actors = { PEPP: mk('PEPP', 1, 2, 3), BOB: mk('BOB_', 5, 0, 5), SHTL: mk('SHTL', 0, 100, 0) };
  w.camera.c.set([0, 10, -10, 0, 10, 0]);
  return { w, actors };
}
const run = (r, env, n = 3000) => { let t = 0; while (r.active() && t < n) { r.tick(); env.tickSpeech?.(); t++; } return t; };

export default {
  name: 'm3-cutscene',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    // ============================================================ scheduler rules (synthetic scripts)
    {
      const { w, actors } = makeWorld();
      const { env, log } = makeEnv(w);
      const r = new CutsceneRunner(env);
      r.allocate(2);
      // two commands in sequence through ids: A (signals 10) then B waits for 10; C is independent and has a delay of 1 s
      r.define(0, 't', script([
        cmd({ cmd: 0, name: 'SETVISIBILITY', flag: false, signalId: 10 }),
        cmd({ cmd: 5, name: 'SETPOSITION', targetKind: 'waypoint', target: 'A', waitId: 10 }),
        cmd({ cmd: 12, actor: 'CMRA', name: 'SETFOV', fov: 0.5, delay: 1 }),
      ]));
      ok(!r.active(), 'not active before start');
      ok(r.start(0) && r.active(), 'start makes it active');
      ok(log[0] === 'bars 1' && (w.vars.get(0x5e) & 0x100) === 0x100, 'the letterbox bars come on and PEPPER_CONTROL |= 0x100');
      r.tick();
      ok(!actors.PEPP.enabled && actors.PEPP.x === 1, 'tick 1: SETVISIBILITY ran (hidden), the waiting SETPOSITION did not');
      r.tick();
      ok(actors.PEPP.x === 10 && actors.PEPP.y === 0 && actors.PEPP.z === 0, 'tick 2: SETPOSITION ran once its wait id was released (waypoint A = (10, 0, 0): the whole position)');
      ok(!log.includes('fov 0.5'), 'the delayed command has not run yet');
      const t = run(r, env);
      ok(log.includes('fov 0.5') && t + 2 >= 30 && t + 2 <= 36, `a 1 s delay is 30 ticks (the script ended after ${t + 2} ticks)`);
      // the same script at the 60 Hz step (dt 0.5, the timers count `0.03333 * dt` per tick): twice the ticks; at the real sequence (dt 1 for five ticks, then 0.5) 5 + 2 * 25 ticks
      for (const [dtMode, lo, hi] of [[0.5, 60, 68], ['real', 54, 62]]) {
        const W2 = makeWorld(), E2 = makeEnv(W2.w), R2 = new CutsceneRunner(E2.env);
        R2.allocate(1);
        R2.define(0, 't', script([cmd({ cmd: 12, actor: 'CMRA', name: 'SETFOV', fov: 0.5, delay: 1 })]));
        R2.start(0);
        let n = 0;
        while (R2.active() && n < 400) { W2.w.dt = dtMode === 'real' ? (n < 5 ? 1 : 0.5) : dtMode; R2.tick(); n++; W2.w.frame++; }
        ok(E2.log.includes('fov 0.5') && n >= lo && n <= hi, `a 1 s delay at dt ${dtMode} (the script ended after ${n} ticks, want ${lo}..${hi})`);
      }
      ok(!r.active() && log.at(-1) === 'bars 0' && log.includes('fov 1') && (w.vars.get(0x5e) & 0x100) === 0, 'the end restores the FOV, removes the bars and clears the busy bit');
    }
    // a wait on an id nobody signals blocks the command for ever; the script ends when no command ran in a frame
    {
      const { w } = makeWorld();
      const { env, log } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([cmd({ cmd: 12, actor: 'CMRA', name: 'SETFOV', fov: 2 }), cmd({ cmd: 12, actor: 'CMRA', name: 'SETFOV', fov: 3, waitId: 77 })]));
      r.start(0); const t = run(r, env);
      ok(log.includes('fov 2') && !log.includes('fov 3') && t <= 3, 'a command waiting on an id that nobody signals never starts, the script still ends');
    }
    // two commands signalling the same id: the waiter starts when both are done
    {
      const { w } = makeWorld();
      const { env, log } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([
        cmd({ cmd: 12, actor: 'CMRA', fov: 1.1, signalId: 5 }), cmd({ cmd: 12, actor: 'CMRA', fov: 1.2, signalId: 5, delay: 0.5 }), cmd({ cmd: 12, actor: 'CMRA', fov: 9, waitId: 5 }),
      ]));
      r.start(0); let at = -1, t = 0;
      while (r.active() && t < 500) { r.tick(); t++; if (log.includes('fov 9') && at < 0) at = t; }
      ok(log.indexOf('fov 1.2') < log.indexOf('fov 9') && at >= 15, `the waiter starts after BOTH signalling commands finished (tick ${at}, 0.5 s delay = 15 ticks)`);
    }
    // SAYTEXT: voice, subtitle, minimum time (len + 20 + duration) / 20 seconds, the next line waits for it; Shift skips
    {
      const { w } = makeWorld();
      const { env, log } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([cmd({ cmd: 2, actor: 'SHTL', textId: 'X100', signalId: 1 }), cmd({ cmd: 2, actor: 'SHTL', textId: 'X20', waitId: 1 })]));
      r.start(0);
      r.tick(); r.tick();
      ok(log.includes('say X100') && r.subtitle?.id === 'X100' && r.subtitle.text.length === 100, 'SAYTEXT speaks the line and shows its text');
      const t = run(r, env);
      // line 1: (100 + 20) / 20 = 6 s = 180 ticks (the voice lasts 10 ticks); line 2: (20 + 20) / 20 = 2 s = 60 ticks
      ok(t >= 235 && t <= 245, `two lines last 6 s + 2 s (${t + 2} ticks, minimum times dominate the 10 tick voice)`);
      ok(log.indexOf('say X20') > log.indexOf('say X100'), 'the second line is spoken after the first');
      ok(r.subtitle === null, 'the subtitle is gone at the end');
      // skip: the key stops the voice and ends the line at once
      const { w: w2 } = makeWorld();
      const e2 = makeEnv(w2);
      const r2 = new CutsceneRunner(e2.env); r2.allocate(1);
      r2.define(0, 't', script([cmd({ cmd: 2, actor: 'SHTL', textId: 'X100' })]));
      r2.start(0); r2.tick(); r2.tick(); e2.env.skip = true; r2.tick(); r2.tick();
      ok(e2.log.includes('stop') && (!r2.active() || (r2.tick(), !r2.active())), 'Shift stops the voice and ends the line');
    }
    // speech off: the line is only shown for its minimum time; subtitles off: nothing is shown
    {
      const { w } = makeWorld();
      const { env, log } = makeEnv(w, { speechOn: () => false, textOn: () => false });
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([cmd({ cmd: 2, actor: 'SHTL', textId: 'X40' })]));
      r.start(0); r.tick();
      ok(!log.some((l) => l.startsWith('say')) && r.subtitle === null, 'speech off / subtitles off: no voice, no subtitle');
      const t = run(r, env);
      ok(t >= 85 && t <= 95, `still lasts (40 + 20) / 20 = 3 s (${t + 1} ticks)`);
    }
    // camera commands: SETPOSITION / SETTARGET of the camera, an actor as target (+3.37), SETFOV
    {
      const { w, actors } = makeWorld();
      const { env } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([
        cmd({ cmd: 5, actor: 'CMRA', targetKind: 'waypoint', target: 'CAMA' }),
        cmd({ cmd: 3, actor: 'CMRA', targetKind: 'actor', target: 'BOB_', waitId: 0, signalId: 0 }),
        cmd({ cmd: 3, actor: 'PEPP', targetKind: 'waypoint', target: 'B' }),
      ]));
      r.start(0); r.tick();
      const c = w.camera.c;
      ok(c[0] === 100 && c[1] === 50 && c[2] === 100, 'camera SETPOSITION to a waypoint');
      ok(c[3] === 5 && Math.abs(c[4] - 3.37) < 1e-6 && c[5] === 5, 'camera SETTARGET at an actor: its position + 3.37 up');
      // actor SETTARGET: yaw towards the waypoint (B = (0, 0, 20) from (1, 2, 3): dx = -1, dz = 17)
      ok(Math.abs(actors.PEPP.ry - -Math.atan2(1, 17)) < 1e-6 || Math.abs(actors.PEPP.ry - -Math.atan2(-(-1), 17)) < 1e-6, `actor SETTARGET turns the actor (ry ${actors.PEPP.ry.toFixed(4)})`);
    }
    // eased camera move: accelerates by 0.08 per tick to 0.4 per tick, slows down at the end, arrives exactly; the duration is held after arrival
    {
      const m = new EasedMove([0, 0, 0], [30, 0, 0], 0.4, 0.08);
      const p = [0, 0, 0], xs = []; let n = 0;
      while (!m.step(p) && n < 500) { n++; xs.push(p[0]); }
      ok(p[0] === 30 && p[1] === 0, 'the eased move ends exactly on the target');
      ok(Math.abs(xs[0] - 0.4 * 0.08) < 1e-6 && Math.abs(xs[1] - xs[0] - 0.4 * 0.16) < 1e-6,   // (float32 phase / unit: 0.4f * 0.08f)
          `ease in: the step grows by 0.4 * 0.08 per tick (${xs[0].toFixed(4)}, ${(xs[1] - xs[0]).toFixed(4)})`);
      const steps = xs.map((x, i) => x - (xs[i - 1] ?? 0));
      ok(Math.max(...steps) <= 0.4 * 1.08 + 1e-9, 'at most 0.4 per tick plus one ease step (the phase may overshoot 1 by 0.08)');
      ok(steps.at(-2) < steps[Math.floor(steps.length / 2)], 'slower again at the end (ease out)');
      notes.push(`eased move of 30 units: ${n + 1} ticks`);
      // through the runner: MOVEPOSITION of the camera + 1 s hold
      const { w } = makeWorld();
      const { env } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([cmd({ cmd: 6, actor: 'CMRA', targetKind: 'waypoint', target: 'CAMB', duration: 1 })]));
      w.camera.c.set([0, 10, 0, 0, 0, 0]);
      r.start(0); let t = 0, arrived = -1;
      while (r.active() && t < 800) { r.tick(); t++; if (arrived < 0 && w.camera.c[1] === 60) arrived = t; }
      ok(w.camera.c[1] === 60 && arrived > 0 && t >= arrived + 28 && t <= arrived + 33, `MOVEPOSITION arrives (tick ${arrived}) and then holds its 1 s duration (ends at ${t})`);
    }
    // SETSWITCH sets a game variable; ENABLEAI toggles the controller flag; FOLLOW does not keep the script alive; an unknown actor is a no-op; speeds
    {
      const { w, actors } = makeWorld();
      actors.BOB.ctrl = new Controller();
      const { env, log } = makeEnv(w, { varIndex: (n) => ({ SWITCH_X: 0x20 }[n] ?? null) });
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 't', script([
        cmd({ cmd: 8, actor: 'SWCH', switchName: 'SWITCH_X', switchValue: 5 }),
        cmd({ cmd: 15, actor: 'BOB_', flag: false }),
        cmd({ cmd: 7, actor: 'BOB_', other: 'PEPP' }),
        cmd({ cmd: 10, actor: 'CMRA', speedA: 6, speedB: 3 }),
        cmd({ cmd: 1, actor: 'PEPP', anim: 'WAVE', duration: 0 }),
        // an unknown actor stops the loader (FUN_0045d68a): this and later commands never run (M4: the island's lgibr07 has one)
        cmd({ cmd: 0, actor: 'NOPE', flag: false }),
        cmd({ cmd: 12, actor: 'CMRA', fov: 7 }),
      ]));
      actors.PEPP.anim = { clip: 0, frame: 0, frameCount: 6, start(c) { this.clip = c; this.frame = 0; return true; }, advance(rate, dt = 1) { this.frame += rate * dt; return 0; } };
      r.start(0); r.tick();
      ok(w.vars.get(0x20) === 5, 'SETSWITCH writes the variable');
      ok(actors.BOB.ctrl && (actors.BOB.ctrl.flags & 2) === 0, 'ENABLEAI false clears the controller bit 2');
      ok(Math.abs(r.moveSpeed.max - 0.6) < 1e-6 && Math.abs(r.moveSpeed.ease - 0.06) < 1e-6,   // float32 products: 6 * 0.1f, 3 * 0.02f
          'SETMOVESPEED a b: max 0.1 a, ease 0.02 b');
      ok(actors.PEPP.anim.clip === 3, 'SETANIM starts the clip the env maps the name to');
      const t = run(r, env);
      ok(!r.active() && t < 20, `the script ends (FOLLOW ran on but did not keep it alive, the animation finished): ${t} ticks`);
      ok(actors.BOB.ctrl.flags & 2, 'the AI of the registered actors is back on at the end');
      ok(!log.includes('fov 7'), 'the commands after an unknown actor never run');
    }
    // started from the menu (var 0xb): ignored; a second start while one runs is queued once
    {
      const { w } = makeWorld();
      const { env, log } = makeEnv(w);
      const r = new CutsceneRunner(env); r.allocate(2);
      r.define(0, 'a', script([cmd({ cmd: 12, actor: 'CMRA', fov: 1.5 })])); r.define(1, 'b', script([cmd({ cmd: 12, actor: 'CMRA', fov: 2.5 })]));
      w.vars.set(0xb, 1);
      ok(!r.start(0) && !r.active(), 'STARTEDFROMMENU != 0: FUN_0045c40c does nothing');
      w.vars.set(0xb, 0);
      r.start(0); ok(!r.start(1), 'a second start is queued'); const t = run(r, env);
      ok(log.includes('fov 1.5') && log.includes('fov 2.5') && !r.active() && log.filter((l) => l === 'bars 1').length === 2, `the queued script follows (${t} ticks, bars 1 twice, bars off at the very end)`);
    }

    // ============================================================ the real ogl02 (z40OGL) with the waypoints of z40aPO
    {
      const find = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
      const og = find('z40OGL'), apo = find('z40aPO'), msgs = find('messages');
      const cut = parseCutscene(og.read(og.find('cutscene/ogl02.cut')));
      const table = loadMessages(msgs, ['OG/Data/apo01.str']);
      const wps = ['Waypoints/W_CSM_C.wpt', 'Waypoints/W_PATH_C.wpt'].map((f) => parseCompiledWaypoints(apo.read(apo.find(f))));
      const wp = (n) => { const up = n.toUpperCase(); for (const m of wps) { const x = m.nodes.find((q) => q.name.startsWith(up)); if (x) return [x.x, x.y, x.z]; } return null; };
      const { w, actors } = makeWorld();
      actors.SHTL.name = 'SHTL';
      const { env, log } = makeEnv(w, { waypoint: wp, text: (id) => table.text(id) });
      const r = new CutsceneRunner(env); r.allocate(1);
      r.define(0, 'ogl02', cut);
      ok(cut.commands.length === 16 && cut.commands.filter((c) => c.cmd === 2).length === 8, 'ogl02: 16 commands, 8 SAYTEXT lines');
      for (const c of cut.commands) if (c.cmd === 2) ok(table.has(c.textId), `message ${c.textId} exists in apo01.str`);
      for (const n of ['PEPSHUTTLE01', 'PEPSHUTTLE02', 'NEWCAM100', 'NEWCAM200']) ok(wp(n), `waypoint ${n} resolves in the z40aPO maps`);
      r.start(0); r.tick();
      const c = w.camera.c, cam = wp('NEWCAM100'), look = wp('NEWCAM200');
      ok(Math.abs(c[0] - cam[0]) < 1e-5 && Math.abs(c[2] - cam[2]) < 1e-5 && Math.abs(c[3] - look[0]) < 1e-5, 'camera at NEWCAM100 looking at NEWCAM200');
      const pep = wp('PEPSHUTTLE01');
      ok(!actors.PEPP.enabled && Math.abs(actors.PEPP.x - pep[0]) < 1e-5 && Math.abs(actors.PEPP.y - pep[1]) < 1e-4, 'Pepper hidden at PEPSHUTTLE01');
      const said = []; let seen = '';
      let t = 1;
      while (r.active() && t < 5000) { r.tick(); env.tickSpeech(); t++; if (r.subtitle && r.subtitle.id !== seen) { seen = r.subtitle.id; said.push(seen); } }
      ok(said.join() === 'OGCSSD01,OGCSSD02,OGCSSD03,OGCSSD04,OGCSSD05,OGCSSD06,OGCSSD07,OGCSSD08', `the eight lines in order: ${said}`);
      ok(log.filter((l) => l.startsWith('fov')).join() === 'fov 1,fov 0.5,fov 1', `FOV 1 at the start, 0.5 after the second line, restored to 1 at the end (${log.filter((l) => l.startsWith('fov'))})`);
      ok(actors.PEPP.enabled, 'Pepper is visible again at the end');
      const minTicks = cut.commands.filter((x) => x.cmd === 2).reduce((s, x) => s + Math.ceil(((table.text(x.textId).length + 20) / 20) / SEC_PER_TICK), 0);
      ok(t >= minTicks - 10, `the script lasts at least the sum of the minimum times (${t} >= ${minTicks - 10} ticks = ${(t / 30).toFixed(1)} s)`);
      notes.push(`ogl02 runs ${t} ticks (${(t / 30).toFixed(1)} s) with speech finishing instantly (muted)`);
      // the same script at the 60 Hz step (dt 0.5): the timers are `0.03333 * dt` per tick, so it takes about twice the ticks and says the same lines
      {
        const { w: wd, actors: ad } = makeWorld();
        ad.SHTL.name = 'SHTL'; wd.dt = 0.5;
        const ed = makeEnv(wd, { waypoint: wp, text: (id) => table.text(id) });
        const rd = new CutsceneRunner(ed.env); rd.allocate(1); rd.define(0, 'ogl02', cut);
        rd.start(0); rd.tick();
        const saidD = []; let seenD = '', td = 1;
        while (rd.active() && td < 10000) { rd.tick(); ed.env.tickSpeech(); td++; wd.frame++; if (rd.subtitle && rd.subtitle.id !== seenD) { seenD = rd.subtitle.id; saidD.push(seenD); } }
        ok(saidD.join() === said.join(), `dt 0.5: the same eight lines in order: ${saidD}`);
        ok(td > 1.7 * t && td < 2.3 * t, `dt 0.5: about twice the ticks (${td} against ${t})`);
        notes.push(`ogl02 at dt 0.5: ${td} ticks`);
      }
      // with Shift held every line is skipped: the script is over in a handful of ticks
      const { w: w3 } = makeWorld();
      const e3 = makeEnv(w3, { waypoint: wp, text: (id) => table.text(id) });
      const r3 = new CutsceneRunner(e3.env); r3.allocate(1); r3.define(0, 'ogl02', cut);
      e3.env.skip = true; r3.start(0); const t3 = run(r3, e3.env);
      ok(!r3.active() && t3 < 25, `holding Shift ends ogl02 within ${t3} ticks`);
    }
    return { checked, failures, notes };
  },
};
