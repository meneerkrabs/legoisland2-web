import { island } from './lib-island.mjs';
export function qa(h) {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  const S = island(h);
  const Q = { S, errs, page, wait, log, shot, evaluate };
  /** install sampler (per sim tick) + sound log */
  Q.install = () => evaluate(() => {
    const z = window.__zone, w = z.world, ic = z.game.ictx, P = z.loaded.pepper;
    window.__log = []; window.__snd = []; window.__rec = false;
    const names = ['TRNL', 'TRNT', 'TRNC', 'PTER', 'GLDR', 'SUPE'];
    const R = {}; for (const n of names) R[n] = w.records.find((r) => r.name === n);
    const f = (v) => +(+v).toFixed(2);
    const prev = w.afterTick;
    w.afterTick = (ww) => {
      if (prev) prev(ww);
      if (!window.__rec) return;
      const c = ww.camera.c, o = { t: ww.tickCount, dt: +ww.dt.toFixed(3), P: [f(P.x), f(P.y), f(P.z), f(P.ry)], pc: z.sh.vars.get(0x5e), v5: z.sh.vars.get(0xc5), ic: z.sh.vars.get(0x0c), cam: [f(c[0]), f(c[1]), f(c[2]), f(c[3]), f(c[4]), f(c[5])], clip: P.anim?.clip ?? null };
      for (const n of names) { const r = R[n]; if (r && (r.enabled || n === 'TRNL')) o[n] = [f(r.x), f(r.y), f(r.z), f(r.ry), f(r.rx), f(r.rz)]; }
      if (window.__ext) Object.assign(o, window.__ext(ww));
      window.__log.push(o);
    };
    const wrap = (obj, name) => { const o = obj[name]?.bind(obj); if (!o) return; obj[name] = (...a) => { window.__snd.push([w.tickCount, name, ...a.map((x) => (Array.isArray(x) ? x.map(f) : x))]); return o(...a); }; };
    wrap(ic, 'sfx'); wrap(ic, 'sfxAt'); wrap(ic, 'stopSfx');
    window.__ext = () => { const a = window.__shell.audio; const g = (k, id) => (a.slot(k, id)?.playing ? 1 : 0); return { s: [g('3d', 249), g('3d', 355), g('3d', 252)], s2: [g('2d', 252), g('2d', 0x303), g('2d', 0x302)] }; };
    return 'ok';
  });
  Q.rec = (on) => evaluate((on) => { window.__rec = on; }, on);
  Q.take = () => evaluate(() => { const l = window.__log; window.__log = []; return l; });
  Q.snd = () => evaluate(() => { const l = window.__snd; window.__snd = []; return l; });
  Q.key = async (k, ticks = 3) => { await page.keyboard.down(k); await S.untilTicks(async () => false, ticks, 15); await page.keyboard.up(k); };
  Q.start = async () => { await S.start(); await S.skipCutscenes(); };
  return Q;
}
