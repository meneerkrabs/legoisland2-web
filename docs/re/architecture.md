# LEGO Island 2 / LEGO Eiland 2 - architecture of the executable

Reverse engineering notes on the overall structure of `LEGO eiland 2.exe` (Dutch release of "LEGO Island 2: The Brickster's Revenge",
Silicon Dreams / LEGO Media 2001; PE32, image base 0x400000, 6,459,444 bytes), written to guide the engine and per-zone work of the
browser port. The file formats are in [formats.md](formats.md); this document is about **code**: start-up, main loop, modes, zones,
the object model, scripts, game state, input/HUD/text, and a porting plan.

Contents

0. Method, conventions, address map
1. Program start, main loop, timing, shutdown
2. Modes and the top-level state machine
3. Zones (table of all zones, load/unload, per-zone code, transitions)
4. Game object model
5. Scripts and cutscenes
6. Global game state, progression, save game, options
7. Input, HUD, fonts, text, localisation
8. Porting plan
9. Open questions
10. Appendix: tools and data tables inside the EXE

Confidence words: **verified** = read in the decompile by the author of this document; **analysed** = established by a focused analysis pass
over that area and spot-checked; **UNCERTAIN** = a guess or not resolved. Every address is a virtual address in this build (NL retail
EXE); function names are the Ghidra names `FUN_xxxxxxxx` (the address is the name). Variable names (`DAT_xxxxxxxx`) are Ghidra's.

---------------------------------------------------------------------------------------------------------------------------

## 0. Method, conventions, address map

### 0.1 What the build is (verified)

* **Debug-style build**: no optimisation, every function has an `ebp` frame, locals are pre-filled with `0xcccccccc` (the `for (iVar != 0) *p = 0xcccccccc` loops at the top of
  functions in the decompile), `__chkesp` (`FUN_0085abc0`) is called after calls, `swi(3)` = `int 3` after a failed assert. Assert strings carry the source path
  `C:\projects\LegoIsland2\<module>\c_src\<file>`; 301 such path strings exist (`tools/sourcepaths.txt`). That is what makes the code attributable to source files
  (`atlas.md` / `atlas.json`: 554 of 5140 functions reference a source name; neighbours inherit by address order).
* **Libraries linked in** (imports): `DDRAW` (`DirectDrawCreateEx`, `DirectDrawEnumerateExA`; the renderer is **DirectDraw 7 + Direct3D 7**: `IDirect3D7` is obtained
  with `QueryInterface`, GUID at 0x895cac, HAL (0x895bfc) and RGB (0x895c3c) device GUIDs), `DINPUT8`, `mss32.dll` (**Miles Sound System 6**, 73 imports), `ole32`
  (`CoCreateInstance`: **DirectMusic** and the DirectShow movie player), `USER32/GDI32/KERNEL32`, `COMCTL32`. No `winmm`/`dsound`/`d3d8` import
  (`DX8Movie` in a path name is just the movie module's name).
* **Source tree** (module directories from the asserts): `ms\Main` (PCSetup, shutdown), `ms\Sdlib` (SDMem2, SDFile, SDPad, SDText, SDAnim, SDSplit, SDError, SD2d, PCDBG_File),
  `ms\Graphics` (SDMode, SDEnum, Material2, TextureManager, TextureBlock, NewFont, SDGLIB_Interface, ModelIni, ModelMess, Faces, Carve, Lights, Effects),
  `ms\GSMS` (GSMS_MI, GSMS_TXT, Collision, SwapText, SplineBase, Track, F_CurveMgr), `ms\Sound` (SoundClass, DirectMusic), `ms\DX8Movie` (MSFMV), `ms\AIT2BIN` (AIT2BFile),
  `ms\FX_Particles` (CParticle*), `ms\FX_Bricks` (Bricks, TBrick, TBrickModel, BrickRead, BrickFX_Manager), `Common\SGGen` (SGGen, SGPauseM, SGwalk, SGBoat, SGHeli, SGCar, SGVehic, SGMFIG,
  sgswim, seabed, Pizza, hOLO), `Common\CSM` (Convert, Loader, Manager, TDict), `Common\WayPt` (Load), `Common\HUD` (DrawHUD) and `Common\<zone>\c_src` (per zone).
  "SG" most likely = *sub-game* (game vars `CURRENT_SUBGAME`/`NEXT_SUBGAME`/`SUBGAME:n`, directory `SGGen`, message ids like `LESGPT01`; formats.md 8.3 reads the `SG` in ids as "speech/game"; UNCERTAIN).

### 0.2 Address map (analysed, from `tools/zonemap.py` and the atlas)

| range | content | functions / decompiled lines |
|---|---|---|
| 0x401000-0x407170 | WinMain, window, PCSetup (dead), settings, shutdown list (`ms\Main`) | 52 / 1.8k |
| 0x407170-0x41b366 | graphics core: display enumeration (SDEnum), Material2 (render-state presets), SDMode (device), frame begin/end, TextureManager, NewFont, TextureBlock | 265 / 9.3k |
| 0x417575-0x417b00 | global game-variable array, `sw.dat`, switch-name registration (inside the graphics address range) | 16 / 0.5k |
| 0x41b366-0x433af5 | `Common\SGGen`: menus (SGPauseM), object framework (update/prerender/draw passes at 0x422xxx), controllers/behaviour nodes (0x4237xx), SGwalk (Pepper walking), SGBoat, SGHeli, Pizza, seabed, generic NPC/talk node (0x425xxx-0x426xxx) | 246 / 12.2k |
| 0x433af5-0x43e870 | `ms\Sdlib`: SDMem2, PCDBG_File/SDFile (archives, files), SDPad (input), SDText (tag files), SDAnim, SDSplit, SDError, SD2d | 404 / 8.1k |
| 0x43e870-0x449920 | `ms\GSMS`: models (GSMS_MI), collision, swap-textures, splines (.man), the draw/LOD code (0x4440xx-0x4446xx) | 207 / 5.9k |
| 0x449920-0x44e860 | `ms\FX_Bricks` | 69 / 3.4k |
| 0x44e860-0x458a4c | `ms\FX_Particles` | 140 / 6.8k |
| 0x458a4c-0x45f9d2 | `Common\CSM` (cutscene manager/loader/compiler/dictionary) | 100 / 3.4k |
| 0x45f9d2-0x4630c0 | `Common\HUD` (DrawHUD) and the waypoint **walker** (0x461xxx-0x462xxx) | 80 / 1.7k |
| 0x4630c0-0x465d39 | `Common\WayPt\Load.c` (waypoint maps) | 40 / 1.4k |
| 0x465d39-0x858d30 | **30 zone code regions** (one compiled copy of the zone code template each) | 2,568 / 208k |
| 0x48c7b0-0x48d8bd | movie player MSFMV (sits between z60FRE and z01BPK) | 23 / 0.6k |
| 0x858d30-0x873e00 | MSVC C runtime (debug CRT: dbgheap, stdio, printf, ...) | ~460 / 18k |
| 0x873e00-0x87d248 | `ms\Sound`: Miles SoundClass, DirectMusic | 132 / 3.6k |
| 0x87d248-0x891500 | AIT2BFile, SDGLIB_Interface, Faces, Carve, ModelMess, Lights, Effects, ModelIni (the model/draw library), plus SGGen leftovers (sgswim, hOLO, SGCar) | ~290 / 10.8k |
| 0x892000-0x89a000 | `.rdata`: constants, GUIDs, vtables, **zone table 0x89a9c0**, story FSM 0x89a758, key table 0x8aeb20, menu pages 0x8a9338, music table 0x97fcb8, sound table ~0x969f80, speech table 0x979098 | |
| 0x89a000-0x5df1000 | `.data`: globals; 89 MB virtual, mostly zero-filled zone-local arrays | |

Totals (all 5,140 functions): about 4,200 game functions / 267k decompiled lines, of which the 30 zone regions are 208k lines. **About 3.2 MB of the
zone code bytes are the straight-line loader and builder functions** (tables), only ~0.95 MB is gameplay logic (about 103k decompiled lines, of which
z02LGI 21k): region sizes of `tools/zonemap.py` minus the sizes of the loader and builder functions (3.1).

---------------------------------------------------------------------------------------------------------------------------

## 1. Program start, main loop, timing, shutdown

### 1.1 Order of events (WinMain = `FUN_00402c8e`; entry `0x85bef0` -> CRT -> `FUN_00402c8e`) - verified, with details analysed

**Init order in one line**: CRT static init (Miles `AIL_startup`) -> mutex/cmdline -> `messages.bob` -> window + `CoInitialize` -> `Settings.set` -> 8 shared archives -> **DirectDraw7/Direct3D7** (enumerate, exclusive full-screen device) -> **DirectInput8** -> start-up movies (**DirectShow**) -> **Miles open** (3D provider, **DirectMusic** created on Miles' DirectSound) -> zone loop.

1. **Before WinMain** (CRT static initialisers): `FUN_00443160` constructs the sound object (`FUN_00874195`): `AIL_set_redist_directory("redist\WIN32")`, `AIL_startup`,
   output format 22,050 Hz 16-bit stereo (analysed).
2. **Command line** (`FUN_00438622`): only `/nomutex` is acted on in WinMain; otherwise a named mutex `"Lego Media 2001"` is created and the process exits if it already exists
   (`GetLastError == 0xb7`). `/safe` is parsed in `FUN_00402990` (string at 0x89a214) but the flag that would act on it is never set: the dead path only affects the windowed
   branch (`FUN_0040a43f`). There are **no other switches** (strings checked) apart from keyboard cheat codes (section 7.1).
3. **Working directory variable** `DAT_009836f8` = directory of the EXE (+ `_Data`); all game paths are built relative to it (`FUN_00402c8e`, `_strrchr(..., '\\')`).
4. Memory: `FUN_00433efe(3)` (arena sanity check), `FUN_0043421d("_data\messages.bob")` opens the first archive (the `.bod` is the same name with the last letter `d`).
5. `FUN_004042d3`: registers the window class (black brush, no icon/cursor), creates the main window: `CreateWindowExA(0x40000 (WS_EX_APPWINDOW), ..., style 0x80000000 (WS_POPUP), 0,0,640,480)`
   with caption `"%s (c) 2001 LEGO Company"` where the title is the message tag `LEVLGI` of `FE/Data/IFC.str`; `CoInitialize`; loads `_data\Data.bmp` as a splash bitmap;
   `ShowWindow/UpdateWindow`; registers the shutdown handler `FUN_004046bd` (`CoUninitialize`). Window proc = `FUN_004046da` (WM_ACTIVATE -> `FUN_00404fa9`, WM_DESTROY and WM_COMMAND id 2 -> `PostQuitMessage`,
   WM_0x232 -> `FUN_0040b59b`, otherwise a list of up to 32 hooks at `DAT_0098355c`, e.g. the movie player's `FUN_0048cff2`).
6. `FUN_00402bac`:
   * `FUN_00403e30`: loads **`_data\Settings.set`** (23 raw little-endian int32, written by `FUN_0040410f`; if missing it is created with defaults, fallback `c:\windows\temp\Settings.set`).
     Meaning of the 23 values: section 6.4.
   * registers the archive-close shutdown handler `FUN_00402940`; opens the eight shared archives (`FUN_0043421d`): `BrickMorph`, `Bricks`, `Fonts`, `menu`, `Overlays`, `Shadow`, `SwapText`, `GENERICBITS`
     (handles at 0x982ea0..0x982ec0); `messages.bob` stays open as the 9th.
   * `FUN_00402990` = **start-up proper**: `FUN_004059b0` (graphics), `FUN_00436f7d(1)` (DirectInput8), a loop `FUN_0040a027` that shows an "insert CD" screen (`CD.tga` from GENERICBITS) while
     `FUN_00409ec0` finds no CD/movies (analysed: movies are looked up in `<gamedir>\fmv\` or on a CD drive that has a file `LEGOMEDIA`), then plays the **three start-up movies**
     `LegoSoftware.mpg` (not skippable), `SDLogo.mpg`, `IntroFMV.mpg` with `FUN_0048c813(path, hwnd, skippable)` (verified; the "if (flag == 0)" that guards them tests a local that is never set, so they always play),
     fades, `FUN_004359e4` -> `FUN_00874751` (**Miles open**, see 1.6).
   * `FUN_00404da3` registers the input/memory shutdown handler `FUN_00404d80`.
7. `FUN_00404dc9`: **the zone loop** (section 2.1).

### 1.2 Graphics device creation (analysed; `FUN_004059b0`, `FUN_00405832`, `FUN_0040acb0`)

* `DirectDrawEnumerateExA` (`FUN_00405157` per driver) -> `DirectDrawCreateEx` -> `QueryInterface(IDirect3D7)` -> `EnumDevices` (`FUN_00405010`, keeps hardware rasterisers only) and `EnumDisplayModes` three times (32, 24, 16 bpp;
  `FUN_00405352`, filter `FUN_00405289`: **640x480, 800x600, 1024x768, 1280x1024 only**, minimum 640x480 (`DAT_0089ac80`)); `EnumZBufferFormats` (`FUN_00405448`, prefers 32 over 24 over 16 bit).
* The device is **exclusive full-screen**: `SetCooperativeLevel(0x13)`, `SetDisplayMode`, a primary flip chain with one back buffer and a Z buffer; present = `Flip(DDFLIP_WAIT)` (`FUN_0040cb0f`), so **v-synced**. A second black "GRAPHWINDOW" cover window is made
  by `FUN_0040a34a`. On failure `FUN_00405832` retries 640x480x16, otherwise `exit(-1)`. The windowed ("NONEXCLUSIVE") path `FUN_0040a43f` is dead in the shipped flow.
* Z test `LESSEQUAL`, W buffer if the device offers it (`FUN_0040cc4d`); linear fog, table fog if supported else vertex fog (`FUN_0040943f(color, start, end, enable)`), the fog colour doubles as clear colour (`FUN_0040c8c6`);
  projection `FUN_0041533b(fov 1.0, aspect 0.75, near 5.0, far)`, far plane 240..390 (`FUN_004095ab`; also adapted at run time, 1.4).
* **`GameSetup.txt` is never read by the EXE** (the setup dialog `FUN_00403d5b`/`FUN_00403e02` in `PCSetup.c` has no references; `GInfo.bin` lookup in `SDEnum.c` is ignored). The `Mode 800x600x32` line in the installed file is dead data.
  No registry access exists. Texture quality (Settings[0x12] == 0 halves textures, also forced if video memory < 0x3e8000, `FUN_0040cf38`).
* Deactivate/activate (`WM_ACTIVATE`, `FUN_00404fa9`): deactivate unacquires input (`FUN_00437d5b(0)`), destroys all D3D/DDraw objects, textures and vertex buffers (`FUN_00409a99`) and minimises; activate re-creates the device and reloads textures
  (`FUN_00409cdc`, `FUN_0041255c`) behind a loading screen (`FUN_0040d1be`: `LoadingScreen.tga` + spinning `pizza.tga` + "LOADING"). For the browser this is pause/resume on tab visibility.

### 1.3 The frame (verified: `FUN_00465d39`, `FUN_00470ac3`, `FUN_004afaf7`; analysed: details)

Every zone has its own loop function (section 3) but they all use the same frame skeleton. In order:

| step | function | does |
|---|---|---|
| device poll | `FUN_00437411` (if `DAT_009dafe8` = devices ok) | `FUN_00437111`, `FUN_004367ef`, `FUN_00436264`, `FUN_00436e85`: poll keyboard/mouse/pad |
| begin frame | `FUN_0043ec70(0xffff)` = `FUN_0040c8c6` | `Clear` + `BeginScene` |
| input masks / pause | `FUN_00423170(&mode)` (32 callers, one per zone loop; **verified**): `DAT_0098383c` = held mask from `FUN_004376f9`, `DAT_00983840` = pressed-this-frame mask, `DAT_009da688` = hold timer of button 0x40; Esc (`0x40000000`) pressed in any mode except 7/8/3/6 -> `FUN_0041c080`, saves the mode in `DAT_009da630`, sets mode 3 (pause) | |
| zone update | the zone's own update/HUD function(s) | per-zone logic and HUD |
| behaviour update | `FUN_0042226e(records, count)` | **pass 1**: run every behaviour node of every record (4.2) |
| world probe | `FUN_00427233(records, count)` | generic per-record movement/collision probe (UNCERTAIN bit meanings, 4.2) |
| camera | `FUN_0043cc5c` (view matrix) -> `FUN_004434d0` (set camera) -> `FUN_00444370` (frustum flags per record) | the camera struct is `DAT_009da5e8` (eye xyz, target xyz ...) |
| pre-render | `FUN_004225c5` | **pass 2**: pre-render hook of the nodes that ran |
| draw | `FUN_0042271b(records, count, cameraMatrix, &DAT_009da5e8)` | **pass 3**: draw hook per node, else `FUN_00444480` (default mesh draw with LOD) |
| FX update | `FUN_00442930` -> `FUN_00447de0` (brick morph), `FUN_0044e8e0` (particles) | |
| story advance | `FUN_00423bad` | if the zone is the FSM node's zone and the node's condition holds: advance, return 6 (section 2.2) |
| timing | `FUN_00443e40(frameCounter)` | dt (1.3) |
| flush | `FUN_00445d20` (queued 3D effects), `FUN_00439f51` (queued text; each string drawn twice: 2-px shadow, then colour), `FUN_0043c70f` (queued 2D quads) | |
| present | `FUN_00435d0d` = `FUN_0040cb0f` | `EndScene` + `Flip` |
| messages | `PeekMessageA` loop; `WM_QUIT` (0x12) -> assert dialog -> exit | |

The loop only runs when `DAT_00983f94` (application active) is non-zero, else it just pumps messages.

### 1.4 Timing (verified: `FUN_00443de0`, `FUN_00443e40`, `FUN_00443d10`)

* **Variable time step with a nominal 30 Hz unit.** `FUN_00443de0` sets the target to `QueryPerformanceFrequency * (1/30)` (double 0.03333 at 0x892260). `FUN_00443e40` computes
  `DAT_008b1718 = elapsed / (1/30 s)`: **1.0 = one nominal 30 Hz tick**, so a 60 Hz display gives about 0.5. The first 5 frames use 1.0; if elapsed > 15 ticks (a stall) it uses 1.0; the growth per frame is limited to 3x the previous value;
  `_DAT_008b171c` = 1/dt. All game code multiplies speeds/timers by `DAT_008b1718` (fades: `+0.0625 * dt` per frame, mode 7/8 = 16 ticks), though some code is per-frame (camera easing in cutscenes, UNCERTAIN, section 5).
* There is no frame cap other than the v-synced flip.
* **Adaptive detail** `FUN_00443d10` (called from `FUN_00443e40` when a frame is slower than the target, or faster by more than 10000 ticks): after 10+ consecutive such frames it moves a detail level `DAT_009e56bc` (0..4, 4 = best) and the draw distance `DAT_0089df34` (stored far-plane base 400, lower limit 240, step 50); the LOD choice (`FUN_00443f90`) is biased by it.
* `z03PPH` and `z04IFC` have an additional own `QueryPerformanceCounter` frame limiter / fps display (`%d (%d)` string in the PPH loop) (analysed).

### 1.5 Memory, files, shutdown

* **Memory (SDMem2.cpp, analysed)**: `FUN_00433d38(size, pool, file, line)` wraps the debug heap and appends a guard word `0xbadfebad`; pools 0..3; **pool 1 is the per-zone pool**, freed after every zone (`FUN_004340cd(1)` in the main loop);
  `FUN_00433efe(n)` verifies guards. A JS port needs only zone-lifetime arrays.
* **Files (SDFile / PCDBG_File.c, analysed)**: `FUN_00435843` (open) tries a real file first (loose files override archives), then the mounted archives (`FUN_004348ff`); archives are opened with `FUN_0043421d`/closed with `FUN_0043455a` (linked list `DAT_009dab44`).
* **Shutdown** (verified/analysed): two handler stacks: (1) `FUN_004041e5` registers (table 0x98344c, max 0x40): archive close `FUN_00402940`, `FUN_00405828`, `CoUninitialize` `FUN_004046bd`; (2) `FUN_00439036` (table 0x9db290, run by `FUN_00438fda`): `FUN_00404d80` = input shutdown `FUN_004370fd`,
  pool 0 free, memory check. Miles shuts down from a static destructor (`FUN_008742c7`). The quit path is: front end returns -2 -> main loop ends (`FUN_00404dc9` tail: `FUN_004359f3`, frees `STD.str`) -> `exit`.


### 1.6 Audio and movies (analysed; SoundClass.cpp 0x873e00-0x877550, DirectMusic.cpp, MSFMV.cpp)

* **Miles** (`mss32.dll`, 73 imports): constructed before WinMain (1.1), opened by `FUN_00874751`: waveOut, a 3D provider is tried in the order Creative EAX2, EAX, DirectSound3D hardware, DS3D7 software full/light/pan, DS3D emulation; only if one opens does it set up the listener, DirectMusic (`FUN_008760d3`), 16 + 16 sample handles (`FUN_00874477`), `midiOutOpen` and `DLS_open`
  (without a provider the game would have no audio: UNCERTAIN). Per zone `FUN_00873f74` -> `FUN_00873e26` clears 200 + 200 cached-sound slots, `FUN_00874186` -> `FUN_00873f83` ends all samples; `FUN_008751b6` (from `FUN_00435a5e`, every frame) frees finished slots; `FUN_00874af8` applies volume changes.
* **Sound effects**: table of **902 records x 0x20 bytes at 0x969f80..0x971040** {+0 path, +4 volume, +8 loop count (0 = infinite), +0xc min distance, +0x10 max distance, +0x14 pan, +0x18 sample rate, +0x1c flag (UNCERTAIN)}; 2D play `FUN_00874cb4`, 3D `FUN_00874f01`; volume = table volume x Settings[1] / 100. Game-level calls: `FUN_00443580` / `FUN_004433b0` load, `FUN_004435a0` play, `FUN_004435b0` stop, `FUN_004433f0` play at a position, `FUN_00444ed0(bank)` load a sound bank, `FUN_00443290("Z38PAR")` load another zone's bank (ASB reuses PAR's sounds).
* **Speech**: 7.4. **MIDI ambience**: `FUN_00875918`/`FUN_00875a26` (`.mid` + DLS through `AIL_MIDI_to_XMI`, 6 entries such as `LGIBirds`; `FUN_004431e0`).
* **Music (DirectMusic via `CoCreateInstance`)**: `FUN_008761e1` creates the DirectMusic object on Miles' DirectSound object, `FUN_00876283` the port, `FUN_00876543` the performance (auto-download of DLS), `FUN_008766a1` the loader; `FUN_00876841(name)` looks the key up in the 41-entry table at 0x97fcb8 (16 bytes: name such as `Z02LGIM`, directory, `.sgt`, `.dls`), sets the search path (`FUN_00876c97`), loads segment (`FUN_00876d42`) and collection (`FUN_00876759`); play `FUN_00876ec2`; volume `FUN_00876aa4` (-20000 at volume 0).
  Music is chosen by *nodes*: `Music.c` (`FUN_004bc773`, island: by story node (var 0x58) and distance to buildings: cues `Z02Papa`, `Z02Mama`, `Z02Laura`, `Z02Nick`, `Z02Info`, `Z02Trom`, `Z02LGIM/T/B`, `bbotsM`, `radio`, `LGIBirds`) and `BOTMUSIC.c` (`FUN_00536961`, `FUN_00536e16`).
* **Movies (MSFMV.cpp, "DX8Movie")** 0x48c7b0-0x48d8bd: `FUN_0048c813(path, hwnd, skippable)` plays through **DirectShow** (`CoCreateInstance(CLSID_FilterGraph)`, `RenderFile`, `IMediaControl`, `IMediaEventEx` (window message 0x40d, `EC_COMPLETE` ends), `IVideoWindow`, `IBasicAudio`); skippable by any key when the flag is set; `FUN_0048c7b0(name)` builds `<moviedir>\<name>`;
  the movie directory is `<gamedir>\fmv\` if `LegoSoftware.mpg` is there, otherwise a CD drive (type 5, file `LEGOMEDIA`) is scanned recursively. When each movie plays: 2.6.

---------------------------------------------------------------------------------------------------------------------------

## 2. Modes and the top-level state machine

(`SDMode.c` is only the *display-mode / device* code (1.2); the game modes are the local variables of the zone loops below.)

There are **three nested state machines**:

1. the **zone loop** in `FUN_00404dc9` (which zone runs next),
2. the **story FSM** (72 nodes, game var `0x58`) that decides which zone is the "current" one and when a node is finished,
3. the **mode variable inside each zone's GameLoop** (fade-in, intro, play, pause, result...).

A fourth thing, the **cutscene system** (section 5), is not a mode: it runs *inside* mode 2.

### 2.1 The zone loop `FUN_00404dc9` (verified)

```
FUN_00417820();  FUN_0041786a();             // write/read _data\sw.dat (section 6.3)
zone = FUN_00404be7();                       // = storyFsm[ gameVar[0x58] ].zone
gameVar[0x59 CURRENT_SUBGAME] = zone;
FUN_004426b0(); STD.str loaded into DAT_00983a14;
do {
  if (zoneTable[zone].run == NULL) {         // zones 22,23 (z29PAI, z30PLI): cut content
      FUN_00404bb2();  next = FUN_00404be7(); // advance the FSM, take the new node's zone
      gameVar[0xa3 PREV_SUBGAME] = zone; gameVar[0x59] = next;
  } else {
      FUN_004177ed();                        // clear zone-local vars 0xfa..0x13e
      FUN_0043406c(1);                       // allocate from pool 1
      FUN_0045988b();                        // build the cutscene command dictionaries
      FUN_00417990();                        // register the 229 'SWITCH_GME_*' names (script dictionary)
      gameVar[5 NEXT_SUBGAME] = zone;  gameVar[0x63 PIZZAS_THROWN] = 0;  gameVar[0x53 COMPLETE_SUB_GAME] = 0;
      while (!FUN_0040a027()) ;              // wait until the display/CD is ready (the same wait loop as in start-up, 'insert CD' screen)
      FUN_00433efe(3);  FUN_00873f74();      // memory check, sound begin-zone (clear 200+200 sound slots)
      next = zoneTable[zone].run();          // *** the zone loop returns the NEXT ZONE TABLE INDEX ***
      FUN_0043ec80(0);  FUN_00874186();      // fade 0, sound end-zone
      FUN_00433efe(3);
      if (next == -1) { next = 0; gameVar[0x58] = 0; }   // -1 = "back to the front end": FSM node 0
      if ((o = FUN_0041ad43()) != -1) next = o;           // pending "load saved game" override (gameVar[0x58] = DAT_009d9c10, zone DAT_009d9c18)
      gameVar[0xa3] = zone;  gameVar[0x59] = next;
      FUN_00459820();  FUN_004426b0();  FUN_00417956();   // free dictionaries, reset
      FUN_004340cd(1);                       // free the whole zone pool
  }
  zone = next;
} while (zone >= 0);                         // the front end returns -2 to quit
```

* Return values of a zone run function: `>= 0` next zone-table index; `-1` quit to the front end (node 0); `<= -2` leave the program (the front end returns `0xfffffffe` for "Stoppen"; `FUN_00470ac3`).
* **Zone table** at VA 0x89a9c0: 35 records of 20 bytes `{ run fn, kind, char name[8], 0 }` (`tools/zones.py`). Table in section 3.1. **`kind == 1` = "hub / rewind target"**: its only readers are `FUN_00404b43` (when a mini-game fails or is aborted, the FSM is
  rewound to the previous node whose zone has kind 1) and `FUN_004229a0` (camera wall pushing only in kind-1 zones). Kinds 0/2/3/4 have no readers (the 2/3/4 split is UNCERTAIN, maybe the number of medal tiers or difficulty).
* The table "name" is the internal zone id. The archive name differs for some: `z00FRE` -> `z60FRE`, `z90PSX/z91PSX/z92PSX/z93PSX` -> `z02LGI`, `z90CAS` -> `z07CSI`, `z90ADV` -> `z13CAI`, `z90OSD` -> `z14OSD`, `z90PYA` -> `z16PYA`,
  `z90DIP` -> `z23DIP`, `z90OGL` -> `z40OGL`, `z40APO` -> `z40aPO`. `z29PAI` and `z30PLI` (idx 22, 23) have no code (cut content). The four island ids 2/31/32/33 all run the same function `FUN_004afaf7`;
  they are distinct only as *current-subgame ids* (the story FSM uses them to say "island, era 0..3", 3.5).

### 2.2 Story FSM (table 0x89a758; verified table, semantics analysed)

72 entries of 8 bytes `{ s16 zone, s16 var, u16 mask, u16 value }`. Node `n` is **complete** when `(gameVar[var] & mask) == value` (`FUN_00404aa0`). Game var `0x58` (`SWITCH_GME_FSM_CURRENT_STATE`) is the current node.

* `FUN_00404be7` = zone of the current node. `FUN_00423bad` (called every frame by the hub zones and the mini-game loops): if `gameVar[0x59]` equals the node's zone and the node is complete, `FUN_00404bb2` advances to the next node (and
  snapshots `gameVar[var]` of the new node in `DAT_00983854[node]`), and if the zone changed it returns 6 (= "leave: next zone = `FUN_00404be7()`").
* `FUN_00404d14(&next, completed, success)` is called by every **mini-game** on exit: if the current zone is the node's zone: `completed && success` -> `gameVar[0x53] = 1` + advance; otherwise `FUN_00404b43` rewinds to the previous node with a kind-1 zone and restores
  that node's var from the snapshot (so the hub trigger is not instantly true again). If the current zone is not the node's zone (a replay from the menu), `next = gameVar[0xa3]` (PREV_SUBGAME). A bronze medal is enough to progress.
* `FUN_00404c07(n)` jumps to node `n` (forward jumps force the vars to their node value for GME/MS vars, backward jumps restore snapshots; also sets var 5): used by the debug dialog, the Pepper's-house replay menu (`FUN_0041b9b1`, page 24) and the front-end "level select".
* `FUN_00404af6` steps back one node; `FUN_00423f7b` is a demo/debug auto-advance (`DAT_009da634` set; 0x97 frames).
* Hubs leave a zone by writing **var 5** (`NS_NEXT_SUBGAME`) from a portal/door/trigger node: every zone loop checks `gameVar[5] != gameVar[0x59]` -> `exit = 8`, fade out, return `gameVar[5]` (verified in `FUN_00470ac3`, `FUN_00465d39`, `FUN_004afaf7`).

Decoded table (regenerate with `tools/fsm_dump.py`, section 10.1). Names: `S<n>` = zone-local `SUBGAME:n` var (set only by scripts/trigger nodes; meaning UNCERTAIN), `CSIWP` = `CSI_WHERES_PEPPER` (0x56), `PC` = `PEPPER_CONTROL` (0x5e), `COMPLETE` = `COMPLETE_SUB_GAME` (0x53).
Story captions are the `FSMSTATEnn` progress texts of `FRONTEND.str` (also the save-slot captions); LE = LEGO Island, CE = Castle, AE = Adventurers, OE = Ogel.

| node | zone (table idx) | complete when | story step |
|---|---|---|---|
| 0 | z00FRE (0) | NS_ON == 1 | front end |
| 1 | z01BPK (1) | S250 == 1 | skate park (skipped by "New game") |
| 2 | island era 0 (2) | S277 == 16 | LE: pizza delivery |
| 3 | island (2) | NUM_BRICKS == 0 | all 11 bricks collected |
| 4 | island (2) | S303 == 1 | Pepper's house built |
| 5 | island (2) | S277 == 1 | go to the pizzeria |
| 6 | island (2) | BRICKSTER_ESCAPED == 1 | pizza to the jail |
| 7 | island era 1 (31) | NUM_PAGES == 4 | find 4 Constructopedia pages |
| 8 | island (31) | COLORED_BOTHEADS == 15 | collect the 4 coloured bot heads |
| 9 | island (31) | NEXT_SUBGAME == 5 | walk into the WAB (Whack-A-Bot) door |
| 10 | z05WAB (5) | COMPLETE | mini-game |
| 11, 12 | island (31) | S277 == 256 / 512 | mainframe, Res-Q |
| 13 | island (31) | PC == 8 | Res-Q HQ (take the boat) |
| 14 | island (31) | S302 == 1 | ship to the Castle island |
| 15-17 | z07CSI (6) | PC == 1 / CSIWP == 12 / 2 | CE: broken bridge |
| 18 | z08BKD (7) | COMPLETE | brick dive |
| 19-22 | z07CSI (6) | CSIWP == 17, 2, 3, 4 | Bull castle, Lion castle |
| 23 | z09JST (8) | COMPLETE | tournament (jousting) |
| 24, 25 | z07CSI (6) | CSIWP == 5, 6 | |
| 26 | z10RGB (9) | COMPLETE | Bull castle 2 (cannon duel) |
| 27, 28 | z07CSI (6) | CSIWP == 37, PC == 8 | Res-Q boat |
| 29 | z07CSI (6) | NEXT_SUBGAME == 32 | ship back to LE |
| 30-32 | island era 2 (32) | NUM_PAGES & 2 == 2, S277 == 2, S281 == 2 | police station |
| 33 | z13CAI (10) | NEXT_SUBGAME == 11 | AE: flight to Adventure Island |
| 34 | z14OSD (11) | S257 & 1 | oasis |
| 35 | z15SSH (12) | COMPLETE | scorpion/snake shooter |
| 36 / 38 / 40 | z16PYA (13) | S254 / S255 / S256 == 1 | pyramid hub, three visits |
| 37 / 39 / 41 | z17WAS (14) / z18MMP (15) / z20DSP (16) | COMPLETE | whack-a-snake / mummy tomb / speedster |
| 42-44 | z21FSH (17) | S252 == 1 / COMPLETE / S252 == 2 | fishing |
| 45 | z14OSD (11) | S259 == 7 | back at the oasis |
| 46 | z22BIP (18) | COMPLETE | biplane |
| 47 | z23DIP (19) | S257 == 2 | dino island hub |
| 48 / 49 | z27TRX (20) / z28HAT (21) | COMPLETE | T-Rex / hot-air balloon |
| 50 | z23DIP (19) | S257 == 1 | main camp |
| 51 | z13CAI (10) | S250 == 1 | flight home |
| 52-58 | island era 3 (33) | PC == 1, S277 == 4, PAGES_SET == 15, S277 == 12, COLORED_BOTHEADS == 15, S277 == 7, S284 == 1 | landing, pages, bot heads, Space Port |
| 59 / 60 | z36CNT (24) / z38PAR (25) | COMPLETE | centrifuge / parachute |
| 61 | island (2) | S284 == 2 | |
| 62 / 63 | z39ASB (26) / z40APO (30) | COMPLETE | asteroid belt / parachute landing on Ogel |
| 64 | z40OGL (27) | S256 == 1 | OE: find the pizzeria |
| 65 | z41MAP (28) | COMPLETE | pizza making |
| 66 | z40OGL (27) | S257 == 1 | to the palace |
| 67 | z42BRP (29) | COMPLETE | Brickster's palace; **the outro movie plays here** |
| 68-71 | island (2) / z03PPH (3) / z04IFC (4) / z50LTC (34) | NS_OFF == 1 | `NS_OFF` (var 1) is read-only 0, so these are never complete: node 68 is the terminal free-roam state; 69-71 look unreachable (UNCERTAIN) |

`FUN_004b6475` (island init) turns the node into an *era*: node < 7 era 0, < 0x1e era 1, < 0x34 era 2, < 0x3d era 3, else era 4 (3.5).

### 2.3 Zone-loop template: modes and exit state (verified on `FUN_00465d39`, `FUN_00470ac3`, `FUN_004afaf7`; per-zone variants analysed)

Every zone loop has two locals, here called **mode** and **exit state**.

| mode | meaning |
|---|---|
| 7 | fade in: `FUN_0043ec80(f)` with `f += 0.0625 * dt` until 1.0, then mode 0 |
| 0 | init: first-frame bookkeeping (result flag cleared) -> 1 |
| 1 | intro: show the mini-game's one-line brief (e.g. `LESGPT01`) and wait for a button; some loops go to 9 first |
| 9 | "controls help" overlay (`FUN_00461155(strfile, nControls)` draws the `CONTROLn` lines of the zone's `.str`), then 2 |
| 2 | **play**: full update/draw (the only mode in which behaviours run in some zones, e.g. ASB `FUN_007b6081`) |
| 3 | **pause menu** via `FUN_0041bd3d(&mode, mask, kind)` (SGPauseM.c): entered by Esc in `FUN_00423170`; mask 0x80 hides Abort/Restart (island), 0x40 disables Save (mini-games); on return restores `DAT_009da630` |
| 4 | **end banner**: score/medal text (`SGBRONZE/SGSILVER/SGGOLD` + the zone's `...SGxxNN` message ids), waits for a button |
| 5 | **result menu** `FUN_0041c092` (Retry / Continue / Quit; codes -3..+1 mapped to exit states) |
| 6 | `FUN_00423170` maps a mode of 6 to 3 (pause) on the next frame (UNCERTAIN what sets 6: a one-frame "pause requested" marker) |
| 8 | fade out: `f -= 0.0625 * dt`, then the loop ends with the stored exit state |
| 10 | second help screen (z42BRP phase 2) |

| exit state | meaning | consumer |
|---|---|---|
| 1 | running | |
| 0 | quit to the front end | return `-1` |
| 2 | finished (Continue) | mini-games: `FUN_00404d14(&next, true, success)` |
| 3 | restart the zone: loop re-runs the zone's own re-init (`setup`/`restart` function), no return | |
| 4 | leave without completing (Abort / failed) | mini-games: `FUN_00404d14(&next, false, ...)` |
| 6 | story advanced to another zone (`FUN_00423bad`) | hubs: next = `FUN_00404be7()` |
| 8 | `gameVar[5] != gameVar[0x59]` | hubs: next = var 5 |

Mini-game loops (e.g. `FUN_00465d39`) send **every exit except 0 and 3** through `FUN_00404d14(&next, exit == 2, success)` (so a forced exit 6/8 also lands there with `completed = false`); hub loops return the zone chosen by 6/8 directly and call only an empty stub (`FUN_004afa20`) for exit 2.

Hub loops (island, castle, adventure hubs, Ogel hub) never reach modes 4/5 (the flag that triggers them is only cleared): they leave through the story FSM or var 5 only.

### 2.4 Pause, results, menus (analysed: `SGPauseM.c`, `FUN_0041b500`, `FUN_0041be4e`, `FUN_0041fd45`)

* One **data-driven menu engine**: pages table at 0x8a9338 (5 dwords: kind, nitems, items*, setupfn, type), items of 0x4c bytes (label +0, type +0x40: 0 title, 1 goto-page, 2 back, 4 action id, 5 toggle, 6 slider, 7 key binding, 9 list item; id +0x44; disable mask +0x48).
  Engine `FUN_0041fd45`, drawing `FUN_0041d765`, event handler `FUN_0041b500`, frame wrapper `FUN_0041be4e`. `FUN_0041bd3d(&mode, mask, kind)` opens page 5 (island pause), 18 (mini-game pause) or 29; `FUN_0041c092` opens result pages 15/16/19.
  Return codes: 0 stay, 1 resume, -1 quit to menu, -2 restart (id 0xf), -3 abort/leave zone, -4 credits (front end).
* Pause page items (page 5): Continue, Load, Save, Options, "Huis van Pepper" (id 0x11: var 5 = 3, `STARTEDFROMMENU` = 0), Quit (page 1 = confirm).

### 2.5 Front end z00FRE / archive z60FRE (analysed; `FUN_00470ac3`)

A 3D stage scene: fixed camera (0, 11, 56.8) looking at (0, 11, 0) (`FUN_00471070`), Pepper (record 0 `PEPP`) walking back and forth with `Walk.c` nodes (`FUN_00472743`; train `FUN_00472c45`, brick `FUN_00472fd8`), random outfit swaps (`FUN_004721f0`).
Menus (FRONTEND.str): main = Starten / Opties / Credits / Stoppen; Start -> Nieuw spel / Spel laden / Spel wissen (7 slots, 6.3); Options -> Besturing (keys, mouse speed, joystick) / Afbeeldingen (detail, resolution) / Geluid (3 volumes, subtitles) / Overzichtscenes (cutscene viewer).
"Start" fades out and returns `gameVar[5]`; **New game** (`FUN_0041a8f9`) sets the FSM to node 2 (zone 2: the island). Level-select lists (tables 0x8a5c88 story checkpoints, 0x8a62e8 mini-game replays) set `STARTEDFROMMENU` (var 0xb) = 1 for replays.

### 2.6 Cutscene mode, movies, credits, ending

* **Cutscenes** (section 5) are scripts run by `FUN_0045c402` each frame inside mode 2 (letterbox bars, `PEPPER_CONTROL |= 0x100`); a trigger object (`StartCSM.c`) or a story handler starts them (`FUN_0045c40c(slot)`); suppressed when `STARTEDFROMMENU != 0`.
* **Movies** are blocking modal calls to `FUN_0048c813(path, hwnd, skippable)` (MSFMV, DirectShow, 0x48c7b0..0x48d8bd): start-up `LegoSoftware.mpg`, `SDLogo.mpg`, `IntroFMV.mpg` (`FUN_00402990`); **`OutroFMV.mpg`** at the end of the game (`FUN_0081fd64`, z42BRP: result == 2 and `STARTEDFROMMENU == 0`, via `FUN_0048c7b0(name)`); the intro and outro can also be replayed from the options "Overzichtscenes" (`FUN_0041b9b1`, modes 0x12/0x13) and the PPH computer (`FUN_0053fe2b` refers to `LegoIntro.mpg`/`LegoOutro.mpg`, which do not exist in the install). Four MPEG files exist: `IntroFmv`, `LegoSoftware`, `SdLogo`, `outroFmv` (README).
* **Credits**: front end returns -4 from the menu engine -> `FUN_00470ac3` scrolls `CREDITS.str` (`FUN_00471bfa` loads fonts + file; `FUN_00471802` (Menu.c) word-wraps 0xE1 lines into a table in three font classes; `FUN_00471c4c` scrolls 30 px per line, `local_68` from -480, advanced by `dt` per frame; any key ends it). There is also an easter-egg zone `z50LTC` (developer minifigs in a cave, 3.4).
* **Game over / lives**: none. A failed mini-game shows "Mislukt" with Retry/Abort; Abort rewinds the FSM to the last hub.
* **Loading screens**: zones load synchronously inside the wrapper/loop function; there is no progress UI except the re-creation screen after Alt-Tab (1.2).


---------------------------------------------------------------------------------------------------------------------------

## 3. Zones

### 3.1 Table of all zones

"Zone" = what the game calls a *sub-game*: every hub, room and mini-game is a separate zone with its own archive, its own copy of the code template and its own loop function. 30 archives, 35 table entries (4 island variants share one archive; 2 entries are empty).
`run` = zone-table function; for **hub** zones it is a *wrapper* (opens the archive, picks the music key, runs setup, calls the inner GameLoop, then teardown); for the others it is the GameLoop itself. Code region from `tools/zonemap.py`
(small per-zone helper stubs - input, pause hook - sit up to ~0x600 bytes before the entry; the regions are therefore approximate at both ends). `lines` = decompiled lines of the whole region; `unique` = estimate of zone-specific gameplay lines
(from the per-zone analyses; builder/loader/template excluded). Diff = porting difficulty (analysed).

| idx | internal id | archive | kind | what it is in the game | run (wrapper) / inner loop | code region | fn / lines | unique | diff |
|---|---|---|---|---|---|---|---|---|---|
| 0 | z00FRE | z60FRE | 1 | **Front end**: 3D stage with Pepper, menus, credits | 0x470ac3 | 0x470ac3-0x48c7b0 | 42 / 5.8k | 0.4k | low scene / med menu |
| 1 | z01BPK | z01BPK | 1 | **Skate park**: skateboard stunts for 2 minutes (BPK.str "Doe zoveel mogelijk stunts in 2 minuten") | 0x48d8bd | 0x48d8bd-0x4afaf7 | 50 / 5.6k | 2.5k | high |
| 2, 31, 32, 33 | z90PSX, z91PSX, z92PSX, z93PSX | z02LGI | 1 | **Lego Island** main island hub, story eras 0-3 (4 variants of one zone) | 0x4afaf7 | 0x4afaf7-0x53dfda | 419 / 20.9k | ~15k | high |
| 3 | z03PPH | z03PPH | 3 | **Pepper's house**: trophy room (23 trophies), computer menu, ladder | 0x53dfda | 0x53dfda-0x54996a | 91 / 4.1k | 1.2k | medium |
| 4 | z04IFC | z04IFC | 3 | **Info Center**: encyclopedia of ~29 characters and 17 places (IFC.str), map pins | 0x54996a | 0x54996a-0x56905a | 103 / 5.0k | 0.4k | low |
| 5 | z05WAB | z05WAB | 3 | **Whack-A-Bot**: whack popping Brickbots with the 4 direction buttons, don't hit Infomaniac | 0x56905a | 0x56905a-0x572780 | 36 / 3.1k | 1.0k | low-med |
| 6 | z90CAS | z07CSI | 1 | **Castle island** hub (Knights' Kingdom): horse riding, goblets, 9 cutscenes | wrapper 0x572780 / inner 0x572910 | 0x572780-0x5b8368 | 88 / 11.1k | 3.5-4k | high |
| 7 | z08BKD | z08BKD | 3 | **Brick dive**: underwater swim, 5 bridge bricks + page, avoid sharks/octopus/pirates/cannon, air meter | 0x5b8368 | 0x5b8368-0x5cd33d | 172 / 7.9k | 4k | med-high |
| 8 | z09JST | z09JST | 4 | **Jousting** duel vs the Dark Knight (first to 3 hits) | 0x5cd33d | 0x5cd33d-0x5f418b | 76 / 6.2k | 2.3k | medium |
| 9 | z10RGB | z10RGB | 4 | **Cannon duel** at the Bull castle vs "Simon"/Cedric (9 cannons, 4 hits) (RGB expansion UNCERTAIN) | 0x5f418b | 0x5f418b-0x61a821 | 95 / 6.4k | 2.7k | med-high |
| 10 | z90ADV | z13CAI | 1 | **Adventure Island** overworld (fly helicopter/Pterodactyl over 15 landmarks); exit portal PORS | wrapper 0x61aebb / inner 0x61a821 | 0x61a821-0x627c90 | 33 / 3.9k | 0.1k | low |
| 11 | z90OSD | z14OSD | 1 | **Oasis** hub: scorpions, tumbleweeds, 10 gems (+1000 each), Johnny/Pippin/Kilroy cutscenes | wrapper 0x628252 / inner 0x627c90 | 0x627c90-0x656372 | 68 / 6.9k | 0.9k | medium |
| 12 | z15SSH | z15SSH | 2 | **Coconut/snake shooter**: rail cart, shoot coconuts at 3 snakes to save gems | 0x656372 | 0x656372-0x675930 | 37 / 7.9k | 1.0k | medium |
| 13 | z90PYA | z16PYA | 1 | **Pyramid/sphinx** hub (entered 3 times); reuses the oasis scorpion/tumbleweed/gem code | wrapper 0x675f02 / inner 0x675930 | 0x675930-0x698efe | 39 / 4.5k | 0.6k | low-med |
| 14 | z17WAS | z17WAS | 3 | **Whack-A-Snake**: 4 snake baskets, steal the gem | 0x698efe | 0x698efe-0x6a26a8 | 34 / 3.0k | 0.7k | low-med |
| 15 | z18MMP | z18MMP | 3 | **Mummy tomb**: memory-match 6 symbol pairs on 12 coffins, key, page; spiders, rats, boulder | 0x6a26a8 | 0x6a26a8-0x6bde34 | 118 / 8.8k | 3.5k | high |
| 16 | z20DSP | z20DSP | 2 | **Desert Speedster race** (time trial, saucers/whirlwind/rock-pushing bots) | 0x6bde34 | 0x6bde34-0x6f3511 | 101 / 13.8k | 3.3k | high |
| 17 | z21FSH | z21FSH | 3 | **Fishing** (15-state fishing FSM, Big Bertha) | 0x6f3511 | 0x6f3511-0x706bee | 87 / 6.2k | 1.9k | medium |
| 18 | z22BIP | z22BIP | 2 | **Jungle biplane**: fly, shoot bananas at monkeys, fuel cans, rope slides, landing | 0x706bee | 0x706bee-0x725ec1 | 151 / 9.8k | 3.8k | high |
| 19 | z90DIP | z23DIP | 1 | **Dinosaur island** hub: main camp, T-Rex / Pterodactyl triggers | wrapper 0x72645c / inner 0x725ec1 | 0x725ec1-0x7656f2 | 45 / 8.2k | 1.1k | medium |
| 20 | z27TRX | z27TRX | 2 | **T-Rex ride**: 3-lane runner past logs/boulders/volcano | 0x7656f2 | 0x7656f2-0x790fc0 | 93 / 8.1k | 2.4k | medium |
| 21 | z28HAT | z28HAT | 4 | **Hot-air balloon**: winch 11 dinosaurs, dodge Mr Hates' fireballs, free Bronto with sandbags | 0x790fc0 | 0x790fc0-0x7af067 | 100 / 8.7k | 3.0k | med-high |
| 22, 23 | z29PAI, z30PLI | - | 1 | **empty** (no run function, no archive; cut content) | 0 | - | - | - | - |
| 24 | z36CNT | z36CNT | 3 | **Centrifuge**: alternate left/right presses in rhythm with lights (G-force training) | 0x7af067 | 0x7af067-0x7b63f6 | 44 / 2.5k | 0.8k | low-med |
| 25 | z38PAR | z38PAR | 3 | **Parachute**: skydive through 3 rings, land on target (template origin of the zone loops) | 0x465d39 | 0x465d39-0x470ac3 | 61 / 3.9k | 1.1k | medium |
| 26 | z39ASB | z39ASB | 2 | **Asteroid belt**: fly the shuttle through ~235 asteroids (reuses z38PAR sounds) | 0x7b63f6 | 0x7b63f6-0x7cf929 | 40 / 6.6k | 0.8k | low |
| 27 | z90OGL | z40OGL | 1 | **Ogel's island** hub: krystals (10), citizens, robots, slugs, bats, hologram | wrapper 0x7e2321 / inner 0x7e247f | 0x7e2321-0x811abc | 83 / 6.8k | 1.3k | med-high |
| 28 | z41MAP | z41MAP | 3 | **Pizza making** at Ogel's pizzeria: Papa swings the base, throw toppings in order | 0x811abc | 0x811abc-0x81fd64 | 81 / 4.7k | 1.2k | medium |
| 29 | z42BRP | z42BRP | 3 | **Brickster's palace**: final boss, 2 phases (side run, roof + pizzas) | 0x81fd64 | 0x81fd64-0x838e41 | 70 / 7.4k | 3.0k | med-high |
| 30 | z40APO | z40aPO | 0 | **Parachute landing on Ogel** (copy of z38PAR's loop; asteroids, rock monsters, Brickbots); the run fn mounts *both* `z40aPO.bob` and `z40OGL.bob` (the intro cutscene `ogl02`/`apo01` lives in the OGL archive, `FUN_0045c366("z40OGL","og")`) | 0x7cf929 | 0x7cf929-0x7e2321 | 60 / 6.0k | 1.5k | medium |
| 34 | z50LTC | z50LTC | 1 | **"Meet the team" cave**: easter egg, 26 developer minifigs with name/role strings (table 0x95d2c8); reached through the `WORM` wormhole of the island when var 0xd != 0 (cheat code `SDREAMS` sets var 0xd, section 7.1) | wrapper 0x83942f / inner 0x838e41 | 0x838e41-0x858d30 | 28 / 3.4k | 0.4k | low |

Totals: 19 mini-games (BPK, WAB, CNT, PAR, BKD, JST, RGB, SSH, WAS, MMP, DSP, FSH, BIP, TRX, HAT, ASB, APO, MAP, BRP), 7 hubs (island, CSI, CAI, OSD, PYA, DIP, OGL), 3 rooms (PPH, IFC, LTC), 1 front end. The "kind" field: see 2.1.

### 3.2 The zone code template (verified on z38PAR, z03PPH; analysed on all)

Each zone region contains, in this order (addresses of z38PAR; every other zone is analogous, see 3.4):

| role | z38PAR | z02LGI | what |
|---|---|---|---|
| input/update stubs | `FUN_00465c8a`, `FUN_00465c9b` | `FUN_004afa25` (-> `FUN_00423170`), `4afa3d` (pause `FUN_0041bd3d`), `4afa5c` (camera trio) | thunks the loop calls |
| **GameLoop** | `FUN_00465d39` | `FUN_004afaf7` | the loop of 2.3; ~220-460 decompiled lines. Opens `_data\<zone>.bob` (`FUN_0043421d`), runs setup, loops, runs teardown, closes the archive (`FUN_0043455a`) |
| setup | `FUN_00466e90` (+`FUN_00467370` sound handles) | `FUN_004b6475` (+`FUN_004b037e` sound handles) | calls the **loader**, sets record flags, creates controllers, registers behaviours (`FUN_00466c36`) |
| restart / teardown | `FUN_00466f01` / `FUN_00466f15` | `FUN_004b701b` | re-init for exit state 3 / free everything |
| zone behaviours | `FUN_004676cd` ... `FUN_0046a926` (BOAT, PTER, BALL, PARA, PLNE, PEPP constructors) | ~30 node types | see 4 |
| **builder** (`AGobs.c`) | `FUN_0046add0` (724 lines) | `FUN_004c34c0` | models + object records (formats.md 6) |
| **loader** (`AGobs.c`) | `FUN_0046ea70` (978) | `FUN_004f645b` | allocates the global tables, loads `.msh`/`.col`/`.blk`, texture lists |
| result text | in GameLoop | | `LESGPTnn` ids for medals |

`Init.c`, `Walk.c` and the `PepSwitc.c` family are further **per-zone copies**: `Init.c` is identical after normalisation in z01BPK and z36CNT (z10RGB and z39ASB 0.77-0.84 similar, z22BIP's is a different function, 0.15); `Walk.c` is a per-zone variant (Pepper's walk tuned per zone, 0.15-0.5 similar).
Normalised-token similarity of the GameLoops against z38PAR: 0.38-0.63; **z40aPO 0.83** (it is a copy of the parachute loop); hub loops (island, CSI, OSD, PYA, DIP, OGL) 0.38-0.47. So the loops are copy-and-edit of one template (`tools/tmpl_sim.py`).

**Rendering is not per zone**: all zones use the shared three passes and `FUN_00444480` (4.2); a zone customises drawing only through the draw slot of its behaviour nodes and through its HUD/overlay code in the update step.

**Shared services the zone code calls most** (call counts over the per-zone analyses; roles analysed):

| role | functions |
|---|---|
| game vars | `FUN_00417575` get, `FUN_00417597` set, `FUN_004175ca` add, `FUN_0041761b` or |
| nodes | `FUN_0042382c` create controller, `FUN_00423532` attach node, `FUN_004238b7` set node parameter, `FUN_00444550` part render mode, `FUN_004427e0/00442780/004428b0` collision box |
| animation | `FUN_0043b6a3` start clip, `FUN_0043b76a` advance (returns 1 loop wrap / 2 end), `FUN_0043b73f` frame, `FUN_0043b72b` clip, `FUN_0043b64d` seek, `FUN_00443120` set frame range |
| maths | `FUN_0043a5e4` Euler + position -> matrix, `FUN_0043a4a1` Euler -> rotation, `FUN_0043ab72/0043abe6` transform vector, `FUN_0043cec0` normalise, `FUN_0043b00b` copy matrix, `FUN_004388ae` random float, CRT `FUN_0085d1c4/0085d374/0085d640/0085d260` (sin/cos/...), `FUN_0085c0b0` memcpy, `FUN_0085ac00` sprintf |
| collision / terrain | `FUN_00441270` sweep, `FUN_00441ac0` / `FUN_00441b10` probes, `FUN_0043cd62` terrain height |
| sound | `FUN_004435a0` play, `FUN_004435b0` stop, `FUN_004433f0` play at position, `FUN_00443580` / `FUN_004433b0` load |
| text / speech | `FUN_00439bf8` look up, `FUN_00435a11` speak, `FUN_00439c6f` draw text, `FUN_00461155` controls help |
| FX | `FUN_00442960`, `FUN_00442a20`, `FUN_00442a00`, `FUN_0044e920` (start `.par` emitters, camera shake / billboards: UNCERTAIN split) |
| cutscene / waypoints | `FUN_0045c310/c366/c397/c40c/c402/c432`; `FUN_004630c0`, `FUN_00462be9` |
| flow | `FUN_00423170` (input/pause), `FUN_0041bd3d` (pause menu), `FUN_0041c092` (result menu), `FUN_00423bad` (story advance), `FUN_00404d14` (exit decision), `FUN_00444480` (draw record) |
| memory | `FUN_00433d38` / `FUN_00433d60` |

**Global world tables** filled by the loader (verified, PPH loader `FUN_00546012`; formats.md 6.2 lists the rest): `DAT_00983800/04` object record count/array (stride 0x68), `DAT_00983808/0c` model count/array (`FUN_0043eaa0(n)`, stride 0x18), `DAT_00983810/14` mesh table,
`DAT_009837f8/fc` animation (`.blk`) table (`FUN_0043b1ff`), `DAT_00983828/2c` collision table (`FUN_0043f370`; unused slots `0xBABABABA`), `DAT_00983818/1c` and `DAT_00983820/24` texture-list tables, `DAT_00983834/38` attachment models.
Animation rigs are also named: the loader's string pool contains the clip names (`PEP_*`, `BB_*`, ... ~140 names per rig) that the zone's behaviours index by id.

### 3.3 Load / unload sequence of a zone (verified on the hubs and mini-games)

1. Main loop: reset zone-local vars, pool 1, dictionaries (2.1), `FUN_00873f74` (sound begin: clears the 200 + 200 sound slots).
2. Zone function opens the archive(s) `_data\<zone>.bob` (`FUN_0043421d`: reads `.bod` directory into memory; files stay in the `.bob`), sets the swap-texture directory `FUN_004437d0("_data\swaptext\")` (the shared `SwapText` texture bank `Text.txl`, loaded lazily by `FUN_00443810`),
   loads the music key / sound banks (`FUN_00444ed0(n)` per sound-bank id; `FUN_00435a07("medieval"|"adventur"|"oasis"|"mummies1"|"advent2"|"ogel", &id, 0)`: the music keys of the hub wrappers; `FUN_00435a07` is a stub in this build, music is started by `Music.c`/`DirectMusic` code, UNCERTAIN how).
3. Shared set-up: `FUN_0045f9d2` (HUD fonts/overlays `Overlays\HUDfx`), `FUN_0041b40e` (fonts `main`, `menu`, `FE/Data/frontend.str`, `pause.str`, `ifc.str`, menu overlays `FUN_0041b366`), `FUN_00444850` (shadow mesh + `Shadow` textures; vars 0xc5/0xc6).
4. Zone setup: loader (reads every `.msh` with `FUN_004459e0`, `.col` with `FUN_0043f370/700`, textures with `FUN_00442e80`, waypoints with `FUN_004630c0`, `.str` with `FUN_00439126`) -> builder -> behaviour registration -> `FUN_0042207d(PEPP)` (camera/focus object) -> `FUN_00443de0` (timer start) -> `FUN_00421bbe(n)` (restore building/outfit phases of records, 4.1) -> `FUN_00423bf0` (score totals).
5. Loop (2.3). 6. Teardown: `FUN_00421eb3`, `FUN_0041b4af`, `FUN_00443b90`, `FUN_00423ad4` (calls the destroy slot of every behaviour node), `FUN_004232a0` (frees models, meshes, collision, animation instances, records), `FUN_0042207d(0)`, `FUN_0045f9b0`, `FUN_0043455a` (close archive).
7. Main loop: `FUN_00874186` (sound end), `FUN_004340cd(1)` (free pool 1).

There is no streaming and no preloading of neighbouring zones; a zone switch is a full synchronous teardown and reload. Hubs are re-entered many times (island 4 eras, PYA 3 visits, OSD 2, DIP 2).

### 3.4 Per-zone code: entry functions and source files (analysed)

Addresses: **S**etup (loader + behaviours), **U**pdate / main game logic, **T**eardown, **B**uilder / **L**oader. "SG" shared nodes are named in 4.

| zone | S | U (key logic) | T | B / L | zone-specific source files (address) |
|---|---|---|---|---|---|
| z60FRE | `FUN_0047172c`, scene `FUN_00471070`, fonts `FUN_00471bfa` | menu engine `FUN_00470a25` -> `FUN_0041be4e`; Walk nodes `FUN_00472743`, `4729f6`, `472c45`, `472fd8` | `FUN_004721a7`, `FUN_0047178f` | 0x4731d0 / 0x47ec85 | Menu.c 0x471802 (credits layout), Walk.c x4 |
| z01BPK | `FUN_00493506`, behaviours `FUN_004933c4` | skate controller `FUN_00490e2e` (628 lines, handler table 0x8d2130), `48e1b0`, `48f66d`, `4900d4`, steer/input `490cd2`, `490af4`; timer `493ba0`; scoring `493ecd`; trick names `48d52b` | `FUN_00493897` (re-init `4938e8`) | 0x4945c0 / 0x4a26df | skate.c 0x492cc2, PepSwitc 0x494091, Walk 0x4944f3, Init.c 0x4931b1 |
| z02LGI | `FUN_004b6475`, sound `4b037e`, Pepper chain `4b4220`, world `4b4907`, per-era sets `4c0ca9 / 4c070c / 4c015e / 4bfd7d` | story handler `FUN_004b7040` (205 lines, per node), HUD `4b908d`, director `4b7c78` | `FUN_004b701b` | 0x4c34c0 / 0x4f645b | 20 files, 0x4afa25..0x53dfda: SeaAmin 0x4b1212, Bunny 0x4b2149.., Ptera 0x4bb1a6, PepSwitc 0x4bbef8, Music 0x4bc773, Brikimal 0x4bd4a8, Spin 0x4bdbb2, Human1 0x4bec00, StartCSM 0x51e19c/0x51ea3c, Turn2Pep 0x52ff39, MeetPepp 0x530d69, BrickBot 0x531d45, building 0x534b89, BOTMUSIC 0x536961, speeder 0x538126, Sound3d 0x538779, Footy 0x53955e, SupaStat 0x53d66c, botPConly 0x53de63, LGI_FSM 0x4b8c73 |
| z03PPH | `FUN_0053ea4d`, sounds `53e7c0` | computer `FUN_005400d5` (hotspots `54042d`), trophy browser `54116c / 5413c4 / 5414b0 / 541b79 / 541f94`, ladder `5421af`, movies `53fe2b` | | 0x542b30 / 0x546012 | PeppComp 0x5400d5, PeppHse 0x5408c4, Trophy 0x54116c.., ClimLadr 0x5421af |
| z04IFC | (loop) | controller `FUN_0054c4a7`, pins `54ce86`, selected character `54b982`/`54bb49` | `FUN_0054e73e` | 0x54e760 / 0x55c4f9 | Map.c 0x54bc04, 0x54c4a7, 0x54c9f7, 0x54ccae |
| z05WAB | `FUN_00569ca6` | game logic `FUN_00569f50` (430 lines) + `56bb20` | | 0x56ce50 / 0x570679 | botwab 0x56b2d5, pepwab 0x56cd3b |
| z07CSI | wrapper `FUN_00572780` -> `FUN_00574d9c` -> `FUN_00573527` | horse `5769a8` (839), rats `575e70`, FSM-change `574e40`, per-stage NPC/trigger sets `57a6b6 / 57a8ae / 57abc9 / 57af76`, HUD `575ca0` | `FUN_00574e10` | 0x57b7c0 / 0x59b3cb | CSIFSM 0x575b44, Rattus 0x5763ca, Horse 0x579178.., Control 0x57a579 |
| z08BKD | `FUN_005ba1bd`, behaviours `5b9430` | swim `5c23f9`, camera `5c06d7`, behaviours FishBeh 0x5bc592 / CBallBeh 0x5bcd17 / CannBeh 0x5bd2b1 / PiroBeh 0x5bd8b4 / ClamBeh 0x5be08a / OctoBeh 0x5be5e0 / AnchBeh 0x5be9f0 / DolpBeh 0x5bf7ce / PageBeh 0x5bfad5 / BrkBeh 0x5c01e8; medals `5b7f60` | | 0x5c2940 / 0x5ca0a5 | BKDCmon 0x5bb2da |
| z09JST | behaviours `FUN_005cdb60` | duel FSM `FUN_005ce506` (983 lines, states 0..0x23), JSTGame `5d1f64`, Drkk `5d3ad4`, medal `5d4698` | | 0x5d4b60 / 0x5e628a | Anims 0x5d3cc1, Flag 0x5d3e7c, mfigman 0x5f3a90 |
| z10RGB | (loop) | update `FUN_005f49c5` (phase machine), PepSwitc `5f4f14..`, rgbgame `5f77ad..` (HUD/score `5f798f`, medal `5f7cec`), cannonball pool `5f8291`, Cedric AI `618ba6` | | 0x5f9200 / 0x60aeac | Init 0x5f712e, PeppHit 0x61884d, cedric 0x619863, cannon 0x61a57f |
| z13CAI | wrapper `FUN_0061aebb`, setup `FUN_0061b1f4` | `FUN_0061a7d2`, vehicle controller update `FUN_0061c0e0` (ctor `FUN_0061c2a4`) | | 0x61c3a0 / 0x621d05 | pepswitc 0x61c2a4 |
| z14OSD | wrapper `FUN_00628252`, setup `FUN_006290ea` | scorpion `62a120` (315), tumbleweed `629830`, gems `62b040`, PEPPSW `62b3b0/62b483`, cutscene builders `62c500`, `62bb80` | `FUN_006285d5`, `FUN_0062980d` | 0x62cd00 / 0x645d65 | Tumblewd 0x629d7e, scorpion 0x62ad35, Gems 0x62b220, PEPPSW 0x62ba3b |
| z15SSH | init `FUN_0065760c`, behaviours `657460` | cart/turret `FUN_00658c16` (332), snakes `657a30` | `FUN_00657827` | 0x65a5c0 / 0x66f47d | Walk.c 0x659d94 (ctor) |
| z16PYA | wrapper `FUN_00675f02`, setup `FUN_006768ce` | hint-cutscene builders `678000`, `677900`, `6775d0`; reuses OSD code | | 0x678ad0 / 0x68a987 | PeppSw 0x677350 / 0x677521 |
| z17WAS | init `FUN_00699bb4` | rules `FUN_00699e80` (474), Pepper `69b9b0` | | 0x69c040 / 0x6a00c1 | zonewas 0x69b337, pepwas 0x69bf24 |
| z18MMP | init `FUN_006a30c0` | Pepper/puzzle `FUN_006a4fd0` (1113 lines), symbol matching `6aadf6` (406), camera `6ac844`, mummy `6aa600`, key `6aa070`, page `6a9cc0`, rock `6a9930`, pillar `6a95d5`, spider `6a88db`, torch `6a8cf0` | | 0x6acc00 / 0x6b80f6 | Walk 0x6a81f6, spider, Torch, debris, pillar, rock, page, key, mummy, symbol, camera (0x6a8c1f..0x6aca97) |
| z20DSP | `FUN_006bf929`, behaviours `6be930 / 6bf633 / 6bfa9c` | Speedster `FUN_006c2627` (969 lines), WalkRock `6c0250`, Saucer `6c1630`, whirlwind `6c1990`, scoring `6c6d57`, Replay `6f3270` | `FUN_006bfa46` | 0x6c6f40 / 0x6e94b3 | SpeedStr 0x6c6495, WalkRock, ScrCone, Saucer, whirlwnd, Spin, falling, turbo, Bertha, Init 0x6bf7cc, Replay |
| z21FSH | `FUN_006f468d`, registration `6f3eec` | fishing FSM `FUN_006f6e2b` (644, 15 states), rod `6f94d4`, shoal `6f5dac`, Bertha `6f54c0` | `FUN_006f485b` | 0x6f9dd0 / 0x701a78 | Fishing, rod, FSwitch, Fisherman, Shoal, Splash, Bertha (0x6f51e6..0x6f9cdc) |
| z22BIP | `FUN_00708457` | flight `FUN_00709fac` (525), Takeoff `70c014`, Landing `70e42c`, Recover `70fdc0`, csplane `70db60`, monkey `70f433`, RopeSld `70ea60`, props, JerryCan | `FUN_0070860b` | 0x7103c0 / 0x72057f | Init.c 0x707da6 (+4 more), Walk 0x70b7b2, ..., 14 files |
| z23DIP | wrapper `FUN_0072645c`, setup `FUN_00726e25` | PeppSw `FUN_007277f1`, cutscene builders `72a2b0`, `7283e0` | | 0x72b7b0 / 0x74fac5 | PeppSw 0x727e84, 0x7281aa, 0x728333 |
| z27TRX | `FUN_00766b85`, registration `76649a` | run update `768510` (384), phases `76a39b`, lane/jump `7692a1 / 7698cf / 769d6e` | `FUN_00766ead` | 0x76b230 / 0x786b7c | trex 0x76adc5, gate, egg, logs, volcano, boulder, bronty, fly, anim |
| z28HAT | `FUN_007927b5` | balloon `FUN_00796e14` (279), Dino `794c26`, DinoBaby `793c44`, Bronty `795f80`, Fireball `793370`, Sandbag `792e60`, Winch `795770` | `FUN_00792888` | 0x797e90 / 0x7a6bf3 | 11 files 0x792d38..0x797d67 |
| z36CNT | `FUN_007afd2d` | state machine `FUN_007b0c6e` (290), input/lights `7b0401` | `FUN_007afe09` | 0x7b2910 / 0x7b48bc | TBob 0x7b2836, Walk 0x7b20a8 (TRAI controller) |
| z38PAR | `FUN_00466e90` | Pepper `FUN_004686a3` (649), HUD `466f50` | `FUN_00466f15` | 0x46add0 / 0x46ea70 | Boat, Bird, Balloon, Plane, Para, test.c (Pepper ctor 0x46a926) |
| z39ASB | `FUN_007b7281` | shuttle `FUN_007b82dd`, hit test `7b7f68`, asteroid layout `7b9917` | `FUN_007b736b` | 0x7b9b50 / 0x7c965f | Shuttle 0x7b96a0, Init 0x7b73a8 |
| z40aPO | `FUN_007d0b50` (+`7d0cb0`) | Pepper `FUN_007d3187` (629), rings `7d53af`, `7d19e0` | `FUN_007d0c82` | 0x7d5a70 / 0x7dda5a | Galaxy 0x7d1429, Asteroid 0x7d1778, Brickbot 0x7d2650, Rockmon 0x7d2bf2, Para 0x7d2fae, Parogel 0x7d53af, Init 0x7d077c |
| z40OGL | wrapper `FUN_007e2321` -> setup `FUN_007e4222` | walkers `7e5448`, `7e6542`; story `7e3bd1`; krystals `7e2c9a` | `FUN_007e4293` | 0x7e8800 / 0x7fe97e | Overlay 0x7e31fc, PeppSwit x7 (0x7e4f9c..0x7e6bb2) |
| z41MAP | `FUN_00813cce` / `8138bd` | Papa FSM `FUN_00812399`, toppings `815576`, medal `812dbb` | | 0x816ca0 / 0x81bcf7 | Papa 0x8132e0, Planet 0x814b0f, Slug 0x81529f, Topping 0x815e1a, mama 0x81611f |
| z42BRP | `FUN_008212a3`, behaviours `820f4e` | phase 1 `FUN_00823f08` (pepbrp), phase 2 `8224ba` (peptop, 657), Brickster `82714a`, bots `824a02`, zone objects `825378 / 826516` | | 0x8276f0 / 0x831690 | peptop, pepbrp, bottop, zonetop, zonebrp, brickst |
| z50LTC | (loop) | People `FUN_0083a7d2` / talk `83a292` | | 0x83ac50 / 0x849bb2 | People 0x83a7d2, pepswitc 0x83ab7b |

### 3.5 Hubs, eras and transitions

* **The island (z02LGI)** is one world re-used in four story eras, selected from the FSM node at zone start (`FUN_004b6475`, `FUN_004c3226(era)` does the one-time-per-era var reset, one bit of var `0xc1 AI_STATE_RESET` per era): era 0 nodes < 7 (pizza delivery; set `FUN_004c0ca9`), era 1 nodes 7-29 (pages, bot heads, Res-Q; `4c070c`), era 2 nodes 30-51 (police, `4c015e`), era 3 nodes 52-60 (`4bfd7d`), era 4 nodes >= 61 (space port / finale, same code as era 0). Each era loads a different NPC roster, cutscene slot table (`FUN_004c087a` 41 slots etc.), hint text (`LIFSMn.str`, `LIHOLn.str`) and objective arrow (`FUN_004b7040`: node -> `PHSE`, `PIZB`, `JAIL`, pages `PAG1-4`, `INFC`, `RESQ`, `PORS/SPBT`, `POLB`, `PORA/PHEL`, `RADI`, `TOWE`, wormhole).
  The arrival position follows `PREV_SUBGAME` (`FUN_004c2d22`): from z03PPH at `PHSE`, from z04IFC/z05WAB at `INFC`, from CSI at the sea portal `PORS` on a boat (control 8), from CAI/OSD/PYA/DIP at the air portal `PORA` in a helicopter or Pterodactyl (control 0x40), from z36CNT at `CTRL`, from z38PAR at `SPBT`, otherwise at the skate park.
* **Portals and doors**: generic trigger node `FUN_0051ea3c` (update `FUN_0051e5ab`, vtable 0x8ea088, "StartCSM.c"; used by 7 zones): proximity then a box test and the button mask 0x10; sets `PORTAL_VEHICLE` (0xbb), `PEPPER_CONTROL = 0x100`, ORs a value into a var, and writes **var 5 = target zone** (data +0x2e).
  Island portals: `PORS` (-447, 0, -630) -> zone 6 (castle), `PORA` (546, 133, 0) -> zone 10 (Adventure Island), `WORM` (-409, 129, -98) -> zone 34 (z50LTC, only if var 0xd != 0); `FUN_0052bc9b` activates the portals only from node 0x35. Doors (`building.c` `FUN_00535e80`, exit write `FUN_0053594e`): `PHSE` -> zone 3, `INFC` -> 4, `SKTP` -> 1; other buildings (HSE1-3, HOSP, GRGE, POLB, RADI, RESQ) have no exit.
  Waypoint-triggered cutscenes (`FUN_0051e19c`) advance the story nodes that leave the island (node 59 -> z36CNT, 60 -> z38PAR, 62 -> ASB, 63 -> APO, ...).
* **Adventure arc**: z13CAI is *not* a map but Adventure Island itself (helicopter flight over landmarks); OSD, PYA, DIP are separate walkable areas entered through the FSM (CAI's setup `FUN_0061b1f4` picks the `PORS` return zone from the node: < 6 -> 2, < 30 -> 31, < 51 -> 32, < 61 -> 33). The scorpion/tumbleweed/gem code of OSD (`FUN_00629d7e`, `FUN_0062ad35`, `FUN_0062b220`, `FUN_0062af8d`) is called directly from PYA.
* **Castle arc**: z07CSI nodes 15-29 interleave hub visits and BKD/JST/RGB; cutscene slots `csi01..09`; hint hologram texts `CSIHOL1-7` by node band (`FUN_00574e40`).
* **Ogel arc**: z40OGL nodes 64/66 (hologram hints `OGLHOL1/2`), z41MAP (65), z42BRP (67 = end). z40aPO and z39ASB are entered from the island (nodes 62/63).
* **Mini-game exits** go through `FUN_00404d14` (2.2); a player that quits a mini-game from the pause menu gets exit state 0/4 and the FSM rewinds to the last kind-1 node.

### 3.6 Medals and scores (analysed per zone; constants live in `.rdata` floats/ints, not re-verified)

Every mini-game stores `TROPHY_xxx` (0 none, 1 bronze, 2 silver, 3 gold, only ever raised) and `HISCORE_xxx`; "success" (to progress the story) is usually "at least bronze". Island totals `FUN_00423bf0` sum the per-zone hiscores (LGI = WAB+CNT+PAR+BPK, CSI = JST+RGB+BKD, ADV = SSH+WAS+MMP+DSP+FSH+BIP+TRX+HAT, OGL = APO+ASB+MAP+BRP) into the island scores and island trophies (thresholds 1 / 47001 / 55001 LGI; 1 / 30001 / 35001 CSI; 1 / 60001 / 70001 ADV; 1 / 35001 / 42001 OGL).

| zone | score | bronze / silver / gold |
|---|---|---|
| BPK | stunt score | 1 / 2501 / 5001 (`FUN_00493ecd`) |
| WAB | hit % x 100 | 5000 / 8000 / 9000 |
| CNT | rhythm score | 2000 / 4000 / 6000 |
| PAR | rings + landing | 2000 / 3000 / 5000 |
| BKD | air% x 179 + 1000 (page), only if 5 bricks | any / 6000 / 9000 |
| JST | hits taken | 2 hits / 1 hit / 0 hits |
| RGB | cannons destroyed etc. | any / 4001 / 7001 |
| SSH | gems left x 250 + hits | < 12 gems / 12-17 / >= 18 |
| WAS | gems/points | 101 / 5001 / 8501 |
| MMP | 10000 - f(time) | any / 6000 / 8000 |
| DSP | time (ticks?) | < 4500 / < 3600 / < 2700 (unit UNCERTAIN) |
| FSH | weight x 78 | < 4001 / 4001 / 7001 |
| BIP | landing outcome (score - 3000) / 2000 | landing / 7000 / 9000 |
| TRX | 10000 - (5 t + 250 hits) | > 2500 / > 5000 / > 7500 |
| HAT | rescues/sandbags (cap 10000) | 2500 / 5000 / 7500 |
| ASB | counter 10000 - hits | < 5001 / < 7001 / >= 7001 |
| APO | rings + landing | 2000 / 5000 / 8000 |
| MAP | topping matches | 2501 / 5001 / 7501 |
| BRP | 10000 - 55 (max(t,60)-60) | any / 5050 / 8350 |


---------------------------------------------------------------------------------------------------------------------------

## 4. Game object model

There is **no class hierarchy and no virtual dispatch between objects**. The world is a flat array of 0x68-byte *records*; each record may own a *controller* that holds a linked list of *behaviour nodes*; a node is a small struct plus a table of four function pointers, and it only
runs while a **game variable** satisfies `(var & mask) == value`. Pepper, vehicles, NPCs, doors, collectibles, even the sea and sky are records with nodes. Everything in this section is **analysed**, with the update/pre-render/draw passes **verified**
(`FUN_0042226e`, `FUN_004225c5`, `FUN_0042271b`).

### 4.1 Object record (0x68 bytes at `DAT_00983804`, count `DAT_00983800`; formats.md 6.5 for the loader side)

| offset | meaning | confidence |
|---|---|---|
| +0x00 | `char name[4]` (e.g. `PEPP`, `BRIK`, `LAND`); zone code finds records by name with `strncmp(rec, "XXXX", 4)` or by hard-coded index (`DAT_00983804 + 0x680` = LGI's PEPP, record 16) | high |
| +0x04 | model* (0x18 bytes: parts/LOD, attachment table, animation binding) | high |
| +0x08 | per-record **animation instance** (0x24 bytes, `FUN_0043b4e2(rig, 1)`; NULL for static) | high |
| +0x0c | 4x4 matrix (right +0x0c, up +0x1c, forward +0x2c, translation +0x3c/+0x40/+0x44) | high |
| +0x4c / +0x50 / +0x54 | Euler rx, ry (yaw), rz (the walk code writes yaw to +0x50 and rebuilds the matrix with `FUN_0043a5e4(rec+0xc, rx, ry, rz, px, py, pz)`; LGI's setup negates +0x50 for every record, `FUN_004b6475`) | high |
| +0x58 | collision object* (0xBABABABA/0 = none) | high |
| +0x5c | controller* (0 = static object) | high |
| +0x60 | flags u16 | high |
| +0x64 | u32 variant/phase `(set << 8) \| 1 \| (variant << 16)`: building-phase/outfit selector; `FUN_00421bbe` / `FUN_00421eb3` swap `rec+4` (model) and `rec+0x58` (collision) from tables at 0x8acb98 / 0x8acdc0 and re-attach children | medium |

Flags +0x60: `0x0001` in frustum (recomputed every frame by `FUN_00444370`); `0x0002` **enabled** (visible *and* collidable; hide = `&= 0xfffd`, show = `|= 2`); `0x0010` non-solid; `0x0020` solid even when hidden (unless query mask has 0x80); `0x0040` "NPC" (simple bound
collision unless mask has 0x40, `FUN_00426151` sets it); `0x0100/0x0200/0x0400` force LOD part 0/1/2 (`FUN_00443f90`); `0x8000` never draw. Draw predicate (`FUN_00444480`): `!(f & 0x8000) && (f & 1) && (f & 2)`. The builder writes flags = 2 for every record.

**Collision object** (shared per `.col` slot; formats.md 8.1): shape type at `col[0x13]` (0 polygon mesh, 1 sphere, 2 cylinder, 3 box), radius `col[9]`, live extents `col[0x16..0x18]`; `FUN_004427e0` resets to a box of the file extents, `FUN_00442780` / `FUN_004428b0` set custom box half-extents (used for trees, NPCs, vehicles).
**Query**: `FUN_00441270(rec, from, delta, outNormal, outT, mask, radius, skin)` sweeps against all records with the rule `((f & 0x20) && !(mask & 0x80)) || (f & 2)`, not `f & 0x10`, not the ignored record, radius > 0; returns the hit record (so callers read its name, e.g. `PAG`); `FUN_00441ac0` (sphere/ground probe), `FUN_00441b10` (ground ray), `FUN_004410e0` (NPC bound),
`FUN_004425c0` last surface id, `FUN_004425d0` the "ground" record set by `FUN_004425e0` (the `LAND` record), `FUN_0043cd62(pos, dy)` terrain height (downward ray into the ground record, -1e38 if none). Water level = `DAT_009da858` (2.4 in the island). Ground following: `FUN_00441270(rec, from, (0,-8,0), ..., mask 3, 0.6, 0.2)` + `FUN_0043cd62`.

**Models and LOD** (formats.md 6.3): `FUN_00444480` culls with 8 box corners and outcodes (`FUN_00416454`), picks the part by squared camera distance against the part's lod threshold (`FUN_00443f90`, biased by the adaptive detail level), draws via `FUN_0087d9a7` -> `FUN_0088aca2`
(three passes by alpha class, `DrawIndexedPrimitiveVB`); a record with an animation instance goes through `FUN_004440f0` (`FUN_0043ba7a` bone matrices; attachments from model+0xc drawn at `boneMatrix * recordMatrix`). `FUN_00444550(rec, partMask, value)` overwrites the part's second list with a render-mode int (1, 2, 5 seen; meaning UNCERTAIN).

### 4.2 Controller, behaviour nodes and the three passes

**Controller** (0x68 bytes, `FUN_0042382c(rec)`; only allocated when `DAT_008adc74 != 0`):

| offset | meaning |
|---|---|
| c[0] | head of the node list |
| c[1] | current *exclusive* node (only cleared in the traced code; where it gets set: not found, UNCERTAIN) |
| c[2] | bitmask of nodes that ran this frame |
| c[3] (+0x0c) | flags: 2 enabled, 4 exclusive node valid, 0x40 targetable (talk target); init 6 |
| +0x10 | **waypoint-walker handle** (index+1 into the walker table, `FUN_00462d4f`; not a camera) |
| +0x18 | squared XZ distance to the focus record `DAT_009da5d0` (computed each frame by `FUN_0042216f`; almost all proximity logic uses it) |
| +0x1c | float 512.0 |
| +0x20..+0x64 | generic probe state: in/out position, delta/normal, radii (+0x44/+0x48), mask (+0x4c), flags (+0x5c: 1 accumulate, 2 write back, 4 offset, 8 store normal, 0x10/0x20 terrain probe, 0x40 skip, 0x1000 y only), timer (+0x60, init -1), hit result (+0x64); run by `FUN_00427233` (bit mapping UNCERTAIN) |

**Behaviour node** (own constructor allocates 0x18-0x74+ bytes):

| offset | meaning |
|---|---|
| +0x00 | game-variable index |
| +0x04 | handler table* `{ +0 update, +4 pre-render, +8 destroy, +0xc draw [, further slots in newer constructors: UNCERTAIN] }` |
| +0x08 | frame stamp (init 0xFFFFFFFE; `= DAT_009da5cc + 1` after the pre-render hook) |
| +0x0c / +0x0e | u16 mask / u16 value |
| +0x10 | next node |
| +0x14.. | private state (per class) |

* **Gate**: a node runs only when `(gameVar[node.var] & mask) == value`; mask 0, value 0 means always; var 2 (`NS_ON`, always 1) with mask 1 / value 1 is the conventional "always on".
* **Attach**: `FUN_00423532(rec, ctor, ctorArg, pos, var, mask, value)`: `pos` 0 resets the list and makes it the head, `n` inserts at index n (appends if shorter); allocates a node through the constructor `ctor(rec, ctorArg, nodeOrNULL, var, mask, value)`
  (or re-initialises the existing node when `DAT_008adc74 == 0`); `FUN_004237b6(mode)` sets that flag; `FUN_004238b7` sets a node parameter. **1,107 attach calls over 220 distinct constructors** in the EXE (13 shared, 4 in the high library, the rest per zone: z02LGI 41, z22BIP 15, z08BKD 12, z18MMP 11, z28HAT 10, ...).
* **Pass 1 - update** `FUN_0042226e` (frozen when `DAT_009da5c8 != 0`): per record with a controller and `c[3] & 2`: compute `c+0x18`, clear `c[2]`; if `c[1]` is set and its gate holds run its `update(rec, node, ctrl, gameVarValue)`; otherwise walk the list: for each node whose gate holds call `update`; return code **0** nothing ran, **2** ran and continue, **1** ran and stop the chain,
  **3** ran, then re-run `c[1]`'s update (if that returns 0 only the node's own bit stays set); every node that ran sets its bit in `c[2]`.
* **Pass 2 - pre-render** `FUN_004225c5`: calls table[+4] for the nodes in `c[2]` and stamps `node+8 = frame + 1`; increments `DAT_009da5cc` (frame counter).
* **Pass 3 - draw** `FUN_0042271b`: calls table[+0xc] of the nodes that ran; return 1 stops, other non-zero = handled, if nothing handled -> default `FUN_00444480`.
* **Destroy** `FUN_00423ad4`: table[+8] of each node (or free), frees controllers, sets `DAT_008adc74 = -1`; `FUN_004232a0` frees models/meshes/collision/animation instances/records.
* The island's init runs one update on PEPP alone before the first frame (`FUN_0042226e(DAT_00983804 + 0x680, 1)`, `FUN_004afaf7`).

### 4.3 Messaging between objects (analysed)

No event queue, no object-to-object calls. Four channels:

1. **Game variables** (array 0x8a2d2c; get `FUN_00417575`, set `FUN_00417597`, or `FUN_0041761b`, and-not `FUN_0041766c`, add `FUN_004175ca`; vars 1 and 2 are read-only, var 2 reads 1). The `SWITCH_*` names are the "switches". **`PEPPER_CONTROL` (var 0x5e)** is the mode word of the player: its bits select which of Pepper's nodes is active.
2. **Globals**: `DAT_009da5d0` focus record (usually PEPP), `DAT_009da5d8` camera target matrix, `DAT_009da5e8` camera struct, `DAT_008ae088` walk-state "mailbox" (consumed at the top of `FUN_0042d514`), `DAT_009daa80` current interactive record, `DAT_00983840/3c` pressed/held mask, `DAT_008b1718` timestep.
3. **Hard-coded record indices** (e.g. `DAT_00983804 + 0x680`), and by name (`strncmp`).
4. **Direct pointer access** through the node's constructor argument struct (vehicle parts, attached children).

### 4.4 The player (Pepper), input to motion

* **Pepper = record `PEPP`** (index differs per zone: 16 in the island, 7 castle, 35 BPK, 8 PAR, ...). Its node chain keyed on `PEPPER_CONTROL`, island (`FUN_004b4220`): always `Music` (`FUN_004bc773`) and `PepSwitc` (`FUN_004bbef8`); bit 1 **SGwalk** (`FUN_0042f470`); bit 2 **sgswim** (`FUN_0088cf13`); bit 4 the **skateboard** (`FUN_0043310c`, a thunk to `FUN_00492cc2`, the `skate.c` node that lives in z01BPK's code region and is shared); bit 8 **SGVehic** (`FUN_004333c2`, delegates to the vehicle's own node); bit 0x40 **Ptera ride** (`FUN_004bb582`);
  bits 0x100 busy/cutscene lock (written by trigger nodes and the cutscene start), 0x10 pizza aim, 0x20 stung/talk (OSD scorpion `FUN_0062af8d`; LTC talk), 0x1000 interact (UNCERTAIN). Mode transitions are written by **PepSwitc** (`FUN_004bb67d`: reads `gameVar[0x5e] & 0xfff`; Ctrl enters/leaves a vehicle, `FUN_0088e030` finds a free spot using `FUN_0043cd62`/`FUN_00441ac0`; sets `DAT_008ae088`, vars 0xa9 `PEPP_IN_VEHICLE` and 0xbb `PORTAL_VEHICLE`).
  SGwalk is attached in 10 zones (island, PPH, CSI, RGB, OSD, PYA, FSH, DIP, OGL, LTC); the other zones have their own `Walk.c`/`PeppSw.c` variants (3.2).
* **Input mask** (`FUN_004376f9`, table 0x8aeb20, 13 entries x 0x30 bytes: default key, current key from Settings[4..16], logical bit): 1 Left, 2 Right, 4 Up, 8 Down, 0x10 Ctrl, 0x20 Alt, 0x40 Shift, 0x80 Space, 0x1000 (key 0x56 `<>`), 0x2000 Z, 0x4000 X, 0x8000 C, 0x10000 Enter; Esc 0x40000000; any key 0x80000000. In play: Alt (0x20, edge) jump; Shift (0x40) use/pizza/talk; Z/X/C and 0x1000 rotate/zoom the camera; Ctrl enter/leave vehicle.
* **SGwalk update** `FUN_0042d514` (handler table 0x8ae048, node 0x74 bytes; node +0x18 = state = animation clip id passed to `FUN_0043b6a3`): states 0x01 jump, 0x03 turn, 0x08 walk, 0x0d run, 0x24/0x3f/0x40/0x42 fast run, 0x0b/0x0c stagger, 0x1a knockback, 0x1b idle, 0x37 slide, 0x38 land, 0x57 hard landing...; transitions `FUN_0042a88f`, input mapping `FUN_0042a487`/`FUN_0042a654`.
  The stick vector (+-0x20 dead zone) is rotated into world space by the camera basis (`DAT_009da60c..`), magnitude clamped to 1, yaw written to rec+0x50; walk->run by magnitude thresholds 0.01/0.05/0.4. **Jump**: `y = y0 + v t + g t^2/2`, `t += 0.1 dt`, v0 15.0 standing (`DAT_008ae070`) / 17.5 running (`DAT_008ae074`), gravity `DAT_009da9bc`. Wall slide: sphere sweeps at height +4, masks 3 / 0x43, removing the normal component; steep slope -> state 0x37. Footsteps from animation frames (`FUN_0042baf6`).
* **Chase camera** (walking; inline in the walk code, not a separate object): `FUN_0042c227` (497 lines) on the camera struct `DAT_009da5e8` (eye [0..2], look-at [3..5], orbit velocities [9..14]): radius clamp 12..28 (`DAT_008ae060/64`), height 5.6..28 (10 / 11.6 in vehicles), target eases to the record target with factor 0.35; collision `FUN_00441270(PEPP, ..., mask 0xc3, 1.0, 1.0)`; `FUN_004229a0` pulls the eye in front of walls (kind-1 zones only). Per-frame trio: `FUN_0043cc5c` (view matrix), `FUN_004434d0` (set camera), `FUN_00444370` (frustum flags).

### 4.5 Vehicles

Not separate objects: parts are records, the controller is a node on the vehicle's record, enabled by `MOVE_*` vars (BOAT 0x82, JSKI 0xb2, PHEL 0x3e, RHEL 0xbe, PTER 0xb6, ...). Boats `SGBoat` (`FUN_00430e6c`, table 0x8ae1f0, update `FUN_0042f9a2`; type from the first letter of the record name S/J/D = speedboat/jetski/dinghy; Space/Alt throttle, Left/Right steer, collision mask 3 radius 0.8), helicopters `SGHeli` (`FUN_004325e8`, table 0x8ae288, update `FUN_00431425`),
cars `SGCar` (`FUN_0088fb35`, update `FUN_0088ed56`), swimming `sgswim` (`FUN_0088d1f6`). The ctor arg holds the sibling part records (hull, wake, props: flags set to 0x10, hidden with `&= ~2`, `FUN_00444550(rec, 0xff, 2)`). Vehicles in the island are brick-morph models animated by `BrickMorph/*.txt` clips (`FUN_00447d20/da0/d70`, FX_Bricks); roster table at 0x8e9b28 (`FUN_0051c823`).

### 4.6 NPCs, AI, waypoints

* **Waypoint walker** (Common\WayPt, 0x461xxx-0x462xxx): table of 60 walkers at 0x05d4e1b0 (stride 0x84, handle = index+1), 4 maps (slots 0 ROAD, 1 PATH, 2 CSM, 3 OTH; 0x1f08 bytes each at 0x05d500b0, node array +0x1f00, 0x20 per node), loaded by `FUN_004630c0` (`W_<MAP>_C.wpt`, formats.md 7.1; 31 call sites).
  Create `FUN_004614d5(map, rec, startNode)` (-1 nearest node, -3 none; cached in `c+0x10` through `FUN_00462d4f`), free `FUN_00461a3b`; orders: `FUN_00461c24` go to node, `FUN_00462729` follow a record, `FUN_004627e2` go to point, `FUN_004625d7` teleport/re-pin; step `FUN_004626d0(handle, pos, yaw, out)` (-1 arrived, -3 done), apply `FUN_00461fe4`; routing `FUN_00463b49` (matrix lookup), position `FUN_00462be9`, name lookup `FUN_00462b4e` (prefix match);
  tuning `FUN_00462206` speed, `FUN_00461ad6` lane offset, `FUN_00462324` turn rate (0.5236 rad). Flags word top nibble = mode (0x80000000 route, 0x20000000 follow, 0x60000000 point).
* **Generic talking NPC** `FUN_00426151` (89 uses: CSI 36, DIP 16, OGL 13, PYA 9, LGI 7, OSD 7, FSH 1): vtable 0x8adce0 `{ update FUN_00425c13, prerender FUN_00426014, destroy FUN_0042651e, draw FUN_004260d6 }`; creates the walker, snaps to the terrain, flag 0x40; its var is the NPC's `MOVE_<NAME>` var used as a state bitfield (conversation `FUN_004249a6`, state logic `FUN_00424526/0042477f/00425902`: bit meanings UNCERTAIN).
  Shift picks the nearest talk target (`FUN_0042796e`: within 200 units, about 45 degrees of facing, `c[3] & 0x40`). Companion nodes: `Turn2Pep` (`FUN_0052ff39`, `FUN_005306e5`: NPC turns to Pepper), `MeetPepp` (`FUN_00530d69`), `Human1` (`FUN_004bec00`, update `FUN_004be20f`: waypoint route with timing; `FUN_004bf329` jump arc), `BrickBot` (`FUN_00531d45`.., update `FUN_00532bb1`).
* **Animals/ambient**: Bunny (`FUN_004b2149`, update `FUN_004b18fb`: hops between 3 burrow positions (table 0x8d9208), 7 states), butterflies `4b2d44`, swift flock `4b31db/4b3a92` (`bat.man`, `swift.man`), Ptera (`FUN_004bb1a6`, update `FUN_004b93b0`, 620 lines, 10 waypoint slots), Brikimals (`FUN_004bd4a8`, brick-morph `animal00-07.txt`), seagulls (`FUN_004b4000`).
* **Buildings and doors** (`building.c`): records `PHSE (+PH01-10 build stages)`, `INFC`, `HSE1-3`, `HOSP`, `SKTP`, `GRGE`, `POLB`, `RADI`, `RESQ`, `PIZB`, `TOWE`; `FUN_00533d30` shows/hides props with the building (`RESQ`<->`SPBT`, `POLB`<->`PCAR/PHEL/JAIL/FECL`, ...); door node `FUN_00535e80`; house phases from `NUM_BRICKS`.

### 4.7 Animation API (SDAnim; formats.md 8.2 for the data)

Template `FUN_0043b1ff(.blk)`, instance `FUN_0043b4e2(rig, 1)`: +4 flags (1 private matrix buffer, 2 no interpolation), +8 clip data (clip +0 flags with 0x10 = loop, +8 frame count), +0xc clip index, +0x10 frame (float), +0x14 bone count, +0x1c clip array, +0x20 pose buffer. `FUN_0043b6a3(inst, clip, startFrame)` start; `FUN_0043b76a(inst, rate)` advance `rate*dt`, returns 1 on loop wrap, 2 at the end of a one-shot; `FUN_0043b64d` seek; `FUN_0043b73f` frame; `FUN_0043b72b` clip; `FUN_0043b753` clip length; pose `FUN_0043ba7a` (quaternion lerp) -> `FUN_0043b987` (bone matrices). Model-level binding `FUN_0043f1d0(model, slot|-1, clip, params, flag)`; expression/mouth frames `FUN_0043f2f0`.
Spline (`.man`) tracks: `FUN_0043ee40` (actors), `FUN_004454e0` (camera), eval `FUN_00445660(anim, t, matrix)`.

### 4.8 Generic vs per-zone, and what a port's engine core needs

* **Generic (once)**: record loader + flags, controller/node framework with the 3 passes and gating, game-variable array, collision query + ground ray + analytic shapes + probe pass, animation player + attachments, waypoint walker, input mapper, timing, 2D/HUD/text, menu engine, cutscene manager, sound/music, FX (particles, bricks).
  About 1,630 shared functions / 55k decompiled lines (0x401000-0x465d39) + 880 tail functions (mostly CRT + the model/draw library).
* **Per zone**: the 220 behaviour constructors, the GameLoop (template), Init/Walk/PepSwitc variants, the setup function that registers nodes (hundreds of mostly straight-line `FUN_00423532` calls with constant operands: these can largely be extracted like the builder tables instead of hand-written, see 8.2).
* Behaviours **shared across zones but located in the island's region** (0x4b..0x53xxxx): StartCSM/portal trigger `FUN_0051ea3c`, Turn2Pep, MeetPepp, Human1, Spin, BrickBot, building, Footy... (called from CSI, OSD, PYA, FSH, DIP, OGL).


---------------------------------------------------------------------------------------------------------------------------

## 5. Scripts and cutscenes

**Cutscene selection is code, execution is data.** The `.txt`/`.cut` files (formats.md 8.3; 139 sources, 87 compiled) are run by the **CSM** ("cutscene manager", `Common\CSM`, 0x458a4c-0x45f9d2); *which* script plays when is hard-coded in the zones (story handlers, trigger nodes). There is no general-purpose
scripting language: no conditionals, no variables except "set a game variable", no loops. Other "script-like" data: particle `.par`, waypoint `.wpt`, brick-model `.txt`, light `.lgt`, message `.str` - each has its own small loader (5.5).

### 5.1 API and run model (analysed; manager in 0x45c3xx-0x45c4xx)

* Per zone setup: `FUN_0045c310(n)` allocates `n` script slots (100 bytes each, `DAT_05d4790c`), `FUN_0045c366(zoneDir, areaCode)` (area `li`/`ci`/`ai`/`og` = message folder), then `FUN_0045c397(slot, scriptName, strName)` per script:
  script path `<root>/<zone>/cutscene/<name>.txt`, messages `<root>/messages/<area>/Data/<strName>.str`. **The `.str` name can differ from the script name** (LGIPH09-11 use LGIPH08-10's strings, `csi02a` uses `csi02`, `BRP01` uses `ogl02`, `ogl02` uses `apo01`): always take the third argument.
  Examples of setup sites: island `FUN_004bf65b` (9 slots), `4bfe4b` (7), `4c03bd` (7), `4c087a` (41: bpk01, LGICI01-25, LGIPH01-11, LGI01-04); CSI `57a660`, `57a830`, `57ab10`, `57af20`; OSD `629080`; PYA `676418`; FSH `6f4623`; DIP `726dbb`; HAT `791940`; OGL `7d0839`, `7e3679`; BRP `820f12`.
* **Start** `FUN_0045c40c(slot)` (ignored while `STARTEDFROMMENU` (var 0xb) != 0) -> `FUN_00458d15`: one script at a time with a one-deep queue (`DAT_05d4790b`); saves the camera block (18 dwords at `DAT_009da5e8`) and FOV, sets default camera speeds, builds the wait counters, turns on the letterbox bars (`FUN_0045f750(1)`, drawn by the HUD `FUN_0046055f`), `PEPPER_CONTROL |= 0x100`.
  **Per frame** `FUN_0045c402` -> `FUN_00458f50` (called from each zone loop in mode 2). **Active?** `FUN_0045c432` (flag `DAT_05d47908`, override `DAT_05d4dc8c` set by dialogs/triggers via `FUN_0045c456`); story-node changes are deferred while a cutscene runs (`FUN_004afaf7`).
* **Scheduler** `FUN_00459119` (3 passes): pending commands whose `waitId` counter is 0 start (state 1; actors register with `FUN_00458fa6`, up to 48, which clears the actor's AI-enabled bit (`ctrl+0xc` bit 2) and sets up a path follower); running commands run `FUN_00459597` (delay countdown `0.03333 * dt` per frame, then the handler every frame; handler returns 1 running / 2 done);
  done commands decrement `counter[signalId]` (state 3). Counter[0] = 0, unused ids 0xFF (waiting on an id that nobody signals blocks forever). **The script ends when no command ran this frame** (pending ones don't count). On end: bars out, `0x5e &= ~0x100`, FOV restored, AI re-enabled, followers re-pinned, PEPP idle animation restored, camera put behind her (`FUN_0046265d`, `FUN_00422f21`); a queued script then starts.
  Skip key = pressed-edge of mask 0x40 (Shift / pad button 2): zeroes delays, snaps moves/animations/speech to done.
* **Timing**: delays/durations/speech timers are seconds at 30 Hz scaled by `DAT_008b1718`; camera and move easing steps are *per frame* (not scaled; UNCERTAIN), spline playback is scaled (`t += rate * dt`).
* **Camera**: no `.cam` in this system; positions come from `W_CSM` waypoints/splines; globals `DAT_009da5e8..f0` eye, `..f4..fc` target; ease constants set by SETMOVESPEED (0.1a / 0.02b) and SETTARGETSPEED; `FUN_0045edae` start, `FUN_0045eff9` ease-in, `FUN_0045f1bc` ease-out, `FUN_0045f2f4` driver; actor-relative camera `FUN_00422f21` (side flags, 3.37 height).
* **Speech/subtitles** `FUN_0045cf83`: text `FUN_004396a0(table, id)`, voice id via `FUN_00439bf8`, `FUN_00435a11(voice, -1)` if var 9 (`CS_SPEECH_ON`) and id >= 0; word-wrap to 4 lines (`FUN_0045d47f`) only if var 0 (`CS_TEXT_ON`); timer `(strlen + 20 + duration) / 20` s; random mouth frames `FUN_0043f2f0`.
* **Variables**: only SETSWITCH (`FUN_0045f670`: index resolved at load through the switch dictionary, then `FUN_00417597`). The scripts therefore *signal* zone code (`SWITCH_LGI_CSM_FX_SWITCHnn`, `SWITCH_LGI_BRICKFX_<BLDG>`, `MOVE_*`...), and the zone code polls those vars (the island's "director" node `FUN_004b7c78` implements sound cues (table `DAT_008d9460`), heli rotor spin, `INFC` window swing, pizza-throw animation, wormhole scale-in and BRICKFX particles for the island scripts).

### 5.2 Loading and the in-EXE compiler (analysed)

`FUN_0045d68a` (Loader.c): `.txt` goes through `FUN_00459c46` (Convert.c), a `.cut` is read directly. **The game contains its own text->binary compiler**: `FUN_00459c46` tries to open `<name>.cut`; only if absent it compiles the `.txt` (checks the header with `sscanf("%s %s %i")`, version 0, upper-cases, `FUN_00459fc6` scans `%i %f %s %s` per line, command id from the dictionary `DAT_05d4833c`, per-command parsers `FUN_0045b667`, `0045b6f8`, `0045b289`, `0045b388`, `0045b4b8`, errors `FUN_0045beb8`) and writes the `.cut`. The shipped `.cut` files are exactly this cache.
`.cut`: u32 nameLen, name, u32 version, u32 command count, then per command u32 cmd, 4 actor chars, fixed-size body copied into a 0x70-byte runtime struct (array at slot+0x58). **Actors** are looked up by 4-char name in the zone's record array (`FUN_0045d5c0`; `CMRA`, `SWCH`, `PLAY` are global); an unknown actor aborts loading (remaining commands zeroed = no-ops).
Waypoints are resolved at load: `FUN_00462b4e(name, slot)` (CSM slot 2 first, then PATH slot 1; prefix match) and cached with `FUN_00462be9`; animation names go through the per-zone dictionary `DAT_05d4d484` (**hard-coded in each zone's init**: ~0x8e entries `PEP_JUMPINAIR...` in the island region, 0xb entries `PEP_PARACYCLE...` in a mini-game init), switch names through `DAT_00987e20` (per zone: island `FUN_00523200` 0x46 names `SWITCH_LGI_*` -> vars 0xfa..; CSI `0057b140`; OGL-area `FUN_00810ed0` 0x3b names; `FUN_00542520`, `FUN_008387c0`) then `DAT_00987e1c` (the 229 `SWITCH_GME_*`, `FUN_00417990`).
`.man` splines ("matanim") for camera (`FUN_004454e0`) and actors (`FUN_0043ee40`).

### 5.3 Instruction set (ids from `FUN_0045988b`; actor handler via `FUN_0045c49d`, global/camera handler via `FUN_0045eaf0`)

| id | command | handler | effect |
|---|---|---|---|
| 0 | SETVISIBILITY | A `FUN_0045c595` | actor flag `+0x60 \|= 2` / `&= ~2` (note: bit 2 = *enabled*, `TR...` prefix = 1) |
| 1 | SETANIM | A `FUN_0045ce77` | `FUN_0043b6a3(actor+8, id)`; done when `FUN_0043b92a` says the clip ended, then waits the extra duration |
| 2 | SAYTEXT | A `FUN_0045cf83` | speech + subtitle (above) |
| 3 | SETTARGET | A `FUN_0045cd23`, G `FUN_0045ec4f` | actor: instant yaw towards a point (atan2) + matrix rebuild; camera: set look-at to a waypoint or an actor (+3.37 height) once |
| 4 | MOVETARGET | G `FUN_0045eeaa` | camera look-at eases to waypoint / actor / spline (no-op for actors) |
| 5 | SETPOSITION | A `FUN_0045c5e2`, G `FUN_0045ebc8` | teleport to a waypoint / camera position (waypoint, or actor-relative with side flags) |
| 6 | MOVEPOSITION | A `FUN_0045c66b` (+`45c80d`), G `FUN_0045ecec` | actor: follower walk to a waypoint (`FUN_00461c24`, step `FUN_004626d0`) or spline; camera eased move or spline; stays running until arrival, then holds the duration |
| 7 | FOLLOW | A `FUN_0045cb50`, G `FUN_0045f543` | actor follows another actor (`FUN_00462729`); camera look-at = actor + 3.37 every frame (the keyword `ACTOR` parses as code `ACTO`, which does nothing; UNCERTAIN whether intended) |
| 8 | SETSWITCH | G `FUN_0045f670` | game variable := value |
| 9 | WAV / MIDI | G `FUN_0045f702` | stub; never emitted |
| 10 / 11 | SETMOVESPEED / SETTARGETSPEED | G `FUN_0045f5b8` | camera ease constants |
| 12 | SETFOV | G `FUN_0045f64b` | `FUN_0040cd1a(fov)` |
| 13 | SETEXPRESSION | A `FUN_0045d294` | mouth/face frame `FUN_0043f2f0(actor+4, n)` |
| 14 | ATTACH | A `FUN_0045d2b9` | attach an actor to a bone via `FUN_00429638` (bones GOB 0, RIGHTHAND 0xe, LEFTHAND 0x10) |
| 15 | ENABLEAI | A `FUN_0045d301` | `ctrl+0xc` bit 2 set/clear |

Dictionaries built by `FUN_0045988b`: command names `DAT_05d4833c`, WAYPOINT/ACTOR/SPLINE `DAT_05d4d34c`, camera side words HEAD/FRONT/BEHIND/LSIDE/RSIDE `DAT_05d48334`, expressions `DAT_05d4d348`, bones `DAT_05d48330`. The compiled `lineCount` includes rejected lines: read exactly that many records. The existing `src/formats/cutscene.ts` already parses/compiles the file format.

### 5.4 Triggers and hard-coded selection

* **StartCSM.c** (island region): `FUN_0051e19c` (waypoint-based) and `FUN_0051ea3c` (radius/box; also the portal) are trigger node constructors, update `FUN_0051dd7e`: slot id s16 at node+0x38, radius^2 at +0x1c, key mask +0x30; fires when Pepper is near and (mask == 0 or the key pressed): clears `INTERACT_ICONS` (var 0xc) and `0x5e & 0x1000`, calls `FUN_0045c40c`.
* **Generic NPC/trigger code** `FUN_00425902`/`FUN_00425c13`: house construction picks slot `0x1a + var 0xAD (HOUSECONTRUCTIONPHASE)` (LGIPH01+phase); page pickup `FUN_00534d98` slot table[var 0xC4 `PAGECOUNTER`] (table `DAT_05d586c4`).
* **Story handlers** (not cutscene scripts): island `FUN_004b7040` (switch on node; returns early while a cutscene runs) selects message files `lifsmN.str` / `lihol1..` and sets objective arrows; CSI `FUN_00574e40` (bands of var 0x58); `LGI_FSM.c` `FUN_004b8c73` and `CSIFSM.c` `FUN_00575b44` are *only constructors* of nodes (36 lines).

### 5.5 Other script-like formats and their interpreters (analysed, overview)

| format | loader / interpreter | notes |
|---|---|---|
| `.par` particle scripts | loader `FUN_00450e20` (ParticleEngine_File.cpp), interpreter `FUN_00455750` (CParticleActionManager.cpp); lines `[SCRIPT]` then `%s %s %f %f + 10 floats`: first word ForNew (43) / ForAll (44), second the action name looked up in the table at 0x8b6fb0 (84-byte entries) | builders `FUN_00457850` (scalar), `00457970`, `00457c70` (colour), `00457ab0` (vector), `00457f80` SetEmiPrimitive (41), 45 ResetScript, 46 EndSource, 47 ExecuteScript (recursive `.par` include, loads `.app/.mov/.emi`); 42 SetEmissionParticle parsed, no object found (UNCERTAIN) |
| `.app` `.emi` `.mov` `.swl` | `FUN_00450250`, `FUN_004509b0`, `FUN_00450640`, swirl `FUN_00451600` | key/value files read through `AIT2BFile` |
| **`AIT2BFile.c`** (`FUN_0087d248`, wrapper `FUN_0087d145`) | **not a binary converter**: a text-line reader with `//` comment filtering (0x118-byte object: path, size, line count, cursor, line pointers); used **only** by the particle loaders | "T2B" = text to binary only by name |
| `.wpt` waypoints | `FUN_004630c0` (Load.c; 4 slots) | 4.6 |
| `.lgt` | `FUN_008864b6`, `FUN_008849c6` (Lights.cpp) | |
| `.str` | `FUN_00439126` (tag file), `FUN_004396a0` lookup, `FUN_004397b9` expand, `FUN_00439bf8` text + voice id | formats.md 8.3.2 |
| brick models `BrickMorph/*.txt`, `Bricks/brickset.txt` | `FUN_0044d570` (TBrickModel.c, `NEWLAYER`), `FUN_0044ddd0` (BrickRead.c chunks `VRTL`/`WRTL`), `FUN_0044a5e0` (Bricks.c, `bricks/LODS/%s_lod%i.msh`), `FUN_0044d170`, manager `FUN_00449920`, per-frame `FUN_00449b00` | FX_Bricks 157 functions / 8k lines |
| `.mtl`, `.src`, `.gob` | no loader in the EXE (formats.md: mostly empty) | |


---------------------------------------------------------------------------------------------------------------------------

## 6. Global game state, progression, save game, options

### 6.1 The game-variable array (verified layout; usage analysed)

One global `int[319]` at VA 0x8a2d2c. Names: table of 319 string pointers at 0x8a3228 (`tools/gamevars.tsv`); `FUN_00417990` registers 229 of them (13 `NS`, 210 `GME` 15-224, 6 `MS` 235-240; the `SUBGAME:n` vars have no script name) in the script dictionary `DAT_00987e1c` (`FUN_0045bf20` = TDict, capacity 0xe5). Accessors: get `FUN_00417575(i)`, set `FUN_00417597(i, v)` (ignores 1 and 2), or `FUN_0041761b`, and-not `FUN_0041766c`, add `FUN_004175ca`; `FUN_004176c1` classifies index ranges (< 0xf, < 0xeb, < 0xfa).

| ids | prefix | role |
|---|---|---|
| 0-12 | `SWITCH_NS_*` | volatile: 0 `CS_TEXT_ON` (subtitles), 1 `OFF` (always 0), 2 `ON` (always 1), 3 `PREVIOUS_SUBGAME`, 4 `SDDIG`, 5 **`NEXT_SUBGAME`**, 6 `PLAYER_ACTIVATE_CSM`, 7 `CSM_ACTIVE`, 8 `PAUL_TEST`, 9 `CS_SPEECH_ON`, 10 `FX_PARTICLE_ONLYRENDER`, 11 (0xb) **`STARTEDFROMMENU`**, 12 (0xc) `INTERACT_ICONS` |
| 15-224 | `SWITCH_GME_*` | **saved game state** (210 vars): see below |
| 235-240 | `SWITCH_MS_*` | `SCREEN_OFFSETX`, `VIBRATION_ON`, `SPEECH_VOLUME`, `MUSIC_VOLUME`, `SFX_VOLUME`, `SCREEN_OFFSETY` (console leftovers: no readers) |
| 250-317 | `SUBGAME:n` | **zone-local scratch**: cleared by `FUN_004177ed` (0xfa..0x13e) before every zone; used by scripts/triggers as flags and by zones as scratch (e.g. `0xfa` = phase in BIP/TRX/BRP, `0xff` = race state in DSP) |

Important `GME` vars (hex): `0x58 FSM_CURRENT_STATE`, `0x59 CURRENT_SUBGAME`, `0xa3 PREV_SUBGAME`, `0x53 COMPLETE_SUB_GAME`, `0x5e PEPPER_CONTROL` (player mode bitfield, 4.4), `0x4f NUM_BRICKS` / `0xb0 NUM_PIZZAS` (start at 11, count down), `0x52 NUM_BOT_HEADS`, `0x8e COLORED_BOTHEADS` (bit 1 yellow, 2 red, 4 green, 8 blue),
`0xa5 NUM_PAGES`, `0x26 PAGES_SET`, `0xc4 PAGECOUNTER`, `0x51 BRICKSTER_ESCAPED`, `0xad HOUSECONTRUCTIONPHASE`, `0xb3 PEPPHOUSE_SIZE`, `0x50 BLDG_PHSE`, `0x63 PIZZAS_THROWN` (bits 1/2/4 = 3 pizzas in flight), `0xa9 PEPP_IN_VEHICLE`, `0xbb PORTAL_VEHICLE`, `0xc1 AI_STATE_RESET` (one bit per island era), `0xc5 PEPPERSSHADOW`, `0x120 LGI_GAMELOOP`, `0x4d PPH_MENU_INTERNALS`.
Group sizes (analysed): 16 `BLDG_*` (RESQ, SHP1, SPACE start at 1), 55 `MOVE_*` (per-NPC/bot "location/move words", reset by `FUN_004c3226`, written by scripts and trigger nodes), 30 `CSM_SFXn` (cutscene "played once" flags), 10 `VEHICLE_*` unlock flags (script-only), per-zone `TROPHY_xxx` (0..3) and `HISCORE_xxx`, island `SCORE_xxx`, `*_GEMS`, `OGL_KRYSTALS`.
Totals: `FUN_00423bf0` recomputes the island totals and trophies each time a zone starts (3.6). `FUN_00421bbe`/`FUN_00421eb3` save/restore the building/outfit phase bytes (`DAT_009d9fd0`) of records.
**Static initial values** (from `.data`): `CS_TEXT_ON = 1`, `NS_ON = 1`, `CS_SPEECH_ON = 1`, `BLDG_RESQ = BLDG_SHP1 = BLDG_SPACE = 1`, `DSP_BESTTIME = 3600`.

### 6.2 Story progression (2.2) and collectibles

The story is the 72-node FSM of 2.2; progress within a node is encoded in vars (bricks `NUM_BRICKS` 11 -> 0, pizzas, pages 0..4, bot heads, `MOVE_*`, `CSIWP`...). **Collectibles**: 11 bricks / pizzas (Pizza.c: thrown, `SCORE_LGI += 1000` on delivery; type-2 customers also advance `HOUSECONTRUCTIONPHASE`, start slot LGIPH01+phase and decrement `NUM_BRICKS`; Pepper's house has 10 build stages `PH01-PH10`), 4 Constructopedia pages (`PAG1-4`, `NUM_PAGES`),
4 coloured bot heads, castle goblets (10, `0xbc` bitmask, +1000 each), oasis/pyramid/dino gems (+1000 each into `SCORE_ADV`/`HISCORE_CAI`), Ogel krystals (10, bitmask `0x31`, +1000 into `SCORE_OGL`/`HISCORE_OGL`). **Trophies**: `Trophy.c` in z03PPH (`FUN_0054116c` per mini-game {trophyVar, hiscoreVar, slot}; `FUN_005413c4` island trophies CSI/ADV/OGL/LGI; browser `FUN_005414b0`); 23 trophy records `TOGL, TADV, TLGI, TCSI, TBKD, ...` in the room.
**Game end**: z42BRP success -> `OutroFMV.mpg` (when `STARTEDFROMMENU == 0`) -> node 68 (island free roam with no counters); nothing else ends the game. No lives, no timers except per-mini-game.

### 6.3 Save game (analysed)

* **`_data\sw.dat`** (`FUN_00417820` write / `FUN_0041786a` read): raw little-endian dump of `0x370` bytes = vars 15..234 (at 0x8a2d68). No checksum (`FUN_004176f5` parity function has no callers). Its only writer is the start-up (`FUN_00404dc9`) right before the reader, so it is effectively a *defaults snapshot* rewritten at every launch. `FUN_0041786a` is also called on New Game, after which `NUM_BRICKS = NUM_PIZZAS = 11`, `PEPPHOUSE_SIZE = 0`, `MOVE_PIZ3 = 0`, `MOVE_CNST = 1`, `PAGES_SET = 0`.
* **Real save slots**: files **`_data//Save%02d.lgo`**, slots 0..6 (menu pages 2/3/8: load/save/erase; "New game" passes a bogus slot -17..-11 so it never writes), plus **`SaveDef.lgo`** (slot -2, written from the front end by `FUN_0041ad71`). Single player, no profiles. Writer `FUN_00418ec7`, reader header `FUN_00419c45`, body `FUN_0041aa2e` / `FUN_00419e82`; fixed **0x51c8c bytes**, little endian, marker-delimited:
  u32 length, u32 0xd, CURRENT_SUBGAME, `time()`, FSM state, marker 0x8088008, **vars 15..318** (0x4c0 bytes, `FUN_00417908`/`FUN_0041792f`), marker 0xf0ff00f, blob `FUN_00462d8b` (walker state), marker 0xe0ee00e, 0x48 bytes at `DAT_009da5e8` (camera) + u32 `DAT_009da5cc`, marker 0xa0aa00a, per-object records (tag, animation state `FUN_0043b72b`, float `FUN_0043b73f`, marker 0xd0dd00d), marker 0x9099009, blob `FUN_00421f56` (decor tables), marker 0x6066006, per-entity records, marker 0x7077007, blob `FUN_00447c90` (bricks), 0x7077007, 0xc0cc00c, **u32 XOR checksum** (`FUN_00418e7f`, dwords from offset 8 to len-4), 0xc0cc00c. Loader validation `FUN_0041ac8f`; slot captions use the FSM state (third header int) to pick `FSMSTATEnn` text (`FUN_0041ac0e`) or `<________>` when empty.
  **Load** (`FUN_00419bb9`): if zone and FSM state already match it restores in place, otherwise it sets `DAT_009d9c19 = 1` (+ `DAT_009d9c10` node, `DAT_009d9c18` zone), leaves the zone (`FUN_0041ad43` override in the main loop) and the new zone's init calls `FUN_0041adb5` -> `FUN_00419e82`.
  A **port may define its own save format** (localStorage/IndexedDB with the var array, FSM node, current zone); only vars 15..318 + node + zone are essential, the object/decor blobs restore building phases and animation states (4.1).
* An autosave function `FUN_0041a995` exists with no callers.

### 6.4 Options (`_data\Settings.set`, 23 int32; analysed, from `FUN_00403e30`, `FUN_0041b500`, `FUN_0041bbd6`)

| index | meaning | default |
|---|---|---|
| 0 | music volume 0-100 (`FUN_00443350` -> `FUN_00876aa4`) | 80 |
| 1 | SFX volume (`FUN_004431d0`) | 80 |
| 0x16 | speech volume (`FUN_008773fd`, Miles stream volume `v*127/100`) | 80 |
| 2 | speech on (mirrors var 9) | 1 |
| 3 | subtitles on (mirrors var 0; at least one of 2/3 stays on) | 1 |
| 4-0x10 | 13 key bindings `(device << 16) \| DIK` = Up 0xc8, Down 0xd0, Left 0xcb, Right 0xcd, LCtrl 0x1d, LAlt 0x38, LShift 0x2a, Space 0x39, `<>` 0x56, Z 0x2c, X 0x2d, C 0x2e, Enter 0x1c (all `\| 0x10000`) | see left |
| 0x11 | binding Del (0x53) | not located in code (UNCERTAIN) |
| 0x12 | texture quality (0 = textures halved) | 1 |
| 0x13 | gamepad enabled | 1 |
| 0x14 | mouse/pad axis sensitivity | 45 |
| 0x15 | draw distance 0-100 (`FUN_004095ab`) | 50 |

Options screens: Besturing (13 keys, joystick, mouse speed), Afbeeldingen (detail high/medium/low, resolution), Geluid (music/SFX/speech volumes, subtitles), Overzichtscenes. The file is absent in the install (created on first run).


---------------------------------------------------------------------------------------------------------------------------

## 7. Input, HUD, fonts, text, localisation

### 7.1 Input (SDPad.cpp, 0x436017-0x437b16; analysed)

* DirectInput8 (`FUN_00436f7d`): keyboard (`FUN_00436642`, buffered + event), mouse (`FUN_00436017`), gamepads via `EnumDevices` (`FUN_00436c5a`, force feedback `FUN_00436b3a`); cooperative level foreground non-exclusive (mouse exclusive in full screen). Key code format `(device << 16) | id` with device 0 mouse, 1 keyboard, 2 joystick; `FUN_004371ea` edge trigger, `FUN_00437148` held.
* **Logical layer** `FUN_004376f9` (13-entry table at 0x8aeb20, stride 0x30: default key, current key = Settings[4+i], logical bit): see 4.4 for the bit values and default keys (arrows, Ctrl, Alt, Shift, Space, `<>`, Z, X, C, Enter). Esc returns 0x40000000 (pause), any key 0x80000000 (`FUN_00437fdf`, used by "press a key" screens).
  **Gamepad** (when Settings[0x13]): stick beyond +-0x40 (axis/512) gives bits 1..8; buttons 0-9 map to 0x10..0x80, 0x1000..0x8000, 0x10000, 0x20000. **Mouse** movement only in menus (`FUN_00437ca5`: buttons 0-3 -> 0x10..0x80, dx and -dy scaled by Settings[0x14]).
* Alt+Tab -> `PostMessage(WM_ACTIVATE)`; in windowed mode only F4/F8/F9/F10 are debug keys. **Cheat codes** (`FUN_004375a8`, 6 scancode sequences at 0x8aed70): `PEPPERONI` (`FUN_0041b357`, windowed only), `FSMADVANCE` (advance var 0x58, windowed only), `RHUNRHEGED` (error dialog), `BAATAT` (`FUN_00420674(-1)`), `SDREAMS` (sets var 0xd: enables the island's wormhole to z50LTC), `DAFFODILE` (no handler).
* Per-mini-game control hints are *data*: `CONTROLn:` lines in the zone's `.str` (e.g. `CONTROL0:-1 BUT...`), shown in mode 9 by `FUN_00461155(strfile, n)`. `BUTTON_n` in those texts and in the code (`DAT_00983840 & mask`) refers to the logical bits of the table above (which key a given `BUTTON_n` is: UNCERTAIN; the pad mapping is in 7.1).

### 7.2 HUD and 2D drawing (analysed)

* **DrawHUD.c**: `FUN_0045f9d2` loads the HUD fonts (Balloon24, `csm`) and `overlays\HUDfx\text.opt`; `FUN_0045f9b0` frees; `FUN_0046063b` loads a zone overlay set `_data\Overlays\<zone>\text.opt`; `FUN_0046055f` draws the HUD every frame from a 0x48c-byte state struct at 0x5d4dd10: two corner icons, three Balloon24 strings, a 5-slot icon column (`FUN_0045fc19`), a 12-segment gauge (`FUN_00460214`), four `csm` subtitle lines (`FUN_00460003`) and the cutscene letterbox bars (`FUN_0045f771`). Numbers are formatted per zone (`%04d` score, `%d/%d` counters, `%02d:%02d` clock).
  The island HUD (`FUN_004b8ef0`, `FUN_004b908d`): pizzas/bricks as "(11-var)/11" before node 7, then bot-head icons (grey/white per `COLORED_BOTHEADS` bit) and pages "n/4" ("n/2" in era 2), none from node 0x3d; icons by `INTERACT_ICONS` (var 0xc).
* **2D API**: `FUN_0043c267` (clipped textured quad; `SD2d.c`; sprites from `Text.opt` sets, drawn as XYZRHW quads), `FUN_0043c70f` flush; text: `FUN_00439c6f(msgfile, font, id, align, x, y, maxcols)` word-wraps on the 640-wide virtual screen and queues; `FUN_0043a091/0043a167/0043a25c` alignment variants; `FUN_00439f51` flush (drawn twice: 2-px shadow, then colour; `FUN_00413ed9`/`FUN_00413fd6`).
  All UI is laid out for **640x480** regardless of the actual display mode (`DAT_008a9920*600/640`-style scaling in the credits). Menu sprites: `_data\menu\mOverlays\text.opt` (`FUN_0041b366`).

### 7.3 Fonts (NewFont.c; formats.md 8.3.9)

`FUN_00413af1`/`FUN_00413d08`: `%s.fnt` + `%s.tga` pairs; loaded by `FUN_00439f36(path)`: `fonts\main\main`, `fonts\menu\menu`, `Balloon24` (and `Balloon12`), `csm\csm`, `bknw`, `test` (`FUN_00413dae`). The font only has **capital** accented letters (the text expander folds bytes >= 0xE0 to upper case, `FUN_004397b9`).

### 7.4 Text and localisation (verified loader; usage analysed)

* All text lives in `.str` tag files (`messages.bob`: `FE` front end 6, `LI` 92, `CI` 24, `AI` 31, `OG` 11 files + per-zone `z38PAR/Messages/English/PARSTR.str`, `z40aPO/.../APOSTR.str`, `z27TRX/messages/english/english.txt`; formats.md 8.3.2). Loader `FUN_00439126` (tags sorted with a bubble sort `FUN_00439573`, binary search `FUN_004396a0`, **a missing id returns the id itself**); expansion `FUN_004397b9`/`FUN_00439788` (`\n \t \\`, `$$ %% &&`); `FUN_00439bf8(table, id, &out)` returns text and the 4-char **voice id** after the colon.
  Speech: `FUN_00435a11(idA, idB)` queues up to two clips (`FUN_00443630` -> `FUN_0087584e`): file `_Data\sounds\speech\Data\<NAME>.mp3` named by a 1,732-entry table at 0x979098 (id -> name), played as Miles streams, volume Settings[0x16].
  Subtitles show when var 0 is on, speech plays when var 9 is on.
* **Language**: there is *no* language switch in the executable. The language is whatever `messages.bob` ships (`messages/Dutch.txt` is only an empty marker); the Dutch release has Dutch text, the voice clips are separate `.mp3` files (not checked which language), `swaptext` is a *texture* swap bank (not a language bank). The window title comes from tag `LEVLGI` of `FE/Data/IFC.str`. Some zones show English text in the Dutch build (`LESGPT01` of z38PAR, per-zone `PARSTR.str`).
* **Sound tables** (analysed): SFX table of 902 records x 0x20 bytes at 0x969f80..0x971040 (path, volume, loops (0 = infinite), min/max distance, pan, rate, flag); music table 41 records at 0x97fcb8 (name such as `Z02LGIM`, directory, `.sgt`, `.dls`); speech table 0x979098; formats.md 8.4.


---------------------------------------------------------------------------------------------------------------------------

## 8. Porting plan

### 8.1 Subsystems, sizes, dependencies

Sizes are decompiled lines of the matching address ranges (0.35-0.5 TypeScript lines per decompiled line is a fair expectation for hand-written code); "have" = already in this repository.

| # | subsystem | EXE side (functions / lines) | depends on | browser implementation | have |
|---|---|---|---|---|---|
| 1 | platform shell: canvas, fullscreen, pause on hidden, settings + save storage | main + window 80 / 3k | - | DOM, localStorage/IndexedDB | partly (`src/engine`) |
| 2 | VFS: `.bod/.bob` archives, loose override, string tag files | Sdlib files/text ~100 / 2k | - | `src/engine/vfs.ts`, `formats/archive.ts`, `formats/text.ts` | yes |
| 3 | frame loop + dt (1/30 unit, clamps) | 1.4 (~20 / 0.5k) | 1 | `requestAnimationFrame` | - |
| 4 | **renderer**: D3D7 fixed function -> WebGL2: 30 state presets (table at 0x89b020), fog (linear), 3 alpha-class passes, Z/W, texture formats, `.wib` animated textures, mesh draw + LOD + frustum, CPU skinning, lights, 2D XYZRHW quads, dynamic effect VBs | graphics core 265 / 9.3k + model/draw library 153 / 7.2k | 2 | WebGL2 | viewer renderer: meshes, textures, 3 passes |
| 5 | **object framework**: records, controllers, behaviour nodes (3 passes), game variables, focus/camera globals | SGGen glue 181 / 9k | 4 | TS classes; nodes as closures/objects with `update/prerender/destroy/draw` | - |
| 6 | **collision**: `.col` grid + analytic shapes, sweep `FUN_00441270`, ground ray, probe pass | GSMS collision ~60 / 2k | 5 | formats.md 8.1 + 4.1 | parser yes |
| 7 | **animation**: `.blk` rigs, clip player, attachments, `.man` splines, expressions | SDAnim + GSMS ~100 / 3k | 4, 5 | formats.md 8.2 | parser + `sampleBlk` yes |
| 8 | **waypoint walker** + routing | 80 + 40 / 3k | 5 | formats.md 7.1 + 4.6 | parser yes |
| 9 | **cutscene manager** (16 commands) + in-EXE `.txt` compiler (not needed: ship `.cut`) | CSM 100 / 3.4k | 5, 7, 8, 12 | 5.1-5.3 | parser/compiler yes |
| 10 | **audio**: SFX (902-record table, 2D/3D), speech mp3 (1,732-entry table), MIDI ambience, **music (DirectMusic .sgt/.sty/.dls)**, volumes | Miles + DirectMusic 132 / 3.6k | 2 | WebAudio; music needs a DLS/style player or pre-rendering (formats.md 8.4) | decoder + tables yes; DirectMusic no |
| 11 | movies (4 MPEG-1 files) | MSFMV 23 / 0.6k | - | `src/engine/movie.ts`, `mpeg.ts` | yes |
| 12 | **UI**: menu engine (pages table 0x8a9338), HUD (DrawHUD), fonts, text layout, results/pause | SGPauseM + HUD + font ~330 / 10k | 4, 2 | Canvas/WebGL quads | fonts parser yes |
| 13 | FX: particles (`.par/.app/.emi/.mov/.swl`), bricks (BrickMorph/Bricks) | particles 140 / 6.8k; bricks 69 / 3.4k (157 / 8.4k if the model-morph code around 0x447xxx is counted) | 4, 5 | CPU sim + sprite batches | parsers yes |
| 14 | **shared gameplay nodes**: SGwalk, PepSwitc, SGBoat/Heli/Car/Vehic, sgswim, generic NPC/talk, Turn2Pep, MeetPepp, Human1, trigger/portal/door, Bunny/Ptera, Pizza, seabed/sea/sky | in SGGen 246 / 12k + island region shared parts | 5-9 | hand port | - |
| 15 | story FSM, game vars, save | 2.2, 6 (~100 / 3k) | 5 | tables extracted from the EXE | - |
| 16 | **per-zone logic** (30 zones) | 103k lines (unique ~70k) | 14 | 8.3 | - |

### 8.2 What is data (extract from the user's own EXE at run time, like `extractZone`) and what is code

**Data that already lives in the EXE as tables** (extendable with the existing symbolic x86 interpreter `src/formats/x86.ts`/`exe.ts`; nothing needs to be copied into the repo):

| table | VA | content |
|---|---|---|
| zone table | 0x89a9c0 | 35 x {run fn, kind, id} (the run function addresses identify the zone code; for a port the *set* of zones and kinds) |
| story FSM | 0x89a758 | 72 x {zone, var, mask, value} (2.2) |
| game variable names | 0x8a3228 | 319 string pointers |
| FSM captions | 0x8a5448 | stride 12 (FSMSTATEnn tags); level-select tables 0x8a5c88 (story checkpoints, stride 0x2c), 0x8a62e8 (replays); PPH replay list 0x8a57f0 |
| menu pages | 0x8a9338 | 5-dword page records + 0x4c-byte items |
| key table | 0x8aeb20 | 13 x 0x30; cheat codes 0x8aed70 |
| sound table / music table / speech table | ~0x969f80 (902 x 0x20) / 0x97fcb8 (41 x 0x10) / 0x979098 (1,732) | formats.md 8.4 |
| render-state presets | 0x89b020 | 30 x 11 records {type, stage, id, value} |
| zone placement / models / textures / collision lists | per zone loader+builder | formats.md 6 |
| **behaviour registration** | each zone's setup/registration function: mostly straight-line `FUN_00423532(rec, ctor, arg, pos, var, mask, value)` calls with constant operands, plus record flag patches, `FUN_004427e0/4428b0/00442780` box calls, `FUN_00444550` render modes, `FUN_0045c397` cutscene slots, `FUN_00424029` HUD hints | **largely extractable with the same symbolic interpreter** (it handles `push/mov/call` with constants; some registration code has loops and branches, e.g. the island's `FUN_004b6475`, `FUN_004b4907`, and the name-dispatch loops in z27TRX/z16PYA/z14OSD, which need a small loop/branch extension or hand porting); would give "record X gets node Y with gate (var, mask, value)" for most of the ~1,100 attach calls |
| per-zone constants | medal thresholds, geometry constants (`DAT_00892xxx` floats), vehicle roster 0x8e9b28, dev-team table 0x95d2c8, trophy tuples (`FUN_0054116c` args), brick/NPC tables | read as needed |

**Needs code**: the 220 behaviour constructors/updates (4.2), the 30 loops (but they are templated, below), Pepper's walk/swim/skate/vehicle modes, camera, NPC/story handlers per era, HUD per zone, mini-game rules.

### 8.3 Per-zone gameplay code: how to translate it

Observations about the code (verified/analysed): (1) a debug MSVC build, so each source statement became a plain instruction run, locals live at `ebp-x`, calling conventions are regular (cdecl, thiscall `ecx`), no inlining, no loop transforms; (2) the zone loops are 40-60 % identical (3.2), a configuration of one template; (3) behaviour updates are float state machines on `*(float *)(node + off)` with offsets that follow the node structs; (4) the decompile has artefacts that matter for a mechanical translator: byte-vs-element pointer scaling (`DAT_00983804 + N` is a byte offset in some functions, an element offset in others where Ghidra typed the pointer `uint *`), `__ftol` (truncating float->int), `float10`/`CONCAT44`, the 0xcccccccc stack-fill loops, `__chkesp`, `swi(3)`, FPU-compare idioms, and functions Ghidra *failed* on (all 12 loaders/builders that are tables anyway, plus the island builder).

Options:

1. **Hand port** guided by this document, per-zone notes (3.4) and the decompile. Order of magnitude: the engine core ~15-20k TS lines; the shared gameplay nodes ~6-9k; per-zone unique logic ~70k decompiled lines (island ~15-21k; all others ~51k) i.e. **~25-35k TS lines**. Everything is understood at the level needed; tuning constants must be read from the EXE (`.rdata` floats such as `_DAT_008923cc`) or from the decompile.
2. **Semi-mechanical translation of the decompiled C** to TypeScript with a flat memory model: one `ArrayBuffer` containing the zone's records/nodes (so raw offsets like `rec + 0x5c` keep working), globals as fields, library calls through a table of host functions with the original signatures. Feasible for the leaf logic and gives bit-exact constants, but needs a small type-recovery step (byte vs element offsets) and the artefact clean-up above; expect ~2-3k lines of tool and a manual review of every function that touches `float10`/`CONCAT`. **Not committable** to the repo (derived from the executable): output must be generated at load time from the user's EXE (cf. formats.md section 1 "Copyright") or used only as a drafting aid.
3. **Lift from x86 instead of from the C** (static/dynamic recompilation of the zone logic from the EXE the user supplies): the debug-build regularity makes this simpler than a general decompiler (ebp locals -> JS locals, x87 stack -> doubles/float32 stores, calls by address -> host shim table) and avoids Ghidra's type errors; runs at load time on the user's EXE. This is the same idea as the existing symbolic interpreter, extended to full semantics.
4. **Emulate the whole executable** (x86 interpreter/JIT + HLE of ~80 KERNEL32, ~40 USER32, DirectDraw7/Direct3D7 (COM vtables; vtable-call census: begin/end scene, clear, set/get render state, set transform, set texture + texture stage state, DrawIndexedPrimitiveVB, VB lock/unlock, surface blt/flip), DirectInput8, Miles (73 imports), DirectMusic and DirectShow). Maximum fidelity, no per-zone work; large up-front cost, all-or-nothing, and the hardware-only D3D7 enumeration, exclusive full screen and CD check must be faked. Mentioned for completeness; it does not fit the stated goal of a TypeScript/WebGL2 engine.

**Recommendation** (analysis, not measured): hybrid. Build the engine core and the shared nodes by hand (they are the risk: object framework, collision, SGwalk, camera, cutscene runner); *generate* the zone loops from a declarative per-zone config (modes, string ids, medal constants, exit rules, music/sound banks: 3.4/3.6 are the start of those configs); *extract* the behaviour-registration tables from the EXE with the symbolic interpreter; hand-port the per-zone behaviours in order of value/difficulty, using option 2 as a drafting tool only (local, not committed). Keep option 3 in reserve if per-zone hand porting proves too slow: it needs the same host-function shim table as option 2.

### 8.4 Suggested implementation order

| milestone | scope | validates |
|---|---|---|
| M0 (done) | formats, viewer (meshes/textures/placement), movies, archive access | |
| M1 engine core | game-var array + names; frame loop (30 Hz unit, dt clamp); object records from `extractZone`; controller/node framework (3 passes, gating, return codes); collision queries (`.col`); animation player; waypoint walker; input mapper; camera trio + chase camera; 2D/text/HUD primitives; sound basics | a free-roam scene: Pepper walking in z03PPH / island with SGwalk, camera, collision |
| M2 shell | front end (z60FRE scene, menu engine from table 0x8a9338, options, credits), pause/result menus, save/load (own format), zone loop + FSM + `FUN_00404d14` semantics, HUD | the whole top-level state machine with stub zones |
| M3 first mini-games (small, template-pure) | z38PAR, z40aPO (same loop), z36CNT, z05WAB, z17WAS, z39ASB, z41MAP; rooms z04IFC, z50LTC; z03PPH (trophies) | zone template, medals/results, messages/speech, `FUN_00404d14` |
| M4 island | z02LGI eras 0-4: story handler `FUN_004b7040`, Pepper node chain + PepSwitc, NPC/talk/Turn2Pep/MeetPepp/Human1 nodes, StartCSM triggers + **cutscene runner**, doors/portals, buildings (brick-morph), pizza delivery, bunnies/birds, vehicles (boat, heli, car), director node, music | the largest dependency set; most shared code of the other hubs |
| M5 other hubs | CSI (horse), OGL, OSD, PYA, DIP, CAI (helicopter/Ptera flight) | reuse of NPC/trigger/cutscene code |
| M6 remaining mini-games | SSH, FSH, TRX, DSP, JST, RGB, BKD, HAT, BIP, MMP, BPK, BRP (roughly by difficulty low -> high) | |
| M7 polish | DirectMusic music, particle engine, adaptive detail, gamepad/mouse, `.wib` timing, Miles 3D audio panning | |

### 8.5 Engineering notes for the port

* **Time step**: the original is a variable step in units of 1/30 s with clamps (1.4). A deterministic port can run the simulation at a fixed 30 Hz (dt = 1.0) and render interpolated; code that is per-frame (cutscene camera easing, many counters) then behaves exactly as designed. Do not run at 60 Hz with dt 0.5 unless every per-frame constant is checked.
* **Coordinates/handedness/matrices**: formats.md 7 (left-handed, row vectors, Euler order of `FUN_0043a5e4`).
* **Rendering state machine** is the highest-risk visual item: 30 presets (alpha classes, colour/alpha ops, Z on/off, specular), table fog, `.wib` frame selection, "texture quality 0" halving, sea/sky special records (`SSEA`, `SSKY`, `SeaAmin.c`).
* **Randomness**: `FUN_004388ae` (random float) is used by AI; there is no replay/determinism requirement except the DSP `Replay.c` input recorder (0x1a5e0 buffer, 12 bytes/frame).
* **Asserts**: `FUN_00438cb0` dialogs become console errors; guard words and memory pools disappear.


---------------------------------------------------------------------------------------------------------------------------

## 9. Open questions (things this pass did not resolve)

* **Zone-table `kind` 0/2/3/4** (2.1): no reader; only `1` matters. 3 = three medal tiers in the shown zones, 2 = ? (maybe fewer/other scoring), 4 = ? (JST, RGB, HAT).
* `RGB` and `HAT`, `MMP`, `SSH`, `WAB`, `CNT`, `BRP`, `LTC`, `ASB`, `APO` expansions are guesses from the content (RGB = cannon duel with "Simon"/Cedric; BRP = Brickster fight; LTC = developer cave); only BPK (skate park), PPH, IFC, FSH, DSP, BIP, TRX, OGL, MAP, CSI, CAI, OSD, PYA, DIP, PAR, JST, BKD have names consistent with the data and the Dutch texts.
* Handler tables: the fifth slot of newer constructors, controller `c[1]` (exclusive node) setting site, probe-flag bit mapping of `FUN_00427233`, `FUN_00444550` render-mode values, NPC state bit meanings (`FUN_00424526`, `FUN_0042477f`, `FUN_00425902`), the walker flag nibbles 0x10000000/0x40000000, `+0x4c` in the controller.
* `PEPPER_CONTROL` bits 0x10 (pizza aim), 0x1000, 0x20 (talk/stung) and the vehicle slot numbering of the mode word.
* Cutscene camera easing: per frame or per `dt` (5.1); `DAT_0089df30 = 2.0` in `FUN_00458f50` (a time-scale?).
* Music start: how the wrapper music keys (`FUN_00435a07`, a stub) map to DirectMusic segments (`Music.c`, table 0x97fcb8); whether `FUN_00443350` is the only volume path.
* Save format details beyond the layout in 6.3 (blobs `FUN_00462d8b`, `FUN_00421f56`, `FUN_00447c90`).
* DSP time unit of the medal thresholds (2700/3600/4500), BIP outcome 0 vs 1, MMP score formula, SSH grade 2, WAS/HAT/ASB exact scoring ties, `FUN_00404c07` forward-jump semantics for SUBGAME vars.
* `FUN_00470abb` (front-end first call, returns -1 under `DAT_009836e8`): probably a stripped intro hook.
* Windowed mode and `GameSetup.txt`: the launcher that writes it is not part of the EXE; the game ignores it.
* The 4-cell "vehicle roster" table 0x8e9b28 field 3, the hidden `PG00-28` page records, `Carve.c`'s role (mesh carving for brick morphs? `Part_%d_%d_%d.msh`).

---------------------------------------------------------------------------------------------------------------------------

## 10. Appendix

### 10.1 Helper scripts (outside this repo, `/Users/sander/Documents/basdebeer-tools/decomp-le2/tools/`)

`fn.py 0xADDR` print a decompiled function; `cg.py 0xADDR` callees/callers with sizes and source tags; `pe.py` read bytes/strings/floats of the EXE by VA; `arc.py NAME [filter]` list/read archive members; `zonemap.py` (zone regions, loaders, builders, entries), `zones.py` (zone table + strings), `zonetable_md.py`
(regenerates the base zone table), `fsm_dump.py` (story FSM), `tmpl_sim.py` (template similarity), `gamevars.tsv`, `sourcepaths.txt`; the per-area passes added `plat_*`, `csm_*`, `gs_*`, `obj_*`, `zone_*` helpers (read-only analysis). `README.txt` explains the use. The decompile (`LE2.c`), disassembly (`LE2.asm.txt`) and `atlas.md/json` are unchanged.

### 10.2 Quick entry-point sheet

| thing | address |
|---|---|
| PE entry / WinMain | 0x85bef0 / `FUN_00402c8e` |
| window proc / window creation | `FUN_004046da` / `FUN_004042d3` |
| archive open / close / file open | `FUN_0043421d` / `FUN_0043455a` / `FUN_00435843` |
| start-up (graphics, input, movies, audio) | `FUN_00402990` (-> `FUN_004059b0`, `FUN_00436f7d`, `FUN_0048c813`, `FUN_00874751`) |
| zone loop | `FUN_00404dc9`; zone table 0x89a9c0; story FSM 0x89a758 (`FUN_00404aa0/00404bb2/00404b43/00404be7/00404c07/00404d14`) |
| game vars | array 0x8a2d2c; get `FUN_00417575`, set `FUN_00417597`; names 0x8a3228; save `FUN_00417820/0041786a` (sw.dat), `FUN_00418ec7`/`FUN_00419e82` (Save%02d.lgo) |
| frame: input / begin / update / probe / pre-render / draw / flush / end | `FUN_00437411` `FUN_0043ec70` `FUN_0042226e` `FUN_00427233` `FUN_004225c5` `FUN_0042271b` `FUN_00445d20` `FUN_00435d0d` |
| timing | `FUN_00443de0`, `FUN_00443e40` -> `DAT_008b1718` |
| object records / models / meshes / collision / anims | `DAT_00983804` / `DAT_0098380c` / `DAT_00983814` / `DAT_0098382c` / `DAT_009837fc` |
| behaviour attach / controller create / destroy | `FUN_00423532` / `FUN_0042382c` / `FUN_00423ad4`, `FUN_004232a0` |
| collision sweep / ground / terrain height | `FUN_00441270` / `FUN_00441ac0`, `FUN_00441b10` / `FUN_0043cd62` |
| Pepper walk / PepSwitc / camera | `FUN_0042d514` / `FUN_004bb67d` / `FUN_0042c227` |
| waypoints | `FUN_004630c0`; walker `FUN_004614d5`, `FUN_004626d0` |
| cutscene API | `FUN_0045c310/c366/c397/c40c/c402/c432`; scheduler `FUN_00459119`, `FUN_00459597`; command dictionaries `FUN_0045988b` |
| text / speech | `FUN_00439126` `FUN_004396a0` `FUN_00439bf8` `FUN_00439c6f` / `FUN_00435a11` |
| menus | `FUN_0041bd3d` (pause), `FUN_0041c092` (result), `FUN_0041be4e` (frame), table 0x8a9338 |
| movies | `FUN_0048c813(path, hwnd, skippable)`, `FUN_0048c7b0(name)` |
| sound | Miles open `FUN_00874751`; per-zone `FUN_00873f74/00874186`; SFX `FUN_004435a0/004433f0/004435b0`; music `FUN_00876841/00876ec2` |
| draw model / LOD / frustum flags | `FUN_00444480` / `FUN_00443f90` / `FUN_00444370` |
| D3D layer | begin/end frame `FUN_0040c8c6`/`FUN_0040cb0f`; state presets `FUN_004092fd(n)`; fog `FUN_0040943f`; texture `FUN_004100a1` (.tga) `FUN_004112ac` (.wib) |
