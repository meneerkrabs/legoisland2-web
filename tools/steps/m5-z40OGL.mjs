// M5 z40OGL bot: plays the hub's part of story nodes 64 and 66 with real key input (arrows), from the arrival to the hand-over.
//   node 64: arrival cutscene OGL04, walk the PATH route 62 61 60 43 44 45 46 47 48 49 50 51 52 63 to the pizzeria door (var 256 := 1) -> story node 65 (z41MAP)
//   node 66: arrival cutscene OGL01, climb the PATH route 63 52 51 ... 4 3 to the palace (OGL03, var 257 := 1) -> node 67 (z42BRP)
//   BASE=http://localhost:5516 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5516/?zone=z40OGL&node=64&mute=1&hold=1&debug=1" tools/steps/m5-z40OGL.mjs --size 1280x800 --out /tmp/m5-z40OGL
// Env: NODE=64|66 (default 64). The route is read from the game's own waypoint map (ictx.pathPos) following the stored hop order below.
import { hub, hubUrl } from './lib-hub.mjs';
const ROUTES = { 64: [62, 61, 60, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 63], 66: [63, 52, 51, 50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3] };
export default async ({ page, wait, log, shot }) => {
  const node = Number(process.env.NODE ?? 64);
  await page.goto(hubUrl('z40OGL', node), { waitUntil: 'load' });
  const H = hub({ page, wait, log, shot }, 'z40OGL');
  await H.waitHub(); await wait(800);
  await H.start();
  const snap = () => page.evaluate(() => { const z = window.__zone, v = z.sh.vars, p = z.loaded.pepper;
    return { t: z.world.tickCount, node: v.get(0x58), ctrl: v.get(0x5e), cs: z.ctx.cutscene.active(), x: p.x, y: p.y, z: p.z, ry: p.ry, v256: v.get(256), v257: v.get(257), v31: v.get(0x31), score: v.get(0x25), left: z.hud.leftText, zone: z.info.archive }; });
  // arrival cutscene (it holds Pepper: the cutscene ends by itself; Shift skips)
  let s = await snap();
  log('arrival', JSON.stringify(s)); await shot(`n${node}-arrival`);
  for (let i = 0; i < 400 && (await snap()).cs; i++) await wait(250);
  await H.freePepper();
  s = await snap(); log('after cutscene', JSON.stringify(s)); await shot(`n${node}-free`);
  const route = ROUTES[node];
  const pos = await Promise.all(route.map((n) => page.evaluate((i) => [...window.__zone.game.ictx.pathPos(i)], n)));
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const held = new Set(); let lastProgress = Date.now(), fell = false, unstuck = 0, falls = 0, trace = 0, wi = 1, stuck = 0, last = null, shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 900000) {
    s = await snap();
    if (s.zone !== 'z40OGL') break;
    const nd = (await page.evaluate(() => window.__zone.sh.vars.get(0x58)));
    if (nd !== node) break;
    if (s.cs) { await H.skipCutscenes(); continue; }
    if (wi >= route.length) { await wait(300); continue; }
    if (s.ctrl & 0x20) { fell = true; await wait(200); last = s; continue; }   // falling / being put back (PEPPER_CONTROL 0x20)
    if (fell) { fell = false; falls++; wi = Math.max(1, wi - 2); log('respawn after a fall, continuing at route index', wi, 'falls', falls);
      // the same fall again and again: turn a random amount first (the bot's steering is deterministic)
      if (falls % 3 === 0) { for (const k of [...held]) { await page.keyboard.up(k); held.delete(k); } const kk = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(kk); await wait(300 + Math.random() * 700); await page.keyboard.up(kk); } }
    const look = Math.hypot(pos[wi][0] - s.x, pos[wi][2] - s.z) < 14 && wi + 1 < route.length ? wi + 1 : wi;
    const [tx, , tz] = pos[look];
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(pos[wi][0] - s.x, pos[wi][2] - s.z);
    if (d < 8) { wi++; lastProgress = Date.now(); continue; }
    const err = wrap(Math.atan2(dx, dz) - s.ry);
    if (Date.now() - lastProgress > 40000) { lastProgress = Date.now(); log('no progress at route index', wi, JSON.stringify({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1) })); await shot(`n${node}-noprogress${wi}`); for (const k of [...held]) { await page.keyboard.up(k); held.delete(k); } const kk = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down('ArrowDown'); await page.keyboard.down(kk); await wait(1500); await page.keyboard.up('ArrowDown'); await page.keyboard.up(kk); }
    const want = new Set();
    if (err > 0.05) want.add('ArrowRight'); else if (err < -0.05) want.add('ArrowLeft');
    want.add('ArrowUp');
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    const keys = [...held];
    await wait(45);
    if (last && Math.hypot(last.x - s.x, last.z - s.z) < 0.05) stuck++; else stuck = 0;
    if (stuck > 12) {   // wedged against geometry: back out with Down while turning toward the target, then go on
      for (const k of [...held]) { await page.keyboard.up(k); held.delete(k); }
      const k2 = err > 0 ? 'ArrowRight' : 'ArrowLeft';
      await page.keyboard.down('ArrowDown'); await page.keyboard.down(k2); await wait(900); await page.keyboard.up('ArrowDown'); await page.keyboard.up(k2);
      stuck = 0; unstuck++;
    }
    last = s;
    if (process.env.TRACE && (++trace % 25 === 0)) log('trace', wi, route[wi], JSON.stringify({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), ry: +s.ry.toFixed(2), ctrl: s.ctrl, err: +err.toFixed(2), keys: keys.join('+') }));
    if (s.y < -140) { log('fell', JSON.stringify(s)); await shot(`n${node}-fell`); break; }
    if (wi % 5 === 0 && shots < wi) { shots = wi; log('wp', wi, route[wi], JSON.stringify({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), v31: s.v31, score: s.score, left: s.left })); await shot(`n${node}-wp${wi}`); }
  }
  for (const k of [...held]) await page.keyboard.up(k);
  s = await snap(); log('end', JSON.stringify(s)); await shot(`n${node}-end`);
  await wait(3000);
  const z = await page.evaluate(() => ({ zone: window.__zone?.info.archive, node: window.__zone?.sh.vars.get(0x58) }));
  log('handover', JSON.stringify(z));
};
