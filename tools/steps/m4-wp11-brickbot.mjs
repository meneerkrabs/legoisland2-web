// WP11 browser bot: story node 8 ("collect the 4 coloured bot heads") played with real key input. For each coloured bot: Pepper is put 12 units from it
// (facing it, camera behind), Space throws the pizza (WP5); once the bot sits dazed (MOVE 0x1000 | 1), ArrowUp walks Pepper into it and the head is
// collected (NUM_BOT_HEADS, COLORED_BOTHEADS). After the fourth head the story moves on to node 9.
//   node tools/browse.mjs "http://localhost:5494/?zone=z02LGI&node=8&mute=1" tools/steps/m4-wp11-brickbot.mjs --size 1280x800 --out /tmp/m4-wp11
import { island } from './lib-island.mjs';

const BOTS = [['BBY0', 0x8a], ['BBB0', 0x2b], ['BBG0', 0xc9], ['BBR0', 0x0f]];

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  log('skipped cutscenes', await S.skipCutscenes());
  log('start', JSON.stringify(await S.state()));
  await shot('00-start');
  const moveOf = (v) => S.vars([v]).then((o) => o[v]);
  const hitOf = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); const hn = r?.ctrl?.nodes.find((x) => x.kind === 'BotHit'); return hn ? { armed: hn.armed, dying: hn.dying, how: hn.how, clip: r.anim?.clip } : null; }, name);
  for (const [name, mv] of BOTS) {
    let hit = false;
    for (let k = 0; k < 10 && !hit; k++) {
      const ang = [0, Math.PI, Math.PI / 2, -Math.PI / 2][k % 4];
      const at = await S.teleportNear(name, 12 + 4 * Math.floor(k / 4), ang);
      if (!at) { log(name, 'missing'); break; }
      await wait(250);
      await S.teleportNear(name, 12 + 4 * Math.floor(k / 4), ang);   // it walked on meanwhile
      await S.tap('Space', 80);
      hit = await S.until(async () => (await hitOf(name))?.armed === 0, 3500, 50);
      log(name, 'throw', k, hit ? 'HIT' : 'miss', (await moveOf(mv)).toString(16));
      if (!hit) await wait(800);
    }
    if (!hit) { await shot(`${name}-miss`); continue; }
    await wait(400);
    await shot(`${name}-1-dazed`);
    // walk into it
    const s0 = await S.state();
    await S.teleportNear(name, 4, 0);
    await page.keyboard.down('ArrowUp');
    const got = await S.until(async () => (await S.state()).heads > s0.heads, 4000, 30);
    await page.keyboard.up('ArrowUp');
    await wait(80);
    await shot(`${name}-2-collected`);
    const st = await S.state();
    log(name, got ? 'collected' : 'NOT collected', 'heads', st.heads, 'colored', (await S.vars([0x8e]))[0x8e], 'node', st.node);
    await wait(600);
  }
  await S.until(async () => (await S.state()).node >= 9, 5000);
  const fin = await S.state();
  log('final', JSON.stringify(fin), 'COLORED_BOTHEADS', (await S.vars([0x8e]))[0x8e]);
  await S.skipCutscenes();
  await wait(500);
  await shot('99-final');
};
