// Infrastructure of the full-story bot (tools/steps/full-story.mjs): runs the existing step modules (m4-*, m5-*, m6-*, the mini-game players) IN PLACE, one after the other,
// in the same page, so that the story flows from one chapter into the next exactly as a player's game does.
//
//   * `runModule(h, file, { env, until, ms })` imports a step module, runs its default export with a wrapped helper set and returns { ok, fails, killed }.
//       - the steps' `page.goto(<chapter-skip URL>)` is NOT a story jump here: when the game already is where that URL would put it (same zone, same story node) the call does
//         nothing; otherwise it is refused and logged (resume mode allows it: `allowGoto`).
//       - `until(state)` (optional, polled about once a second) ends the step early: the module is killed (every later call of its page / key / wait helpers throws, the keys it
//         still held are released), so a step whose later part is a LOSS run or a stub phase can be used for its first part only.
//       - lines the step logs that start with FAIL / FAILED / PAGEERROR count as failures of the segment.
//   * `probe(page)` is the one snapshot every driver loop uses (zone, mode, story node, menu, movie, fade), with a timeout so that a busy page is not mistaken for a dead one.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROBE = () => {
  const z = window.__zone, sh = window.__shell, fe = window.__fe;
  const e = sh?.menu?.engine;
  return {
    arch: z?.info?.archive ?? null, index: z?.info?.index ?? -1, mode: z?.machine?.mode ?? -1, tick: z?.world?.tickCount ?? -1,
    node: z?.sh?.vars?.get(0x58) ?? (sh ? sh.vars.get(0x58) : -1), sub: z?.sh?.vars?.get(0x59) ?? -1, next: z?.sh?.vars?.get(5) ?? -1,
    menu: e ? { page: e.page, item: e.item, open: !!e.open } : null, movie: !!document.querySelector('.le2-movie'),
    fe: fe ? fe.mode : null, live: z?.sh?.live ?? null, guard: window.__le2guard ?? null,
  };
};
/** arm the reload guard: a page that reloads under the bot (a dev server's HMR reload when someone edits src/, a crash, a navigation) loses `window.__le2guard`; `probe(...).guard === null` then */
export const armReloadGuard = (page) => page.evaluate(() => {
  window.__le2guard = window.__le2guard ?? `${Date.now()}-${Math.random()}`;
  if (!window.__le2ev) {
    // Event log + the browser's focus / pointer-lock behaviour, in a headless run: the game turns an unlock of the pointer (which in a real browser is the Esc key) into the pause key
    // (src/game/input.ts onLockChange). A headless browser has no pointer to lock, so a request is refused like a browser without user activation would (pointerlockerror), and every
    // focus / lock event is logged (console.warn: browse.mjs prints it) so that an unexpected pause (mode 3 with nobody pressing Esc) can be traced to its cause.
    window.__le2ev = true;
    const say = (m) => console.warn(`[le2-ev] ${m} tick=${window.__zone?.world?.tickCount ?? -1} mode=${window.__zone?.machine?.mode ?? -1}`);
    for (const t of ['blur', 'focus']) window.addEventListener(t, () => say(t));
    document.addEventListener('visibilitychange', () => say(`visibility ${document.visibilityState}`));
    document.addEventListener('pointerlockchange', () => say(`pointerlockchange locked=${!!document.pointerLockElement}`));
    let refused = 0;
    Element.prototype.requestPointerLock = function () { if (++refused <= 3) say('requestPointerLock refused (headless; the game asks again every few seconds, only the first 3 are logged)'); document.dispatchEvent(new Event('pointerlockerror')); return Promise.reject(new DOMException('no pointer in a headless run', 'NotSupportedError')); };
  }
  return window.__le2guard;
});
export async function probe(page, ms = 15000) {
  return Promise.race([page.evaluate(PROBE).catch(() => ({ err: true })), new Promise((r) => setTimeout(() => r({ hung: true }), ms))]);
}

/** a deep proxy of the page whose calls throw once `ctl.dead` is set and whose goto follows the chapter-skip rule above */
function wrapPage(page, ctl) {
  const guard = (fn, self) => (...a) => { if (ctl.dead) throw new Error('step killed'); return fn.apply(self, a); };
  const wrapObj = (obj, name) => new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') {
        if (name === 'keyboard' && k === 'down') return (key, ...r) => { if (ctl.dead) throw new Error('step killed'); ctl.held.add(key); return v.call(t, key, ...r); };
        if (name === 'keyboard' && k === 'up') return (key, ...r) => { ctl.held.delete(key); return v.call(t, key, ...r); };
        return guard(v, t);
      }
      return v;
    },
  });
  return new Proxy(page, {
    get(t, k) {
      if (k === 'keyboard' || k === 'mouse') return wrapObj(t[k], k);
      if (k === 'goto') return async (url, opts) => ctl.onGoto(url, opts);
      const v = t[k];
      return typeof v === 'function' ? guard(v, t) : v;
    },
  });
}

export function makeRunner(h, { allowGoto = false, base = null } = {}) {
  const run = {};
  run.allowGoto = allowGoto;
  run.log = h.log;
  run.gotos = [];
  run.guardArmed = false;
  /** call once the game runs: from then on a page reload during a segment is reported as such */
  run.arm = async () => {
    await armReloadGuard(h.page); run.guardArmed = true;
    if (run.heartbeat) return;
    // a heartbeat: when the game state does not change for two minutes (its tick counter stands still, or the story node / zone does not move) the page is probed and the answer logged, so
    // that a bot waiting for ever (a paused or stalled game, a step that waits on something that never comes) can be told from a slow machine
    let last = null, same = 0;
    run.heartbeat = setInterval(async () => {
      const st = await probe(h.page, 10000);
      const key = st.hung ? 'hung' : st.err ? 'err' : `${st.arch}:${st.node}:${st.mode}:${st.tick}`;
      if (key === last) same++; else { same = 0; last = key; }
      if (same === 2 || (same > 2 && same % 5 === 0)) h.log(`[heartbeat] the game has not moved for ${same} minute(s): ${JSON.stringify(st)}`);
    }, 60000);
    run.heartbeat.unref?.();
  };
  /** run a step module in place; resolves { ok, fails, killed, error } */
  run.runModule = async (file, { env = {}, until = null, ms = 3 * 3600 * 1000, label = file, pollMs = 1000 } = {}) => {
    const fails = [];
    const ctl = { dead: false, held: new Set() };
    ctl.onGoto = async (url, opts) => {
      let want = null;
      try { const u = new URL(url); want = { zone: u.searchParams.get('zone'), node: u.searchParams.has('node') ? Number(u.searchParams.get('node')) : null }; } catch { /* not an URL */ }
      const st = await probe(h.page);
      const here = want && st.arch && (st.arch === want.zone || ('z' + String(st.index).padStart(2, '0')) === want.zone) && (want.node === null || st.node === want.node);
      if (here) { h.log(`[story] ${label}: page.goto(${url.replace(/^https?:\/\/[^/]+/, '')}) skipped: the game is already at ${st.arch}:${st.node}`); return null; }
      run.gotos.push({ label, url, at: st });
      if (!run.allowGoto) { ctl.refused = true; throw new Error(`[story] ${label}: the step wants to jump to ${url} but the game is at ${st.arch}:${st.node} (not a resume)`); }
      h.log(`[story] ${label}: RESUME page.goto(${url})`);
      const r = await h.page.goto(base ? url.replace(/^https?:\/\/[^/]+/, base) : url, opts);
      if (run.guardArmed) await armReloadGuard(h.page);
      return r;
    };
    const page = wrapPage(h.page, ctl);
    const killWait = (ms2) => { if (ctl.dead) throw new Error('step killed'); return h.page.waitForTimeout(ms2); };
    const log = (...a) => { const s = a.join(' '); if (/^(FAIL|FAILED|PAGEERROR|\[pageerror\])/.test(s) || /^(not ok)/.test(s)) fails.push(s.slice(0, 300)); if (!ctl.dead) h.log(...a); };
    const h2 = {
      ...h, page, wait: killWait, log,
      key: (k) => { if (ctl.dead) throw new Error('step killed'); return h.page.keyboard.press(k, { delay: 70 }); },
      shot: async (n) => { if (ctl.dead) return; return h.shot(n); },
      click: (...a) => { if (ctl.dead) throw new Error('step killed'); return h.click(...a); },
      evaluate: (fn, arg) => { if (ctl.dead) throw new Error('step killed'); return h.page.evaluate(fn, arg); },
    };
    const saved = {};
    for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = String(v); }
    const savedExit = process.exitCode;
    process.exitCode = 0;
    const mod = await import(pathToFileURL(path.resolve(file)).href + `?run=${Date.now()}`);   // a fresh module instance per run (module-level state, e.g. the stub flags)
    let killed = false, error = null, reloadedMsg = null, pauseSince = 0, pauseTick = -1;
    const t0 = Date.now();
    const p = Promise.resolve().then(() => mod.default(h2)).then(() => null, (e) => { error = e; return null; });
    let done = false;
    p.then(() => { done = true; });
    while (!done) {
      await Promise.race([p, new Promise((r) => setTimeout(r, pollMs))]);
      if (done) break;
      if (Date.now() - t0 > ms) { killed = true; error = new Error('segment timeout'); break; }
      if (until) {
        const st = await probe(h.page);
        let hit = false;
        try { hit = !st.hung && !st.err && !!(await until(st)); } catch { /* ignore */ }
        if (hit) { killed = true; break; }
      }
      if (run.guardArmed) {
        const st = await probe(h.page);
        // an unexpected pause: the pause menu (mode 3) open for 25 s of wall time without the game ticking, in a step that does not look at the pause menu for that long, is nobody's
        // doing: the step would wait for ever. Esc resumes it (a player would), logged.
        if (!st.hung && !st.err && st.mode === 3) { if (!pauseSince || pauseTick !== st.tick) { pauseSince = Date.now(); pauseTick = st.tick; } else if (Date.now() - pauseSince > 25000) { h.log(`[story] ${label}: the game has been paused for 25 s (mode 3, menu ${JSON.stringify(st.menu)}); Esc resumes it`); await h.page.keyboard.press('Escape', { delay: 70 }); pauseSince = 0; } } else pauseSince = 0;
        if (!st.hung && !st.err && st.guard === null) { killed = true; error = new Error('PAGE RELOADED under the bot (dev-server HMR reload after an edit of src/, a crash or a navigation): the game restarted at the URL it was opened with. Serve a snapshot (tools/m4-snapshot-server.sh)'); reloadedMsg = error.message; break; }
      }
    }
    if (killed) {
      ctl.dead = true;
      for (const k of [...ctl.held]) await h.page.keyboard.up(k).catch(() => {});
      await Promise.race([p, new Promise((r) => setTimeout(r, 4000))]);   // the module's pending call settles, its next call throws
      for (const k of [...ctl.held]) await h.page.keyboard.up(k).catch(() => {});
    }
    const failedByExit = process.exitCode === 1 && !killed;
    process.exitCode = savedExit;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    // a step that goes on with a part of its own that needs a page.goto (the loss run after the win run, a second scenario) after the point where `until` holds is done
    if (error && !killed && ctl.refused && until) { const st = await probe(h.page); let hit = false; try { hit = !st.hung && !st.err && !!(await until(st)); } catch { /* ignore */ } if (hit) { killed = true; error = null; } }
    if (error && !killed) fails.push(`step error: ${error.message ?? error}`);
    if (error && killed && error.message === 'segment timeout') fails.push('segment timeout');
    if (reloadedMsg) fails.push(reloadedMsg);
    if (failedByExit && !fails.length) fails.push('step set exitCode 1');
    return { ok: fails.length === 0, fails, killed, error: error ? String(error.message ?? error) : null, ms: Date.now() - t0 };
  };
  return run;
}

/** wait (in wall time, with a ceiling) until `pred(probe)` holds; polls once a second */
export async function waitProbe(page, pred, ms = 300000, step = 500) {
  const t0 = Date.now();
  for (;;) {
    const st = await probe(page);
    if (!st.hung && !st.err && (await pred(st))) return st;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(step);
  }
}

/**
 * Record every move of the story FSM (advance / rewind / stepBack / jump, with the zone and a stack line) in `window.__storyTrace` (the page keeps it from zone to zone): when a chapter
 * ends somewhere the story should not be (a rewind after the palace ...), `storyTrace(page)` tells which call of the game moved it.
 */
export async function installStoryTrace(page) {
  await page.evaluate(() => {
    const sh = window.__shell; if (!sh || window.__storyTraceOn) return;
    window.__storyTraceOn = true; window.__storyTrace = [];
    const st = sh.story;
    for (const m of ['advance', 'rewind', 'stepBack', 'jump', 'miniGameExit']) {
      const o = st[m].bind(st);
      st[m] = (...a) => {
        const before = st.node, z = window.__zone?.info?.archive;
        const r = o(...a);
        window.__storyTrace.push({ m, a: a.join(','), z, from: before, to: st.node, tick: window.__zone?.world?.tickCount, stack: (new Error().stack || '').split('\n').slice(2, 5).map((x) => x.trim().replace(/^at /, '').replace(/\(?https?:\/\/[^/]+/, '(')).join(' < ') });
        return r;
      };
    }
  });
}
export const storyTrace = (page) => page.evaluate(() => window.__storyTrace ?? []).catch(() => []);

/**
 * Play a mini-game with its win bot until the story has left the zone (the result menu's Continue). A bot can lose a run (a ring missed by a tick, a topping on the wrong side): like a
 * player it takes "Opnieuw" (page 19, item 1 = id 15) and tries again, up to `attempts` times. The step is stopped the moment the failure menu opens (its own later key presses would
 * choose for it), the failures it logged for that lost attempt are reported as such and do not count; only the last attempt's failures do.
 * Returns { ok, fails, killed, ms, attempts, lost: [per lost attempt: its fail lines] }.
 */
export async function playMini(R, h, { file, env = {}, zone, label = zone, attempts = 4, ms = 40 * 60000, stamp = () => '' } = {}) {
  const lost = [];
  let total = 0, r = null;
  for (let a = 1; a <= attempts; a++) {
    const failedMenu = (st) => st.arch === zone && st.menu && st.menu.open && st.menu.page === 19;
    const until = (st) => (!!st.arch && st.arch !== zone && st.mode >= 0) || failedMenu(st);
    r = await R.runModule(file, { env, until, label: `${label}${a > 1 ? '#' + a : ''}`, ms, pollMs: 150 });
    total += r.ms;
    const st = await probe(h.page);
    if (!failedMenu(st)) break;
    lost.push(r.fails);
    h.log(stamp(), `${label}: attempt ${a} was LOST (failure menu, page 19); taking "Opnieuw" (retry) like a player${r.fails.length ? ' [fails of that attempt: ' + r.fails.join(' | ').slice(0, 200) + ']' : ''}`);
    if (a === attempts) { r = { ...r, ok: false, fails: [...r.fails, `${label}: lost ${attempts} attempts`] }; break; }
    await h.page.waitForTimeout(400);
    await h.page.keyboard.press('Enter', { delay: 70 });          // the cursor starts on item 1: Opnieuw
    await h.page.waitForTimeout(1500);
  }
  return { ...r, ms: total, attempts: lost.length + 1, lost };
}
