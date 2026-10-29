// Restored content, feature 'battery': headless screenshots + checks (muted, own Chromium). Served by tools/m4-snapshot-server.sh <port>:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&node=56&restored=1&mute=1&hold=1" tools/steps/restore-battery.mjs --size 1280x800 --out /tmp/restore
import { island } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  for (let i = 0; i < 4; i++) { await S.skipCutscenes(); await wait(300); if (!(await S.state())?.cs) break; }
  const q = () => page.evaluate(() => { const z = window.__zone, v = z.sh.vars, g = z.game.ctx.hud.gauge; return { node: v.get(0x58), level: v.get(22), mask: v.get(225), radio: v.get(0x22), gauge: g ? g.value : null, extras: z.game.ctx.hud.extras.length,
    vis: z.world.records.slice(295, 305).map((r) => (r.flags & 2) !== 0 ? 1 : 0).join('') }; });
  let s = await q();
  expect('node 56, gauge on, level 0, radio off, ten batteries visible', s.node === 56 && s.gauge === 0 && s.level === 0 && s.radio === 0 && s.vis === '1111111111', JSON.stringify(s));
  await S.teleportNear('PEPP', 0, 0);
  await wait(500); await shot('battery-gauge-0');
  await S.setVar(22, 6); await wait(300); await shot('battery-gauge-6');
  await S.setVar(22, 12); await wait(300); await shot('battery-gauge-12');
  await S.setVar(22, 0);
  // a battery from a few steps away (slope), then the real pickup
  await S.teleportNear('BTB5', 9, 0.5); await wait(700); await shot('battery-near');
  await S.teleportNear('BTB5', 1.2, 0.5); await wait(600);
  s = await q();
  expect('pickup in the browser: level 4, mask bit 5, that battery gone', s.level === 4 && (s.mask & 32) === 32 && s.vis[5] === '0', JSON.stringify(s));
  await wait(400); await shot('battery-picked');
  expect('radio on after the pickup', (await q()).radio === 1);
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'ALL OK');
};
