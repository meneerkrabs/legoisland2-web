// Page-side scripted players for the browser steps (WP-MINI, WP-RELIABILITY). A bot that decides in the Node process over `page.evaluate` needs one or two frames per decision and its
// reaction time in LOGIC TICKS grows with the load of the machine (headless GL: 19..26 ticks/s with a few bots at once, measured with tools/steps/m8-tickrate.mjs): the replay in node
// (docs: z38PAR / z39ASB / z40aPO) shows the results fall with the delay (z38PAR rings 111 -> 221 -> 222, z39ASB score 9968 -> 3821 ...). This bot decides INSIDE the page, once per
// game tick (hooked into the input mapper's per-tick update, see below), from the zone's own debug state, and presses / releases the keys on the mapper, so the keys the game samples
// at a tick come from the state the previous tick left, however many ticks a frame runs. `decideSrc` is the source of `(window) => Set<KeyboardEvent.code>`.
export async function installPageBot(page, name, decideSrc) {
  await page.evaluate(([n, src]) => {
    const decide = (0, eval)(`(${src})`);
    const held = new Set();
    const sendDom = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
    // WP-RELIABILITY: the decision is taken ONCE PER GAME TICK, inside the input mapper's update (the zone loop calls `sh.input.update()` right before every simulation tick,
    // src/shell/playzone.ts), and the keys are set on the mapper directly (`setKey` = a keydown / keyup that this very tick samples). A timer in the page only fires between frames:
    // on a loaded page one frame runs several ticks, the keys stood for all of them and the pilot reacted late. Without the mapper (no shell) the 4 ms timer is the fallback.
    const inp = window.__shell && window.__shell.input;
    const set = (code, on) => { if (inp) inp.setKey(code, on); else sendDom(code, on); };
    const sync = () => {
      let want;
      try { want = decide(window); } catch (e) { bot.err = String(e && e.stack || e); want = new Set(); }
      for (const c of [...held]) if (!want.has(c)) { set(c, false); held.delete(c); }
      for (const c of want) if (!held.has(c)) { set(c, true); held.add(c); bot.presses++; }
    };
    const bot = {
      on: false, timer: 0, presses: 0, err: '', orig: null, hooked: null,
      release() { for (const c of [...held]) { set(c, false); held.delete(c); } },
      start() {
        if (bot.on) return; bot.on = true;
        if (inp) {
          bot.orig = inp.update;
          bot.hooked = function () { if (bot.on) sync(); return bot.orig.apply(inp, arguments); };
          inp.update = bot.hooked;
        } else bot.timer = setInterval(sync, 4);
      },
      stop() {
        bot.on = false; clearInterval(bot.timer); bot.release();
        if (inp && inp.update === bot.hooked) inp.update = bot.orig;
      },
    };
    window[`__bot_${n}`] = bot;
  }, [name, decideSrc]);
  return {
    start: () => page.evaluate((n) => window[`__bot_${n}`].start(), name),
    stop: () => page.evaluate((n) => window[`__bot_${n}`].stop(), name),
    info: () => page.evaluate((n) => ({ presses: window[`__bot_${n}`].presses, err: window[`__bot_${n}`].err }), name),
  };
}

/** the source text of a z38PAR / z40aPO pilot decision (tools/lib/par-bot.mjs / apo-bot.mjs) as a page-side `decide`: key mask -> key codes */
export function pilotDecideSource(kind, B, steerBits, pitchBits, botStep, plan = {}, extraGuard = '') {
  const KEYS = [[B.UP, 'ArrowUp'], [B.DOWN, 'ArrowDown'], [B.LEFT, 'ArrowLeft'], [B.RIGHT, 'ArrowRight'], [B.SHIFT, 'ShiftLeft']];
  return `(() => {
    const B = ${JSON.stringify(B)}; const TWO_PI = 6.2831855;
    const wrapPi = (a) => { while (a > Math.PI) a -= TWO_PI; while (a < -Math.PI) a += TWO_PI; return a; };
    ${steerBits.toString()}
    ${pitchBits.toString()}
    ${botStep.toString()}
    const KEYS = ${JSON.stringify(KEYS)}; const plan = ${JSON.stringify(plan)};
    return (w) => {
      const z = w.__zone;
      const out = new Set();
      if (!z || !z.game || z.machine.mode !== 2) return out;
      const s = z.game.debug();
      if (!s || s.over) return out;
      ${extraGuard}
      const mask = ${kind}(s, plan);
      for (const [bit, code] of KEYS) if (mask & bit) out.add(code);
      return out;
    };
  })()`;
}
