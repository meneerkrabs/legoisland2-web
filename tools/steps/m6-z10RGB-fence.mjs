// diagnostic (z10RGB bridge fence): teleport Pepper to points along the bridge exit / field, hold Up and print how far she gets; at (-2, -16.2) also the sweeps that stop her (G091 post). node tools/browse.mjs "http://localhost:<port>/?zone=z10RGB&mute=1" tools/steps/m6-z10RGB-fence.mjs
export default async ({ page, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z10RGB' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await key('Enter'); await wait(700); await key('Enter'); await wait(700);
  const tele = (x, z) => page.evaluate(([x, z]) => {
    const zz = __zone, st = zz.game.assist.state, p = st.pepper, w = zz.world, c = w.camera.c;
    const y = w.col.terrainHeight(x, p.y + 30, z, 4);
    const ex = c[0] - c[3], ey = c[1] - c[4], ez = c[2] - c[5];
    p.setEuler(p.rx, p.ry, p.rz, x, y, z); p.savePrev();
    c[3] = x; c[4] = y + 3; c[5] = z; c[0] = x + ex; c[1] = y + 3 + ey; c[2] = z + ez; w.camera.savePrev();
    return y;
  }, [x, z]);
  const pos = () => page.evaluate(() => { const p = __zone.game.assist.state.pepper; const wk = p.ctrl?.find('SGwalk'); return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), wk?.state, +(wk?.speed ?? 0).toFixed(2)]; });
  const sweep = () => page.evaluate(() => { const zz = __zone, p = zz.game.assist.state.pepper, w = zz.world; const out = []; for (const [dx, dz] of [[-1, 0], [-1, -0.16], [0, -1], [0, 1], [1, 0]]) for (const mask of [1, 3]) { const h = w.col.sweep(p, [p.x, p.y + 1.48, p.z], [dx * 2, 0, dz * 2], mask, 0.6, 0.2); out.push({ d: [dx, dz], mask, hit: h ? { rec: h.rec.name, idx: w.records.indexOf(h.rec), pt: h.point.map((v) => +v.toFixed(2)), n: h.normal.map((v) => +v.toFixed(2)), poly: h.polygon, t: +h.t.toFixed(2) } : null }); } return out; });
  for (const [x, z] of [[-60, -13], [-60, -15], [-60, -15.9], [-60, -16.5], [-86, -15.9], [-2, -15.9], [-2, -16.2]]) {
    const y = await tele(x, z);
    await wait(300);
    const a = await pos();
    await page.keyboard.down('ArrowUp'); await wait(1500); const b = await pos(); await page.keyboard.up('ArrowUp'); await wait(300);
    log('FENCE', JSON.stringify({ from: [x, z], y, start: a, afterUp: b }));
    if (z === -16.2) for (const e of await sweep()) log('SWEEP', JSON.stringify(e));
  }
};
