// Cutscene + speech QA of a zone (headless, muted by the browser flag; Web Audio really runs so the speech engine's counters are real; do NOT pass mute=1):
// every cutscene slot of the zone's runner (or the ones named in ONLY=a,b) is started in turn through the cutscene host (`ctx.cutscene.start`, the F9 / devcorner "play in the zone" route),
// the host's `tick` is wrapped so that every simulation tick is sampled (subtitle id, speech machine state, the `waiting` hold, the speech engine's line starts / ends) and a summary per script is printed
// as one `QA {...}` line: ticks, the SAYTEXT ids the script has with their clip index, which of them started audio / showed a subtitle, request -> audio lag (ms), held ticks, the runner's log
// lines, letterbox, FOV range, camera path length, screenshots (every EVERY game seconds, max MAXSHOTS per script).
//   sh tools/m4-snapshot-server.sh 5821
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5821/?zone=z02LGI&hold=1&lego3d=1" tools/steps/qa-cutscenes.mjs --size 800x600 --out /tmp/qa-cut/z02LGI-l3d1
// env: SKIPLINE=n (press Shift while a line is audible, n times: the skip key ends the current line only), FORCEMODE=n (set the loop mode before a forced start: z28HAT's outro ticks only in mode 5), LEAD=1500 (ms between `host.prefetch(slot)`, what the trigger / NPC does when Pepper walks up, and the start; 0 = cold), DEBUGSP=1 (log the speech engine's prefetch queues every 200 ms), ONLY=lgi01,lgi02 (script names), EVERY=4 (screenshot interval, game seconds), MAXSHOTS=10, TAG=prefix of the file names, SKIPAT=ticks (press Shift when the script has run that many ticks: skip test)
export default async ({ page, wait, log, shot, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__zone.ctx && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 600000 });
  const only = (process.env.ONLY ?? '').split(',').filter(Boolean).map((s) => s.toLowerCase());
  const every = Number(process.env.EVERY ?? 4), maxShots = Number(process.env.MAXSHOTS ?? 10), tag = process.env.TAG ?? '';
  const lead = Number(process.env.LEAD ?? 1500);
  const skipAt = process.env.SKIPAT ? Number(process.env.SKIPAT) : -1;
  // the sampler
  await page.evaluate(() => {
    const z = window.__zone, host = z.ctx.cutscene, run = host.runner, sp = z.sh.audio.ga.speech;
    const Q = (window.__qa = { ev: [], tk: () => z.world.tickCount / 2, cam: [], fov: [], lb: [], lastSub: null, lastWait: false, lastState: -1 });
    // zones that never set the listener (the original keeps the previous zone's pose) / that pass the player (the camera target): src/audio/listener.ts
    const LISTENER_FREE = new Set(['z01BPK', 'z03PPH', 'z04IFC', 'z17WAS', 'z21FSH']), LISTENER_TARGET = new Set(['z38PAR', 'z08BKD', 'z27TRX']);
    const t0 = host.tick.bind(host);
    host.tick = () => {
      const act = host.active();
      if (act && !Q.prevActive && Q.auto && Q.reset) { Q.reset({ natural: true, slot: run.currentSlot }); Q.auto = false; }
      Q.prevActive = act;
      // the 3D listener must be the camera eye the last loop frame ended with (AudioHost.listen(world.camera.c) at the end of each loop pass; FUN_004434d0): compare before this tick moves the camera
      if (act && !(LISTENER_FREE.has(z.info.archive))) { const l = z.sh.audio.ga.ctx.listener, c = z.world.camera.c, o = LISTENER_TARGET.has(z.info.archive) ? 3 : 0; if (l.positionX) { const d = Math.hypot(l.positionX.value - c[o], l.positionY.value - c[o + 1], l.positionZ.value + c[o + 2]); Q.lisN++; if (d > 0.01) { Q.lisBad++; if (Q.lisAt.length < 6) Q.lisAt.push(+Q.tk().toFixed(1)); } if (d > Q.lisMax) Q.lisMax = d; } }
      t0();
      const tk = Q.tk();
      const s = run.subtitle ? run.subtitle.id : null;
      if (s !== Q.lastSub) { Q.ev.push({ tk, e: 'sub', id: s, text: run.subtitle ? run.subtitle.text : null }); Q.lastSub = s; }
      if (sp.state !== Q.lastState) { Q.ev.push({ tk, e: 'state', v: sp.state }); Q.lastState = sp.state; }
      if (sp.waiting !== Q.lastWait) { Q.ev.push({ tk, e: 'wait', v: sp.waiting }); Q.lastWait = sp.waiting; }
      const c = z.world.camera.c;
      Q.cam.push([tk, +c[0].toFixed(2), +c[1].toFixed(2), +c[2].toFixed(2), +c[3].toFixed(2), +c[4].toFixed(2), +c[5].toFixed(2)]);
      Q.fov.push(+(+z.gr.fov).toFixed(3));
      Q.lb.push(z.hud.letterbox);
    };
    // every sound effect the zone starts / refreshes while the script runs (by sound id; the CSSND_* ones are the cutscene's own): calls, first tick, whether a voice really started
    Q.sfx = {};
    for (const [name, kind] of [['play2D', '2d'], ['play3D', '3d']]) {
      const sfx = z.sh.audio.ga.sfx, orig = sfx[name].bind(sfx);
      sfx[name] = (slot, ...rest) => {
        const was = slot.playing, r = orig(slot, ...rest);
        const k = `${kind}:${slot.id}:${slot.entry && slot.entry.name ? slot.entry.name : ''}`;
        const e = (Q.sfx[k] ??= { n: 0, started: 0, first: Q.tk(), nobuf: slot.buffer ? 0 : 1 });
        e.n++; if (!was && slot.playing) e.started++;
        return r;
      };
    }
    const say = sp.say.bind(sp);
    sp.say = (a, b = -1) => { const ok = say(a, b); Q.ev.push({ tk: Q.tk(), e: 'say', ok, id: sp.idOf(a), b: b >= 0 ? sp.idOf(b) : null }); return ok; };
    sp.onLineStart = (i, id) => Q.ev.push({ tk: Q.tk(), e: 'start', id, ct: +sp.ctx.currentTime.toFixed(3) });
    sp.onLineEnd = (i, id) => Q.ev.push({ tk: Q.tk(), e: 'end', id });
  });
  // EXTRA=script:AREA/Data/FILE.str,...: scripts no slot of the zone names (castle csi02a): an extra slot behind the zone's own, like the developer corner's "play in the zone"
  for (const ex of (process.env.EXTRA ?? '').split(',').filter(Boolean)) {
    const [script, strs] = ex.split(':');
    await page.evaluate(async ([script, strs]) => {
      const z = window.__zone, host = z.ctx.cutscene, run = host.runner;
      const { parseCutscene } = await import('/src/formats/cutscene.ts'), { loadMessages } = await import('/src/ui/strings.ts');
      const arc = z.ctx.archive, e = arc.find(`cutscene/${script}.cut`);
      const cut = parseCutscene(arc.read(e)), idx = run.slotCount;
      run.define(idx, script, cut);
      host.tables.set(idx, loadMessages(await z.sh.data.archive('messages'), [strs]));
      await host.loadSplines(cut);
      host.speechIds.set(idx, cut.commands.filter((c) => c.cmd === 2 && c.textId).map((c) => c.textId));
    }, [script, strs]);
  }
  const slots = await page.evaluate(() => { const r = window.__zone.ctx.cutscene.runner; return r.slots.map((s, i) => ({ i, name: s ? s.name : null, cmds: s ? s.script.commands.length : 0, say: s ? s.script.commands.filter((c) => c.cmd === 2).map((c) => c.textId) : [] })); });
  log('SLOTS ' + JSON.stringify(slots.map((s) => `${s.i}:${s.name}`)));
  const results = [];
  let natDone = process.env.NATURAL === '0';
  // the zone's own first script: sampled from its first tick (the edge in the tick wrapper resets the recorder); also while the key loop below still waits for play (mini-game zones: the intro cutscene runs in mode 1)
  const natural = async () => {
    const nat = await page.evaluate(() => { const h = window.__zone.ctx.cutscene, r = h.runner; if (!h.active()) return null; const sl = r.slots[r.currentSlot]; return { slot: r.currentSlot, name: sl?.name, say: sl ? sl.script.commands.filter((c) => c.cmd === 2).map((c) => c.textId) : [], auto: window.__qa.auto }; });
    if (!nat) return false;
    natDone = true;
    log(`NATURAL ${nat.name}`);
    await collect(nat.name, nat.slot, nat.say, { natural: true });
    return true;
  };
  const keysP = (async () => {
  // leave the intro / help: mode 2 = play
  const mode = () => page.evaluate(() => window.__zone.machine.mode).catch(() => -1);
  for (let i = 0; i < 120 && (await mode()) !== 2; i++) {
    const m = await mode();
    // (never while a script runs in mode 1: the mini-game zones' intro cutscene would be skipped / left; it is sampled as the natural script)
    if (!natDone && (await page.evaluate(() => window.__zone.ctx.cutscene.active()).catch(() => false))) { await natural(); continue; }
    if ((m === 1 || m === 9 || m === 10) && !(await page.evaluate(() => window.__zone.ctx.cutscene.active()).catch(() => false))) await key('Enter');
    await wait(600);
  }
  await wait(2500);
  })();
  // one script: wait until it ends (screenshots every EVERY game seconds), then summarise
  const collect = async (name, slotNo, say, opt = {}) => {
    const t0w = Date.now();
    let shots = 0, lastShotTk = -1e9, skipped = false, lastSkipTk = -1e9, skipLines = Number(process.env.SKIPLINE ?? 0);
    for (;;) {
      await wait(200);
      const st = await page.evaluate(() => { const z = window.__zone, Q = window.__qa, sp = z.sh.audio.ga.speech, run = z.ctx.cutscene.runner; const l = [...Q.ev].reverse().find((e) => e.e === 'start'); return { tk: Q.tk(), act: z.ctx.cutscene.active(), t0: Q.start.tk, sub: run.subtitle ? run.subtitle.id : null, state: sp.state, since: l ? Q.tk() - l.tk : 0, lid: l ? l.id : null }; }).catch(() => null);
      if (!st || !st.act) break;
      // SKIPLINE=n: press Shift n times, each while a spoken line has been audible for 25+ ticks (the skip key ends the current SAYTEXT: voice stopped, timer 0; the script goes on)
      if (skipLines > 0 && st.state === 1 && st.sub && st.since >= 25 && st.tk - lastSkipTk > 60) {
        lastSkipTk = st.tk; skipLines--;
        await page.evaluate((id) => { window.__qa.skipLog = (window.__qa.skipLog ?? []); window.__qa.skipLog.push({ tk: window.__qa.tk(), id }); }, st.sub);
        await page.keyboard.down('ShiftLeft'); await wait(120); await page.keyboard.up('ShiftLeft');
      }
      if (process.env.DEBUGSP) log('SP ' + JSON.stringify(await page.evaluate(() => { const sp = window.__zone.sh.audio.ga.speech; return { tk: window.__qa.tk(), q: sp.queue.length, bulk: sp.bulk.length, later: sp.later.length, ahead: sp.ahead.length, bufs: sp.buffers.size, raw: sp.raw.size, ahk: sp.ahead.map((x) => x.k + '@' + Math.round(performance.now() - x.at)).join(','), qk: sp.queue.slice(0, 4).join(','), pump: sp.pumping, pumpB: sp.pumpingBulk, st: sp.state, a: !!sp.a, w: sp.waiting }; })));
      if (skipAt >= 0 && !skipped && st.tk - st.t0 >= skipAt) { skipped = true; await page.keyboard.down('ShiftLeft'); await wait(120); await page.keyboard.up('ShiftLeft'); }
      if (shots < maxShots && st.tk - lastShotTk >= every * 30) { lastShotTk = st.tk; await shot(`${tag}${name}-${String(shots).padStart(2, '0')}`); shots++; }
      if (Date.now() - t0w > 420000) { log(`TIMEOUT ${name}`); break; }
    }
    await wait(400);
    const r = await page.evaluate(() => {
      const z = window.__zone, host = z.ctx.cutscene, run = host.runner, Q = window.__qa, sp = z.sh.audio.ga.speech, S = Q.start;
      const lags = sp.lags.slice(S.lag0).map((l) => ({ id: l.id, lag: l.lagMs, held: l.heldMs, ready: l.readyAtRequest }));
      const cam = Q.cam; let path = 0, maxStep = 0;
      for (let i = 1; i < cam.length; i++) { const d = Math.hypot(cam[i][1] - cam[i - 1][1], cam[i][2] - cam[i - 1][2], cam[i][3] - cam[i - 1][3]); path += d; if (d > maxStep) maxStep = d; }
      const fovs = Q.fov.length ? [Math.min(...Q.fov), Math.max(...Q.fov)] : [];
      return {
        ticks: Q.tk() - S.tk, ev: Q.ev, logNew: run.log.slice(S.logN), lags, camPath: +path.toFixed(1), camMaxStep: +maxStep.toFixed(2), fov: fovs, lb: [Q.lb[0], Q.lb[Q.lb.length - 1]], nCam: cam.length,
        stats: Object.fromEntries(Object.entries(sp.stats).map(([k, v]) => [k, v - (S.st0[k] ?? 0)])),
        missed: [...z.sh.audio.missed].filter((k) => !S.miss0.includes(k)), hostStats: z.sh.audio.stats,
        diag: (() => { const ins = run.inspect(); return ins.commands.map((c, i) => `${i}:${c.cmd}${c.actor ? ':' + c.actor : ''}${c.dead ? ':DEAD' : ''}/s${c.state}${c.record ? '' : ':norec'}`).join(' '); })(),
        skipLog: window.__qa.skipLog ?? [],
        listener: { n: Q.lisN, bad: Q.lisBad, max: +Q.lisMax.toFixed(3), at: Q.lisAt },
        sfx: Object.entries(Q.sfx).map(([k, v]) => `${k} x${v.n} start${v.started}${v.nobuf ? ' NOBUF' : ''} @${v.first - S.tk}`),
      };
    });
    const starts = r.ev.filter((e) => e.e === 'start').map((e) => e.id);
    const subs = r.ev.filter((e) => e.e === 'sub' && e.id).map((e) => e.id);
    const says = r.ev.filter((e) => e.e === 'say');
    const out = { name, slot: slotNo, wall: Math.round((Date.now() - t0w) / 100) / 10, ...r, wanted: say.filter(Boolean), nSay: says.length, say: says.map((e) => e.id + (e.ok ? '' : '!')), starts, subs, skipped, ...opt };
    results.push(out);
    log('QA ' + JSON.stringify(out));
  };
  // the zone's own first script (the island's intro runs by itself when play begins): sampled from its first tick
  await page.evaluate(() => {
    const z = window.__zone, host = z.ctx.cutscene, run = host.runner, Q = window.__qa, sp = z.sh.audio.ga.speech;
    Q.reset = (extra = {}) => { Q.skipLog = []; Q.lisAt = []; Q.lisN = 0; Q.lisBad = 0; Q.lisMax = 0; Q.sfx = {}; Q.ev.length = 0; Q.cam.length = 0; Q.fov.length = 0; Q.lb.length = 0; Q.start = { tk: Q.tk(), logN: run.log.length, st0: { ...sp.stats }, lag0: sp.lags.length, miss0: [...z.sh.audio.missed], ...extra }; };
    Q.reset();
    Q.auto = true;
  });
  await keysP;
  if (!natDone) {
    for (let i = 0; i < 40 && !(await page.evaluate(() => window.__zone.ctx.cutscene.active())); i++) await wait(250);
    await natural();
  }
  for (const s of slots) {
    if (!s.name || (only.length && !only.includes(s.name.toLowerCase()))) continue;
    // wait until no script runs (a queued / natural one), then start
    for (let i = 0; i < 400 && (await page.evaluate(() => window.__zone.ctx.cutscene.active())); i++) await wait(250);
    // the trigger / NPC that starts a script prefetches it while Pepper walks up (host.prefetch, LEAD ms ahead; LEAD=0: the cold start of a forced run)
    if (lead > 0) { await page.evaluate((slot) => window.__zone.ctx.cutscene.prefetch(slot), s.i); await wait(lead); }
    const info = await page.evaluate(([slot, fm]) => {
      const z = window.__zone, host = z.ctx.cutscene, run = host.runner, Q = window.__qa;
      if (fm) z.machine.mode = fm;      // FORCEMODE: the loop mode in which the zone ticks / draws its scripts (mini-game zones: 1 intro, 5 result)
      Q.reset({ slot });
      const ok = host.start(slot);
      const ins = run.inspect();
      return { ok, active: host.active(), queued: ins.queued, selected: ins.selected, override: run.override, running: run.running, mode: z.machine.mode };
    }, [s.i, process.env.FORCEMODE ? Number(process.env.FORCEMODE) : 0]);
    if (!info.ok) { log(`NOSTART ${s.name}: ${JSON.stringify(info)}`); results.push({ name: s.name, started: false, info }); continue; }
    if (!info.active) { log(`SKIP ${s.name}: not started (${JSON.stringify(info)})`); results.push({ name: s.name, started: false }); continue; }
    await collect(s.name, s.i, s.say);
    await wait(600);
  }
  log('DONE ' + results.length);
};
