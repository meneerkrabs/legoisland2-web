// WP-VERIFY z38PAR: the WHOLE update pass of the zone run out of the executable (x86 emulation) next to the port: the pilot (constructor FUN_0046a926 / update FUN_004686a3), the boat
// (FUN_004676cd / FUN_00467520), the three pterodactyls (FUN_00467d38 / FUN_004677a0), the balloon (FUN_00467fae / FUN_00467e40), the seaplane (FUN_004681c0 / FUN_00468040), the
// canopy (FUN_004684ec / FUN_00468338), the HUD FUN_00466f50, and the end of the loop (case 2 of FUN_00465d39). Engine / host table: tools/lib/m7-zone-emu.mjs. Nothing of the
// executable is stored here (addresses only).
import { ZoneEmu, RECORDS_BASE } from './m7-zone-emu.mjs';

export { RECORDS_BASE };

/** where FUN_00467370 stores each sound handle (the port's slot name -> the global) */
export const SOUND_ADDR = {
  ambience: 0x5d57d4c, sea: 0x5d57d9c, planeIdle: 0x5d57da4, balloonThrust: 0x5d57d44, birdFly1: 0x5d57d50, birdFly2: 0x5d57d58, birdFly3: 0x5d57d54,
  birdCall1: 0x5d57d90, birdCall2: 0x5d57d94, birdCall3: 0x5d57d60, hitRing: 0x5d57d38, thruRing: 0x5d57d80, hitPlane: 0x5d57d48, hitBird: 0x5d57d40, hitBalloon: 0x5d57da0,
  chuteOpen: 0x5d57d7c, landOff: 0x5d57d70, landOk: 0x5d57d6c, splash: 0x5d57d74, windFall: 0x5d57d84, windChute: 0x5d57d68, flap: 0x5d57d5c, bigSplash: 0x5d57d64,
  smack: 0x5d57d88, hitTarget: 0x5d57d98, flyOff: 0x5d57d3c, accel: 0x5d57d78,
  // loaded twice with the same sound id (0x2a ptero hit): the original keeps a second handle at DAT_05d57d8c that nothing plays
  extra_d8c: 0x5d57d8c,
};

export class ParWorldEmu extends ZoneEmu {
  /**
   * @param oracle { records, world, anims: Map<recordIndex, AnimInstance> (PEPP + PTER records) }
   * @param o { rng, dt, shadow(rec, size, lift), nodeRecords: { pilot, birds, balloon, canopy, plane, boat } }
   */
  constructor(pe, oracle, o) {
    super(pe, oracle, { ...o, exec: [[0x465539, 0x470a20]], soundAddr: SOUND_ADDR });
  }

  /** the sound loads and the node constructors in the order of FUN_00466c36 (pilot, canopy, plane, balloon, birds, boat) */
  construct() {
    const N = this.nodeRecords;
    this.loadSounds(0x467370);
    this.node = this.nodes.pilot = this.construct1(N.pilot, 0x46a926);
    this.nodes.canopy = this.construct1(N.canopy, 0x4684ec);
    this.nodes.plane = this.construct1(N.plane, 0x4681c0);
    this.nodes.balloon = this.construct1(N.balloon, 0x467fae);
    this.nodes.birds = this.construct1(N.birds, 0x467d38);
    this.nodes.boat = this.construct1(N.boat, 0x4676cd);
    this.sync();
    return this.node;
  }

  /** one tick of the update pass in record order (pilot, birds, balloon, plane, boat), then the canopy's draw hook (the draw pass of the same frame) */
  tickAll(held, pressed = 0) {
    this.ticks++;
    this.log = []; this.fx = [];
    const mem = this.cpu.mem, N = this.nodeRecords, nd = this.nodes;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed);
    for (const k of ['pilot', 'birds', 'balloon', 'plane', 'boat']) this.callNode(N[k], nd[k], this.updateFn(nd[k]));
    this.callNode(N.canopy, nd.canopy, this.drawFn(nd.canopy));      // the canopy's slot 0 is a stub; its draw hook FUN_00468338 places it
    return this.log;
  }

  /** FUN_00466f50: the HUD feed (every tick of the play mode after the update pass) */
  hud() {
    this.cpu.steps = 0;
    this.cpu.call(0x466f50, [], { maxSteps: 5_000_000 });
    const mem = this.cpu.mem;
    return {
      text: mem.cstr(0x5d4dd60).trim(), compass: mem.r32(0x5d4dd14) | 0,
      rings: [mem.r32(0x5d4e144) | 0, mem.r32(0x5d4e14c) | 0, mem.r32(0x5d4e154) | 0], tints: [mem.r32(0x5d4e148), mem.r32(0x5d4e150), mem.r32(0x5d4e158)],
      chuteIcon: mem.r32(0x5d4dd38) | 0, gauge: mem.f32(0x5d4e138),
      segments: Array.from({ length: 12 }, (_, i) => mem.r32(0x5d4e0c8 + i * 8) | 0),
      blink: [mem.f32(0x8b96bc), mem.f32(0x8b96c0), mem.f32(0x8b96c4)],
    };
  }

  /**
   * the end-of-game block of the loop FUN_00465d39 (case 2: `if (DAT_05d57d2c != 0) { ... }`, 0x466127 up to its exit jump to 0x466992) run from the middle of the function on a prepared
   * frame (local_8 = 2). Returns the variable writes, the result word DAT_05d57ce8 (1 success / 2 failure), the speech said at once and the queued line (DAT_05d57cec).
   */
  endOfGame({ score, stored, trophy = 0, over = 1, result = 0 }) {
    const mem = this.cpu.mem;
    this.vars.set(0xaa, stored); this.vars.set(0xd1, trophy);
    mem.wf32(0x5d57d28, score); mem.w32(0x5d57d2c, over); mem.w32(0x5d57ce8, result); mem.w32(0x5d57cec, 0xffffffff);
    this.log = [];
    const ebp = this.runBlock(0x466127, 0x466992, [[-8, 2]]);
    const q = mem.r32(0x5d57cec);
    return {
      mode: mem.r32(ebp - 8), result: mem.r32(0x5d57ce8) | 0, hiscore: this.vars.get(0xaa) | 0, trophy: this.vars.get(0xd1) | 0,
      queued: (q | 0) === -1 ? null : this.speechIds[q - 1], log: this.log.filter((e) => /^(say|stop|setVar)/.test(e)),
    };
  }
}
