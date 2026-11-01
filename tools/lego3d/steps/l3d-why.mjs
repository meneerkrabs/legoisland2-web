// Scenes of the LEGO 3D run-time path (the real option: PARAMS='&lego3d=1', BASE=snapshot server; baseline PARAMS='&lego3d=0' or none). Derived from the pilot's scene driver. Before / after screenshots of the LEGO 3D pilot (headless, muted). Run through the bot slot:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/" tools/lego3d/steps/pilot.mjs --profile /tmp/le2-lego3d --size 1024x768 --out $OUT
// env: MOD=<mod folder> imports it (replaces an earlier copy of the same title) and plays with it; MOD unset + OFF=1 plays with `&mods=off` (the baseline); PREFIX names the files;
// SPOTS="name:x,z,lookX,lookZ:view:dist" with view front|side|back|chase (default list below). The camera of the shot is patched in the page (the harness only; no engine change).
const DEF = 'plaza:430,-90,300,-90:front:6;side:430,-90,300,-90:side:6;chase:430,-90,300,-90:chase:0';
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = process.env.BASE ?? 'http://localhost:5744/';
  await page.waitForSelector('.bdb-start');
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'pilot';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2, null, { timeout: 600000 });
  await wait(1500);
  const stat = () => evaluate(() => { const i = window.__zone.gr.info; return { draws: i.draws, triangles: i.triangles }; });
  const frames = (ms) => page.evaluate((ms) => new Promise((res) => {
    const d = []; let last = performance.now(); const end = last + ms;
    const f = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ n: d.length, medianMs: +d[d.length >> 1].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1) }); } };
    requestAnimationFrame(f);
  }), ms);
  if (process.env.CUT) {
    // look at the opening cutscene instead of skipping it: a shot every CUTGAP ms
    for (let i = 0; i < +(process.env.CUT); i++) { await wait(+(process.env.CUTGAP ?? 1500)); log('cutscene', i, JSON.stringify(await evaluate(() => window.__zone.game?.debug?.().cutscene ?? null)), JSON.stringify(await stat())); await shot(`${prefix}-cut${i}`); }
  }
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  log('lego3d report:', JSON.stringify(await evaluate(() => window.__lego3d ? { failed: window.__lego3d.failed, archives: Object.fromEntries(Object.entries(window.__lego3d.archives).map(([k, v]) => [k, [v.files, v.cached, v.ms]])) } : null)));
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  for (const spot of (process.env.SPOTS ?? DEF).split(';')) {
    const [name, pos, view = 'chase', dist = '6'] = spot.split(':');
    const wait2 = +(process.env.SETTLE ?? 2000);
    const [x, z, fx, fz] = pos.split(',').map(Number);
    await evaluate(([x, z, fx, fz, view, dist]) => {
      const zz = window.__zone, w = zz.world, p = zz.loaded.pepper;
      p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g;
      p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
      if (!w.camera.__chase) w.camera.__chase = w.camera.chase;
      if (view === 'chase') { w.camera.chase = w.camera.__chase; return; }
      if (view === 'free') {   // dist = "ex|ey|ez|tx|ty|tz": a fixed camera in island coordinates
        const [ex, ey, ez, tx, ty, tz] = String(dist).split('|').map(Number);
        w.camera.chase = function () { const c = this.c; c[0] = ex; c[1] = ey; c[2] = ez; c[3] = tx; c[4] = ty; c[5] = tz; this.updateView(); };
        return;
      }
      w.camera.chase = function () {
        const q = zz.loaded.pepper, c = this.c, fx2 = Math.sin(q.ry), fz2 = Math.cos(q.ry);
        const d = +dist;
        const dir = view === 'front' ? [fx2, fz2] : view === 'back' ? [-fx2, -fz2] : [fz2, -fx2];
        c[3] = q.x; c[4] = q.y + 2.3; c[5] = q.z;
        c[0] = q.x + dir[0] * d; c[1] = q.y + 2.6; c[2] = q.z + dir[1] * d;
        this.updateView();
      };
    }, [x, z, fx, fz, view, dist]);
    const walking = name.startsWith('walk');
    if (walking) await page.keyboard.down('ArrowUp');
    await wait(wait2);
    await shot(`${prefix}-${name}`);
    if (walking) { await wait(300); await shot(`${prefix}-${name}b`); await page.keyboard.up('ArrowUp'); }
    log(name, JSON.stringify(await stat()), 'frames', JSON.stringify(await frames(2500)), 'studs', JSON.stringify(await evaluate(() => window.__legoStuds ?? null)));
    if (process.env.WHYLIT) {
      // which meshes does the CPU light every frame, and why (draw mode / lights object changing)
      await evaluate(() => {
        const gr = window.__zone.gr, r = gr.renderer;
        const od = r.drawMesh.bind(r), ol = r.lightMesh.bind(r);
        let cur = null; window.__why = new Map(); window.__lights = new Set();
        r.drawMesh = (m, w, t, o = {}) => { cur = { mode: o.mode ?? 0, lit: o.lit ?? null, preset: o.preset ?? null, skinned: !!o.skinned, wasLit: m.lit, same: m.litFor === r.lights }; window.__lights.add(r.lights); return od(m, w, t, o); };
        r.lightMesh = (m, w, sk) => { const k = `${cur?.mode}/${cur?.lit}/${cur?.skinned}/wasLit=${cur?.wasLit}/sameLights=${cur?.same}`; const e = window.__why.get(k) ?? { calls: 0, verts: 0 }; e.calls++; e.verts += m.msh.vertexCount; window.__why.set(k, e); return ol(m, w, sk); };
      });
      await wait(2000);
      log(name, 'why-lit (2 s)', JSON.stringify(await evaluate(() => ({ why: [...window.__why], distinctLightObjects: window.__lights.size }))));
    }
  }
};
