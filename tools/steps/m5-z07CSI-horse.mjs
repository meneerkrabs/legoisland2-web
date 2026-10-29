// M5 z07CSI, the horse: a headless bot with REAL key input rides the castle's horse HORS (src/zones/z07CSI/horse/): mount with Ctrl, trot / gallop (Space), turn, reverse, jump (Alt), the busy flag
// (Ctrl does not get off in the air), dismount at a free spot, mount again, ride to the Lion castle (the story trigger at PATH node 6 starts csi05), a wall in the way.
//   CSI_PORT=5519 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5519/?zone=z07CSI&node=21&mute=1&hold=1&debug=1" tools/steps/m5-z07CSI-horse.mjs --size 1280x800 --out /tmp/m5-z07CSI-horse
import { csi, url, wrap } from './lib-z07CSI.mjs';

export default async (h) => {
  const { page, wait, log } = h;
  const S = csi(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  /** the horse, Pepper and the camera as the page has them */
  const horse = () => page.evaluate(() => {
    const z = window.__zone, w = z.world, r = w.records.find((x) => x.name === 'HORS'), n = r.ctrl.nodes.find((x) => x.kind === 'Horse'), g = w.ext.get('island.vehicles'), p = z.loaded.pepper;
    const jk = w.records.find((x) => x.name === 'JKIT');
    return { x: r.x, y: r.y, z: r.z, ry: r.ry, rx: r.rx, clip: r.anim?.clip ?? -1, frame: r.anim?.frame ?? -1, flags: r.flags, st: n.st, hop: n.hop, turn: n.turnRate, v112: z.sh.vars.get(0x112), ctrl: z.sh.vars.get(0x5e),
      cur: g.current?.name ?? null, kind: g.kind, px: p.x, py: p.y, pz: p.z, pry: p.ry, pclip: p.anim?.clip ?? -1, pvis: (p.flags & 2) !== 0, jkvis: (jk.flags & 2) !== 0, tick: w.tickCount, node: z.sh.vars.get(0x58),
      cam: Array.from(w.camera.c.slice(0, 6)), cs: !!z.game?.debug?.().cutscene, arch: z.info.archive, active: n.active, pending: n.pending, stamp: n.stamp };
  });
  const speed = async (ms) => { const a = await horse(); await wait(ms); const b = await horse(); return { v: Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1, b.tick - a.tick), a, b }; };
  const down = (k) => page.keyboard.down(k), up = (k) => page.keyboard.up(k);
  const holdKeys = async (keys, ticks) => { for (const k of keys) await down(k); await S.untilTicks(async () => false, ticks, 15); for (const k of keys) await up(k); };

  // ---- the way to the horse: the castle at story node 19 (csi02 plays at once), then on foot to the Bull castle's gate (PATH node 80): csi04 starts and story node 21 begins: the story handler
  //      puts Pepper on the horse (var 0x112 := 1, PEPPER_CONTROL 0x10, HORS gets Pepper's matrix). (A start at node 19 arrives by boat, like every start from the island: the bot walks her ashore at the
  //      place the original gives Pepper after the bridge mini-game: the boat is dropped, PEPPER_CONTROL 1.)
  await page.goto(url(19), { waitUntil: 'load' });
  await S.waitHub();
  await S.start();
  await S.untilTicks(async () => (await S.state()).cs === true, 200);
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 20, 400);
  await page.evaluate(() => {
    const z = window.__zone, w = z.world, g = w.ext.get('island.vehicles'), p = z.loaded.pepper;
    g.current = null; z.sh.vars.set(0x5e, 1);
    const boat = w.records.find((r) => r.name === 'SPBT');            // the speedboat is moored in the original: its own variable is 0 (else its node keeps driving the camera)
    for (const n of boat?.ctrl?.nodes ?? []) if (n.kind === 'SGBoat') z.sh.vars.set(n.var, 0);
    p.x = -65.6; p.z = -6.8; p.y = w.col.groundRay(p.x, 200, p.z); p.ry = 0; p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  });
  await wait(400);
  let t = await S.state();
  expect('Pepper on foot in the castle at story node 20 (PEPPER_CONTROL 1)', t.arch === 'z07CSI' && t.node === 20 && (t.ctrl & 0xff) === 1, JSON.stringify(t));
  await S.freePepper();
  const gate = await S.pathNode(80);
  let nw = 0;
  const stop20 = async (p) => { if (++nw % 40 === 0) log('  walk', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), node: p.node, cs: p.cs, tick: p.tick, ctrl: p.ctrl, clip: p.clip })); return p.node !== 20 || p.cs || p.arch !== 'z07CSI'; };
  const stop20b = async (p) => {
    if (nw === 100) {
      await S.shot('dbg-walk-stuck');
      log('near Pepper:', JSON.stringify(await page.evaluate(() => { const z = window.__zone, pp = z.loaded.pepper; return z.world.records.filter((r) => Math.hypot(r.x - pp.x, r.z - pp.z) < 12 && r !== pp).map((r) => ({ n: r.name, x: +r.x.toFixed(0), y: +r.y.toFixed(0), z: +r.z.toFixed(0), f: r.flags.toString(16) })); })));
    }
    if (nw > 140) return true;
    return stop20(p);
  };
  const r20 = await S.walkTo(gate[0], gate[2], { tol: 8, maxTicks: 4000, stop: stop20b });
  log('walk to the Bull castle gate', JSON.stringify(r20));
  await S.untilTicks(async () => (await S.state()).cs === true, 200);
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 21, 400);
  await wait(500);
  let s = await horse();
  log('story node 21', JSON.stringify({ ...s, cam: undefined }));
  await S.shot('horse-01-node21');
  expect('node 21 in the castle: the story put Pepper on the horse (PEPPER_CONTROL 0x10, var 0x112 & 1)', (s.ctrl & 0xff) === 0x10 && (s.v112 & 1) === 1 && s.cur === 'HORS', JSON.stringify({ ctrl: s.ctrl, v112: s.v112, cur: s.cur }));
  // the story's start (var 0x112 := 1) gives no jumping: Pepper is on the horse, visible, JKIT hidden (not a jousting stage), the kind -4
  // (the story starts the ride without Ctrl: the horse's pre-render leaves the vehicle kind alone while `pending` is 0 and Ctrl is not pressed: kind 0 until the first mount)
  expect('riding: Pepper visible, the jockey kit hidden, the rider clip 0xb8 (not a jousting stage)', s.pvis && !s.jkvis && s.pclip === 0xb8, JSON.stringify({ pvis: s.pvis, jk: s.jkvis, kind: s.kind, pclip: s.pclip }));
  await wait(500);

  // ---- the ride: trot (Up), gallop (Space), reverse (Down), turns, jump
  await down('ArrowUp'); await wait(800);
  let v = await speed(1200);
  await S.shot('horse-02-trot');
  const trot = v.v;
  expect('Up: the horse trots (1/3 unit per tick, clip 2)', Math.abs(trot - 1 / 3) < 0.08 && v.b.clip === 2, JSON.stringify({ trot, clip: v.b.clip, st: v.b.st }));
  await up('ArrowUp');
  await S.tap('Space', 70);
  await wait(200);
  await down('ArrowUp'); await wait(600);
  v = await speed(1200);
  await S.shot('horse-03-gallop');
  expect('Space toggles the gallop (1 unit per tick, clip 3, state bit 1)', Math.abs(v.v - 1) < 0.15 && v.b.clip === 3 && (v.b.st & 1) === 1, JSON.stringify({ v: v.v, clip: v.b.clip, st: v.b.st }));
  expect('while the horse moves Pepper sits on it (her pose = the horse\'s)', Math.hypot(v.b.px - v.b.x, v.b.pz - v.b.z) < 0.01 && Math.abs(wrap(v.b.pry - v.b.ry)) < 0.01, JSON.stringify({ d: Math.hypot(v.b.px - v.b.x, v.b.pz - v.b.z) }));
  // the camera follows: the eye 24 behind and 12.8 above the horse, looking at it (+ 4.8)
  const b0 = v.b;
  const dEye = Math.hypot(b0.cam[0] - b0.x, b0.cam[2] - b0.z);
  expect('the camera looks at the horse (+ 4.8 up) and sits behind it', Math.abs(b0.cam[3] - b0.x) < 0.5 && Math.abs(b0.cam[4] - (b0.y + 4.8)) < 0.5 && dEye > 10 && dEye < 45, JSON.stringify({ dEye, tgt: [b0.cam[3] - b0.x, b0.cam[4] - b0.y, b0.cam[5] - b0.z] }));
  await up('ArrowUp');
  await S.tap('Space', 70);
  await wait(300);

  // turning: Left / Right with Up held: the yaw changes (the turn rate grows)
  const y0 = (await horse()).ry;
  await holdKeys(['ArrowUp', 'ArrowRight'], 20);
  const y1 = (await horse()).ry;
  await holdKeys(['ArrowUp', 'ArrowLeft'], 20);
  const y2 = (await horse()).ry;
  expect('Right turns the horse clockwise (the yaw grows), Left the other way', wrap(y1 - y0) > 0.4 && wrap(y2 - y1) < -0.4, JSON.stringify({ right: wrap(y1 - y0), left: wrap(y2 - y1) }));
  await S.shot('horse-04-turning');

  // reverse: Down walks backwards (the matrix' forward points away from the movement)
  await wait(300);
  const r0 = await horse();
  await holdKeys(['ArrowDown'], 40);
  const r1 = await horse();
  const fwd = [Math.sin(r0.ry), Math.cos(r0.ry)], mv = [r1.x - r0.x, r1.z - r0.z];
  expect('Down: the horse backs up (movement against the heading)', mv[0] * fwd[0] + mv[1] * fwd[1] < -1, JSON.stringify({ dot: mv[0] * fwd[0] + mv[1] * fwd[1], clip: r1.clip, st: r1.st }));
  await wait(500);

  // jump: hold Alt (the hop grows), release: clip 6, the horse rises and comes down, the busy bit of var 0x112 (0x10) is set meanwhile and Ctrl does not get off
  await down('ArrowUp'); await down('AltLeft'); await wait(350); await up('AltLeft');
  let maxY = -1e9, busy = false, clip6 = false, ctrlStay = false;
  const base = (await horse()).y;
  for (let i = 0; i < 30; i++) {
    await wait(40);
    const j = await horse();
    maxY = Math.max(maxY, j.y - base);
    if (j.clip === 6) clip6 = true;
    if ((j.v112 & 0x10) !== 0) { busy = true; if (!ctrlStay) { await S.tap('ControlLeft', 60); ctrlStay = true; await wait(120); const k = await horse(); ctrlStay = (k.ctrl & 0xff) === 0x10 && (k.v112 & 1) === 1; } }
    if (j.clip === 6 === false && clip6 && (j.st & 0x10) === 0) break;
  }
  await up('ArrowUp');
  await S.shot('horse-05-after-jump');
  expect('Alt (held, then released) makes the horse jump (clip 6, the height changes)', clip6 && Math.abs(maxY) > 0.5, JSON.stringify({ clip6, maxY }));
  expect('in the air the busy bit (var 0x112 & 0x10) is set and Ctrl does not get off', busy && ctrlStay, JSON.stringify({ busy, ctrlStay }));
  await wait(1200);
  s = await horse();
  expect('after the jump the horse is not busy any more (var 0x112 & 0x10 clear)', (s.v112 & 0x10) === 0 && (s.v112 & 1) === 1, JSON.stringify({ v112: s.v112, st: s.st, clip: s.clip }));

  // ---- Ctrl: get off at a free spot (mode 0x401 for one tick, then walking), the horse stands there and grazes (clip 5)
  await S.tap('ControlLeft', 80);
  await S.untilTicks(async () => ((await horse()).ctrl & 0xff) === 1, 120);
  await wait(600);
  s = await horse();
  await S.shot('horse-06-dismounted');
  expect('Ctrl: Pepper gets off (PEPPER_CONTROL 1, no vehicle, var 0x112 & 1 clear, she is visible)', (s.ctrl & 0xff) === 1 && s.cur === null && (s.v112 & 1) === 0 && s.pvis, JSON.stringify({ ctrl: s.ctrl, cur: s.cur, v112: s.v112, pvis: s.pvis }));
  expect('the horse stands and grazes (clip 5), Pepper stands next to it', s.clip === 5 && Math.hypot(s.px - s.x, s.pz - s.z) < 25, JSON.stringify({ clip: s.clip, d: Math.hypot(s.px - s.x, s.pz - s.z) }));
  expect('the horse is visible, the jockey kit hidden', (s.flags & 2) !== 0 && !s.jkvis, JSON.stringify({ flags: s.flags, jk: s.jkvis }));

  // the horse and its saddle from the side and the front (the saddle record GSAD follows the horse's matrix)
  for (const [ang, nm] of [[Math.PI / 2, 'side'], [Math.PI, 'front']]) {
    const hz = await horse();
    await page.evaluate(([a, hx, hz, hry]) => {
      const z = window.__zone, w = z.world, p = z.loaded.pepper, h = w.records.find((r) => r.name === 'HORS');
      const x = h.x + Math.sin(h.ry + a) * 7, zz = h.z + Math.cos(h.ry + a) * 7;
      p.x = x; p.z = zz; const g = w.col.groundRay(x, 200, zz); if (g > -1e30) p.y = g;
      p.ry = Math.atan2(h.x - x, h.z - zz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    }, [ang, hz.x, hz.z, hz.ry]);
    await wait(700);
    await S.shot(`horse-06b-${nm}`);
  }
  log('saddle records', JSON.stringify(await page.evaluate(() => ['RSAD', 'GSAD', 'CLOK'].map((n) => { const z = window.__zone, r = z.world.records.find((x) => x.name === n), h = z.world.records.find((x) => x.name === 'HORS'); return { n, flags: r.flags, d: +Math.hypot(r.x - h.x, r.z - h.z).toFixed(2), clip: r.anim?.clip }; }))));
  // ---- walk away and back (the horse's icon: var 0xc bit 2 within the vehicle range), mount again with Ctrl
  await S.teleportNear('HORS', 40, 2.0);   // (the vehicle range is 24 units: DAT_008ae330 = 576 = 24 squared)
  await wait(500);
  const hh = await horse();
  // the interaction icon (the HUD's column slot 0, texture 1 = the steering wheel for var 0xc bits 2 / 4 / 8 / 0x10): the horse sets bit 2 every tick while Pepper is within the vehicle range
  const icon = () => page.evaluate(() => window.__zone.game.ctx.hud.column[0]?.tex ?? -1);
  const sample = async () => { let m = -1; for (let i = 0; i < 40; i++) { m = Math.max(m, await icon()); await wait(25); } return m; };
  const iconFar = await sample();
  await S.teleportNear('HORS', 4, 2.0);
  await wait(300);
  const iconNear = await sample();
  log('interaction icon texture (far / near):', iconFar, iconNear);
  expect('next to the horse the interaction icon (steering wheel, texture 1) shows, far from it it does not', iconNear === 1 && iconFar !== 1, JSON.stringify({ iconFar, iconNear }));
  await S.tap('ControlLeft', 80);
  await S.untilTicks(async () => (((await horse()).ctrl) & 0xff) === 0x10, 120);
  await wait(500);
  s = await horse();
  await S.shot('horse-07-mounted-again');
  expect('Ctrl next to the horse: Pepper gets on (PEPPER_CONTROL 0x10, the horse is her vehicle, var 0x112 & 1)', (s.ctrl & 0xff) === 0x10 && s.cur === 'HORS' && (s.v112 & 1) === 1 && s.kind === -4, JSON.stringify({ ctrl: s.ctrl, cur: s.cur, v112: s.v112, kind: s.kind }));
  void hh;

  // ---- a wall in the way: ride at the Bull castle's wall (BCAS: the horse is turned along it / stopped, never through it)
  const bull = await S.at('BCAS');
  await page.evaluate(([bx, bz]) => {
    const z = window.__zone, w = z.world, r = w.records.find((x) => x.name === 'HORS');
    // put the horse 70 units from the castle (on the side facing the island's middle), heading at it
    const dx = -bx, dz = -bz, l = Math.hypot(dx, dz);
    const px = bx + (dx / l) * 70, pz = bz + (dz / l) * 70;
    const g = w.col.terrainHeight(px, 200, pz, 0);
    r.setEuler(0, Math.atan2(bx - px, bz - pz), 0, px, g, pz); r.rx = 0; r.ry = Math.atan2(bx - px, bz - pz); r.rz = 0;
    w.camera.init(r);
  }, [bull[0], bull[2]]);
  await wait(400);
  await down('ArrowUp'); await S.tap('Space', 70);
  let minD = 1e9, last = null, stuckTicks = 0;
  for (let i = 0; i < 60; i++) {
    await wait(100);
    const j = await horse();
    minD = Math.min(minD, Math.hypot(j.x - bull[0], j.z - bull[2]));
    if (last && Math.hypot(j.x - last.x, j.z - last.z) < 0.02) stuckTicks++;
    last = j;
  }
  await up('ArrowUp');
  await S.shot('horse-08-castle-wall');
  const wallState = await horse();
  expect('riding at the castle: the horse did not pass through the walls (it stays outside the castle\'s body)', minD > 10, JSON.stringify({ minD, at: [wallState.x, wallState.z] }));
  log('wall ride', JSON.stringify({ minD, stuckTicks }));

  // ---- the story: ride to the Lion castle (PATH node 6): the trigger starts csi05 (the horse nodes keep running next to the cutscene)
  const lion = await S.pathNode(6);
  await page.evaluate(([lx, lz]) => {
    // start from a place on the way: 60 units south-west of the Lion castle on the island's side
    const z = window.__zone, w = z.world, r = w.records.find((x) => x.name === 'HORS');
    const dx = -lx, dz = -lz, l = Math.hypot(dx, dz);
    const px = lx + (dx / l) * 60, pz = lz + (dz / l) * 60, g = w.col.terrainHeight(px, 200, pz, 0);
    r.setEuler(0, Math.atan2(lx - px, lz - pz), 0, px, g, pz); r.rx = 0; r.ry = Math.atan2(lx - px, lz - pz); r.rz = 0; w.camera.init(r);
  }, [lion[0], lion[2]]);
  await wait(500);
  s = await horse();
  expect('still on the horse', (s.ctrl & 0xff) === 0x10 && s.cur === 'HORS', JSON.stringify({ ctrl: s.ctrl, cur: s.cur }));
  // ride there: Up (gallop), Left / Right by the heading error; when the horse stops making progress (a tree, a wall, the rocks) it backs up and goes round (the way a player steers)
  let n = 0, side = 1;
  const rideTo = async (tx, tz, { tol = 10, maxTicks = 4000, stop = null } = {}) => {
    const t0 = (await horse()).tick;
    let hist = [], res = null;
    const set = async (k, want, cur) => { if (want && !cur) await down(k); if (!want && cur) await up(k); return want; };
    let kUp = false, kL = false, kR = false, kBack = false;
    for (;;) {
      const p = await horse();
      if (p.arch !== 'z07CSI') { res = { ok: false, left: p.arch }; break; }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d <= tol) { res = { ok: true, d, ticks: p.tick - t0 }; break; }
      if (p.tick - t0 > maxTicks) { res = { ok: false, d, ticks: p.tick - t0 }; break; }
      if (stop && (await stop(p))) { res = { ok: false, d, ticks: p.tick - t0, stopped: true }; break; }
      if (p.cs) { kUp = await set('ArrowUp', false, kUp); kL = await set('ArrowLeft', false, kL); kR = await set('ArrowRight', false, kR); await wait(80); continue; }
      if ((p.st & 1) === 0 && (p.v112 & 0x10) === 0) { await S.tap('Space', 70); }          // gallop
      hist.push(p); if (hist.length > 30) hist.shift();
      const moved = hist.length >= 30 ? Math.hypot(p.x - hist[0].x, p.z - hist[0].z) : 99;
      if (moved < 3) {
        // stuck: back up a little while turning one way, then go on in a direction 70 degrees off for a while
        log('  ride: stuck at', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0) }), 'backing up, side', side);
        kUp = await set('ArrowUp', false, kUp); kL = await set('ArrowLeft', false, kL); kR = await set('ArrowRight', false, kR);
        await down('ArrowDown'); await down(side > 0 ? 'ArrowRight' : 'ArrowLeft'); await S.untilTicks(async () => false, 18, 15); await up('ArrowDown'); await up(side > 0 ? 'ArrowRight' : 'ArrowLeft');
        await down('ArrowUp'); await down(side > 0 ? 'ArrowLeft' : 'ArrowRight'); await S.untilTicks(async () => false, 14, 15); await up(side > 0 ? 'ArrowLeft' : 'ArrowRight');
        await S.untilTicks(async () => false, 35, 15); await up('ArrowUp');
        side = -side; hist = []; continue;
      }
      const err = wrap(Math.atan2(dx, dz) - p.ry);
      const turn = Math.abs(err) > 0.12 ? Math.sign(err) : 0;
      kR = await set('ArrowRight', turn > 0, kR); kL = await set('ArrowLeft', turn < 0, kL); kUp = await set('ArrowUp', true, kUp);
      if (++n % 50 === 0) log('  ride', JSON.stringify({ x: +p.x.toFixed(0), z: +p.z.toFixed(0), d: +d.toFixed(0), node: p.node }));
      await wait(40);
    }
    await set('ArrowUp', false, kUp); await set('ArrowLeft', false, kL); await set('ArrowRight', false, kR);
    return res;
  };
  const stop = async (p) => p.node !== 21 || p.cs || p.arch !== 'z07CSI';
  const rr = await rideTo(lion[0], lion[2], { tol: 10, maxTicks: 6000, stop });
  log('ride to the Lion castle', JSON.stringify(rr));
  const cs = await S.untilTicks(async () => (await S.state()).cs === true, 300);
  await S.shot('horse-09-lion-castle');
  expect('node 21: riding to the Lion castle starts the cutscene csi05', cs, JSON.stringify(await S.state()));
  await wait(1500);
  await S.shot('horse-10-cutscene');
  await S.skipCutscenes();
  await S.untilTicks(async () => (await S.state()).node >= 22, 400);
  s = await horse();
  expect('after csi05: story node 22 (the Dark Knight appears)', s.node === 22, JSON.stringify({ node: s.node, ctrl: s.ctrl }));
  await S.shot('horse-11-node22');

  // the horse's sounds (hooves, jump, neigh) are in the zone's preload list (no lazy load): the audio host asked for none of them lazily
  const missed = await page.evaluate(() => [...(globalThis.__audioHost?.missed ?? [])]);
  const horseSounds = ['3d:669', '3d:716', '3d:717', '3d:718', '3d:719', '3d:630', '3d:632', '2d:633', '2d:647', '2d:649', '2d:631', '2d:668'];
  log('sounds asked for that the zone list did not hold:', JSON.stringify(missed));
  expect('the horse\'s sound ids are in the zone\'s preload list', horseSounds.every((k) => !missed.includes(k)), JSON.stringify(missed.filter((k) => horseSounds.includes(k))));
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'ALL OK');
};
