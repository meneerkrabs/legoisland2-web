# M5 foundation (worker F): the shared hub machinery

Everything the six hub workers share, done once: the x86 set-up emulation for any zone, the hub framework (`src/hub/`), the survey of the six hubs, the bot library
and the tests. A hub worker now only fills in ITS folder `src/zones/<hub>/` (stub modules exist, see 2.6) + its tests / bots / doc.
Tests: `node tools/test-formats.mjs --only m5-foundation-emu,m5-foundation-hub` (3716 + 179 checks). Headless run: `tools/steps/m5-foundation-hubs.mjs`.
Generated survey tables: `docs/re/m5/foundation-ctors.md` (`node tools/m5-hub-survey.mjs`).

## 1. The set-up emulation for any zone (`src/formats/emusetup.ts`)

```ts
emulateZoneSetup(pe, scene, env: EmuEnv, spec: ZoneEmuSpec): IslandSetup   // any zone; code region / loader / builder / root from zoneCodeIndex
emulateIslandSetup(pe, scene, env)         // = emulateZoneSetup(.., ISLAND_SPEC): identical results (checked: attaches, stores, calls, var writes, cutscenes, boxes)
emuSpecOf(zone) / HUB_SPECS / emulateSetup(pe, scene, env, zone)          // island + the six hubs
profileFor(zone, pe, scene, starts, { emuVars: sh.vars, archive })        // -> profile.emu (the island: also profile.island; `islandVars` still works)
EmuEnv { vars, archive?, maxSteps?, hooks?, terrainHeight?(groundRecord, x, y, z, dy) }
ZoneEmuSpec { zone, story?, root?, eraOf?, vehicleRoster?, loaderRigs?, pre?, native?, exec?, shared?, hooks?(HostCtx) }
```

* The hubs' root is the loader's only caller (`code.root`: CSI 0x574d9c, CAI 0x61beae, OSD 0x629788, PYA 0x676c22, DIP 0x7272ee, OGL 0x7e4222): it calls the loader and
  the set-up proper. `HUB_SPECS`: `shared: ['z02LGI']` (the island's code region executes natively too: the hubs call its vehicle roster `FUN_0051e475` /
  `FUN_0051e4b0`), `loaderRigs: true`, `pre` = the functions each wrapper calls before the root (sound handle loaders, HUD overlay loaders), the castle `story: 0x574e40`.
* New results on `IslandSetup`: `loaderRigs` (record, rig name, clip of the animation instances the zone's loader creates: hosted `FUN_0043b1ff` / `0043b4e2` /
  `0043b6a3`; for the island it equals the static `islandRigs` table, tested), `soundHandles` (global address -> sound id / music key the wrapper's and set-up's
  `FUN_004433b0` / `00443580` / `00443290` returned: tokens read back from the globals), `run(fn, args, opts)` + `alloc(size)` + `setVar(i, v)` (**call any function of
  the original in the same emulated machine after the set-up**: the oracle of the hub ports' tests, e.g. `run(0x574e40, [&next, &prev, node])` returns eax, the calls, record
  stores and variable writes; see `tools/tests/m5-foundation-emu.mjs` (c2)), `toZoneSetup()` now has the real `subgame` / `variants` of the zone.
* Terrain: `FUN_0043cd62(&pos, dy)` (ground height; the hubs put Pepper and props on the terrain) is hosted and answered by the port's `CollisionWorld.terrainHeight` against
  the ground record the set-up named (`profileFor` builds it lazily from the archive; the emulated Pepper y of CSI nodes 19..29 comes from it, tested against the original's store).
* The emulated collision blocks hold the real `.col` header (centre +0x0c, half extents +0x18, radius +0x24): `FUN_00442810` (box dims from the collision extents, CSI
  records 73 / 91) is native. New natives: `FUN_0043a340`, `FUN_00442810`, `FUN_0051e475`, `FUN_0051e4b0`. Hosted + logged (return 0): sound / music loads, `FUN_0043b64d`
  (animation time of a record's anim: DIP node 50, 6 calls), `FUN_0043ea60` (sub-object matrix: OSD node 45 zeroes the part matrices of record 70 parts 1 / 2).
* **Verified**: all 73 story nodes of all six hubs run with an EMPTY `unhooked`; for every FSM node that maps to a hub (CSI 15-17, 19-22, 24, 25, 27-29, CAI 33, 51,
  OSD 34, 45, PYA 36, 38, 40, DIP 47, 50, OGL 64, 66) every attach / flag write / box / cutscene / HUD hint / render mode that the symbolic extraction reports as active is in
  the emulation (`tools/lib/emu-oracle.mjs`; oracle weaknesses, not emulator differences: box dims read from uninitialised locals (0xcccccccc), gate masks held in a
  local that is shifted after every attach (OGL `FUN_007e36dd`, as the island's `FUN_0052266a`), `!=` name conditions of record loops that `nameMatches` ignores (PYA `PMC?`)).
  Cost 25-100 ms per node. Attach counts (this build, only var 0x58 set): CSI 115 (nodes 15-17) / 127 (19-22) / 125 (24, 25) / 124 (27-29), CAI 27, OSD 56 / 57, PYA 39 / 30 / 26,
  DIP 38 / 55, OGL 64 / 59 (the "311 / 124 / 97" of zone-setup.md are all story states together).
* Not run (like the island): the wrapper's `FUN_0042207d(PEPP)`, `FUN_00421bbe(n)` (outfit / building phase restore by hub number), `FUN_00423bf0`, the GameLoop's init.

## 2. The hub framework (`src/hub/`, new folder; copy-generalised from the island, `src/zones/z02LGI` and `src/island/ctx.ts` behave as before)

```ts
import { registerHub } from '../../hub/index.ts';     // also registers every shared island node family (registerCtor by constructor address)
registerHub({ archive: 'z07CSI', story, frame, draw2d, arrival, ctors, afterSetup, onCreate, onStart, exit, bricks, vehicleArrival, destroy, debug });
```

* **2.1 `HubContext`** (`ctx.ts`, `implements IslandCtx`): cutscene (`startCutscene` / `cutsceneActive` / `holdCutscene`), speech (`say`, `speechIdle`, `stopSpeech`, subtitles via the
  runner), sound (`sfx`, `sfxAt`, `sfxFreq`, `stopSfx`), music (`music(key)`, `musicGroove`, `musicMute`, `ambience`), message tables (`setText('npc' | 'hol', path)`,
  `text.npc` / `text.hol`, `table(path)`), objective (`goal`: the engine's FUN_00424270 family, `objective.target`), dictionaries (`animClip`, `switchVar`), `rigOf(record)`
  (loader rigs), `soundOf(addr)` / `musicOf(addr)` (handle globals -> sound id / music key), `pathPos(n)`, `inFrustum`, `uvScroll`, FX_Bricks, `hub` (open bag for a hub's own
  services), `shared`, `zoneCtx`. `hubOf(world)`. Installed under the island's key, so the shared node families (`ctxOf` / `tryCtx`) find it.
* **2.2 `HubGame`** (`game.ts`, `implements ZoneGame`): mode 1 waits for any button (`introPanel = false`, like the island); per tick of mode 2: cutscene frame
  (`beforeTick`) -> `world.tick` -> `update` (cutscene carried actors, F9) -> the runner's story FSM (`sh.story.frame()`) -> `storyTick`: `spec.story(env, ref, node)` when var 0x58
  changed; `everyTick(mode)` -> `spec.frame(h, mode)` (the loop's per-frame HUD function; any mode); `draw2d` -> cutscene subtitle + `spec.draw2d`; `exitNext` -> `spec.exit`, else the
  handler's `ref.next` (exit 2), else the runner's mapping. F9 completes the current story node (only with the debug option `?debug=1`, src/game/debug.ts). The constructor runs
  `computeIslandTotals` (FUN_00423bf0), `replaySetupState` (2.4) and the set-up's own story call (`env.setupCall`).
* **2.3 Story handler protocol** (`story.ts`): `HubStoryHandler = (env: HubStoryEnv, ref: { prev, next }, node) => exit state` (`EXIT.RUNNING` = 1 stay, 2 leave with `ref.next`);
  do nothing while `env.cutsceneActive()` and leave `ref.prev` alone (it runs again next frame); the set-up call (`env.setupCall`) must not write (the emulation did). `HubStoryEnv`
  = the island's `StoryEnv` (vars, flags, `freeTexts` / `npcText` / `holText` with the VA of the path string, `objRecord` / `objPair` / `objFour` / `objNode`, `holoAlert`) +
  `ictx`. `liveHubStoryEnv(ictx, setupCall)`. Extend by adding members in your own module (`env.ictx.hub`), not by editing story.ts.
* **2.4 Set-up state** (`setupstate.ts`): `replaySetupState(ictx)` applies the text-file and objective calls the set-up code made (FUN_00423fe0 / 0088d280 / 00423ff6 / 0088d296,
  FUN_00424270 / 00424230 / 0042419f / 004242b9) in call order. Only the castle's loop has a story handler; the other hubs select their texts / objective in the set-up
  (OSD node 45: `FUN_0062bb80` loads ADVHOL9 and points the arrow at record 5), so this is what keeps their hologram / NPC lines working.
* **2.5 Set-up hooks** (`registerHub` does `registerZoneSetup` + `registerZoneGame`): emulated set-up against the live variables (`profileOptions: { emuVars: sh.vars, archive }`),
  `HubContext` installed before the nodes are built, `loadIslandWalkMaps` (the set-up's `FUN_004630c0` maps), animation instances from `loaderRigs` (`ensureAnim`), `startPizzaNodes`,
  `startIslandNpcs`, Pepper's walker on PATH (FUN_0042207d), the emulated vehicle arrival (`arrival.ts`: the vehicle record the set-up gave Pepper's matrix + the control mode it wrote;
  `setupZone` resets var 0x5e to 1, so the emulated value is restored only when a node of Pepper's chain takes that mode, else she walks and a note says so), vehicle saves, cutscene
  slots from the set-up (`hubSlotSpecs`; a slot whose script is missing is left empty, a missing `.str` only means no texts: OGL03 / OGL04 have none, `CutsceneHost.declare` tolerates it,
  FUN_0045d64f defines the script anyway), `spec.arrival` (default: where the emulated code put Pepper), `spec.ctors`, `spec.afterSetup`. `bricks: true` installs the brick library.
* **2.6 Registration glue**: `src/zones/z07CSI|z13CAI|z14OSD|z16PYA|z23DIP|z40OGL/index.ts` (stubs: `registerHub({ archive })`) are imported once by `src/zones/index.ts`.
  The hub workers edit only these folders. `tools/lib/hub-load.mjs` (`loadHub(ctx, { zone, node, vars })`, `tick`, `press`, `hold`) builds a hub world for node tests with a mock context.

## 3. Survey of the hubs

| | z07CSI castle | z13CAI Adventure | z14OSD Oasis | z16PYA Pyramid | z23DIP Dino | z40OGL Ogel |
|---|---|---|---|---|---|---|
| zone table index (kind 1) / run (wrapper) | 6 `z90CAS` / 0x572780 | 10 `z90ADV` / 0x61aebb | 11 `z90OSD` / 0x628252 | 13 `z90PYA` / 0x675f02 | 19 `z90DIP` / 0x72645c | 27 `z90OGL` / 0x7e2321 |
| GameLoop | 0x572910 | 0x61a821 | 0x627c90 | 0x675930 | 0x725ec1 | 0x7e247f |
| set-up root (loader) | 0x574d9c -> 0x573527(1) (0x59b3cb) | 0x61beae -> 0x61b1f4 (0x621d05) | 0x629788 -> 0x6290ea(1) (0x645d65) | 0x676c22 -> 0x6768ce (0x68a987) | 0x7272ee -> 0x726e25 (0x74fac5) | 0x7e4222 -> 0x7e3bd1(1) (0x7fe97e) |
| story handler in the loop | `FUN_00574e40` (110 lines) | none | none | none | none | none (`FUN_007e2ad0` = HUD) |
| per-frame HUD function | 0x575ca0 (69) | 0x61bf8c (56) | 0x628410 (71) | 0x6760d0 (71) | 0x726610 (71) | 0x7e2ad0 (71) |
| set-up pieces by story node | `<0x12` (nodes 15-17) `57af76` (+`5b5a20` 777 lines), `<0x17` (19-22) `57abc9` (+`5b2fa0` 895), `<0x1a` (24, 25) `57a8ae`, else `57a6b6`; each + a slot function; dictionary `57b140`, parts / boxes `573290` | var 0x58 bands `<6 / <0x1e / <0x33 / <0x3d` (the island's eras) in `61b1f4`; helicopter place by var 0xa3 (`0xb` = from OSD, `0x13` = from DIP) | `<0x23` (34) `62c500` (187), `<0x2e` (45) `62bb80` (216), else flags only; arrival by var 0xa3 (`!= 10`) | `<0x25` (36) / `<0x27` (38) / `<0x29` (40) / else in `6768ce` (+ `678000` 247, `677900` 170, `6775d0` 78, per-record name loop `676482`) | `<0x30` (47) / `<0x33` (50) / else in `726e25` (+ `7283e0` 631, `72a2b0` 435) | `<0x41` (64) `7e7c56`, else (66) `7e8308`; `7e39d9` + `7e36dd` Overlay attaches |
| pre-root functions of the wrapper (run by `pre`) | `572ef0` sound handles | `61bf50` overlay, `61b000` sounds | `6285e0` sounds, `6283c0` overlay | `6762a0` sounds, `676080` overlay | `7267e0` sounds, `7265c0` overlay | `7e2a80` overlay (sounds inside the root: `7e3350`, 45) |
| post-loop (exit) functions | `574e10` (clean up), `5726f0` = `ret` | `61bf1b`, `61c0d4` = `ret` | `62980d`, `627c00` = `ret` | `676ca2`, `6758a0` = `ret` | `727336`, `725e50` = `ret` | `7e4293`, `7e22b0` = `ret` |
| cutscene slots of the set-up | csi01 / csi02 04 05 06 / csi07 08 09 (slots from 4 slot functions) | none | ADV01, ADV05 | ADV02, ADV03 | ADV07, ADV10 | OGL01, OGL03, OGL04 (the last two have no `.str`) |
| dictionaries (emulated) | 246 animations (loader) + 70 `SWITCH_CSI_*` | 154 animations | 180 animations | 164 | 191 | 228 animations + 59 `SWITCH_OGL_*` |
| waypoint maps / HUD hints / loader rigs (kinds / records) / sound handles / records | PATH, CSM / 4 / 9 / 65 / 44 / 208 | PATH / 0 / 3 / 18 / 6 / 55 | PATH / 4 / 9 / 62 / 26 / 212 | PATH / 4 / 3 / 16 / 19 / 115 | PATH / 4 / 9 / 28 / 24 / 270 | PATH, CSM / 4 / 11 / 38 / 45 / 137 |
| constructors attached: total / unported / decompile lines of unported | 26 / 7 / 2065 | 11 / 3 / 418 | 21 / 6 / 1310 | 16 / 5 / 1127 | 15 / 3 / 651 | 16 / 8 / 1850 |

The exit functions are empty (`ret`): nothing to port; the loop's exit 6 / 8 mapping (`DAT_... = FUN_00404be7()`, var 5) is the runner's `nextAfterExit`. The six per-frame functions
are the same HUD update (score text "%04d" of a high-score var: CSI 0xce, CAI / OSD / PYA / DIP 0x17, OGL 0x25; a collected-items counter by the bits of a var: CSI 0xbc, OSD 0x1d, PYA 0xde, DIP 0x3c,
OGL 0x31, CAI none; the interaction icon of var 0xc with the 15 / 30 frame blink, then var 0xc = 0): see `Hud.updateIsland` (src/shell/hud.ts) for the island's variant; differences
in the `PEPPER_CONTROL & 1` gating are per hub (CSI / CAI gate the whole icon, the others slots 1..3 only): port each against its own decompile and set the `Hud` fields from `spec.frame`.

**Constructors** (full per-node tables with ctor / handler sizes and the registered flag: `foundation-ctors.md`). Shared island families attached in hubs and ported: SGMFIG 0x426151,
Turn2Pep A / B / C 0x52ff39 / 0x5306e5 / 0x5308f3, MeetPepp 0x530d69, Human1 0x4bec00, StartCSM 0x51e19c / 0x51ea3c, Pizza 0x429d1b + carry, hOLO 0x88df51, SeaAmin 0x4b1212, SGwalk, sgswim,
skate 0x43310c, SGVehic 0x4333c2, SGBoat 0x430e6c (CSI), SGHeli 0x4325e8 (CAI); sky / sea / seabed 0x4266ca / 0x426915 / 0x426da4 are drawn by `src/render/environment.ts`. Unported:

* CSI: Rattus 0x5766fb / 0x5763ca (10 + 10), Horse 0x579948 / 0x579725 / 0x579178 (3 + 2 + 1; 0x579178 has 936 handler lines), Control 0x57a579 (Pepper's mode node, 190), CSIFSM 0x575b44 (207).
* CAI: Bunny 0x4b4000 (x16), seabed.c 0x426f55 (x2), PepSwitc copy 0x61c2a4.   OSD: scorpion 0x62ad35 / 0x62af8d, Gems 0x62b220 (x10), Tumblewd 0x629d7e (x7), Bunny 0x4b4000 (x7), PEPPSW 0x62ba3b.
* PYA: scorpion 0x62ad35 (x10) / 0x62af8d, Gems 0x62b220 (x5), Tumblewd 0x629d7e (x2), PeppSw 0x677350.   DIP: Gems 0x62b220 (x5), PeppSw 0x727e84 / 0x7281aa.
* OGL: Overlay 0x7e31fc (x9), PeppSwit 0x7e5ea7 (x8) / 0x7e61e9 (x5) / 0x7e69a2 (x5) / 0x7e4f9c / 0x7e539e / 0x7e6bb2 / 0x7e6498.
* **Shared between hubs** (port once): Gems / scorpion / Tumblewd (OSD, PYA, DIP) and Bunny 0x4b4000 (CAI, OSD). The constructors are registered by address in a global map, and every hub module is
  imported in the same bundle, so the OSD worker's `registerCtor` of Gems serves PYA and DIP as soon as it lands (see 5, ownership). The five `PepSwitc` copies (Pepper's mode switch, own sound
  globals / vehicle lists per hub: OSD update `0x62b483` 135 lines ...) are structurally the island's `PepSwitc` (src/island/vehicles/pepswitch.ts): port each against its decompile, reuse the island's helpers.

**Arrival** (emulated, `emulatedArrival(emu)` in `src/hub/arrival.ts`; var 0xa3 = PREV_SUBGAME, zone table index of the zone the player comes from; tested): CSI from the island (prev 0, 2, 31, 32, 33 = also a
load / chapter skip) in the speedboat SPBT (record 87) at (-377.5, 1.5, -213.5), PEPPER_CONTROL 8; from z08BKD (7) / z10RGB (9) walking at (228.6, 13.6, 179.7) / (-61.6, 12.4, -6.1) (node 15) etc., from
z09JST (8) control 0x10 at (119.6, 14.1, -73.5); any other previous zone: (217.2, 2.1, 201.6) walking. CAI: helicopter PHEL (record 50), control 8, at (-654.3, 97.9, 644.1); from the Oasis (11)
(803.8, 44.6, -788.7), from the Dino island (19) (-699.5, 93.9, 160.5). OSD: walking at (123.5, 16.3, 120.1), from CAI (10) at (-385.8, 10.0, -149.5) (the only hub that reads var 0xa3 in its set-up
itself: `FUN_006290ea`). PYA (2.0, 1.9, 313.8) / (74.1, -2.1, 261.3) / (82.9, 6.2, 56.4) for nodes 36 / 38 / 40, DIP (175.7, -6.6, 56.7) / (106.5, 0.7, -39.3) for 47 / 50, OGL (35.3, 27.0, 209.1) /
(-143.7, -65.8, 122.1) for 64 / 66: independent of the previous zone. The island's side (`src/zones/z02LGI/arrival.ts`, FUN_004c2d22) handles prev 6 / 10 / 11 / 13 / 0x13 the other way round (arrival
on the island from a hub by boat PORS / helicopter PORA, vehicle chosen by var 0xbb via FUN_0051e4b0): unchanged. From the front end (a saved game) the variables come from the save: the same code path.
No hub needs a hand-written arrival unless the emulated place is wrong; `spec.arrival` overrides.

**Island node families and the hubs** (`src/island/`): the families are data driven (argument blocks from the emulated set-up), so the shared ones run in hubs unchanged (210 ticks of all six hubs with
the real families in `m5-foundation-hub`, plus the headless run). What assumed the island and was changed (additively): `ensureAnim` used the island's static rig table `islandRigs`; it asks
`ctx.rigOf?(record)` first (new optional member of `IslandCtx`; `HubContext` answers from `IslandSetup.loaderRigs`). What assumes the island and was NOT changed (no hub node needs it yet; whoever ports
a node that does gets the replacement): `islandSoundHandles` / `soundOf` (src/island/ambient/common.ts: the island's FUN_004b037e handle table, used by the ambient animals) -> use
`ctx.soundOf(addr)` of `HubContext` (emulated handle globals); `ptera.ts` `GLIDER_RECORD` (island record 171, shadow choice); `carry.ts` `carriedPizza` looks for the record name `PIZ3`; `trigger/lgifsm.ts`
(SWITCH_LGI_*, the island's CSM trigger node, hubs have CSIFSM / own FSMs); `Hud.updateIsland` + `playzone.ts` `island` flag (island HUD). The objective (`zones/z02LGI/objective.ts`) is generic.

**z60FRE / zone table index 0 (z00FRE)**: kind 1, run 0x470ac3, region 0x4702c3..0x48d0bd, root 0x47172c. It is NOT run by the hub stub: the shell has a dedicated runner (`registerZoneRunner('frontend')`,
`src/shell/frontend.ts` + `fenodes.ts`, being worked on by somebody else during this session). Its set-up also runs in the emulation (`emulateZoneSetup({ zone: 'z60FRE' })`: 11 attaches = Walk x4 +
Bunny 0x4b2d44 x7, 22 loader rigs, `unhooked` only `FUN_0041c080`), so the same machinery is available if the front end needs it. Zone table kind-1 zones overall: 0 FRE, 1 BPK (ported, M6), 2 / 31 / 32 / 33
island (M4), 6 / 10 / 11 / 13 / 19 / 27 the six hubs (M5), 34 LTC (ported). Nothing else hub-like is stubbed.

## 4. Bots and the chapter skip

`?zone=<archive>&node=N` already exists (`Shell.run`: `story.jump(N)` completes every node below N); for the hubs add `&mute=1&hold=1` (browse.mjs does not tap a key in mode 1) and `&debug=1` (F9).
`tools/steps/lib-hub.mjs`: `hubUrl(zone, node, extra)`, `HUBS` (archive -> table index, story nodes), `hub({ page, wait, log, shot }, archive)` -> `state()` (arch / mode / tick / pos / node / ctrl / cutscene),
`waitHub`, `start()` (mode 1 -> 2 with a button), `freePepper()` (Shift until the hologram / conversation lets go: PEPPER_CONTROL bit 0x100), `skipCutscenes()`, `tap` / `hold` (in game ticks),
`teleportNear(name, dist, ang)`, `teleportTo`, `pathNode(n)`, `rec(name)`, `vars([..])`, `setVar`, `debug()`, `completeNode()` / `f9()`, `zoneNow` / `untilLeft`, `nodeKinds()`. Example:
`tools/steps/m5-foundation-csi.mjs`, all six hubs: `tools/steps/m5-foundation-hubs.mjs` (screenshots looked at: CSI speedboat on the sea, CAI helicopter over the island, OSD cutscene ADV01 "Ahoy, aloha en
welkom op Adventure Eiland", PYA / DIP Pepper walking in the canyon, OGL in the dark with floating bricks). Run: `sh tools/m5-botslot.sh node tools/browse.mjs "<hubUrl>" tools/steps/<step>.mjs --size 1280x800 --out /tmp/m5-<zone>`.
`browse.mjs` taps a key for mode 1 of every zone game with `introPanel === false` (island and hubs) unless `hold=1`.
Notes for the hub bots: the castle arrival drives the speedboat (Space = forward, Alt = reverse, Left / Right steer); OSD / PYA / OGL start with the hologram calling Pepper (PEPPER_CONTROL 0x101):
Shift sends it away; **OGL renders dark** (everything but the bricks is black: check the lights / fog of `FUN_00442d90` and `lights/lights.lgt` first).

## 5. Ownership proposal and shared files

* CSI: `src/zones/z07CSI/**`, `tools/tests/m5-z07CSI*.mjs`, `tools/steps/m5-z07CSI*.mjs`, `docs/re/m5/z07CSI.md`. Same pattern for CAI, OSD, PYA, DIP, OGL.
* Shared constructors: **OSD owns Gems 0x62b220, scorpion 0x62ad35 / 0x62af8d, Tumblewd 0x629d7e** (PYA and DIP do not port them again; register by address, decode every hub difference from the
  argument block / `ictx.setup`); **CAI owns Bunny 0x4b4000** (OSD uses it too). A worker who needs one before it exists leaves the node out (`Loaded.skipped` lists it) and writes the need into the owner's doc.
* Foundation (this worker, then frozen): `src/hub/**`, `src/formats/emusetup.ts`, `src/zones/index.ts` (the six imports), `tools/lib/{ctx-standalone,hub-load,emu-oracle}.mjs`, `tools/steps/lib-hub.mjs`,
  `tools/m5-hub-survey.mjs`, `tools/tests/m5-foundation-*.mjs`, this doc. A hub worker who needs more in `src/hub` / `src/island` / `src/formats/emusetup.ts` makes an additive edit (a new optional `HubSpec`
  member, a new host entry in `HOST_NAMES` + hook), re-reads the file first and lists it in the hub doc.
* `docs/re/m5/progress.md`: each worker appends its own section.

## 6. Shared-file edits made by the foundation

`src/formats/emusetup.ts` (refactor into `emulateZoneSetup` + `ZoneEmuSpec`, hosts, `HUB_SPECS`, results; island results identical), `src/game/setup.ts` (`ProfileOptions.emuVars`, `ZoneProfile.emu`, `terrainOf`),
`src/island/ctx.ts` (`rigOf?`), `src/island/ambient/common.ts` (`ensureAnim` asks `rigOf`), `src/shell/cutscene-host.ts` (`declare`: a missing `.str` = empty table + warning; was a throw),
`src/zones/index.ts` (+6 imports), `tools/browse.mjs` (mode-1 key tap also for zone games with `introPanel === false`). `src/hub/game.ts` was touched by another worker (debug option for F9).

## 7. Limits / open questions

* `FUN_0043b64d` (animation time) and `FUN_0043ea60` (sub-object matrix) are logged, not executed (record anim instances in the emulation are tokens): DIP node 50 sets the time of 6 animations, OSD node 45 zeroes
  two part matrices of record 70: the hub workers apply these from `emu.calls` (name `animTime` / `subMatrix`). Sound / music loads are logged with their ids, nothing is played.
* Variables the live game sets before the hub starts (the previous zone 0xa3, the vehicle 0xbb, the story state) matter: a chapter skip (`?zone=&node=`) starts with PREV_SUBGAME 0, which for the castle
  means the boat arrival (the same as from the island). Story node 15's condition is PEPPER_CONTROL == 1, so after the boat arrival (8) the FSM stays on 15 until Pepper walks.
* Cutscene slots whose `.str` is missing (OGL03, OGL04) now run with empty texts (the original's text table pointer is whatever `FUN_00439126` returns for a missing file); the island's own LGICI05 slot is still
  left empty by its zone game (M4 decision, unchanged).
* The wrapper's `FUN_00421bbe(n)` (outfit / building phase restore per hub number) is not run: only record variant words matter and they are `records[i].variant` of the emulation if the set-up itself wrote them.
