// Story node 8 on its own (era 1, ?zone=z02LGI&node=8): the four coloured Brickbot heads with real key input, waiting in game ticks (works on a slow page:
// THROTTLE=4 node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&node=8&mute=1" tools/steps/m4-heads.mjs --size 1280x800 --out /tmp/m4-heads)
import { island, collectHead } from './lib-island.mjs';
export default async (h) => {
  const { wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  let bad = 0;
  for (const [name, bit] of [['BBY0', 1], ['BBR0', 2], ['BBG0', 4], ['BBB0', 8]]) {
    const t0 = Date.now();
    const ok = await collectHead(S, h.page, wait, name, bit, log);
    log(ok ? 'ok  ' : 'FAIL', 'bot head', name, `${Date.now() - t0} ms`, 'heads', (await S.state()).heads, 'colours', (await S.vars([0x8e]))[0x8e]);
    if (!ok) bad++;
  }
  await S.until(async () => (await S.state()).node >= 9, 8000);
  const s = await S.state();
  log(s.node === 9 && !bad ? 'heads passed' : `FAILED node ${s.node}`);
  if (s.node !== 9 || bad) process.exitCode = 1;
  await shot('heads-done');
};
