# Mods (file replacement + EXE patches)

`src/mods/*`; start-screen section "Mods" (`src/mods/ui.ts`), applied by `main.ts` `play()` at the next "Spelen". `?mods=off` starts without them.

## How the original resolves files (the override rules)

`PCDBG_File.c`, in the Dutch EXE:

* `FUN_00435843(path, mode, ...)` (SDFile "open", prints "File not found: %s" when it fails) -> **`FUN_004348ff(path, mode)`** = the game's `fopen`:
  1. **`fopen(path, mode)` on the real file system first.** A loose file therefore always wins.
  2. Only when that fails **and** `mode[0]` is `r` / `R` **and** `mode[1] != '+'` the mounted archives are searched. Write modes never reach an archive.
  3. The path (split at `\` and `/`; a leading `X:` drive part must match the game folder `DAT_009836f8` = EXE folder + `_Data\`) is compared component by component
     with **`strcmpi`** against the root of each mounted archive (the first name stored in its `.bod`, e.g. `_data/z02LGI`, always `_data/<archive name>`), then down the
     directory tree of that archive (`FUN_004346a2`, `strcmpi` at every level). So both the real and the archive lookup are case-insensitive.
* `FUN_00434bd4` (seek / size) and `FUN_00434f91` (directory listing) do the same real-first, archive-second dance.
* Archives are mounted with `FUN_0043421d(path)`: `fopen(path, "rb")` of the `.bob` and of the `.bod` (the last character `b` -> `d`). They are real files too: a loose
  replacement `.bob/.bod` pair is just the file.
* All file types go through it (`.tga .wib .msh .col .txt .str .lgt .par .blk .cut .fnt ...`, 5,000+ textures alone), plus everything that is loose anyway
  (`_data/sounds/*`, `Settings.set`, saves). DirectMusic / Miles read their sound files from the real folder only. The EXE itself cannot be replaced by a loose file.

Hence the LI2 Mod Manager's File Replacement: a mod's `_data\<archive>\<member path>` is copied into the game folder and wins over the archive member of the same name.

## The port

* `GameFiles` wrapper `ModdedFiles` (`overlay.ts`): `read / has / size / list / loaded / ready` look in the mod layer first (case-insensitive, `\` or `/`). Without enabled
  mods `withMods` returns the original object (nothing wraps, nothing changes).
* The engine reads archive members synchronously, so loose files are put INTO the `Archive` object: `GameData.archive(name)` asks `archiveOverrides(name)` for
  `_data/<name>/...` files and calls `Archive.override(path, bytes)` (replaces or adds a member; case-insensitive). The files stay in the store until an archive is opened;
  **zone archives' mod files are let go of when the zone ends** (`GameData.releaseZoneOverrides`, called by the shell loop) and loaded again on the next visit, so a 2 GB pack
  never has to be in memory at once. The shared archives (Bricks, Overlays, menu, Fonts ...) keep theirs.
* **Order**: the list order is the load order, the LATER mod wins ("mods are loaded top to bottom, the game uses the last texture loaded"). Up/down buttons in the list; the
  list marks files that a later mod overrides. Disabled mods are ignored.
* **Storage** (`store.ts`): OPFS `le2-mods/<id>/` with the files (`f000001` ...) and `mod.json` written last (a cut-off import leaves no mod behind; orphans are cleaned up).
  Memory fallback without OPFS (the mods then last for the session).

### Import (`manage.ts`, `zip.ts`)

* A **zip** (also several gigabytes) is read through its central directory (zip64 supported) with `Blob.slice`; each member is piped through
  `DecompressionStream('deflate-raw')` and a CRC/length check straight into OPFS (`createWritable`), with a progress bar. Memory use is a few MB.
* A **folder** (`<input webkitdirectory>` or a dropped folder) is the same without the zip layer (files are streamed from the picked `File`s). **RAR is not read**:
  a RAR v4/v5 decoder in the browser would be a large dependency (libarchive.js = WASM that holds the whole archive and its output in memory; a RAR 3.x decoder is
  LZ + PPMd + VM filters) and the unrar licence forbids nothing here but the pack is 512 MB packed / 2 GB unpacked: the UI says "pak het RAR-bestand eerst uit en kies de map".
* A mod = a folder with `info.txt` (title / author / description), `patch.txt`, `_data/...` (the format of the LI2 Mod Manager wiki, "Creating Mods"); a zip may hold several
  (the bi-plane fix has a fullscreen and a windowed variant) or none-wrapped files at its root. `installed` markers and `__MACOSX` are ignored; files outside `_data` are
  reported and skipped. Loose single files cannot be placed (no folder = no path): pick a folder or a zip.
* Importing the same source + folder again replaces the earlier copy after the new one is complete.

### Patch mods (`patch.ts`, `effects.ts`)

`patch.txt`: `offset;new bytes[;original bytes]`, hex, **file offsets** of `LEGO eiland 2.exe` (verified: the sky patches hit the `push colour` operands of `SetupFog`
calls). With original bytes the new ones are written only where they are (wrong version = skipped and reported). `GameData.exe()` reads the EXE through the layer, so the patches
are in the bytes before any table is read.

Which patches can do anything here? The port re-implements the game logic and READS from the EXE only: the per-zone `SetupFog` constants (sky / fog colour, draw distance) and
sea level, the zone loader/builder code that the x86 interpreter runs, the tables of `shell/tables.ts` and the option defaults. `EffectMap.classify` reports per patch:
**effect** (inside one of those), **onzeker** (EXE data the port might read), **genegeerd** (code / constants the port does not read), plus notes for known patches:

| mod | result |
|---|---|
| Nicer Skies (11 x colour `FFDD7F`) | effect: all 11 are `SetupFog` colour operands; verified in the browser: the island sky changes |
| Bi-Plane Fuel Fix (`00531EF8`) | ignored: the original's fuel drain depends on the frame rate (the patch enlarges the tank); the port simulates at a fixed 30 Hz and hard-codes the unit (6825) in `z22bip/plane.ts` |
| Skateboard Speed (`90DC2`, 0.75 -> 1.15) | ignored: `MAX_SPEED` is a constant of `island/vehicles/skate.ts` |
| Debug Mode (`572704`, the manager's sample) | belongs to another game version: in the Dutch EXE it lands inside a sound file name. Use the start-screen option "Debugmenu" (below) |

The report is shown in the mod list when the EXE is at hand without a download (own ISO, dev copy, stored download) and is saved from the first game start
(`recordModReport`, localStorage `le2-mod-effects`).

## The Mod Manager's built-in options and this port

(`LegoIsland2Patcher/Form1.cs`, read as a reference only; offsets for the Dutch build.)

| option | what it patches | in the port |
|---|---|---|
| Widescreen hack / custom resolution | `fovOffset` 0xCAC3 (`push 0.75f`, the projection aspect) + resolution table at 0x52D6 (+31 per entry) | **"Beeld: breedbeeld"**, docs/re/widescreen.md; the resolution table is meaningless in a browser |
| No Intro Videos | NOPs the 3 movie calls at 0x2AEA / 0x2B20 / 0x2B56 | start-screen option **"Introfilms overslaan"** (`?intro=0` as before) |
| Skipable Intro Videos (sample mod `2ADB;01`) | `push 0` -> `push 1` (skippable flag of the first movie) | already so: every movie skips on click / key |
| Windowed Mode (`29B2;01`), Force /force (`29B9;01`) | launcher / command-line flags | not applicable in a browser |
| Load screen fix | `C3 90 ..` at 0x43C70 (the pizza loading screen's `Sleep`) | not applicable: the port has no artificial wait |
| **Debug Mode** (sample mod, other version's offset) | main-menu item "Credits" (type 4, action 2) -> type 1 (go to page) id 0x11 | **real game code** (below); start-screen option **"Debugmenu"** |

### Debug Mode = the story-checkpoint list

Menu page 0x11 (17, setup `FUN_0041b227`) lists the 37 records of the table at 0x8a5c68 (`{label[0x20], zone, mask, node}`: "!LEVFRE", "!LEVBPK", "!LEVLGI" node 2, ... "!LEVLGI" node 68;
the earlier notes said 36: the set-up function returns `0x24 - index` = the entries that follow, so index 36 is the last). No button of the shipped game leads there. Choosing
an entry (`FUN_0041be4e`): var 5 = the record's zone; if its node >= 0 `FUN_00404c07(node)` (the story FSM jumps, forcing the skipped nodes' variables) and var 0x120 = 3; var
0xb = 0; the front end starts. The port (`MenuUi` `case 0x41b227` + `gotoCheckpoint`) does exactly that and hands over through the same pending override as a new game. The option
applies the built-in patch `4A7834;0100000011;0400000002` (guarded by the original bytes) in front of the user's mods; the credits item is then gone, as with the manager.
(The all-zones list, page 26 at 0x8a62c8, is only reachable from the never-opened alternative main menu 25 and is not wired.)

## HD texture packs (webfischi's "HD Texture", 4x waifu2x)

Checked against the real pack (2.0 GB, 4703 `.tga` RLE 24/32 bpp, 329 `.wib`; all 4x in both dimensions; `_data/<archive>/<member>`; matches the archive members 1:1 except two added
files). What the port needed:

* streamed import (above); lazy per-zone loading (above);
* **textures**: UVs are normalised, so larger pictures just work. `Renderer.texture` halves a picture that exceeds `MAX_TEXTURE_SIZE`; a picture a mod made larger than the
  original (`Archive.isUpscaled`: compared with the TGA / WIB header still in the blob) gets **mip maps** and 4x anisotropy; shipped textures take the unchanged path (no mips, no
  anisotropy, same bytes). The 2D layer's textures (`UiTextureSet`) and font sheets do the same.
* **fonts**: `logicalFont` scales an HD `.fnt` (line height a whole multiple of the original's 20 / 40) back to the logical size, so a pack with its own metrics lays out like the
  original; a pack that only enlarges the sheet needs nothing (glyph UVs are fractions). (This pack has no font.)
* memory: the island's pictures are 215 MB as RGBA (plus 164 MB of `.wib` frames kept for the animation) while the zone runs; GPU memory is 4/3 of that with mips.

## Verification (headless, muted; `tools/steps/mods-flow.mjs`, `tools/test-formats.mjs` test `mods`, `tools/test-mods-large.mjs`)

* the three Dutch Mod Manager mods of archive.org `legoeiland2dutch` (and the manager's own samples + Island Grass from its GitHub release 1.2.5, as a zip with 5 mods in it and as a
  folder): import, order, enable / disable, remove, persistence across a reload; Nicer Skies changes the island sky (cyan -> pale blue), Island Grass replaces the grass textures
  (50 members of z02LGI), nothing is wrapped and nothing changes without mods (`?mods=off`, or none installed: `hd 0 / mips 0 / maxDim 256` textures as before);
* IXS-look (49 TGAs, 106 zip entries): bright semi-transparent sea in the parachute zone, new grass / sand tiles on the island, Infomaniac's and Pepper's new torso textures;
* the real HD Texture pack (folder, 2.16 GB, 5034 files): imported in 8.4 s with 127 MB peak memory (node) / through the headless browser's OPFS (needs a normal profile: `tools/browse.mjs
  --profile <dir>`; a throw-away profile's quota is ~100s of MB and the import then stops with a Dutch "opslagruimte" message and leaves nothing behind); island: 379 textures of
  which 378 HD (30.7 megapixels instead of 1.9), mip-mapped, `.wib` animations keep stepping; mini-game z38PAR, the front end's menus, Pepper's house show the HD pictures; JS heap 561 MB
  on the island (179 MB without the pack); a synthetic 2.4 GB zip (zip64 headers, deflate + stored) imports in 17 s at 281 MB peak.
* **Not checked with the real pack**: a pack with its own `Balloon12/24.fnt` + `.tga` (the real pack has no font; `logicalFont` is tested with a synthetic 4x font only), the browser
  RAR route (not built), Safari / Firefox storage quotas, and the GPU memory of the front end (z60FRE: 303 MB of RGBA pictures + 144 MB of `.wib` frames in the pack) on a weak GPU.
