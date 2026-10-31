// z10RGB cannon duel in the headless browser (muted): the intro / help screens, a scripted player with REAL key presses (the node side holds the keys, the page
// decides: `__zone.game.assist`) that crosses the bridge, takes one of the four cannons, aims and fires at the enemy cannons until Cedric's cannons are gone (WIN:
// banner, hi-score / trophy variables, result menu page 16, continue -> the story), plus the aiming view, the HUD gauge and a hit.
//   node tools/browse.mjs "http://localhost:5606/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB.mjs --size 1280x800 --out /tmp/m6-z10RGB
// Shortcut used (the full game is ~3 minutes of wall time with the real shots): after `SHORT` (1) real kill, the remaining enemy cannons are removed
// through the page (`NOSHORT=1` plays them all); the node tests (tools/tests/m6-z10RGB.mjs) play the whole game scripted.
const SHORT = process.env.NOSHORT ? 99 : 1;
const KEYS = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown' };
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x3b), trophy: __zone.sh.vars.get(0x23), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });

  // ---- the scripted player (decisions in the page, key presses from here)
  await page.evaluate(() => {
    const closure = { wi: 0, arrived: false, target: null, plan: null, failed: new Map(), lastBall: -1, fired: 0, events: [], prevBall: {} };
    window.__rgbBot = () => {
      const z = __zone, a = z.game.assist, st = a.state, w = z.world;
      const mode = w.vars.get(0xfb);
      const out = { hold: 0, tap: 0, mode, phase: st.phase, result: st.resultMode, tick: w.tickCount };
      // shot diary (task 9): a ball that reached its splash (state 3) = where it came down, whom it hit; the fires are noted by __rgbBotNoteFire
      st.balls.forEach((b) => { if (b.state === 3 && closure.prevBall[b.idx] !== 3) closure.events.push({ land: b.idx, hit: b.hit ? b.hit.name : null, at: [+b.rec.x.toFixed(1), +b.rec.y.toFixed(1), +b.rec.z.toFixed(1)], t: b.t }); closure.prevBall[b.idx] = b.state; });
      if (closure.events.length) { out.events = closure.events; closure.events = []; }
      if (st.resultMode) return out;
      if (mode === 1) {
        const arrive = () => { const t = a.route[a.route.length - 1]; return Math.hypot(t[0] - st.pepper.x, t[1] - st.pepper.z) < 5 && st.phase >= 3; };
        if (!closure.arrived) {
          const t = a.route[closure.wi];
          const dx = t[0] - st.pepper.x, dz = t[1] - st.pepper.z;
          if (Math.hypot(dx, dz) < 4 && closure.wi < a.route.length - 1) closure.wi++;
          if (closure.wi === a.route.length - 1 && arrive()) closure.arrived = true;
          out.hold = a.steer(dx, dz);
          // unstick (a player would): pinned for 25 polls (a corner of the fence G091) -> back off for 15 polls: Down + Left (8 | 1) = east and towards -z of the fixed camera (the bridge lane is north of the wall tip)
          const mv = closure.last ? Math.hypot(st.pepper.x - closure.last[0], st.pepper.z - closure.last[1]) : 9;
          closure.last = [st.pepper.x, st.pepper.z];
          closure.still = mv < 0.05 ? closure.still + 1 : 0;
          if (closure.still >= 25 && !closure.unstick) { closure.unstick = 15; closure.still = 0; closure.unsticks = (closure.unsticks ?? 0) + 1; out.events = [...(out.events ?? []), { unstick: closure.unsticks, at: [+st.pepper.x.toFixed(1), +st.pepper.z.toFixed(1)] }]; }
          if (closure.unstick) { closure.unstick--; out.hold = 9; }
        } else {
          let bk = -1, bd = 1e9;
          st.cannons.forEach((c, k) => { if (!(c.rec.flags & 2)) return; const d = Math.hypot(c.rec.x - st.pepper.x, c.rec.z - st.pepper.z); if (d < bd) { bd = d; bk = k; } });
          if (bk >= 0) {
            const c = st.cannons[bk].rec, dx = c.x - st.pepper.x, dz = c.z - st.pepper.z;
            if (Math.hypot(dx, dz) < 7) out.tap = 0x10; else out.hold = a.steer(dx, dz);
          }
        }
      } else if (mode === 4) {
        const c = st.cannons[st.pepperCannon];
        const ball = st.curBall >= 0 ? st.balls[st.curBall] : null;
        if (ball && ball.state !== 0) { out.waiting = true; }
        // the shot's result: a ball that is back in the pool without a kill counts as a miss of the target
        if (closure.lastBall >= 0 && st.balls[closure.lastBall].state === 0) {
          const k = closure.target;
          if (k !== null && (st.enemy[k].flags & 2)) closure.failed.set(k, (closure.failed.get(k) ?? 0) + 1);
          closure.lastBall = -1; closure.plan = null;
        }
        if (closure.target === null || !(st.enemy[closure.target].flags & 2) || !closure.plan) {
          // the nearest cannon that has not failed twice (else forget the failures)
          let best = null, bd = 1e9;
          st.enemy.forEach((e, k) => { if (!(e.flags & 2) || (closure.failed.get(k) ?? 0) >= 2) return; const d = Math.hypot(e.x - c.rec.x, e.z - c.rec.z); if (d < bd) { bd = d; best = k; } });
          if (best === null) { closure.failed.clear(); st.enemy.forEach((e, k) => { if ((e.flags & 2) && best === null) best = k; }); }
          if (best !== null) { closure.target = best; const e = st.enemy[best]; closure.plan = a.plan([e.x, e.y + 2.5, e.z]); }
        }
        if (closure.plan) {
          const k = a.aim(closure.plan);
          out.hold = k.keys; out.err = [closure.plan.rx - c.rec.rx, closure.plan.ry - c.rec.ry];
          out.onTarget = k.onTarget;
          if (k.onTarget && c.timer <= 0 && !out.waiting && w.input.held === 0) { out.tap = 0x80; closure.lastBall = -2; }
        }
      }
      return out;
    };
    window.__rgbBotNoteFire = () => { const st = __zone.game.assist.state, c = st.cannons[st.pepperCannon]; closure.lastBall = st.curBall; closure.fired++; closure.events.push({ fire: closure.fired, target: closure.target, plan: closure.plan && { rx: +closure.plan.rx.toFixed(4), ry: +closure.plan.ry.toFixed(4), land: closure.plan.land.map((v) => +v.toFixed(1)), miss: +closure.plan.miss.toFixed(2), time: +closure.plan.time.toFixed(1) }, cannon: c && { rx: +c.rec.rx.toFixed(4), ry: +c.rec.ry.toFixed(4), k: st.pepperCannon }, scale: __zone.game.assist.shotScale(), left: st.cannonsLeft }); };
    window.__rgbBotInfo = () => ({ target: closure.target, failed: [...closure.failed], fired: closure.fired });
  });

  let held = 0;
  const setHeld = async (mask) => {
    for (const [bit, code] of Object.entries(KEYS)) {
      const want = (mask & +bit) !== 0, has = (held & +bit) !== 0;
      if (want && !has) await page.keyboard.down(code);
      if (!want && has) await page.keyboard.up(code);
    }
    held = mask;
  };
  const tapKey = async (mask) => {
    const code = mask === 0x10 ? 'ControlLeft' : mask === 0x80 ? 'Space' : null;
    if (code) await page.keyboard.press(code, { delay: 70 });
  };
  /** play until `until(info)` is true or `ms` ran out; the aim keys are held for big corrections and tapped for the fine ones (one game tick each) */
  let dbgN = 0;
  const play = async (ms, until, onStep) => {
    // (`ms` is game time: 30 ticks a second; a loaded page runs fewer ticks per second of wall time, so the limit is counted in ticks, with a wall-clock ceiling of 20 minutes)
    const t0 = Date.now(), maxTicks = (ms * 30) / 1000;
    let tick0 = -1;
    while (Date.now() - t0 < 1200000) {
      const o = await page.evaluate(() => window.__rgbBot());
      if (tick0 < 0) tick0 = o.tick;
      if (o.tick - tick0 > maxTicks) break;
      if (process.env.DBG && o.mode === 4 && (++dbgN % 10 === 0)) { const d = await page.evaluate(() => { const st = __zone.game.assist.state, c = st.cannons[st.pepperCannon]; return c ? { rx: +c.rec.rx.toFixed(4), ry: +c.rec.ry.toFixed(4), timer: c.timer, ball: st.curBall >= 0 ? st.balls[st.curBall].state : -1, ticks: st.ticks, left: st.cannonsLeft } : null; }); log('dbg', JSON.stringify({ hold: o.hold, tap: o.tap, err: o.err && o.err.map((v) => +v.toFixed(4)), on: o.onTarget, wait: o.waiting }), JSON.stringify(d)); }
      if (o.events) for (const e of o.events) log('SHOT', JSON.stringify(e));
      if (until && until(o)) { await setHeld(0); return o; }
      if (onStep) await onStep(o);
      if (o.mode === 4 && o.err) {
        const fine = Math.abs(o.err[0]) < 0.012 && Math.abs(o.err[1]) < 0.012;
        if (fine && o.hold) { await setHeld(0); for (const bit of [1, 2, 4, 8]) if (o.hold & bit) await page.keyboard.press(KEYS[bit], { delay: 70 }); await wait(60); }
        else await setHeld(o.hold);
      } else await setHeld(o.hold);
      if (o.tap) { await setHeld(0); await tapKey(o.tap); if (o.tap === 0x80) { await page.evaluate(() => window.__rgbBotNoteFire()); } await wait(120); }
      else await wait(20);
      if (o.result) { await setHeld(0); return o; }
    }
    await setHeld(0);
    return null;
  };

  // ------------------------------------------------------------------ intro / help
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z10RGB' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  let s = await dbg();
  expect('the zone game runs, phase 0, score 1000, nine cannons, four lives', s && s.phase === 0 && s.score === 1000 && s.cannonsLeft === 9 && s.lives === 4, JSON.stringify(s));
  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  expect('entered at the story node of z10RGB (sub-game 9)', v0.sub === 9, JSON.stringify(v0));
  await wait(1200); await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9, 11 lines)', (await mode()) === 9);
  await shot('2-help');
  await key('Enter'); await wait(500);
  expect('play (mode 2), phase 1', (await mode()) === 2 && (await dbg()).phase === 1);
  await wait(800); await shot('3-bridge-start');
  const pace = () => page.evaluate(() => ({ dt: __zone.world.dt, tick: __zone.world.tickCount, t: performance.now(), lives: __zone.game.assist.state.lives, phase: __zone.game.assist.state.phase }));
  const p0 = await pace();
  log('START-STATE', JSON.stringify(await page.evaluate(() => ({ keysDown: [...(__zone.sh.input.down ?? [])], shellDt: __zone.sh.dt, worldDt: __zone.world.dt, frame: __zone.world.frame, shotScale: __zone.game.assist.shotScale(), det: new URLSearchParams(location.search).get('det'), webdriver: navigator.webdriver, fps: __zone.sh.fps }))));

  // ------------------------------------------------------------------ the bridge
  let n = 0;
  let stallAt = null, stallN = 0, lastPos = null;
  const r1 = await play(120000, (o) => o.phase >= 3, async (o) => {
    if (++n % 80 === 0) await shot(`4-bridge-${n / 80}`);
    // diagnostic: no progress for 60 polls while the bot asks for keys -> dump the input / camera / control state once (the first run of the z10RGB chain bot stalls on the bridge)
    if (n % 20 === 0) {
      const d = await page.evaluate(() => { const z = __zone, st = z.game.assist.state; return { x: st.pepper.x, z: st.pepper.z, ry: st.pepper.ry, y: st.pepper.y, cam: Array.from(z.world.camera.c).slice(0, 6).map((v) => +v.toFixed(1)), tick: z.world.tickCount, walk: (() => { const wk = st.pepper.ctrl?.find('SGwalk'); return wk ? { state: wk.state, speed: wk.speed, rx: wk.rampX, ry: wk.rampY, v: [wk.vx, wk.vy, wk.vz], t: wk.t, slide: wk.slideFlag } : null; })() }; });
      if (process.env.TRACE_BRIDGE || stallN >= 2) log('TRACE', JSON.stringify({ n, hold: o.hold, ...d }));
      if (lastPos && Math.hypot(d.x - lastPos.x, d.z - lastPos.z) < 0.3) stallN++; else stallN = 0;
      lastPos = d;
      if (stallN === 3 && !stallAt) {
        stallAt = n;
        log('STALL', JSON.stringify({ bot: o, heldByBot: held, state: await page.evaluate(() => { const z = __zone, w = z.world, st = z.game.assist.state; return { inputHeld: w.input.held, inputPressed: w.input.pressed, down: [...(z.sh.input.down ?? [])], cam: Array.from(w.camera.c).slice(0, 18).map((v) => +v.toFixed(3)), pepper: [st.pepper.x, st.pepper.y, st.pepper.z, st.pepper.ry], v: { fb: w.vars.get(0xfb), c5e: w.vars.get(0x5e), fa: w.vars.get(0xfa), fc: w.vars.get(0xfc) }, mode: z.machine.mode, vuln: st.vulnerable, blink: st.blink, lives: st.lives, flags: st.pepper.flags, dt: w.dt }; }) }));
      }
    }
  });
  s = await dbg();
  { const p1 = await pace(); log('PACE bridge: dt', p0.dt, '->', p1.dt, 'ticks', p1.tick - p0.tick, 'in', ((p1.t - p0.t) / 1000).toFixed(1), 's =', ((p1.tick - p0.tick) * 1000 / (p1.t - p0.t)).toFixed(1), 'ticks/s; lives', p1.lives, 'phase', p1.phase); }
  expect('crossed the bridge: phase 3 (cannons)', s.phase === 3, JSON.stringify(s));
  log('after the bridge: score', s.score, 'pepper', s.pepper.map((v) => v.toFixed(0)).join(','));
  await shot('5-after-bridge');

  // ------------------------------------------------------------------ into the cannon
  await play(120000, (o) => o.mode === 4);
  s = await dbg();
  expect('inside a cannon (mode 4), the zoom is 0.21', s.mode === 4 && s.inCannon >= 0 && Math.abs(s.fov - 0.21) < 1e-6, JSON.stringify(s));
  await wait(400); await shot('6-in-cannon');

  // ------------------------------------------------------------------ aim and fire until the cannons are gone (or the shortcut)
  let kills = 0, shotsDone = false;
  const r2 = await play(240000, (o) => o.result || o.mode === 8, async (o) => {
    const d = await dbg();
    if (!shotsDone && d.cannonsLeft <= 9 - SHORT) { shotsDone = true; await shot('7-after-kills'); }
    if (d.cannonsLeft <= 9 - SHORT && d.cannonsLeft > 0 && !process.env.NOSHORT) {
      // the shortcut: the rest of the enemy cannons disappear (the real ones are played by the node tests)
      await page.evaluate(() => { const st = __zone.game.assist.state; st.enemy.forEach((e) => { if (e.flags & 2) { e.flags &= ~2; st.cannonsLeft--; st.score += 500; } }); });
    }
    kills = 9 - d.cannonsLeft;
  });
  s = await dbg();
  log('game over:', JSON.stringify(s));
  { const p2 = await pace(); log('PACE end: dt', p2.dt, 'ticks', p2.tick - p0.tick, 'in', ((p2.t - p0.t) / 1000).toFixed(1), 's; lives', p2.lives, 'phase', p2.phase, 'shotScale', await page.evaluate(() => __zone.game.assist.shotScale?.())); }
  await wait(600);
  expect('the game ended in a win (phase 4, result 1)', s.phase === 4 && s.resultMode === 1, JSON.stringify(s));
  await wait(500);
  // (the end banner is left as soon as ANY button is held: a key of the bot still down at the end takes the loop straight to the result menu, mode 5: the original's rule; waits are for
  // the mode, not for a fixed time: a loaded page runs fewer ticks a second)
  await page.waitForFunction(() => window.__zone.machine.mode === 4 || window.__zone.machine.mode === 5, null, { timeout: 120000 }).catch(() => {});
  expect('the banner (mode 4), or the result menu (mode 5) when a key was still held', (await mode()) === 4 || (await mode()) === 5);
  await shot('8-banner');
  const v1 = await vars();
  expect('HISCORE_RGB = the score, TROPHY_RGB set', v1.hi === s.score && v1.trophy >= 1, JSON.stringify(v1));
  if ((await mode()) === 4) { await wait(1200); await key('Enter'); await wait(700); }
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('9-result-menu');
  // (an aim key of the bot that was still down when the menu opened has moved the cursor: Continue is item 1)
  for (let i = 0; i < 4 && (await menu()).item !== 1; i++) { await key((await menu()).item > 1 ? 'ArrowUp' : 'ArrowDown'); await wait(170); }
  await key('Enter'); await wait(2500);
  const v2 = await vars();
  log('after continue', JSON.stringify(v2), 'mode', await mode());
  expect('continue: left the zone (the story moved on)', await page.evaluate(() => window.__zone?.info?.archive !== 'z10RGB' || window.__zone?.machine?.exit === 2) , JSON.stringify(v2));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ALL OK');
};
