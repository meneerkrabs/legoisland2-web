// NPC conversation speech sync (headless, muted browser): after the island's first cutscene (skipped with Shift taps), Pepper is put at ~1.8x the NPC's near radius (the port's speech
// prefetch starts there), waits PRE_MS (default 2500) like a walking player would, is moved in front of the NPC and presses Shift. Records, for every NPC tried (NPCS=3): request -> audio start
// (speech.say -> onLineStart), whether the line was in hand at the request, time the talk clip / subtitle were held (speech.waiting).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5732/?zone=z02LGI&trace=1" tools/steps/speech-npc.mjs --size 800x600
export default async ({ page, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga && window.__zone.machine.mode === 2, null, { timeout: 600000 });
  for (let i = 0; i < 40 && await page.evaluate(() => window.__zone.ctx.cutscene.active()); i++) { await key('ShiftLeft'); await wait(400); }
  await wait(1500);
  await page.evaluate(() => {
    const sp = window.__shell.audio.ga.speech, ev = (window.__npcEv = []);
    const say = sp.say.bind(sp);
    sp.say = (a, b = -1) => { const ok = say(a, b); if (ok) ev.push({ ev: 'say', t: performance.now(), id: sp.idOf(a), ready: sp.buffers ? sp.buffers.has(sp.idOf(a).toLowerCase()) : null }); return ok; };
    sp.onLineStart = (i, id) => ev.push({ ev: 'start', t: performance.now(), id });
    const cs = window.__zone.ctx.cutscene, pf = cs.prefetch.bind(cs), st = cs.start.bind(cs);
    cs.prefetch = (slot) => { ev.push({ ev: 'cs-prefetch', t: performance.now(), id: '#' + slot }); return pf(slot); };
    cs.start = (slot) => { ev.push({ ev: 'cs-start', t: performance.now(), id: '#' + slot }); return st(slot); };
    let w0 = false, t0 = 0;
    const loop = () => { const w = sp.waiting; if (w && !w0) t0 = performance.now(); if (!w && w0) ev.push({ ev: 'held', ms: Math.round(performance.now() - t0) }); w0 = w; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const cands = await page.evaluate(() => {
    const z = window.__zone, ic = [...z.world.ext.values()].find((v) => v && v.text && typeof v.say === 'function'), t = ic && ic.text.npc, out = [];
    for (const r of z.world.records) {
      const n = r?.ctrl?.nodes.find((x) => x.kind === 'SGMFIG');
      if (!n || !t || !r.name) continue;
      const nm = r.name.slice(0, 4);
      if (t.voice(nm + 'A') < 0) continue;
      out.push({ idx: z.world.records.indexOf(r), name: r.name, near: Math.sqrt(n.nearR2), talk: Math.sqrt(n.talkR2), line: n.line });
    }
    return { out, table: !!t };
  });
  log('NPC candidates', JSON.stringify(cands.out.slice(0, 12)));
  const N = Number(process.env.NPCS ?? 3);
  for (const c of cands.out.slice(0, N)) {
    await page.evaluate(({ idx, d }) => {
      const z = window.__zone, r = z.world.records[idx], p = z.loaded.pepper;
      const fx = r.m[8], fz = r.m[10], l = Math.hypot(fx, fz) || 1;
      p.x = r.x + (fx / l) * d; p.z = r.z + (fz / l) * d; p.y = r.y; p.ry = Math.atan2(r.x - p.x, r.z - p.z);
    }, { idx: c.idx, d: Math.max(c.near * 1.8, c.talk * 1.1) });
    await wait(Number(process.env.PRE_MS ?? 2500));
    await page.evaluate(({ idx, d }) => {
      const z = window.__zone, r = z.world.records[idx], p = z.loaded.pepper;
      const fx = r.m[8], fz = r.m[10], l = Math.hypot(fx, fz) || 1;
      p.x = r.x + (fx / l) * d; p.z = r.z + (fz / l) * d; p.y = r.y; p.ry = Math.atan2(r.x - p.x, r.z - p.z);
    }, { idx: c.idx, d: c.talk * 0.6 });
    await wait(700);
    await page.evaluate(() => { const v = window.__zone.sh.vars; if ((v.get(0x5e) & 0x11) === 0) v.set(0x5e, 1); });   // (Pepper starts on the skateboard: put her on foot for the test)
    await key('ShiftLeft');
    await wait(5000);
    const st = await page.evaluate((idx) => { const n = window.__zone.world.records[idx].ctrl.nodes.find((x) => x.kind === 'SGMFIG'); const z = window.__zone, r = z.world.records[idx]; return { talk: n.talk, talks: n.talks, pc: z.sh.vars.get(0x5e), flags: r.ctrl.flags, cut: z.ctx.cutscene.active(), dist: Math.round(Math.sqrt(r.ctrl.distSq)), mode: z.machine.mode }; }, c.idx);
    log('NPC', c.name, JSON.stringify(st));
    await key('ShiftLeft'); await wait(1500);   // Shift again: ends the conversation
  }
  const r = await page.evaluate(() => ({ ev: window.__npcEv, stats: window.__shell.audio.ga.speech.stats, lags: null }));
  const t0 = r.ev[0]?.t ?? 0;
  log('SPEECH-NPC ' + r.ev.map((e) => (e.ev === 'held' ? `held=${e.ms}ms` : `${e.ev}:${e.id}${e.ready === true ? '(ready)' : e.ready === false ? '(NOT ready)' : ''}@${Math.round(e.t - t0)}`)).join(' '));
  log('SPEECH-NPC-STATS ' + JSON.stringify({ stats: r.stats, lags: r.lags }));
};
