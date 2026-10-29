// M4 WP8: the island zone game (src/zones/z02LGI) in the browser:
//   node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=2&mute=1&debug=1" tools/steps/m4-island.mjs --size 1280x800 --out /tmp/m4-wp8
// Checks: the emulated set-up ran (the island's attaches, the context), mode 1 waits for a button with the world frozen, the story handler's set-up call
// selected the node's message tables and objective, the HUD counters, Pepper walks, no console errors; then the story advances 2 -> 3 -> 4 (the node
// conditions are completed through the F9 dev aid) and the handler's "just advanced" actions of node 4 run.
export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const st = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const p = z.loaded.pepper;
    return { arch: z.info.archive, id: z.info.index, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), node: z.sh.vars.get(0x58),
      ctrl: z.sh.vars.get(0x5e), hud: { l: z.hud.leftText, r: z.hud.rightText, c: z.hud.centreText, lt: z.hud.left.tex, rt: z.hud.right.tex }, dbg: z.game?.debug?.() ?? null };
  });
  const until = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; };
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  let s = await st();
  expect('island zone game at node 2 (zone id 2, era 0)', s.arch === 'z02LGI' && s.id === 2 && s.node === 2 && s.dbg?.era === 0, JSON.stringify({ ...s, dbg: undefined }));
  expect('emulated set-up: hundreds of attaches', (s.dbg?.attaches ?? 0) > 200, `${s.dbg?.attaches} attaches, ${s.dbg?.skipped} not ported yet`);
  expect('set-up story call: lifsm1 / lihol1, no objective', s.dbg?.texts.npc === 'li/Data/lifsm1.str' && s.dbg?.texts.hol === 'li/Data/lihol1.str' && s.dbg?.objective.mode === 0, JSON.stringify(s.dbg?.texts));
  expect('arrival at the skate park (PATH node 246)', s.dbg?.arrival && Math.abs(s.dbg.arrival.pos[0] - 153.8) < 0.1, JSON.stringify(s.dbg?.arrival));
  const t1 = s.tick;
  await wait(1500);
  s = await st();
  expect('mode 1: the world waits for a button', s.mode === 1 && s.tick === t1, `tick ${t1} -> ${s.tick}`);
  await shot('island-1-wait');
  await page.keyboard.press('ArrowLeft', { delay: 70 });
  expect('a direction key starts play', await until(async () => (await st()).mode === 2, 5000));
  await wait(1000);
  s = await st();
  expect('HUD: pizzas 0/11, bricks 0/11, icons 2 / 7, hi-score text', s.hud.l === '0/11' && s.hud.r === '0/11' && s.hud.lt === 2 && s.hud.rt === 7 && /^\d{4}$/.test(s.hud.c), JSON.stringify(s.hud));
  await shot('island-2-play');
  // the new game's first cutscene (a StartCSM trigger starts it): skip it with Shift like a player would (the runner's skip key)
  const cut = async () => (await st()).dbg?.cutscene;
  log('cutscene at start:', await cut());
  for (let i = 0; i < 40 && await cut(); i++) { await page.keyboard.press('ShiftLeft', { delay: 70 }); await wait(500); }
  expect('no cutscene running after skipping', !(await cut()));
  await wait(500);
  s = await st();
  const p0 = s.pos;
  await page.keyboard.down('ArrowUp');
  await wait(2500);
  await page.keyboard.up('ArrowUp');
  s = await st();
  const moved = Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]);
  expect('Pepper walks', moved > 5, `${p0} -> ${s.pos} (${moved.toFixed(1)})`);
  await page.keyboard.down('ArrowRight'); await wait(800); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
  await shot('island-3-walked');
  // the story: the first cutscene itself completes node 2; complete the rest up to node 4 with the F9 dev aid; the handler runs for each new node
  for (let guard = 0; guard < 4; guard++) {
    s = await st();
    if (!s || s.node >= 4) break;
    const want = s.node + 1;
    await page.keyboard.press('F9', { delay: 70 });
    for (let i = 0; i < 40 && await cut(); i++) { await page.keyboard.press('ShiftLeft', { delay: 70 }); await wait(300); }
    const ok = await until(async () => { const z = await st(); return !z || (z.node === want && z.dbg?.prev === want); }, 20000);
    s = await st();
    expect(`story node ${want} handled`, ok && !!s, JSON.stringify({ node: s?.node, prev: s?.dbg?.prev, log: s?.dbg?.storyLog }));
  }
  s = await st();
  // the hologram alert needs "just advanced" (handled 3 before 4); a cutscene between the two defers the handler and the original then sees prev 2 as well
  const just = s.dbg?.storyLog.some((l) => l.node === 4 && l.prev === 3);
  expect('node 4: objective PHSE, lifsm2' + (just ? ', hologram alert' : ''), s.dbg?.objective.mode === 1 && s.dbg?.objective.recs[0] === 125 && s.dbg?.texts.npc === 'li/Data/lifsm2.str' && (!just || s.dbg?.objective.holoTimer > 0),
    JSON.stringify({ o: s.dbg?.objective, log: s.dbg?.storyLog }));
  expect('node 4: PEPPHOUSE_SIZE 100', await page.evaluate(() => window.__zone.sh.vars.get(0xb3)) === 100);
  await shot('island-4-node4');
  expect('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'm4 island passed');
  if (fail.length) process.exitCode = 1;
};
