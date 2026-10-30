// M5 z40OGL bot: plays the hub's part of story nodes 64 and 66 with real key input (arrows), from the arrival to the hand-over.
//   node 64: arrival cutscene OGL04, walk the PATH route 62 61 60 43 44 45 46 47 48 49 50 51 52 63 to the pizzeria door (var 256 := 1) -> story node 65 (z41MAP)
//   node 66: arrival cutscene OGL01, climb the PATH route 63 52 51 ... 4 3 to the palace (OGL03, var 257 := 1) -> node 67 (z42BRP)
//   BASE=http://localhost:5516 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5516/?zone=z40OGL&node=64&mute=1&hold=1&debug=1" tools/steps/m5-z40OGL.mjs --size 1280x800 --out /tmp/m5-z40OGL
// Env: NODE=64|66 (default 64). The route is read from the game's own waypoint map (ictx.pathPos) following the stored hop order below.
import { hub, hubUrl } from './lib-hub.mjs';
import { installRouteBot } from './lib-walkbot.mjs';
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
  await H.skipCutscenes();   // (Shift: the arrival cutscene plays 3300 ticks; a player skips it too)
  for (let i = 0; i < 400 && (await snap()).cs; i++) await wait(250);
  await H.freePepper();
  s = await snap(); log('after cutscene', JSON.stringify(s)); await shot(`n${node}-free`);
  const route = ROUTES[node];
  const pos = await Promise.all(route.map((n) => page.evaluate((i) => [...window.__zone.game.ictx.pathPos(i)], n)));
  // the steering runs inside the page (lib-walkbot.mjs: decided every 4 ms from Pepper's own heading, keys as real KeyboardEvents): a node-side loop reacts a few ticks late and
  // cuts the corners of the narrow spiral (falls into the void again and again); this loop only watches, in game ticks
  const W = await installRouteBot(page, 'ogl');
  await W.route(pos, { tol: 6, look: 6, wi: 1 });
  await W.start();
  let trace = 0, lastWi = 0, lastTick = (await snap()).t, nudges = 0, shots = 0, falls = 0;
  const T0 = Date.now();
  while (Date.now() - T0 < 1800000) {
    await wait(300);
    s = await snap();
    if (s.zone !== 'z40OGL') break;
    if (s.node !== node) break;
    const w = await W.state();
    if (process.env.TRACE && (++trace % 4 === 0)) log('trace', JSON.stringify({ wi: w.wi, x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), ry: +s.ry.toFixed(2), err: w.err, ctrl: s.ctrl.toString(16), t: s.t, falls: w.falls, pr: w.presses, msg: w.msg }));
    if (w.falls !== falls) { falls = w.falls; log('fall', falls, 'route index', w.wi); if (process.env.TRACE) log('fall trace [x,y,z,ry,wi,err,tick]', JSON.stringify(w.fallTrace)); }
    if (w.wi !== lastWi) { lastWi = w.wi; lastTick = s.t; if (w.wi % 5 === 0 && shots < w.wi) { shots = w.wi; log('wp', w.wi, route[w.wi] ?? '-', JSON.stringify({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), v31: s.v31, score: s.score, left: s.left })); await shot(`n${node}-wp${w.wi}`); } }
    if ((s.ctrl & 0x100) && !s.cs) { await H.freePepper(); continue; }   // the hologram / a talk holds Pepper (the route bot waits): Shift sends it away
    if (w.done) { await wait(300); continue; }
    if (s.t - lastTick > 1200 && !s.cs && !(s.ctrl & 0x20)) {   // 40 s of game time without reaching the next waypoint: back out and try again (a wedge, as a player would)
      lastTick = s.t; nudges++;
      log('no progress at route index', w.wi, JSON.stringify({ x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), err: w.err, nudges }));
      await shot(`n${node}-noprogress${w.wi}`);
      await W.stop();
      await page.keyboard.down('ArrowDown'); await page.keyboard.down(nudges % 2 ? 'ArrowLeft' : 'ArrowRight'); await H.untilTicks(async () => false, 30, 15); await page.keyboard.up('ArrowDown'); await page.keyboard.up(nudges % 2 ? 'ArrowLeft' : 'ArrowRight');
      await W.start();
    }
  }
  await W.stop();
  const ws = await W.state(); log('route bot', JSON.stringify({ wi: ws.wi, n: ws.n, falls: ws.falls, presses: ws.presses, msg: ws.msg }));
  s = await snap(); log('end', JSON.stringify(s)); await shot(`n${node}-end`);
  const want = node === 64 ? ['z41MAP', 65] : ['z42BRP', 67];
  await page.waitForFunction((a) => window.__zone?.info.archive === a, want[0], { timeout: 90000 }).catch(() => {});
  const z = await page.evaluate(() => ({ zone: window.__zone?.info.archive, node: window.__zone?.sh.vars.get(0x58) }));
  log(z.zone === want[0] && z.node === want[1] ? 'ok  ' : 'FAIL', `handover to ${want[0]} at node ${want[1]}`, JSON.stringify(z));
  if (z.zone !== want[0] || z.node !== want[1]) process.exitCode = 1;
};
