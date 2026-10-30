# M4 WP3: the island's talking minifigs (SGMFIG, Human1, Turn2Pep, MeetPepp)

Code: `src/island/npc/` (`index.ts` registers the constructors), test `tools/tests/m4-wp3-npc.mjs` (40 checks, real island world of story nodes 2 and 7).
All behaviour is ported from the decompile; constants carry their EXE address; tables (animation sets, random route nodes, camera offsets) are read
from the EXE at run time (`pe.u32`), with the values of the NL retail build as a fallback only when there is no `Pe`.

| constructor | source | node | file |
|---|---|---|---|
| `0x426151` (vtable 0x8adce0: update `0x425c13`, pre-render `0x426014`, destroy `0x42651e`, draw `0x4260d6`) | SGMFIG.c | `SgmfigNode` | `sgmfig.ts` |
| `0x4bec00` (vtable 0x8da330: update `0x4be20f`, the other hooks return 1) | Human1.c | `Human1Node` | `human1.ts` |
| `0x52ff39` (vtable 0x8ea948: update `0x52fa90`) | Turn2Pep.c | `Turn2PepANode` | `turn2pep.ts` |
| `0x5306e5` (vtable 0x8ea960: update `0x53004b`) | Turn2Pep.c | `Turn2PepBNode` | `turn2pep.ts` |
| `0x5308f3` (vtable 0x8ea978: update `0x530832`) | Turn2Pep.c | `Turn2PepCNode` | `turn2pep.ts` |
| `0x530d69` (vtable 0x8eaa38: update `0x5309c0`) | MeetPepp.c | `MeetPeppNode` | `turn2pep.ts` |

Not ported: BrickBot.c (four constructors, era 1+; see "Open").

## 1. The interaction core

* **Space** (walk update `FUN_0042d514` at 0x42da7d) calls `FUN_00427c15`: 0 = nothing (no pizza record `DAT_009da874[0]`, or story node 0x38..0x3c),
  1 = throw (always in nodes 0x35..0x37; otherwise when `FUN_0042796e` finds no target, the target is >= 4.8 units away (squared 23.04 at
  `_DAT_008920e4`) or there is no pizza node), 2 = hand the pizza to the target (`DAT_009da870`). Result 1 -> Pepper state 0x0b (walk / sneak / idle)
  with `FUN_004277d0(14, 42)` or 0x42 (running) with `FUN_004277d0(4, 10)`, each after `FUN_004435a0(DAT_009da960 / DAT_009da984)`; result 2 -> state
  0x0c with `FUN_00428a0a(10, 40)`. **This is the pizza throw, not talking.** WP5 ported it together with the throw (`pizzaPrelude`,
  `findPizzaTarget` in `src/island/pizza/pizza.ts`, the walk hook `walkHooks.space` in `src/game/walk.ts`); `src/island/npc/interact.ts` re-exports
  them as `interact` / `nearestTarget`. `FUN_0042796e`: records with flags 2, an enabled targetable controller (flags 0x40 | 2), 3D squared distance
  <= 40000, `|heading - bearing|` (halved below 80 units: both factors at 1600 / 6400 are 0.5) <= the cone (45 degrees for Space, 10 degrees for the
  pizza in flight).
* **Shift** is read by every talking NPC itself (`FUN_00425c13`): on the Shift press, unless a cutscene runs / a dialog holds the cutscene flag
  (`FUN_0045c432`), the lock `DAT_009da844` is set (swimming) or Pepper is neither walking nor aiming (`PEPPER_CONTROL & 0x11 == 0`), each NPC whose
  controller is not targetable (flag 0x40 clear) competes: the one already talking wins (distance 0), else the smallest controller distance^2
  (`c+0x18`, XZ to Pepper) below `_DAT_009da640` becomes `DAT_009da6d0` (`npcGlobals(w).target`). `_DAT_009da640` is 1e38 after a constructor and
  256 after every frame (the draw hook `FUN_004260d6`; the port resets it at the end of the pre-render hook, which is equivalent). In a cutscene the
  candidate is cleared (-1 / null), which also stops a conversation from restarting on the Shift that ended it.
* **INTERACT_ICONS** (var 0xc): bit 1 (talk) is or-ed by `FUN_00425902` while Pepper is inside an NPC's talk radius, the controller has flag 0x10
  (all island NPCs: controller flags 0x13 from `FUN_004238b7`) and bit 0x20000 of the state word is clear. Other writers (or): the boat `FUN_0042f9a2`
  (8, 0x80), the helicopter `FUN_00431425` (4, 0x40), the Ptera `FUN_004b93b0` (0x40, 2), StartCSM `FUN_0051dd7e` / `FUN_0051e5ab` (the trigger's own
  bits), `FUN_0053594e` (0x20), `FUN_0053c6eb` (0x40, 0x10), CSI `FUN_005769a8` (2); the zone loops set it to 0 every frame after reading it.

## 2. SGMFIG (`FUN_00426151`)

Argument block (the shared scratch block of the set-up, only these fields are read): `+0x00` i16 customer type (0 none, 1 pizza, 2 house: node +0x50),
`+0x04` f32 talk radius, `+0x08` f32 near radius (both "metres": squared after * 8; 1.0 / 4.0 = 8 / 32 units for every island NPC), `+0x0c` u16 the
state bits needed before Shift from behind calls the NPC, `+0x10` i32 first clip (0x78), `+0x14` i32 PATH start node (-1 nearest), `+0x18` sound id,
`+0x1c..0x1f` 4 bytes (copied to node +0x24, not read), `+0x20` i16 cutscene slot (-1 none), `+0x24` f32 lane offset, `+0x28` i16 animation set,
`+0x2a` / `+0x2c` the reward's var and op (1 set 1, 2 add 1, 3 subtract 1). With bit 0x40000 already in the state word the type is 0 and the slot -1.

Constructor: node gate = the NPC's `MOVE_<NAME>` var, record flag 0x40, the controller's walker (`FUN_00462d4f(1 PATH, rec, start)`, speed
0.016667, lane, turn rate 0.5236, radii 0.2 / 0.75 / 0.25, `FUN_00461fe4`), the first clip, then onto the ground (terrain below y + 4, a probe with mask 1).
The port does this in `init` (from `startIslandNpcs` or the first update: the factory does not see the world) and also gives the record an MFIG
animation instance (the original's builder does that) and applies the set-up's controller flags (`attach.ctrlFlags`, 0x13).

**State word** (`MOVE_<NAME>`, the node's var; the companion nodes are gated on it):

| bit | meaning | written by |
|---|---|---|
| 0x1 / 0x2 / 0x4 | which Human1 route runs (gates `&1 == 0`, `&2`, `&4` in the island's set-up) | Human1 waypoint actions, reward (0x40001 / 0x40003), scripts |
| 0x40 | MeetPepp / Turn2Pep B (era dependent) | waypoint actions, scripts |
| 0x100 | Pepper near: Turn2Pep A turns the NPC to Pepper | `FUN_00425902` (0x500 / 0x700 / 0xd00) |
| 0x200 | wave (Pepper in front, not within the talk radius) | `FUN_00425902` (0x700), cleared 0x600 / 0x200 |
| 0x400 | Pepper in front within the talk radius / turn back blocked | `FUN_00425902`; Turn2Pep A or-s it after frame 20 of the first clip |
| 0x800 | play the Turn2Pep clip `first` before turning (Shift from behind: 0xd00) | `FUN_00425902`, cleared by Turn2Pep A |
| 0x1000 / 0x2000 | pizza reaction running (0x2000 also: no talking; the update returns 2 / 1) | `FUN_0042477f` |
| 0x4000 | hidden (the update clears record flag 2 and stops) | scripts |
| 0x8000 | take the pizza box (Turn2Pep / MeetPepp release PIZ3, WP5 `releaseCarry`) | reward op 3 on NUM_PIZZAS |
| 0x20000 | no talking this tick (cleared by the pre-render hook) | scripts |
| 0x40000 | talked to (the cutscene was played: next time a plain conversation) | reward |
| 0x40000000 | no pizza reaction | scripts |

**Pre-render** (`FUN_00426014`): the ground probe result (see probe) -> `FUN_00424526` (a targetable NPC on another's spot steps 1 unit forward;
nothing below -> fall by `+0x48`, accelerating by the animation set's +0x10 (0.032) up to 4, not below the sea); out of view (record flag 1): clear
0xe00; else the pizza reaction `FUN_0042477f` (WP5's `incomingPizza` = `FUN_00429183`; clips catch high / low of the animation set) or the state logic
`FUN_00425902` (`FUN_004242f0`: Pepper's side within the near radius: 2 in front (60 degrees), 8 beside, 4 behind):

* within the talk radius: talk icon; flag 0x10 (`+0x4c`) keeps "in front" while talking range lasts. Out of it: the line pair resets to A/B.
* in front within the talk radius: set 0x500, clear 0x200; Shift on this NPC: the skateboard (`DAT_009daa7c`) is hidden, `FUN_004252c3` (Pepper turns
  to the NPC unless aiming, closer than 1.28 the NPC steps back along its forward and returns when Pepper is 2.08 away, `PEPPER_CONTROL = 1`), then
  the NPC's cutscene slot (first time; `+0x52 = -10`) or the conversation `FUN_004254a5`.
* in front, in the near radius only: set 0x700 (Turn2Pep A turns and waves). Out of range: clear 0x600.
* behind / beside within the talk radius: with the needed bits: Shift plays the NPC's sound and sets 0xd00, else clear 0x400; without them 0x700 /
  (Shift) 0x500 & ~0x200.

**Conversation** (`FUN_004254a5` start, `FUN_004249a6` per update while `+0x4c & 0x40`; the update returns 1 so the other nodes stop):
the NPC's clip is saved, timer 90, the cutscene flag held (`FUN_0045c456(1)`), Pepper's controller disabled (flag 2) and put on the ground, Pepper
plays clip 0x78 (mailbox 0x78), the conversation camera is placed in the next update (`FUN_00422f21(npc, Pepper's yaw + PI, side 1, 3.2, (4, 2, -10)
at 0x8add78)`, the side table 0x8adc6c tries 1, 5, 2, 3, 4 when a sweep from the target hits). **Line selection**: tag = the record's 4-character
name + `'A' + 2 * line` and the next letter, `line` (`+0x58`) = 0 for the first conversation, 1 for the next, wrapping after 1 and reset when Pepper
leaves the talk radius; the texts come from `DAT_009da7d8` = the story handler's `lifsmN.str` (`ctx.text.npc`; node < 4: lifsm1 ...). A missing tag
returns the tag itself: B / D do not exist in lifsm1..5, so one line is spoken. With `line == 1` the NPC also points: the clip +0xc of the animation
set (129) and its walker turns to the objective (`FUN_00424e37`, WP8's `ctx.objective.target`); no target -> `line = 0`. Voices: `FUN_00435a11(v1, v2)`
when the speech channel is idle, else kept in `+0x5c/+0x60` and played when it is (`ctx.say(table, id, id2)`); with speech off (var 9) nothing waits
(-1 / -1). Subtitle `FUN_0045d47f` (A text + B text, `FUN_0085b580`) when `CS_TEXT_ON`, written at the start whether the voice starts or waits (the
voice that starts later writes none); the four lines stay until the end clears them (`DAT_05d4df1c ..` = 0): `ctx.say(..., 'held')` / `clearSubtitle`. End: with speech on (var 9) when the timer is below 30 and the speech is idle, with speech off when the timer is below 0; Shift ends it at
once (`PEPPER_CONTROL |= 0x100`, `FUN_00435b07`). The pointing clip runs to frame 15, then back from 29 - timer; at timer <= 2 the walker stops turning.
At the end: Pepper idle (clip / mailbox 0x1b, `PEPPER_CONTROL = 1`), her controller enabled, the NPC's old clip, the cutscene flag released, `line`+1,
the face `DAT_009da7d0` (`ctx.expression`), the camera behind Pepper (`FUN_00422f21(pep, yaw, 2, 3.2, (0, 4, -20))`); then the update clears
`+0x4c & 0x40` and `PEPPER_CONTROL & 0x100`. While talking, every 6 (95 %) / 2 ticks a random face 0..5 / 6..9 (`FUN_0043f2f0`).

**Cutscene customers**: Shift starts slot `+0x52`, which becomes -10, then -20 and -30 in the next updates (the port waits for the cutscene to end:
the original's AI is off while it runs): type 1 / 2 pay SCORE_LGI and var 0x12 + 1000, type 2 also starts slot 0x1a + HOUSECONTRUCTIONPHASE
(LGIPH01..), phase + 1, NUM_BRICKS - 1 (WP5's `customerReward`); the state word gets 0x40003 (reward var NUM_PIZZAS) or 0x40001 and the NPC's group
(`FUN_0042407f` groups, `FUN_004240d1`) the same bits; then the reward op (`customerVarOp`: NUM_PIZZAS - 1 also sets 0x8000).

**Ground probe** (`FUN_00427014` request in the update: start (0, 4, 0) relative, segment (0, -4.4, 0) or (0, -(fall + 4), 0) while falling, mask 3 /
0x43 (non-targetable), flags 0xa110 | 0x1003 / 0x2110 | 0x1003; run by `FUN_00427233` after the update pass): the terrain height (ray from y + 8) when
it is above the end of the segment, else a probe sweep without the ground (an NPC hit loses against the terrain, flag 0x1000); y written back. Flag
0x2000 = only after `FUN_00427000` (controller +0x14 bit 0x10: Human1 sets it every walking tick, the falling branch too), flag 0x8000 = every 8th tick
when Pepper is farther than sqrt(512). Result 0 = nothing below -> the NPC falls. The port runs it from the first pre-render hook of the record
(`runProbe`, once per tick), which is the same order relative to the update and pre-render passes.

## 3. Human1 (`FUN_004bec00`, update `FUN_004be20f`)

Argument block: `+0x50` i8 count (<= 0: a random route), `+0x51` restart at waypoint 0 when the node starts again, waypoint i: node `+2i`, wait /
value `+0x14 + 2i`, action `+0x3c + i`, arrival flag `+0x46 + i`, clip `+0x28 + 2i` (0 -> 0x78); `+0x52` walk clip (0x73), `+0x54` idle clip
(0 -> 0x78), `+0x58` speed scale (multiplies the walker speed 0.016667). Update (returns 1): out of the island (|x|, |z| > 600, |y| > 300) -> PATH node
164; (re)order the walker to the current waypoint when the node starts, the goal differs or the walker is not on a route; Pepper in front within
squared 2.4 (80 degrees) or a driving car (records 166, 165, 172, 167, 168 whose head var has 0x20000000; ray 4 units ahead) -> pause, idle clip,
wait 30; a walker it was told to ignore ahead -> hop (clip 0x116, `sin(a) * 6` up, 10 degrees per tick to 90 and back); blocked -> the random routes
pick a goal behind them, the idle clip and wait 30. At a waypoint (`res == goal` or arrived): the next index (`FUN_004be0e2`: wrap; flag 4 hides the
record, 1 (2: out of view) puts it on the node), continue smoothly; the passed waypoint's action runs when the walker leaves it (`FUN_004bdde2`:
8 = its clip and wait `value` ticks, else `FUN_0051dc50(op, MOVE var, value)`: 1 set, 2 or, 4 and-not, 0x10 / 0x20 or / and-not on the group too, 0x40
pizza delivery). One waypoint: the action runs on arrival. Random routes: -1 any PATH node, -2 / -3 one of the 6 nodes of the table 0 / 1 at
0x8da300, -4 / -5 either table (rand(10) < 5), -5 and blocked: a table node whose route goes back over the node passed last. The walk clip advances
only while the record moves (`out.dist > 0.0001`); y comes from the SGMFIG probe.

## 4. Turn2Pep A / B, MeetPepp

* **A** (`+0x00` wave clip 0x74, `+0x04` idle 0x78, `+0x08` first clip 0x70, `+0x10` the record to face = PEPP; timers only outside sub-game 6):
  started -> the walker pauses, the heading is saved; with 0x800 the clip `first` plays to frame 20, then 0x400; with 0x100 (and not 0x400) the walker
  follows Pepper (turns only: the position is not taken), the clip loops idle; at a loop end with 0x100 only -> turn back to the saved heading next
  (`FUN_00462952`), done -> var &= ~0xb00; with 0x200 the wave clip alternates with idle, a pause of 180 ticks after each wave (returns 0 meanwhile, so
  Human1 walks on).
* **B** (`+0x00` first clip, `+0x02` idle, `+0x04` extra clip after 30 ticks of idle, `+0x06` mode (>= 0 end clip, -1 turn back, -3 none, -4 in step
  with the target's clip + `+0x10`), `+0x08` the record to face or `+0x0c/0x0e` a waypoint, `+0x14/0x16` value / op after `+0x1a` loops, `+0x18` hold
  bits): faces, loops, the var op after N loops, at the end toggles its own gate bit (cleared when mask == value).
  The island uses it for couples facing each other (LICK <-> NICK, mode -3) and the 150-loop scenes (gate & 0x40, op 2 value 4).
* **C** (`FUN_005308f3`: `+0x00` bits, `+0x04` a variable, `+0x08` mode; update `FUN_00530832`): `var |= bits` every tick its gate holds (once with
  mode 1, never with -1) and returns 0 (as if it had not run). Era 1: TBOB (gate 0x91 & 0x10: MOVE_TBOB |= 0x10), BBR0.
* **MeetPepp** (`+0x00` clip (-1: the head node's +0x30), `+0x04` loops, `+0x06/+0x08` op / value, `+0x0a` end bits, `+0x0c/0x0e` waypoint to face):
  plays the clip N times, the var op, then (end bits present) toggles its own gate bit. 0x8000: hands over the pizza box (480 ticks).

## Approximations and differences

* (WP-ISLAND, gaps S8) The cutscene reward of a customer advances exactly when the original's update pass runs the node: the pass skips controllers whose flag 2 is clear and the cutscene manager clears it for its actors (the old `!cutsceneActive()` guard is gone).
* (WP-ISLAND) Human1's hop lowering branch requests its probe with the uninitialised segment of the original: three times the stack fill 0xcccccccc as a float (-1.0737418e8).
* `FUN_0043b874` (advance without loop, Turn2Pep B hold) and the face (`FUN_0043f2f0`) are local helpers / an optional ctx service; record flag 1
  (in view) is `ctx.inFrustum` when the zone game provides it, else "in view".
* Sound of an NPC called from behind: `ctx.sfx(arg +0x18)` when > 0 (the original loads a handle with `FUN_00443580` and plays it when its status is 2).
* `DAT_0089df30` (written 4.0 at the start of a conversation, restored to `DAT_0089df50` = 4.0 in 32-bit colour: the zone's near plane is 4 already) has no effect; `DAT_009da648` (a matrix copy) has no reader in the whole executable: nothing to port (WP-ISLAND, gaps S8).
* Random numbers (`FUN_004388ae`) use `Math.random`.

## Open / for the lead

* Wire: `import 'src/island/npc/index.ts'` (via `src/island/index.ts`), after `setupZone` call `loadIslandWalkMaps(archive, profile.island)` and
  `startIslandNpcs(world)`; implement `ctx.say(table, id, id2?)`, and optionally `ctx.inFrustum`, `ctx.expression`, `ctx.cameraHold`.
* Groups (`FUN_0042407f`, 8 call sites: 5 in `FUN_0052cba0` (era 0 / 4), 1 each in the functions at 0x520204 / 0x524952 / 0x527ec5) are registered from the emulated set-up's calls by `registerNpcGroups` (WP5; at most 6 like the original); test `m4-s-island` checks the counts per era.
* BrickBot.c is not ported (era 1 node 7: 13 + 10 + 9 + 3 attaches). Inventory for whoever takes it:
  `FUN_00531d45` (0xc0-byte node, vtable 0x8eaa90: update `0x530e80`, pre-render `0x531286`, draw returns 1, destroy `0x531e67`): a follower: `+0x94`
  = the leader record (argument +0x00), `+0x14` = distance (argument +0x04 * 8), `+0x18` = type (argument +0x08, < 1: 0, 1, 2 in turn from
  `DAT_05d586a4`; 3 = rides 4 units above the leader); keeps a 5-entry history of the leader's place `- forward * distance` and yaw, puts the leader's
  head var bit 0x2000000, clones the leader's walker (`FUN_004239ec`, `FUN_0046248a`, `FUN_00462479`); the pre-render mirrors the leader's clip through
  `FUN_00531944` with idle gags (clips 0xfe / `DAT_008eaa88` = 0x121, random every 360 ticks). `FUN_005327b1` (vtable 0x8eaaa8: update `0x531e97`,
  pre-render `0x532557`, destroy `0x532909`): particles `Explode01.par` / `swirl01.swl`, walker ignore flags, argument +0x00 = a var it or-s 0x20000
  into. `FUN_00532acc` (vtable 0x8eaac8: update `0x532939`, destroy `0x532b81`, + `0x532a93`), `FUN_00533ba8` (vtable 0x8eaae0: update `0x532bb1`
  (378 lines: walker routes, `FUN_0051dc50`), pre-render `0x533ac2`, destroy `0x533cf4`). WP5's `pizzaHitOn` (`FUN_00429556`) is their pizza test.

## Differential test (WP-VERIFY M7)

`tools/tests/m7-isl-npc-emu.mjs` + `m7-isl-npc-human.mjs` (lib `tools/lib/m7-isl-npc-emu.mjs`): the original's constructors, node passes (FUN_0042226e / 00427233 / 004225c5 /
0042271b), SGGen interaction code, walker (FUN_004614d5 ..), animation functions, collision (.col loader, sweep / probe / terrain ray) run natively in the x86 emulation (x87 at 24-bit
precision) on the port's island world (node 2); Pepper is scripted. Per tick compared: matrices (1e-5 relative; observed max 1.8e-7), Euler, record flags, clip / frame, controller flags /
ran bits / distance / probe result, node fields, all 319 variables, NPC globals, camera, speech / sound / cutscene calls, random draws. ~13 M checks: free walk dt 1 and 0.5 (42 records),
talk / cutscene / call-from-behind scenarios, Pepper in the way of walkers, gate-bit fuzz. Not covered: pizza reactions, BrickBot, Bunny / butterflies / swifts, buildings.
Deviations (port-owned `src/island/**`, not edited): D1 `startIslandNpcs` inits by record index, original in attach order (CLIK / PETE ground height swap); D2 probe timer starts -1, original
sets 32.0 (FUN_00427014) so the first throttled probe runs at once; D3 controller +0x14 bit 0x10 never cleared (the draw pass zeroes the word); D4 Human1 update returns 0 on the
`res == -1 && count == 1` path (0x4be7f8), port 1; D5 Euler yaw outside +-PI not normalised by the step; D6 cone constants 1.0472 / 1.39626 vs float32 0x3f860a63 (1.04719198) /
0x3fb2b884 (1.39625597); D7 faceEachOther lacks FUN_00429e00 (slope alignment of Pepper after the turn). D2 / D3 / D6 / D7 are neutralised in the harness (documented in the lib).
