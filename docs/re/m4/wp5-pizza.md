# WP5: Pizza.c, speeder.c, Footy.c, SupaStat.c (the island's pizza throw, carried props, delivery rules, cars, train, football)

Code: `src/island/pizza/` (`index.ts` registers everything), tests `tools/tests/m4-wp5-pizza.mjs` (52 checks), `m4-wp5-carry.mjs` (41), `m4-wp5-ambient.mjs` (33).

## What these files are (findings)

| source | constructor | records | what it is |
|---|---|---|---|
| Pizza.c | `FUN_0042887c` | PIZ0-2 (all eras, gate `PIZZAS_THROWN` 0x63 & 1 / 2 / 4) | the **thrown pizza** (three can fly at once) |
| Pizza.c | `FUN_0042900b` | PIZ3 / PIZ4 (eras 1-3, gate 0x63 & 8 / 0x10) | the **hand-over pizza**: two halves in Pepper's hands (bones 0x10 / 0xe) smashed onto a target within 4.8 units |
| Pizza.c | `FUN_00429d1b` | PIZ3 (eras 0 / 4, gate MOVE_PIZ3 0xb4), CNST (MOVE_CNST 0xb5), RHCP, BRIK; PAPA / MAMA (era 3) | a **carried prop**: held at a bone of a carrier (attached by the cutscenes' ATTACH command), dropped with a lying time |
| speeder.c | `FUN_00538126` / `FUN_005385d3` | AMBU, SPD0-2, PCAR / PETE, RICH, NUBB | the **cars** (ambulance, three toy cars, police car) and their **drivers** |
| Footy.c | `FUN_0053955e` / `FUN_005399d8` / `FUN_00539d44` | BALL / FLR1, FLR2 / LOON | the **football** of the kids XXX0-2, STEV's **flowers**, a **bobbing** thing (eras 3 / 4) |
| SupaStat.c | `FUN_0053d66c` | TRNL, TRNT, TRNC | the **train** (rideable) |
| SupaStat.c | `FUN_0053c337` | SUPE | a flying **super-hero taxi** (not ported, see the end) |

**The pizza throw is a toy in chapter 1.** Space in the walk node (SGwalk `FUN_0042d514` 0x42da7d, not Shift) asks `FUN_00427c15`; the pizza flies straight
along Pepper's facing, or at the nearest *targetable* record in a 10 degree cone. Targetable = controller flag 0x40, which the island gives only to the
Brickster's bots (controller flags 0x43, `FUN_00521b8b` etc., eras 1-3): in era 0 nothing is targetable, the pizza never hits an NPC, the talking NPCs dodge it
(`FUN_0042477f`, WP3, via `incomingPizza`). The **deliveries** of chapter 1 are conversations: Pepper talks to a customer (generic NPC, WP3), its cutscene
plays, then the reward lines of `FUN_00425c13` run (delivery.ts), the customer's MOVE var gets 0x8000 and Turn2Pep / MeetPepp take the **pizza box PIZ3**
out of Pepper's hand (`FUN_004296a2`, carry.ts). `PEPPER_CONTROL` 0x10 ("pizza aim" in architecture.md 4.4) is not used on the island at all (only
the z07CSI code at 0x579725 attaches a node gated on it and writes it).

## The pizza globals and the ctx contract

* `pizzaSystem(w)` = the globals: `slots[3]` (DAT_009da874 records / DAT_009da880 nodes), `hand[2]` (DAT_009da88c.. / 894..), `target` (DAT_009da870),
  `handStart` / `handEnd` (DAT_008adf4a / DAT_008adf48, .data defaults 5 / 30). Built on first use by scanning the controllers (record order = attach order).
  Also in `ctx.shared.pizza`; the hand-over target in `ctx.shared.pizzaTarget`.
* `walkHooks.space` (src/game/walk.ts, a 6-line edit): the Space branch of SGwalk calls `walkSpace(w, pepper, state)` (pizza.ts), which returns the next walk state.
* `IslandCtx.particles?(name, mode, pos, owner)`: the `.par` emitters (mode 2 emit, 1 stop, 0 move; owner = record index). `throwpizza.par` follows a flying
  pizza, `pizzasplat.par` at the hit; `trainsmoke01.par` on TRNL (started once, the shell attaches it at (0, 10, 7.25) of the record, -pi/2 about x).
* `IslandCtx.brickBurst?(rec, kind)`: `FUN_00447e90` (FX_Bricks, WP9), the car that hits Pepper falls apart (kind 0xd).
* The WP3 NPCs use `incomingPizza`, `customerReward`, `customerVarOp`, `npcAction`, `carriedPizza`, `releaseCarry` (they import them).

## Pizza.c in detail

**Prelude `FUN_00427c15(player)`** -> `pizzaPrelude`: 0 when there is no projectile slot or story node 0x38..0x3c; 1 (throw) in 0x35..0x37; otherwise the
target search `FUN_0042796e(player, cone 0.785)`: none -> 1; distance^2 < 23.04 (4.8 units) -> 2 (hand-over, DAT_009da870 = target); else 1.
Approximation: the original tests DAT_009da880 (slot 0's node, always set) where a test of the hand pizzas would be needed; in eras 0 / 4 (no hand pizzas)
a target within 4.8 would make `FUN_00428a0a` dereference DAT_009da894 = 0. Since nothing is targetable in those eras it never happens; the port throws.

**Walk states** (0x42dad1): result 1 in SNEAK 8 / WALK 0xd / IDLE 0x1b -> state 0x0b, Throw_1 (sound 0xff), `launch(14, 42)`; in RUN 0x24 / 0x3f / 0x40 ->
0x42, Throw_2 (0x2bf), `launch(4, 10)`; other states nothing (no throw while throwing). Result 2 -> state 0x0c, `FUN_00428a0a(10, 40)`. Not in states 1, 0x1f, 0x57.
Pepper's clips (MFIG.blk): 0x0b 60 frames, 0x42 20, 0x0c 70.

**Launch `FUN_004277d0(start, release)`**: the first clear bit of PIZZAS_THROWN is set (that slot's node starts running) with the two frames; all three
busy -> the one that travelled furthest is hidden and reset, and nothing is launched.

**Projectile node** (node 0x50, table 0x8adf08 {update `FUN_00427e02`, pre-render `FUN_00428520`, destroy `FUN_004289c9`, draw `FUN_004285b0`, load / save}):
+0x14 throwpizza emitter, +0x18 pizzasplat emitter, +0x1c slot, +0x20 direction, +0x2c target, +0x30 hit record, +0x34 16.0 (unused), +0x38 / +0x3c start / release
frame, +0x40 in-flight bit (mask << 8: 0x100 / 0x200 / 0x400), +0x42 count-down, +0x44 distance, +0x48 held, +0x49 sweep pending, +0x4a Pepper's clip, +0x4c spin.
* First tick of a throw (stamp != frame): wait (return 0) until Pepper's frame >= start; then visible, held, copy Pepper's matrix.
* Held: the draw hook puts it at Pepper's bone 0xe with `R(0, pi/2, 0) T(0, -1, 0)`. If Pepper's clip changes or a cutscene runs: hidden, slot bit cleared
  (the "stale" case). At the release frame: direction = Pepper's forward, or `FUN_0042796e(pizza, 0.1745)` -> the target, lifted 2.67 and normalised; the
  in-flight bit set; the first step.
* Flight: 4 units per tick (0x892080), spin rx -= 0.2; after 144 units (36 steps) count-down 4 (hidden, gone after 3 more ticks). Each step tests the segment
  [pos - step, pos + step] against every targetable record (`FUN_00427cbf`: `FUN_00441b10` mask 3, radius / skin 1) -> hit: placed at the hit point, count 6; else
  the controller sweep (`FUN_00427139` mask 3, radius 1.0, skin 0.1, flags 0x108; run between the passes by `FUN_00427233`, read back in the pre-render): any
  record hit -> count 6. Count 5 = the splat (Piza_Hit 0x102 at the pizza, pizzasplat.par, hidden); 1 = the slot bit cleared. **No gravity**: the pizza never
  falls into the water; over the sea it flies its 144 units and vanishes. The port runs the sweep at once (same inputs) and applies it in the pre-render.
* `FUN_00429183` (`incomingPizza`, the NPC side): 1 when a flying pizza within 8 units per axis will cross the NPC's cylinder (radius 4, height 5.2,
  `FUN_0043d2af` ported with its slip in the entry test) within 40 units, with the height; 2 during the last 5 frames of a hand-over when the NPC is within
  4.8 and faces Pepper (or is the target): the nearest targetable such NPC becomes the hand pizza's `reached`. `FUN_00429556` (`pizzaHitOn`, BrickBot):
  1 while a projectile's hit record is the NPC, 2 when the hand-over reached it; only before story node 0x34.

**Hand pizzas** (node 0x34, table 0x8adf30; eras 1-3): shown between frames `handStart` and `handEnd` of Pepper's clip 0x0c (10..40) at bones 0x10 / 0xe; at the
end the first one plays Piza_Hit and the splat between both; the next tick both hide and clear their gate bits (8 / 0x10).

**Carried prop** (node 0x44, table 0x8adf50): argument block +0 bone (i32), +4 / +8 / +0xc offset, +0x10 carrier record pointer (0 everywhere on the island).
PIZ3 bone 16 offset (0, -1, 0); CNST bone 14 (0, -0.8, 0); RHCP bone 16 (0, 0, 0); BRIK bone 0. Carried: update returns 1 when the gate var is 1, else 2;
the draw hook places it at the carrier's bone (`R(0, pi/2, 0) T(off) bone carrier`, or the carrier's matrix + offset when bone < 1). `attachCarry`
(`FUN_00429638` + the cutscene command `FUN_0045d2b9` that also enables the controller) / `releaseCarry(prop, carrier, ticks)` (`FUN_004296a2`: only by the
carrier; ticks > 0 -> one push of the carrier's forward * 1.4, a probe down from +8 over 40 (mask 0x43), lying flat (rx = pi/2) for `ticks`, then hidden).
Turn2Pep / MeetPepp release with 480 ticks (0x43f00000) or 0.

## Delivery rules (delivery.ts)

* `customerReward(type)` = `FUN_00425c13` after the customer's cutscene: type (word 0 of the generic NPC's argument block) 1 = pizza customer:
  SCORE_LGI (0xa6) += 1000, HISCORE_LGI (0x12) += 1000; 2 = house customer: the same, then cutscene slot `0x1a + HOUSECONTRUCTIONPHASE` (LGIPH01 + phase),
  HOUSECONTRUCTIONPHASE (0xad) += 1, NUM_BRICKS (0x4f) -= 1.
* `customerVarOp(moveVar, op, var)` (block +0x2c / +0x2a): 1 var = 1, 2 += 1, 3 -= 1; NUM_PIZZAS (0xb0) -= 1 also sets 0x8000 in the customer's MOVE var.
* `npcAction(op, var, value)` = `FUN_0051dc50`: 0x10 / 2 or, 0x20 / 4 and-not (0x10 / 0x20 first call FUN_004240d1), 0x40 = delivery (score, hiscore,
  NUM_PIZZAS -= 1) then var = value, 1 var = value.
* HUD (`FUN_004b908d` with `FUN_004b9008`): "(11 - NUM_PIZZAS)/11" (".../12" in story node 6) and "(11 - NUM_BRICKS)/11" before node 7 (`chapterOneCounters`).
  New game: NUM_PIZZAS = NUM_BRICKS = 11.

## speeder.c (the cars)

Car node (0x44, table 0x8eae90): argument +0 = ROAD start node (AMBU 107, SPD1 54, SPD2 19, SPD0 / PCAR -1 = nearest). The constructor makes the walker
(map 0, speed 0.1333, lane 0.5, turn 0.1, radii 1 / 2, limit 3), resets the box. **The car does not drive itself**: the Human1 node on the same record (WP3)
steps the walker (so `startPizzaNodes` must run **before** WP3's `startIslandNpcs`: Human1 copies the walker's speed at its set-up). The update (returns 2,
or 0 in the special cases): the engine loop at the car (Toycar3 / 1 / 2, CarVox2, Toycar2 by name); on frame 0 straight onto the ground; then the obstacle
segment from 5.28 behind (+2 up) 25.28 ahead (radius / skin 4) against the cars Pepper drives (var bit 0x20000000) and Pepper (box test): hit -> horn
(Horn2 / 1 / 2 / 3 / 2, once per obstacle), the car falls apart (`brickBurst(rec, 0xd)`) with record flags 0x8000 (mesh off) | 0x2000 (stopped) | 0x10; no hit
-> 0x2000 cleared (and 0x10 unless still in bricks). Pre-render: pitch to the ground under both axles (+-4 along forward, probe from +6; `-atan2(dy, 8)`)
eased by 2 degrees per tick, placed between them; the wheels (MATL parts 2..5 via WP4's `partMatrix`) roll `2 atan(d / 4)` per tick, the front pair steers
`3 * dyaw`. Pepper's car (SGCar, WP6) sets 0x20000000 (+ 0x10000000 while he sits in it): then this node only does the Shift horns (SepHorn1-5 at random),
the engine pitch of the car he drives (Sophie1 0x370, 18500..22050 Hz with the throttle keys 0xa3, `ctx.sfxFreq`), and puts a car he left back where he took it
after 300 ticks out of view (`ctx.inFrustum`; without it: never).
Driver node (0x28, table 0x8eaeb8): argument +0 car, +4 PATH node; the attach's mask / value become the in-car test (the node's own gate is open):
in the car (var & mask) == value -> var |= 0x40020000 (the pre-render clears it), seated at the car's MATL part 1, popping up 1.6 per tick (max 8) while the
car is in bricks; out -> placed once at the PATH node. Clip 0x43.

## Footy.c

**Football** (0xa8 node): arguments +0 / +4 / +8 the three kids, +0xc var 290 (its value * 0.8 = the "get ready" distance). The ball waits at the kicker
(state 1) until that kid's NPC node is not falling and its var has no 0x100 (Pepper near), then sets up the kick (target 0.8 in front of the receiver, hop 14,
speed 0.8, hop phase rate 3.93 / (dist / 0.8)), clears 6 in the receiver's var and sets 2 (kick) in the kicker's; state 2 waits for the kicker's clip 0x1d past
frame 5 (FootKick 0x104); state 8 flies with hops (|sin phase| * height, Bounce 0x133 at each landing, then hops of 4 at double rate), the receiver gets 4 (ready)
when the ball is within the ready distance; at the target state 4 rolls it to the feet in the rest of the hop, then the receiver becomes the kicker. When the
new receiver is kid 1, `trunc(random * 10) > 10 - kicks since the last` sends the next kick astray to PATH node 0xbc: up to 6 shrinking hops (x0.286 height,
x0.75 speed) then rolling, and the receiver gets 8 (fetch). The ball spins -0.2 per tick and is put on the ground by the controller probe (`FUN_00427139` flags
0x16: terrain + probe mask 0x2043 + the hop offset); drawn 0.4 higher (`FootballNode.DRAW_LIFT`, for the renderer). The kicking / fetching itself is the kids'
nodes (Human1 / Turn2Pep, WP3); `init` sets MOVE_XXX0 (0x73) = 2.
**Flowers** FLR1 / FLR2 (gate 0x7c & 0x20 / 0x10 = STEV's MOVE bits): scale 0.5 -> 1.5 in 90 ticks, 90 ticks, back to 0.5, then the node toggles its gate bit
(clears it). Their sounds (ids 0 / 2) are Silence.wav: not played. `startPizzaNodes` sets the 0.5 scale at once (the constructor does).
**LOON** (eras 3 / 4): up by arg * 8 at 0.08 per tick, 90 ticks, down, 90 ticks.

## SupaStat.c: the train

TRNL / TRNT / TRNC (node 0x40, table 0x8eb170): argument +0 = the car in front (0 for the loco). Walkers on the ROAD map from node 99 (speed 0.1, radii 2,
first goal 0x65, limit 30); the followers keep their start distance (`FUN_004623f0`). The loop is DAT_008eb188 {95, 97, 99, 101, 105}; leaving the approach to
node 0x61 or 0x69 starts a station stop: the shared speed factor (DAT_05d586e4, all three cars) drops 0.05 per tick, below 0.1 the walkers pause for 150 ticks,
then the whistle (Trainwis 0xfc) and back up to 1.0. Fast (> 1.5) the cars roll into curves (1 degree per tick, drawn x3). Engine loops ToyTrain2 (0xf9 / 0x163).
**Ride**: Pepper on a platform (records 5 / 6, probed from Pepper and 8 units beside the loco) sees icon 0x10 in INTERACT_ICONS; Ctrl -> the loco is chosen
(WP6's `vehicles(w).current` = DAT_009daa80, `range` = DAT_008ae330), its pre-render makes PEPPER_CONTROL 0x80: Pepper sits (clip 0x43) at (+-1, 4.5, -6.5)
leaning 45 degrees, the camera eases to loco * (0, 3.6, -16) looking at loco + 2.8; Up / Space accelerate to 2.0, Down / Alt brake to a stop (whistle),
Left / Right look to the other side, Shift rings, icon 0x40 near a platform, Ctrl there gets off (PEPPER_CONTROL 1, walk state 0x1b, the train stops 150 ticks).
Approximation: DAT_00987660 (look-at 4.0 instead of 2.8; meaning unknown) is taken as 0.

## Not ported / open

* **SUPE** (`FUN_0053c337`, update `FUN_0053adc3` 533 lines + `FUN_00539eb1` steering, `FUN_0053a7d8` / `FUN_0053aa8e` / `FUN_0053ab93` camera paths,
  `FUN_0053ac79`, `FUN_00539e30`): a super-hero who flies the OTH waypoint map (nodes 0..0x39, landing at 6 / 0x2f / 0x37 depending on Pepper's x against
  two route positions) and **carries Pepper**: when Pepper stands on surface 9 (or 10 within 32 units of TRNT) at height 41..48, SUPE swoops to him, both play
  clip 0x8c, PEPPER_CONTROL = 0x80, the camera follows (scripted), up to ROAD node DAT_008eb114[nearest of 10] (+12), then to the nearest helipad
  (WP6's pad table) where he puts Pepper down (PEPPER_CONTROL 1). Needs the camera path helpers; left for later.
* Save / load of node state (every family's load / save hooks).
* The draw-pass hooks run in the pre-render (the port has no node draw pass): same matrices, set one pass earlier.
* `FUN_00427139`'s deferred sweep is run immediately in the update (same inputs).
* The lead should apply `attach.ctrlFlags` in `setupZone` generally: the BrickBots' targetable flag 0x40 (0x43) comes from there; until then nothing is
  ever targetable (my car / train nodes and WP3's NPC apply theirs in their own `init`).

## Lead: wiring

* Import `src/island/index.ts` (registers 0x42887c, 0x42900b, 0x429d1b, 0x538126, 0x5385d3, 0x53955e, 0x5399d8, 0x539d44, 0x53d66c and the walk hook).
* After `setupZone` + `loadIslandWalkMaps`: `startPizzaNodes(world)`, then WP3's `startIslandNpcs(world)`.
* ctx: `particles?` (optional), `brickBurst?` (optional, WP9), `sfxFreq?` (WP6's), `inFrustum?` (WP3's), `stopSfx`; the HUD uses `chapterOneCounters`.

## Follow-up: how the drivers get out (NUBB)

The crash does not free a driver: the speeder update only honks, stops the engine and bursts the car (0x537c8a..0x537cec, as ported). Talking is blocked by
MOVE_* bit 0x20000 (`FUN_00425902`), which the driver node ORs in every tick it sits in the car (with 0x40000000). A driver gets out through the **NPC groups**
of the era set-up (`FUN_0042407f`, era 0 in `FUN_0052cba0`: REDG+HOGG+SNAP, CLIK+PETE, ROBB+STEV, DARR+RICH, NANC+NUBB): when a group member's conversation
ends (`FUN_00425c13`) the others' head-node vars get | 1, or | 3 when the member is a pizza customer (`FUN_004240d1`). Delivering Nancy's pizza gives
MOVE_NUBB | 3; SPD0's second Human1 route (gate 0x80 & 0xa == 2) drives to ROAD node 94 and its waypoint action ORs 8; the driver node's in-car test
(0x80 & 8 == 0) fails, NUBB is placed at PATH node 85 and his own routes (NUBB_EAT 381) and Turn2Pep take over; Shift then plays lgici14 and gives the brick.
PETE (via CLIK) and RICH (via DARR) work the same way. Port: `registerNpcGroups(w)` (called by `startPizzaNodes`) reads the calls from `setup.calls`
(fn 0x42407f, which emusetup labels 'hudItem') into WP3's `npcGroup`; the driver update now returns 0 when out of the car (0x538399), so the driver's
other nodes run (it returned 1 always before). Open: the cars' brick slots (`FUN_0051c823`, the vehicle roster table 0x8e9b28 registered by PepSwitc's
constructor: AMBU var 0xb1, SPD0 0x24, SPD1 0xd9, SPD2 0x4c, PCAR 0x99, files ambulance*/speedster*) are not registered in the port, so a crashed car keeps
flag 0x8000 (not drawn) forever. WP6 / WP9.
