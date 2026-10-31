# Mods (file replacement + EXE patches), the mod catalogue, RAR, MEGA and IXS-look

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
* A **folder** (`<input webkitdirectory>` or a dropped folder) is the same without the zip layer (files are streamed from the picked `File`s).
* A **RAR** (`rar.ts`, below) is unpacked file by file in the same way; recognised by its first bytes, not only its name.
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
| Bi-Plane Fuel Fix (`00531EF8`) | ignored: the original's fuel drain is per frame (`fuel -= speed` in `FUN_00709fac`, not scaled by dt), so it depends on the display rate (the patch enlarges the tank); the port steps once per drawn frame at a fixed 60 Hz, i.e. it burns fuel exactly like the original on a 60 Hz display (twice as fast per second as at 30 fps), and hard-codes the unit (6825) in `z22bip/plane.ts` |
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

## RAR (`rar.ts`)

RARLAB's own UnRAR source compiled to WebAssembly (npm `node-unrar-js` 2.0.2, MIT wrapper around UnRAR 6.1.7; licence paragraph in the README; `unrar.wasm` is 207 kB, loaded the
first time a RAR is used, the JS wrapper is a lazy chunk). The wrapper wants the whole archive in memory (and copies it); a 512 MB archive that unpacks to 2 GB must not be. So:

* **"blocks" mode** (RAR 1.5 - 4.x block format, not solid, not encrypted, one volume: the HD pack, the Skeleton Mod, most mods): the archive is walked header by header through a
  `ZipSource` (a `Blob` / OPFS file; slices come from disk) and every file is extracted from a tiny archive built on the fly: marker + main header + that file's header block + its
  packed bytes + an end block. Files of a non-solid archive are independent, so UnRAR decodes them exactly as in place. Memory = one packed + one unpacked file. The extractor
  subclass (`One` in `rar.ts`) feeds UnRAR from that buffer and collects the output (the wrapper's own `ExtractorData` copies the data and keys output by file name, which breaks
  on backslash names). Names with the unicode flag (0x200) are decoded (`decodeRarName`). Size and CRC-32 are checked for every file (UnRAR checks them too).
* **"whole" mode** (RAR 5, solid archives): the archive goes into memory once (capped at 768 MB) and UnRAR lists / extracts by name. Solid archives are extracted file by file, which is
  quadratic for big ones; fine for mod-sized archives.
* Refused with a Dutch message: password (headers or files), several volumes, damaged headers, too large for "whole" mode.

Measured (node, `tools/test-mods-large.mjs --rar`): the real HD pack (512 MB, 5034 files, 2.16 GB) imports into the store in 24 s with a peak RSS of 285 MB, byte-identical to the
earlier unpacked folder; listing the 5160 headers of the archive takes 14 ms.

## The mod catalogue (`catalogue.ts`, the "Mod-catalogus" in the start screen)

Nothing of any mod is in the repository or on GitHub Pages. Every entry is fetched by the player's browser at "Toevoegen" and imported like any other mod (`importPicked` with
`ImportOptions`: only the picked folder of a multi-mod archive, a `catalogus:<id>` source so that adding again replaces the old copy, the catalogue's title / authors / Dutch
description, and an `origin` that the list shows as "Uit de catalogus. Bron en discussie: <link>"). Nothing is enabled by the catalogue itself beyond what any import does
(a new mod is on in the list, applies at the next "Spelen").

Sources: the relay (`tools/proxy/nginx/le2-proxy.conf`: `/ia/...` archive.org, `/x/ore/misc/...` RRU's file bucket, `/x/gh/...` GitHub; CORS only for the Pages origin and the dev
ports 5498 / 5499), MEGA directly (`mega.ts`), and the IXS disc (below). Small downloads become a `Blob`; the 512 MB MEGA file is streamed (4 MB blocks, 3 in flight, AES-CTR in WebCrypto) into a
temporary OPFS file (`le2-tmp/`, deleted afterwards and cleaned at the next start), which the RAR reader slices. Free storage is checked first ("Te weinig opslagruimte ...").
Failures (offline, 404, a damaged or changed file, MEGA error codes, no room, a mod of a pair failing) give a Dutch message and leave nothing: all mods an entry adds are
removed again when one fails, the temp file is deleted, `importPicked` removes its own unfinished mod. "Stoppen" aborts.

Language fit decides what can be added (the port is the Dutch build):

| kind | rule | entries |
|---|---|---|
| nl | made for the Dutch build | Nicer Skies (NL), Bi-Plane Fuel Fix (NL), Skateboard Speed Modifier (NL) (JappaWakka; the last two are "genegeerd" in the port, see Patch mods) |
| data | only replaces archive members, which have the same names in every language | HD Texture Pack, IXS-look, Island Grass, Legal Tracks (the Dutch `land.col` differs from the mod's in about 530 bytes: the edit only), Skeleton Mod (2806 members, all present in the Dutch z02LGI, 2697 of the same size; shown working: Pepper and the Infomaniac are skeletons) |
| other | patch of the English / German / Italian executable, or data that does not fit | listed with credits, **no button**: Nicer Skies + Castle Island Day (EN), Bi-Plane Fuel Fix (EN 1, EN 2, IT), Skateboard Speed Modifier (EN/ES, DE) and **HD Font (EN)** |

Why patches of other versions get no button: without "original bytes" a patch line is written unconditionally, so the English Nicer Skies would write `FFDD7F` at English offsets
inside the Dutch EXE (11 writes, 6 of them landing in `SetupFog` operands of other zones, the rest in code); the bi-plane patches likewise. The skateboard patches with original bytes are
skipped by the guard anyway. **HD Font (EN)** replaces `Balloon12/24.tga` with 8x sheets, which are 8x the size of the Dutch ones but not the same picture (mean difference ~115-160 of 255 after
downscaling): in the port the menu text is unreadable (checked in the headless browser, screenshot of the main menu). webfischi's "HD Font for non-English versions" is the one that
would fit and it is dead. Dead entries (webfischi's Castle Island Day HD, HD Font non-English, Island Grass HD; Nicer Skies German; MEGA error -16) are listed under "Niet meer beschikbaar bij de bron"
with credits and thread, no button, so the player sees why they are missing. The Mod Manager's own sample mods (Debug Mode, Skipable Intros, Windowed Mode, Force Command Line) are
not offered: the port has start-screen options for them.

## MEGA (`mega.ts`)

Public file links (`#!id!key` and `/file/id#key`). `POST https://g.api.mega.co.nz/cs [{a:'g',g:1,ssl:2,p:id}]` -> `{s, at, g}`; AES key = k[0..16] xor k[16..32], CTR counter block =
k[16..24] + a 64-bit block counter, attributes AES-CBC with a zero IV (WebCrypto has no raw CBC, so a valid padding block is appended: encrypt an empty message with the last ciphertext block as IV).
Content blocks are `GET <g>/<first>-<last>` (a plain GET: no CORS preflight; the storage hosts send `Access-Control-Allow-Origin: *`), decrypted with `AES-CTR` and `length: 64` at
`counter = nonce || offset/16`. Retries (4 per block), Dutch error text for MEGA's codes (-16 blocked, -9 gone, -17 limit ...). MEGA's own MAC is not verified; every RAR / zip member has a CRC.
Verified: the stream of the real pack is byte-identical to the copy that was downloaded by hand.

## IXS-look (`ixs.ts`, `rawdisc.ts`, `ixslook.ts`)

The mod is built in the browser from Island Xtreme Stunts' disc on archive.org (item `lixsrgn-1`, `LIXSRGN1.BIN` through the relay, Range requests): raw 2352-byte sectors (MODE 2 /
XA form 1: user data at +24; MODE 1: +16), ISO 9660 (`rawdisc.ts` reads the primary volume descriptor, walks the directories and reads a file's sectors; ~12 requests, 470 kB, ~10 s because
every archive.org request costs a second or more). Needed: `TEXTURES/SEA.BMB` (113,198 bytes), `Z07JSK/MODEL002.BMB` (258,927), `Z00DEF/CHAR003.BMB` (3,694), `Z00INT/CHAR019.BMB`
(8,749): a different size is refused ("niet de IXS-schijf waarvoor de mod is gemaakt"). (`Z05KST/MODEL002.BMB` was only needed for the grass, which was dropped.)
`ixs.ts` is the IXS LZ unpacker (Game.exe 0x417d5e), the `.BMB` bank parser and the DXT5 / 32 / 24 / 8 bit decoders; `ixslook.ts` is the recipe: sea -> 8 zone copies of text004, the
backdrop (the sea flattened over a sea blue) -> 7 `Sea0` copies, sand -> text001 + 2 copies (IXS beach, mean colour shifted to the original's, which is hard-coded:
226.98 / 194.98 / 136.98), Pepper's and the Infomaniac's shirts (top-left 64x64) -> 23 + 4 copies = 45 files, written as the originals (bottom-up TGA, 24 bit, 32 bit with alpha for the sea).
The member list is hard-coded (found once by comparing pixels), so the mod can be built before any game file is available. Result: **byte-identical** to the reference mod (45 of 45
files + `info.txt`), in node from the real IXS files and in the browser from the disc.

Look in the game (headless): the sea is the bright, semi-transparent IXS water; text001 turns out to be the shallow seabed / shore tile (magenta test: only visible through the water at the
coast), which the more opaque IXS sea mostly hides, and where it shows (shore edges) its tint matches the neighbours: no patchwork like the grass had, so the sand stays in the recipe.

## Verification (headless, muted; `tools/steps/mods-flow.mjs`, `mods-catalogue.mjs`, `mods-hd-mega.mjs`, `mods-visual.mjs`, `tools/test-formats.mjs` tests `mods` and `mods-catalogue`, `tools/test-mods-large.mjs`)

* the three Dutch Mod Manager mods of archive.org `legoeiland2dutch` (and the manager's own samples + Island Grass from its GitHub release 1.2.5, as a zip with 5 mods in it and as a
  folder): import, order, enable / disable, remove, persistence across a reload; Nicer Skies changes the island sky (cyan -> pale blue), Island Grass replaces the grass textures
  (50 members of z02LGI), nothing is wrapped and nothing changes without mods (`?mods=off`, or none installed: `hd 0 / mips 0 / maxDim 256` textures as before);
* IXS-look (49 TGAs, 106 zip entries): bright semi-transparent sea in the parachute zone, new grass / sand tiles on the island, Infomaniac's and Pepper's new torso textures;
* the real HD Texture pack (folder, 2.16 GB, 5034 files): imported in 8.4 s with 127 MB peak memory (node) / through the headless browser's OPFS (needs a normal profile: `tools/browse.mjs
  --profile <dir>`; a throw-away profile's quota is ~100s of MB and the import then stops with a Dutch "opslagruimte" message and leaves nothing behind); island: 379 textures of
  which 378 HD (30.7 megapixels instead of 1.9), mip-mapped, `.wib` animations keep stepping; mini-game z38PAR, the front end's menus, Pepper's house show the HD pictures; JS heap 561 MB
  on the island (179 MB without the pack); a synthetic 2.4 GB zip (zip64 headers, deflate + stored) imports in 17 s at 281 MB peak.
* the catalogue (`tools/steps/mods-catalogue.mjs`, dev server on port 5499 because of the relay's CORS list): the list (credits, links, language notes), adding the three Dutch mods, Island Grass
  (one mod of the manager's zip), Legal Tracks (two mods), the Skeleton Mod (RAR, 2806 files, ~3-6 s), IXS-look from the real disc (15 s, 45 files byte-identical to the reference mod),
  re-adding replaces, and the failure paths (404, unreachable, damaged download, MEGA blocked / offline) with nothing left in OPFS (`le2-mods` without a `mod.json`, `le2-tmp`);
* **the real HD pack through MEGA in the headless browser** (`tools/steps/mods-hd-mega.mjs --profile`): 512 MB download 46 s + unpack and store 24 s = 70 s; peak resident memory of the whole browser
  1134 MB (renderer 692, GPU 194; it starts at ~400-540), JS heap at most 15 MB (the wasm heap is outside it); 5032 files, 2,164,645,571 bytes, the temp file gone afterwards; the island then runs with
  the pack (JS heap 624 MB). In node the same import (`--rar`) peaks at 285 MB RSS;
* **Not checked with the real pack**: a pack with its own `Balloon12/24.fnt` + `.tga` (the real pack has no font; `logicalFont` is tested with a synthetic 4x font only), Safari / Firefox
  (WebCrypto, OPFS and quota differences; MEGA's CORS was only tried from Chromium), the GPU memory, and the GPU memory of the front end (z60FRE: 303 MB of RGBA pictures + 144 MB of `.wib` frames in the pack) on a weak GPU.
