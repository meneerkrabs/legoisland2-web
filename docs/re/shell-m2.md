# Game shell logic, milestone M2 (`src/shell/{tables,story,save,savestore,options}.ts`)

Pure logic (no DOM except the IndexedDB backend), tested in node: `node tools/test-formats.mjs --only shell-tables,shell-story,shell-save`.
Everything EXE-derived is read at run time from `LEGO eiland 2.exe` (`Pe`); only the layouts and addresses are in the source. Addresses are VAs (image base 0x400000).

## 1. Address map resolved in this pass

| address | what |
|---|---|
| 0x89a9c0 | zone table, 35 x 20 bytes `{run fn, kind, char name[8], 0}` |
| 0x89a758 | story FSM, 72 x 8 bytes `{s16 zone, s16 var, s16 mask, s16 value}` (the compare in `FUN_00404aa0` sign-extends; the only masks are 0x7fff, 2 (node 30) and 1 (node 34)) |
| 0x983854 | per-node snapshot array `int[...]` (BSS, `FUN_00404bb2/b43/af6/c07`) |
| 0x8a2d2c | the 319 game vars; **.data holds the initial values** (non-zero: var 0 = 1, 2 = 1, 9 = 1, 84/85/87 = 1 (`BLDG_RESQ/SHP1/SPACE`), 119 = 3600 `DSP_BESTTIME`) |
| **0x8a95f4** | a **pointer cell** (`PTR_DAT_008a95f4`) whose content is **0x8a9338**. **0x8a9338 is the menu page table itself** (30 x 20 bytes `{kind, nitems, items*, setupfn, type}`, ends at 0x8a9590 = the engine's "current page" global; 0x8a9594 = current item, 0x8a95a8 = scroll offset). Items are 0x4c bytes: label[0x40] (`!ID` = message id), +0x40 type, +0x44 id (for toggles/sliders it is the *current value*, initialised from the options through `*(PTR_DAT_008a95f4 + page*0x14 + 8) + item*0x4c + 0x44`, code near line 13089 of LE2.c, and read back by `FUN_0041b500` case 5/6), +0x48 disable mask (0x20 greyed, 0x40/0x80 pause hide masks). So both addresses in the notes were right, they are the cell and its target. |
| 0x8a5448 | save-slot captions: 71 strings of 12 bytes `FSMSTATEnn`, **indexed by the FSM node** (not by nn): node 0..3 -> `FSMSTATE02`, node 4 -> 03, ..., node 70 -> 65. Node 71 would read into the `SaveDef.lgo` string. Text = `FRONTEND.str` lookup (`FUN_00439788`). Empty slot caption `<-------->` (0x8a57d0). |
| 0x8a57f0 | **replay list of the Pepper's-house computer** (page 24, setup `FUN_0041b12d`), 19 x 0x30 `{label[0x20], zone, mask, gate var, node}`; node is -1 for all 19. Start (`FUN_0041b9b1` case 0x18): var 5 = zone, var 0xb `STARTEDFROMMENU` = 1, var 0x4d = packed menu state, (node >= 0 would `FUN_00404c07(node)` + var 0x120 = 3). Enabled when `var[gate] != 0`; entry 0 (BPK) also when node < 7 or > 0x33; entry 1 (IFC, gate -1) only when node < 7 or > 10. |
| 0x8a5c68 | "story checkpoint" list (page 17, `FUN_0041b227`), 36 x 0x2c `{label[0x20], zone, mask, node}`. **0x8a5c88 of the earlier notes = the zone field of its record 0.** Page 17 is not the target of any goto item and its `Test` action (id 0) just resumes: debug leftover. |
| 0x8a62c8 | "all zones" list (page 26, `FUN_0041b274`), 25 x 0x2c, node always -1, mask 32. **0x8a62e8 = the zone field of its record 0 + 0x20.** Only reachable from the alternative main menu page 25 (never opened). |
| 0x8a5bb0 / 0x8a5c64 | sound test (page 23, `FUN_0041b0d2`): 22 pairs of `char*` {music key `Z01BPK`.., label id `LEVBPK`..}, count at 0x8a5c64 |
| 0x8acdc0 / 0x8acdf0 | decor tables: 6 groups `{first, count}` (zones 2/0x1f/0x20/0x21 island, 6 castle, 0xb oasis, 0xd pyramid, 0x13 dino island, 0x1b Ogel; selected by `FUN_00421b18` from var 0x59), 0x1c0 entries of 8 bytes `{record index, u8 set, u8 variant, ...}`; defaults for a new game (`FUN_00421fa0(1)`) are the (set, variant) bytes |
| 0x9833f0 | `Settings.set` in memory (23 dwords, accessor `FUN_004040ec`) |
| 0x987e80 | the 0x51c8c byte save buffer; 0x987e24 + slot*0xc = per-slot cache `{subgame (-1 = empty), time, fsm}` filled by `FUN_0041a9bf` (invalidated by `DAT_009d9c1a = 0` after save / erase) |
| 0x9d9c10 / 0x9d9c18 / 0x9d9c19 | pending "go to" override: node (s16), zone (u8), kind (0 none, 1 load a save, 2 new game) |

Menu item types seen: 0 title, 1 goto page (id = page), 2 back, 3 confirm entry, 4 action (id = action), 5 toggle, 6 slider, 7 key binding, 9 list item, 10 text. Pages with `kind == 1` (13, 14, 17, 23, 24, 26, 28) are dynamic: item 1 is a template and the page's setup function (`type` field is the page style: 0 plain, 1 list, 2 dialog) is called with item index until it returns < 0. Setup functions of the other pages only patch disable masks / captions (`0x41ae6e` and `0x41aef3` fill the slot captions of pages 2/3/8 and 7, `0x41b2fd` disables "Huis van Pepper" below node 4, `0x41b2c1` disables the speech volume slider when speech is off, `0x41afbc` greys the detail option).
Menu actions (`FUN_0041b500` case 4): 1 = quit to menu (-3), 0xf = restart (-2), 0x11 = var 5 = 3 / `STARTEDFROMMENU` = 0 (Pepper's house), 3..9 = **new game** (slot `id - 0x14` = -17..-11, bogus so it never writes), 0x14..0x1a = load slot 0..6 (`FUN_00419bb9`), 0x1e..0x24 = save (`FUN_0041a939`), 0x28..0x2e = erase (`FUN_0041a968`: removes the file, invalidates the caption cache).

## 2. Story FSM and zone loop (`story.ts`)

Ported 1:1: `StoryFsm.complete` (`FUN_00404aa0`), `zoneOf` (`be7`), `advance` (`bb2`: node+1, snapshot of the *new* node's var), `rewind` (`b43`: previous node whose zone has kind 1, restores that node's var from its snapshot, **does not touch var 5**), `stepBack` (`af6`), `jump` (`c07`: forward forces the **unmasked s16 value** into GME/MS vars only (classes 0xf / 0xeb from `FUN_004176c1`, so neither NS vars nor zone-local vars) and snapshots them; backward restores snapshots; then var 0x58 = n and var 5 = zone of n), `frame` (`FUN_00423bad`: 6 only when the node completes *and* its successor has another zone), `miniGameExit(completed, success)` (`FUN_00404d14`), `eraOfNode` (`FUN_004b6475`).
`ZoneLoopState` = `FUN_00404dc9`: `begin()` = sw.dat snapshot + `FUN_0041786a` defaults; `afterZone(returned)` returns the next zone to run (< 0 = quit): `-1` -> zone 0 + node 0, then the pending override (`FUN_0041ad43`, **wins even over a quit**), `PREV_SUBGAME` = zone just run, `CURRENT_SUBGAME` = next; entering a zone clears vars 0xfa..0x13e (`FUN_004177ed`), sets var 5 = zone, var 0x63 = 0, var 0x53 = 0; zones without code (22, 23) advance the FSM and continue. `loadDone()` = `FUN_0041adb5`. `newGame()` = `FUN_0041a8f9` + `FUN_0041786a` + var 5 = 2. `beginLoad(subgame, fsm)` = `FUN_00419bb9` (1 = restore in place, 2 = leave the zone).

Findings:
* `sw.dat` (vars 15..234, 220 dwords) is written at launch from the live (= .data) array and read straight back, so the "new game" defaults are: vars 15..234 = their launch values, then `NUM_BRICKS` (0x4f) = `NUM_PIZZAS` (0xb0) = 11, `PEPPHOUSE_SIZE` (0xb3) = `MOVE_PIZ3` (0xb4) = 0, `MOVE_CNST` (0xb5) = 1, `PAGES_SET` (0x26) = 0. Vars < 15, >= 235 are not reset by a new game (zone-local ones are cleared on every zone start anyway).
* The snapshot array is **not saved** and not reset by a new game or a load. A rewind after loading a save therefore restores whatever (usually 0) was in `DAT_00983854[node]`: e.g. aborting WAB after loading into node 9 sets var 5 to 0, which makes the island loop see `var5 != var59` and return zone 0. Ported as is (`StoryFsm.snap` is plain state); the lead may want to guard this.
* Node 56 (`COLORED_BOTHEADS == 15`) is already complete on entry (the var stays 15 from node 8): the story advances through it on the next frame.
* `FUN_00404dc9` also copies `DAT_0089df28` to `DAT_0089df2c` before each zone run (a frame/timer snapshot, not ported).

## 3. Save game (`save.ts`)

Fixed **0x51c8c** bytes (buffer memset to 0, whole buffer fwritten, `FUN_00418ec7`), but the content is variable length with `length` (dword 0) = bytes in use; the rest stays zero and is ignored on read.
Names: `_data//Save%02d.lgo` (slot 0..6), `_data//SaveDef.lgo` (slot -2). Little endian:

| offset | content |
|---|---|
| 0x00 | u32 length (incl. the last marker) |
| 0x04 | u32 version 0xd |
| 0x08 / 0x0c / 0x10 | u32 CURRENT_SUBGAME (var 0x59) / `time()` / FSM node (var 0x58) |
| 0x14 | marker 0x8088008 |
| 0x18 | vars 15..318, 304 x i32 = 0x4c0 (`FUN_00417908` / `FUN_0041792f`) |
| 0x4d8 | marker 0xf0ff00f |
| 0x4dc | walker blob (`FUN_00462d8b`, loader `FUN_00462e75`): 0x3c waypoint walkers x 0x84 raw bytes (0x1ef0, from DAT_05d4e1b0; word 0 = active, +0x14 = record pointer) then 0x3c u32 = the 4 char tag of the record each walker is attached to (pointer translated back by `FUN_00419a79`); total 0x1fe0 |
| 0x24bc | marker 0xe0ee00e |
| 0x24c0 | 0x48 camera bytes (DAT_009da5e8) + u32 frame counter (DAT_009da5cc) (0x2508) |
| 0x250c | marker 0xa0aa00a |
| 0x2510 | object records until marker 0x9099009: `[tag][anim state][anim float][0xd0dd00d]` (16 bytes) for every record whose +8 (animation instance) != 0: tag = first dword of the 0x68 record (its name), state = instance +0xc (`FUN_0043b72b`), float = instance +0x10 (`FUN_0043b73f`), restored with `FUN_0043b6a3`. Records not found by tag or without an instance are skipped up to the next marker (`FUN_00419b17`). |
| then | u32 0x380 + decor blob 0x380 = 0x1c0 x {set, variant} bytes (`FUN_00421f56`, refreshed from the live records by `FUN_00421eb3` first, applied by `FUN_00421bbe`), marker 0x6066006 |
| then | entity records until marker 0x7077007, for each record with a controller that has nodes: `[tag u32][record +0x3c: 12 bytes pos][+0x4c: 12 bytes euler][+0x60 u16 flags]`, then for each behaviour node `[node +8 state u32]` and, only if the node type has a serializer (vtable +0x14 / loader +0x10): `[size u32][size bytes][0xb0bb00b]`; finally `[0xd0dd00d]`. The reader walks the *live* node list, so which nodes have blobs is not in the file; `save.ts` recovers it by checking that `[size][data]` is followed by 0xb0bb00b (falls back to keeping the section raw, `entitiesRaw`, if that fails). |
| then | marker 0x7077007 **precedes** the brick part: the entity loop ends when it reads 0x7077007 as a tag; then u32 size + brick blob (`FUN_00449a10` / `FUN_00449be0`: 64 brick slots, each 1 byte `0` or a 0x16aa byte image: +0 flag, +1 tag, +5 16 function-id bytes, +0x1a game var index, +0x23 64 bytes, +0x64 0x600 bytes, +0x664/0x665/0x669 bytes/dword, +0x66a 0x1040 bytes), marker 0x7077007 |
| end | marker 0xc0cc00c, u32 checksum, marker 0xc0cc00c |

Checksum (`FUN_00418e7f(L)` with L = offset of the checksum dword = length - 8): xor of the dwords at offsets 8, 12, ... while `i < L - 4`. Entity records make L unaligned (30 + ...), so the walk is byte offset based. Validation (`FUN_0041ac8f`): version 0xd, dword at length-4 = 0xc0cc00c, checksum at length-8. The load menu captions use only the header (`FUN_0041aa2e`: version + marker 0x8088008, no checksum). `FUN_00419bb9`: same node and subgame -> restore in place, else pending override.
There is no real save file on disk to compare with. The layout above is complete in the sense that every read/write in the writer and reader was accounted for; what is *interpreted* (field names inside entity records, brick slots, walker structs) is partial, those parts are carried as raw bytes.

API notes: `newSaveFromGame` fills what the port cannot produce with zeros / empty sections: walkers and camera zero, no objects, no entities, 64 empty brick slots, decor zero (pass `defaultDecor(pe)` for the original defaults). Such a file is valid for the original checksum, but loading it in the real game would need walkers/camera/decor to be plausible.

## 4. Options (`options.ts`)

`Settings.set` = 23 little-endian int32, 92 bytes. Defaults are the immediates of `FUN_00403e30` (`push idx; call 0x4040ec; mov [reg], imm`), scanned at run time (`readOptionDefaults`, with the same values as built-in fallback): 0, 1, 0x16 = 80; 2, 3 = 1; 4..0x10 = (1 << 16) | DIK = 0x100c8 up, 0x100d0 down, 0x100cb left, 0x100cd right, 0x1001d ctrl, 0x10038 alt, 0x1002a shift, 0x10039 space, 0x10056 `<>`, 0x1002c Z, 0x1002d X, 0x1002e C, 0x1001c enter; 0x11 = 0x10053 (Del); 0x12 = 1; 0x13 = 1; 0x14 = 0x2d (45); 0x15 = 0x32 (50). Speech/subtitles (`FUN_0041b500` case 5, page 12): turning one off while the other is off forces the other on; var 9 = speech, var 0 = subtitles. Sliders write: page 9 item 3 -> [0x14], page 10 item 1 -> [0x15] (`FUN_00409792`), page 11 items 1/2/3 -> [0]/[1]/[0x16]. Clamping to 0..100 is our choice (slider range not verified). A short file leaves the remaining settings unchanged (`fread(buf, 4, 0x17)`).

## 5. Storage (`savestore.ts`)

`StorageBackend` (async `get/put/delete/list` of named byte blobs). `IdbBackend`: IndexedDB `le2-saves`, store `blobs`, opened lazily; any failure switches to the in-memory fallback (`degraded = true`). Keys are the original names: `Save00.lgo`..`Save06.lgo`, `SaveDef.lgo`, `Settings.set`. `SaveStore.slotInfo` reads only the header; `importLgo` validates the checksum and parses the whole file (files of the original game are accepted if they follow the layout above).
