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
    const closure = { wi: 0, arrived: false, target: null, plan: null, failed: new Map(), lastBall: -1, fired: 0 };
    window.__rgbBot = () => {
      const z = __zone, a = z.game.assist, st = a.state, w = z.world;
      const mode = w.vars.get(0xfb);
      const out = { hold: 0, tap: 0, mode, phase: st.phase, result: st.resultMode };
      if (st.resultMode) return out;
      if (mode === 1) {
        const arrive = () => { const t = a.route[a.route.length - 1]; return Math.hypot(t[0] - st.pepper.x, t[1] - st.pepper.z) < 5 && st.phase >= 3; };
        if (!closure.arrived) {
          const t = a.route[closure.wi];
          const dx = t[0] - st.pepper.x, dz = t[1] - st.pepper.z;
          if (Math.hypot(dx, dz) < 4 && closure.wi < a.route.length - 1) closure.wi++;
          if (closure.wi === a.route.length - 1 && arrive()) closure.arrived = true;
          out.hold = a.steer(dx, dz);
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
    window.__rgbBotNoteFire = () => { const st = __zone.game.assist.state; closure.lastBall = st.curBall; closure.fired++; };
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
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const o = await page.evaluate(() => window.__rgbBot());
      if (process.env.DBG && o.mode === 4 && (++dbgN % 10 === 0)) { const d = await page.evaluate(() => { const st = __zone.game.assist.state, c = st.cannons[st.pepperCannon]; return c ? { rx: +c.rec.rx.toFixed(4), ry: +c.rec.ry.toFixed(4), timer: c.timer, ball: st.curBall >= 0 ? st.balls[st.curBall].state : -1, ticks: st.ticks, left: st.cannonsLeft } : null; }); log('dbg', JSON.stringify({ hold: o.hold, tap: o.tap, err: o.err && o.err.map((v) => +v.toFixed(4)), on: o.onTarget, wait: o.waiting }), JSON.stringify(d)); }
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

  // ------------------------------------------------------------------ the bridge
  let n = 0;
  const r1 = await play(60000, (o) => o.phase >= 3, async (o) => { if (++n % 80 === 0) await shot(`4-bridge-${n / 80}`); });
  s = await dbg();
  expect('crossed the bridge: phase 3 (cannons)', s.phase === 3, JSON.stringify(s));
  log('after the bridge: score', s.score, 'pepper', s.pepper.map((v) => v.toFixed(0)).join(','));
  await shot('5-after-bridge');

  // ------------------------------------------------------------------ into the cannon
  await play(40000, (o) => o.mode === 4);
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
  await wait(600);
  expect('the game ended in a win (phase 4, result 1)', s.phase === 4 && s.resultMode === 1, JSON.stringify(s));
  await wait(500);
  expect('the banner (mode 4)', (await mode()) === 4);
  await shot('8-banner');
  const v1 = await vars();
  expect('HISCORE_RGB = the score, TROPHY_RGB set', v1.hi === s.score && v1.trophy >= 1, JSON.stringify(v1));
  await wait(1200); await key('Enter'); await wait(700);
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('9-result-menu');
  await key('Enter'); await wait(2500);
  const v2 = await vars();
  log('after continue', JSON.stringify(v2), 'mode', await mode());
  expect('continue: left the zone (the story moved on)', await page.evaluate(() => window.__zone?.info?.archive !== 'z10RGB' || window.__zone?.machine?.exit === 2) , JSON.stringify(v2));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ALL OK');
};
