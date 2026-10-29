// WP-VERIFY M7 (fork B): helpers of the SupaStat.c train oracle (TRNL / TRNT / TRNC, FUN_0053d66c) on top of tools/lib/m7-isl-veh-emu.mjs.
// The waypoint walker (Common\WayPt: FUN_00462d4f create, FUN_004626d0 step, FUN_00461c24 goto, 461e69 / 461f42 pause / resume, 4621c7 speed scale, 4623f0 follow distance ...) runs NATIVELY from the original's
// code on the island's compiled ROAD map (the pages the original's own set-up loaded); the port runs its src/game/walker.ts. The walker engine is verified by M1 (tools/tests/m7-walker-emu.mjs): here it is the
// shared substrate of the train, both sides consume the same map, and every train record pose is compared tick by tick (a walker difference would show in them).
import { Duel } from './m7-isl-veh-emu.mjs';

export const WALKER_RANGE = [0x460e00, 0x466200];

/** a Duel whose emulated CPU also executes the walker range natively (the constructor FUN_0053d66c calls FUN_00462d4f at attach time: the range must be executable when the Duel attaches the nodes) */
export function trainDuel(ctx, o) { return new Duel(ctx, { ...o, extraExec: [...(o.extraExec ?? []), WALKER_RANGE] }); }
