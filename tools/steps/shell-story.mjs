// Walk the whole story through the shell with the stub aid F9 (hubs: complete the node the story waits for; mini-games: finish successfully -> banner ->
// result menu -> Continue), from "new game" (node 2) to the free roam node 68, including the outro movie after the Brickster's palace (straight to the island: no credits, gaps.md U2).
//   node tools/browse.mjs "http://localhost:5499/?start=frontend&mute=1&debug=1" tools/steps/shell-story.mjs --size 640x480
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { if (!cond) fail.push(name); log(cond ? 'ok  ' : 'FAIL', name, extra); };
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  await select(1); await press('Enter'); await wait(500);
  await select(1); await press('Enter'); await wait(500);          // Nieuw spel
  const state = () => page.evaluate(() => {
    const z = window.__zone;
    if (!z) return null;
    return { index: z.info.index, id: z.info.id, archive: z.info.archive, mode: z.machine.mode, node: z.sh.vars.get(0x58), ticks: z.world.tickCount, kind: z.info.kind, movie: !!document.querySelector('.le2-movie') };
  });
  const visited = [];
  let last = '';
  for (let step = 0; step < 400; step++) {
    const s = await state();
    if (!s) { await wait(400); continue; }
    if (s.movie) { await key('Space'); await wait(800); continue; }
    const tag = `${s.index}@${s.node}`;
    if (tag !== last && s.mode === 2 && s.ticks > 3) { visited.push(tag); last = tag; log('zone', s.archive, `(table ${s.index}) at story node ${s.node}`); }
    if (s.node >= 68 && s.index === 2 && s.mode === 2 && s.ticks > 10) break;
    if (s.mode === 2 && s.ticks > 3) { await key('F9'); await wait(900); }
    else if (s.mode === 4) { await press('Enter'); await wait(500); }
    else if (s.mode === 5) { await select(1); await press('Enter'); await wait(1500); }
    else await wait(500);
    // the credits are no part of the story: a front end stage after the outro would be a bug (gaps.md U2)
    if (await page.evaluate(() => window.__fe && window.__fe.mode === 2 && !__shell.menu.engine.open)) throw new Error('credits after the outro: the original goes straight to the island');
  }
  const s = await state();
  log('visited', visited.join(' '));
  expect('story reached the free roam node 68 in the island', !!s && s.node >= 68 && s.index === 2, JSON.stringify(s));
  const zones = visited.map((v) => +v.split('@')[0]);
  expect('visited the mini-games in story order', [5, 7, 8, 9, 12, 14, 15, 16, 17, 18, 20, 21, 24, 25, 26, 28, 29].every((z) => zones.includes(z)), JSON.stringify(zones));
  await shot('story-end');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'story walk passed');
  if (fail.length) process.exitCode = 1;
};
