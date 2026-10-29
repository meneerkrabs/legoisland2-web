// Helpers of the M5 hub bots (tools/steps/m5-*.mjs), generalised from lib-island.mjs (the island's bots keep using that one): state, waiting in game ticks, cutscene
// skipping, teleporting Pepper next to a record, real key presses, jumping chapters. Works in every zone that runs through the hub framework (src/hub) and, for the
// state / key helpers, in any zone.
//
//   import { hub, hubUrl, HUBS } from './lib-hub.mjs';
//   export default async ({ page, wait, log, shot }) => {
//     const H = hub({ page, wait, log, shot }, 'z07CSI');
//     await H.start();                       // waits for the hub's mode 1, presses a button, waits for mode 2
//     await H.skipCutscenes();               // Shift taps until no script runs
//     log(await H.state());
//   };
// URL: `hubUrl('z07CSI', 15)` = `/?zone=z07CSI&node=15&mute=1&hold=1&debug=1` (chapter skip: the story FSM jumps to node 15, every node below counts as done; `&hold=1` keeps
// browse.mjs from tapping a key for mode 1; `&debug=1` = the port's debug aids, src/game/debug.ts: F9 completes the story node, `S.f9()`), the origin comes from `BASE` (env, default http://localhost:5510).
export const BASE = process.env.BASE ?? 'http://localhost:5510';
/** hub zones: archive, zone table index, story nodes that belong to the hub (tools/fsm_dump.py of the decompile) */
export const HUBS = {
  z07CSI: { index: 6, nodes: [15, 16, 17, 19, 20, 21, 22, 24, 25, 27, 28, 29], name: 'castle island' },
  z13CAI: { index: 10, nodes: [33, 51], name: 'Adventure Island' },
  z14OSD: { index: 11, nodes: [34, 45], name: 'Oasis' },
  z16PYA: { index: 13, nodes: [36, 38, 40], name: 'Pyramid' },
  z23DIP: { index: 19, nodes: [47, 50], name: 'Dino island' },
  z40OGL: { index: 27, nodes: [64, 66], name: "Ogel's island" },
};
/** the chapter-skip URL of a hub at a story node (`extra`: more query parameters, e.g. `{ intro: 0 }`) */
export function hubUrl(zone, node, extra = {}, base = BASE) {
  const q = new URLSearchParams({ zone, ...(node !== undefined ? { node: String(node) } : {}), mute: '1', hold: '1', debug: '1', ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  return `${base}/?${q}`;
}

export function hub({ page, wait, log = () => {}, shot = async () => {} }, archive) {
  const S = { archive };
  S.state = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const p = z.loaded.pepper, v = z.sh.vars;
    const dbg = z.game?.debug?.() ?? {};
    return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), yaw: +p.ry.toFixed(2), node: v.get(0x58), ctrl: v.get(0x5e), cs: !!dbg.cutscene,
      sub: v.get(0x59), next: v.get(5), prev: v.get(0xa3), cur: v.get(0x5a), pizzas: v.get(0xb0), bricks: v.get(0x4f) };
  });
  S.until = async (fn, ms = 60000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(step); } return false; };
  /** the zone's simulation tick counter (game time: the bots wait in ticks so that a slow page does not make them miss things) */
  S.ticks = () => page.evaluate(() => window.__zone?.world.tickCount ?? -1);
  /** poll `fn` until it is true or `maxTicks` simulation ticks passed (30 per second of game time) */
  S.untilTicks = async (fn, maxTicks, poll = 40) => { const t0 = await S.ticks(); for (;;) { if (await fn()) return true; await wait(poll); const t = await S.ticks(); if (t < 0 || t < t0 - 2 || t - t0 > maxTicks) return false; } };
  /** wait until zone `arch` (default: the hub) runs in mode 1 or 2 */
  S.waitHub = async (arch = archive, timeout = 300000) => { await page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2), arch, { timeout }); };
  /** wait for the hub, take its mode 1 (any button) into mode 2 */
  S.start = async () => { await S.waitHub(); if ((await S.state()).mode === 1) await page.keyboard.press('ArrowLeft', { delay: 70 }); await S.until(async () => (await S.state()).mode === 2, 8000); };
  /** Pepper is held by a conversation / the hologram (PEPPER_CONTROL bit 0x100: the hologram node calls her over when the story advanced, Shift sends it away): tap Shift until she is free; returns the number of taps */
  S.freePepper = async (max = 20) => { let n = 0; for (; n < max && (((await S.state())?.ctrl ?? 0) & 0x100) !== 0; n++) { await S.tap('ShiftLeft', 60); await wait(150); } return n; };
  /** hold Shift taps (the cutscene skip) until no script runs; returns the number of taps */
  S.skipCutscenes = async (max = 80) => { let n = 0; for (; n < max; n++) { const s = await S.state(); if (!s || !s.cs) { await wait(250); if (!(await S.state())?.cs) break; continue; } await S.tap('ShiftLeft', 60); await wait(120); } return n; };
  // keys are held for game ticks (30 per second of game time): a tap shorter than one tick of a slow page would be lost between two simulation ticks
  const holdTicks = async (k, ticks, ms) => {
    await page.keyboard.down(k);
    if ((await S.ticks()) >= 0) await S.untilTicks(async () => false, ticks, 15); else await wait(ms);
    await page.keyboard.up(k);
  };
  S.tap = (k, ms = 80) => holdTicks(k, 3, ms);
  S.hold = (k, ms) => holdTicks(k, Math.round((ms * 30) / 1000), ms);
  /** put Pepper `dist` units from the record (on the side `ang` radians around it), facing it, camera behind */
  S.teleportNear = (name, dist = 5, ang = 0) => page.evaluate(([n, d, a]) => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper;
    const r = w.records.find((x) => x.name === n);
    if (!r) return null;
    const px = r.x + Math.sin(a) * d, pz = r.z + Math.cos(a) * d;
    p.x = px; p.z = pz; p.y = r.y + 1;
    const g = w.col.groundRay(px, r.y + 20, pz); if (g > -1e30) p.y = g;
    p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    return [r.x, r.y, r.z].map((x) => +x.toFixed(1));
  }, [name, dist, ang]);
  /** put Pepper at (x, z) on the ground facing (fx, fz), camera behind */
  S.teleportTo = (x, z, fx, fz) => page.evaluate(([x, z, fx, fz]) => {
    const zz = window.__zone, w = zz.world, p = zz.loaded.pepper;
    p.x = x; p.z = z; const g = w.col.groundRay(x, 200, z); if (g > -1e30) p.y = g;
    p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  }, [x, z, fx, fz]);
  /** PATH map (FUN_00462be9(1, n)) position of node n */
  S.pathNode = (n) => page.evaluate((i) => { const p = window.__zone.game.ictx.pathPos(i); return p ? [...p] : null; }, n);
  S.rec = (name) => page.evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), z: +r.z.toFixed(1), en: r.enabled, flags: r.flags } : null; }, name);
  S.vars = (list) => page.evaluate((l) => Object.fromEntries(l.map((i) => [i, window.__zone.sh.vars.get(i)])), list);
  S.setVar = (i, v) => page.evaluate(([i, v]) => window.__zone.sh.vars.set(i, v), [i, v]);
  S.debug = () => page.evaluate(() => window.__zone.game.debug());
  /** complete the condition of the story node the FSM waits for (the F9 aid of the hub game, without the key): the FSM advances itself in the next frame check */
  S.completeNode = () => page.evaluate(() => { const sh = window.__zone.sh, nd = sh.nodes[sh.story.node]; if (nd) sh.vars.set(nd.var, (sh.vars.get(nd.var) & ~nd.mask) | nd.value); return sh.story.node; });
  /** the same through the real key (HubGame: F9) */
  S.f9 = () => S.tap('F9', 60);
  /** the zone the story / the loop goes to next (var 5) and the zone table index the game is in */
  S.zoneNow = () => page.evaluate(() => ({ arch: window.__zone?.info.archive ?? null, index: window.__zone?.info.index ?? -1 }));
  /** wait until the zone changed away from `arch` (default: the hub); returns the new archive */
  S.untilLeft = async (arch = archive, ms = 60000) => { await S.until(async () => (await S.zoneNow()).arch !== arch, ms); return (await S.zoneNow()).arch; };
  /** attach counts per constructor name of the world's controllers (the shared node families present in the zone) */
  S.nodeKinds = () => page.evaluate(() => { const o = {}; for (const r of window.__zone.world.records) for (const n of r.ctrl?.nodes ?? []) { const k = n.kind ?? n.constructor?.name ?? '?'; o[k] = (o[k] ?? 0) + 1; } return o; });
  S.shot = shot;
  S.log = log;
  return S;
}
