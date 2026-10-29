// WP-VERIFY M7 island ambient nodes: Music (the music director on PEPP: ctor FUN_004bc773, update FUN_004bc533 / FUN_004bc190, docs/re/m4/wp7-ambient.md "Music") against the original's code in the x86 emulation
// (tools/lib/m7-isl-veh-ambient*.mjs). The audio engine is hosted and logged: compared per tick are the engine calls (keys played, groove level, ambience, mute), the node block and all game variables, for the five story
// eras, Pepper walking between the five music buildings, the DirectMusic notifications (theme switch, 120 tick debounce), the control modes of the groove and the story node 0x38 radio switch.
import { makeEnv, music } from '../lib/m7-isl-veh-ambient-sc.mjs';
export default { name: 'm7-isl-veh-music', async run(ctx) { const env = makeEnv(ctx); await music(env); return env.result(); } };
