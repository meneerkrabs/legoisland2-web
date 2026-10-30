# WP-SAVE: the save game, written and read like the original

`Shell.saveSlot` writes the original's `Save%02d.lgo` for the live world and `Shell.loadSlot` puts back what `FUN_00419e82` puts back. The file layout is in `docs/re/shell-m2.md` section 3 and the header of
`src/shell/save.ts`; this document is what WP-SAVE added: every section of the file is produced from the port's state and verified against the original's own code (the x86 emulation of the user's executable).

## Where things live

| piece | file | original |
|---|---|---|
| orchestration of the record sections | `src/shell/saveworld.ts` (`captureWorld`, `restoreWorld`, `captureEntities`, `applyEntitySection`, `captureObjects`, `applyObjects`) | FUN_00418ec7 / FUN_00419e82 |
| engine singletons (walker table, decor blob, brick slots) | `src/shell/saveparts.ts` registry; owners call `registerSavePart('walkers' \| 'decor' \| 'bricks', { capture, apply })`: `src/game/walkersave.ts`, `src/island/decor.ts`, `src/fx/bricks/save.ts` | FUN_00462d8b / e75, FUN_00421f56 / f7b, FUN_00447c90 / ca0 |
| file format, checksum, header | `src/shell/save.ts` | FUN_00418e7f, FUN_0041ac8f ... |
| per node save block | `BehaviourNode.saveBlock` / `loadBlock` / `ctor` (`src/game/controller.ts`) in every node class | vtable +0x14 / +0x10 of the node's class |
| shell glue | `src/shell/shell.ts` (`saveSlot`, `loadSlot`, `applyPendingLoad`, `writeDefaultSave`, new game -> `resetDecor`), `src/shell/playzone.ts` (`live.capture` / `restore`), import / export of `.lgo` files on the load / save / erase pages (E / I keys, `SaveStore.importLgo`) | FUN_0041a939, FUN_00419bb9, FUN_0041a8f9 |

## What the original writes and reads (and the port now too)

Writer FUN_00418ec7 (LE2.c line ~11237): header (length, version 0xd, subgame var 0x59, `time()`, FSM node var 0x58, marker), the 304 vars 15..318, the 60 walker structs (0x84 raw bytes each) + 60 record tags, the 0x48 camera
bytes + frame counter, an object record `[tag][clip][frame f32]` for EVERY record that has an animation instance (record +8 != 0), the decor blob (0x380 = 0x1c0 x {set, variant}), then one entity record per record that has a
controller with nodes: `[tag][pos 12][euler 12][flags u16]` followed by, per node of the controller's list in list order, the node's `+8` dword (the frame stamp) and, only when the node class' vtable has a serializer (+0x14), `[size][bytes][0xb0bb00b]`,
then the brick blob (64 slots: 1 byte `0` or a 0x16aa byte image) and the checksum. The reader FUN_00419e82 applies the sections in that order. Quirks the port reproduces (`saveworld.ts`):

* the reader finds a record by the FIRST record with that 4 character tag (FUN_00419a79): records that share a name (z14OSD's GEM7, z23DIP's TRI1 / TRI2 ...) are all restored from the LAST entry of that name;
* a tag without a record, or a record without an animation instance (object records) / without a controller (entity records) goes to FUN_00419b17, which returns 1 for every file (it always finds a marker): the reader answers
  `return 0`: the load STOPS there with the world half restored (`restoreWorld` returns false);
* the reader walks the LIVE node list (which nodes have a block is not in the file): `applyEntitySection` reads the raw entity bytes with the live nodes (`SaveGame.entityBytes`);
* the checksum / size are not checked by the original's loader (only the header: version and the 0x8088008 marker); the port's `loadSlot` / `importLgo` still validate (a damaged file is refused);
* the writer calls the serializer twice for the "-1 protocol" nodes, the loader gets exactly `size` bytes; a record's controller list contains only the nodes the set-up attached by a constructor address (port-only helper nodes
  such as StubGuard have no `ctor` and are neither saved nor loaded).

## Node blocks (constructor address, saver / loader, size)

Every block is a raw byte range of the original node struct; the port keeps the same state in its own fields and assembles / parses the bytes (`saveBlock` / `loadBlock`, only where the original has a serializer / loader). Bytes a
constructor never writes are 0xCD in a real file: the original is a debug build, FUN_00433d38 -> __nh_malloc_dbg fills new blocks with 0xCD, and the ports keep 0xCD in those fields until the game writes them (`src/island/blockio.ts`,
`src/island/npc/cd.ts`, `src/game/heapfill.ts`). Loaders that do more than copy (FUN_005b2a00 / FUN_00420674 decor era table and roster re-read: PepSwitc, Control, the hub PEPPSW nodes; `FUN_00419a79` tag lookups) are ported too.

| ctor | node | saver / loader | bytes | notes |
|---|---|---|---|---|
| 0x42f470 | SGwalk (Pepper's walk, `WalkNode`) | 0x42ef62 / 0x42f20d | 178 | walk state + camera ramps + the globals the loader writes back: mailbox, DAT_008ae330, the vehicle record's tag (DAT_009daa80), kinds, the focus matrix, the accessory's flags |
| 0x88cf13 / 0x88d1f6 | sgswim / swim splash | 0x88cecd / 0x88d1b0 | 8 / 1 | |
| 0x4bbef8 | island PepSwitc | 0x4bbe95 / 0x4bbeba | 16 | loader re-runs FUN_0051c800 (decor table + roster) |
| 0x4333c2 | SGVehic | 0x43337c | 1 | |
| 0x43310c | skateboard | 0x492c61 / 0x492c86 | 156 | |
| 0x430e6c / 0x4325e8 / 0x88fb35 | SGBoat / SGHeli / SGCar | 0x430d81 / 0x4324fd / 0x88faef | 56 / 76 / 76 | boat / heli blocks end in the dock / pad `taken` words (static process memory in the original); SGCar's four cached part pointers (0x3c..0x4b) are heap addresses (compared masked) |
| 0x4bb1a6 / 0x4bb582 | Ptera / Ptera ride | 0x4bb148 / 0x4bb495 | 112 / 8 | |
| 0x42887c / 0x42900b / 0x429d1b | Pizza / hand pizza / carry | 0x428694 / 0x428e15 / 0x429baa | 56 / 28 / 72 | carry's tail is the carrier's record header or the saver's own stack garbage (masked) |
| 0x538126 / 0x5385d3 | speeder / driver | 0x5380c8 / 0x538575 | 44 / 8 | |
| 0x53955e / 0x5399d8 / 0x539d44 | Footy ball / flower / loon | 0x5394fd / 0x53997a / 0x539ce6 | 132 / 8 / 12 | |
| 0x53c337 / 0x53d66c | SUPE / train | 0x53c2d9 / 0x53d4ca | 44 / 44 | the train's block carries two process globals (speed factor, look right) |
| 0x426151 | SGMFIG (every talking NPC) | 0x42610b / 0x426129 | 60 | node +0x30..0x6c |
| 0x4bec00 / 0x4bf329 | Human1 / launch | 0x4beb35 / 0x4bf2cb | 16 / 4 | |
| 0x52ff39 / 0x5306e5 / 0x5308f3 / 0x530d69 | Turn2Pep A / B / C, MeetPepp | 0x52fedb / 0x530687 / 0x530895 / 0x530d0b | 16 / 12 / 4 / 4 | |
| 0x531d45 / 0x5327b1 / 0x532acc / 0x533ba8 / 0x53de63 | BrickBot follow / hit / harass / hide, botPConly | 0x531bbd / 0x532727 / 0x532a6e / 0x533b4a / 0x53de05 | 168 / 20 / 4 / 32 / 12 | BotFollow's leader pointer is re-resolved from its tag by the loader |
| 0x536e16 / 0x536961 | BOTMUSIC / GETO | 0x536db8 / 0x536903 | 68 / 16 | |
| 0x51e19c / 0x51ea3c | StartCSM / portal | 0x51e13e / 0x51e9de | 8 / 8 | |
| 0x535281 / 0x5357cb / 0x535e80 / 0x5364a5 / 0x534b89 | page / music house / door / swinging part / pop-in node | 0x53519a / 0x53576d / 0x535e22 / 0x536447 / 0x534a0a | 8 / 4 / 8 / 8 / 72 | the pop-in node (0x534b89) was not ported before |
| 0x88df51 | hOLO | 0x88df0b | 68 | |
| 0x4bc773 / 0x4bd4a8 / 0x4bdbb2 / 0x4b1212 / 0x538779 | Music / Brikimal / Spin / SeaAmin / Sound3d | 0x4bc715 / 0x4bd44a / 0x4bdb54 / 0x4b11b4 / 0x53871b | 52 / 88 / 4 / 12 / 24 | |
| 0x4b2149 / 0x4b2d44 / 0x4b31db / 0x4b3a92 / 0x4b4000 | Bunny / Butterfly / Swift leader / Swift / Gull | 0x4b20eb / 0x4b2bc5 / 0x4b317d / 0x4b3a34 / 0x4b3fa2 | 28 / 44 / 80 / 16 / 8 | |
| 0x4266ca / 0x426da4 / 0x426915 / 0x426f55 | seabed SEAB / SSEA / SSKY / seabed.c | 0x426684 / 0x426d5e / 0x4268cf / 0x426f0f | 4 / 16 / 4 / 1 | SEAB / SSEA / SSKY were not ported before (`src/island/ambient/seabed.ts`, they own the sea / sky state) |
| 0x4b8c73, 0x575b44 | LGI_FSM, CSIFSM | none | | no serializer |
| z07CSI | Rattus 0x5763ca / goblet 0x5766fb / Horse 0x579178 / rider 0x579725 / saddle 0x579948 / Control 0x57a579 | 0x57636c / 0x57669d / 0x57900b / 0x5796c7 / 0x5798ea / 0x57a516 | 20 / 4 / 72 / 1 / 1 / 12 | |
| z13CAI | pepswitc 0x61c2a4 | 0x61c241 | 1 | |
| z14OSD / z16PYA / z23DIP | Tumblewd 0x629d7e, scorpion 0x62ad35 / 0x62af8d, Gems 0x62b220, PEPPSW 0x62ba3b / 0x677350 / 0x727e84 | 0x629d20 / 0x62acd7 / 0x62af2f / 0x62b1c2 / 0x62b9d8 / 0x6772ed / 0x727e21 | 20 / 12 / 4 / 4 / 32 / 32 / 24 | |
| z40OGL | Overlay 0x7e31fc, PeppSwit family 0x7e4f9c / 0x7e539e / 0x7e5ea7 / 0x7e61e9 / 0x7e6498 / 0x7e69a2 | 0x7e319e / 0x7e4e72 / 0x7e5340 / 0x7e5e49 / 0x7e618b / 0x7e643a / 0x7e6944 | 4 / 16 / 12 / 16 / 1 / 1 / 12 | |

Exact layouts (offset: field) are in the doc comments of the `saveBlock` methods.

## The other sections

* **walker table** (`src/game/walkersave.ts`): 0x1ef0 raw bytes of the 60 static walker structs + 60 tags; the loader FUN_00462e75 (links cleared, record pointers rebuilt from tags / names, dead walkers dropped, re-registration in slot order,
  FUN_00463f9d). The table is static process memory: a freed walker stays (the port's `waypoints.slots` keeps stale walkers across zones like the original does); pointer words use the oracle's convention (record i = 0x10000000 + i * 0x68).
* **object records**: every record with an animation instance (clip, frame as float32); restored with FUN_0043b6a3 semantics (a clip outside the rig / a frame outside the clip is refused).
* **camera, frame counter**: the 18 floats of `world.camera.c`, `world.frame`.
* **decor blob** (`src/island/decor.ts`, `decorStore`): a process global (0x380 bytes, BSS), the stored decor of the game: copied from the exe's defaults once per process by the zone set-ups (FUN_00420837, `ensureDefaults`), reset at a
  new game (FUN_00421fa0(1) = `resetDecor`, called by the shell), refreshed from the live records of the current decor group (FUN_00421eb3: zones 2 / 0x1f / 0x20 / 0x21 -> group 0, 6 -> 1, 0xb -> 2, 0xd -> 3, 0x13 -> 4, 0x1b -> 5) when
  a save is written, replaced by a load and applied to the records (FUN_00421bbe). Port-only safety (WP-DECOR): `decorStore.startProcess` (the shell's constructor) gives a process that is entered without a new game / load (`?zone=`, `?save=`) the defaults instead of the BSS zeros, and `repairDecorBlob` replaces a decor group that is all `{0,0}` on load (older port builds wrote zero sections: every entry = set 0 variant 0 = the pine tree; the original cannot write that) by the defaults of that group; `importLgo` warns in Dutch. Tests: `m8-save-decor-life` (random sequences vs the original), `tools/steps/m8-save-decor.mjs` (browser). The records' variant words (+0x64: `set << 8 | 1 | variant << 16`) are the other half of that state (hub rosters set them like the original's constructors).
* **bricks** (`src/fx/bricks/save.ts`): the 64 FX_Bricks slot images (0x16aa bytes: flag, record tag, 16 stage callback ids, state, variable, 16 stage parameter blocks, stage, wait, 16 model descriptors incl. the model file path); the loader FUN_00449be0
  rebuilds the slots (models from the files, the running morph is advanced to its saved time).

## Oracle and tests (all run natively against the original's code in the x86 emulation)

* `tools/lib/m8-save.mjs`: `buildIslandOracle(ctx, node)` / `buildHubOracle(ctx, zone)` run EVERY constructor of the zone's set-up natively (FUN_00423532) on a machine whose heap is 0xCD-filled, then the port's real set-up work
  (`islandWorldSetup` in src/zones/z02LGI/index.ts, the hub's registered `afterSetup` hook); `nativeNodes`, `origBlock`, `origLoad`, `compareBlocks`, `snapshotBlocks` / `restoreBlocks`, `installAnimTokens`, `maskRanges`.
* `tools/lib/m8-save-world.mjs`: the original's whole writer FUN_00418ec7, header reader FUN_00419c45 and body reader FUN_00419e82 natively (file calls hosted).
* `m8-save-nodes` (81 constructors, island eras 0..4 + six hubs: constructor sequences, serializer / loader presence, `+8` words, block bytes), `m8-save-world` (the whole file section by section, record headers, variant words, walker table,
  object records, decor), `m8-save-roundtrip` (the port plays N ticks, writes the file, the ORIGINAL's reader loads it, the original's writer must write the same file), `m8-save-original-to-port` (the original plays N ticks natively, writes
  its file, a second port world loads it with `restoreWorld`, saves again: every section equal), `m8-save-fe` (SaveDef.lgo), the per family tests `m8-save-walk`, `-pepper-zones`, `-vehicles`, `-pizza`, `-npc`, `-npc-long`, `-npc-music`, `-csi`,
  `-hubs`, `-hubs-play`, `-pyadip`, `-z40`, `-popin`, `-seabed`, `-walkers`, `-bricks`, `-decor`: the existing gameplay duels (tools/tests/m7-isl-*, m5-*) call `compareBlocks` every tick and put blocks the original produced earlier
  back into both machines (original loader natively, port `loadBlock`) every few dozen ticks while the duel goes on at tolerance 0; the browser run `tools/steps/m8-save.mjs`.

## V2: the story snapshot array

`StoryFsm.snap` (DAT_00983854[node], the per node variable snapshot of FUN_00404bb2 / FUN_00404b43) is not part of the file and is neither saved nor reset by loads / new games in the original. Decision: kept as it is, a conscious faithful quirk
("a rewind after loading a save restores whatever the array holds"): `loadSlot`, new game and the front end do not touch it.

## Not exact (and why)

* process addresses inside the file cannot be reproduced bit for bit: SGCar's four cached part-matrix pointers, the carry node's stack garbage, the walker table's record pointers (written in the oracle's convention, rebuilt from tags
  by every loader) and the brick descriptors' install path (the original stores the absolute path of the exe's `_Data` folder: the port writes the installer's default `C:\Program Files\LEGO Media\LEGO Eiland 2\_Data\`,
  `setBrickDataRoot` changes it; the port reads any root);
* the frame counter and node stamps are the port's own counter (the original's is a process global that runs on across zones): consistent inside a file, not comparable across processes;
* dock / pad `taken` words (see the vehicles' notes) and the walker table keep stale data across zones like the original's static memory;
* the music building keys the port never loads are 0xCDCDCDCD handles in the original (it calls the engine with them); the port plays nothing;

## The front end's SaveDef.lgo (WP-SAVE F4)

The front end's loop FUN_00470ac3 calls FUN_0041ad71 -> FUN_00418ec7(0xfffffffe) after FUN_0047172c (stage set-up), FUN_0042207d(record 0) and FUN_00471bfa (credits text), before its first loop pass: the file `_data//SaveDef.lgo`,
written from the live state of the stage (z00FRE / archive z60FRE). Nothing reads it (FUN_00419bb9 only gets the slots 0 .. 6). The port: `runFrontEnd` (src/shell/frontend.ts) calls `Shell.writeDefaultSave(world)` at the same place
(`captureWorld` + `encodeSave` into `SaveStore` as `slotFileName(-2)`; a failure is only a console warning), then refreshes the camera's view basis (the loop's own FUN_00470a73 does that in the original).

The stage's nodes (`ctor` = the original constructor, serializer / loader = vtable +0x14 / +0x10, both a plain memcpy of a field range of the node block):

| record | ctor | node | saver / loader | block |
|---|---|---|---|---|
| 0 PEPP | 0x472743 | FePepperNode | 0x4726fd / 0x47271b | 0x18 bytes at node +0x24: i32 flag, i32 dir, i32 counter, f32 timer, i32 gag, i32 gagLeft |
| 8 BBT1 | 0x4729f6 | FeFigureNode | 0x4729b0 / 0x4729ce | 8 bytes at +0x18: f32 fl, i32 cnt |
| 44 G002 | 0x472c45 | FeTrainNode | 0x472bff / 0x472c1d | 0xc bytes at +0x18: f32 fl, i32 cnt, i32 phase |
| 2 BRIK | 0x472fd8 | FeBricksterNode | 0x472f92 / 0x472fb0 | 0xc bytes at +0x18: f32 fl, i32 cnt, i32 sel |
| 35 .. 41 BFS6 .. BFS0 | 0x4b2d44 | ButterflyNode | 0x4b2bc5 / 0x4b2c9b | 0x2c bytes (the island's block, src/island/ambient/animals.ts) |

Every byte of those ranges is written by the constructors (no 0xCD in the file). The other sections: variables (the only variable writes of the front end's start are FUN_00444850's var 0xc6 = 0 / var 0xc5 = 4: `feStartVars`),
walker table (the front end loads no walk maps: FUN_004614d5 returns 0, no walker; `feStartWalker` is FUN_0042207d's call and gives one when a map is loaded), camera (FUN_00422b50 on Pepper's matrix after his constructor, then the
stage's eye / target stored over the first six floats: the basis floats c[9..17] keep the Pepper camera's), frame counter 0, object records (FUN_0047ec85's clip 1 frame 0 instances of records 0 .. 21, then the constructors' clips),
decor blob (process global; var 0x59 = 0 has no decor group), bricks (none).

Oracle: `tools/lib/m8-save-fe.mjs` (the original's FUN_00444850, FUN_00471070 with its constructors, FUN_0042207d, writer and reader natively in the emulator; engine hosted) and `tools/tests/m8-save-fe.mjs`:

    M8_FE_SEEDS=12345,7,2026 M8_FE_TICKS=1500 node tools/test-formats.mjs --only m8-save-fe -v

## Load path validation and SaveDef.lgo gate

The original's load (FUN_00419bb9 -> FUN_00419c45 header, FUN_00419e82 body) never calls FUN_0041ac8f; only the writer calls it, on its own output, ignoring the result. The port's `decodeSave` therefore
checks only what the reader itself needs (size 0x51c8c, length field, version marker, header and section markers) and NOT the closing marker or the checksum (`decodeSave(b, {strict: true})` = FUN_0041ac8f, for tests).
An import of a file with a wrong checksum / closing marker loads and shows a Dutch warning (`saveWarnings`).
FUN_0045c432 (the gate of writer and header reader) is not windowed / debug mode: it is true while DAT_05d47908 == 1 (the replay / demo-playback state set in FUN_00458...) or DAT_05d4dc8c != 0. Outside that state the
original writes SaveDef.lgo in normal play, so the port writes it unconditionally (it has no replay state); it is not tied to the debug option.
