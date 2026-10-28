// Every zone through the shell as a stub: `?zone=<archive>` starts the zone (story node jumped to the zone's first node), Pepper walks, a screenshot is taken.
//   ZONES=z01BPK,z05WAB node tools/browse.mjs "http://localhost:5499/?mute=1" tools/steps/shell-zones.mjs --size 640x480
const ALL = ['z01BPK', 'z02LGI', 'z03PPH', 'z04IFC', 'z05WAB', 'z07CSI', 'z08BKD', 'z09JST', 'z10RGB', 'z13CAI', 'z14OSD', 'z15SSH', 'z16PYA', 'z17WAS', 'z18MMP', 'z20DSP', 'z21FSH', 'z22BIP', 'z23DIP', 'z27TRX', 'z28HAT', 'z36CNT', 'z38PAR', 'z39ASB', 'z40aPO', 'z40OGL', 'z41MAP', 'z42BRP', 'z50LTC'];
export default async ({ page, shot, wait, log }) => {
  const zones = (process.env.ZONES ?? '').split(',').filter(Boolean);
  const list = zones.length ? zones : ALL;
  const bad = [];
  for (const z of list) {
    const errors = [];
    const onErr = (e) => errors.push(e.message);
    page.on('pageerror', onErr);
    const t0 = Date.now();
    try {
      await page.goto(`http://localhost:5499/?zone=${z}&mute=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 15, null, { timeout: 240000 });
      const t1 = Date.now();
      const before = await page.evaluate(() => { const p = window.__zone.loaded.pepper; return [p.x, p.y, p.z]; });
      await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
      const info = await page.evaluate(() => {
        const zn = window.__zone, p = zn.loaded.pepper;
        return { index: zn.info.index, node: zn.sh.vars.get(0x58), hasPlayer: zn.loaded.hasPlayer, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), ticks: zn.world.tickCount, records: zn.world.records.length, skipped: zn.loaded.skipped.length, notes: zn.loaded.notes, hub: zn.loaded.profile.hub, draws: zn.gr.info.draws };
      });
      const moved = Math.hypot(info.pos[0] - before[0], info.pos[2] - before[2]);
      await shot(`zone-${z}`);
      const ok = errors.length === 0 && Number.isFinite(info.pos[0]) && info.pos.every(Number.isFinite);
      if (!ok) bad.push(z);
      log(ok ? 'ok  ' : 'FAIL', z, `load ${((t1 - t0) / 1000).toFixed(1)}s`, JSON.stringify({ ...info, moved: +moved.toFixed(1), errors }));
    } catch (e) {
      bad.push(z);
      log('FAIL', z, String(e).slice(0, 200), JSON.stringify(errors));
    }
    page.off('pageerror', onErr);
  }
  log(bad.length ? `FAILED zones: ${bad.join(', ')}` : 'all zones ran');
  if (bad.length) process.exitCode = 1;
};
