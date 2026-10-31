# M4 WP11: the Brickster's bots (BrickBot.c, botPConly.c)

Code: `src/island/npc/brickbot.ts` (registered from `src/island/npc/index.ts`; `startIslandNpcs` calls `startBrickBots`), test
`tools/tests/m4-wp11-brickbot.mjs` (81 checks, nodes 7 / 8 / 30 / 52), browser bot `tools/steps/m4-wp11-brickbot.mjs` (node 8 played with Space / ArrowUp
to node 9).

| constructor | node / vtable | update | pre-render | port |
|---|---|---|---|---|
| `0x531d45` follower | 0xc0, 0x8eaa90 | `0x530e80` | `0x531286` (+ clip map `0x531944`) | `BotFollowNode` |
| `0x5327b1` hit / collect | 0x30, 0x8eaaa8 | `0x531e97` | `0x532557` | `BotHitNode` |
| `0x532acc` harass | 0x1c, 0x8eaac8 | `0x532939` | - | `BotHarassNode` |
| `0x533ba8` hide | 0x44, 0x8eaae0 | `0x532bb1` | `0x533ac2` | `BotHideNode` |
| `0x53de63` botPConly.c | 0x2c, 0x8eb248 | `0x53d990` | `0x53dc65` | `BotPcOnlyNode` |

Era 1 (nodes 7..29) has 35 BrickBot attaches (13 follow, 10 hit, 9 harass, 3 hide) + 1 botPConly (BBT5). Every bot also has SGMFIG at position 0 (talk
type 1, animation set 4 = no catch clips, lane 0.3), Human1 (random walk) last, MeetPepp (& 4, never reached, see below), and BBR0 a Turn2Pep C.

## How the bots work (findings)

* **The chain per bot** (e.g. BBR0): SGMFIG (always) / hit (`MOVE & 0x1000`) / Turn2Pep C (`MOVE_BBT1 & 1`: BBR0 |= 1) / follow BBT1 (`& 1 == 0`) /
  follow - (`& 8`) / MeetPepp (`& 4`) / harass (always) / Human1. Hit, follow (with a leader) and hide return 1, so Human1 walks only free bots.
* **Following**: BBT1 follows PAPA, BBR0 follows BBT1 (a conga line), BBB0 NICK, BBG0 **rides on JACK** (type 3: the leader's matrix, +4, -0.5 in clip
  0x29). Followers stand 1 unit (argument 0.125 * 8) behind the leader's place 4 ticks ago (a 5-entry history), clone its walker, and play the leader's clip
  mapped by `FUN_00531944` (walk -> BB_CHEEKYWALK1/2/3, wave -> BB_CHEEKYWAVE1/2 ...), in step with its frame. Every ~360 ticks while the leader walks:
  the tap gag BB_CHEEKYTAP1 (then the leader's MOVE |= 2) or the spin BB_CHEEKYSPIN (the spin's state 3 is overwritten by 0 in the same call: dead code;
  so the leader never gets bit 4 and the bots' MeetPepp never runs). The leader's MOVE gets 0x2000000 (followed); the follower's own MOVE |= 0x20000.
  Follower types: argument < 1 takes 0, 1, 2 in turn from `DAT_05d586a4` **in attach order** (the port numbers the nodes at creation); BBB0's argument is
  the float 4.0 read as an int (0x40800000), which `FUN_00531944` treats like type 0.
* **Harass**: a free bot whose walker ignored a walker ahead (`FUN_00461ee4`, flag 0x400000; the hit constructor sets noYield on every bot) and whose
  record is not followed already makes it the leader of its `& 8` follower node (MOVE |= 8). Random face 0..5 every 6 ticks.
* **Hiding** (BBT0 always; BBT3 / BBT4 until hit): keep a PATH node between itself and Pepper (BBT3 / BBT4: DJAB) by going round it at the lane radius
  (0.3 * 8 = 2.4) at 0.2 per tick when the angle is off by more than 10 degrees; hidden for 90 ticks: peek (BB_CHEEKYWAVE2). BBT0 every 300 ticks moves
  to the neighbour on the ring `DAT_008eaaf8` {0x171..0x177} that is farther from Pepper: round the old node until the new one is < 90 degrees off, then
  run (walker route + 0.4 per tick along its facing, BB_RUN2). Frozen after 90 ticks out of view.
* **Hit**: SGMFIG's pizza reaction (`FUN_0042477f`) sets MOVE 0x3000 while a pizza comes at the targetable bot (0x2000 is cleared when none comes). The
  hit node then runs: `FUN_00429556` (WP5 `pizzaHitOn`) 1 = a thrown pizza hit it, 2 = the hand-over pizza (Space within 4.8 units) reached it ->
  MOVE &= ~0xfe, |= 1 (stops following / hiding for good), Piza_Hit (0x102) at the bot. **Every tick of a pizza coming at the bot** (also without a hit:
  the code at 0x53229e is outside the hit test, Ghidra shows it inside) the harassed NPC (argument +0: MOVE_PAPA / NICK / POST / TBOB) gets |= 1 and loses
  0x20000 (set by the constructor). The pizza went past: 0x1000 cleared. Next tick: swirl01.swl over the head, no box collision (record flag 0x40 off, so
  Pepper can walk into it), clip BB_PIZZAHIT (0x94) / BB_PIZZADOUBLEHIT1 (0xcf) / BB_PIZZADAZED (0x95, fall); then 0x95 loops (count 5 / 4), BB_SITTING2STANDING
  (0x11b), then back to normal (walker re-registered, 0x1000 and 0x1000000 cleared). A second hit while dazed restarts the count.
* **Collect** (pre-render `FUN_00532557`): whenever the hit node ran this tick (the bot is dazed **or a pizza is coming at it**) and Pepper is within 2
  units (controller distance^2 < 4.0 at `_DAT_008eaac0`): NUM_BOT_HEADS (0x52) + 1, SCORE_LGI + 1000, HISCORE_LGI + 1000, Collect.wav (0x2f1),
  Explode01.par, COLORED_BOTHEADS (0x8e) |= 8 / 4 / 2 / 1 by the 3rd letter B / G / R / Y (grey bots count only in NUM_BOT_HEADS). The bot shrinks from
  0.9 by 0.2 per tick, then MOVE = 0x4000 (SGMFIG hides it; the harass constructor keeps 0x4000 at the next set-up, so it stays gone). So the hand-over
  pizza usually collects at once (Pepper is within 3 units).
* **Story**: node 7 = NUM_PAGES == 4, node 8 = COLORED_BOTHEADS == 15, node 9 = NEXT_SUBGAME == 5. The handler (WP8) has nothing bot-specific on node 8
  (objective -1); on 8 -> 9: hologram alert, record 11 hidden, MOVE_INFO = 0x4000, objective record 124. The HUD (WP8) hides the four head icons at 15.
* **Era 2** (node 30): six grey bots (BBT1 follows TBOB, BBT3 BBT2), harass / hit as in era 1. **Era 3** (node 52): the hit node runs always: Pepper in
  front (SGMFIG's 0x200) -> BB surprised (0x70), pause 60; pizzas no longer hit (`FUN_00429556` returns 0 from node 0x34).
* **botPConly** (BBT5, era 1): below y 96 and within 24 units of TBOB it sets MOVE_TBOB |= 0x20; with its MOVE & 2 it runs to PATH 255 and back to 252
  (BB_RUN1); a fall (SGMFIG falling, or more than 0.04 per tick) plays BB_PIZZADAZED and then sets 0x11000 (the hit node: knocked over, how 3).

## Approximations / not ported

* **No brick effect**: BrickBot.c has no `FUN_00447e90` call; `ctx.brickBurst` is not used. Particles go through the optional `ctx.particles`
  (Explode01.par at (0, 4, 0), swirl01.swl at (0, 3.2, -2) of the bot, mode 2 emit / 1 stop / 0 move); the zone game does not implement it yet.
* **No talk lines / sounds of their own**: the bots are targetable, so SGMFIG never lets Pepper talk to them; BrickBot.c plays only Piza_Hit and Collect.
* `FUN_0043a742` (the shrink) is `buildMatrix(..., scale)` + `rec.scale`. Save / load hooks (`0x531bbd` / `0x531c99` ...) not ported.
* Random numbers use `Math.random` (`FUN_004388ae`). `inView` without `ctx.inFrustum` counts every bot as in view (so the hide node never freezes).
* The follower's history positions are written in the update like the original; Human1 / SGMFIG behaviour of the bots is WP3's (e.g. Human1 walks the
  bots with clip 0x118 BB_RUN1 from its argument).
* The tests are statistical in one point: the bots walk (Human1 `Math.random`), so a throw can hit an umbrella / the ground first; the test and the
  browser bot try other angles (as a player would).

## Lead

* Nothing to wire beyond the existing `startIslandNpcs(world)` (it now ends with `startBrickBots`). Optional ctx: `particles`, `expression`, `inFrustum`.
* Pre-existing, not mine: `m4-wp3-npc` fails one check ("back to walking (PEPPER_CONTROL 0x1, mailbox 0x0)") with or without the bot nodes registered.

## Differential test (WP-VERIFY M7b)

`tools/tests/m7-isl-bb-*.mjs` (libs `tools/lib/m7-isl-bb-emu.mjs`, `m7-isl-bb-bunny.mjs`) run the original's BrickBot.c / botPConly.c code (ctors `0x531d45 / 0x5327b1 / 0x532acc / 0x533ba8 / 0x53de63`, update and
pre-render hooks, SGMFIG / Human1 / MeetPepp / Turn2Pep C of the same chains, walker, animation, collision and the pizza nodes `0x42887c / 0x42900b / 0x429d1b` natively, x87 at 24 bit) next to `src/island/npc/brickbot.ts`
on the port's island world, on top of the NPC oracle (`docs/re/m4/wp3-npc.md`, "Differential test (WP-VERIFY M7)"). Compared every tick: records (matrix, Euler, flags, clip / frame), controllers, every node block of the bots
(follower history / clips / gag state, hit state, harass timer, hide state, botPConly), all 319 variables, sounds (incl. `sfx3d` Piza_Hit at the bot, Collect), speech, random draws. Tests (each < ~25 s CPU): `free` (node 7,
dt 1 / 0.5, Pepper far and chasing, records out of view), `hit` (MOVE states 0x3000 / 0x1000000 / 0x11000 / 0x4000, dazed sequences, collect, shrink; dt 1 / 0.5), `gates` (bit combinations of the chains: harass hands
leaders over), `pizza` (real throws via Space at bots and NPCs, the hand-over, `FUN_00429183 / 00429556 / 0042477f`), `pconly` (BBT5: run, fall, TBOB), `eras` (nodes 30 / 52 / 61: rosters, talks, era 3 wave gag and
"no pizza hit"), `npc` (nodes 7 / 30: Human1 stop / wait, gate fuzz), `bunny` (RBT0-4 `0x4b2149`, ambient oracle: free, Shift pokes, five at once, out of view, three sessions). Buildings `0x535e80 / 0x5364a5` are covered
by `m7-isl-veh-bldg*.mjs` (eras 0-3), `0x4b2d44` / `0x4b3a92` (Butterfly / Swift, not Bunny) by `m7-isl-veh-ambient` / `-swift`.

Deviations found (port-owned `src/island/**`, not edited; neutralised in the harness, each with an evidence run that prints the first difference):
* **BB1 (BrickBot.c hit gate)**: `FUN_005327b1` has four parameters and writes `+0xc = +0xe = 0` (asm `0x532817 / 0x532820`): the node runs every tick in all eras. The port keeps the attach's gate `MOVE & 0x1000` (eras 1 / 2), so a
  forced hit (`0x1000000` alone) and the repeated "gone" writes of the original are ignored. Evidence: node 7, BBT2 MOVE = 0x1000000: t5 original clip 149 (0x95 BB_PIZZADAZED, count 4, flags 3), port still clip 280 (0x118 BB_RUN1, flags 67).
* **BB2 (shrink)**: scale 0x3f666666, `-= 0.2f * dt` in float32 ends at <= 0 on step 9 at dt 0.5 (-1.5e-8), the port (doubles 0.9 / 0.2) on step 10 (+1.1e-16). Evidence: BBT4 collected at dt 0.5, original `+0x22 = -1` one tick earlier.
  Fix: round scale and decrement with `Math.fround`.
* **D8 (Human1 hop end)**: the hop arc ends at `_DAT_00892554` = 0x3fc90f94 (1.5707879) and is clamped to it; the port's `HOP_MAX` is 1.5707964 (pi / 2): `hopping` ends one tick later (BBR0 after BBT1 is hit, t74).
* **D9 (Human1 hop step)**: `0x3e32b884` (0.174531996) * dt in float32: after nine descending steps hop = +1.2e-7 (the original ends on step 10 and restarts the walk clip there), the port's double 0.174532 ends on step 9 (clip 0x118
  at t83 vs original 0x116). Both are visible as a one-tick shift of the walk clip / height after a hop.
* **D10 (Bunny choose, `animals.ts` `choose` / `enter`)**: `FUN_004b17eb` returns the new state in eax except when the capped draw equals the current state (state 2, raw draw 3 -> 2): eax is -1 (17 of 60 draws from state 2) and
  `FUN_004b1712 / 004b1647` match no case: no count, no steer, no clip restart, count stays -1 until the next loop. The port enters state 2 again (count = rand(5), steer, clip 2). Evidence: RBT0 t15, original matrix unrotated, port rotated.
* Float noise, not a deviation: a hiding bot circles a PATH node (2.4 units) at |pos| ~ 190 (ulp 1.5e-5): the yaw drift of double vs float32 grows as a random walk; the harness re-syncs matrix / Euler of hide-node records before each tick
  (`syncHideKin`, step results still compared at 1e-5).

Wrong statements of this doc: the hit node's gate ("`MOVE & 0x1000` in eras 1 / 2, always in era 3" in the table above and in the follower text): the original always runs it (BB1). Everything else that was checkable
(follower types in attach order incl. BBB0's int 0x40800000, the dead spin state 3, hit / collect rules, `0x53229e` outside the hit test, how = 1 / 2 / 3 / -1, botPConly) matches the original tick by tick.

## Status 2026-10-31 (WP-ISLAND-CLOSE: the statements of this document that are out of date)

* Save / load hooks are ported (`brickbot.ts` `saveBlock` / `loadBlock`, `m8-save-npc*`); random numbers use the shared CRT generator, not `Math.random`; `FUN_00427000` is called at the places the original calls it (`f14 |= 0x10`).
