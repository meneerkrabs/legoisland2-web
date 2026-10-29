// WP-VERIFY z40aPO: the WHOLE update pass of the zone run out of the executable (x86 emulation) next to the port: the pilot (constructor FUN_007d53af / update FUN_007d3187), the eight rocket
// brickbots (FUN_007d2650 / FUN_007d19e0), the three rock monsters (FUN_007d2bf2 / FUN_007d28e0), the 14 asteroids (FUN_007d1778 / FUN_007d14b0) and the wing (FUN_007d2fae, the draw hook
// FUN_007d2dd8). Started from a copy of tools/lib/apo-emu.mjs (the M5 audit's oracle: vendored here because that file is edited concurrently by another worker) and adds:
//   * the node constructors and update functions of the props, called through the node's own vtable slot 0 (the update pass FUN_0042226e: per record in index order) and the wing's draw hook;
//   * dt as a parameter: DAT_008b1718 = dt, DAT_008b171c = 1 / dt in emulated memory, the hosted animation advance (FUN_0043b76a) steps by rate * dt;
//   * its own oracle WORLD: the collision queries of the original's code (FUN_00441270 sweeps of the pilot and the bots, FUN_00442a70 shadow probe) are answered by the port's
//     `CollisionWorld` (the collision engine is not the subject) over records that mirror the ORIGINAL's emulated record array (a write observer marks the records the original moved, they
//     are copied into the oracle world before every query), so the props evolve independently of the port's props;
//   * the box test FUN_007d3050 runs natively (host: FUN_00442570 = the record's collision box, from the port's loaded collision data);
//   * sound handles that keep their identity: every FUN_004433b0 / FUN_00443580 load returns its own handle, the call log names the global it was stored in (palace, beacon, rocket N ...).
// Nothing of the executable is stored here (addresses only).
import { ZoneEmu, RECORDS_BASE } from './m7-zone-emu.mjs';

export { RECORDS_BASE };

/** where FUN_007d0cb0 stores each sound handle (the port's slot name -> the global); the 8 rocket slots follow the original's bot order (record 0x1c08 + n * 0x68 -> the global it plays) */
export const SOUND_ADDR = {
  rocket0: 0x5d5ede0, rocket1: 0x5d5ede8, rocket2: 0x5d5ede4, rocket3: 0x5d5edf0, rocket4: 0x5d5edec, rocket5: 0x5d5edf8, rocket6: 0x5d5edf4, rocket7: 0x5d5edfc,
  palace: 0x5d5ee34, beacon1: 0x5d5ee38, beacon2: 0x5d5ee3c, rockMonster1: 0x5d5ee20, rockMonster2: 0x5d5ee1c, rockMonster3: 0x5d5ee18, engine: 0x5d5ee4c, hitTarget: 0x5d5ee30,
  breath: 0x5d5ee00, hitRing: 0x5d5ee54, hitAsteroid: 0x5d5ee08, hitMonster: 0x5d5ee40, hitBot: 0x5d5ee28, solarOpen: 0x5d5ee14, accel: 0x5d5ee04, smack: 0x5d5ee50,
  landOk: 0x5d5ee58, landOff: 0x5d5ee2c, launch: 0x5d5ee48, thruRing: 0x5d5ee10, thruster: 0x5d5ee24, boxOpen: 0x5d5eddc,
  // loaded but never played by the zone code (the third 0xee slot, the first 0xe4 slot): the port has no slot for them
  extra_ee0c: 0x5d5ee0c, extra_ee44: 0x5d5ee44,
};

export class ApoWorldEmu extends ZoneEmu {
  /**
   * @param oracle { records (the oracle world's records), world, pepperAnim, anims: Map<recordIndex, AnimInstance> (PEPP 6 + ROC1..3) }
   * @param o { rng: { range(x) }, dt, parts(i) -> sub-object matrices of record i, shadow(rec, size, lift) -> 15 floats | null, nodeRecords: { pilot, rocks, bots, wing, asteroids } }
   */
  constructor(pe, oracle, o) {
    super(pe, { ...oracle, pepperIndex: 6 }, { ...o, exec: [[0x7cf129, 0x7e22b0]], soundAddr: SOUND_ADDR });
    this.H0 = this.cpu.hooks;
    // the wing's shadow draw (FUN_007d2cf0) is a draw-pass service
    this.cpu.hooks.set(0x7d2cf0, () => { this.fx.push('wing shadow draw'); });
  }

  /** the sound loads and the node constructors in the order of FUN_007d0839 (pilot, wing, rock monsters, bots, asteroids) */
  construct() {
    const N = this.nodeRecords;
    this.loadSounds(0x7d0cb0);
    this.node = this.nodes.pilot = this.construct1(N.pilot, 0x7d53af);
    this.nodes.wing = this.construct1(N.wing, 0x7d2fae);
    this.nodes.rocks = this.construct1(N.rocks, 0x7d2bf2);
    this.nodes.bots = this.construct1(N.bots, 0x7d2650);
    this.nodes.asteroids = this.construct1(N.asteroids, 0x7d1778);
    this.sync();
    return this.node;
  }

  /**
   * one tick of the zone's update pass in record order (pilot, rock monsters, bots, asteroids; the wing's slot 0 is a stub), then the wing's draw hook (the draw pass of the same
   * frame). `held` / `pressed` = the button masks (DAT_0098383c / DAT_00983840). Returns the call log (sounds, speech, clips); `fx` has the particle calls.
   */
  tickAll(held, pressed = 0) {
    this.ticks++;
    this.log = []; this.fx = [];
    const mem = this.cpu.mem, N = this.nodeRecords, nd = this.nodes;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed);
    this.callNode(N.pilot, nd.pilot, this.updateFn(nd.pilot));
    this.callNode(N.rocks, nd.rocks, this.updateFn(nd.rocks));
    this.callNode(N.bots, nd.bots, this.updateFn(nd.bots));
    this.callNode(N.asteroids, nd.asteroids, this.updateFn(nd.asteroids));
    this.callNode(N.wing, nd.wing, this.drawFn(nd.wing));
    return this.log;
  }

  /** FUN_007d0f00: the HUD of the play mode (the loop's case 2 calls it after the update pass); returns what it left in the HUD globals */
  hud() {
    this.cpu.steps = 0;
    this.cpu.call(0x7d0f00, [], { maxSteps: 5_000_000 });
    const mem = this.cpu.mem;
    return {
      text: mem.cstr(0x5d4dd60).trim(),
      // the icon / tint pairs of group 1 / 2 / 3 (DAT_05d4e154 / e158, e14c / e150, e144 / e148)
      icons: [mem.r32(0x5d4e154) | 0, mem.r32(0x5d4e14c) | 0, mem.r32(0x5d4e144) | 0], tints: [mem.r32(0x5d4e158), mem.r32(0x5d4e150), mem.r32(0x5d4e148)],
      chuteIcon: mem.r32(0x5d4dd38) | 0, gauge: mem.f32(0x5d4e138),
      segments: Array.from({ length: 12 }, (_, i) => mem.r32(0x5d4e0c8 + i * 8) | 0),
      spin: [mem.f32(0x94a0d8), mem.f32(0x94a0d4), mem.f32(0x94a0d0)],
    };
  }

  /**
   * the end-of-game block of the loop FUN_007cf929 (case 2: `if (DAT_05d5ee68 != 0) { ... }`, 0x7cfe00 up to its jump to 0x7d0581): the code runs from the middle of the function on a
   * prepared frame (local_8 = 2). Returns the game-variable writes, the result word DAT_05d5edc8 (1 success / 2 failure), the speech calls and the mode.
   */
  endOfGame({ score, stored, trophy = 0, over = 1, result = 0 }) {
    const mem = this.cpu.mem;
    this.vars.set(0x2c, stored); this.vars.set(0x43, trophy);
    mem.wf32(0x5d5f090, score); mem.w32(0x5d5ee68, over); mem.w32(0x5d5edc8, result);
    this.log = [];
    const ebp = this.runBlock(0x7cfe00, 0x7d0581, [[-4, 2]]);
    return { mode: mem.r32(ebp - 4), result: mem.r32(0x5d5edc8) | 0, hiscore: this.vars.get(0x2c) | 0, trophy: this.vars.get(0x43) | 0, log: this.log.filter((e) => /^(say|stop|setVar)/.test(e)) };
  }
}
