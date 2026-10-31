# M5 z07CSI horse: the castle's horse (worker `csi-horse`)

The three constructors of `Common\Z07CSI\Horse.c` (source path strings 0x8f8618 / 0x8f864c / 0x8f8680) that the castle's set-up attaches, and the 839-line ride handler `FUN_005769a8`.
Everything is ported from the decompile + the assembly (every float branch and every call argument read in `LE2.asm.txt`; the decompile drops the arguments of many calls and sometimes
mixes up aliased float locals) and verified against the ORIGINAL code run natively in the x86 interpreter (`src/formats/x86emu.ts`), bit for bit in float32, see section 6.
The castle's mode switch (Control, `src/zones/z07CSI/control.ts`, csi worker) owns Pepper's mode word; this folder only writes `vehicles(world).current` (DAT_009daa80) where the
original does and the vehicle kind / var 0x112 / PEPPER_CONTROL = 0x10 where the horse's pre-render does.

## 1. Files

| file | content |
|---|---|
| `src/zones/z07CSI/horse/index.ts` | `registerCtor` of the three constructors (imported by `src/zones/z07CSI/index.ts`: one line) |
| `hors.ts` | HORS 0x579178: node `HorseNode` (update FUN_005769a8, pre-render FUN_00578f2d, destroy FUN_00579328, constructor work), `horseAxes`, `horseGlobals`, `coverage` (test instrumentation) |
| `rider.ts` | 0x579725 `RiderNode` (PEPP @5 and JKIT: FUN_00579379 / FUN_005793c1) and 0x579948 `SaddleNode` (RSAD / GSAD / CLOK: FUN_005797cf / FUN_0057987e) |
| `setup.ts` | `applyEmulatedSetupState`: the emulated set-up's final visibility (and explicit placement) of the horse family's records, applied once at the first update (see section 5, finding 10) |
| `math.ts` | float32 helpers with the machine's operation order: `eulerRotation` (FUN_0043a4a1 / 0043a5e4), `normalize` (FUN_0043cec0), `transformPoint` (FUN_0043ab72), `sweepF` / `probeF` (FUN_00441270 / FUN_00441ac0 with float32 arguments and results) |
| tests | `tools/tests/m5-z07CSI-horse-emu.mjs` (the horse next to the original), `m5-z07CSI-horse-ride.mjs` (Control + horse + riders together), `m5-z07CSI-horse-math.mjs` (the helpers); spots: `tools/lib/m5-z07CSI-horse-spots.mjs` |
| bot | `tools/steps/m5-z07CSI-horse.mjs` |

## 2. The records and nodes (attaches of the emulated set-up, every stage 15 .. 29)

| record | constructor | position / gate | node |
|---|---|---|---|
| HORS (48) | SGMFIG 0x426151 (gate `var 2 & 1 == 0`: never open, only its constructor's walker matters) then **0x579178** | @1, var 0x112 & 0 (always), ctrl flags 6 | `HorseNode` (0x5c bytes, table 0x8f85c0) |
| PEPP (7) | **0x579725** | @5 of Pepper's chain (Control @0, SGwalk @1, sgswim @2, skate @3, SGVehic @4), var 0x5e & 0x10 == 0x10 | `RiderNode` (0x18 bytes, table 0x8f85e8) |
| JKIT (46, the jockey kit) | **0x579725** | @0, var 0x5e & 0 (always) | `RiderNode` |
| RSAD, GSAD (51, 52: red / green saddle), CLOK (53: cloak) | **0x579948** | @0, var 2 & 1 == 1 (always), argument block `{21, 25}` / `{21, 25}` / `{22, 24}` (two dwords at +0x14 / +0x18 that no handler reads) | `SaddleNode` (0x20 bytes, table 0x8f8600) |

Handler tables (update, pre-render, destroy, draw, save, load / size): HORS `{ 0x5769a8, 0x578f2d, 0x579328, 0x578fcf (default mesh draw FUN_00444480), 0x5790c9, 0x57900b }`,
rider `{ 0x579379, 0x5793c1, 0x57979f, 0x57968b (default draw), 0x5796ec, 0x5796c7 }`, saddle `{ 0x5797cf, 0x57987e, 0x5799d9, 0x579898 (default draw), 0x57990f, 0x5798ea }`. The framework passes
`(record, node, controller, value of the gate variable)` to the update: the horse reads var 0x112's VALUE (bit 0 = ridden, bit 0x10 = busy), the rider var 0x5e's.

## 3. HORS (FUN_00579178 / 005769a8 / 00578f2d / 00579328)

**Node block** (dword index / byte offset): +0x00 var (0x112), +0x08 stamp (the framework: frame + 1 after the pre-render), +0x18 state flags (1 gallop, 0x10 jumping, 0x20 hop armed,
0x100 reversing, 0x1000 turning on the spot / landing), +0x1c jump omega (pi / frames of clip 6), +0x20 height at the start of the jump, +0x24 hop height (0 .. 6.4), +0x2c turn rate (0.1745 at
rest, + 0.0523596 per tick while turning, up to 1.5708), +0x30 its acceleration, +0x34 the pitch the ground asks for, +0x38 ticks of walking backwards, +0x3c .. +0x48 the last position / yaw seen
without a ground clamp, +0x4c hoof sound state (0 .. 2), +0x50 idle timer (300), +0x54 "has been ridden", +0x58 stand animation timer. Fields the constructor does not set (+0x1c, +0x20, +0x48,
+0x58 ...) start as 0 (heap block of a fresh process: the original never reads them before writing them, except +0x58 which then counts up from 0 or garbage; assumed 0).
Global `DAT_05d58964` ("the horse has been the vehicle once", never cleared again) is the node's `pending`.

**Constructor FUN_00579178** (run by the framework's `ctorInit` after the set-up): `FUN_00462d4f(1, rec, -2)` = the controller's waypoint walker (already made by the SGMFIG node's constructor, which runs
first: it keeps the walker with the SGMFIG tuning, then this constructor tunes it again: speed 0x3d086595, lane 0, turn rate 0x3f060a63, radii 0x3e4ccccd / 0x3f400000 / 0x3e800000) and
`FUN_00461fe4` (apply), node start values (turn rate 0x3e32b884, acceleration 0x3d567704, +0x3c.. = the record's translation). The walker is never driven by the horse (SGMFIG's gate is closed);
it only occupies a slot of the 60 walkers. Destroy FUN_00579328 frees it. The oracle runs the constructor natively (the waypoint walker 0x461000 .. 0x466800 native too) and the first compare
(before any tick) checks the node block, the record, the random numbers.

**Update FUN_005769a8**, by branch (all float32; `dt` = `w.dt` where the original multiplies by DAT_008b1718):
* not visible (flags & 2 == 0) -> 0; a cutscene runs (FUN_0045c432) -> 1.
* **idle** (var 0x112 & 1 == 0): the horse is the vehicle already -> `range = ctrl.distSq`, `pending = 1`, 1. Mount: Ctrl pressed, walk state != 0x62, `ctrl.distSq < range` (DAT_008ae330: 576 while Pepper
  walks), visible, `PEPPER_CONTROL & 0x7fff == 1` -> `vehicles.current = HORS`, `range = ctrl.distSq`, 1 (Control's pre-render then makes PEPPER_CONTROL 0x10 / clip 0x43, the horse's own pre-render sets var 0x112 |= 1).
  Else: `var 0xc |= 2` (the Ctrl icon) when within range, clip 5 (grazing: starts it or advances by 1.0), the matrix levelled to the stored pitch (`rx != pitch`: FUN_0043a4a1(rec, pitch, ry, 0)),
  a neigh (3D `0x5d58940`) when `rand(120) >= 119`, and for a horse that was ridden (`active`): out of the frustum for 300 ticks -> `active = 0`, the horse is put on PATH node 0x5a (FUN_00462be9(1, 0x5a)). Returns 0.
* **ridden** (var 0x112 & 1): idle timer 300, `active = 1`. A node that did not run the tick before (`stamp != frame`) starts clip 2, adds Up to the held keys and becomes the vehicle. Pad stick axes
  (DAT_0098384c / DAT_00983850: -127 .. 127, but see section 5) -> held bits and the turn rate. Space (pressed, not while jumping / turning) toggles the gallop (clip 3, speed 1.0 / tick; trot clip 2,
  speed 1/3). `var 0x112 & 0x10` (busy) is set while jumping (0x1010) and cleared otherwise: Control does not let Ctrl get off while it is set.
  Alt held arms the hop (+0.8 a tick, up to 6.4); released: three sounds (`0x5d588a8`, one of `0x5d588dc` / `e0`, one of `e8` / `e4` by `rand(2) < 1`), clip 6, omega = pi / frames, state 0x10.
  Move: Up forward `b = speed * dt * forward`, Down backward, both -> none; backward for 1..4 ticks then released -> clip 4 + state 0x1000 (turn on the spot while landing); Left / Right: `+-sin(turnRate) * 0.0523596 * dt`.
  New place = place + b. The two ground probes (FUN_00576840: the terrain below via FUN_0043cd62 + a probe down to it, code 0 none / 1 terrain / 2 solid, `DAT_009da9b4` for BRGE hits)
  1.6 in front of / behind the new place, 6 above the higher end, give the pitch (`-atan2(front - back, 1.6)`, flat on solid / bridge ground (surface 7)), the height (the mean), the clamp flags (ground not above
  sea + 0.1). Pitch follows in steps of 3 degrees only when more than one step off. Jump: the height is `hop * sin(omega * frame) + max(start height, ground)`. Forward: blocked when the front
  probe has no ground or the ground drops 8; a sweep 8 ahead (radius / skin 1.04) turns the horse away from a wall (|angle| < 150 degrees); the body is swept 4 ahead from 4 up (then from 6 up) and a hit
  keeps the place; backward: the same with probes behind (6 up, then 8 up). Then two sweeps 1.92 ahead / behind the new place push the horse out (1.1 x the penetration). Clip advance by 1.0 (backward: the frame runs
  backwards); the jump ends with the clip. Turn rate grows while turning, camera: target = horse + 4.8, the eye eases by 0.0675 of its distance to the point (0, 12.8, -24) of the horse's matrix
  and its height by FUN_00422ddc. Hooves: 3D sounds by clip (1 / 4: 0x5d58898 every tick; 2 (trot): states 0 / 1 / 2 at frames 13 / 23 and the clip end with a random second hoof; 3 (gallop): frames 5 / 10 and the clip end).
* **pre-render FUN_00578f2d**: if `pending` and the horse is the vehicle: var 0x112 |= 1, PEPPER_CONTROL = 0x10, vehicle kind -4; if there is no vehicle: var 0x112 &= ~1.

## 4. The riders and the saddles

* `RiderNode` (PEPP, JKIT): update FUN_00579379 = visible iff `value & 0x10` (returns 1 / 0); pre-render FUN_005793c1: the stages 22 .. 24 (var 0x58) show the jockey kit and hide Pepper, the others the reverse;
  the clip from the horse's clip (3 / 4 / 6 / other -> 0xb7 / 0xb1 / 0xb9 / 0xb8 normally, 0xc6 / 0xb1 / 0x8b / 0xbc in the jousting stages) at the horse's frame; matrix and angles = the horse's
  (FUN_0043a5e4 with HORS's angles and translation).
* `SaddleNode` (RSAD / GSAD / CLOK): update FUN_005797cf copies HORS's 16 matrix words, its Euler angles and starts the horse's clip at its frame; returns whether the record is visible. (The story
  handler decides which saddle is shown.)

## 5. Findings (all found by reading the assembly or by the oracle test)

1. The debug build fills locals with 0xcc: `local_6c` (the clamp flags) is read for `mv == 0` ticks as 0xcc, so the "last good place" is not saved while the horse stands (found by the oracle test at tick 14).
2. The turn is applied twice while walking forward (once with the movement, again in the forward branch after the wall test): the yaw changes 2 x `sin(turnRate) * 0.0523596` per tick when Up and Left / Right are held.
3. The pitch step has a dead zone: the horse's pitch only changes when the ground's pitch is MORE than 3 degrees away from its own; otherwise it keeps its pitch.
4. The third `else` of the move code (not forward, not backward) is unreachable; the test checks that it stays unreached.
5. DAT_0098384c / DAT_00983850 (stick axes) are zeroed every tick by the input poll (FUN_004376f9) and written only by the boat / helicopter code of the same tick, so they are 0 while the horse runs: the horse
   is steered by the held key bits (Up 4, Down 8, Left 1, Right 2), the stick path is dead code. It is ported (`horseAxes`) and compared against the original with injected axes.
6. BRGE (record 4, the broken bridge) has no collision polygons (`hasPolys` false), so FUN_00576840's `== DAT_00983804 + 0x1a0` test (DAT_009da9b4 := 1) can never fire; BRGB (6) has 520 polygons of surface 7 (what sets the flag in practice).
7. FUN_0043cec0 (normalise) keeps the 24-bit precision in its sqrt (`1 / f32(sqrt(l2))`, sum order x, y, z), FUN_0043ab72 sums `((px m0 + py m4) + pz m8) + m12` (found by testing candidate orders against the native functions).
8. A start from the joust (previous zone 8) arrives on the horse (the emulated set-up writes var 0x5e := 0x10, var 0x112 := 1 and copies Pepper's matrix to HORS): `src/hub/arrival.ts` now finds the node for mode 0x10.
9. FUN_00576840's two calls share the delta vector: the first one may change its y, the second one sees that value when its own terrain lookup finds nothing.
10. **The port's world has the wrong visibility for HORS (and the saddles) at a fresh start of the castle.** `setupZone` takes record flags from the symbolic extraction of the set-up code, which applies the writes in ADDRESS order, the machine runs
   them in EXECUTION order: FUN_00573527 shows HORS at 0x573cbf (`flags = 2`), the Control constructor's tail FUN_005b2a23 (run earlier, but at address 0x5b2adc) hides it: the extraction ends hidden, the machine visible
   (the emulated set-up's `records[48].flags` is 2 from story node 21 on; RSAD / GSAD / CLOK likewise by stage). The csi worker's `constructCastleRoster` hides the hidden-list records again after the framework's world work. Without a fix
   a start at node 24 (previous zone 8: Pepper rides out of the joust on the horse) or at node 27 / 28 shows no horse and the horse node never runs (its update returns 0 for a hidden record). The set-up code also writes explicit
   placements (HORS and JKIT at Pepper's emulated place after the joust, the stage sets 0x57a8ae ...): `emu.changed` entries, which come after the SGMFIG constructor's placement on its PATH node. `setup.ts` applies exactly these two things
   (visibility bit, explicit position) to HORS and the saddles at the first update (after every other set-up step); nothing else of those records is touched. (A node change inside the castle (story handler, live writes) is not affected: it
   happens after the first tick.) The general cure (the extraction's ordering, the hidden list) belongs to the hub framework / the castle's `applyCsiSetup`: see Requests in progress.md.

## 6. Verification

| test | what | checks |
|---|---|---|
| `m5-z07CSI-horse-emu` | the horse, riders, saddles natively (constructors included) next to the port, 4 sessions (stages 21 / 22 / 25 / 19, dt 1 and 0.5) x 8000 ticks of random keys, stick axes, teleports (land / shore / sea edge / walls / bridge / cliffs), story variables, clips, cutscenes, view flag; every tick: 6 records (matrix, angles, flags, clip, frame), node block, camera, all variables, vehicle globals, sound calls, random numbers consumed | 19.3 M, 0 failures; 105 named branches all reached |
| `m5-z07CSI-horse-ride` | Control (native) + horse + riders: Ctrl mounts / dismounts at the free spot, rides | 18.1 M, 0 failures (72 mounts / 69 dismounts) |
| `m5-z07CSI-horse-math` | normalise / point * matrix / Euler vs the native functions | 60000 |
| `m5-z07CSI-horse-nodes` | the port alone, real input keys: attaches / gates / set-up visibility of the 12 stages, the arrival after the joust (rides at once), Up / Space / Right / Alt (busy bit, Ctrl does not get off) / Ctrl off and on, the story's ride start, the horse going home after 300 ticks out of sight | 114 |
| bot `tools/steps/m5-z07CSI-horse.mjs` | headless browser, real keys (section 8): ALL OK, screenshots in `/tmp/m5-z07CSI-horse` looked at (trot, gallop, jump, dismounted, side view with the saddle, the gate of the Bull castle, the Lion castle, csi05) | - |

The oracle machine is `tools/lib/m5-z07CSI-emu.mjs` (`makeCsiDuel`): the original's node framework and node code run natively; hosted: variables, the C `rand` (one LCG shared with the port), collision / terrain
(the port's CollisionWorld on both sides: the glue is verified, the engine is the island package's), animation instances (the port's), sound / draw calls (logged).

## 7. What is not exact and why

* **Frustum flag**: the original reads record flag 1, which the draw pass of the tick before set (FUN_00444370); the port asks `ctx.inFrustum(rec)` (the hub context: the record's collision sphere against the planes of the LAST DRAWN frame, GameRenderer.sphereVisible), the same one-frame lag at one simulation step per drawn frame. The sphere test is `visibleFlags` (`src/fx/particles/sprites.ts`): FUN_00416590 only wraps `IDirect3DDevice7::ComputeSphereVisibility`, a system DLL that is not in the executable, so the oracle cannot run it; the port does it in float32 per operation, the way Wine's ddraw does (native-measured result layout, see the function). The planes are built from the matrix of the last drawn frame (`clipPlanes`). What cannot be settled is only whether Microsoft's runtime rounds exactly like Wine's reimplementation on a sphere exactly on a plane (inherent: no reference binary of d3dim.dll). The oracle test feeds the same flag to both sides.
* **Saved games**: exact since WP-SAVE (docs/re/save.md): the horse's 0x44 bytes at +0x18 (+ var 0x112), the rider's byte at +0x15 and the saddle's at +0x1c are written and read like FUN_0057900b / FUN_005790c9 etc. (`m8-save-csi`, `m8-save-nodes`).
* Uninitialised heap fields of the node (see section 3): the debug heap's 0xCD fill, kept by the port until the game writes them (`src/game/heapfill.ts`).
* The collision engine (sweeps, terrain) is shared with the other zones (oracle tests `m7-walk-col`, `m4-s5-colshapes`); the horse's own use of it is in `m5-z07CSI-horse-emu`.

## 8. Bot, particles, sounds

* Particles: the horse code starts **no** emitters (no FUN_0044e920 / FUN_00442960 call in Horse.c); nothing to wire.
* Sounds (handle globals of the castle's loader FUN_00572ef0, `soundOf(addr)`): 0x5d58940 neigh (3D), 0x5d588a8 / 0x5d588dc / 0x5d588e0 / 0x5d588e8 / 0x5d588e4 jump (2D), 0x5d58898 hoof, 0x5d588c0 / c4 / c8 / cc / b0 trot / gallop hooves (3D at the horse).
* Bot `tools/steps/m5-z07CSI-horse.mjs`: the castle at story node 19 (a start from the island arrives by boat: the bot puts Pepper ashore at the place the original gives her after the bridge mini-game, the boat's own
  variable 0) -> csi02 -> the walk to the Bull castle gate -> csi04 -> node 21 with Pepper on the horse (the story handler) -> trot / gallop / turns / reverse / jump (busy bit, Ctrl does not get off) / dismount /
  the interaction icon (HUD texture 1 within 24 units) / mount / the castle gate in the way / ride to the Lion castle with a detour when the horse is stuck (csi05, node 22) / the horse's sound ids are in the preload list.
  Command in its header (`CSI_PORT=5519 sh tools/m5-botslot.sh node tools/browse.mjs ...`).
* **Switching `tools/steps/m5-z07CSI.mjs` (the csi worker's chapter bot) to the horse nodes**: nothing to change in the bot itself: it checks `pepper.ctrl.nodes.some((n) => n.kind === 'Horse')` and then rides with the walk keys
  (`S.walkTo`: Up, Left / Right by the heading error; Pepper's pose is the horse's). Only its expectation "back in the castle: node 24, on foot (prev 8)" (PEPPER_CONTROL 1) must become "on the horse (0x10)", see Requests in progress.md.

## 9. Shared-file edits (additive, surgical)

| file | edit | why |
|---|---|---|
| `src/zones/z07CSI/index.ts` | + `import './horse/index.ts';` | registers the three constructors (the csi worker's file, the line the interface note asked for) |
| `tools/lib/m5-z07CSI-emu.mjs` (csi harness) | + `NATIVE_CTORS` HORSE / RIDER / SADDLE; options `extraExec`, `beforeAttach(d)`; `d.rngCount` / `d.reseed`; with `chain: true` Pepper's own attaches are made in the original's order (Control, the walk stub, then the rider @5) | the horse oracle |
| `tools/lib/m7-isl-veh-emu.mjs` (island duel) | `passes()` writes `this.axisX ?? 0` / `this.axisY ?? 0` instead of 0 into the stick axes | the horse test injects stick axes |
