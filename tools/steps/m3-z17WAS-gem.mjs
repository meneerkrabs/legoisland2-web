// close-up of the gem holder
export default async ({ page, wait, key, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z17WAS' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(600); await key('Enter'); await wait(600); await key('Enter'); await wait(500);
  // make every snake carry the gem soon: the node's rng is replaced so the first snake holds it
  await page.evaluate(() => { const n = __zone.world.records[22].ctrl.nodes.find((x) => x.kind === 'zonewas'); n.shared.rng = { int: (m) => (m === 3 ? 0 : Math.floor(Math.random() * m)) }; });
  for (let i = 0; i < 200; i++) {
    const d = await page.evaluate(() => __zone.game.debug());
    if (d.holder >= 0 && d.state[d.holder] === 2) break;
    await wait(40);
  }
  await wait(150);
  await page.screenshot({ path: '/tmp/m3/z17WAS/gem-close.png', clip: { x: 380, y: 200, width: 520, height: 400 } });
  log('done', JSON.stringify(await page.evaluate(() => __zone.game.debug())));
};
