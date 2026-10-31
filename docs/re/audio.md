# Audio engine of LEGO eiland 2 (LE2.EXE): SoundClass, speech, DirectMusic

Reverse-engineering notes for the Web Audio port. Source: Ghidra decompile `decomp-le2/LE2.c` + `LE2.asm.txt` of `LEGO eiland 2.exe` (MSVC debug-style build, image base 0x400000, `FUN_xxxxxxxx` = Ghidra names, addresses are VAs).
Builds on `docs/re/formats.md` section 8.4 (file formats, tables, inventory), which is not repeated here. Parsers: `src/formats/sound.ts`.

Confidence tags: **high** = read directly from decompile/asm and cross-checked, **medium** = inferred from several call sites or from constants, **UNCERTAIN** = guess, needs a runtime check.
Numbers in hex are literal values from the binary. "opt[n]" = entry n of the 23-dword options array (section 1.3).

Contents: 1 architecture, 2 SoundClass (samples), 3 3D audio, 4 ambience + zone sounds, 5 vehicles/UI/footsteps, 6 speech + subtitles, 7 music (DirectMusic), 8 open questions, 9 implementation notes, 10 DirectMusic file internals + our playback engine (formats, composer rules, DLS synth, verification, fidelity).

---

## 1. Architecture

### 1.1 Layers and objects

| layer | address range | what |
|---|---|---|
| gameplay code | everywhere (zone modules `0x4b0000-0x850000`) | calls the *game wrappers* below with a **slot index** (handle) it got when it loaded the sound |
| game wrappers ("SD" sound API) | `0x4430f0-0x4437d0` (thunks, each loads `ECX` with the object address and jumps into the class) | 1:1 thunks, no logic except `FUN_004433f0` (3D distance cull) and `FUN_004436d0` (speech state machine) |
| `SoundClass` (`SoundClass.cpp`) | `0x873e00-0x877550` ("Sound\c_src\SoundClass.cpp" string) | Miles Sound System (MSS 6, `AIL_*` imports) samples, 3D, streams, XMIDI sequence; **object at VA 0x9dec78** (size >= 0x1a70) |
| `DirectMusic` class (`DirectMusic.cpp`) | same range: `0x876010-0x877330` + helper classes `0x87cad0-0x87d100` | DirectMusic COM (DX7-style interfaces); **object at VA 0x9dec48** |
| options | `FUN_004040ec(i)` -> `&DAT_009833f0 + 4*i` (valid i < 0x17) | volume values and other settings |

Both objects are statics; the wrappers hard-code `mov ecx, 0x9dec78` (SoundClass) / `0x9dec48` (DirectMusic). The decompiler hides `this`, so arguments in `LE2.c` look shifted.
The whole scripting layer for sounds is native code: **there are no data-driven sound ops** in cutscene scripts (see 6.4 and 4.4); sound ids are compile-time enum values (`SND_*`, `CSSND_*`).
`FUN_00877550` registers the 902 names (`FUN_0045bff4(DAT_05d5faa4, "SND_...", id)`) in a name registry that is never queried afterwards (only freed in `FUN_008742c7`): it is debug/enumeration only (high).

### 1.2 SoundClass field map (object 0x9dec78) (high, from `FUN_00873e26/00873f83/00874477/00874195`)

| offset | meaning |
|---|---|
| +0x000 | count of used 2D cache slots (0..200) |
| +0x004 | count of used 3D cache slots (0..200) |
| +0x008... | 2D cache: 200 slots x 16 bytes: `+0 soundId`, `+4 flag "playing/assigned"` (byte at +0xc), `+5 handle index` (byte at +0xd, `0xff` = none), `+8 file buffer ptr` (offset +0x10 from object start) |
| +0xc88... | 3D cache: 200 slots x 16 bytes: `+0 soundId`, `+4 flag` (byte +0xc8c), `+5 handle index` (byte +0xc8d), `+8 file ptr` (+0xc90), `+0xc worldMax = (int)maxDistance` (+0xc94, `ftol` of table field +0x10, `FUN_00874be4`) |
| +0x1900-0x1987 | 3D sample handles: 16 x {`H3DSAMPLE`, `slot` (-1 = free)} (+0x1908 + 8*i / +0x190c + 8*i) |
| +0x1988-0x1a07 | 2D sample handles: 16 x {`HSAMPLE`, `slot` (-1 = free)} (+0x1988 + 8*i / +0x198c + 8*i) |
| +0x1a08 | cached SFX master volume (= opt[1]) |
| +0x1a10 | WAVEFORMAT passed to `AIL_waveOutOpen`: PCM, 2 ch, 22050 Hz (`0x5622`), 16 bit (`FUN_00874195`) |
| +0x1a30 | `HDIGDRIVER` |
| +0x1a38 | current speech stream handle (last opened, informational) |
| +0x1a40 | 3D listener handle (`AIL_open_3D_listener`) |
| +0x1a44 / +0x1a48 | name / handle of the opened 3D provider |
| +0x1a58 | DLS handle (`AIL_DLS_open(midi, wave, 0, 0, 22050, 16, 2)`) |
| +0x1a5c | `HMDIDRIVER` (`AIL_midiOutOpen`) |
| +0x1a60 / +0x1a64 / +0x1a68 | ambience MIDI file buffer / XMIDI buffer / `HSEQUENCE` |

Globals: `DAT_05d5fa38` last music volume option, `DAT_05d5fa3c` ambience table volume, `DAT_05d5fa40` "3D provider opened" flag, `DAT_009e06e4` ambience start-delay counter.

### 1.3 Options array (opt[], 23 x int32 at VA 0x009833f0)

Persisted as raw dwords in `_data\Settings.set` (fallback `c:\windows\temp\Settings.set`; strings 0x89a54c/0x89a560; `FUN_00403e30` defaults + load, `FUN_0040410f` save). Defaults set in `FUN_00403e30`. Audio-relevant entries (high unless noted):

| opt | default | meaning | set by (options screen `FUN_0041xxxx`, case 6 of the menu handler near line 13000 of LE2.c) | used by |
|---|---|---|---|---|
| 0 | 80 (0x50) | **music volume** 0..100 (FE string `FEMUSVOL` "MUZIEK VOLUME") | menu 0xb item 1 -> `FUN_00443350(v)` | `FUN_00876aa4` (DirectMusic master volume) |
| 1 | 80 | **sound-effect volume** 0..100 (`FESNDVOL` "GELUIDS VOLUME") | menu 0xb item 2 -> `FUN_004431d0` = `FUN_008749dc` | all `AIL_set_*sample_volume`, ambience MIDI volume |
| 0x16 (22) | 80 | **speech volume** 0..100 (`FESPCVOL` "SPRAAK VOLUME") | menu 0xb item 3 -> plays speech index 8 as a preview (`FUN_00435a11(8,-1)`) | `FUN_008773fd` |
| 2 | 1 | speech on/off (`FESPEECH`) (medium) | menu 0xc item 1; at least one of opt[2], opt[3] is forced to 1 | mirrored to game var 9 (`FUN_00417597(9, ...)`): gates speech playback and "text waits for speech end" |
| 3 | 1 | subtitles on/off (`FESUBTLE`) (medium) | menu 0xc item 2 | mirrored to game var 0: gates `FUN_0045d47f` (draw subtitle text) |

(The pairing opt[2]=speech / opt[3]=subtitles is derived from `FUN_0041b9b1`... lines 12939-12950 and the consumers `FUN_00417575(9)` in the NPC dialogue code near line 17789; medium because the FE string order was not checked against the screen.)
opt 4..0x15 are key bindings / detail level / mouse speed, not audio.

### 1.4 Frame tick

* `FUN_00435a5e` (called from the main loops, e.g. line 14780, 57320, 67554, 94617...): speech state machine tick, then `FUN_008751b6` (SoundClass housekeeping). (high)
* `FUN_008751b6`: for each of the 16 + 16 handles: if the handle is assigned and `AIL_(3D_)sample_status == 2 (SMP_DONE)` **and `AIL_sample_loop_count != 0`** the slot is released (flag cleared, handle freed). Looping samples (loop count 0) are never auto-released. Then `FUN_00874af8`: if opt[1] changed -> `FUN_008749dc` (re-apply volumes), if opt[0] changed -> `FUN_00876aa4` (re-apply music volume). So option changes propagate within one frame. (high)
* `FUN_00443230` (per frame from zone loops): ambience MIDI start/loop, see 4.1.
* DirectMusic needs no per-frame tick (the performance runs on its own thread); the only per-frame DirectMusic call is the optional notification poll (7.7).

---

## 2. SoundClass: samples (2D and 3D)

### 2.1 Init / shutdown (high)

* `FUN_00443160` -> `FUN_00874195` (constructor): `AIL_set_redist_directory("redist\\WIN32")`, `AIL_startup()`, fills the WAVEFORMAT (22050 Hz / 16 bit / stereo).
* `FUN_004359e4` -> `FUN_00874751` (open devices): `AIL_waveOutOpen(&drv, 0, WAVE_MAPPER, &fmt)`; enumerates 3D providers (`AIL_enumerate_3D_providers`) and tries them in this priority order: "Creative Labs EAX 2 (TM)", "Creative Labs EAX (TM)", "DirectSound3D Hardware Support", "DirectSound3D 7 (Software - Full HRTF)", "... Light HRTF", "... Pan and Volume", "DirectSound3D Software Emulation" (`AIL_open_3D_provider`). **Only when one opens** does it continue: `FUN_0087568e` (open listener), read attribute "Maximum supported samples" (value unused), `FUN_008760d3` (DirectMusic init, section 7.1), `FUN_00874477` (allocate handles), `AIL_midiOutOpen`, `AIL_DLS_open`. (If no 3D provider opens, nothing audible is initialised: irrelevant for the web.)
* `FUN_00874477`: `AIL_allocate_sample_handle` x16 (+`AIL_init_sample`), `AIL_allocate_3D_sample_handle` x16; resets both caches (counts 0, slot flags 0, handle idx 0xff).
* `FUN_004359f3` -> `FUN_00874933` (shutdown): close provider, `FUN_00876a66` (DirectSound release), release handles, `AIL_DLS_close`, `AIL_midiOutClose`, `AIL_waveOutClose`. `FUN_00443170`/`00443185` -> `FUN_008742c7` = `AIL_shutdown`.
* `FUN_004359d5` -> `FUN_00873f74` -> `FUN_00873e26`: **reset of both caches** (free all file buffers with `AIL_mem_free_lock`, counts to 0, handle bookkeeping of the slots cleared), music fade scale back to 1.0, re-read opt[1]. It is called by the main zone-switch loop itself (asm 0x404eb7, right before the zone's init function pointer from the table at 0x89a9c0 is called) and by 28 zone sound-setup functions (e.g. `FUN_004b037e` line 73468 for z02LGI), so the caches hold only the sounds of the current zone.
  Note: `FUN_00873e26` only resets the slot table (it does not call `AIL_end_sample` first; `FUN_00873f83`/`FUN_00874186`, the full "stop everything and clear", is only reached at program shutdown). Zones are expected to stop their loops themselves (122 call sites of the 3D stop wrapper `FUN_004434b0`, 234 of the 2D stop wrapper `FUN_004435b0`).

### 2.2 How a sound is identified and loaded (high)

* A sound is identified by its **sound id** = index into the 902-record, 32-byte table at VA 0x969f80 (formats.md 9.1). Names `SND_*` (ids 0..821) and `CSSND_*`/`CS_SND_*` (822..901).
* Gameplay "loads" a sound once, at zone init, and keeps the returned **slot index**:
  * `FUN_00443580(id)` -> `FUN_00874b68` (2D load): if `count2D < 200`: `slot[count].id = id; flag = 0; buffer = AIL_file_read(path, 0)` (whole file into memory, path = table field 0); returns the **slot index** and increments the count. **If the cache is full it returns 0** (= silently aliases slot 0; real bug, never reached in practice: the biggest zone loads ~170 sounds).
  * `FUN_004433b0(id)` -> `FUN_00874be4` (3D load): same into the 3D cache, additionally stores `(int)maxDistance` (table +0x10) at slot +0xc (read back with `FUN_00874c97`, wrapper `FUN_004433d0` for gameplay).
* Loading the same id twice yields two independent slots (two independent playing instances); loading once allows **only one instance at a time** (see 2.3). So "polyphony" of a sound = number of times the zone loaded it. Example: `SND_BRICKIMAL_MOVE`, car/horn sounds are loaded once, footsteps are loaded as 4 variants (`SND_WALK_GRASS1..4`) and rotated by gameplay (formats.md 9.1 / `col.md` section 4).
* Which sounds each zone loads is hard-coded in per-zone functions. The whole z02LGI list is `FUN_004b037e` (3D vehicles/ambience/cutscene SFX) and `FUN_004b0b37` (player footsteps, skateboard, landings, swimming, throw) and `FUN_004b0240` (menu clicks); other zones follow the same pattern in their init functions (zone init addresses in 7.8).
* 2D vs 3D is decided **at load time by which wrapper the zone calls** (`FUN_00443580` vs `FUN_004433b0`), not by the table. The same table row is used for both (3D uses fields +0xc/+0x10 min/max distance, 2D uses +0x14 pan).

### 2.3 Playing a 2D sound: `FUN_004435a0(slot)` -> `FUN_00874cb4` (high)

```
if slot.flag == 0 (not playing):
    h = first of the 16 2D handles with handle.slot == -1
    if none free: RETURN (sound is dropped; no stealing, no priority, no queue)
    handle[h].slot = slot
    AIL_init_sample(h)
    if AIL_set_sample_file(h, buffer, 0) succeeded:
        AIL_set_sample_playback_rate(h, table.rate)          // field +0x18, Hz, overrides the file rate
        AIL_set_sample_volume(h, table.vol * opt[1] / 100)   // integer division, 0..127
        AIL_set_sample_pan(h, table.pan)                     // field +0x14, 64 = centre
        AIL_set_sample_loop_count(h, table.loop)             // field +0x08, 1 = once, 0 = forever
        slot.flag = 1; slot.handleIdx = h
        AIL_start_sample(h)
    // (if set_sample_file fails the handle stays reserved: slot[h].slot was already written, quirk)
else (already assigned):
    AIL_set_sample_volume(handle, table.vol * opt[1] / 100)   // refresh only, NO restart
    if status(handle) == SMP_DONE(2) and loop_count(handle) == 0: AIL_start_sample(handle)   // restart a stopped looper
```

Consequences:
* **Re-triggering a one-shot while it is still playing does nothing** (volume refresh only). A finished one-shot is released by the per-frame housekeeping (1.4) after which the next call restarts it. So footstep/bump sounds cannot overlap with themselves.
* Gameplay calls this **every frame for loops** (engine hums etc.): the call refreshes the volume (so opt[1] changes are heard) and keeps/restarts the loop.
* There is **no priority and no stealing**: when 16 2D samples play, further plays are dropped.
* `AIL_sample_loop_count` semantics (Miles): 0 = infinite, n = play n times in total (table values 1 / 0 / 4 / 8 / 10 / 64).

### 2.4 Playing a 3D sound: `FUN_00874f01(slot, pos*)` (high)

Same structure on the 16 3D handles, with: `AIL_set_3D_sample_file`, `AIL_set_3D_sample_playback_rate(table.rate)`, `AIL_set_3D_sample_volume(table.vol * opt[1] / 100)`, `AIL_set_3D_sample_loop_count(table.loop)`, `AIL_set_3D_sample_distances(h, max = table+0x10, min = table+0x0c)` (argument order max, min), `AIL_set_3D_position(h, x, y, z)` (3 floats from `pos*`), `AIL_start_3D_sample`. No pan (3D position gives it). If already assigned: volume refresh + restart if DONE and loop count 0 (position is updated by the wrapper before, see below).

The game-level wrapper **`FUN_004433f0(slot, pos*)`** (340 call sites, the normal way to play/update a positional sound) does, in this order (asm 0x4433f0-0x4434ae, high):
1. `FUN_0087563d`: if the slot currently has a 3D handle, `AIL_set_3D_position` to `pos`.
2. Reads the listener position (`FUN_008756e4`), computes `d2 = |listener - pos|^2`.
3. If `d2 <= (int)maxDistance^2` (`maxDistance` = table +0x10 truncated to int via the cached slot value, squared as an int multiply) -> `FUN_00874f01` (play/update); **else `FUN_00875399` (end the 3D sample and free the handle)**.
So **the game culls a positional sound itself at its max distance** (sample stopped; when the source comes back in range the sound restarts from the beginning, loops included). Callers invoke it every frame for every moving/emitting source (vehicles, trains, sea, ambience, cutscene SFX).
`FUN_004434b0(slot)` = explicit 3D stop (`FUN_00875399`).

### 2.5 Stop, volume, pan, pitch (high)

| wrapper | -> | effect |
|---|---|---|
| `FUN_004435b0(slot)` | `FUN_00875332` | `AIL_end_sample`, handle freed, flag cleared. Immediate; **no fade function exists in SoundClass**. |
| `FUN_004434b0(slot)` | `FUN_00875399` | same for 3D |
| `FUN_004435c0(slot, v)` | `FUN_008754ac` | `AIL_set_sample_volume(handle, v)` raw 0..127 (does NOT apply table vol or opt[1]); only 1 caller (line 150944, a snake/race zone around `FUN_0065xxxx`) |
| `FUN_00875528` | 3D raw volume | no wrapper/callers seen |
| `FUN_00443600(slot, hz)` | `FUN_008754ea` | `AIL_set_sample_playback_rate(handle, hz)`: **pitch**, absolute Hz (not a ratio); 37 call sites (vehicle engines, see 5.1). Only for 2D (no 3D pitch wrapper). |
| `FUN_00875569` | `AIL_set_sample_pan` | no wrapper (pan comes from the table) |
| `FUN_004433d0(slot)` | `FUN_008755f2` | returns max distance of a playing 3D sample as float (1 caller, line 91684) |
| `FUN_00443590(slot)` / `FUN_004433c0(slot)` | `FUN_00875409` / `FUN_00875459` | "is idle?" tests. Quirk: when the slot has no handle they test the status of an unrelated handle slot (`+0x1980` resp. `+0x1900`, an off-by-one from the handle array) instead of returning "not playing" (UNCERTAIN what the callers rely on; 4 + 6 call sites) |
| `FUN_00443770` / `FUN_004437a0` | `FUN_00874321` / `FUN_008743dc` | pause all (`AIL_stop_sample`/`AIL_stop_3D_sample` on non-DONE handles, stop ambience sequence, pause speech streams) / resume (status 8 -> `AIL_resume_*`). **No call site and no table references them**: dead code in this build (medium; indirect calls cannot be excluded). |

Pan: table value 64 = centre (0..127 in Miles); `SND_CEDRIC_WALK` has 512 (out of range; Miles clamps; UNCERTAIN whether to hard-right).
There is no global "stop all SFX" at zone exit except the cache reset (2.1).

### 2.5.1 Volume formula (high)

```
sampleVolume(0..127) = tableVol(0..127) * opt[1] / 100          (C unsigned integer division)
gain01               = sampleVolume / 127                       (Miles volume scale is linear 0..127)
```
No separate music/sfx/speech buses in code: music (opt[0]), SFX (opt[1]) and speech (opt[0x16]) are three independent sliders, each applied only to its own system. The ambience **MIDI** sequence is on the SFX slider (4.1). `FUN_008749dc(...)` re-applies the formula to all assigned handles when opt[1] changes (it also calls `FUN_00875c3c` for the MIDI sequence).

---

## 3. 3D audio: listener, distances, missing features

### 3.1 Listener (high for the mechanism, medium for the per-zone choice)

* `FUN_004434d0(pos*, front*, up*)` (28 call sites; one per zone camera update, e.g. `FUN_004afa5c` line 73108) = `FUN_008756bb` (`AIL_set_3D_position(listener, x,y,z)`) + `FUN_00875726` (`AIL_set_3D_orientation(listener, front.xyz, up.xyz)`, argument order face then up).
* The arguments are camera globals: `pos = &DAT_009da5e8` (**camera eye position**, 3 floats), `front = &DAT_009da624`, `up = &DAT_009da618` (the same 0x48-byte camera block `DAT_009da5e8..`, copied at lines 11319/11899). So **the listener is the camera**, updated every frame.
* Exception: three zones pass `&DAT_009da5f4` = the camera **target/player position** instead (lines 56996, 118031, 212533, by proximity the z38PAR, z08BKD and z27TRX "Flying" zone modules: medium), so in those the 3D sound is centred on the player not the camera.
* No velocity is ever set (`AIL_set_3D_velocity*` not imported): **no doppler**. No `AIL_set_3D_distance_factor`, `AIL_set_3D_rolloff_factor`, `AIL_set_3D_doppler_factor`, no EAX environment/effect calls anywhere (the full `_AIL_*` import usage list was grep-checked): everything stays at Miles defaults (distance factor 1.0, rolloff 1.0, doppler 1.0, provider default environment). Sample cones/orientation are not used either (only position + min/max distances).
* Coordinates are the game's world units, passed unscaled (Miles/DS3D is left-handed with +Z forward; the game is also a left-handed D3D renderer: UNCERTAIN, verify against the renderer axes in the port).

### 3.2 Distance semantics (table fields +0x0c min, +0x10 max; high for use, medium for the model)

* Table min is 1.0 for nearly every record (`SND_MENU_*` have min 1.0 / max 200.0); max typically 200 / 128 / 256 / 512 / 756 (formats.md 9.1).
* `AIL_set_3D_sample_distances(max, min)`: inside `min` full volume, beyond `min` Miles' software/DS3D providers attenuate with the **inverse-distance** law (gain ~ min / d at rolloff 1.0). The game additionally hard-cuts at `max` itself (2.4), so effectively: gain = min(1, min/d) for d <= max, 0 beyond max (with a restart when re-entering).
* Hardware/provider differences (EAX2 / DS3D hardware) were not reproduced here; the web port should follow the software model above.

---

## 4. Ambience and per-zone sound loops

### 4.1 MIDI ambience beds (Miles XMIDI sequence, separate from DirectMusic) (high)

* Table at VA 0x97ff48, 6 records `{key, mid path, dls path, volume}` (values in formats.md section 6). Used keys in code (`FUN_004431e0(key, nameBuf)`, 5 call sites): `LGIBirds` (line 78858, z02LGI), `Castle` (107807, z07CSI), `Fishing` (188689, z21FSH), `TRex` (213180, z27TRX, key pushed as `&DAT_0093d8e0`), `Asteroid` (232568, z39ASB). `LGIGulls` is in the table but no code requests it.
* `FUN_004431e0(key, buf)` -> `strncmp(buf, "none", 4) == 0 ? FUN_00875a26 : FUN_00875918` and zeroes the start counter `DAT_009e06e4`. (`buf` is a global byte buffer; what writes "none" there was not traced: UNCERTAIN; both variants load the same `.mid`, `FUN_00875918` additionally calls `AIL_DLS_load_file(dls)` so the sequence uses the zone's DLS bank.)
* Load (`FUN_00875918`): `AIL_file_read(.mid)` -> `AIL_MIDI_to_XMI` (size argument is `AIL_file_size("midiList[i].midiName")`, i.e. the size of a **literal string path**, a developer bug that returns garbage; the conversion works anyway because MSS reads sizes from the MIDI chunks: UNCERTAIN) -> `AIL_allocate_sequence_handle` + `AIL_init_sequence`. `DAT_05d5fa3c = table volume`.
* Run: `FUN_00443230` per frame: counts 5 frames (`_DAT_009e06e4 += 1.0` until > 5.0) then every frame `FUN_00875b16`: `AIL_sequence_status == 2 (DONE)` -> `AIL_start_sequence`. **So the ambience loops forever by restarting when it finishes.** `FUN_00443280` -> `FUN_00875b8a`: end/release sequence, free buffers (zone exit).
* Volume: `AIL_set_sequence_volume(seq, tableVol * opt[1] / 100, 0)` (`FUN_00875c3c`): **SFX slider**, not the music slider; table volumes 64..100 (0..127 scale).
* The same MIDI files + DLS banks are what the XMIDI path plays; in the port they can be rendered by any GM/DLS-capable MIDI player or pre-rendered (they are sparse bird/ambience beds, 22.05 kHz stereo DLS output).

### 4.2 WAV ambience loops (high mechanism, medium per zone)

Zone ambience is plain table sounds with loop count 0 (179 of 902 records), started by gameplay code every frame:
* 2D loops: `FUN_004435a0(slot)` each frame (e.g. `SND_JNGL_AMB`, wind, `SND_SEA_AMB`, vehicle idle loops).
* 3D loops: `FUN_004433f0(slot, emitterPos)` each frame so the engine culls/restarts them by distance (2.4). Examples in `FUN_004b037e` list: `SND_LGI_SEA` (0x125), `SND_LGI_HOUSE_MUSIC` (0x8b, played at house positions, `FUN_...` lines 89795/89944), `SND_TRAIN_*`, cars, `SND_CHOPPER_FLY`.
* **Sea in z02LGI** (line 78368, function ending at 0x4bbe59): the source position of `SND_LGI_SEA` is the **listener position clamped to the island's rectangular shore** (a pile of min/max clamps of `local_28`/`local_20` against `local_30`), i.e. the sound always comes from the nearest coast point. (medium)
* There are no `sound.src` or per-zone ambience data files: the folder names in formats.md section 10 are only the places the table points to. Zone logic = native code (e.g. `FUN_004b037e` is the z02LGI sound-load, called from the zone constructor).

### 4.3 Footsteps / landings

Selection by polygon surface id is in `col.md` section 4; the engine side is only "2D one-shot per variant slot" (`SND_WALK_<SURFACE>1..4` rotated by gameplay, `SND_LAND_*`, `SND_SKATE_*` loops, `SND_LAND_SB_*`). Loaded in `FUN_004b0b37` (lines 73619-73690: 2D slots, `SND_SILENCE`=id 300 fills unused surface slots (z02lgi `Silence.wav`)).

### 4.4 Cutscene SFX (`CSSND_*`) (medium)

* Cutscene scripts (`*.txt`/`*.cut`) have **no sound op**; the only audio op is `SayText` (6.4). Sound effects in cutscenes are driven by **switches**: scripts do `setswitch SWITCH_GME_CSM_SFXnn 1` (30 such names registered at lines 10979-11177); native zone code watches the switch variables.
* z02LGI: `FUN_004b7c78` (line 76560-76590) walks a 12-byte-record table at VA 0x8d9460 `{gameVar, sfxIndex, ?}` (33 records, terminated by gameVar <= 0) each frame; `sfxIndex` indexes the pointer array at `0x5d58214` (41 entries, built at lines 73555-73598 from the `CSSND_*` slots that `FUN_004b037e` loaded as **3D sounds**). Var value 1 = start (`FUN_004433f0` at the actor/camera position) then the var is consumed, 4 = keep updating, 8 = stop (`FUN_004434b0`). (arguments of the consuming `FUN_00417597` calls are dropped by the decompiler: UNCERTAIN)
* Other zones load their own CSSND sounds the same way (e.g. `z07CSI\cutscene hooves`).

---

## 5. Vehicles, UI, misc

### 5.1 Engine sounds follow speed through the playback rate (medium)

Pattern: a looping 2D (or 3D for AI vehicles) sound whose **rate in Hz** is recomputed every frame from a speed/throttle value and passed to `FUN_00443600(slot, hz)`, then `FUN_004435a0(slot)` keeps it running (volume refresh):
* Boats (`FUN_0042f666/0042f77a/0042f88e`, z02LGI boat/jetski/dinghy, ids `SND_BOAT_MOVE` 297 `0x129`, `SND_DINGHY_MOVE` 299 `0x12b`, `SND_JETSKI_MOVE` 141 `0x8d`): a throttle variable (`+0x44`) ramps by ~25..66 Hz per frame (`DAT_008b1718` = frame scale, 1.0 at the reference rate) between an idle rate and a full-throttle rate (e.g. jetski 10253 -> 12237 Hz, boat 9966 -> 11443 Hz, dinghy 10738 -> 11500 Hz) selected by the input mask `DAT_0098383c & 0xa3`; the rate gets a +-5 % sine wobble (`FUN_0042f5f0`: `rate + sin(phase) * rate * 0.05`, phase += 0.05 per frame). The sample itself is a loop (loop count 0) at table rate 22050.
* Skate / speed sections (`FUN_005d2782`): `rate = speed * 0x5bcc / 60 + 0x5fb4` (24 500 + speed * 23 500 / 60 Hz).
* Race zone (line 150915-150950): `rate = clamp((param + k)/c, 0x7a80, 0xf8d4)` (31 360..63 700 Hz) applied to two layered loops; the second also gets an explicit raw volume `FUN_004435c0`.
* Asteroid ship (`FUN_007b6de3/007b6f1f`, z39ASB/z40APO): `rate = 22050 + thrust` for a thrust loop and `22050 + x - y` for a second loop.
* Table `rate` for the base value is the record's own field +0x18 (pitch-shifted copies of one wav exist in the table, formats.md 9.1).
For a Web Audio engine: `AudioBufferSourceNode.playbackRate = rateHz / wavNativeRate` (no 3D pitch wrapper exists, so only 2D loops are pitch-modulated).

### 5.2 UI sounds (high)

| ids | names | file | use |
|---|---|---|---|
| 602-605 | `SND_MENU_MOVE1..4` | `z00FRE\UpDown1-4.wav` | menu cursor move; **round-robin** over the four slots (`FUN_004b02d4`, state `DAT_05d58208`) |
| 606 | `SND_MENU_SELECT` | `Select.wav` | confirm (menu handler, case 4 of the menu action switch, line 14788) |
| 607 | `SND_MENU_BACK` | `Back.wav` | back |
| 608 | `SND_MENU_ONOFF` | `OnOff.wav` | toggle (case 5, line 14804) |
All seven (4 move + select + back + on/off) are loaded by `FUN_004b0240` (line 73425), called from the front-end menu setup (`FUN_0041b9b1`, lines 12836/13046); 2D, vol 33 (on/off 44), rate 44100. Front-end/pause menus call the 2D play wrapper directly. Menu background music: key `menu` (7.8).

### 5.3 Pause / focus

No pause handling reaches the audio in this build (2.5, dead pause/resume). DirectMusic is never paused: music keeps playing under pause menus; on `FUN_00443390` (re-init: `FUN_00876a66` release DirectSound sharing, `FUN_008760d3`) there are no call sites either (dead).

---

## 6. Speech

### 6.1 Playback API (high)

* Speech lines are **MSS streams** of MP3-in-WAV (formats.md 3), not table samples: `FUN_00443630(idx)` -> `FUN_0087584e(idx)`: if `idx < 0` stream handle = 0 (no speech); else path = `sprintf("_Data/sounds/speech/Data/%s.mp3", speechTable[idx])` (`FUN_00875825`, table VA 0x979098, 1732 entries, index = the number in the `.str` line, see 6.3), then `AIL_open_stream(driver, path, 0)`; `operator new(0x10)` + `FUN_00877373` builds the 16-byte **speech object** `{started, finished, ?, hStream}`: ctor registers the end callback `FUN_00877360` (`AIL_pause_stream(h, 1)`) and `AIL_auto_service_stream(h, 1)` (MSS services the stream on its own thread/timer).
* `FUN_008773fd` (start): `started = 1`; `v = opt[0x16] * 0x7f / 100` -> `AIL_set_stream_volume(h, v)` (0..127; computed once at start, not tracked afterwards); `AIL_set_stream_loop_count(h, 1)`; `AIL_start_stream`. **Pan is never set** (centre); the pan/volume wrappers `FUN_00443690/004436a0` have no callers. Speech is therefore always 2D, centre, on the speech slider only.
* `FUN_00877505` (poll): `status = AIL_stream_status`; if `status == 2 (SMP_DONE)`: `finished = 1`, returns 0; else `finished = 0, started = 1`, returns 1. (An opened-but-unstarted stream reports DONE, so "not started" is tracked with the `started` flag.)
* Close: `FUN_00443670(obj)` = pause (`FUN_00877460`) + `AIL_close_stream` (`FUN_008773d2`) + free.
* Pause/resume wrappers `0x443650/0x443660` exist but only the dead pause-all code calls them.
* UNCERTAIN: the end callback `FUN_00877360` pauses the stream; with Miles semantics the stream presumably reaches DONE after the callback so that the poll sees 2. Behaviour to implement: **a line is finished when the audio has ended**.

### 6.2 Speech manager and sequencing (high)

Globals: `DAT_009dab54` = line A object, `DAT_009dab58` = line B object, `DAT_009dab60` = state, `DAT_008b1bb8` = last state (init -1).
* `FUN_00435a11(idxA, idxB)` ("SayText"): **ignored unless both slots are empty** (`DAT_009dab54 == 0 && DAT_009dab58 == 0`: a new request while speech is active is dropped, there is no queue); creates objects for A and (if `idxB != -1`) B. `idxB = -1` = single line.
* `FUN_00435a5e` per frame: after a one-time warm-up (5 frames, `_DAT_009dab5c`) `DAT_009dab60 = FUN_004436d0(A, B)`; when the state returns 0 -> `FUN_00435b07` closes both objects. Then `FUN_008751b6`.
* `FUN_004436d0(A, B)` state machine (high): 
  * B null: poll A; A not started -> start A, state 1; A started and not finished -> state stays 1; A finished -> state 0.
  * B given: poll both; A not started -> start A (state 1); A finished and B not started -> **start B, state 2** (strictly sequential: B starts when A has ended); both finished -> state 0.
* `FUN_00435ad3()` = "speech idle" (returns 1 when state is 0 or not in {1,2}), polled by gameplay to wait for the end of speech before advancing dialogue.
* `FUN_00435b07(0)` stops/ closes both lines (used for skip, e.g. line 17409 when the skip key `DAT_00983840 & 0x40` is pressed).
* **No ducking**: nothing changes music/SFX volume while speech plays (the only music fade, 7.9, is unrelated). Speech just plays on top.

### 6.3 `.str` text <-> speech index (high, verified over all `.str` files; corrects the note in formats.md 3.1)

`FUN_00439bf8(strTable, key, &outIdx)`: finds the string with id `key` (`FUN_004396a0`), copies the **first 4 characters of its value**, `atoi`s them into `*outIdx`, and returns a pointer to the text after them. In the shipped `.str` files this is the `ID:number text` line: `number` **is the index into the speech table at 0x979098** (`speechTable[105] = "LECSPP02"` for `LECSPP02:105 Hallo!`). Checked against all 1641 `ID:number` entries of `messages/**/*.str` (extracted copy): 335 have `speechTable[number] == ID` exactly, 666 use alias keys (`BRIKA`, `HOLOA`, `DJABC`, `LICKA`... NPC dialogue keys) whose number still is a speech index, 640 have `-1` (text only, no speech); **zero mismatches** for ID-style keys.

### 6.4 Where the text/subtitle is shown

* In-game NPC dialogue (`FUN_0042477f` / box code around lines 17352-17830, `FUN_004249a6`): key = 4-char NPC code + letter. For conversation state `n` it looks up `<NPC4><'A'+2n>` and `<NPC4><'A'+2n+1>` (`FUN_00439bf8` x2: two lines, A and B), concatenates the two texts into `DAT_009da6d4`, and then:
  * speech option on (game var 9): `if speech idle: FUN_00435a11(idxA, idxB)` (A then B back to back) else remember the pair (`+0x5c/+0x60`) and play when idle;
  * speech option off: no speech, the box lives on a timer.
  * subtitle option on (game var 0): `FUN_0045d47f(text)` draws it (word-wrapped by `FUN_00439c6f`: `param_8` characters per line, split at spaces, line height from `FUN_0043a080`).
* Box lifetime (`FUN_004249a6`, line 17389): with speech enabled the box stays until `FUN_00435ad3() == 1` (speech finished), otherwise a countdown (`+0x54`, decremented by `DAT_008b1718` per frame; thresholds 30.0 / 15.0 / 2.0 frames-at-30fps units: UNCERTAIN exact seconds). Skip key stops speech and closes the box.
* Zone mini-game announcers (`FUN_00439bf8(table, "LESGPT01"...)` + `FUN_00435a11(idx, idxB or -1)`, many sites in z38PAR line 57078-58506, z05WAB line 103852-104683, z08BKD line 117949-127171...): same API, single or pair of lines.
* **Cutscenes**: the script op `SayText <ID>` (opcode 2 in the op-name registry `FUN_0045988b`, line 50811) is executed by `FUN_0045cf83` (high). On its first tick it looks the key up in the scene's string table `DAT_05d48320` (`FUN_004396a0`, e.g. `LI/Data/LGI01.str`), and:
  * minimum display time `T = (strlen(text) + 20) / 20` time units (`+0x10`), counted down by `0.0333 * DAT_008b1718` per frame (= seconds at the 30 Hz logic step: **1 s + 0.05 s per character**);
  * parses the speech index with `FUN_00439bf8` (6.3) into `+0x2c`; draws the text via `FUN_0045d47f` iff the subtitle option (game var 0) is on;
  * if speech is on (game var 9) and speech is idle, calls `FUN_00435a11(idx, -1)` **once** (latch `DAT_05d4dc90`), skipped when `idx < 0`;
  * the op reports "running" (return 1) until the speech has finished (`+0x30` set when `FUN_00435ad3() == 1`) **and** `T` has elapsed, then "done" (return 2). With speech off, `+0x30` is forced to 1 so only `T` counts.
  * Skip key (`DAT_00983840 & 0x40`): `FUN_00435b07(0)` stops the speech, `T = 0`, op ends.
  * The script's third column (the next event time, see formats.md 3.1) is handled by the cutscene scheduler, not by the audio code; the `SayText` op above is what makes a line "last" as long as its speech/text.
* **Lip movement is not driven by audio** (no audio level query exists in the imports): the op sets random mouth frames on the actor (`FUN_0043f2f0(actor, random)`, `FUN_004388ae(10.0)`) while the line runs.

---

## 7. Music (DirectMusic)

### 7.1 Initialisation sequence: `FUN_008760d3` (object 0x9dec48) (high)

`DAT_05d5fa9c` = initialised flag (re-entry returns 1000). Failure messages (`FUN_008772b7`, an empty stub in this build) are named "Initialise Direct Music", "Initialise Port", "Initialise Performance", "Initialise Loader". Steps (every COM call is bracketed by `AIL_lock()/AIL_unlock()`):

| # | function | COM call | notes |
|---|---|---|---|
| 1 | `FUN_008761e1` | `CoCreateInstance(CLSID_DirectMusic {636B9F10-0C7D-11D1-95B2-0020AFDC7421}, NULL, CLSCTX_INPROC_SERVER(1), IID_IDirectMusic {6536115A-7B2D-11D2-BA18-0000F875AC12})` -> obj+0x00 | then `AIL_get_DirectSound_info(0, &pDS, 0)` and `IDirectMusic::SetDirectSound(pDS, NULL)` (vtbl +0x2c): **DirectMusic renders through Miles' own DirectSound object** (same device, one mix) |
| 2 | `FUN_00876283` | `IDirectMusic::GetDefaultPort(&guid)` (+0x28); `CreatePort(guid, &DMUS_PORTPARAMS, &port, NULL)` (+0x14) -> obj+0x04 | `DMUS_PORTPARAMS` (0x24 bytes): `dwValidParams = 3` (VOICES\|CHANNELGROUPS), `dwVoices = 99`, `dwChannelGroups = 2` (32 channels); then `IDirectMusicPort::GetCaps` (+0x2c, `DMUS_PORTCAPS` 0x134 bytes): if not `dwClass == DMUS_PC_OUTPUTCLASS(1)` **and** `dwFlags & DMUS_PC_DLS(1)`: release the port and loop `IDirectMusic::EnumPort(i, &caps)` (+0x0c) until an output class port with DLS is found, then `CreatePort` again with `dwValidParams = 2`, `dwChannelGroups = 1`. i.e. needs a DLS-capable software synth (the Microsoft Synthesizer). |
| 3 | `FUN_00876543` | `CoCreateInstance(CLSID_DirectMusicPerformance {D2AC2881-B39B-11D1-8704-00600893B1BD}, NULL, ctx 7, IID_IDirectMusicPerformance {07D43D03-6523-11D2-871D-00600893B1BD})` -> obj+0x08 | `Init(&dm, NULL, NULL)` (+0x0c, reuses the IDirectMusic from step 1); `SetGlobalParam(GUID_PerfAutoDownload {FB09565B-3631-11D2-BCB8-00A0C922E6EB}, &1, 4)` (+0x88): **instruments/bands auto-download when a segment is played**; `AddPort(port)` (+0x60); `AssignPChannelBlock(0, port, group 1)` and `(1, port, group 2)` (+0x68): PChannels 0-15 -> group 1, 16-31 -> group 2; `AddNotificationType(GUID_NOTIFICATION_SEGMENT {D2AC2899-B39B-11D1-8704-00600893B1BD})` (+0x58) |
| 4 | `FUN_008766a1` | `CoCreateInstance(CLSID_DirectMusicLoader {D2AC2892-B39B-11D1-8704-00600893B1BD}, NULL, ctx 3, IID_IDirectMusicLoader {2FFAACA2-5DCA-11D2-AFA6-00AA0024D8B6})` -> obj+0x0c | `EnableCache(GUID_DirectMusicAllTypes {D2AC2893-...}, TRUE)` (+0x28): loaded objects are cached |
| 5 | `FUN_00876aa4` | master volume, see 7.5 | |
| 6 | `FUN_00876b8d` | `port->QueryInterface(IID_IKsControl {28F54685-06FD-11D2-B27A-00A0C9223196})`, `IKsControl::KsProperty` (+0x0c) GET then SET of property `GUID_DMUS_PROP_Effects {CDA8D611-684A-11D2-871E-00600893B1BD}` id 0 with the value `& ~1` | **turns the synth's built-in reverb off** (`DMUS_EFFECT_REVERB = 1`; chorus/delay bits unchanged). The designer's reverb is baked into the DLS (`Cedric Reverb Settings.txt` in formats.md 1). |

IIDs/CLSIDs were decoded from the data at VA 0x8946ac/89467c/89432c/893edc/8942bc/893f2c/893fac/893fcc/893fbc/89422c/89423c/893dbc/8944cc and matched against `dmusici.h` (high). Interfaces used are the **DX6/DX7 `IDirectMusic`/`IDirectMusicPerformance`** (not the `*8` variants): no audio paths, no `CreateStandardAudioPath`, no `PlaySegmentEx`. Vtable slot -> method mapping used above follows the DX7 header order (checked for every slot actually used: Init 0x0c, PlaySegment 0x10, Stop 0x14, FreePMsg 0x44, GetNotificationPMsg 0x54, AddNotificationType 0x58, AddPort 0x60, AssignPChannelBlock 0x68, Invalidate 0x78, GetGlobalParam 0x84, SetGlobalParam 0x88, CloseDown 0x98).
Shutdown (`FUN_0087698c`): `Stop(0,0,0,0)`, `CloseDown` (+0x98), `Release`; then `FUN_00876900/00876944/00876a1e` release IDirectMusic / port / loader; `FUN_00876a66` = `IDirectMusic::SetDirectSound(NULL, NULL)`.

### 7.2 Loading a music key: `FUN_00443290(key)` -> `FUN_00876841` (high)

1. Case-insensitive search of the 41-record table at VA 0x97fcb8 (`{key, directory, segment, dls}`; the loop bound `0x28` -> 41 entries; formats.md 7.1). Not found -> returns 0 (NULL handle).
2. `FUN_00876f71(0)`: **resets `GUID_PerfMasterGrooveLevel` to 0** (see 7.6).
3. `FUN_00876c97(dir)` (via thunk `FUN_004432e0` for direct use): `MultiByteToWideChar` and `IDirectMusicLoader::SetSearchDirectory(GUID_DirectMusicAllTypes, wpath, fClear = 0)` (+0x14). The directories are full relative paths, e.g. `_Data\sounds\DirectMusic\z02LGI`; style/band/DLS references inside the `.sgt` are resolved by the loader through this search directory.
4. `FUN_00876d42(segFile, dlsFile)`:
   * `IDirectMusicLoader::GetObject(&DMUS_OBJECTDESC{dwSize 0x350, dwValidData 0x12 (DMUS_OBJ_CLASS\|DMUS_OBJ_FILENAME), guidClass = CLSID_DirectMusicSegment {D2AC2882-...}, wszFileName}, IID_IDirectMusicSegment {F96029A2-4282-11D2-8717-00600893B1BD}, &seg)` (+0x0c). Failure -> NULL handle (e.g. the missing `Lego Town Bridge.sgt`).
   * If a DLS file is named: `FUN_00876759` loads a collection (`GetObject` with `CLSID_DirectMusicCollection {480FF4B0-28B2-11D1-BEF7-00C04FBF8FEF}`, `IID_IDirectMusicCollection {D2AC287C-...}`; **fallback** on failure: object GUID `GUID_DefaultGMCollection {F17E8673-C3B4-11D1-870B-00600893B1BD}` with `DMUS_OBJ_OBJECT\|CLASS`, i.e. the built-in GM bank) and `IDirectMusicSegment::SetParam(GUID_ConnectToDLSCollection {1DB1AE6B-E92E-11D1-A8C5-00C04FA3726E}, 0xFFFFFFFF, 0, 0, collection)` (`FUN_0087cbc0`, +0x4c): **every band of the segment is redirected to the table's DLS**, which is why the stale `DLS Collection1.dls` references inside some `.sgt` do not matter.
   * Both objects are kept in two 10-entry arrays (`DAT_05d5fa4c` segments with counter `DAT_05d5fa44`, `DAT_05d5fa74` collections with counter `DAT_05d5fa48`; the counters also increment when a load fails). Max 10 keys per zone load (z02LGI loads 9 + `bbotsM`/`radio` in the later story branches).
5. Returns a 4-byte wrapper holding the `IDirectMusicSegment*` (the "handle" gameplay stores). No download call is made here: `GUID_PerfAutoDownload` does it at play time (first play may stall while the DLS is downloaded).

### 7.3 Playing: `FUN_004432c0(handle)` -> `FUN_00876ec2` (high)

```
if handle == NULL: return                    // a failed load is harmless
IDirectMusic::Activate(TRUE)                  // vtbl +0x24 (called on every play; harmless re-activation of the device)
IDirectMusicPerformance::PlaySegment(seg, DMUS_SEGF_AFTERPREPARETIME (0x400), 0, 0, NULL)   // +0x10
```
* The flags are **0x400 only** (`DMUS_SEGF_AFTERPREPARETIME`, `dmusici.h` value 1<<10): **no `DMUS_SEGF_SECONDARY`** -> the segment is a **primary segment**: starting it replaces (cuts) the currently playing primary segment right at the start time, **no boundary alignment (not on beat/measure/segment end), no queue, no crossfade**. Start time 0 + `DMUS_SEGF_AFTERPREPARETIME` = "now + the performance's prepare time": **1000 ms** by default (`IDirectMusicPerformance::GetPrepareTime`; the game never calls `SetPrepareTime`, vtable slot 0x1c is only used on a style, asm 0x87718a). Corrected 2026-10-29: this note used to say "tens of milliseconds"; section 11.1 has the evidence and what the port does. The running primary segment keeps playing until that instant and is cut there.
* `FUN_00443300` = `FUN_00876fd6` ("stop music / unload zone music"): `Stop(NULL, NULL, 0, 0)` = stop all immediately (no fade), then Release of all loaded segments and collections, counters reset. Called at zone exit and before loading another key in the front end (line 13027, 13052).
* There is **no fade-out and no segment-end transition**; "music transition" in the game = `Stop` (unload) then `Load(next)` + `Play`, or `Play(otherHandle)` directly (cut).
* Segment repeat counts come from the `.sgt` `segh` chunk (no `SetRepeats` call in code): measured with a quick RIFF scan of the shipped files (table 7.8): `dwRepeats` 9000 (zone themes), 8000 (`ad1T`), 1000 (`Z02Trom`, `Z41MAP`, `ad2`, `bbotsM`, `ogel`, `radio`, `carn`, `menu`) = effectively infinite; **`Flying` repeats only 10 times** (then silence). Loop region = `mtLoopStart..mtLoopEnd` (`Z05WAB1` 92160..116736, `Z08BKD1` 49152..98304, `Z15SSH` 49152..168960, `Z17WAS2` 36864..73728, `Z42BRP` 6144..104448, `ad1T` 9216..340992, `ad2` 6144..73728; others loop the whole segment from 0). Music time = 768 ticks per quarter note.

### 7.4 Other DirectMusic wrappers

| function | what | status |
|---|---|---|
| `FUN_00443370` -> `FUN_00876e7f` | `GetNotificationPMsg(&pmsg)` (+0x54); on S_OK `FreePMsg` (+0x44); returns "a notification was pending" (the notification type registered is `GUID_NOTIFICATION_SEGMENT`: segment start/end/almost-end). Only 4 call sites: z02LGI (`FUN_004bc533` line 78661, per frame, and setup line 78862), and the two adventurer zones (lines 144775, 158611) where it just drains the queue at init. | used (UNCERTAIN what the LGI toggle does with it; `SetNotificationHandle` is never called, so whether the queue ever fills is unverified) |
| `FUN_00443320` -> `FUN_008771d2` | "PlayCSS": `Activate(TRUE)` then `PlaySegment(seg, 0xc200 = DMUS_SEGF_NOINVALIDATE\|DEFAULT\|CONTROL)` | **no callers** (dead) |
| `FUN_00443330` -> `FUN_00877281` | `Stop(segment, NULL, 0, 0)` | no callers (dead) |
| `FUN_00443380` -> `FUN_00876fa6` | get master groove level (`GetGlobalParam`) | no callers (dead) |
| `FUN_00877101` | `Segment::GetParam(GUID_IDirectMusicStyle {D2AC28A1-...}, -1, 0, 0, NULL, &style)` (+0x48) -> `Style::GetMotif(name)` (+0x1c) -> `PlaySegment(motif, 0x1080 = DMUS_SEGF_BEAT\|SECONDARY)` | **no callers**: motif playback exists in the class but is never used; the composer (`FUN_0087671f`, `CLSID_DirectMusicComposer {D2AC2890-...}`) is never created either |
| `FUN_0087cd2a/0087ce1a` | helpers loading a chord map / style object | no callers |
| `FUN_00443390` | `FUN_00876a66` + `FUN_008760d3`: re-initialise DirectMusic | no callers |
So **no motifs, no secondary segments, no template composition, no transitions**: all variation comes from the **groove level** (7.6) and from switching primary segments (7.8).

### 7.5 Volume, mute, fade (high; formula from asm 0x876aa4)

`FUN_00876aa4` (music master volume, called at init, on opt[0] change and by `FUN_00443350(v)` / `FUN_00873e00` / `FUN_00873e13`):
```
mB = (int)( opt[0] * fadeScale * 22.0 - 2200.0 )          // truncation, hundredths of a dB
if mute or opt[0] * fadeScale == 0.0: mB = -20000
SetGlobalParam(GUID_PerfMasterVolume {D2AC28B1-...}, &mB, 4)   // only when different from GetGlobalParam
Performance::Invalidate(0, 0)                                  // vtbl +0x78
```
* So dB = `0.22 * opt[0] * fadeScale - 22`: opt 100 -> 0 dB, 80 (default) -> -4.4 dB, 50 -> -11 dB, 1 -> -21.8 dB, 0 -> silent. This is the DirectMusic **synth master volume** (hundredths of dB); there is no separate music bus beyond that.
* `fadeScale` = float at object+0x28 (`FUN_00873e13(f)` / `FUN_008760a5`, default 1.0, reset by `FUN_00873e26` at each zone sound reset). The only user is the z28HAT (Mr. Hates) scene function `FUN_00796e14` (line 223844) which ramps it between 0 and 1 per frame (`+= or -= DAT_008b1718 * _DAT_008922a0`): a **music fade-out/in** done by repeatedly setting the master volume (not a DirectMusic fade).
* Mute flag at object+0x24 (`FUN_00873e00(bool)`): set by the z02LGI constructor/destructor (`FUN_004bc773`/`FUN_004bcbb1`: `0`) and by `FUN_005367b9` (building code, line 90469: mute when `DAT_05d586d4 == 0` else unmute, UNCERTAIN what triggers it: probably entering/leaving a building interior).

### 7.6 Groove level (the only "intensity" control) (high mechanism, medium usage)

* `FUN_00443310(level)` -> `FUN_00876f71`: `SetGlobalParam(GUID_PerfMasterGrooveLevel {D2AC28B2-...}, &(signed char)level, 1)` (+0x88). DirectMusic adds this offset to the groove level of every command track (`cmnd`), selecting pattern variations whose groove range fits. It is reset to 0 at every key load (7.2).
* The shipped `.sgt` files that **have a command track** (verified by RIFF scan, `cmnd` in `LIST trkl`): `Z01BPK, Z02LGIM/T/Papa/Mama/Trom, Z07CSI, Z10RGB, Z15SSH, Hotep, Flying, Z42BRP, ad1T, ad2, bbotsM, ogel, radio` (matches the zones that call the groove wrapper). Segments without `cmnd` ignore it (`Z02Nick/Laura/Info, Z05WAB1, Z08BKD1, Z17WAS2, Z18MMP*, Z21*, Z28HAT, Z38PAR, Z41MAP, carn, menu`).
* Callers (14 call sites of `0x443310` in the asm): z02LGI (`FUN_004bc533/004bc773/004bc190`, lines 78560, 78625, 78692, 78859), z05 (`FUN_00572780`), z07CSI (`FUN_00575673`, line 108143), z10RGB (`FUN_0061a821`), z13 `ad2` (`FUN_0062b483`...), z15SSH (`FUN_00675930`, `FUN_00676d95`), z23DIP (`FUN_007277f1` line 205243), z41MAP (`FUN_0081fd64`: -1/0), z42BRP (`FUN_00838e41`, lines 256833 (-1), 256841 (0)), `FUN_00725ec1`.
* Typical use: gameplay computes a **player activity level 1..3** and sets `groove = level - 3` (-2, -1, 0) whenever it changes: z07CSI (`+0x18`: 1 default, 2 when the player's animation id is 0x24/0x3f/0x40, 3 when animation id 3 is active and a derived per-frame value changes (meaning UNCERTAIN), lines 108120-108143), z02LGI (`+0x58`: 1 default, 2 for the same animation ids, 3 for input bits 4/8/0x40, line 78610-78630), z15SSH/z16PYA/z23DIP (`local[6] - 3`, lines 144705, 158542, 205243). Constants -2 (0xfffffffe) are applied at zone start in z07CSI (line 106911), z15SSH/z16 (157767) and z23DIP (204360) before the first play: **start calm, raise on activity**.

### 7.7 Notification polling: see 7.4.

### 7.8 Which game event requests which key (high for the key/zone pairs, medium for event timing)

Load sites (asm `call 0x443290`, key strings resolved from the pushed VAs; "zone fn" = Ghidra function containing the call; the zone code in the name is from strings in that function). Play = `FUN_004432c0`, Unload = `FUN_00443300`, zone init loads, gameplay plays at the end of the intro/at level start and unloads at zone exit.

All line numbers are `LE2.c` lines; all 56 call sites of `FUN_00443290` were enumerated from the asm (`call 0x443290`, key string recovered from the pushed address).

| key requested by code | zone (name from strings in the function; "inferred" = from address order) | load site: zone fn / line | play / unload / notes |
|---|---|---|---|
| `menu` | front end: `FUN_0041b9b1` (line 13048, key `&DAT_008a98d8`), z60FRE `FUN_0047172c` (61230), z03PPH `FUN_0053fb1f` (95116), z04IFC `FUN_0054e6e4` (101491) | as given | played right after load; `FUN_0041b9b1` case 0x16 (after the intro/outro movie: `Unload`, `Load("menu")`, `Play`) and case 0x17 (`Unload`, `Load(<key from the screen>)`, `Play`; which key is UNCERTAIN). `Menu.sgt`: no groove track, repeats 1000 |
| `Z01BPK` | z01BPK skate park `FUN_00493506` | 70359 | unload 70416 |
| `Z02LGIM`/`T`/`B`, `Z02Papa`, `Z02Mama`, `Z02Laura`, `Z02Nick`, `Z02Info`, `Z02Trom` | z02LGI main island `FUN_004bc773` | 78779-78795 (and the same list again 78836-78852 for story stage >= 0x3e) | selection logic below; `Z02LGIB` file is not shipped -> NULL handle |
| `bbotsM`, `radio` | z02LGI story stages | 78802-78828 | below |
| `Z05WAB1` | z05WAB `FUN_00569ca6` | 104208 | only level 1 is loaded; `Z05WAB2`/`Z05WAB3` are in the table but **never requested** (the levels replay WAB1: lines 103970, 104071); unload 104242 |
| `Z07CSI` | z07CSI `FUN_00574d9c` | 107806 | groove -2 (106911), play (106912), unload (106925); also ambience `Castle` |
| `Z08BKD1` | z08BKD `FUN_005ba1bd` | 118856 | `Z08BKD2` never requested; unload 118876 |
| `z10rgb` | z10RGB `FUN_005f690b` | 133628 | play 132604 |
| `ad2` | z13CAI (inferred) `FUN_0061b1f4` | 139303 (key pushed via a register, asm `0x61b273`) | groove 0 then play (139004-139005) |
| `ad1T` | z14OSD (inferred) `FUN_0062ba3b` and z16PYA (inferred) `FUN_00677350` | 144769 / 158605 | played immediately after load (144770); groove `level-3` per frame; **`ad1V` is never requested** |
| `z15ssh` | z15SSH `FUN_0065760c`; z20DSP `FUN_006bf929` | 150317 / 174802 | `AdvRace.sgt` |
| `z17was2` | z17WAS `FUN_00699dc7` | 162704 | `Z17WAS1` never requested |
| `Z18MMP`, `Z18MMPPre`, `Hotep`, `Z28HAT` | z18MMP `FUN_006a26a8` | 165335-165338 | all four loaded together; `Hotep` played at 165552/168695, `Z28HAT` at 168377, `Z18MMP` at 169272 (`Z18MMPPre` before the matching game) |
| `Z21FSH`, `Z21Jaws` | z21FSH `FUN_006f468d` | 188679-188680 | `Z21FSH` 188342, `Z21Jaws` 190705/190710 (shark phase); ambience `Fishing` |
| `carn` | z22BIP `FUN_00708457` | 195023 (`&DAT_00931ef0`) | `FlyingCarn.sgt`; play 194550 |
| `ad2` | z23DIP `FUN_00726e25` | 204907 (`&DAT_00935220`) | groove -2 then play (204360-204361) |
| `Flying` | z27TRX `FUN_007663f6` | 212949 | `Flying.sgt` repeats **10** times only |
| `z28HAT` | z28HAT `FUN_007927b5` | 221300 | play 220929, unload 220986 |
| `Z38PAR` | z38PAR `FUN_00466e90` (57472) and z39ASB `FUN_007b7281` (232567) | as given | same `Asteroids.sgt`; there is no `Z39ASB` request |
| `Z40APO` | z40aPO `FUN_007d0b50` | 239197 | `Asteroids.sgt` |
| `ogel` | z40OGL `FUN_007e4222` | 245770 (`&DAT_0094c710`) | `Ogel.sgt` |
| `Z41MAP` | z41MAP `FUN_008138bd` | 252588 | `BlueDanube.sgt`; groove set at `FUN_0081fd64` |
| `Z42BRP` | z42BRP `FUN_008212a3` | 257098 | groove -1 then play (256833-256834), groove 0 (256841) |
| `ad2` | `FUN_008399da` (zone unknown, after z42: UNCERTAIN) | 264371 (`&DAT_0095d940`) | play 264390 |

Table keys never requested by any code path: `Z05WAB2`, `Z05WAB3`, `Z08BKD2`, `Z17WAS1`, `Z39ASB`, `Z02LGIB` (requested but missing file), `ad1V`, `bbotsV`, `LGIGulls` (ambience).

**z02LGI music selection logic** (`FUN_004bc190`, `FUN_004bc533`, `FUN_004bc773`; high for structure, medium for names): the setup stores handles in the zone struct: `+0x18 Papa, +0x1c Mama, +0x20 Laura, +0x24 Nick, +0x28 Info, +0x2c Trom, +0x30 LGIT, +0x34 LGIB (NULL: file missing), +0x38 LGIM, +0x3c bbotsM, +0x40 radio`.
* Story variable `FUN_00417575(0x58)` selects which keys exist: `<7`: all nine town keys (then `+0x48 = 2`), `<0x1f`: `bbotsM` only (played immediately, no town music), `<0x38`: `bbotsM` + `radio`, `<0x3b`: `radio` only (played at once), `<0x3e`: `bbotsM`, else the nine town keys again. (So the "Bricksterbots" menace music replaces the town music during the invasion chapters; `radio` = `BBotdance.sgt` plays while the radio signal switch is on.)
* While in the town mode (`FUN_004bc190`): five distances from the player to building anchors (`DAT_00983804 + 0x3260/0x30c0/0x31f8/0x3330/0x3128`) are compared with the radius `*(zone+0x14) = 0x640 = 1600`: entering a building's radius plays its personal segment (`Info +0x28`, `Laura +0x20`, `Papa +0x18`, `Mama +0x1c`, `Nick +0x24`; the order of the five anchors vs. names is by structure offset, UNCERTAIN which physical house is which); the five tests are an if/else chain, so **the first match wins in the fixed order Info, Laura, Papa, Mama, Nick** (not the nearest building); leaving all radii plays `LGIT` (`+0x30`, "Lego Town Theme", with groove 0) or `LGIM` (`+0x38`, "Lego Town Main") when `zone+0x6c != 0`. Each switch is a hard primary-segment replacement (7.3). Re-entering the same building repeats the cut (state byte `+0x4c` prevents re-triggering while staying inside).
* `Z02Trom` (trombone solo) is loaded but played only through story hooks (`FUN_0053dfda` etc., UNCERTAIN).

### 7.9 Summary of what DirectMusic does *not* do here

No audio paths / 3D music, no reverb (disabled on the port, 7.1 step 6), no secondary/motif segments, no boundary-quantised transitions, no tempo or chord API calls, no `SetRepeats`, no explicit segment end handling: the game just calls Load / Play / Stop / SetGroove / SetMasterVolume. Everything musical is inside the `.sgt` (tempo, chord, style, band, `cmnd` tracks) + `.sty` + `.dls`.

---

## 8. Open questions (needs a runtime check or deeper tracing)

**WP-VERIFY pass (2026-10-29, decompile / PE image only, no Miles / DirectMusic runtime available):** 2, 4, 6 and 9 are settled below; 1, 3, 5 (the building anchors), 7 and 8 cannot be settled without a running original and have no effect on the port's output (reasons per item).
* 2 SETTLED: the five buffers `DAT_05d58644 / 05d58944 / 05d5c4dc / 05d5d2a8 / 05d5ed64` are 4-byte `.bss` globals (image bytes zero) that appear exactly once each in the whole code, as the argument of `FUN_004431e0(name, &buf)` (LE2.asm.txt 0x4bcb55 and the four siblings): nothing ever writes them, so `strncmp(buf, "none" (0x8b1bbc), 4)` never matches and the ambience always takes `FUN_00875918` (the branch the port documents as the normal one); `FUN_00875a26` (no DLS) is unreachable.
* 4 SETTLED: `FUN_00443370` is `FUN_00876e7f` = `IDirectMusicPerformance::GetNotificationPMsg` (vtable +0x54) followed by `FreePMsg` (+0x44), returning 1 only when a message was fetched. `SetNotificationHandle` is never called (section 5 trace; an `AddNotificationType` call was not searched for separately), so DirectMusic returns S_FALSE and the function returns 0 every time, assuming no other registration: the LGI node's `DAT_05d58640/41`, `+0x68..0x74` branch with `uVar2 != 0` never runs. The port's "queue always empty" is exact.
* 6 SETTLED (conversation box without speech, `FUN_004249a6`): the box timer at `+0x54` decrements by `1.0 * dt` per tick (`DAT_00892020` = 1.0, `DAT_008b1718` = dt); with the speech option off (var 9 == 0) the box closes as soon as the timer is below 0 (`DAT_0089202c` = 0.0); when it is below 30.0 (`DAT_00892038`) and speech is on it asks `FUN_00435ad3` (speech idle). With the enabled bit `+0x4c & 2` clear the timer is forced to -1.0, otherwise values above 15.0 (`DAT_00892074`) are cut to 15.0 (`0x41700000`) when the box closes through speech. The initial value is set by the caller that opens the box.
* 9 SETTLED: the three `FUN_0044b040`-style functions (LE2.c:41100-41260) are brick-effect particle movers (`0x160..0x168` = velocity, `FUN_0044d330` / `FUN_0043cec0` normalise), not cutscene sound triggers; their only sound is `FUN_004433f0(id, node + 0xcc)` with the id chosen from `DAT_05d3701c & 0x80000003` (a 4-way pick by a counter). Nothing to do with the CSSND list.
* 1, 3, 5, 7, 8 remain **unsettled but without effect on the port**: they describe Miles / DirectMusic internals (end-of-stream pause semantics, pan 512 clamp, which buildings anchor the LGI distances, the software-provider max distance, how dead pause wrappers might be reached). A capture of the original running would be needed; the port's choices (documented in sections 5 and 9) stay.

1. Exact end-of-stream semantics: why `FUN_00877360` pauses the stream in the MSS callback, and whether a paused-at-end stream reports `SMP_DONE` (assumed).
2. What writes `"none"` into the ambience name buffers (`DAT_05d58644`, `DAT_05d58944`, `DAT_05d5c4dc`, `DAT_05d5d2a8`, `DAT_05d5ed64`) and thus selects `FUN_00875a26` (no DLS) vs `FUN_00875918`.
3. Pan 512 of `SND_CEDRIC_WALK` (clamped how?), and the real left/right handedness of the 3D coordinates vs Miles.
4. LGI notification polling (`FUN_00443370`) purpose; `SetNotificationHandle` never called, so the queue may always be empty.
5. Which physical buildings the five LGI distance anchors are; what story hooks play `Z02Trom`; what zone `FUN_008399da` belongs to; what triggers `FUN_005367b9` (music mute).
6. Subtitle box lifetime in seconds without speech (`FUN_004249a6`/`FUN_0042477f` timers).
7. Whether `AIL_set_3D_sample_distances` max in the software providers silences or only stops attenuating beyond `max` (the game culls itself, so this does not matter in practice).
8. How the 4 pause/resume wrappers (dead code) might be reached through the `0x435xxx` platform stubs (all stubs seen are empty).
9. Whether the three `FUN_0044b040`-style cutscene effect triggers (lines 41100-41260) use the CSSND sounds by index only or also by name; only the z02LGI list was traced.

---

## 9. Implementation notes (Web Audio)

Counts and semantics that matter for an engine:

**Sample engine**
* One `SoundSlot` per `load(id)`; the slot has at most **one voice**. `play(slot)`: if not playing and a free voice exists (**max 16 2D + 16 3D**) start it; if no voice is free **drop** (no stealing); if already playing only update volume (no restart); one-shots auto-release when finished; loops (table loop 0) restart if they stopped. Loop count n > 1 (values 4, 8, 10, 64 exist) = play n times total.
* Per-record fields (formats.md 9.1): `gain = (vol * opt[1] / 100) / 127`; `playbackRate = tableRateHz / wavNativeRate` (table rate always applied, even equal to the file rate); 2D pan: `pan = (table.pan - 64) / 64` clamped to [-1, 1] (64 = centre; 512 is bogus); loop 1 / 0 / n.
* 3D: `PannerNode`, `distanceModel = 'inverse'`, `refDistance = minDist` (1.0), `rolloffFactor = 1`, `maxDistance = table maxDist` used for the **manual cull**: every frame the game evaluates `|listener - emitter|^2 <= (int)maxDist^2`; inside -> play/update (restart from 0 if it had been culled), outside -> stop and free the voice. Listener = **camera eye** + camera forward/up each frame (player position in z08BKD, z38PAR, z27TRX zones). No doppler, no cones, no EAX. Flip Z (or the matching axis) if the renderer is right-handed: DS3D is left-handed.
* Sample rate of the original mixer is 22 050 Hz 16-bit stereo (irrelevant for quality in the browser; do not resample on purpose).
* Zone change = reset: stop all samples and clear both caches, then load the next zone's list (hard-coded per zone; derive the list by scanning the zone init function for `FUN_00443580(id)` (2D) / `FUN_004433b0(id)` (3D) calls, as done for z02LGI in section 4.2).
* Master sliders (0..100, default 80 each): music `opt[0]`, SFX `opt[1]`, speech `opt[0x16]`; subtitles/speech toggles `opt[3]`/`opt[2]`, at least one on.

**Ambience**: MIDI beds (6 records) loop by restart when finished, volume `tableVol*opt[1]/100/127`; render once to audio or use a GM/DLS synth; LGI sea = positional loop at the nearest shore point.

**Speech**: `speechTable[index]` -> `_Data/sounds/speech/Data/<id>.mp3` (MP3-in-WAV); `gain = opt[0x16]/100`; centred; single active speech slot (`SayText` ignored while busy); optional second line B starts when A ends; "finished" = audio ended; no ducking of music/SFX. Subtitle text comes from the `.str` entry whose **number field is the speech index** (-1 = text only); show subtitles iff opt[3], play speech iff opt[2]; while speech plays the dialogue box waits for its end.

**Music (DirectMusic replacement)**
* API to implement: `loadMusic(key)` (table -> segment + DLS; reset groove to 0), `playMusic(handle)` (the new segment replaces the previous primary segment one prepare time, 1000 ms, after the call, from its beginning, no quantisation: 11.1), `stopAllMusic()` (immediate stop + unload), `setGrooveLevel(int8)`, `setMusicVolume(opt0, fadeScale, mute)`, optional `pollSegmentNotification()`.
* Volume: `dB = 0.22 * opt[0] * fadeScale - 22` (silent at 0 or mute) applied to the whole music bus; fade used only in z28HAT (scale ramp per frame).
* Segments loop forever except `Flying` (10 repeats); loop region from `.sgt` `segh` (`mtLoopStart/mtLoopEnd` at 768 ticks per quarter): most whole-segment loops, a few with an intro (`Z05WAB1`, `Z08BKD1`, `Z15SSH`, `Z17WAS2`, `Z42BRP`, `ad1T`, `ad2`).
* DLS reverb of the synth is **off**; the `.dls` named in the table overrides all band references; if the DLS cannot be loaded the GM default bank is used. DirectMusic is an external decoder here: any port must either re-implement the DLS2 synth + style/chord engine or pre-render each `.sgt` at each groove level (`cmnd` tracks: 15 segments have them; levels used: -2, -1, 0 only, `level - 3` for activity levels 1..3, 0 default) to audio loops.
* Music keys per zone: table in 7.8; every zone loads its own keys at init and unloads at exit; LGI switches among up to 11 segments by distance/story state with hard cuts.
* Pause menus do not pause or duck music; nothing but the three volume sliders, mute (7.5) and the z28HAT fade changes music level at runtime.

**Dead code** (no call sites; do not port): pause-all/resume-all samples, speech pan/volume wrappers, motif playback, `PlayCSS`, DirectMusic re-init, get-groove-level, composer.


---

## 10. DirectMusic internals as found in the game's files, and our playback engine

Sections 1-9 are about the EXE (what the game asks DirectMusic to do). This section is about what DirectMusic then does with the `.sgt` / `.sty` / `.dls`
files, derived from the files themselves (the DirectMusic format headers `dmusicf.h` are only used as a guide; every layout below was checked on all files).
Code: `src/audio/dm/` (`format.ts` parsers, `sequencer.ts` composer, `dls.ts` + `synth.ts` synth, `player.ts` glue). Confidence tags as above; "UNCERTAIN" marks places where the original
behaviour could not be verified without running the original (no reference renderer exists on this machine).

### 10.1 Segment (`DMSG`) layout

* `segh` (24 or 40 bytes): `u32 dwRepeats`, `i32 mtLength`, `mtPlayStart`, `mtLoopStart`, `mtLoopEnd`, `u32 dwResolution` (always 0), rest unused. Times are `MUSIC_TIME` ticks, **768 per quarter note**.
  Repeats are 100 / 1000 / 8000 / 9000 (effectively endless) and 10 for `Flying.sgt`; loop = `mtLoopStart..mtLoopEnd` (see 7.3). Playing starts at `mtPlayStart` (0 everywhere).
* `LIST trkl` -> `RIFF DMTK`: `trkh` (32 bytes: class GUID, `dwPosition`, `dwGroup`, 4-char `ckid`, 4-char `fccType`), optional `trkx` (flags, priority), then the track body. The 223 tracks of the 50 files are exactly these types (nothing else occurs):

| track | count | body | layout (little endian) |
|---|---|---|---|
| tempo | 49 | chunk `tetr` | `u32 cb=16`, then items `{i32 time, 4 pad, f64 bpm}` |
| chord | 47 | `LIST cord` | `crdh` = `u32` scale pattern; each `crdb` = `u32 cbChord (40)`, chord `{16 x UTF-16 name (garbage after the NUL), i32 time, u16 measure, u8 beat, u8 flags}`, `u32 nSubChords`, `u32 cbSub (20)`, subchords `{u32 chordPattern, u32 scalePattern, u32 inversionPoints, u32 levels, u8 chordRoot, u8 scaleRoot, 2 pad}` |
| style | 41 | `LIST sttr` | one `LIST strf` per entry: `stmp` (`u32` tick) + `LIST DMRF` (`refh`, `guid`, `name`, UTF-16 `file`) naming a `.sty`; the style in force at a tick is the last entry with `time <= tick` |
| band | 47 | `RIFF DMBT` | `LIST lbdl` -> `LIST lbnd`: `bdih` (`i32 time`) or `bd2h` (logical, physical time), then `RIFF DMBD` (a band) |
| command | 28 | chunk `cmnd` | `u32 cb`, items `{i32 time, u16 measure, u8 beat, u8 command, u8 grooveLevel, u8 grooveRange, u8 repeatMode, pad}`; all commands are 0 = groove; `repeatMode` 223 in 7 files is leftover (UNCERTAIN, ignored) |
| mute | 1 | chunk `mute` | items `{i32 time, u32 pchannel, u32 map}`; `map == 0xffffffff` mutes the channel, `map == pchannel` unmutes (`Flying/Control mute no str.sgt`: not in the music table, nothing in the EXE uses it) |
| sequence | 8 | chunk `seqt` whose payload is again a chunk stream: `evtl` (items `{i32 time, i32 duration, u32 pchannel, i16 offset, u8 status, u8 d1, u8 d2, 3 pad}`) and `curl` (curves) | canned MIDI-like events: 0x90 note on with duration, 0xb0 controller, 0xe0 bend. Used by the segments **without** a style track: `Z08BKD1/2` (1938 / 985 events), `Z15SSH` (1933), `Z17WAS1/2` (637 / 1518), `Flying` (32, next to its style) |
| time signature | 2 | chunk `tims` | items `{i32 time, u8 beats, u8 beat, u16 gridsPerBeat}` (Blue Danube, 3/4) |

A segment's chord track is the only source of chords; 42 of the 50 segments have exactly one chord `"M"` (or `"M7"`, `0x891`) = C major triad (`0x91`) in C major (`0xab5ab5`), chord root 12; 7 have none, `Town Bridge.sgt` has 10.
Chord roots are 0..23 with **12 = C** (`Town Bridge.sgt` has chords with roots 13 and 7 = C# and G a fifth below). `levels` are the sub-chord levels (one subchord per level 0..3).
Without a chord track DirectMusic uses a default chord; we use the same C major triad (`radio` = `BBotdance.sgt` has none).

### 10.2 Style (`DMST`) layout

* `styh` (12): `{u8 beatsPerMeasure, u8 beat (4 = quarter), u16 gridsPerBeat}`, `f64 tempo`. Styles use 4/4 with 2, 4 or 8 grids per beat (two 3/4 styles).
* `LIST part`: `prth` (154 or 160 bytes): `{time signature (4), u32 dwVariationChoices[32] (128), GUID, u16 measures, u8 playMode, u8 invertUpper, u8 invertLower, pad[, u32 flags]}`;
  `note` (`u32 cb` = 22 or 24, items `{u32 grid, u32 variationMask, i32 duration, i16 timeOffset, u16 musicValue, u8 velocity, u8 timeRange, u8 durRange, u8 velRange, u8 inversionId, u8 playMode[, 2 pad]}`);
  `crve` curves (cb 28 or 32; 20 of them in the whole set, volume / pan CCs and pitch bend).
  `grid` is in grid units of the part's time signature (grid = 768 * 4 / beat / gridsPerBeat ticks), `duration` and `timeOffset` in ticks. **All 97 222 notes have `timeRange = durRange = velRange = 0`**: there is no
  randomisation inside a note; the only chance elements are the choice of pattern and of variation. `timeOffset` is used a lot (27 000 notes with |offset| >= 100 ticks: swing / feel baked in).
* `LIST pttn`: `ptnh` (10 or 16 bytes): `{time signature, u8 grooveBottom, u8 grooveTop, u16 embellishment, u16 measures[, dest groove]}`; `rhtm` (one `u32` chord-rhythm mask per measure; `1` for measure 0 and 0 elsewhere in
  the files I looked at), `LIST pref` -> `prfc` (22 or 28 bytes: `{GUID part, u16 logicalPartId / u32 pchannel, u8 variationLockId, u8 subChordLevel, u8 priority, u8 randomVariation}`), `mtfs` only for motifs.
  681 patterns in 229 styles; **all embellishments are 0 (normal)**, no motifs. Groove ranges: 179 patterns 1-1, 170 3-3, 165 2-2, 35 1-100 and many single levels 4..40 ("ThemeBar1..18",
  "MediBar1..22": one pattern per bar of the tune, selected by a command track that steps the groove level one measure at a time).
* In the 22-byte `prfc` form the `u16` logical part id **is the PChannel** (the first partref of a pattern uses channel 0..23 matching the band's PChannels). `subChordLevel` is 0 everywhere except two refs.
* Play modes seen: `prth.playMode` 14 (NORMAL = CHORD_ROOT 2 | SCALE_INTERVALS 4 | CHORD_INTERVALS 8) for 5710 parts, 0 (FIXED) for 577, 1 for one part; **a note's own `playMode`**: 14 (87 164), 16 (`DMUS_PLAYMODE_NONE` = "use the part's mode", 9961),
  0 (97). Rule: `mode = note.playMode == 16 ? part.playMode : note.playMode`. Part mode 0 with note mode 14 (11 555 notes) means NORMAL conversion.
* Variations: `variationChoices[i]` (the chord-type mask) is `0x7fffffff` or `0x3fffffff` for every used variation, i.e. every variation is allowed on every chord; only 420 of 6288 parts have more than one variation; 131 parts are shorter
  than their pattern. `randomVariation` is set on all part refs; `variationLockId` is 0 or 1 (323 refs lock together).

### 10.3 Band (`DMBD`) layout and the instrument entries

`LIST lbil` -> `LIST lbin`: `bins` (40 or 42 bytes) `{u32 patch, u32 assignPatch, u32 noteRanges[4], u32 pchannel, u32 flags, u8 pan, u8 volume, i16 transpose, u32 channelPriority[, i16 pitchBendRange]}`,
then `LIST DMRF` (the `.dls` file) unless the entry is a GM-default instrument.
* `patch` = `(MSB << 16) | (LSB << 8) | program`, bit 31 = drum kit. Matches `DLS insh.ulBank/ulInstrument` (`MSB = bank bits 8-14`, `LSB = bits 0-6`, drum = bit 31). Custom DLS instruments use LSB 1 (e.g. `0x10102`).
* Flags are mostly `0x8e3` / `0xe3` (PATCH, ASSIGN_PATCH, TRANSPOSE, GM, GS, sometimes USE_DEFAULT_GM_SET) and `0x361` / `0x1e1` for GM entries. **`pan` and `volume` are filled in all entries although the PAN / VOLUME flags are not set**; we apply them
  (older Producer versions had no such flags). UNCERTAIN: the Microsoft synth may ignore them (then every channel would sit at CC7 = 100 and centre).
* **`transpose` is -24 (sometimes -12 / -36 / 0) and applies to every note including percussion**: percussion regions of the DLS sit at keys 12..62, i.e. kick 36 - 24 = 12, snare 38 - 24 = 14. (verified: this is what makes the drum notes hit the DLS regions.)
* The game connects every band to the table's `.dls` (7.2), so the lookup of an entry is: primary collection by `(drum, MSB, LSB, program)`, then the collection named in the entry. Entries that are not found in the DLS and have no DMRF are the Microsoft GM set (`gm.dls`, not shipped):
  of the 41 music keys, notes are lost to this only in `Z18MMPPre` (channel 10 patch `0x106`: 146 notes in 60 s of 779) and `Hotep` (2 of 142); empty drum entries `0x80000000` on channels without notes are irrelevant.

### 10.4 Music values (`wMusicValue`) and chords

Derived from the data and checked against the DLS regions of percussion parts (4527 percussion notes, 96% land exactly on a region key, 99% / 94% / 97% / 94% for the four nibble classes) and against the MIDI export in 10.7:

```
bits 12-15  octave                 5 = middle C (MIDI 60): key = octave * 12 + ...
bits  8-11  chord tone index       0 root, 1 third, 2 fifth, 3 seventh ...; a triad has no 4th tone: the missing tones are the scale degrees 1,3,5,7,9 above the chord root (so index 3 of C = B)
bits  4-7   scale offset           scale steps above that chord tone (0 or 1 in the files)
bits  0-3   accidental             signed nibble: 15 = -1, 1 = +1 semitone
key = octave*12 + (chordRoot - 12) + chordToneSemitones + scaleStepDelta + accidental      (then + the band's transpose)
```
Chord tones come from the set bits of `chordPattern` (`0x91` = 0, 4, 7), scale steps from the set bits of the 12-bit `scalePattern` rotated by `scaleRoot` (`0xab5` = major). The subchord of a part is the one whose `levels` mask contains `1 << subChordLevel`.
FIXED mode (0): the value is the MIDI key. Notes in modes without CHORD_ROOT ignore the chord root. Implemented in `musicValueToKey` (`dm/sequencer.ts`); after conversion all but 1.15% of notes fall into a region of their instrument (see 10.7).

### 10.5 Composer rules we implement (`dm/sequencer.ts`)

The segment is generated lazily **one beat at a time** (that is also the finest granularity of a transition request). Per window `[ws, we)` in local segment ticks:
1. tempo items, band entries (sent when their time is reached; at a loop restart bands are sent again), mute items, `seqt` events and curves inside the window are emitted;
2. if the window starts a measure: command at `ws` (last item with `time <= ws`) gives the groove level, **plus the performance's master groove level** (`GUID_PerfMasterGrooveLevel`, signed byte, the game sets -2..0; clamped to 1..100); the style at `ws` comes from the style track;
   the current pattern is kept while the style is the same, the pattern has measures left and the groove level is still inside its `[bottom, top]`; otherwise a new pattern is picked among the style's normal patterns whose groove range contains the level
   (nearest range if none; random among equals). The measure counter restarts at 0;
3. variations are chosen when a part (re)starts its cycle: random among the variations that have notes (and a non-zero choice mask), locked part refs share the choice; **part measure = pattern measure modulo part length**;
4. notes of every part ref whose grid falls inside the window are emitted at `measureStart + (grid - partMeasureStartGrid) * gridTicks + timeOffset`, converted with the chord valid at that tick, with the part ref's PChannel.
Tempo: segment tempo track of the primary segment only; the style's own tempo is not used when a tempo track exists (all 49 do). Loops: at `loopEnd` repeat `dwRepeats` times from `loopStart` (pattern state restarts), then play on to `length`.
Segment start / replacement: a primary segment replaced by another sends `reset` (all channel instruments and controllers forgotten, old notes released) at the transition tick; the new segment's bands re-establish the instruments.
UNCERTAIN (not verifiable here): the original's exact pattern-selection scoring (it also weighs the pattern's chord-rhythm mask `rhtm` against the chord track, and has repeat modes), the sequential vs random variation order, whether a pattern is dropped when the groove level changes
mid-pattern or only at its end. For this game almost every pattern is one measure and every segment uses one or a few chords, so the differences are small: the one-measure "bar" patterns reproduce the notated tunes exactly, the multi-measure ones (Menu: 20 measures) play as written.

### 10.6 DLS (`DLS `) as used, and the synth (`dm/dls.ts`, `dm/synth.ts`)

31 collections, 345 instruments, 1157 regions, 1140 waves: **all waves are 16-bit mono PCM** (5.5 - 44.1 kHz, 685 at 22.05 kHz, 403 at 44.1 kHz). Every region has a `wsmp` (unity note, fine tune 0, attenuation 0); 311 regions have one forward loop (type 0), 846 none;
`options = 1` (no truncation) on 1126 regions, `3` on 31. Region keys are 1 key wide for percussion.
Articulation (`lart`/`lar2`, `art1`): **only static destinations occur** (counts are connections in instruments / regions): EG1 release time (`0x209`: 336 / 42, mostly 0.2 - 3 s; only 8 instruments have none), EG1 attack (`0x206`: 12 instruments, -10058 .. +1720 cents),
EG1 sustain (`0x20a`: 4 / 7, values 85-99%), pan (`0x04`: 4 instruments / 48 regions, up to +-47%), filter cutoff `0x500` (189 / 43) with the "disabled" value `0x7fffffff`, and 6 velocity -> EG1 attack connections (`Hi Brass`, `Timpani`, `Bar Orch 2`, `NooToot`) whose base attack is
the default 0 s, so they have no audible effect. **There is no LFO, no EG2, no active filter, no modulator, no key-number connection, no reverb / chorus send** in any of the 31 files (the synth ignores everything with a non-zero source).
The synth therefore implements: sample playback with linear interpolation, `key -> pitch` at 100 cents per key around the unity note (+ fine tune, + pitch bend, default range 2 semitones), forward loops, EG1 (min. 2 ms attack, sustain level, release from -0 dB to -96 dB in the release time, min. 15 ms),
velocity -> gain `(v/127)^2`, CC7 and CC11 `(x/127)^2`, CC10 equal-power pan plus the region pan, CC64 sustain pedal, key groups (not used), regions chosen by key and velocity, 99 voices with stealing (releasing / oldest first).
"No truncation" (options bit 0) without a loop: the sample is played to its end whatever the note length (note-off ignored until the end); drum kits ignore note-off unless the region loops. Output is a soft limiter above 0.9 and the music master volume (dB formula in 7.5).
The original renders through Microsoft's software synth at its default **22.05 kHz** (the port was created without a sample-rate parameter): the original is band-limited to 11 kHz and used its own interpolation; we render at the context rate with linear interpolation (UNCERTAIN: nothing in the files depends on this; it is a difference in brightness only).
The game switches the synth's reverb off (7.1 step 6), so none is implemented. Polyphony needed: the densest key (`Z42BRP`) peaks at 88 voices within 60 s (the game's port allows 99; `MusicEngine` uses 99, `MusicRenderer` defaults to 80).

### 10.7 Verification (what "correct" can mean here)

`node tools/audio-test.mjs` (1845 checks). The style engine has no reference player on this machine, so correctness is established structurally:
* **Independent MIDI export**: `DirectMusic/dance/BBSGTRDRMS.mid` (not in any table: a development leftover of the same BBots dance music) is a sequencer export of the same tune, division 480. Comparing it with our rendition of `BBotdance.sgt`
  (beat position x MIDI key): the drum channel matches **434 of 434** generated notes exactly (the MIDI has 446: its hi-hat at beat 0 plays on the first pass only), the bass channel contains 100% of the export's notes (the export is a sketch: ours has more);
  channel 11 (a variation-chosen part) matches 33%. This confirms grid timing, time offsets, tempo, chord roots, music values and the transposition-free key mapping of NORMAL mode.
* DLS regions: with the key mapping of 10.4, 98.85% of the 57 278 notes of the 40 loadable keys (60 s each) land inside a region of their instrument (656 miss = 1.15%; another 149 are lost to band entries without a DLS instrument, 10.3).
  Almost all misses are percussion, single music values that fall one semitone beside a region (`0x6010` on `Cym`, `0x8201` on `Salsa perc`, `0x330f` on `Drums`: either a quirk of the original or an unverified detail of the conversion);
  the few melodic ones (`Marimba` in `Z17WAS1/2`, `Tuba`, `Brass Pows`) lie below the lowest region of the instrument (a DLS synth plays nothing there either).
* Timing: 4/4 measure at 95 BPM = 2.526 s; the loop restarts after 20 measures; tempo changes (Blue Danube 100 -> 160 at tick 2304) take effect in order.
* Groove level: `Lego Town Main` produces 127 / 278 / 947 notes in 30 s at master groove -2 / -1 / 0: the game's "activity level" really makes the music denser (patterns `19.1 / 19.2 / 19.3`: ranges 1-1, 2-2, 3-3, the command track says 3).
* Synth: A4 (key 69) = 440.0 Hz, +-1 octave, +-2 semitone bend and 44.1 / 48 kHz equality with a synthetic loop; release timing; voices end.
* Audio statistics for all keys (`audio-render-music.mjs`, 40 s): peak -12 .. +2.6 dBFS before the limiter (only `Z01BPK` and `Z15SSH` exceed 0 dBFS slightly and are soft-limited), RMS -12.9 .. -26 dBFS, no silent key, no NaN. Whether it sounds right can only be judged by listening.

### 10.8 Fidelity summary and open issues

* Faithful: the file semantics above, groove level, the primary-segment hard cut, loops / repeats, `Flying` ends after 10 repeats, volume formula, instrument redirection to the table's DLS, tempo and time offsets, bands (patch / pan / volume / transpose).
* Approximated: pattern and variation choice among equals (random with a seeded generator, original unknown), linear interpolation instead of Microsoft's, no 22.05 kHz band limit, volume / pan of band entries without flags (applied), velocity and CC curves (squared), loudness of the master mix (soft limiter instead of DirectMusic's own gain staging).
* Missing: the Microsoft GM bank for the few GM-default band entries (silence), the `Z02LGIB` segment (file missing: the game gets NULL too, nothing plays), motifs / secondary segments / templates (the game never uses them; secondary playback and mute tracks are implemented and tested only with synthetic calls),
  `bRepeatMode` of commands, chord-rhythm matching, inversion maps, curves other than CC / pitch bend.
* Latency: see 11.1. The start of a segment is scheduled on the renderer's clock at call time + the prepare time (1000 ms, the original's `AFTERPREPARETIME`), sample accurate (`DmPerformance.play({ atSec })`, `MusicRenderer.playAt`), and what the replaced segment would still have played after that instant is dropped. (Before 2026-10-29: the next generated beat boundary plus the stream's 0.3 s buffer, 0.4 - 0.9 s.)
* Cost: the synth renders about 20 - 40x faster than real time in node for the densest music with the default settings, on the main thread via `SynthStream` (1024-frame blocks every ~20 ms).


---

## 11. WP-AUDIO pass (2026-10-29): when things start, what is loaded, 3D, speech, notifications

What changed in the port compared with sections 1-10, with the evidence. Code: `src/shell/audiohost.ts` (zone sound caches, music moments, listener, speech tick), `src/audio/zonesounds.ts` (generated),
`src/audio/zonemusic.ts`, `src/audio/listener.ts`, `src/audio/sea.ts`, `src/audio/music.ts` / `dm/sequencer.ts` / `dm/player.ts` (start time, notifications), `src/audio/speech.ts` (state machine).
Tests: `node tools/test-formats.mjs --only audio-zonesounds,audio-music-sched,audio-sea` (also part of the full run), browser: `tools/audio-moments-all.mjs` (below).

### 11.1 DirectMusic start time: one prepare time, not "tens of milliseconds"

`FUN_00876ec2` (Play): `Activate(TRUE)`, then `PlaySegment(seg, dwFlags = 0x400, i64StartTime = 0 (two zero dwords), ppSegmentState = 0)` (asm 0x876f22-0x876f45: `push 0, 0, 0, 0x400, seg, this; call [vtbl + 0x10]`).
`0x400` is `DMUS_SEGF_AFTERPREPARETIME` ("resolve time to a time after the prepare time", dmusici.h / MSDN `DMUS_SEGF_FLAGS`). The prepare time of a performance is `GetPrepareTime` = **1000 ms by default**
(MSDN: "the performance calculates the end time for each call to a track by adding the prepare time to the current time ... the default 1000 ms"; Wine's dmime: `dwPrepareTime = 1000`). The game never changes it: the vtable slot of
`SetPrepareTime` is 0x1c, and the only `call [reg + 0x1c]` in the whole DirectMusic class (0x876010-0x877340) is `Style::GetMotif` (asm 0x87718a, dead code). So **a segment starts one second after `FUN_004432c0`**, and the primary segment that was
playing keeps playing until then and is invalidated at that instant (no `DMUS_SEGF_NOINVALIDATE`: notes are cut off and reset at the start time, MSDN). The earlier note "tens of milliseconds" (7.3) was wrong; the work package asked to cut the start
latency "to tens of ms"; the exact behaviour is a delay of the prepare time, and that is what the port now does (the constant is `DM_PREPARE_TIME_MS` in `src/audio/music.ts`, `MusicEngine.prepareSec`; one line to change if a reference recording ever shows otherwise).

Implementation: `DmPerformance.play(assets, { atSec })` places the start on the performance clock (exact tick, recomputed while the tempo map grows); `MusicRenderer.playAt` additionally drops the events of the old primary segment that are already
queued and fall at or after that instant; `SynthStream.lead` says how far the render head is ahead of what is audible, so `MusicEngine.play` computes "now + prepare time" on the render clock. Result: the first note of the new segment is on the instant
(+- one 512-frame block in the test, sample accurate in the renderer), the old segment sounds until it, nothing of the old one sounds after it. Verified by `tools/tests/audio-music-schedule.mjs` (idle start, a cut after generated material, a cut inside
already queued windows; canned-sequence segments Z08BKD1 -> Z17WAS2 so the comparison is exact). No AudioWorklet was needed: the start is scheduled, not rendered late. `Stop` (`FUN_00443300`, flags 0 = immediately) still takes effect at the next
generated point (0.1 - 0.4 s): the notes are released, not cut, like the original's note-offs.

### 11.2 Where the original calls Play (A1): per zone

`FUN_004432c0` is called from the zone's loop at exactly one of three moments (LE2.c line of the call in brackets; modes: 7 fade in, 0 init, 1 intro, 9 controls help, 2 play). The port starts each key at its moment (`ZONE_MUSIC` in `src/audio/zonemusic.ts`; the
runner reports mode changes with `AudioHost.modeChange`, `playzone.ts`); a zone whose port has no intro / help mode starts it when play starts.

| moment | zones (key) |
|---|---|
| **init** (zone start; after the load, before the first frame) | z60FRE, z03PPH, z04IFC (`menu`; 61024, 94631, 98831), z07CSI (`Z07CSI`, groove -2 first; 106912), z13CAI (`ad2`; 139466), z14OSD (`ad1T`; 144770), z16PYA (`ad1T`, groove -2; 157768), z23DIP (`ad2`, groove -2; 204361), z40OGL (`ogel`; 244926), z50LTC (`ad2`; 264390) |
| **leaving the intro** (mode 1 -> 2 or 1 -> 9) | z01BPK (`Z01BPK`; 67567), z13CAI (`ad2` again with groove 0; 139005), z40aPO (`Z40APO`; 238850), z41MAP (`Z41MAP`; 251776), z50LTC (`ad2` again; 264073) |
| **leaving the controls help** (mode 9 -> 2) | z05WAB (`Z05WAB1`; 104071), z08BKD (`Z08BKD1`; 118236), z10RGB (`z10rgb`; 132604), z15SSH + z20DSP (`z15ssh`; 150157, 174301), z17WAS (`z17was2`; 162498), z21FSH (`Z21FSH`; 188342), z22BIP (`carn`; 194550), z27TRX (`Flying`; 212791), z28HAT (`z28HAT`; 220929), z38PAR + z39ASB (`Z38PAR`; 57316, 232273), z42BRP (`Z42BRP`, groove -1; 256834) |
| by the zone's own code | z02LGI (Music node: building / story logic, 78558-78831), z18MMP (`Hotep` at mode 9 -> 2 and the puzzle's events: 165552, 168377, 168695, 169272), z21FSH `Z21Jaws` (190705), z05WAB again when the game ends (103970: `FUN_004432c0(DAT_05d5881c)` restarts the segment), z42BRP groove 0 at the second help |
| no music | z09JST, z36CNT (no `FUN_00443290` in their code) |

(z13CAI and z50LTC play twice: once at init and again when the intro is left, from the start of the segment.) `gaps.md` listed z50LTC as "no music": its zone function `FUN_008399da` loads `ad2` and plays it (264390), so the table above has it.
The five ambience beds (`FUN_004431e0`, start at init): z02LGI `LGIBirds` (the Music node), z07CSI `Castle`, z21FSH `Fishing`, z27TRX `TRex` (missing in the port; the host starts it), z39ASB `Asteroid` (the zone's game starts it).
Verification in the browser (headless, muted; `tools/audio-moments-all.mjs` drives every zone through its loop modes and compares the host's and the music engine's logs with this table): see the result lines in `docs/re/gaps.md` A1.

### 11.3 What each zone loads (A2)

The SoundClass caches hold only the sounds of the current zone: the zone switch resets them (2.1) and each zone's **sound-setup function** (the 28 callers of `FUN_004359d5`, plus `FUN_00708640` of z22BIP) loads its list with straight-line
`push id; call FUN_00443580 (2D) / FUN_004433b0 (3D)` code before the zone loop runs, so every sound plays the first time. `tools/gen/gen-zonesounds.py` (run from `decomp-le2` with its venv) scans those functions in `LE2.asm.txt` and writes
`src/audio/zonesounds.ts`: 30 zone lists (934 loads; duplicates kept: a sound loaded n times has n slots), plus the loads of `FUN_004b0240` (menu clicks, every zone loop through `FUN_0041b40e`), `FUN_004b0b37` + `FUN_004b0f16` (Pepper walking: the
`SGwalk` constructor `FUN_0042f470`, registered in z02LGI, z03PPH, z07CSI, z10RGB, z14OSD, z16PYA, z21FSH, z23DIP, z40OGL, z50LTC), `SGBoat` (`FUN_00430e6c`: z02LGI, z07CSI) and `Ptera` (`FUN_004bb1a6`: z02LGI, z13CAI). The z60FRE list is what the menu code loads
after the movies (`FUN_0053e7c0`, `FUN_004b0240`, `FUN_004b0b37`, line 13045) plus the zone function's own 3D load of `SND_SILENCE`.
`AudioHost.enterZone(zone)` (awaited by `runPlayZone` before the loop starts) loads the list, the class sets the zone registers and its music key(s); `world.sfx.play(id)` / `playAt(id, pos)` find their slot; a zone's own loader that runs later finds the decoded
files cached. A sound the list does not hold (a bug in the list or a sound the original would load lazily) is loaded on demand and its play waits for the load instead of being dropped (`AudioHost.missed` lists them; empty in every zone entry of the browser run).
`tools/tests/audio-zonesounds.mjs` re-scans the executable's bytes (`push imm; call` inside each function range) and compares with the table (30 zone lists + 4 sets: identical), checks the 200-slot caches, that every id of the port's footstep code, of
the seven zones' own `SOUNDS_2D/3D` lists and of the 15 zones' `SND` tables is a sound the original's zone loads (A10: z41MAP, z17WAS, z39ASB included: no mismatch).
Not in the lists (loaded by object constructors with ids from the object's data): `Sound3d` (`FUN_00538779`, 3D, id = first argument), `SGMFIG` (`FUN_00426151`, 2D, id = argument at +0x18), the cutscene action `FUN_0045f702` (3D, first use). The island loads the first two from its
placed nodes when the zone game is bound (`IslandContext.loadObjectSounds`); the hubs must do the same for their `Sound3d` / `SGMFIG` nodes (`AudioHost.loadExtra`). The mini-game zones that load their own slots keep doing so (the decoded files are already cached).
z50LTC, z17WAS and z03PPH used to "prime" their sounds by playing them (the first play was dropped): that is removed (it would now play them).

### 11.4 3D audio (A3)

* **Listener** = the camera block `DAT_009da5e8` (eye c[0..2], up c[12..14], front c[15..17]), set once per frame by the zone's camera function (`FUN_004434d0`, 28 call sites; the function holding a site sits right before the loop of its zone). Position is the camera *target*
  (`&DAT_009da5f4`, the player) in **z38PAR, z08BKD, z27TRX**; **z01BPK, z03PPH, z04IFC, z17WAS, z21FSH never set it** (the SoundClass listener is not reset by a zone switch, so they hear 3D sounds from the pose the previous zone left; the port's own listener lines in z01BPK and z17WAS were removed (2026-10-29), so all five keep the previous zone's pose exactly like the original).
* **Handedness** resolved: the camera basis (`camera.ts updateView`: right = (fz, 0, -fx)) is left-handed with +X to the right when facing +Z; Web Audio is right-handed (facing -Z): negating Z of positions, front and up gives the same left / right (checked: `forward' x up'` = +X).
* **Sea loop** (`SND_LGI_SEA`, 0x125): `FUN_004bb67d` (PepSwitc pre-render) ends with `FUN_004433f0(DAT_05d5812c, (x', seaLevel, z'))` every frame: x / z are Pepper's, pushed out of the square |x|,|z| < 400 to its nearest side (the larger |coordinate| decides, a tie moves z).
  `src/audio/sea.ts`; `tools/tests/audio-sea.mjs` compares the closed form with a mechanical transcription of all the decompile's branches on 484 points. Wired in `src/island/vehicles/pepswitch.ts` (`prerender`).
* z50LTC's person sounds are 3D sounds played at Pepper's position when the talk starts (`z50LTC.ts`), z05WAB's three 3D sounds already used `play3D` (the doc line "played 2D" was stale).
* `FUN_00443590 / FUN_004433c0` ("idle?") analysed: returns 0 when the slot has a handle (even a finished one-shot until the next housekeeping), else `status(3D handle #15) != DONE` (2D version) / `status(garbage pointer)` (3D version): for a slot without a handle the result is 1 ("free")
  as long as 3D handle #15 (used only when 15 other 3D voices play) has never finished: the port's `isIdle` (= no voice) is the same except in that case. The callers (z18MMP's `FUN_006a9540` / `006aad6a` / `006aadb0` voice pools, z27TRX 214350) use it as "free slot" in a chain. Not reproduced: what Miles reports for a never-used 3D handle is not in the binary.
* Pan 512 of `SND_CEDRIC_WALK` is moot: no zone loads that sound (only `CSSND_CEDRIC_WALK`, 3D).

### 11.5 Speech and sound-effect plumbing (A4)

* Speech state machine (`speech.ts`): `say` = `FUN_00435a11` (ignored while a request exists), `tick()` = `FUN_00435a5e` once per loop pass = once per sim step at 60 Hz (`AudioHost.frame(camera)`, a 60 Hz wall-clock timer fills in for loops that do not call it: the front end): the warm-up counter `_DAT_009dab5c` adds the constant `1.0` (`_DAT_00892020`, NOT `DAT_008b1718`) while <= 5.0 (6 passes whatever dt is; WP-TIME: it used to add dt)
  **and is never reset**, so only the very first request of a session waits 6 frames; then `FUN_004436d0` (A start, A finished and B not started -> B start, both finished -> close). `idle` = `FUN_00435ad3` = state is not 1 or 2: idle between a request and its first tick, and during the first request's delay.
* **Speech data timing (port only, 2026-10-30)**: the original reads a speech file from disk inside the request (`FUN_00443630` / `FUN_008773fd`), so the audio, the subtitle (`FUN_0045d47f`) and the talk animation / mouth of the speaker start in the same frame. The port reads the files from the disc image on demand (live: HTTP ranges through the relay to archive.org, ~2.3 s for the first read of a 256 KB block, then ~110-170 ms with the block cached; a dev server ~150-350 ms), which made people talk (mouth, subtitle) before the voice came ("people sometimes talk while the sound only comes later"). Two changes give the original's behaviour back:
  1. **Prefetch** (`SpeechEngine.prefetch`, `AudioHost.prefetchSpeech`, never blocks play): the voices are read into memory in the order they will be said and the first 10 are decoded ahead (the rest are decoded one by one as lines are used); the files of a list are asked for in groups of 6 through `GameFiles.ready` (neighbours become one range request). Who prefetches: the cutscene host (`declare`: the first line of every script, bytes only, 3 s after the zone started; `start(slot)`: every SAYTEXT line of the script), the talking NPCs (`SGMFIG.prefetchLines`: both pairs of lines, A/B and C/D, when Pepper is within twice the near radius), the hologram (`activate`: its hint and the next), the mini-game zones (`playzone.ts`: all voiced lines of the zone's own `.str` table, at most 60, at zone start) and the intro line (`say` itself jumps the queue).
  2. **Hold** (`SpeechEngine.waiting`): when the line the machine starts next has no decoded audio yet, the machine does not start it (`tick` holds, `idle` stays false so conversations / cutscenes do not take it for the end of the speech) and the pieces that depend on the audio wait with it: the NPC's talk clip, mouth and conversation timer (`SGMFIG.converse`), the cutscene's SAYTEXT mouth / subtitle / line timer (`CutsceneEnv.speechWaiting`, `CutsceneHost.draw`), the timed and held subtitles and their countdown (`playzone.ts`). The line then starts in the very tick in which its data is in hand (the buffer is started synchronously: `onLineStart` fires inside `tick`). After 10 s the hold is given up. The speech state machine itself (`step`, the 6-pass warm-up of the first request, `idle` between request and first tick) is unchanged relative to the audio start. Not held: Pepper's own talk pose (her clip is only a stance) and the first request's 6 warm-up passes (the original has those too). `SpeechEngine.lags` / `stats.late` / `stats.heldTicks` record request -> audio start, the hold time and how many lines were not in hand when requested (`tools/steps/speech-sync.mjs`, `speech-npc.mjs`, `speech-hold.mjs`).
* The speech-volume slider of the options menu says speech line 8 as a preview (`FUN_0041b9b1` case 6, `FUN_00435a11(8, -1)`): `AudioHost.setVolumes` does it when the speech value changes.
* **Swim stroke**: the original has it: `FUN_0088c740` (the swim node) plays `SND_PEPP_SWIM` (0x127, a one-shot, 2D) while the clip frame is 18..20 after each advance (`src/game/swim.ts`). Not a loop.
* Cutscene sound effects: scanning every `.cut` / `.txt` of the archives for `CSM_SFXn` switches finds them only in z02LGI (`lgi03/04/09/13`), z07CSI (`csi01..09`, own table like the island's `0x8d9460`: the hub work package) and `ogl01psx` (PSX): the scripts of z21FSH ADV04/11,
  z28HAT ADV08/09, z40aPO ogl02 and z42BRP BRP01 use no sound switches, so there is nothing to trace there (their sounds are in the zone lists above).

### 11.6 Ambience, notifications, fade, volumes (A5, A8, A9, A10)

* **Ambience beds** (A5): the sequence is DONE at its end-of-track (the SMF's last `FF 2F`, not the last note) and the game restarts it from the next frame poll (`FUN_00443230` -> `FUN_00875b16`): `MidiRenderer` now ends a pass at the end-of-track time, restarts after `gap` = 1/60 s (half a frame on average) and releases (does not cut) the notes at the restart;
  it used to wait the last note + 0.5 s + 0.1 s. The first start waits 6 frames (`_DAT_009e06e4` counts to 5.0). XMIDI conversion keeping the EOT is an assumption (a restart at the last note would differ by 0.1 - 1.2 s); what writes "none" into the name buffers and the `AIL_file_size` literal-path bug stay open (both
  load the same `.mid`).
* **Segment notifications** (A8): the registered `GUID_NOTIFICATION_SEGMENT` queue is polled by `FUN_00443370` (`GetNotificationPMsg` + `FreePMsg`, one message per call). Messages (MSDN `DMUS_NOTIFICATION_SEG*`): SEGSTART when a segment starts, SEGLOOP at every loop wrap, SEGABORT when the primary segment is stopped or replaced, SEGEND at its natural end
  (SEGALMOSTEND, end minus prepare time, is only produced by segments that end: `Flying`, not polled by anyone). The island's Music node is built for exactly this: its 120-frame refractory timer ignores the echo of its own plays (abort + start one prepare time = 30 frames later) and reacts to the next loop notification by toggling `Z02LGIT` <-> `Z02LGIM`
  (the long main theme with the groove levels; headless run: `Z02LGIT` asked at 1.58 s, the second loop notification at 88.99 s -> groove -2, `Z02LGIM` asked at 89.04 s, abort / start echoes 90.06 / 90.08). `MusicEngine.pollNotification()`; `IslandContext.musicNotified()` (it was undefined, so the island never left `Z02LGIT`). The queue filling without `SetNotificationHandle` is the documented use (the handle only signals) and the only reading under which `Z02LGIM` is ever heard.
* **Fade / mute**: `FUN_00873e26` (zone reset) also sets the fade scale back to 1.0 (`GameAudio.resetZone`); mute (`FUN_00873e00`) keeps the segments running at -200 dB. Volume formula `-22 + 0.22 * opt[0] * fade` dB: `tools/tests/audio-zonesounds.mjs` checks 100 / 80 / 50 / 1 / 0, the fade scale and mute against the literal `(int)(v * 22 - 2200)` of asm 0x876aa4.
* **Volumes** (A9): music slider -> DirectMusic master volume only; SFX slider -> every sample `floor(tableVol * opt1 / 100)` and the ambience sequence (`GameAudio.setSfxVolume`); speech slider -> fixed when a line starts. Nothing in the pause menu, the loop modes or speech changes a level (`grep` of every `setVolumes`, `setFade`, `setMute` caller:
  the options menu, z28HAT's fade, the island's mute only).
* **A6 items decided by the data** (nothing to change): all 365 commands of the shipped segments have `bRepeatMode` 0 (random: what the port does) or 223 (uninitialised, 38 of them: no valid mode); every chord's `inversionPoints` is `0xffffffff` / `0xffffff`, all 6288 style parts have `invertUpper` 127 / `invertLower` 0 and all 97 222 notes `inversionId` 0: no inversion map can act; the pattern
  rhythm masks are `1` on measure 0 and the segments have one chord, so rhythm matching cannot change a choice. Pattern / variation randomness among equals, the synth (interpolation, 22.05 kHz, gain staging) and the GM bank stay as in 10.8.

### 11.7 Not exact / open after this pass

* Start delay 1000 ms is the documented default of the DirectMusic performance; a recording of the original would be the only proof (the game's own `GetPrepareTime` is not callable from the binary analysis).
* Segment notifications follow the documented message set; the exact moment dmime posts them (at the start time, or one latency earlier) and whether a replaced segment sends SEGABORT or SEGEND is not in the binary.
* The Miles status of a never-used 3D handle, ambience end = EOT (assumption above).
* Constructor-loaded sounds with data ids (`Sound3d`, `SGMFIG`, the cutscene action) are loaded when the zone game is bound / on first use, not as part of the generated lists; the hubs need to add theirs.
* Not touched: the building-distance timing of the island's Music node (it measures the current frame, the original the controller distance of the previous frame; island work package), z07CSI's SFX-switch table (hub work package).
