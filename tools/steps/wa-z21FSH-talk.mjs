// z21FSH fisherman speech proof (headless, muted): Pepper next to the fisherman (record FSHM), Shift: FSHMA is spoken (subtitle), the second talk says FSHMC and points the way.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?zone=z21FSH&mute=1" tools/steps/wa-z21FSH-talk.mjs --size 1024x768 --out /tmp/wa-z21FSH-talk
export default async ({ page, shot, wait, log, key }) => {
  const tap = (k, ms = 70) => page.keyboard.press(k, { delay: ms });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z21FSH' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  for (let i = 0; i < 80 && (await page.evaluate(() => __zone.ctx.cutscene.active())); i++) { await tap('Shift', 40); await wait(60); }
  await wait(600); await key('Enter'); await wait(600); await key('Enter'); await wait(1200);
  log('ctx', await page.evaluate(() => { const c = __zone.world.ext.get('island'); return c ? c.text.npc?.text('FSHMA') : 'no ctx'; }));
  for (let round = 0; round < 2; round++) {
    // Pepper to the fisherman's side, facing him
    await page.evaluate(() => {
      const w = __zone.world, f = w.records[7], p = w.records[6];
      // the Fishing node owns Pepper's matrix while she walks to a spot (the first Shift also started that walk, FSwitch FUN_006f4bfa): bring it back to the idle state first
      const F = p.ctrl.nodes.find((n) => n.kind === 'Fishing'); F.state = 1; w.vars.set(0xfb, 1);
      p.x = f.x + Math.sin(f.ry) * 1.2; p.z = f.z + Math.cos(f.ry) * 1.2; p.y = f.y; p.ry = Math.atan2(f.x - p.x, f.z - p.z);
      p.setEuler(p.rx, p.ry, p.rz, p.x, p.y, p.z);
    });
    log('placed', round, JSON.stringify(await page.evaluate(() => { const w = __zone.world; return { p: [w.records[6].x, w.records[6].z], f: [w.records[7].x, w.records[7].z, w.records[7].ry] }; })));
    await wait(500);
    log('after 500ms', round, JSON.stringify(await page.evaluate(() => { const w = __zone.world; return { p: [w.records[6].x, w.records[6].z], f: [w.records[7].x, w.records[7].z] }; })));
    await tap('Shift');
    let sub = null;
    for (let i = 0; i < 8 && !sub; i++) {
      await wait(100);
      sub = await page.evaluate(() => { const s = __zone.ctx.subtitle(); return s ? s.id + ': ' + s.text : null; });
      if (process.env.TALK_DBG) log('  dbg', i, JSON.stringify(await page.evaluate(() => { const n = __zone.world.records[7].ctrl.nodes[0]; const v = __zone.world.vars; return { line: n.line, timer: n.timer, talk: n.talk, pending: n.pending, slot: n.slot, mv: n.var, v: v.get(n.var).toString(16), idle: __zone.ctx.speechIdle(), cs: __zone.ctx.cutscene.active(), inView: __zone.world.ext.get('island').inFrustum(__zone.world.records[7]), dist2: __zone.world.records[7].ctrl.distSq, flags: __zone.world.records[7].flags.toString(16), pep: [__zone.world.records[6].x, __zone.world.records[6].z], fish: [__zone.world.records[7].x, __zone.world.records[7].z], pc: __zone.world.vars.get(0x5e) }; })));
    }
    log('talk', round, sub, JSON.stringify(await page.evaluate(() => ({ f: __zone.world.records[7].ctrl.nodes.map((n) => [n.kind, n.line, n.timer, n.talk]) }))));
    await shot('talk-' + round);
    await wait(9000);      // the conversation runs out by itself (timer 90 ticks, speech idle)
  }
};
