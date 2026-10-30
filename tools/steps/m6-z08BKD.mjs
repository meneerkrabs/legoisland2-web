// z08BKD "Brick Dive" in the headless browser (muted): the intro / help screens, then the bot of tools/lib/bkd-bot.mjs dives for the five bricks with the arrow keys (the page
// loop asks it before every tick and sends the DOM keydown / keyup events the input layer reads, like the z21FSH steps), a WIN: HUD, banner, hi-score / trophy variables,
// the result menu (page 16) and Continue (the story goes on). About 7 minutes of wall time (the game is 407 s long with this bot: 12224 ticks).
//   sh tools/m4-snapshot-server.sh 5607
//   node tools/browse.mjs "http://localhost:5607/?zone=z08BKD&mute=1" tools/steps/m6-z08BKD.mjs --size 1024x768 --out /tmp/m6-z08BKD
// The bot plans from where the creatures will be: the fish swim as a function of the tick alone, so a copy of the zone is run here (node) first and its recorded paths go
// into the page with the bot (the same code the node test runs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Archive } from '../../src/formats/archive.ts';
import '../../src/zones/z08BKD.ts';
import { loadZone } from '../lib/engine-load.mjs';
import { prepareBkd } from '../../src/zones/z08bkd/run.ts';
import { recordHazards } from '../lib/bkd-bot.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');

/** the bot module for the page: the same file, its two imports pointed at the dev server */
function botModule() {
  let src = fs.readFileSync(path.join(root, 'tools/lib/bkd-bot.mjs'), 'utf8');
  src = src.replaceAll("'../../src/zones/z08bkd/", "'/src/zones/z08bkd/");
  return src + '\nwindow.__BkdBot = { Bot, buildGrid, KEY };\n';
}

function recordPaths(ticks) {
  const dataRoot = path.join(root, 'public/data/le2'), dataDir = path.join(dataRoot, '_data');
  const archives = [];
  for (const f of fs.readdirSync(dataDir).filter((f) => f.endsWith('.bod')).sort()) { const n = f.slice(0, -4); archives.push(new Archive(n, fs.readFileSync(path.join(dataDir, f)), fs.readFileSync(path.join(dataDir, n + '.bob')))); }
  const L = loadZone({ dataRoot, dataDir, archives }, 'z08BKD');
  const run = prepareBkd(L.world, L.archive, L.scene);
  const hz = recordHazards(run, L.world, ticks);
  return { ...hz, data: Array.from(hz.data), rz: Array.from(hz.rz), anchor: Array.from(hz.anchor) };
}

export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('NAVIGATED', f.url().slice(0, 100)); });
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode);
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x2f), trophy: __zone.sh.vars.get(0x3d), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), done: __zone.sh.vars.get(0x53) }));
  const ready = (m) => page.waitForFunction((m) => window.__zone && window.__zone.info.archive === 'z08BKD' && window.__zone.machine.mode === m && window.__zone.world.tickCount >= 0, m, { timeout: 300000 });

  const t0 = Date.now();
  const hz = recordPaths(15600);
  log('recorded the creatures\' paths', Date.now() - t0, 'ms');

  await ready(1);
  await page.addScriptTag({ type: 'module', content: botModule() });
  await page.waitForFunction(() => !!window.__BkdBot, null, { timeout: 30000 });
  // the bot, asked before every tick of the loop (the world is still untouched: it is in the brief); DOM key events set the keys
  await page.evaluate(async (hz) => {
    const { snapshot } = await import('/src/zones/z08bkd/run.ts');
    const { Bot, buildGrid } = window.__BkdBot;
    const z = window.__zone, run = z.game.run;
    hz.data = Float32Array.from(hz.data); hz.rz = Float32Array.from(hz.rz); hz.anchor = Float32Array.from(hz.anchor);
    hz.octo = undefined;
    const grid = buildGrid(z.world), tight = buildGrid(z.world, { length: 4.5, half: 1.15, back: 0.2 });
    const bot = new Bot(grid, { hazards: hz, margin: 2.5, horizon: 90, tight });
    const KEYS = [[1, 'ArrowLeft'], [2, 'ArrowRight'], [4, 'ArrowUp'], [8, 'ArrowDown']];
    const st = { on: false, keys: 0, asked: 0 };
    const input = z.sh.input, orig = input.update.bind(input);
    input.update = () => {
      if (st.on && z.machine.mode === 2 && !run.result()) {
        const s = snapshot(run);
        const m = bot.decide({ ...s, bricks: s.brickList, page: s.pageAt, havePage: s.page });
        for (const [bit, code] of KEYS) {
          const want = (m & bit) !== 0, has = (st.keys & bit) !== 0;
          if (want !== has) window.dispatchEvent(new KeyboardEvent(want ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
        }
        st.keys = m; st.asked++;
      } else if (st.keys) {
        for (const [bit, code] of KEYS) if (st.keys & bit) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
        st.keys = 0;
      }
      orig();
    };
    window.__bkd = st;
  }, hz);

  const v0 = await vars();
  log('start vars', JSON.stringify(v0));
  await wait(1200); await shot('1-intro');
  await key('Enter'); await wait(700);
  expect('the controls help (mode 9)', (await mode()) === 9);
  await shot('2-help');
  await page.evaluate(() => { window.__bkd.on = true; });   // from the first tick of play (the node test starts the same way)
  await key('Enter'); await wait(1200);
  expect('play (mode 2) at the surface, 5 bricks to find', (await mode()) === 2 && (await dbg()).bricks === 0 && (await dbg()).pos[1] > 60, JSON.stringify(await dbg()).slice(0, 200));
  await shot('3-play-start');

  // the bot plays, REAL DOM key events from the page loop
  const taken = new Set();
  const snap = async (name, cond) => { if (!taken.has(name) && cond) { taken.add(name); await shot(name); } };
  let d = await dbg(), lastLog = 0;
  while (d && (await mode()) === 2 && !d.result) {
    d = await dbg();
    if (!d) break;
    await snap('4-dive', d.pos[1] < -20);
    await snap('5-brick-held', d.held >= 0 && d.pos[1] < 60 && taken.has('4-dive'));
    await snap('6-two-bricks', d.bricks === 2 && d.held < 0 && d.pos[1] > 70);
    await snap('7-deep', d.pos[1] < -125);
    await snap('8-four-bricks', d.bricks === 4 && d.pos[1] > 60);
    await snap('9-pocket', d.pos[1] < -160);
    if (d.bricks === 4 && d.held < 0 && d.ticks > 7000 && !taken.has('script')) {
      // the last brick lies in a pocket of the octopus's cave that the bot's coarse grid cannot enter with the engine's exact (float32, hit-cached) collision (see the node test
      // tools/tests/m6-z08BKD.mjs, WIN): as there, it is fetched by script (test aid: the diver is put at the brick, picks it up through the node's own pickup and is put at the
      // surface, where the node delivers it); the delivery, the banner and everything after are real play
      taken.add('script');
      await page.evaluate(() => { window.__bkd.on = false; });
      await wait(400);
      log('last brick by script', JSON.stringify(await page.evaluate(async () => {
        const { REC } = await import('/src/zones/z08bkd/consts.ts');
        const z = window.__zone, run = z.game.run, w = z.world, pr = w.records[REC.PEPP], dvr = run.env.nodeOf(pr);
        for (const bi of REC.BRICKS) {
          const br = w.records[bi];
          if (dvr.held || !(br.flags & 2) || br.y > 80) continue;
          pr.x = br.x; pr.y = br.y; pr.z = 10;
          await new Promise((r) => setTimeout(r, 120));
          dvr.pickBrick(br);
          if (dvr.held === br) { pr.x = 0; pr.y = 90; pr.z = 10; return { took: bi }; }
        }
        return { took: -1 };
      })));
    }
    if (d.ticks - lastLog >= 1500) { lastLog = d.ticks; log('tick', d.ticks, 'pos', d.pos.map((v) => v.toFixed(1)).join(','), 'bricks', d.bricks, 'held', d.held, 'oxygen %', d.percent.toFixed(1)); }
    await wait(250);
  }
  await page.evaluate(() => { window.__bkd.on = false; });
  d = await dbg();
  log('the game is over', JSON.stringify({ result: d.result, bricks: d.bricks, ticks: d.ticks, score: d.score, elapsed: d.elapsed }));
  expect('WIN: five bricks delivered, result 1', d.result === 1 && d.bricks === 5, JSON.stringify({ r: d.result, b: d.bricks }));
  await wait(900);
  expect('the banner (mode 4)', (await mode()) === 4);
  await shot('10-banner');
  const v1 = await vars();
  const trophy = d.score >= 9000 ? 3 : d.score >= 6000 ? 2 : 1;
  expect('HISCORE / TROPHY written (score, its medal)', v1.hi === d.score && v1.trophy === trophy, JSON.stringify({ v1, score: d.score }));
  await wait(1500); await shot('10b-banner-later');
  await key('Enter'); await wait(800);
  const m1 = await menu();
  expect('result menu page 16 (continue / retry)', (await mode()) === 5 && m1.page === 16, JSON.stringify(m1));
  await shot('11-result-menu');
  await key('Enter');
  for (let i = 0; i < 8; i++) { await wait(700); log('after continue', JSON.stringify(await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59), mode: __zone.machine.mode })))); }
  const v2 = await vars();
  log('vars after', JSON.stringify(v2));
  expect('Continue leaves the zone: the story went on', v2.node !== v0.node || v2.sub !== v0.sub, JSON.stringify({ v0, v2 }));
  log(fail.length ? 'FAILED ' + fail.join('; ') : 'ALL OK');
};
