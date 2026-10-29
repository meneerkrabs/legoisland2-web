// Scripted player of the jousting duel (z09JST): the keys a human would press, decided from the duel's state (docs/re/m6/z09JST.md). Used by the node tests
// (tools/tests/m6-z09JST.mjs, drives `world.input` directly) and by the browser steps (tools/steps/m6-z09JST*.mjs read the same state from `window.__zone.game.duel`).
// `opts.ready`: the charge at which the bot lets go (default 40; a browser bot that can only press ~10 times a second uses 22). `style`: 'win' charges fully and steers the aim point onto the shield, 'loss' charges and steers away (the dark knight scores), 'slow' presses SPACE too early,
// 'glance' charges and puts the aim point 7 units off the centre (squared distance 49: nobody scores; only reliable without the wobble, i.e. in tests with a flat random source).
export const KEY = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, SPACE: 0x80 };

/** the logical buttons to hold in this tick (the duel reads `held` and the rising edges); `duel` = the JoustDuel (or its debug() snapshot with state, gauge, aim) */
export function jstKeys(duel, style = 'win', tick = 0, opts = {}) {
  const st = duel.state;
  const aimX = duel.aimX ?? duel.aim?.[0] ?? 0, aimY = duel.aimY ?? duel.aim?.[1] ?? 0;
  switch (st) {
    case 0: case 1: return KEY.UP;
    case 3: {
      const ready = (duel.gauge ?? 0) > (opts.ready ?? 40);
      if (style === 'slow') return KEY.SPACE;
      if (ready) return KEY.SPACE;
      return tick % 2 === 0 ? KEY.RIGHT : KEY.LEFT;
    }
    case 9: {
      let tx = 0, ty = 0;
      if (style === 'loss') { tx = 30; ty = 30; } else if (style === 'glance') { tx = 7; ty = 0; }
      let k = 0;
      const dx = aimX - tx, dy = aimY - ty;
      if (dx > 0.6) k |= KEY.LEFT; else if (dx < -0.6) k |= KEY.RIGHT;
      if (dy > 0.6) k |= KEY.UP; else if (dy < -0.6) k |= KEY.DOWN;
      return k || 0;
    }
    case 0x21: return tick % 2 === 0 ? KEY.UP : 0;
    default: return 0;
  }
}
