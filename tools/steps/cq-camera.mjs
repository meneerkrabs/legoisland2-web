// Camera QA on the island: the chase camera in walking / skateboard / swimming / boats / helicopter / car, per-tick metrics + frames (contact sheets with tools/qa-cut-sheet.sh):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&mute=1" tools/steps/cq-camera.mjs --out /tmp/cq/camera        (WIDE=1 in the environment: widescreen; ONLY=walk,skate: a subset)
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  await S.start();
  await S.skipCutscenes();
  await wait(300);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const prefix = process.env.PREFIX ?? 'cam';
  // recorder: one row per input sample (= per simulation step)
  await page.evaluate(() => {
    const im = window.__shell.input, o = im.update.bind(im), z = window.__zone;
    window.__rec = []; window.__recOn = false;
    im.update = () => {
      o();
      if (!window.__recOn) return;
      const w = z.world, c = w.camera.c, f = w.focus ?? z.loaded.pepper;
      const th = w.col.terrainHeight(c[0], c[1] + 4, c[2], 0);
      window.__rec.push([c[0], c[1], c[2], c[3], c[4], c[5], f.x, f.y, f.z, th > -1e30 ? th : NaN, w.camera.vehicle ? 1 : 0, z.machine.mode, w.tickCount]);
    };
  });
  const start = (n) => page.evaluate(() => { window.__rec = []; window.__recOn = true; });
  const stop = () => page.evaluate(() => { window.__recOn = false; return window.__rec; });
  const stats = (rec, name) => {
    const n = rec.length;
    const rel = rec.map((r) => [r[0] - r[6], r[1] - r[7], r[2] - r[8]]);
    let maxStep = 0, maxJerk = 0, below = 0, minAbove = 1e9, dmin = 1e9, dmax = 0, hmin = 1e9, hmax = 0, flips = 0, lastS = 0, maxUp = 0;
    for (let i = 0; i < n; i++) {
      const r = rec[i];
      const d = Math.hypot(r[0] - r[3], r[1] - r[4], r[2] - r[5]), hd = Math.hypot(r[0] - r[3], r[2] - r[5]);
      dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); hmin = Math.min(hmin, hd); hmax = Math.max(hmax, hd);
      if (!Number.isNaN(r[9])) { const a = r[1] - r[9]; minAbove = Math.min(minAbove, a); if (a < 0) below++; }
      if (i > 0) {
        const e = Math.hypot(rel[i][0] - rel[i - 1][0], rel[i][1] - rel[i - 1][1], rel[i][2] - rel[i - 1][2]);
        maxStep = Math.max(maxStep, e);
        const dy = rel[i][1] - rel[i - 1][1]; const s = Math.abs(dy) < 1e-4 ? 0 : Math.sign(dy);
        if (s && lastS && s !== lastS) flips++; if (s) lastS = s;
        maxUp = Math.max(maxUp, Math.abs(dy));
      }
      if (i > 1) maxJerk = Math.max(maxJerk, Math.hypot(rel[i][0] - 2 * rel[i - 1][0] + rel[i - 2][0], rel[i][1] - 2 * rel[i - 1][1] + rel[i - 2][1], rel[i][2] - 2 * rel[i - 1][2] + rel[i - 2][2]));
    }
    log(`  ${name}: ${n} steps; eye-target distance ${dmin.toFixed(1)}..${dmax.toFixed(1)}, horizontal ${hmin.toFixed(1)}..${hmax.toFixed(1)}; eye above terrain min ${minAbove.toFixed(2)} (below in ${below}); max relative step ${maxStep.toFixed(2)}, max |second difference| ${maxJerk.toFixed(2)}, vertical direction flips ${flips}, max vertical step ${maxUp.toFixed(2)}`);
  };
  const frames = async (name, ms, keys, every = 4) => {
    // hold `keys` (array of arrays: [{down:[..], up:[..]}...]) over ms, a screenshot every `every`-th slice
    let k = 0;
    const slice = ms / 16;
    for (let i = 0; i < 16; i++) {
      const kk = keys(i);
      for (const c of kk.down ?? []) await page.keyboard.down(c);
      for (const c of kk.up ?? []) await page.keyboard.up(c);
      await wait(slice);
      if (i % (16 / every) === 0) await shot(`${prefix}-${name}-${String(++k).padStart(2, '0')}`);
    }
  };
  const run = async (name, setup, keys, ms) => {
    if (only && !only.includes(name)) return;
    log(`== ${name}`);
    await setup();
    await wait(400);
    await start();
    await frames(name, ms, keys);
    const rec = await stop();
    for (const c of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space', 'ShiftLeft', 'AltLeft']) await page.keyboard.up(c);
    stats(rec, name);
    const st = await S.state();
    log(`  mode ${st.mode} ctrl ${st.ctrl} pos ${st.pos}`);
    await S.tap('ControlLeft', 100); await wait(500);   // leave the vehicle / board
    return rec;
  };
  const fwd = (i) => i === 0 ? { down: ['ArrowUp'] } : i === 5 ? { down: ['ArrowLeft'] } : i === 7 ? { up: ['ArrowLeft'] } : i === 10 ? { down: ['ArrowRight'] } : i === 12 ? { up: ['ArrowRight'] } : {};
  const fwdGas = (i) => i === 0 ? { down: ['Space'] } : i === 5 ? { down: ['ArrowLeft'] } : i === 7 ? { up: ['ArrowLeft'] } : i === 10 ? { down: ['ArrowRight'] } : i === 12 ? { up: ['ArrowRight'] } : {};
  const board = (n, d = 5) => async () => { await S.teleportNear(n, d, 0.5); await wait(300); await S.tap('ControlLeft', 100); await wait(700); };
  await run('walk', async () => { await S.teleportNear('INFO', 40, 0.8); }, fwd, 6000);
  await run('walkjump', async () => { await S.teleportNear('INFO', 40, 2.0); }, (i) => i === 0 ? { down: ['ArrowUp'] } : i % 4 === 1 ? { down: ['AltLeft'] } : i % 4 === 2 ? { up: ['AltLeft'] } : {}, 6000);
  await run('skate', async () => { await S.teleportNear('INFO', 40, 1.2); await wait(300); await S.tap('ControlLeft', 100); await wait(500); }, fwd, 6000);
  await run('swim', async () => { await S.teleportNear('SPBT', 14, 0.5); }, fwd, 6000);
  await run('boat', board('SPBT'), fwdGas, 7000);
  await run('jetski', board('JSKI'), fwdGas, 7000);
  await run('heli', board('PHEL'), fwdGas, 7000);
  await run('car', board('PCAR'), fwdGas, 7000);
};
