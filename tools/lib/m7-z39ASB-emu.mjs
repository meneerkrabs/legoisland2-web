// WP-VERIFY z39ASB (Asteroid Belt): the shuttle node of the zone run out of the executable (x86 emulation) next to the port's `AsteroidBelt` (src/zones/z39ASB/belt.ts): the constructor
// FUN_007b96a0 (shuttle at (0, 0, -768), the asteroid layout FUN_007b9917 with the original's own rand() calls, the star table FUN_007b780c), the per-tick update FUN_007b82dd (state
// machine, controls, hull / score, camera, HUD values, hit test FUN_007b7f68, asteroid motion FUN_007b91b9, thrust / gyro pitch FUN_007b6f1f / FUN_007b6de3), the node's draw hook
// FUN_007b9434 (HULL / SHUT flags, the asteroid window FUN_007b959c), the end of a run FUN_007b7e9a (hiscore / medal / trophy). Engine host table: tools/lib/m7-zone-emu.mjs.
// Nothing of the executable is stored here (addresses only).
import { ZoneEmu, RECORDS_BASE } from './m7-zone-emu.mjs';

export { RECORDS_BASE };

export class AsbWorldEmu extends ZoneEmu {
  /**
   * @param oracle { records, world, anims: Map(empty), pepperIndex: -1 }
   * @param o { rng: { range(x) }, dt, tick: GetTickCount value }
   */
  constructor(pe, oracle, o) {
    super(pe, oracle, { ...o, exec: [[0x7b6060, 0x7cf860]], soundAddr: {}, nodeRecords: { shut: 1, hull: 2 } });
    const H = this.cpu.hooks;
    // FUN_00435c91 (GetTickCount - start): the zone scales the random numbers of the hit sounds with it; FUN_00443230 / FUN_00438518: engine counter / rumble
    H.set(0x435c91, (c) => { c.eax = this.o.tick ?? 1000000; });
    H.set(0x443230, () => {});
    H.set(0x438518, () => {});
    H.set(0x7b7c24, () => {});       // the star-field backdrop quad of the draw hook (render only)
    // the banner's text calls FUN_00439c6f(font, font, string, 1, 0, x, y, height) are logged; FUN_00460a3d (the standard HUD pass) does nothing here
    H.set(0x439c6f, (c) => { this.log.push(`text ${this.cpu.mem.cstr(c.arg(2))} x${c.arg(5) | 0} y${c.arg(6) | 0}`); });
    H.set(0x460a3d, () => {});
  }

  /** the zone's set-up as far as the shuttle depends on it (FUN_007b70a1: the AST* table, the hit icon tints, var 0xfc) and the constructor (FUN_007b96a0 as FUN_00423532 calls it) */
  construct() {
    const mem = this.cpu.mem;
    this.loadSounds(0x7b6c20);
    this.cpu.steps = 0;
    this.cpu.call(0x7b6ff2, []);
    this.vars.set(0xfc, 0);
    for (let i = 0; i < 5; i++) mem.w32(0x5d4e148 + i * 8, 0xffffff);
    mem.w32(0x5d4e0c4, 0xffffffff);
    this.nodeStart = this.stars = undefined;
    this.node = this.nodes.shut = this.construct1(1, 0x7b96a0);
    this.sync();
    return this.node;
  }

  /** one tick of the update pass (FUN_007b82dd through the vtable) with the buttons (DAT_0098383c) and the pad axes (DAT_00983848 [1] / [2]), then the draw hook (slot 3) */
  tickAll(held, axisX = 0, axisY = 0) {
    this.ticks++;
    this.log = []; this.fx = [];
    const mem = this.cpu.mem;
    mem.w32(0x98383c, held); mem.w32(0x983848, 0); mem.w32(0x98384c, axisX | 0); mem.w32(0x983850, axisY | 0);
    this.callNode(1, this.node, this.updateFn(this.node));
    this.callNode(1, this.node, this.drawFn(this.node));
    return this.log;
  }

  /** FUN_007b7e9a(score): the end of a successful run: hiscore, medal index, trophy */
  finish(score, hiscore, trophy) {
    const mem = this.cpu.mem;
    this.vars.set(0x29, hiscore); this.vars.set(0x44, trophy); this.vars.set(0x102, 0x77);
    this.log = [];
    this.cpu.steps = 0;
    this.cpu.call(0x7b7e9a, [score | 0], { maxSteps: 100000 });
    void mem;
    return { hiscore: this.vars.get(0x29) | 0, trophy: this.vars.get(0x44) | 0, medal: this.vars.get(0x102) | 0 };
  }

  /** FUN_007b61a4: one frame of the banner (mode 4): var 0xfc = result, 0x102 = medal index, 0x44 = trophy, DAT_05d5d528 = the final score; returns the trophy afterwards and the text calls */
  banner(result, medal, trophy, finalScore) {
    const mem = this.cpu.mem;
    this.vars.set(0xfc, result); this.vars.set(0x102, medal); this.vars.set(0x44, trophy);
    mem.w32(0x5d5d528, finalScore);
    this.log = [];
    this.cpu.steps = 0;
    this.cpu.call(0x7b61a4, [], { maxSteps: 100000 });
    return { trophy: this.vars.get(0x44) | 0, text: this.log.filter((e) => e.startsWith('text')) };
  }
}
