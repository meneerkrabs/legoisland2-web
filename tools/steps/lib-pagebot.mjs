// Page-side scripted players for the browser steps (WP-MINI). A bot that decides in the Node process over `page.evaluate` needs one or two frames per decision and its reaction time
// in LOGIC TICKS grows with the load of the machine (headless GL: 19..26 ticks/s with a few bots at once, measured with tools/steps/m8-tickrate.mjs): the replay in node
// (docs: z38PAR / z39ASB / z40aPO) shows the results fall with the delay (z38PAR rings 111 -> 221 -> 222, z39ASB score 9968 -> 3821 ...). This bot decides INSIDE the page every 4 ms
// from the zone's own debug state, and presses / releases the keys as real KeyboardEvents on `window` (the game's Input listens there: keydown / keyup, latched per tick), so
// the keys the game samples at a tick come from the state the previous tick left. `decideSrc` is the source of `(window) => Set<KeyboardEvent.code>`.
export async function installPageBot(page, name, decideSrc) {
  await page.evaluate(([n, src]) => {
    const decide = (0, eval)(`(${src})`);
    const held = new Set();
    const send = (code, on) => window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
    const bot = {
      on: false, timer: 0, presses: 0, err: '',
      release() { for (const c of [...held]) { send(c, false); held.delete(c); } },
      start() {
        if (bot.on) return; bot.on = true;
        bot.timer = setInterval(() => {
          let want;
          try { want = decide(window); } catch (e) { bot.err = String(e && e.stack || e); want = new Set(); }
          for (const c of [...held]) if (!want.has(c)) { send(c, false); held.delete(c); }
          for (const c of want) if (!held.has(c)) { send(c, true); held.add(c); bot.presses++; }
        }, 4);
      },
      stop() { bot.on = false; clearInterval(bot.timer); bot.release(); },
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
