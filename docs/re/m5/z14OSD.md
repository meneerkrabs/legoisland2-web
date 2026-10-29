# z14OSD, the Oasis (M5 hub worker OSD)

Zone table index 11 (`z90OSD`, archive `z14OSD`), story nodes **34** (arrival from the Adventure Island, ends at the scorpion portal) and **45** (after the Pyramid / fishing chain, ends with Johnny's talk).
Wrapper `FUN_00628252`, GameLoop `FUN_00627c90`, set-up root `FUN_00629788` -> `FUN_006290ea(1)` (+ `FUN_0062c500` node 34 band `< 0x23`, `FUN_0062bb80` node 45 band `< 0x2e`), per-frame HUD `FUN_00628410`,
teardown `FUN_0062980d` / `FUN_006285d5` (= `ret`). Code: `src/zones/z14OSD/`; tests: `tools/tests/m5-z14OSD-nodes.mjs` (27 checks), `tools/tests/m5-z14OSD-emu.mjs` (13.3 M checks against the original in the x86 interpreter);
bot: `tools/steps/m5-z14OSD-bot.mjs`.

## 1. What runs where

| piece | original | port |
|---|---|---|
| set-up (records, 56 / 57 attaches, boxes, render modes, cutscene slots ADV01 / ADV05, texts, objective, waypoints) | `FUN_006290ea`, `FUN_0062c500`, `FUN_0062bb80`, helpers `0x6287d6` (tumbleweeds), `0x628967` (scorpions), `0x628b9f` (gems / box colliders by record name), `0x628fb8` (seagulls), `0x629080` (cutscene slots) | the x86 emulation of the foundation (`profile.emu`), unchanged; `registerHub({ archive: 'z14OSD' })` |
| arrival | the set-up itself: var 0xa3 == 10 (from the Adventure Island) leaves Pepper at the scene position (-385.8, 10.0, -149.5) next to Johnny; any other previous zone: PATH node 0x10 (123.5, 16.3, 120.1), yaw 1.5708 (`*(PEPP+0x50) = 0x3fc90f94`) | `spec.arrival` = the emulated PEPP record (position + Euler yaw); verified for prev 0 / 2 / 10 |
| per-frame HUD | `FUN_00628410` (+ set-up `FUN_006283c0`) | `hud.ts` `updateOsdHud` / `initOsdHud` |
| loop sounds | `FUN_00627c90`: `FUN_004435a0(DAT_05d5bc88)` (2D 0x324) and `(DAT_05d5bc9c)` (2D 0x2f9) on every pass of mode 2 | `index.ts` `frame` |
| music | PEPPSW's constructor loads and plays `ad1T`; groove `level - 3` in PEPPSW's pre-render | start: `src/audio/zonemusic.ts` (`z14OSD: init`); groove: `peppsw.ts` -> `ctx.musicGroove` |
| teardown | `FUN_0062980d` = `FUN_00629777` (`FUN_00423ad4`: destroy every node), free the two text tables | the hub framework (`destroyNodes`, `HubGame.destroy`) |
| node 45's sub-object matrices | `FUN_0043ea60(rec[70].model, 1 / 2)`, `*(ptr + 0x30) = 0` | `setup.ts` `applySubMatrices` (live MATL copies of `src/island/trigger/parts.ts`: m[12] := 0 of parts 1 and 2 of record 70) |

## 2. Ported functions (address -> file)

* `FUN_00628410` / `FUN_006283c0` -> `hud.ts`: centre text `"%04d"` of var 0x17, left text `"x%d"` (format string at 0x914d44 is `x%d`) = number of set bits among the low 10 bits of var 0x1d, left icon texture 0 (gem), icon column slot 0 from var 0xc (0x20 -> texture 3,
  1 -> 2, 0x1e -> 1, each only while PEPPER_CONTROL & 1; 0xc0 blinks 4 / 5 with the counter `DAT_05d5bc50 += 1.0 * dt`, 15 / 30 frames; none -> -1 and counter 0), then var 0xc = 0.
* **Gems** `FUN_0062b220` (ctor) / `FUN_0062b040` (update, returns 0 = never "ran") / `FUN_0062b367` -> `gems.ts`. Gate (var & mask) == 0 on var 0x1d (one bit per gem, record order, 10 gems incl. the duplicate GEM7). Within squared distance 4 (`FUN_0042216f`
  float32 distance): vars 0xca and 0x17 += 1000, record hidden, sound 0x2f1 (`DAT_009da8f4`, loaded by SGwalk's constructor `FUN_004b0f16`), three ticks later the bit is set. Collected gems are hidden at construction.
* **Tumblewd** `FUN_00629d7e` / update `FUN_00629830` / pre-render `FUN_00629a6e` / destroy `FUN_00629eb5` -> `tumbleweed.ts` (7 records TUM0..TUM5 + TUM6): drifts (-0.4, -0.4) per tick, hops on the ground found by the probe pass (flags 0x110: terrain
  + probe sweep, y-only write), sinks, rests 120 ticks, resets to its home. The sound patterns are the strings at 0x914e1c.. read from the EXE: the second is **"TUM01"**, so TUM0 plays two sounds and TUM1 none (found by the oracle).
* **scorpion** `FUN_0062ad35` / update `FUN_0062a120` (315 lines) -> `scorpion.ts` (SCR0..SCR9, SCR4 has no sound, SCR6 is listed twice); **grab node on PEPP** `FUN_0062af8d` / update `FUN_0062ae46` (gate var 0x5e & 0x20: clip 0x70 until the clip ends,
  then bit 0x20 cleared and the mailbox clip restarted). The attack sets var 0x5e |= 0x20 within squared distance 4 at animation frame > 12 (state 0x10).
* **PEPPSW** `FUN_0062ba3b` / update `FUN_0062b3b0` (the three ambience positional loops of G001 / G000 / G006, returns 2) / pre-render `FUN_0062b483` -> `peppsw.ts` (node kind `PepSwitc`, so `setupZone` adds no M1 switch): walk -> skateboard on Ctrl (not in the
  states 1, 2, 0x1f, 0x57 nor clips 99 / 0x62; mode 4, clip 0x16, board record 0x40 shown, board clip 1, sound 0x150), walk -> swim at the sea level (mode 2, clip 0x15), swim -> walk when the terrain one step ahead (+4 up) is above the sea (clip 0x25, sound 0x128),
  skateboard off on Ctrl release / water 4 ahead (clip 0x1c, board clip 2, the rolling sounds stop, sound 0x106); music level 1..3 (`level - 3` to the groove); Enter / every tick -> the look system.
* **Look change** `FUN_00655de3` (PEPPSW constructor tail) / `FUN_006561e9` / `FUN_0065627e` -> `looks.ts`: the roster `{PHEL record 0x7c, SwapText set 0x2e, var 0xd2}` at 0x91c450, hidden decor templates (list 0x91c480) in render mode 1, decor group 2; the cycler, busy list, texture swap and
  brick morph (`phel00..07.txt`) are the island's `VehicleLooks` / FX_Bricks with this roster table (same pattern as `src/zones/z16PYA/roster.ts`); `FUN_00655de3` runs in the emulated machine (`HUB_SPECS.z14osd.exec`) for the FX_Bricks registrations.
  Enter near the helicopter changes var 0xd2 (bot checks it). Type-1 (decor / outfit swap) is the island's open item (gaps S2).
* **Bunny / seagulls** `0x4b4000` (7 attaches, `FUN_00628fb8`): the cai worker's `Gull` node.
* Hub-specific data read from the EXE at run time: handles (`HubContext.soundOf(addr)` from the emulated sound loader `FUN_006285e0`), name strings, tables 0x91c450 / 0x91c480, decor tables.

## 3. Sounds (handles of `FUN_006285e0`, ids as the emulated loader obtained them)

3D: 0x300 (G001 ambience), 0x2ff (G000), 0x304 (G006), 0x2fe (scorpion bite), 0x2fd (alert), 0x2fb (six tumbleweed handles), 0x2fc (ten scorpion handles), 0x2fa; 2D: 0x324, 0x2f9 (loop), 0x308 (grab), 0x2fd... The audio host picks by sound id
(`AudioHost.pick`: the slot that plays, else the first idle): ten handles of the same sound share the loop "pool" instead of each scorpion owning a slot (audio package; the calls themselves are exact, compared id + position in the oracle).

## 4. Particle emitters (wired through `ctx.fx` = `ZoneParticles`)

| emitter | call site (VA) | when |
|---|---|---|
| `GEM01.par` (`FUN_0044e920`: matrix = the gem record's live matrix, pos 0, rot 0, gate (2,1,1) = emitting) | 0x62b2f1 (`FUN_0062b220`) | per gem at construction (not for gems collected before) |
| `TWINKLE01.par` (pos (0, 4, 0), gate (1,1,1) = idle) | 0x62b349 | once for all gems (`DAT_00914ffc`), bound to the first gem's matrix |
| twinkle moved to the gem (`FUN_0044ea00` x2) + on (`FUN_0044ea60(h,2,1,1)`), gem emitter off (`(h,1,1,1)`) | 0x62b0eb / 0x62b100 / 0x62b115 / 0x62b12a | at the pick-up |
| twinkle off | 0x62b07e | 3 ticks after the pick-up, when the bit is set |

No other emitter, `.par` or `.swl` is started by the Oasis' own code (the set-up calls `FUN_00442900("GENERICBITS")`, `FUN_0044e8d0` once: `ZoneParticles.create` + `fx.finish()`).

## 5. Verification

* **x86 oracle** (`tools/lib/m5-z14OSD-duel.mjs` = `OsdEmu extends ZoneEmu` + `OsdDuel`, `tools/tests/m5-z14OSD-emu.mjs`): the original's node framework (update pass `FUN_0042226e`, probe pass `FUN_00427233`, pre-render `FUN_004225c5`), controller creation, the constructors, the node
  handlers and the zone code run natively next to the port's world with the same inputs and the same random stream; compared every tick: record matrices / Euler / flags, node fields, all game variables, sound calls (id + 3D position), music groove calls, animation clip / frame,
  controller words, probe arming and result. Scenarios: Tumblewd (6 sessions: all states, rest / reset, no ground, bumpy, dt 0.5), scorpion + grab node (random Pepper + a scripted attack: states 1, 2, 0x10, 0x11, grab, clip 0x70), Gems (pick-up at radius 1.9999 / 2 / 2.0001, countdown,
  scores, collected-before, dt 0.5), PEPPSW (walk / swim / skateboard, music levels 1..3), HUD (every var 0xc combination, blink, counts, `%04d`). Result: 0 failures, bit-exact except the tumbleweed rotation matrix (<= 1 float ulp of `FUN_0043a4a1`'s sin / cos ordering, tolerance 1.3e-7).
  **Findings fixed by it:** decimal approximations of data constants (`fb(0x...)` from the bit patterns: tumbleweed spin, the scorpion's cone / turn step / home turn), the `TUM01` sound pattern, `rand` rounding (`FUN_004388ae` = `fr(fr(r / 32767) * max)`), `atan2 + pi` rounding, float32 `FUN_004242f0` and `FUN_0042216f`
  (the framework's `ctrl.distSq` is a double: reported, see 7), the island probe's unrounded `delta[1]` (the nodes arm the exact `src/game/probe.ts` pass).
* `m5-z14OSD-nodes`: both nodes attach (Gems 10, Tumblewd 7, scorpion 11 incl. the grab node, PEPPSW), only the environment constructors (sky / sea) are not node ports; node 45's sub-matrices; gem pick-up and persistence; HUD icons / blink; skateboard on / off; tumbleweed motion.
* Bot `m5-z14OSD-bot.mjs` (headless, muted, real keys): see section 8.

## 6. Shared-file edits (all additive)

* `src/hub/game.ts`: (a) after the set-up, every node that defines `ctorInit(world, record)` gets it called in record order (the world-dependent half of the ported constructors: record flags, animation start, home position; used by Gems / Tumblewd / scorpion, hence also by z16PYA / z23DIP);
  (b) the zone factory creates `ictx.fx = ZoneParticles.create(ctx)` and calls `startEmitters(fx, record)` of the nodes that define it (the gems); the hub's `onCreate` calls `fx.finish()`.
* `src/hub/ctx.ts`: `fx: ZoneParticles | null` on `HubContext`.
* `src/formats/emusetup.ts`: `HUB_SPECS.z14osd.exec = [[0x655dc0, 0x656300]]` (PEPPSW's roster FUN_00655de3 and the Enter / tick functions lie just behind the zone's region).
* `tools/lib/hub-load.mjs` (foundation) is NOT changed; its mock keeps `ictx.fx = []`: `tools/lib/m5-z14OSD-load.mjs` sets it to null for the Oasis tests.

## 7. Not exact / open

* The shared `World` / `updatePass` computes the controller's squared distance (`ctrl.distSq`, `FUN_0042216f`) in doubles; the original rounds every step to float32 (relative deviation ~1e-7). The Oasis nodes use `distSq32` (`exact.ts`) so they are unaffected; the shared island nodes keep the small deviation (report for the island package).
* On leaving the board the original stops 8 sound handles, sound 0x185 twice (two handles of the same id); the port stops it once (`SKATE_ROLL_SOUNDS` is a list of ids). No audible difference.
* Handle identity of repeated sounds (see section 3) belongs to the audio package.
* Collision answers in the oracle (`CollisionWorld` / a scripted ground) and the animation instances are the same stand-ins on both sides: not verified there. The decor / outfit swap of Enter near an NPC / decor model (variant type 1) is not ported (island open item gaps S2).
* The "4 point lights" of the gaps list are the 4 HUD hint calls `FUN_00424029(0..3, 0x71, 0x79, 0x82, 0x81, 0.004)`: SGMFIG animation sets 0..3 (catch high / low, talk, point clips) = the same values as the executable's static table the island's `readAnimSet` reads; nothing to port. The 9 box colliders
  (`FUN_004427e0` / `FUN_004428b0` by record name) are part of the emulated set-up.
* `FUN_0043ebe0(model, 0x14, &0xff555555)` of the Tumblewd constructor sets the part-0 vertex colours; the tumbleweeds are drawn in render mode 2 (block 1: texture only), so the colour has no visible effect: not ported.
* Hologram texts / objective: selected by the set-up (`ADVFSM1` / `ADVHOL1` + objective record 78 SCRP at node 34, `ADVHOL9` + record 5 at node 45): `replaySetupState` of the framework; hOLO (`0x88df51`) is the island's node.

## 8. Story flow and the bots

Node 34 (arrival from the Adventure Island): `StartCSM 0x51e19c` (gate var 0xba, immediate) starts ADV01 at once (Johnny and Pippin by the shore); the NPCs Johnny (JTHN) and Pippin (MPRD) walk their routes (Human1) and talk (Shift: Pepper must stand in the cone
in front of the NPC, nearest talk candidate); the objective arrow points at SCRP (record 78); the box portal at SCRP (`0x51ea3c`, key mask Ctrl, ORs bit 1 into var 0x101 = the condition of node 34, then var 5 = 12: z15SSH) completes the node; the parked helicopter PHEL has its own
portal back to the Adventure Island. Gems, scorpions and tumbleweeds are everywhere; Ctrl rides the skateboard; Enter next to the helicopter changes its look.
Node 45 (from the fishing chain, prev zone != 10: Pepper arrives at PATH node 0x10 (123.5, 16.3, 120.1)): Johnny, Pippin and Kilroy (DRKL) stand at PATH node 6 (516.6, 5.1, -223.5) in the far east; the StartCSM trigger there (waypoint 6, radius 2.5 * 8, slot 1 = ADV05) plays the
cutscene when Pepper gets near and then applies var 0x103 := 7 = the node's condition (the objective arrow, `ADVHOL9`, points at record 5 = Johnny).
* `tools/steps/m5-z14OSD-bot.mjs` (node 34): hand-over Adventure Island -> Oasis (var 5 = 11 in the CAI zone, the real zone switch), arrival check (prev 10, (-385.8, 10, -149.5)), ADV01 (screenshots, skipped with Shift), HUD, conversations with Johnny and Pippin (real Shift), gem pick-up
  (score 1000, "x1", HUD), tumbleweeds, a scorpion attack (state 0x10, grab var 0x5e & 0x20, clip 0x70), skateboard on / off (Ctrl), the helicopter's look change (Enter, var 0xd2), the scorpion portal (Ctrl) -> node 34 done -> z15SSH.
* `tools/steps/m5-z14OSD-bot45.mjs` (node 45): arrival, objective, sub-object matrices, the approach to the NPCs, ADV05 played to its end, node 45 done -> the next zone.
Run (snapshot server on the worker's port 5512): `sh tools/m4-snapshot-server.sh 5512`, then `BASE=http://localhost:5512 sh tools/m5-botslot.sh node tools/browse.mjs "<url>" tools/steps/<bot>.mjs --size 1280x800 --out /tmp/m5-z14OSD`.
