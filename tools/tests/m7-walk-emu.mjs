import { createRunner, makeScript, constScript } from '../lib/m7-walk-run.mjs';
import { B } from '../../src/game/input.ts';

// M7 / WP-VERIFY: Pepper's walk node (SGwalk: FUN_0042d514 with FUN_0042a654 / 0042a487 input, 0042a88f transitions, 00429e00 slope tilt, 0042baf6 footsteps), its ground / wall
// collision queries (FUN_00441270 sweep, FUN_00441ac0 probe, FUN_0043cd62 -> 004425f0 -> 00441b10 terrain ray with its hit cache) and the chase camera (FUN_0042c227, FUN_0043cc5c) run from
// the ORIGINAL code in the x86 emulation (tools/lib/m7-walk-emu.mjs), next to the port's WalkNode / CollisionWorld / ChaseCamera, with the same input, tick by tick.
// The collision data is loaded by the original's own loader FUN_0043f370 from the zone's .col files; the player's animation runs on the original's anim functions. Hosted: game variables,
// sounds (compared by id), keyboard / pad / mouse readers (the keys come from the scenario). "sync": the original starts every tick from exactly the port's state (record, node, camera, the
// collision state of the hit cache ...), so a difference is attributable to that tick. Tolerances (tools/lib/m7-walk-run.mjs): the walk node, the record and the collision results are
// float32-exact in the port; the comparison still allows 1e-5 (relative) for floats and 1e-4 for the tilt's rotation elements; the camera is compared with 1e-5 (see m7-camera-patch.mjs).
// This file: the small room zones (z03PPH house, z50LTC cave, z18MMP pyramid, z17WAS) at dt = 1 and 0.5, and the states a room reaches (idle gag turn, skid, slow walking, walls).
// The island is m7-walk-island, injected states m7-walk-states, free runs m7-walk-free, the swim / mode switch m7-walk-swim.
export default {
  name: 'm7-walk-emu',
  async run(ctx) {
    const R = await createRunner(ctx);
    const S = (name, zone, dt, held, o = {}) => R.scenario({ name, zone, dt, held, ...o });
    // the house (sub-game 3: no jumps, no ledges): random walks
    for (let seed = 1; seed <= 3; seed++) S(`z03PPH seed ${seed}`, 'z03PPH', 1, makeScript(seed, 300, { jump: 0.03 }));
    for (let seed = 4; seed <= 5; seed++) S(`z03PPH seed ${seed}`, 'z03PPH', 0.5, makeScript(seed, 400, { jump: 0.03 }));
    // the same room with the sub-game variable of a zone that allows jumping and ledges (the code paths of the island on the house's geometry)
    for (let seed = 11; seed <= 13; seed++) S(`z03PPH subgame 0 seed ${seed}`, 'z03PPH', seed === 13 ? 0.5 : 1, makeScript(seed, 300, { jump: 0.04 }), { subgame: 0 });
    // standing still for more than 1000 ticks after the first movement: the idle gag (state 3, turning to the camera), both turn directions through the camera orbit keys
    S('z03PPH idle gag', 'z03PPH', 1, [...constScript([[B.UP, 6], [0, 1060]]), ...constScript([[B.Z, 8], [0, 60]])], { noCoverage: false });
    // 230 ticks of running (the run timer reaches 200), then letting go: the skid (state 0x30) and the sneak / walk / run speeds on the way back
    S('z03PPH skid', 'z03PPH', 1, constScript([[B.UP, 230], [0, 40], [B.UP, 6], [0, 20], [B.UP | B.LEFT, 12], [0, 20]]));
    // slow walking: short taps keep the speed factor between 0.01 and 0.4 (sneak, walk) and the stick ramp inside its dead zone
    S('z03PPH taps', 'z03PPH', 1, constScript(Array.from({ length: 40 }, (_, i) => [[B.UP, 2 + (i % 4)], [0, 4 + (i % 5)]]).flat()));
    // the other room zones: the cave (ground record CAVE, sub-game 0x22), the pyramid, whack-a-snake (sub-game 0x11: jumping disabled)
    for (let seed = 21; seed <= 22; seed++) S(`z50LTC seed ${seed}`, 'z50LTC', seed === 22 ? 0.5 : 1, makeScript(seed, 200, { jump: 0.03 }));
    for (let seed = 23; seed <= 24; seed++) S(`z18MMP seed ${seed}`, 'z18MMP', seed === 24 ? 0.5 : 1, makeScript(seed, 200, { jump: 0.03 }));
    S('z17WAS seed 25', 'z17WAS', 1, makeScript(25, 200, { jump: 0.05 }));
    return { checked: R.checked, failures: R.failures, notes: R.summary() };
  },
};
