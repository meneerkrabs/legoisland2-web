// WP-VERIFY M7 island ambient nodes: Brikimal (BML1 / BML3, FUN_004bcc1b, ctor FUN_004bd4a8) against the original's code in the x86 emulation (tools/lib/m7-isl-veh-ambient*.mjs): record pose, node block (timers, phase, toggle, the morph
// matrix), the game variable that counts the animal's shape, the morph sound, random draws; Pepper far away (the 300 tick counter) and near (waiting, Enter within 16).
import { makeEnv, briki } from '../lib/m7-isl-veh-ambient-sc.mjs';
export default { name: 'm7-isl-veh-brikimal', async run(ctx) { const env = makeEnv(ctx); await briki(env); return env.result(); } };
