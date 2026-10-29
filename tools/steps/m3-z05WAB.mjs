// Whack-A-Bot (z05WAB) in the shell, headless and muted, with real key input: intro / help screens, a win (a bot that whacks every bot with the arrow keys), the end banner,
// medal / hiscore / trophy variables, the result menu and the story continuing to the island; then a loss (never pressing, clock shortened to 10 s through the debug handle),
// retry, pause menu, abort back to the island and the way into the zone from the island (var 5 = 5, what the WAB door does).
//   node tools/browse.mjs "http://localhost:5499/?zone=z05WAB&mute=1" tools/steps/m3-z05WAB.mjs --size 1024x768 --out /tmp/m3/z05WAB
// WIN=0 skips the 90 s win run (loss / retry / abort only).
import { installPageBot } from './lib-pagebot.mjs';
export default async ({ page, shot, wait, log, key, evaluate }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const mode = () => evaluate(() => (window.__zone ? window.__zone.machine.mode : -1));
  const dbg = () => evaluate(() => window.__zone.game.debug());
  const vars = () => evaluate(() => ({ node: __shell.vars.get(0x58), hi: __shell.vars.get(0x20), trophy: __shell.vars.get(0x40), sub: __shell.vars.get(0x59), arch: window.__zone?.info.archive }));
  const inZone = (arch, m) => page.waitForFunction(([a, md]) => window.__zone && window.__zone.info.archive === a && (md === undefined || window.__zone.machine.mode === md), [arch, m], { timeout: 600000 });
  const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];     // hole 0 up, 1 left, 2 right, 3 down
  const modeIs = (m, t = 60000) => page.waitForFunction((md) => window.__zone && window.__zone.machine.mode === md, m, { timeout: t });
  // other agents edit the sources while this runs: no hot reload (the Vite client is replaced by a stub), then load the page again
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},off(){},send(){},data:{}}}\nexport function updateStyle(){}\nexport function removeStyle(){}\nexport function injectQuery(u){return u}\nexport const ErrorOverlay=class{};\n' }));
  await page.goto(page.url(), { waitUntil: 'load' });

  // ---- intro, help, play
  await inZone('z05WAB', 1);
  let v = await vars();
  expect('WAB at story node 10', v.node === 10 && v.arch === 'z05WAB', JSON.stringify(v));
  await wait(700);
  await shot('wab-1-intro');
  await key('Enter'); await modeIs(9);
  expect('help screen (mode 9)', (await mode()) === 9);
  await wait(300);
  await shot('wab-2-help');
  await key('Enter'); await modeIs(2);
  await wait(300);
  expect('play (mode 2)', (await mode()) === 2);
  await shot('wab-3-start');
  let d = await dbg();
  expect('clock runs from 01:30', d.timeLeft < 2700 && d.timeLeft > 2500, JSON.stringify(d));

  // ---- win: whack every bot (never the Infomaniac) as soon as it rises
  if (process.env.WIN !== '0') {
    let shots = 0;
    // the whack decision runs inside the page (lib-pagebot.mjs): a press needs a bot that is up for a few more ticks than the hammer's 12, and the reaction time in ticks of a bot
    // that decides in this process grows with the load of the machine (the first runs of the day: 30 hits of 45 with three other bots running)
    const bot = await installPageBot(page, 'wab', `(() => {
      const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];
      let until = 0, code = '';
      return (w) => {
        const out = new Set(); const z = w.__zone;
        if (!z || !z.game || z.machine.mode !== 2) return out;
        const now = performance.now();
        if (now < until) { out.add(code); return out; }
        const g = z.game.debug();
        if (g.over) return out;
        for (let i = 0; i < 4; i++) if ((g.state[i] === 1 || (g.state[i] === 2 && g.elapsed - g.tUp[i] < 10)) && !g.isInfo[i] && !g.whacked[i] && g.busy === 0 && g.stun === 0 && g.clip === 1) { code = KEYS[i]; until = now + 90; out.add(code); break; }
        return out;
      };
    })()`);
    await bot.start();
    for (;;) {
      const g = await dbg();
      if (g.over) break;
      const n = (await bot.info()).presses;
      if (shots < 2 && n > 5 + shots * 10) { await wait(330); await shot(`wab-4-playing-${shots}`); shots++; }
      await wait(50);
    }
    log('page bot', JSON.stringify(await bot.info()));
    await bot.stop();
    d = await dbg();
    log('win run:', JSON.stringify({ hits: d.hits, misses: d.misses, pct: d.pct, score: d.score }));
    expect('win: nearly every bot whacked and a medal (the two screenshots cost a few bots)', d.hits > 30 && d.score >= 5000, JSON.stringify(d));
    await modeIs(4, 60000).catch(() => {});
    expect('end banner (mode 4)', (await mode()) === 4);
    await shot('wab-5-banner-gold');
    v = await vars();
    expect('HISCORE_WAB = score and TROPHY_WAB = medal', v.hi === d.score && v.trophy === (d.score >= 9000 ? 3 : d.score >= 8000 ? 2 : 1), JSON.stringify(v));
    await press('Enter'); await wait(600);
    expect('result menu page 16 (continue / retry)', (await menu()).page === 16);
    await shot('wab-6-result-menu');
    await select(0); await press('Enter');                            // continue
    await inZone('z02LGI');
    await page.waitForFunction(() => window.__zone.world.tickCount > 5, null, { timeout: 300000 });
    v = await vars();
    expect('continue: the story moved on to the island', v.arch === 'z02LGI' && v.node > 10, JSON.stringify(v));
    await shot('wab-7-island-after-win');
  }

  // ---- loss: a fresh run (entry by ?zone), clock shortened to 10 s, no input at all
  await page.goto(page.url().replace(/&node=\d+/, ''), { waitUntil: 'load' });
  await inZone('z05WAB', 1);
  await key('Enter'); await modeIs(9); await key('Enter'); await modeIs(2);
  expect('second run in play', (await mode()) === 2);
  await evaluate(() => { const n = window.__zone.world.records[1].ctrl.nodes.find((x) => x.kind === 'botwab'); n.timeLeft = 300; });
  await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 120000 });
  d = await dbg();
  log('loss run:', JSON.stringify({ hits: d.hits, misses: d.misses, pct: d.pct, score: d.score, pepClip: d.pepClip }));
  expect('loss: score 0, Pepper in the lose clip (2)', d.hits === 0 && d.score === 0 && d.over === 1, JSON.stringify(d));
  await wait(1500);
  await shot('wab-8-banner-failed');
  v = await vars();
  expect('no trophy for a failed run', v.trophy === 0 && v.hi === 0, JSON.stringify(v));
  await press('Enter'); await wait(500);
  expect('failed: result menu page 19 (retry / abort)', (await menu()).page === 19);
  await shot('wab-9-failed-menu');
  await select(0); await press('Enter');                               // retry
  await page.waitForFunction(() => window.__zone && window.__zone.ctx && window.__zone.ctx.attempt === 1 && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  expect('retry restarts the zone (attempt 1)', true);
  await key('Enter'); await modeIs(9); await key('Enter'); await modeIs(2);
  expect('play again', (await mode()) === 2);
  // pause menu
  await press('Escape'); await wait(500);
  expect('pause menu page 18', (await menu()).page === 18);
  await shot('wab-10-pause');
  await press('Escape'); await wait(400);
  expect('resume', (await mode()) === 2);
  // abort through the pause menu: back to the island, the story rewinds to the hub
  await press('Escape'); await wait(500);
  await select(3); await press('Enter'); await wait(500);
  // the pause menu's abort is a list item: the confirm page (page 20: 0 title, Annuleren is the default item, 2 = OK, src/shell/menu.ts case 9) comes first
  expect('abort asks for confirmation (page 20)', (await menu()).page === 20, JSON.stringify(await menu()));
  await select(2); await press('Enter'); await wait(1000);       // Afbreken (items: 0 continue, 1 load, 3 abort, 4 restart, 5 options, 6 quit)
  await inZone('z02LGI');
  await page.waitForFunction(() => window.__zone.world.tickCount > 5, null, { timeout: 300000 });
  v = await vars();
  expect('abort: back on the island, story node < 10', v.arch === 'z02LGI' && v.node >= 8 && v.node < 10, JSON.stringify(v));
  // the WAB door: var 5 = 5 makes the island leave for the zone
  await evaluate(() => __shell.vars.set(5, 5));
  await inZone('z05WAB', 1);
  v = await vars();
  expect('entry from the island: WAB again at node ' + v.node, v.arch === 'z05WAB' && v.sub === 5, JSON.stringify(v));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'Whack-A-Bot checks passed');
  if (fail.length) process.exitCode = 1;
};
