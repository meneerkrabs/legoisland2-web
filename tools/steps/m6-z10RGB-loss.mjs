// z10RGB LOSS in the headless browser (muted): the scripted player (real key presses) crosses the bridge and enters a cannon, then does nothing; Cedric's shots hit
// the cannon until the four lives are gone (shortcut: the lives are set to 1 once the player sits in the cannon so that the next hit ends the game): the loss banner
// (CASGRB05), no hi-score / trophy, the result menu page 19 (retry / quit), Retry restarts the zone (second attempt, clean state), the pause menu on the way.
//   node tools/browse.mjs "http://localhost:5606/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB-loss.mjs --size 1280x800 --out /tmp/m6-z10RGB
const KEYS = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown' };
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x3b), trophy: __zone.sh.vars.get(0x23), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z10RGB' && window.__zone.machine.mode === m, m, { timeout: 300000 });

  await page.evaluate(() => {
    const closure = { wi: 0, arrived: false };
    window.__rgbWalk = () => {
      const z = __zone, a = z.game.assist, st = a.state, w = z.world;
      const mode = w.vars.get(0xfb);
      const out = { hold: 0, tap: 0, mode, phase: st.phase, result: st.resultMode };
      if (mode !== 1) return out;
      if (!closure.arrived) {
        const t = a.route[closure.wi], dx = t[0] - st.pepper.x, dz = t[1] - st.pepper.z;
        if (Math.hypot(dx, dz) < 4 && closure.wi < a.route.length - 1) closure.wi++;
        if (closure.wi === a.route.length - 1 && st.phase >= 3 && Math.hypot(a.route[closure.wi][0] - st.pepper.x, a.route[closure.wi][1] - st.pepper.z) < 5) closure.arrived = true;
        out.hold = a.steer(dx, dz);
      } else if (st.phase >= 3) {
        let bk = -1, bd = 1e9;
        st.cannons.forEach((c, k) => { if (!(c.rec.flags & 2)) return; const d = Math.hypot(c.rec.x - st.pepper.x, c.rec.z - st.pepper.z); if (d < bd) { bd = d; bk = k; } });
        if (bk >= 0) { const c = st.cannons[bk].rec, dx = c.x - st.pepper.x, dz = c.z - st.pepper.z; if (Math.hypot(dx, dz) < 7) out.tap = 0x10; else out.hold = a.steer(dx, dz); }
      }
      return out;
    };
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
  const walkUntil = async (ms, until) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const o = await page.evaluate(() => window.__rgbWalk());
      if (until(o)) { await setHeld(0); return o; }
      await setHeld(o.hold);
      if (o.tap) { await setHeld(0); await page.keyboard.press('ControlLeft', { delay: 70 }); await wait(150); } else await wait(20);
    }
    await setHeld(0);
    return null;
  };

  await ready(1);
  await wait(800);
  await key('Enter'); await wait(700); await key('Enter'); await wait(600);
  expect('play (mode 2)', (await mode()) === 2);
  expect('crossed the bridge', !!(await walkUntil(60000, (o) => o.phase >= 3 && o.mode === 1 && false || o.mode === 4)));
  let s = await dbg();
  expect('inside a cannon', s.mode === 4 && s.inCannon >= 0, JSON.stringify(s));
  // the pause menu while playing (mode 3: the clock stands still)
  await key('Escape'); await wait(900);
  const pm = await menu();
  expect('pause menu page 18 (mini-game)', (await mode()) === 3 && pm.page === 18, JSON.stringify(pm));
  const t0 = (await dbg()).ticks;
  await wait(1200);
  expect('the game stands still while paused', (await dbg()).ticks === t0, `${t0} -> ${(await dbg()).ticks}`);
  await shot('1-paused');
  await key('Escape'); await wait(900);
  expect('back in play', (await mode()) === 2);
  // one life left, then wait for the next hit (Cedric fires about every 150 ticks, a quarter of the shots hit)
  await page.evaluate(() => { __zone.game.assist.state.lives = 1; });
  await shot('2-waiting');
  let lost = false;
  for (let i = 0; i < 240 && !lost; i++) { await wait(500); const d = await dbg(); if (d.resultMode === 2) lost = true; if (i % 20 === 19) await shot(`3-wait-${i}`); }
  s = await dbg();
  expect('the game was lost (phase 5, result 2, lives 0)', s.phase === 5 && s.resultMode === 2 && s.lives === 0, JSON.stringify(s));
  await wait(800);
  expect('the banner (mode 4)', (await mode()) === 4);
  await shot('4-loss-banner');
  const v1 = await vars();
  expect('no hi-score / trophy written', v1.hi === 0 && v1.trophy === 0, JSON.stringify(v1));
  await wait(1200); await key('Enter'); await wait(700);
  const m1 = await menu();
  expect('result menu page 19 (retry / abort)', (await mode()) === 5 && m1.page === 19, JSON.stringify(m1));
  await shot('5-result-menu');
  // Retry: the first item restarts the zone
  await key('Enter'); await wait(3000);
  await ready(1);
  s = await dbg();
  expect('the zone restarted: phase 0, score 1000, nine cannons, four lives, a new state', s.phase === 0 && s.score === 1000 && s.cannonsLeft === 9 && s.lives === 4 && s.ticks === 0, JSON.stringify(s));
  await shot('6-restarted');
  // quit the second attempt from the pause menu (abort -> the hub / the story rewinds)
  await key('Enter'); await wait(600); await key('Enter'); await wait(600);
  await key('Escape'); await wait(900);
  const pm2 = await menu();
  expect('pause menu again', pm2.page === 18, JSON.stringify(pm2));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ALL OK');
};
