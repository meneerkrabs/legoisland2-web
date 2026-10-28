// A scripted player for z41MAP (pizza making), shared by the node test (tools/tests/m3-z41MAP.mjs) and the browser steps (tools/steps/m3-z41MAP.mjs).
// It only looks at the snapshot of the zone state (`snapshot(S)` of src/zones/z41MAP/nodes.ts = `window.__zone.game.debug()`) and returns the buttons to hold:
//   mode 'win'  : picks the wanted topping of the round and throws it when Papa's swing will be at an edge when the topping arrives
//   mode 'lose' : picks a topping that is NOT wanted (it still has to land on the dough for the round to end)
// Throw timing: Space is processed in the tick it is pressed, the release follows 4 ticks later (frame 14 -> 18 of the throw clip) and the flight takes about 39 ticks (z advances 0.264 per tick from the hand to z > -1, FUN_0081543e).
export const KEY = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, SPACE: 0x80 };
/** button bit -> browser key code of the default key table */
export const CODE = { [KEY.LEFT]: 'ArrowLeft', [KEY.RIGHT]: 'ArrowRight', [KEY.UP]: 'ArrowUp', [KEY.DOWN]: 'ArrowDown', [KEY.SPACE]: 'Space' };
/** topping type -> the key that picks it (right: green pepper, left: cheese, up: tomato, down: pepperoni) */
const PICK_KEY = { 1: KEY.RIGHT, 2: KEY.LEFT, 4: KEY.UP, 8: KEY.DOWN };

export class Bot {
  constructor(mode = 'win', opt = {}) {
    this.mode = mode;
    this.latency = opt.latency ?? 0;
    this.edge = opt.edge ?? 2.35;
    this.dir = 0;
    this.throws = 0;
  }

  /** the buttons to hold this tick */
  step(s) {
    const p = s.papa, pe = s.pepper;
    if (!p || !pe || s.result) return 0;
    if (pe.state === 5) return this.dir;
    if (pe.state === 2) {
      if ((p.state === 2 || p.state === 3) && p.thrown < p.count && s.flying === 0) {
        let type = p.target[p.thrown];
        if (this.mode === 'lose') type = type === 1 ? 2 : 1;
        return PICK_KEY[type] ?? 0;
      }
      return 0;
    }
    if (pe.state === 4 && pe.holding && p.state === 2) {
      // measured: the topping reaches the pizza 43 ticks after the Space tick (the hand moves forward during the 4 ticks of the throw clip)
      const lead = 43 + this.latency;
      const a0 = p.angle, a1 = a0 + p.speed * lead;
      // the swing crosses zero meanwhile: the wiggle (state 3) may start there (50 %); in the fast late rounds the flight spans more than a half swing, so accept the gamble
      if (Math.floor(a0 / Math.PI) !== Math.floor(a1 / Math.PI) && p.speed * lead < 1.3) return 0;
      const x = 3 * Math.sin(a1);
      if (Math.abs(x) >= this.edge) {
        this.dir = x < 0 ? KEY.LEFT : KEY.RIGHT;
        this.throws++;
        return KEY.SPACE | this.dir;
      }
      return 0;
    }
    return 0;
  }
}
