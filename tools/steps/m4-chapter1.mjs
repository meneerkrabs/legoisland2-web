// M4: a bot plays the first chapter of a NEW GAME with real key input, from the front end to the first mini-game and back:
//   front end -> Starten -> Nieuw spel -> island era 0 (opening cutscene with Infomaniac, skipped with Shift taps like a player may)
//   -> deliver the pizzas (talk to the customers with Shift: NANC first, whose delivery lets NUBB leave his toy car after ~20 s, then the 11 house customers)
//   -> node 4 Pepper's house -> node 5 the pizzeria -> node 6 the jail -> island era 1 (zone id 31): the 4 Constructopedia pages
//   -> the 4 coloured Brickbot heads (thrown pizza with Space, walk into the dazed bot) -> node 9 the Info Center door (INFC) -> Whack-A-Bot (z05WAB, the
//   mini-game bot of tools/steps/m3-z05WAB.mjs) -> continue -> back on the island (era 1, node 11)
//   node tools/browse.mjs "http://localhost:5497/?start=frontend&mute=1" tools/steps/m4-chapter1.mjs --size 1280x800 --out /tmp/m4-ch1
// Long walks are teleports (Pepper is put near the target, facing it; the keys do the actions: talk, throw, walk in, skip cutscenes, menus).
// Env: FROM=island skips the front end (URL ?zone=z02LGI&mute=1), STOP=<phase name> ends after that phase.
import { island, pathNode, teleportTo, collectHead } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot, key } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const phase = (n) => { log('--- phase', n); return process.env.STOP === n; };
  const cs = async () => { let n = 0; for (let i = 0; i < 6; i++) { n += await S.skipCutscenes(); await wait(200); if (!(await S.state())?.cs) break; } return n; };

  // ---- front end -> new game
  if (process.env.FROM !== 'island') {
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => window.__fe && window.__fe.mode === 2)) break;
      if (await page.evaluate(() => !!document.querySelector('.le2-movie'))) await key('Space');
      await wait(500);
    }
    await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
    const enter = async (idx) => { await select(idx); await press('Enter'); await wait(500); };
    await shot('ch1-00-frontend');
    await enter(1);                       // Starten
    expect('start page', (await menu()).page === 6);
    await enter(1);                       // Nieuw spel
  }
  await S.start();
  let s = await S.state();
  expect('new game: island, story node 2, zone id 2', s.arch === 'z02LGI' && s.node === 2 && s.sub === 2, JSON.stringify(s));
  await shot('ch1-01-start');

  // ---- phase intro: the opening cutscene sets S277 = 16 (node 2 -> 3)
  if (phase('intro')) return;
  const taps = await cs();
  s = await S.state();
  expect('opening cutscene done: node 3', s.node === 3 && s.s277 === 16, `${taps} taps ${JSON.stringify(s)}`);

  // ---- phase customers
  if (phase('customers')) return;
  const customers = ['NANC', 'PAPA', 'NICK', 'LICK', 'VALS', 'TBOB', 'DJAB', 'ROBB', 'CLIK', 'REDG', 'DARR', 'NUBB'];
  let tNanc = -1;
  for (const c of customers) {
    let done = false;
    // NUBB parks ~600 ticks after NANC's delivery: wait for that in game ticks (not in tries of wall time: a loaded page runs fewer ticks per second)
    if (c === 'NUBB' && tNanc >= 0) { const left = 750 - ((await S.ticks()) - tNanc); if (left > 0) await S.untilTicks(async () => false, left, 40); }
    // NUBB drives a toy car until NANC's pizza has been delivered (~600 ticks later he parks and gets out): keep trying for a while
    const tries = c === 'NUBB' ? 40 : 8;
    for (let attempt = 0; attempt < tries && !done; attempt++) {
      const b0 = (await S.state()).bricks, p0 = (await S.state()).pizzas;
      await S.teleportNear(c, 4, (attempt % 8) * 0.7); await wait(c === 'NUBB' ? 700 : 250);
      await S.tap('ShiftLeft', 100); await wait(600);
      if ((await S.state()).cs) await cs();
      const t = await S.state();
      done = c === 'NANC' ? t.pizzas < p0 : t.bricks < b0;
    }
    s = await S.state();
    if (c === 'NANC' && done) tNanc = s.tick;
    expect(`customer ${c}`, done, `bricks ${s.bricks} pizzas ${s.pizzas} phase ${s.phase}`);
  }
  await wait(800);
  s = await S.state();
  if (s.node === 3 && process.env.STRICT) expect('all 11 bricks delivered by the bot (no dev aid in the full story)', false, JSON.stringify(s));
  else if (s.node === 3) { log('NOT all bricks delivered: taking the rest (dev)'); await S.setVar(0x4f, 0); await wait(800); s = await S.state(); }
  expect('all 11 bricks: node 4', s.node === 4 && s.bricks === 0, JSON.stringify(s));
  await shot('ch1-02-house-done');

  // ---- nodes 4, 5, 6: the house, the pizzeria, the jail (trigger spots: walk into them)
  if (phase('buildings')) return;
  const walkIn = async (name, want) => {
    await S.teleportNear(name, 30, 0.3); await wait(400);
    await S.hold('ArrowUp', 2700); await wait(500);
    if ((await S.state()).cs) await cs();
    await wait(800);
    for (let i = 0; i < 6 && (await S.state()).cs; i++) await cs();
    s = await S.state();
    expect(`${name} trigger: node ${want}`, s.node === want || s.sub === 31, JSON.stringify(s));
  };
  await walkIn('PHSE', 5);
  await shot('ch1-03-node5');
  await walkIn('PIZB', 6);
  await shot('ch1-04-node6');
  await walkIn('JAIL', 7);
  // the zone changes to the era 1 island (id 31)
  await page.waitForFunction(() => window.__zone && window.__zone.info.index === 31 && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2), null, { timeout: 120000 });
  await S.start();
  s = await S.state();
  expect('era 1 island (zone id 31), node 7', s.sub === 31 && s.node === 7, JSON.stringify(s));
  await shot('ch1-05-era1');

  // ---- era 1: pages
  if (phase('pages')) return;
  await cs();
  for (const pg of ['PAG1', 'PAG2', 'PAG3', 'PAG4']) {
    const p0 = (await S.state()).pages;
    await S.teleportNear(pg, 14, 0.4); await wait(400);
    await S.hold('ArrowUp', 1700); await wait(500);
    if ((await S.state()).cs) await cs();
    s = await S.state();
    expect(`page ${pg}`, s.pages === p0 + 1, `pages ${s.pages} node ${s.node}`);
  }
  s = await S.state();
  expect('four pages: node 8', s.node === 8, JSON.stringify(s));

  // ---- era 1: the coloured bot heads
  if (phase('heads')) return;
  for (const [name, bit] of [['BBY0', 1], ['BBR0', 2], ['BBG0', 4], ['BBB0', 8]]) {      // COLORED_BOTHEADS bits: 1 yellow, 2 red, 4 green, 8 blue
    const ok = await collectHead(S, page, wait, name, bit, log);
    expect(`bot head ${name}`, ok, `heads ${(await S.state()).heads} colours ${(await S.vars([0x8e]))[0x8e]}`);
    await wait(300);
  }
  await S.until(async () => (await S.state()).node >= 9, 6000);
  await cs();
  s = await S.state();
  expect('four heads: node 9', s.node === 9, JSON.stringify(s));
  await shot('ch1-06-heads');

  // ---- node 9: the Info Center door -> Whack-A-Bot
  if (phase('door')) return;
  {
    const inf = await S.rec('INFC'), n = await pathNode(page, 267);    // the door of the Info Center: PATH node 267 (arrival place of FUN_004c2d22 for z04IFC / z05WAB)
    const dx = n[0] - inf.x, dz = n[2] - inf.z, l = Math.hypot(dx, dz);
    // the exit door writes the next zone only while Pepper is within 2.08 units of its door point AND the door is open (it opens for ~16 ticks once he is within 12 units, and
    // a walking Pepper crosses the 2.08 circle in ~5 ticks): a run that arrives a tick early or late misses it, so the walk is repeated from a different distance (a player would too)
    for (const dist of [20, 17, 23, 14, 26, 18]) {
      await teleportTo(page, n[0] + dx / l * dist, n[2] + dz / l * dist, n[0], n[2]); await wait(400);
      await S.hold('ArrowUp', 4200);
      if (await page.evaluate(() => window.__zone?.info.archive === 'z05WAB' || window.__zone?.sh.vars.get(5) === 5)) break;
      log('INFC door not reached from', dist, 'units: again');
    }
  }
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z05WAB', null, { timeout: 120000 }).catch(() => {});
  s = await page.evaluate(() => ({ arch: window.__zone?.info.archive, node: window.__zone?.sh.vars.get(0x58), mode: window.__zone?.machine.mode }));
  expect('the INFC door leads to Whack-A-Bot (node 10)', s.arch === 'z05WAB' && s.node === 10, JSON.stringify(s));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z05WAB' && window.__zone.machine.mode === 1, null, { timeout: 120000 });
  await shot('ch1-07-wab-intro');
  await key('Enter'); await page.waitForFunction(() => window.__zone.machine.mode === 9, null, { timeout: 30000 });
  await key('Enter'); await page.waitForFunction(() => window.__zone.machine.mode === 2, null, { timeout: 30000 });
  // the mini-game bot (tools/steps/m3-z05WAB.mjs): whack every bot as soon as it rises
  const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];
  for (;;) {
    // (the page function answers with an object every time it is asked: a bare hole index 0 would be falsy and make waitForFunction keep polling past the bot of hole 0)
    const r = await page.waitForFunction(() => {
      const g = window.__zone.game.debug();
      if (g.over) return { over: true };
      for (let i = 0; i < 4; i++) if ((g.state[i] === 1 || (g.state[i] === 2 && g.elapsed - g.tUp[i] < 10)) && !g.isInfo[i] && !g.whacked[i] && g.busy === 0 && g.stun === 0 && g.clip === 1) return { hole: i };
      return { hole: -1 };
    }, null, { polling: 4, timeout: 1500000 }).then((j) => j.jsonValue());   // (the clock is in game ticks: a loaded page runs fewer ticks per second, so this is a ceiling only)
    if (r.over) break;
    if (r.hole >= 0) { await page.keyboard.down(KEYS[r.hole]); await wait(40); await page.keyboard.up(KEYS[r.hole]); await wait(120); } else await wait(8);
  }
  // (the end banner (mode 4) is left as soon as ANY button is held: a whack in the last ticks takes the loop straight to the result menu, mode 5: the original's rule)
  await page.waitForFunction(() => window.__zone.machine.mode === 4 || window.__zone.machine.mode === 5, null, { timeout: 60000 }).catch(() => {});
  await wait(300);
  expect('WAB end banner (mode 4) or, with a button held at the end, the result menu (mode 5)', await page.evaluate(() => window.__zone.machine.mode === 4 || window.__zone.machine.mode === 5));
  await shot('ch1-08-wab-banner');
  if (await page.evaluate(() => window.__zone.machine.mode === 4)) { await press('Enter'); await wait(600); }
  expect('result menu (continue / retry)', (await menu()).page === 16);
  await select(0); await press('Enter');
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && (window.__zone.world.tickCount > 5 || window.__zone.machine.mode === 1), null, { timeout: 300000 });   // (the island opens in mode 1, a frozen world that waits for a button: S.start() takes it)
  await S.start();
  s = await S.state();
  expect('back on the island after WAB: node 11 (era 1)', s.arch === 'z02LGI' && s.node === 11 && s.sub === 31, JSON.stringify(s));
  await shot('ch1-09-back');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'chapter 1 passed');
  if (fail.length) process.exitCode = 1;
};
