// WP-VERIFY M7 island ambient nodes (docs/re/m4/wp7-ambient.md): Butterfly (FUN_004b24f8 / FUN_004b2539), Spin (FUN_004bd900), SeaAmin (FUN_004b1212 / FUN_004b109e), Sound3d (FUN_00538779): the ORIGINAL's node code runs natively
// in the x86 emulation (tools/lib/m7-isl-veh-ambient.mjs + m7-isl-veh-emu.mjs; scenarios in tools/lib/m7-isl-veh-ambient-sc.mjs) next to the port's nodes (src/island/ambient/**) with the same scripted Pepper position / buttons and the
// same random numbers (FUN_004388ae runs natively on a scripted CRT rand); compared tick by tick: records (matrix, Euler, flags), node blocks, all game variables, sound calls, the random draw count of every tick.
import { makeEnv, butterflies, misc } from '../lib/m7-isl-veh-ambient-sc.mjs';
export default { name: 'm7-isl-veh-ambient', async run(ctx) { const env = makeEnv(ctx); await misc(env); await butterflies(env); return env.result(); } };
