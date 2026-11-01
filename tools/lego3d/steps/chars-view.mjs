// Headless before / after shots of the LEGO 3D characters in FROZEN POSES (docs/re/lego3d.md): the game's own clip + frame is forced on a record (its AnimInstance is frozen), the camera follows
// the record (a harness patch in the page, no engine change). Run through the bot slot, snapshot server (port 5741), headless + muted:
//   MOD=<mod folder> | OFF=1   ZONE=z02LGI   PREFIX=v1   SHOTS="PEPP:58:10:front:2.2:0.5;INFO:36:4:three:2.2"   SIZE
//   sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5741/ tools/lego3d/steps/chars-view.mjs --profile /tmp/p --size 800x600 --out DIR
// SHOTS entries: RECORD:clip:frame:view:distance[:lookHeight[:face[:lod[:fov]]]]  view = front | side | back | three | up | top ; distance in character heights (a character is about 3 units high);
// clip -1 = leave the animation alone (no pose forced); face = expression number (rec.face), lod = force that LOD part (0 HR, 1 MR, 2 LR, 3 SLR, 4 BGR; empty = the game's distance rule), fov = vertical field of view in radians (the game's is about 1.0; 0.3 = a telephoto).
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = new URL(page.url()).origin + '/';
  await page.waitForSelector('.bdb-start');
  if (process.env.MOD) {
    for (let i = 0; i < 5; i++) { const rm = page.locator('.bdb-mod').filter({ hasText: 'LEGO 3D (generated)' }).locator('button').last(); if (!(await rm.count())) break; await rm.click().catch(() => {}); await wait(500); }
    await page.click('.bdb-mods > summary').catch(() => {});
    await page.locator('.bdb-mods input[type=file]').nth(1).setInputFiles(process.env.MOD);
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|geïmporteerd|klaar|imported/i.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 180000 }).catch(() => {});
    log('mod status:', await page.evaluate(() => document.querySelector('.bdb-modstatus')?.textContent?.slice(0, 120)));
  }
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'v';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  // some zones start with a briefing ("press a key"): keep pressing Enter until the game runs
  for (let i = 0; i < 300; i++) {
    if (await evaluate(() => !!(window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2))) break;
    await page.keyboard.press('Enter').catch(() => {}); await wait(2000);
  }
  await wait(1500);
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  for (const spec of (process.env.SHOTS ?? 'PEPP:58:10:front:2.2:0.5').split(';')) {
    const [name, clip = '-1', frame = '0', view = 'front', dist = '2.2', look = '0.5', face = '', lod = '', fov = ''] = spec.split(':');
    const ok = await evaluate(([name, clip, frame, view, dist, look, face, lod, fov]) => {
      const zz = window.__zone, w = zz.world, rec = w.records.find((r) => r.name === name && r.model && r.m);
      if (!rec) return false;
      if (rec.anim && +clip >= 0) {
        const a = rec.anim; a.start(+clip, 0); a.frame = +frame; a.advance = () => 0; a.advanceTo = () => 0; a.start = () => true; a.seek = () => true; a.noInterp = true;
      }
      if (face !== '') rec.face = +face;
      zz.gr.__fov0 ??= zz.gr.fov; zz.gr.fov = fov === '' ? zz.gr.__fov0 : +fov;   // a telephoto for close-ups: the game hides a character the camera is closer to than about 4 units
      rec.flags = (rec.flags | 2) & ~0x8000;   // an inactive record (not spawned yet) is switched on for the shot
      zz.gr.lodHook = lod === '' ? null : (r, parts) => (r === rec ? Math.min(+lod, parts.length - 1) : null);   // the developer hook of the renderer: force LOD part n (0 HR, 1 MR, 2 LR, 3 SLR, 4 BGR)
      // the camera: set the eye / target of the world camera right before every draw (the zone's own camera code - a fixed view, a vehicle, a cutscene - runs in the step and is simply overridden)
      if (!zz.gr.__wrapped) { const o = zz.gr.render.bind(zz.gr); zz.gr.render = (...a) => { window.__cam?.(); return o(...a); }; zz.gr.__wrapped = true; }
      window.__camName = name;
      window.__cam = () => {
        if (face !== '') rec.face = +face;   // the game's own face code changes the expression every few ticks: hold it
        const m = rec.m, sc = Math.max(Math.abs(rec.scale?.[1] ?? 1), 0.01), c = w.camera.c;
        let fx = m[8], fz = m[10]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        const ang = { front: 0, side: Math.PI / 2, back: Math.PI, three: Math.PI / 4, up: 0, top: 0 }[view] ?? 0, ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = fx * ca + fz * sa, dz = -fx * sa + fz * ca, d = +dist * 3.0 * sc;
        c[3] = m[12]; c[4] = m[13] + 3.0 * sc * +look; c[5] = m[14];
        c[0] = m[12] + dx * d; c[1] = m[13] + 3.0 * sc * (view === 'up' ? 0.1 : view === 'top' ? 1.8 : +look + 0.05); c[2] = m[14] + dz * d;
        w.camera.updateView();
      };
      return true;
    }, [name, clip, frame, view, dist, look, face, lod, fov]);
    if (!ok) { log(name, 'no such record'); continue; }
    await wait(+(process.env.SETTLE ?? 1200));
    if (process.env.DEBUG_CAM) log(name, JSON.stringify(await evaluate(() => { const w = window.__zone.world, c = w.camera.c; const r = w.records.find((x) => x.name === window.__camName); return { c: [...c].slice(0, 6).map((x) => +x.toFixed(1)), m: r ? [r.m[12], r.m[13], r.m[14]].map((x) => +x.toFixed(1)) : null, flags: r?.flags }; })));
    await shot(`${prefix}-${zone}-${name}-${clip}_${frame}-${view}${dist}${face ? "-f" + face : ""}${lod !== "" ? "-L" + lod : ""}`);
  }
};
