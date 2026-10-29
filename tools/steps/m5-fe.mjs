// M5 audit, the front end stage z60FRE (headless, muted, real key input): Pepper's crossings / gags / outfit swaps, the frozen figure, the train, the Brickster, the butterflies,
// then Starten -> Nieuw spel through the exit fade into the island. Screenshots are written for looking at.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?start=frontend&mute=1" tools/steps/m5-fe.mjs --size 1280x800 --out /tmp/m5-fe
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const enter = async (idx) => { await select(idx); await press('Enter'); await wait(500); };
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  const stage = () => page.evaluate(() => {
    const w = __feWorld, r = w.records;
    const tokOf = (rec) => r.findIndex((x) => x !== rec && x.model && x.model === rec.model);   // which other record's model Pepper wears (-1 = his own)
    return {
      tick: w.tickCount,
      pepper: [r[0].x, r[0].y, r[0].z].map((v) => +v.toFixed(2)), clip: r[0].anim.clip, skate: r[1].anim.clip, wears: tokOf(r[0]),
      figure: [r[8].anim.clip, r[8].anim.frame],
      brickster: r[2].flags & 2 ? [r[2].x, r[2].y, r[2].z].map((v) => +v.toFixed(1)) : null,
      train: +r[44].x.toFixed(1),
      bf: [35, 36, 37, 38, 39, 40, 41].map((i) => [r[i].x, r[i].y, r[i].z].map((v) => +v.toFixed(1))),
      outfitsHidden: [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].every((i) => (r[i].flags & 2) === 0),
    };
  });
  await wait(1500);
  const s0 = await stage();
  expect('outfit records are hidden', s0.outfitsHidden);
  expect('the figure stands on clip 0x74 frame 0', s0.figure[0] === 0x74 && s0.figure[1] === 0, JSON.stringify(s0.figure));
  await shot('fe-1-start');

  // watch the stage for a while: crossings, gags, outfits, the train (300 ticks = 10 s, then 6 s of riding), the Brickster
  const seen = { clips: new Set(), wears: new Set(), dirChanges: 0, brick: 0, trainMoved: 0, shots: new Set() };
  let lastX = s0.pepper[0], lastDir = 0, bfStart = s0.bf, bfMoved = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const s = await stage();
    seen.clips.add(s.clip); seen.wears.add(s.wears);
    const dir = s.pepper[0] < lastX ? 1 : 0;
    if (s.pepper[0] !== lastX) { if (dir !== lastDir) { seen.dirChanges++; lastDir = dir; } lastX = s.pepper[0]; }
    if (s.train < 60) seen.trainMoved++;
    if (s.brickster) seen.brick++;
    bfMoved = Math.max(bfMoved, ...s.bf.map((p, i) => Math.hypot(p[0] - bfStart[i][0], p[1] - bfStart[i][1], p[2] - bfStart[i][2])));
    if (s.clip !== 41 && !seen.shots.has('gag')) { seen.shots.add('gag'); await shot(`fe-2-gag-clip${s.clip}`); }
    if (s.wears >= 0 && !seen.shots.has('outfit')) { seen.shots.add('outfit'); await shot(`fe-3-outfit-${s.wears}`); }
    if (s.brickster && !seen.shots.has('brick')) { seen.shots.add('brick'); await shot('fe-4-brickster'); }
    if (Math.abs(s.train) < 12 && !seen.shots.has('train')) { seen.shots.add('train'); await shot('fe-5-train'); }
    if (seen.dirChanges >= 2 && seen.wears.size >= 2 && seen.brick > 0 && seen.shots.has('train') && seen.clips.size >= 3) break;
    await wait(700);
  }
  log('seen', JSON.stringify({ clips: [...seen.clips], wears: [...seen.wears], dirChanges: seen.dirChanges, brick: seen.brick, trainMoved: seen.trainMoved, bfMoved: +bfMoved.toFixed(1) }));
  expect('Pepper crosses back and forth', seen.dirChanges >= 1);
  expect('gags play', seen.clips.size >= 2);
  expect('the butterflies fly', bfMoved > 3, `moved ${bfMoved.toFixed(1)}`);
  const s1 = await stage();
  expect('the figure never moves', s1.figure[0] === 0x74 && s1.figure[1] === 0);
  await shot('fe-6-later');

  // menu with real keys: Starten -> Nieuw spel; the stage keeps running under the exit fade
  const ticksBefore = (await stage()).tick;
  await enter(1);
  let m = await menu(); expect('start page (6)', m.page === 6);
  // a page-side recorder of the exit fade (every animation frame): the fade value and the stage's tick counter
  await page.evaluate(() => { window.__leaveTrace = []; const f = () => { const l = window.__fe?.leave; if (l !== null && l !== undefined) window.__leaveTrace.push([+l.toFixed(4), window.__feWorld?.tickCount ?? -1]); requestAnimationFrame(f); }; f(); });
  await enter(1);
  await wait(200);
  const trace = await page.evaluate(() => window.__leaveTrace);
  const fading = { fe: trace.length ? trace[trace.length - 1][1] : 0 };
  log('exit fade samples', trace.length, JSON.stringify(trace.slice(0, 5)), '...', JSON.stringify(trace.slice(-2)));
  expect('the exit fade runs from 1.0 down to below 0 over 17 ticks', trace.length >= 2 && trace[0][0] <= 1 && trace[trace.length - 1][0] < 0.1);
  expect('the stage runs on under the exit fade (the tick counter advances)', trace.length >= 2 && trace[trace.length - 1][1] - trace[0][1] >= 5, JSON.stringify([trace[0], trace[trace.length - 1]]));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.machine.mode === 2, null, { timeout: 300000 });
  const z = await page.evaluate(() => ({ node: __zone.sh.vars.get(0x58), tick: __zone.world.tickCount }));
  expect('new game starts the island at story node 2', z.node === 2, JSON.stringify(z));
  expect('the stage ran on during the exit fade', (fading.fe ?? 0) >= ticksBefore);
  await wait(500);
  await wait(1000);
  await shot('fe-8-island');
  log(fail.length ? 'FAILED: ' + fail.join(', ') : 'all ok');
};
