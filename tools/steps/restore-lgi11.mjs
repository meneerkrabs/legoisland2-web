// Restored content, feature 'lgi11' + 'cutlines' (docs/re/restore.md): the police station at story node 57 starts LGI11 (Nick arrests the radio) and then LGI12; headless + muted:
//   sh tools/m4-snapshot-server.sh 5521
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5521/?zone=z02LGI&node=57&restored=1&mute=1&hold=1" tools/steps/restore-lgi11.mjs --size 1280x800 --out /tmp/restore-lgi11
// With RESTORED=0 in the environment the URL should have `restored=0` instead: LGI12 alone (the original).
import { island, pathNode, teleportTo } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  for (const [i, v] of [[0x54, 4], [0x115, 0xc], [0x26, 15], [0x8e, 15]]) await S.setVar(i, v);
  const sub = () => page.evaluate(() => { const r = window.__zone.game.ctx.cutscene.runner; return { log: r.log.slice(), subtitle: r.subtitle?.id ?? null, text: r.subtitle?.text ?? null }; });
  // walk into the POLB trigger (PATH node 0x4c)
  const q = await pathNode(page, 0x4c);
  const p = (await S.state()).pos;
  const a0 = Math.atan2(p[0] - q[0], p[2] - q[2]);
  let started = false;
  for (let k = 0; k < 8 && !started; k++) {
    const a = a0 + k * Math.PI / 4;
    await teleportTo(page, q[0] + Math.sin(a) * 12, q[2] + Math.cos(a) * 12, q[0], q[2]); await wait(300);
    await page.keyboard.down('ArrowUp');
    started = await S.until(async () => (await S.state())?.cs, 4000, 40);
    await page.keyboard.up('ArrowUp');
  }
  expect('the police trigger starts a cutscene', started);
  const seen = []; let n = 0, last = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const s = await S.state();
    if (!s?.cs && n > 2) break;
    const c = await sub();
    if (c.subtitle && c.subtitle !== last) { last = c.subtitle; seen.push(c.subtitle); log('say', c.subtitle, c.text); await wait(500); await shot(`scene-${String(n++).padStart(2, '0')}-${c.subtitle}`); }
    else await wait(150);
  }
  const c = await sub();
  log('cutscene log', JSON.stringify(c.log));
  const restored = /restored=1/.test(page.url());
  if (restored) {
    expect('speech order LECSSB01-03 then LECSSP01-06', seen.join() === 'LECSSB01,LECSSB02,LECSSB03,LECSSP01,LECSSP02,LECSSP03,LECSSP04,LECSSP05,LECSSP06', seen.join());
    expect('LGI11 then LGI12 ran', /start LGI11/.test(c.log.join('|')) && /start LGI12/.test(c.log.join('|')), c.log.join('|'));
  } else expect('original: LGI12 alone', seen.join() === 'LECSSP01,LECSSP02,LECSSP03,LECSSP04,LECSSP05,LECSSP06' && !/start LGI11/.test(c.log.join('|')), seen.join());
  await wait(1500);
  const s = await S.state();
  expect('S277 = 7 and node 58 afterwards', s.s277 === 7 && s.node === 58, JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'passed');
  if (fail.length) process.exitCode = 1;
};
