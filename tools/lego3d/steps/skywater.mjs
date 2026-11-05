// Sky / water QA shots of the LEGO 3D option (docs/re/lego3d.md section 19): fixed free cameras in any zone, LEGO 3D off / on, with the sky's turn angle and the sea's orbit phases FROZEN (harness only: the SkyNode /
// SeaNode `place` is wrapped so the state is reset before each call) so that an off / on pair differs only where the option changes something (tools/lego3d/skywater-diff.mjs compares two pictures).
//   ZONE=z02LGI  L3D=0|1|text (the ?lego3d= value)  PREFIX=sw  PARAMS="&x=y"  FREEZE=0 (let the sky and sea move)  ANGLE=0 (sky angle rad)  PHASE=0 (sea phases rad)  SETTLE=1500
//   CAMS="name:ex|ey|ez|tx|ty|tz;name:x,z@yaw|h|pitch (Pepper put at x, z first);name:@yawDeg|height|pitchDeg;..."   (island coordinates; "@yaw|h|pitch" = from Pepper's position + h, looking along the compass yaw (0 = +z, 90 = +x) tilted up by pitch degrees; no CAMS: the game's own camera, one shot "game")
//   FREEZETEX=1  stop the animated textures on entry 0   MOD=<folder>  imports a mod folder first (an HD pack subset: sky / sea / foam)   ENVONLY=1  hide every record except the sky / sea / seabed / foam / water / backdrop ones (exact off / on proof)   SLIDER=0|50|100  the draw-distance slider (far plane + fog end: the horizon haze)   PEPPER="x,z"  puts Pepper there first (so the zone's streaming and fog follow)   L3D=0,1 (several values: one page load each, in this browser)   ZONES=z02LGI,z07CSI (instead of ZONE; CAMS_<zone> overrides CAMS)
//   sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:PORT/ tools/lego3d/steps/skywater.mjs --profile /tmp/p --size 800x600 --out DIR
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = new URL(page.url()).origin + '/';
  const prefix = process.env.PREFIX ?? 'sw';
  if (process.env.MOD) {   // MOD=<mod folder>: imported through the start screen's mod list (like tools/lego3d/steps/pilot.mjs) before the first visit; it stays in this browser's profile
    await page.waitForSelector('.bdb-start');
    await page.click('.bdb-mods > summary').catch(() => {});
    await page.locator('.bdb-mods input[type=file]').nth(1).setInputFiles(process.env.MOD);
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|geïmporteerd|klaar|imported/i.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 120000 });
    log('mod status:', await page.evaluate(() => document.querySelector('.bdb-modstatus')?.textContent?.slice(0, 200)));
  }
  for (const zone of (process.env.ZONES ?? process.env.ZONE ?? 'z02LGI').split(',')) for (const l3d of (process.env.L3D ?? '0').split(',')) await one(zone, l3d);
  async function one(zone, l3d) {
  await page.goto(`${base}?zone=${zone}&mute=1&debug=1&lego3d=${l3d}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  for (let i = 0; i < 300; i++) {
    if (await evaluate(() => !!(window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2))) break;
    await page.keyboard.press('Enter').catch(() => {}); await wait(2000);
  }
  await wait(1500);
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  log('lego3d mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  const hint = await page.addStyleTag({ content: '.dc-badge-hint{display:none!important}' }).catch(() => {});
  if (process.env.PROBE) {   // PROBE=1: no freeze; sample the sea / sky nodes for ~4 s and check them against the formulas of docs/re/rendering.md 7.1 / 7.2 (phase steps per tick, orbit offset = 4 (cos B + sin A), 4 (sin B + cos A))
    const res = await evaluate(() => new Promise((done) => {
      const w = window.__zone.world; let sea, sky, seaRec, skyRec;
      for (const r of w.records) for (const n of (r.ctrl?.nodes ?? [])) { if (n.kind === 'Sea' && !sea) { sea = n; seaRec = r; } if (n.kind === 'Sky' && !sky) { sky = n; skyRec = r; } }
      const S = []; const t0 = performance.now(); let last = -1;   // also the wall clock of each sample: rates per second
      const f = () => { const t = w.tickCount; if (t !== last) { last = t; S.push({ t, ms: performance.now(), a: sea.phaseA, b: sea.phaseB, ax: sea.anchor[0], az: sea.anchor[2], mx: seaRec.m[12], mz: seaRec.m[14], ang: sky.angle, ds: seaRec.m[0], dy: seaRec.m[13] }); } if (performance.now() - t0 < 4000) requestAnimationFrame(f); else done(S); };
      f();
    }));
    let eo = 0, dA = [], dB = [], dS = [], n = 0;
    for (let i = 0; i < res.length; i++) {
      const r = res[i], ox = 4 * (Math.cos(r.b) + Math.sin(r.a)), oz = 4 * (Math.sin(r.b) + Math.cos(r.a));
      eo = Math.max(eo, Math.abs(r.mx - (r.ax + ox)), Math.abs(r.mz - (r.az + oz))); n++;
      if (i) { const k = r.t - res[i - 1].t; dA.push((r.a - res[i - 1].a) / k); dB.push((r.b - res[i - 1].b) / k); let d = r.ang - res[i - 1].ang; if (d < -3) d += 2 * Math.PI; dS.push(d / k); }
    }
    const secs = (res.at(-1).ms - res[0].ms) / 1000, perS = (k) => (res.at(-1)[k] - res[0][k]) / secs;
    log(`PROBE ${zone} l3d=${l3d}: wall ${secs.toFixed(2)} s, ${((res.at(-1).t - res[0].t) / secs).toFixed(1)} sim ticks / s; sea phaseA ${(perS('a') * 180 / Math.PI).toFixed(3)} deg/s (formula 30), phaseB ${(perS('b') * 180 / Math.PI).toFixed(3)} deg/s (formula 20.1), sky ${(perS('ang') * 180 / Math.PI).toFixed(4)} deg/s (formula 0.75; the angle wraps at +-pi, not in this window)`);
    const mm = (a) => `${Math.min(...a).toExponential(5)} .. ${Math.max(...a).toExponential(5)}`;
    log(`PROBE ${zone} l3d=${l3d}: ${n} samples (ticks ${res[0].t} .. ${res.at(-1).t}); sea matrix vs anchor + orbit: max error ${eo.toExponential(2)}; phaseA / tick ${mm(dA)} (formula ${(Math.PI / 180).toExponential(5)}); phaseB / tick ${mm(dB)} (formula ${(0.67 * Math.PI / 180).toExponential(5)}); sky angle / tick ${mm(dS)} (formula 4.36332e-4); sea scale ${res.at(-1).ds.toFixed(1)} y ${res.at(-1).dy.toFixed(2)}`);
    return;
  }
  if (process.env.FREEZE !== '0') {
    log('freeze:', JSON.stringify(await evaluate(([ang, ph]) => {
      const w = window.__zone.world, out = [];
      for (const r of w.records) for (const n of (r.ctrl?.nodes ?? [])) {
        // the dome follows the sim's camera eye (scale y = eye y + 100) and the sea anchors on it: the shot's fixed camera replaces the eye in these two calls, the sea's anchor is reset per shot, the angle / phases are held
        if (n.kind === 'SeaAmin' && !n.__f) { const o = n.prerender.bind(n); n.prerender = (...a) => { n.phase = ph; n.scroll = 0; n.prevScroll = 0; return o(...a); }; n.__f = 1; out.push(`${r.name} foam wobble`); }
        if (n.kind === 'Sky' && !n.__f) { const o = n.place.bind(n); n.place = (rec, eye, drawEye, v) => { n.angle = ang; const f = window.__swCam; if (f) { eye = f.slice(0, 3); drawEye = eye; } return o(rec, eye, drawEye, v); }; n.__f = 1; out.push(`${r.name} sky`); }
        if (n.kind === 'Sea' && !n.__f) { const o = n.place.bind(n); n.place = (rec, eye, drawEye, v) => { n.phaseA = ph; n.phaseB = ph; const f = window.__swCam; if (f) { eye = f.slice(0, 3); drawEye = eye; if (n.__cam !== window.__swCamId) { n.anchor = [eye[0], eye[1], eye[2]]; n.anchored = 1; n.__cam = window.__swCamId; } } return o(rec, eye, drawEye, v); }; n.__f = 1; out.push(`${r.name} sea`); }
      }
      return out;
    }, [+(process.env.ANGLE ?? 0), +(process.env.PHASE ?? 0)])));
  }
  if (process.env.ENVONLY) {   // ENVONLY=2: the shore foam SEAE is hidden too (its texture wobble accumulates in the mesh's UVs from the moment the zone started, so two runs never agree on it)
   const re = process.env.ENVONLY === '2' ? '^(SSKY|SSEA|SEAB|SKY\\d?|SKY_|SKIE|STAR|NITE|WATE|WATR|WASH|SBED|FALL|RIVR)$' : '^(SSKY|SSEA|SEAB|SEAE|SKY\\d?|SKY_|SKIE|STAR|NITE|WATE|WATR|WASH|SBED|FALL|RIVR)$';   // only the sky / sea / seabed / foam / water / backdrop records are drawn (all other records hidden each frame): the picture then differs between LEGO 3D off and on only if the option touches these
    await evaluate((re) => { window.__envOnly = new RegExp(re); }, re);
    log('env only: drawn records', JSON.stringify(await evaluate(() => window.__zone.world.records.filter((r) => window.__envOnly.test(r.name.trim())).map((r) => r.name.trim()))));
  }
  if (process.env.FREEZETEX === '1') await evaluate(() => { window.__freezeTex = 1; });   // FREEZETEX=1: every animated (.wib) texture is stopped on its first entry (so an off / on pair does not differ by the animation's phase)
  if (process.env.SLIDER) log('draw distance slider:', await evaluate((v) => { const gr = window.__zone.gr; gr.slider = v; return gr.slider; }, +process.env.SLIDER));   // SLIDER=0..100: the options' draw-distance slider (far plane and fog; default 50)
  if (process.env.PEPPER) {
    const [x, z] = process.env.PEPPER.split(',').map(Number);
    await evaluate(([x, z]) => { const zz = window.__zone, p = zz.loaded.pepper, w = zz.world; p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g; p.savePrev(); w.camera.init(p); }, [x, z]);
  }
  if (process.env.MAP) {   // MAP=range,step: ASCII map of the ground (collision rays): ' ' none, '~' under the sea level, '.' up to 4 above, ':' up to 12, '#' higher; prints the sea level too
    const [R, S] = process.env.MAP.split(',').map(Number);
    const rows = await evaluate(([R, S]) => { const w = window.__zone.world, o = []; for (let z = -R; z <= R; z += S) { let r = ''; for (let x = -R; x <= R; x += S) { const g = w.col.groundRay(x, 600, z); r += g < -1e30 ? ' ' : g < w.seaLevel ? '~' : g < w.seaLevel + 4 ? '.' : g < w.seaLevel + 12 ? ':' : '#'; } o.push(r); } return { seaLevel: w.seaLevel, o }; }, [R, S]);
    log(`map ${zone} range ${R} step ${S} sea level ${rows.seaLevel} (rows = z from -${R} up, columns = x from -${R} up)`); for (const r of rows.o) log(r);
    return;
  }
  const cams = (process.env[`CAMS_${zone}`] ?? process.env.CAMS ?? '').split(';').filter(Boolean);
  if (!cams.length) { await wait(+(process.env.SETTLE ?? 1500)); await shot(`${prefix}-${zone}-game-l${l3d}`); return; }
  for (const c of cams) {
    let [name, v] = c.split(':');
    const at = v.match(/^(-?[\d.]+),(-?[\d.]+)(@.*)$/);   // "x,z@yaw|h|pitch": Pepper is put at x, z first (ground height from the collision data)
    if (at) {
      await evaluate(([x, z]) => { const zz = window.__zone, p = zz.loaded.pepper, w = zz.world; if (!p) return; p.x = x; p.z = z; const g = w.col.groundRay(x, 400, z); if (g > -1e30) p.y = g; p.savePrev(); w.camera.init(p); }, [+at[1], +at[2]]);
      await wait(600);
    }
    if (at) v = at[3];
    let [ex, ey, ez, tx, ty, tz] = v.startsWith('@') ? [] : v.split('|').map(Number);
    if (v.startsWith('@')) {
      const [yaw, h, pitch] = v.slice(1).split('|').map(Number);
      const p = await evaluate(() => { const q = window.__zone.loaded.pepper, c = window.__zone.world.camera.c; return q ? [q.x, q.y, q.z] : [c[0], c[1] - 2.5, c[2]]; });   // no Pepper (flight zones): the game camera's eye
      const yr = (yaw * Math.PI) / 180, pr = (pitch * Math.PI) / 180;
      [ex, ey, ez] = [p[0], p[1] + h, p[2]]; [tx, ty, tz] = [ex + Math.sin(yr) * Math.cos(pr) * 100, ey + Math.sin(pr) * 100, ez + Math.cos(yr) * Math.cos(pr) * 100];
    }
    await evaluate(([ex, ey, ez, tx, ty, tz]) => {   // the camera is written right before each frame is drawn (and the game's own put back after it): works in every zone, vehicle cameras included
      const zz = window.__zone, w = zz.world, gr = zz.gr;
      window.__swCam = [ex, ey, ez, tx, ty, tz]; window.__swCamId = (window.__swCamId ?? 0) + 1;
      if (!gr.__sw) {
        const o = gr.render.bind(gr); gr.__sw = 1;
        gr.render = (...a) => { if (window.__freezeTex) for (const t of gr.renderer.animated) { const q = t.anim; if (!q.__fz) { q.__fz = 1; q.mode = 2; q.timer = 0; q.want = q.sequence[0]; q.last = -1; gr.renderer.flushTexture(t); } } if (window.__envOnly) for (const r of w.records) if (!window.__envOnly.test(r.name.trim())) r.flags |= 0x8000; const f = window.__swCam, c = w.camera.c; if (!f) return o(...a); const own = Float64Array.from(c); for (let i = 0; i < 6; i++) c[i] = f[i]; w.camera.updateView(); try { return o(...a); } finally { c.set(own); } };
      }
    }, [ex, ey, ez, tx, ty, tz]);
    await wait(+(process.env.SETTLE ?? 1500));
    log(name, JSON.stringify(await evaluate(() => { const gr = window.__zone.gr, i = gr.info; let fog = null; try { const f = gr.currentFog(); fog = f ? { start: +f.start?.toFixed?.(1), end: +f.end?.toFixed?.(1), far: f.far } : null; } catch {} return { draws: i.draws, triangles: i.triangles, fog, ph: gr.__swPh ?? null }; })));
    await shot(`${prefix}-${zone}-${name}-l${l3d}`);
  }
  }
};
