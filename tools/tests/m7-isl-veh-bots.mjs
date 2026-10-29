// WP-VERIFY M7 island ambient nodes: BOTMUSIC (the dancing bricksterbots, FUN_00536a44) and GETO (the ghetto blaster, FUN_005366b0 / FUN_005367b9 / FUN_00536806) of era 3 (story node 52) against the original's code in the x86 emulation
// (tools/lib/m7-isl-veh-ambient*.mjs): bot poses and animation (clip 0xfa, rate by the dance timer), the node block (timer, emitter matrix), the music emitter calls (gate / matrix / density), the face expression calls, the music
// mute of the blaster, the vars (0x22 radio, the bots' MOVE bits 1 / 0x1000000 / 0x4000000).
import { makeEnv, bots } from '../lib/m7-isl-veh-ambient-sc.mjs';
export default { name: 'm7-isl-veh-bots', async run(ctx) { const env = makeEnv(ctx); await bots(env); return env.result(); } };
