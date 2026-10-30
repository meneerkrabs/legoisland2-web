// M6 z09JST (Jousting), headless and muted, with REAL key input: intro -> help -> play, the pause menu, SPACE too early (the dark knight throws the player off, round popup),
// a whole tournament that the bot wins (banner, medal, hi-score / trophy variables, result menu page 16, Continue -> the story), then a tournament it loses (banner, result
// menu page 19, Retry -> a fresh duel, Abort -> the hub). Takes a few minutes: serve a snapshot (sh tools/m4-snapshot-server.sh 5605):
//   node tools/browse.mjs "http://localhost:5605/?zone=z09JST&mute=1" tools/steps/m6-z09JST.mjs --size 800x520 --out /tmp/m6-z09JST
// (env JST_QUICK=1: the bot plays against a flat random source = no aim wobble, a deterministic quick run)
import { KEY, jstKeys } from '../lib/jst-bot.mjs';
import { installPageBot } from './lib-pagebot.mjs';
const NAME = { [KEY.LEFT]: 'ArrowLeft', [KEY.RIGHT]: 'ArrowRight', [KEY.UP]: 'ArrowUp', [KEY.DOWN]: 'ArrowDown', [KEY.SPACE]: 'Space' };
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const quick = !!process.env.JST_QUICK;
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const st = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const d = z.game?.duel;
    return {
      arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, node: z.sh.vars.get(0x58), skipped: z.loaded.skipped.map((s) => s.ctorName).filter((n) => n !== 'SeaAmin' && n !== 'seabed').length,
      state: d?.state, gauge: d?.gauge, ax: d?.aimX, ay: d?.aimY, hitsP: d?.hitsP, hitsE: d?.hitsE, score: d?.score, medal: d?.medal, result: d?.result, popup: d?.popup, speed: d?.speed,
      hiscore: z.sh.vars.get(0x18), trophy: z.sh.vars.get(0xcb), ran: z.game?.node?.ran, camMode: d?.camMode, ready: d?.ready,
    };
  });
  const waitZone = (arch, mode = 2) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && (m !== 2 || window.__zone.world.tickCount > 3), [arch, mode], { timeout: 300000 });
  const waitMode = (m) => page.waitForFunction((mm) => window.__zone && window.__zone.machine.mode === mm, m, { timeout: 600000 });
  const held = new Set();
  const hold = async (mask) => {
    const want = new Set(Object.keys(NAME).filter((m) => mask & +m).map(Number));
    for (const m of [...held]) if (!want.has(m)) { await page.keyboard.up(NAME[m]); held.delete(m); }
    for (const m of want) if (!held.has(m)) { await page.keyboard.down(NAME[m]); held.add(m); }
  };
  const release = () => hold(0);
  const startPlay = async () => {
    await waitMode(1); await wait(300); await key('Enter');
    await waitMode(9); await wait(300); await key('Enter');
    await waitMode(2);
  };

  /**
   * one match with the bot ('win' / 'loss' / 'slow'): returns when the mode leaves play (the banner). The bot decides INSIDE the page, once per game tick (lib-pagebot.mjs): the
   * charge is made by alternating LEFT / RIGHT every tick, the release is SPACE once the gauge is past the mark, the aim point is steered in state 9: a node-side loop presses at
   * the speed of its page round trips and loses the match (a stalemate at 2 : 2 for 15 minutes) when the machine is loaded.
   */
  const match = async (style, shots = {}) => {
    let lastState = -1, tapped = 0, popupShot = false;
    const decide = `(() => {
      const KEY = ${JSON.stringify(KEY)}; const CODE = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown', 128: 'Space' };
      ${jstKeys.toString()}
      return (w) => {
        const z = w.__zone, out = new Set();
        if (!z || z.machine.mode !== 2) return out;
        const d = z.game && z.game.duel; if (!d) return out;
        const k = jstKeys({ state: d.state, gauge: d.gauge, aimX: d.aimX, aimY: d.aimY }, ${JSON.stringify(style)}, z.world.tickCount, { ready: ${quick ? 30 : 40} });
        for (const [bit, code] of Object.entries(CODE)) if (k & +bit) out.add(code);
        return out;
      };
    })()`;
    const bot = await installPageBot(page, 'jst', decide);
    await bot.start();
    let tick0 = -1, seenAt = Date.now(), lastTick = -1;
    for (let guard = 0; guard < 100000; guard++) {
      const s = await st();
      if (!s || s.mode !== 2) break;
      if (s.state !== lastState) {
        lastState = s.state;
        if (s.state === 0x21) tapped++;
        if (shots[s.state]) { await shot(shots[s.state]); delete shots[s.state]; }
      }
      if (s.state === 0x21 && !popupShot && shots.popup) { popupShot = true; await shot(shots.popup); }
      if (s.tick !== lastTick) { lastTick = s.tick; seenAt = Date.now(); } else if (Date.now() - seenAt > 120000) { log('the game stopped ticking (120 s of wall time)'); break; }
      if (tick0 < 0) tick0 = s.tick;
      if (s.tick - tick0 > 60000) { log('a match of more than 60000 ticks: giving up'); break; }
      await wait(100);
    }
    await bot.stop();
    return tapped;
  };

  // ================================================================================================= start: intro, help, play, pause
  await waitMode(1);
  if (quick) await page.evaluate(() => { window.__zone.game.duel.host.rng = { range: (x) => x / 2 }; });
  let s = await st();
  expect('z09JST starts (no PEPP record, no stray attaches), intro mode 1, duel in state 0, nothing ran yet', s.arch === 'z09JST' && s.mode === 1 && s.state === 0 && s.skipped === 0 && s.ran === 0, JSON.stringify(s));
  log('story node', s.node);
  await wait(500); await shot('jst-1-intro');
  await press('Enter'); await wait(500);
  s = await st(); expect('mode 9: the controls help (7 lines)', s.mode === 9, JSON.stringify(s));
  await shot('jst-2-help');
  await press('Enter'); await wait(500);
  s = await st(); expect('mode 2: play', s.mode === 2, JSON.stringify(s));
  await press('Escape'); await wait(500);
  s = await st(); expect('Esc opens the pause menu (mode 3, page 18)', s.mode === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const tickP = s.tick; await wait(500);
  expect('the world is frozen while paused', (await st()).tick === tickP);
  await shot('jst-3-pause');
  await press('Escape'); await wait(500);
  s = await st(); expect('Esc again resumes (mode 2)', s.mode === 2, JSON.stringify(s));

  // ================================================================================================= SPACE too early: state 4 .. the popup, no points
  await press('ArrowUp'); await wait(300);
  await page.waitForFunction(() => window.__zone.game.duel.state === 3, null, { timeout: 60000 });
  s = await st(); expect('after a button the bugle plays (state 2) and ends (state 3, charging)', s.state === 3 && s.gauge === 0 && s.hitsP === 0, JSON.stringify(s));
  await shot('jst-4-charge');
  for (let i = 0; i < 4; i++) { await page.keyboard.down(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await wait(60); await page.keyboard.up(i % 2 ? 'ArrowLeft' : 'ArrowRight'); await wait(60); }
  s = await st(); expect('four presses charge the gauge but not over 18', s.gauge > 1 && s.gauge < 18 && !s.ready, JSON.stringify(s));
  await key('Space');
  await wait(300);
  s = await st(); expect('SPACE with a charge <= 18: state 4 (too slow), marker off', s.state === 4 || s.state === 5, JSON.stringify(s));
  await page.waitForFunction(() => window.__zone.game.duel.state === 0x21, null, { timeout: 120000 });
  s = await st(); expect('the dark knight threw the player off: round popup (0x21) for state 4, nobody scored', s.state === 0x21 && s.popup === 4 && s.hitsP === 0 && s.hitsE === 0, JSON.stringify(s));
  await wait(300); await shot('jst-5-too-slow-popup');
  await key('Enter'); await wait(500);
  s = await st(); expect('the next round starts (state 0 / 1, or 2 when the Enter key is still down at state 1: it is the "any key" of that state)', s.state <= 2 && s.mode === 2, JSON.stringify(s));

  // ================================================================================================= run 1: a whole tournament, WIN
  const shots = { 9: 'jst-6-ride', 0xf: 'jst-7-hit', 0x12: 'jst-7-hit-b', 0x20: 'jst-7-glance', 0x16: 'jst-8-hurt', popup: 'jst-9-popup' };
  await match('win', shots);
  s = await st();
  log('end of run 1', JSON.stringify(s));
  expect('run 1: three points for the player, mode 4 banner, result 1', s.result === 1 && s.hitsP === 3 && s.hitsE < 3 && s.mode === 4, JSON.stringify(s));
  expect('run 1: medal = 3 - the dark knight\'s points, hi-score = score, trophy = medal', s.medal === 3 - s.hitsE && s.hiscore === s.score && s.trophy === s.medal && s.score > 0, JSON.stringify({ m: s.medal, h: s.hiscore, t: s.trophy, sc: s.score }));
  const finalScore = s.score, finalMedal = s.medal;
  await wait(800);
  await shot('jst-10-banner');
  await press('Enter'); await wait(700);
  s = await st(); expect('result menu (mode 5), win page 16', s.mode === 5 && (await menu()).page === 16, JSON.stringify(await menu()));
  await shot('jst-11-result-menu');
  await select(1); await press('Enter'); await wait(1500);       // Doorgaan (continue)
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z09JST' && (window.__zone.machine.mode === 1 || window.__zone.world.tickCount > 3), null, { timeout: 120000 });
  s = await st();
  log('after Continue', JSON.stringify({ arch: s.arch, node: s.node }));
  expect('Continue: the story moved on and left the zone', s.arch !== 'z09JST', JSON.stringify(s));
  const keep = await page.evaluate(() => [__shell.vars.get(0xcb), __shell.vars.get(0x18)]);
  expect('variables kept: trophy and hi-score', keep[0] === finalMedal && keep[1] === finalScore, JSON.stringify(keep));
  await shot('jst-12-next-zone');

  // ================================================================================================= run 2: LOSS
  await page.goto(page.url().replace(/zone=[^&]*/, 'zone=z09JST'), { waitUntil: 'load' });
  await waitMode(1);
  await page.evaluate(() => { __shell.vars.set(0xcb, 2); __shell.vars.set(0x18, 99999); });     // a silver trophy and a high score of an earlier run
  if (quick) await page.evaluate(() => { window.__zone.game.duel.host.rng = { range: (x) => x / 2 }; });
  await press('Enter'); await wait(400); await press('Enter'); await waitMode(2);
  await match('loss', { 0x16: 'jst-13-loss-hurt', 0x18: 'jst-13-loss-hurt-b', 0x19: 'jst-13-loss-hurt-c', 0x1a: 'jst-13-loss-hurt-d' });
  s = await st();
  log('end of run 2', JSON.stringify(s));
  expect('run 2: three points for the dark knight, mode 4, result 2, no medal', s.result === 2 && s.hitsE === 3 && s.hitsP < 3 && s.medal === 0 && s.mode === 4, JSON.stringify(s));
  expect('run 2: the trophy and hi-score stayed (only ever raised)', s.trophy === 2 && s.hiscore === 99999, JSON.stringify({ t: s.trophy, h: s.hiscore }));
  await wait(800); await shot('jst-14-banner-lost');
  await press('Enter'); await wait(700);
  expect('lost result menu is page 19 (retry / abort)', (await menu()).page === 19, JSON.stringify(await menu()));
  await shot('jst-15-result-menu-lost');
  await select(1); await press("Enter"); await wait(2500);          // Opnieuw starten (retry)
  await waitMode(1);
  s = await st();
  expect('Retry runs the zone again from the start (new duel: state 0, 0:0, score 0)', s.arch === 'z09JST' && s.state === 0 && s.hitsP === 0 && s.hitsE === 0 && s.score === 0, JSON.stringify(s));
  await press('Enter'); await wait(400); await press('Enter'); await waitMode(2);
  // lose again quickly: the dark knight gets his third point through the page (the state machine's end of round with 3 points; the real play is run 2)
  await page.evaluate(() => { const d = window.__zone.game.duel; d.hitsE = 3; d.state = 0x22; });
  await waitMode(4);
  s = await st(); expect('run 3: lost again', s.result === 2 && s.mode === 4, JSON.stringify(s));
  await wait(600); await press('Enter'); await wait(600);
  await select(2);
  await page.evaluate(() => { window.__seen = new Set(); window.__rec = setInterval(() => window.__seen.add(`${__shell.vars.get(0x58)}/${window.__zone?.info.archive ?? ''}`), 10); });
  await press('Enter'); await wait(1500);                            // Afbreken (abort)
  // the abort rewinds the story to the last hub (node 22, the castle). This debug entry (?zone=) leaves the hub's own objective variable set, so the story walks on into the duel
  // again a moment later: a recorder in the page (every 10 ms) shows the visit of node 22 / z07CSI
  await page.waitForFunction(() => [...window.__seen].some((k) => k.startsWith('22/')), null, { timeout: 120000 });
  const seen = await page.evaluate(() => [...window.__seen]);
  log('after Abort, nodes / zones seen', JSON.stringify(seen));
  expect('Abort rewinds the story to the castle hub (node 22, z07CSI)', seen.includes('22/z07CSI') || seen.includes('22/z09JST'), JSON.stringify(seen));
  await shot('jst-16-hub');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z09JST checks passed');
  if (fail.length) process.exitCode = 1;
};
