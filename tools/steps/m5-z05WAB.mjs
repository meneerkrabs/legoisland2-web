// M5 audit, z05WAB Whack-A-Bot: the loop's input rules of the original, with real key input (headless, muted):
//  * intro (mode 1) and help (mode 9) leave on ANY pressed button (an arrow key does; `DAT_00983840 != 0`),
//  * the end banner (mode 4) leaves for the result menu as soon as ANY button is HELD (`DAT_0098383c != 0`), and waits otherwise,
//  * a short play (clock set to 8 s) with the bot whacking bots, the 3D hit sounds (muted: only the calls), the result menu and the way back to the island.
//   node tools/browse.mjs "http://localhost:5513/?zone=z05WAB&mute=1" tools/steps/m5-z05WAB.mjs --size 1024x768 --out /tmp/m5a/z05WAB-m5
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const mode = () => page.evaluate(() => window.__zone?.machine?.mode ?? -1);
  const dbg = () => page.evaluate(() => window.__zone.game.debug());
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, open: e.open }; });
  const ready = (m, t = 20000) => page.waitForFunction((md) => window.__zone && window.__zone.info.archive === 'z05WAB' && window.__zone.machine.mode === md, m, { timeout: t });
  const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];
  await page.route('**/@vite/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function createHotContext(){return{accept(){},acceptExports(){},dispose(){},prune(){},invalidate(){},on(){},send(){}}}export function updateStyle(){}export function removeStyle(){}export function injectQuery(u){return u}' }));
  await page.goto(page.url(), { waitUntil: 'load' });

  /** play with the bot until the game is over (the clock is set short first); returns the debug state */
  async function playShort(ticks) {
    await page.evaluate((t) => { window.__zone.world.records[1].ctrl.nodes.find((x) => x.kind === 'botwab').timeLeft = t; }, ticks);
    for (;;) {
      const h = await page.waitForFunction(() => {
        const g = window.__zone.game.debug();
        if (g.over) return -2;
        for (let i = 0; i < 4; i++) if ((g.state[i] === 1 || (g.state[i] === 2 && g.elapsed - g.tUp[i] < 10)) && !g.isInfo[i] && !g.whacked[i] && g.busy === 0 && g.stun === 0 && g.clip === 1) return i;
        return -1;
      }, null, { polling: 4, timeout: 60000 }).then((j) => j.jsonValue());
      if (h === -2) break;
      if (h >= 0) { await page.keyboard.down(KEYS[h]); await wait(40); await page.keyboard.up(KEYS[h]); await wait(120); } else await wait(8);
    }
    return dbg();
  }

  // ---- 1. an ARROW key skips the intro and the help screen
  await ready(1);
  await wait(600);
  await shot('1-intro');
  await key('ArrowLeft');
  await ready(9, 4000);
  expect('ArrowLeft leaves the intro (mode 1 -> 9)', (await mode()) === 9);
  await wait(300); await shot('2-help');
  await key('ArrowUp');
  await ready(2, 4000);
  expect('ArrowUp leaves the help screen (mode 9 -> 2)', (await mode()) === 2);

  // ---- 2. a short game; at the end a key is HELD: the banner is skipped at once
  let d;
  {
    await page.evaluate(() => 0);
    const play = playShort(240);
    // hold a key from 1 s before the end: the loop must go 2 -> 4 -> 5 without stopping at the banner
    await page.waitForFunction(() => window.__zone.game.debug().timeLeft < 20, null, { polling: 4, timeout: 60000 });
    await page.keyboard.down('ArrowDown');
    d = await play;
    log('short run:', JSON.stringify({ hits: d.hits, misses: d.misses, pct: d.pct, score: d.score }));
    await page.waitForFunction(() => window.__zone.machine.mode === 5, null, { timeout: 5000 }).catch(() => {});
    expect('key held at the end: the banner (mode 4) was skipped, the result menu (mode 5) is open', (await mode()) === 5, `mode ${await mode()}`);
    await page.keyboard.up('ArrowDown');
    await wait(500); await shot('3-result-menu-after-held-skip');
    expect('result menu page 16 / 19', [16, 19].includes((await menu()).page), JSON.stringify(await menu()));
  }

  // ---- 3. a second game: nothing held at the end: the banner stays up until a button is pressed
  await key('ArrowDown'); await wait(300);            // result menu: the first item (retry / continue) ... use the retry path
  await page.goto(page.url(), { waitUntil: 'load' });
  await ready(1);
  await key('Enter'); await ready(9, 4000); await key('Enter'); await ready(2, 4000);
  d = await playShort(200);
  await wait(1500);
  expect('nothing held: the banner (mode 4) stays', (await mode()) === 4, `mode ${await mode()}`);
  await shot('4-banner-waits');
  await page.keyboard.down('ArrowRight'); await wait(150);
  expect('a held arrow ends the banner (mode 5)', (await mode()) === 5, `mode ${await mode()}`);
  await page.keyboard.up('ArrowRight');
  await shot('5-result-menu');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z05WAB M5 input checks passed');
  if (fail.length) process.exitCode = 1;
};
