// Behaviour nodes of the front-end stage z60FRE (FUN_00471070 attaches them; Walk.c): Pepper rides his skateboard back and forth in front of
// a fixed camera, with random gags and random outfit swaps (FUN_00472743 / FUN_004721f0), and the butterflies of the stage fly around
// (FUN_004b2d44, not ported: they stay where the builder put them).
//   FUN_00472743 constructor (node init: speeds, hidden NPC records), FUN_004721f0 update (this file's `FePepperNode.update`).
// The crossing speed / length is read from the decompile as far as the x87 code allows: speed = (rand(0.045) + 0.045) * 8 per tick, the stage is
// 80 units wide (x from -40, 0x42200000, to +40), so a crossing lasts 80 / speed ticks; the first one uses speed 0.2 and 399 ticks (0x3e4ccccd / 0x18f).
import type { BehaviourNode, Controller } from '../game/controller.ts';
import { NODE_CONTINUE, registerNode } from '../game/controller.ts';
import type { GameRecord } from '../game/record.ts';
import { RF_ENABLED } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { AnimInstance } from '../game/anim.ts';

/** random float in [0, max): FUN_004388ae; replaceable so tests are deterministic */
export const rng = { next: () => Math.random() };
const rand = (max: number) => rng.next() * max;

/** gag table at 0x8c9198: {Pepper clip, skateboard clip, duration in frames}; entry 0 = the ride */
export const FE_GAGS: [number, number, number][] = [[41, 3, 0], [86, 5, 50], [85, 6, 70], [87, 7, 44], [74, 4, 30], [35, 3, 0], [126, 3, 0], [84, 3, 0], [83, 3, 0], [131, 8, 40]];
/** table at 0x8c9150: the 18 NPC records whose models Pepper borrows (outfit swaps); they are hidden at start */
export const FE_OUTFITS = [21, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export interface FeNodeArgs { skate: GameRecord; shadow: GameRecord | null; outfits: GameRecord[]; supe: GameRecord | null; darr: GameRecord | null }

export class FePepperNode implements BehaviourNode {
  readonly kind = 'FEPepper';
  var = 2; mask = 1; value = 1; stamp = 0xfffffffe;
  speed = 0.2;            // [5] units per tick
  half = 40;              // [6]
  duration = 399;         // [7]
  dir = 0;                // [0xa]: 0 = left to right, 1 = back
  counter = 0;            // [0xb]
  timer = 0;              // [0xc]
  gag = -1;               // [0xd]
  gagFrame = 0;           // [0xe]
  defaultModel: GameRecord['model'] = null;
  a: FeNodeArgs;
  constructor(a: FeNodeArgs) { this.a = a; }

  /** FUN_00472743: first-time init */
  init(rec: GameRecord) {
    this.defaultModel = rec.model;
    // yaw + pi / 2 (facing +x)
    rec.ry = Math.PI / 2;
    for (const o of this.a.outfits) o.flags = 0;
    rec.anim?.start(41, 0);
    this.a.skate.anim?.start(3, 0);
    this.inited = true;
  }
  private inited = false;

  update(w: World, rec: GameRecord, _c: Controller): number {
    if (!this.inited) this.init(rec);
    const pa = rec.anim, sa = this.a.skate.anim;
    let finished = 0;
    if (pa) finished = pa.advance(1, 1);
    if (sa) sa.advance(1, 1);
    if (finished !== 0) {
      if (this.gag === -1) {
        if (rand(1) < 0.3) {
          this.gag = Math.floor(rand(10));
          if (this.gag === 8) this.gag = Math.floor(rand(10));
          if (this.a.supe && rec.model === this.a.supe.model && rand(1) < 0.9) this.gag = 8;
          if (this.a.darr && rec.model === this.a.darr.model && rand(1) < 0.6) this.gag = 5;
        }
      } else this.gag = 0;
      if (this.gag < 0) this.gagFrame = 0;
      else {
        const g = FE_GAGS[this.gag];
        pa?.start(g[0], 0); sa?.start(g[1], 0);
        this.gagFrame = g[2];
      }
    }
    if (this.counter === 0) {
      // a new crossing
      this.timer = 0;
      this.gag = -1;
      pa?.start(41, 0); sa?.start(3, 0);
      const r = rand(0.045);
      this.speed = (r + 0.045) * 8;
      this.duration = Math.floor(80 / this.speed);
      if (rand(1) >= 0.9) rec.model = this.defaultModel;
      else { const o = this.a.outfits[Math.floor(rand(18))]; if (o?.model) rec.model = o.model; }
    }
    if (this.gag !== 5) { this.timer += 1; this.counter = Math.floor(this.timer); }
    let bounce = 0;
    if (this.gagFrame > 0 && pa) {
      const f = Math.floor(pa.frame);
      const d = FE_GAGS[Math.max(0, this.gag)]?.[2] || 1;
      bounce = f > d / 2 ? ((d - f) * 8) / d : (f * 8) / d;
      if (bounce < 0) bounce = 0;
    }
    const x = this.dir === 0 ? this.counter * this.speed - this.half : this.half - this.counter * this.speed;
    const y = (this.dir === 0 ? 3.2 : 0) + bounce, z = this.dir === 0 ? 4.8 : 8;
    rec.ry = this.dir === 0 ? Math.PI / 2 : -Math.PI / 2;
    rec.setEuler(0, rec.ry, 0, x, y, z);
    if (this.counter > this.duration) { this.counter = 0; this.timer = 0; this.dir ^= 1; }
    // the skateboard and the shadow follow
    this.a.skate.m.set(rec.m);
    if (this.a.shadow) { this.a.shadow.x = x; this.a.shadow.y = y - bounce; this.a.shadow.z = z; }
    void w;
    return NODE_CONTINUE;
  }
}

registerNode('FEPepper', (args) => new FePepperNode(args as unknown as FeNodeArgs));

/** hide / show helpers used by the front end set-up */
export const showRec = (r: GameRecord) => { r.flags |= RF_ENABLED; };
export { AnimInstance };
