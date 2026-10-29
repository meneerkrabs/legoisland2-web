// z09JST look at the phases (headless, muted, real key input): charge, ride, clash, round popup, end panel. A win run with screenshots on state changes.
//   node tools/browse.mjs "http://localhost:5605/?zone=z09JST&mute=1" tools/steps/m6-z09JST-look.mjs --size 1280x800 --out /tmp/m6-z09JST
import { KEY, jstKeys } from '../lib/jst-bot.mjs';
const NAME = { [KEY.LEFT]: 'ArrowLeft', [KEY.RIGHT]: 'ArrowRight', [KEY.UP]: 'ArrowUp', [KEY.DOWN]: 'ArrowDown', [KEY.SPACE]: 'Space' };
export default async ({ page, shot, wait, log, key }) => {
  const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; const d = z.game?.duel; return { mode: z.machine.mode, tick: z.world.tickCount, ...(z.game?.debug?.() ?? {}), aimX: d?.aimX, aimY: d?.aimY, gaugeV: d?.gauge }; });
  page.on('crash', () => log('PAGE CRASH'));
  page.on('close', () => log('PAGE CLOSE'));
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z09JST', null, { timeout: 120000 });
  const mode = (m) => page.waitForFunction((mm) => window.__zone && window.__zone.machine.mode === mm, m, { timeout: 60000 });
  await mode(1); await wait(300); await key('Enter');
  await mode(9); await wait(300); await key('Enter');
  await mode(2);
  const held = new Set();
  const hold = async (mask) => {
    const want = new Set(Object.keys(NAME).filter((m) => mask & +m).map(Number));
    for (const m of [...held]) if (!want.has(m)) { await page.keyboard.up(NAME[m]); held.delete(m); }
    for (const m of want) if (!held.has(m)) { await page.keyboard.down(NAME[m]); held.add(m); }
  };
  const seen = new Set();
  let i = 0, tick = 0;
  for (let n = 0; n < 4000; n++) {
    const s = await st();
    if (!s) break;
    if (s.mode === 4 || s.mode === 5) break;
    const k = jstKeys({ state: s.state, gauge: s.gaugeV, aimX: s.aimX, aimY: s.aimY }, 'win', tick++, { ready: 22 });
    await hold(k);
    if (n % 15 === 0) log('n', n, JSON.stringify({ mode: s.mode, state: s.state, g: s.gaugeV, t: s.ticks, k }));
    const tag = `${s.state.toString(16)}`;
    if (!seen.has(tag) && s.mode === 2) { seen.add(tag); await shot(`jst-st${tag}-${++i}`); log('state', tag, JSON.stringify({ hitsP: s.hitsP, hitsE: s.hitsE, speed: s.speed })); }
    await wait(20);
  }
  await hold(0);
  await wait(800);
  await shot('jst-end-banner');
  log('end', JSON.stringify(await st()));
};
