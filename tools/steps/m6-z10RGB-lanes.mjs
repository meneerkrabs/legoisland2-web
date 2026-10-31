// diagnostic (z10RGB bridge / field map): an ASCII map of what the walk can enter, x = 16 .. -100 (columns, step 2), z = -26 .. -6 (rows, step 1): '#' = a chest-height sweep of the walk
// (mask 1, r 0.6, skin 0.2, 1 unit to the west) hits something (G091 = the invisible fence ...), '~' = the ground is below y 8 (water / the drop), '.' = free. Used to choose BROWSER_ROUTE
// (src/zones/z10rgb/bot.ts).  node tools/browse.mjs "http://localhost:<port>/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB-lanes.mjs
export default async ({ page, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z10RGB' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  const rows = await page.evaluate(() => {
    const zz = __zone, w = zz.world, p = zz.game.assist.state.pepper, out = [];
    for (let z = -26; z <= -6; z += 1) {
      let row = '';
      for (let x = 16; x >= -100; x -= 2) {
        const y = w.col.terrainHeight(x, 40, z, 4);
        const pr = w.col.probe(p, [x, 40, z], [0, -80, 0], 1);
        const gy = Math.max(y, pr ? pr.point[1] : -99);
        if (gy < 8) { row += '~'; continue; }
        const h = w.col.sweep(p, [x, gy + 1.48, z], [-1, 0, 0], 1, 0.6, 0.2);
        row += h ? (h.rec.name === 'G091' ? '#' : 'o') : '.';
      }
      out.push(String(z).padStart(4) + ' ' + row);
    }
    return out;
  });
  log('MAP x = 16 (left) .. -100 (right), step 2; # fence G091, o other solid, ~ low ground, . free');
  for (const r of rows) log('MAP', r);
};
