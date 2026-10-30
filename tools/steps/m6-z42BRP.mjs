// z42BRP "Brickster's palace" in the browser (headless, muted): intro + controls help, the side run up the tower played by a bot (the recorded run, buttons fed to the game's input
// mapper once per tick through the keyboard path), the second help of the roof, the roof played by the look-ahead bot (three pizzas on Brickster), the end cutscene, the banner
// with the clock score, the result menu, the outro movie (skipped with a key) and the story step (straight to the island: no credits, gaps.md U2) (node 68 in the island); the pause menu in between.
//   node tools/browse.mjs "http://localhost:5612/?zone=z42BRP&mute=1" tools/steps/m6-z42BRP.mjs --size 1280x800 --out /tmp/m6-z42BRP
// Reads `window.__zone.game.debug()`.
import { PLAN1 } from '../../src/zones/z42BRP/bot-plan.ts';

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, node: z.sh.vars.get(0x58), g: z.game ? z.game.debug() : null } : null; });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };

  // ---- entry: the story's visit (node 67), intro line, the first controls help
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z42BRP' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  let s = await dbg();
  expect('z42BRP at story node 67', s.node === 67, JSON.stringify({ node: s.node, arch: s.arch }));
  await wait(600);
  await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('help screen (mode 9)', (await dbg()).mode === 9);
  await shot('2-help');
  // ---- the bot (installed before play starts: under load a late hook would miss the first ticks of the recorded run): the recorded run for the side run, the look-ahead bot on the roof; its buttons go through the input mapper's key path once per tick
  await page.evaluate(async (plan) => {
    const z = window.__zone, w = z.world, inp = z.sh.input;
    const bot = await import('/src/zones/z42BRP/bot.ts');
    const nodes = await import('/src/zones/z42BRP/nodes.ts');
    const codes = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown', 0x20: 'AltLeft', 0x80: 'Space', 0x10: 'ControlLeft' };
    const flat = [];
    for (const [m, n] of plan) for (let i = 0; i < n; i++) flat.push(m);
    const S = nodes.stateOf(w);
    const B = window.__bot = { mask: 0, plans: 0, p2: null, off: false, ms: 0 };
    const orig = inp.update.bind(inp);
    inp.update = () => {
      let mask = 0;
      if (!B.off && z.machine.mode === 2) {
        const t = w.tickCount;
        if (w.vars.get(0xfa) === 1) mask = t >= 16 ? (flat[t - 16] ?? 0) : 0;      // tick 0 = the first tick of play (the world does not tick in the intro / help modes)
        else if (S.endState === 0) {
          B.p2 ??= new bot.Phase2Bot(w, new nodes.ZoneLoop());
          const t0 = performance.now();
          mask = B.p2.step();
          B.ms += performance.now() - t0;
          B.plans = B.p2.plans;
        }
      }
      // only drive the keys while the bot plays (mode 2), and release them once when it stops: else the menu's arrow taps of the steps are wiped before they are sampled
      const driving = !B.off && z.machine.mode === 2;
      if (driving || B.drove) for (const [bit, code] of Object.entries(codes)) inp.setKey(code, (mask & +bit) !== 0);
      B.drove = driving;
      B.mask = mask;
      orig();
    };
  }, PLAN1);
  await key('Enter');
  await page.waitForFunction(() => window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 3, null, { timeout: 60000 });
  s = await dbg();
  expect('play starts: phase 1, Pepper on the tower', s.g.phase === 1 && s.g.run.hold >= 0, JSON.stringify(s.g.pepper));


  // ---- phase 1: the side run
  const shots = {};
  const t0 = Date.now();
  const tickBase = (await dbg()).tick;   // (timeouts below are game ticks, 30 a second: a loaded page runs fewer of them per second of wall time)
  let lastSeen = -1, lastSeenAt = Date.now();
  let last = null, lastTick = -1;
  for (;;) {
    s = await dbg();
    if (!s || s.arch !== 'z42BRP') { fail.push('left the zone during the side run'); break; }
    if (s.g.phase === 2 || s.mode !== 2) break;
    if (s.tick - tickBase > 9000) { fail.push('side run: timeout (9000 ticks of game time)'); break; }
    if (s.tick !== lastSeen) { lastSeen = s.tick; lastSeenAt = Date.now(); } else if (Date.now() - lastSeenAt > 90000) { fail.push('side run: the game stopped ticking (90 s of wall time)'); break; }
    const r = s.g.run;
    const y = s.g.pepper.y;
    if (!shots.a && y > 20) { shots.a = 1; await shot('3-run-up'); }
    if (!shots.b && r.sw1) { shots.b = 1; await shot('4-switch1'); }
    if (!shots.c && r.sw2) { shots.c = 1; await shot('5-switch2'); }
    if (!shots.d && r.lift) { shots.d = 1; await shot('6-lift'); }
    if (!shots.e && y > 45 && s.g.pepper.clip !== 36) { shots.e = 1; await shot('3b-jump'); }
    last = s; lastTick = s.tick;
    await wait(150);
  }
  expect('side run: both switches and the lift', last && last.g.run.sw1 && last.g.run.sw2 && last.g.run.lift, JSON.stringify(last?.g.run));
  expect('the lift ends phase 1', (await dbg()).g.phase === 2, `${lastTick} ticks`);
  // ---- phase 2: the second help (mode 10), the roof
  await page.waitForFunction(() => window.__zone.machine.mode === 10, null, { timeout: 30000 });
  await wait(300);
  await shot('7-help2');
  expect('second help (mode 10): the world stands still', await page.evaluate(() => { const w = window.__zone.world; const t = w.tickCount; return new Promise((r) => setTimeout(() => r(w.tickCount === t), 400)); }));
  await key('Enter');
  await page.waitForFunction(() => window.__zone.machine.mode === 2, null, { timeout: 30000 });
  await wait(1500);
  await shot('8-roof');
  s = await dbg();
  expect('roof: Pepper on the floor, bots marching soon', s.g.phase === 2 && s.g.pepper.y > 150, JSON.stringify(s.g.pepper));
  // pause menu in the middle (page 18), back to the game
  await key('Escape'); await wait(500);
  expect('pause menu (page 18) on the roof', (await menu()).page === 18, JSON.stringify(await menu()));
  await shot('9-pause');
  await key('Escape'); await wait(500);
  expect('back in the game', (await dbg()).mode === 2);
  for (;;) {
    s = await dbg();
    if (!s || s.arch !== 'z42BRP') break;
    if (s.mode === 4 || s.mode === 5) break;
    const g = s.g;
    if (!shots.f && g.pizza.on) { shots.f = 1; await shot('10-pizza'); }
    if (!shots.g && g.hits >= 1) { shots.g = 1; await shot('11-hit'); }
    if (!shots.h && g.cutscene) { shots.h = 1; await shot('12-cutscene-a'); await wait(2500); await shot('12-cutscene-b'); await wait(5000); await shot('12-cutscene-c'); }
    if (s.tick - tickBase > 30000) { fail.push('roof: timeout (30000 ticks of game time)'); break; }
    if (s.tick !== lastSeen) { lastSeen = s.tick; lastSeenAt = Date.now(); } else if (s.mode === 2 && Date.now() - lastSeenAt > 90000) { fail.push('roof: the game stopped ticking (90 s of wall time)'); break; }
    await wait(120);
  }
  s = await dbg();
  expect('the end banner (mode 4)', s.mode === 4, JSON.stringify({ mode: s.mode, hits: s.g?.hits, end: s.g?.endState }));
  await wait(500);
  await shot('13-banner');
  const res = await page.evaluate(() => { const z = window.__zone; return { score: z.game.debug().score, clock: z.game.debug().clock, hi: z.sh.vars.get(0x96), trophy: z.sh.vars.get(0xcf), plans: window.__bot.plans, ms: Math.round(window.__bot.ms) }; });
  log('result', JSON.stringify(res));
  expect('score 10000 - 55 per second over a minute: gold with the recorded run', res.score >= 8350 && res.trophy === 3 && res.hi === res.score, JSON.stringify(res));
  await page.evaluate(() => { window.__bot.off = true; });
  await key('Enter'); await wait(800);
  s = await dbg();
  expect('result menu (mode 5, page 16)', s.mode === 5, JSON.stringify(await menu()));
  await shot('14-results');
  await select(0); await press('Enter');
  // ---- the outro movie (any key skips it), the credits, the story step
  let sawMovie = false, sawCredits = false;
  for (let step = 0; step < 60; step++) {
    const st = await page.evaluate(() => { const z = window.__zone; return { movie: !!document.querySelector('.le2-movie'), fe: (() => { /* the front end is running only if its stage ticks: `window.__fe` stays behind after the front end of a full story (the same page played it at the start) */ const t = window.__feWorld?.tickCount ?? -1, prev = window.__feLast ?? t; window.__feLast = t; return !!(window.__fe && window.__fe.mode === 2 && !__shell.menu.engine.open && t > prev); })(), arch: z?.info.archive ?? null, node: z ? z.sh.vars.get(0x58) : -1, mode: z?.machine.mode ?? -1, ticks: z?.world.tickCount ?? 0 }; });
    if (st.movie) { if (!sawMovie) { sawMovie = true; await shot('15-outro-movie'); } await key('Space'); await wait(800); continue; }
    if (st.fe) { if (!sawCredits) { sawCredits = true; await shot('16-credits'); } await press('Enter'); await wait(1200); continue; }
    if (st.arch === 'z02LGI' && st.node >= 68 && st.mode === 2 && st.ticks > 5) break;
    await wait(700);
  }
  s = await dbg();
  expect('the outro movie played', sawMovie);
  expect('no credits after the outro (straight to the island, FUN_0081fd64)', !sawCredits);
  expect('the story went on: free roam node 68 in the island', s && s.arch === 'z02LGI' && s.node >= 68, JSON.stringify({ arch: s?.arch, node: s?.node }));
  await shot('17-island');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z42BRP win run passed');
  if (fail.length) process.exitCode = 1;
};
