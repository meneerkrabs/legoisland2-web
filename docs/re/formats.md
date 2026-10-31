# LEGO Island 2 / LEGO Eiland 2 - asset file formats

Reverse engineering notes for the asset formats of "LEGO Island 2: The Brickster's Revenge" (Dutch release "LEGO Eiland 2: De Wraak
van Dondersteen", Silicon Dreams / LEGO Media, 2001), written for the browser port in this repository. Everything here was checked
against the shipped data (all 22,831 archive members of the 39 archive pairs of the Dutch retail install) with the parsers in
`src/formats/` and the tests in `tools/tests/` (`node tools/test-formats.mjs`), and against the decompiled executable.

Contents

1. Sources, method, confidence scale
2. Game folder and archive pairs (`.bod` / `.bob`)
3. Member types overview (counts, which section documents them)
4. Meshes (`.msh`)
5. Textures: `.tga`, `.wib`, `text.txl` / `text.opt`
6. The zone tables are compiled into the executable (object placement, models, LOD, textures per mesh group, attachments)
7. Conventions the engine needs (coordinates, handedness, matrices, units, winding, UVs)
8. Collision, animation, script/text, sound (sections written by the format workers, appended below)
9. Viewer, tools, tests
10. Still unknown / what the engine work should look at next

Confidence tags used below: **high** = read in the EXE loader and/or checked on every file with strict parsing; **medium** = consistent
with all data but the EXE side was not read or is ambiguous; **low** = hypothesis.

---------------------------------------------------------------------------------------------------------------------------

## 1. Sources, method

* **The data itself** is the authority: every parser is strict (no unread trailing bytes unless explained) and `tools/test-formats.mjs`
  parses every member of every archive (current result: 0 failures, see section 9).
* **The decompiled EXE** (Ghidra headless run, `LE2.c` / `LE2.asm.txt`, plus Capstone for the giant functions Ghidra could not decompile;
  the executable is `LEGO eiland 2.exe`, PE32, image base 0x400000, 6,459,444 bytes). Loader functions are named `FUN_xxxxxxxx` after their
  address. The EXE contains source file names in assert strings (`ms\Graphics\c_src\ModelIni.cpp`, `TextureManager.cpp`, `Material2.cpp`,
  `ms\Sdlib\c_src\SDAnim.c`, `SDFile.c`, `Common\Z02LGI\c_src\GameLoop.c`, `Common\WayPt\c_src\Load.c`, `ms\Sound\c_src\DirectMusic.cpp`, ...).
* **References used** (understood and re-implemented, no code copied):
  * Moreno.LegoIsland2, a Godot port by MorenoLand (https://github.com/MorenoLand/Moreno.LegoIsland2): `docs/formats.md`, `tools/bob.py`,
    `tools/msh.py`, and its `data/*.tsv` tables. Its zone tables (placement records, mesh slots, texture runs) were produced by an
    independent route and are used here as a cross-check only: our extraction from the EXE reproduces all 4,371 placement records of
    all 30 zones that Moreno lists with **0 mismatches** in name, position and rotation (section 6.6).
  * alandoherty/bod-tools (https://github.com/alandoherty/bod-tools), legomoe's "Island 2 Explorer / MSH Tools" (Rock Raiders United),
    LI2GE - Lego Island 2 Game Editor (https://li2ge.sourceforge.net/, GPLv3): all confirm the `.bod/.bob` and `.msh` basics
    (LI2GE exports `.msh` 1:1 and shows that some meshes carry animation data). JeffRuLz's repositories (LI2 Mod Manager, patcher) are
    patching tools and do not document formats.
* **Copyright**: no game data or derived images/models are in this repository; the viewer reads the user's own files
  (`public/data/le2/` is a symlink to the game folder in development and is git-ignored); exports go to `/tmp` only.

---------------------------------------------------------------------------------------------------------------------------

## 2. Game folder and archive pairs

Installed folder (`.../Game/`):

```
LEGO eiland 2.exe        the game (all zone set-up code and tables are inside, see section 6)
mss32.dll, redist/       Miles Sound System 6 and its plug-ins (.flt filters, .asi, .m3d 3D-audio providers)
GameSetup.txt            video/sound set-up written by the launcher (text, "ASET / version 4 / video driver ...")
_data/
  <name>.bod + <name>.bob   39 archive pairs (zone data, menus, shared bits); 22,831 members
  sounds/                   loose audio: .wav, .mp3, DirectMusic .sty/.sgt/.dls, .mid, speech packs (section 8)
```

The 39 pairs: `BrickMorph Bricks Fonts GENERICBITS Overlays Shadow SwapText menu messages` and the zone archives
`z01BPK z02LGI z03PPH z04IFC z05WAB z07CSI z08BKD z09JST z10RGB z13CAI z14OSD z15SSH z16PYA z17WAS z18MMP z20DSP z21FSH z22BIP z23DIP
z27TRX z28HAT z36CNT z38PAR z39ASB z40aPO z40OGL z41MAP z42BRP z50LTC z60FRE`. `z02LGI` (43.7 MB) is the main island ("Lego Island"
town), `z03PPH` is Pepper's house, `z01BPK` the skate park (Moreno), `z60FRE` the front end / start-up scene (Moreno). The three letters are
the game's own zone code (they also name the source folders `Common\Z02LGI\c_src\` in the EXE).

### 2.1 `.bod` (directory) - **high**

Little endian. Total size = `namesLen + 16 * recordCount + 16`.

| Part | Layout |
| --- | --- |
| names | `namesLen` bytes of NUL-terminated strings (directory names and file names, mixed; the first one is the archive's root folder, e.g. `_data/z03PPH`) |
| records | `recordCount` x 16 bytes: 4-char tag (`DIRY` or `FILE`) + three u32 |
| trailer | 16 bytes: u32 `namesLen`, u32 `recordCount`, u32 0, u32 `namesLen` |

* `DIRY` record: `count, firstChild, nameOffset` - the directory's entries are the `count` consecutive records starting at
  index `firstChild` (each is a `DIRY` or `FILE`). Record 0 is the root.
* `FILE` record: `size, offset, nameOffset` - `offset` is the position of the file's bytes inside the `.bob`.
* `nameOffset` is a byte offset into the names block.
* A member's path is the chain of directory names below the root joined with `/`; the game builds paths with `\` and a leading
  `_data\<archive>\`, e.g. `_data\z02LGI\Meshes\SeaBed.Msh` (compares case-insensitively: the archive stores `meshes/SeaBed.msh`).

### 2.2 `.bob` (blob) - **high**

The members back to back; **each member is preceded by the 4 bytes `FILE`** and the record `offset` points past that marker. Verified on
all 39 archives: every member has its marker, members are contiguous (no gaps, no overlap) and end exactly at the end of the `.bob`.
Code: `src/formats/archive.ts` (`new Archive(name, bodBytes, bobBytes)`, `.entries`, `.read(pathOrEntry)` returns a view without copying).
The game opens members with a normal file API through the Sdlib layer (`SDFile.c`); there is no compression or encryption.

---------------------------------------------------------------------------------------------------------------------------

## 3. Member types overview

Counts over all 39 archives (extension, count, magic or first bytes, section):

| Ext | Count | Starts with | What | Section |
| --- | --- | --- | --- | --- |
| `.msh` | 10,731 | `VERT` | meshes (incl. `_lod0..4`, `HR/MR/LR/SLR/BGR` LOD variants, skinned characters) | 4 |
| `.col` | 5,159 | `CBBX` | collision (triangles as plane quadruples + spatial grid) | 8 (col) |
| `.tga` | 4,961 | standard header | textures (24/32 bit, raw or RLE) | 5 |
| `.wib` | 329 | `WIBF` | animated textures (faces, water, ...) | 5 |
| `.opt` / `.txl` | 60 / 32 | `TEXT` | per-texture wrap flags of a texture directory | 5.4 |
| `.man` | 164 | `MATA` | per-object transform tracks | 8 (anim) |
| `.blk` | 136 | `ABLK` (3: offset table) | skeleton + bone animation clips | 8 (anim) |
| `.cam`, `.anm` | 141, 1 | `CAMA`, none | editor-leftover cameras, packed-rotation clip | 8 (anim) |
| `.cut` | 87 | u32 name length | compiled cutscene scripts | 8 (script) |
| `.txt` | 244 | text | cutscene scripts (139), brick models (96), brick set, "whatswhat" lists, notes | 8 (script) |
| `.str` | 166 | text tags | dialogue / message tables per language | 8 (script) |
| `.wpt` `.way` `.wbt` `.h` | 43 35 3 19 | `WPTP` / text | way points | 8 (script) |
| `.lgt` | 30 + variants | `LGTL` | lights | 8 (script) |
| `.par` `.app` `.emi` `.mov` `.swl` | ~100 each | text | particle systems | 8 (script) |
| `.gob` `.src` `.mtl` | 4, 73, 4 | text / `SRCL` / `MATL` | object descriptors, sound/particle source lists (mostly empty) | 8 (script) |
| `.fnt` | 2 | binary | bitmap fonts | 8 (script) |

The game never enumerates these directories to find things: **every file the game uses is named by string literals inside the EXE**
(section 6). The archives are just the file store.

---------------------------------------------------------------------------------------------------------------------------

## 4. Meshes (`.msh`)

Code: `src/formats/msh.ts` (`parseMsh`, `validateMsh`, `groupMatrices`). Loader in the EXE: **`FUN_00889774 @ 0x889774`** (graphics lib, called through
`FUN_0087d833` (`mesh = loadMesh(path, flag)`) and the thin wrapper `FUN_004459e0(path, 0)` that the zone set-up code calls).
Strict parse of all 10,731 meshes: 0 failures (5 meshes have a truncated MATL table, see below).

Little endian, chunks in this order (each chunk = 4-char tag + u32 count + body):

| Chunk | Layout | Notes |
| --- | --- | --- |
| `VERT` | `n`, then `n` x 32 bytes `{f32 x, y, z; u32 colour; f32 u, v; f32 u2, v2}` | then **`n` x 12 bytes of normals, no tag** `{f32 nx, ny, nz}` |
| `INDL` | `k`, then `k` x u16 | triangle **list**; `k % 3 == 0`; every index must be < `n` (the loader asserts "has invalid index value") |
| `GRPL` | `g`, then `g` x 20 bytes `{u32 flags, u32 indexCount, u32 firstVertex, u32 vertexCount, u32 firstIndex}` | the mesh is split into groups; **one group = one draw call with one texture** |
| `GTOM` | optional: `c` (= g), then `c` x u32 | per group: index into `MATL` (the loader stores value+1; 0 = no matrix) |
| `MATL` | optional: `c`, then `c` x 9 x f32 | per entry `{tx, ty, tz, rx, ry, rz, sx, sy, sz}` (translation, Euler rotation in radians, scale) |
| `SVWL` | optional: `n` (= vertex count), then `n` x `{i32 bone, f32 weight}` | skin weights, followed by `AVW2` (see anim fragment) |
| `AVW2` | `m`, then `m` x 24 bytes `{f32 x, y, z; u32 vertex; u32 bone; f32 weight}` | extra bone influences (the EXE loader also accepts the tag `AVWL`) |

Facts (all **high** unless marked):

* **Vertex colour** (`u32`) is `0xFFFFFFFF` in all 2,889,855 vertices of the data set: there is no baked vertex lighting. The in-game FVF is
  position + diffuse + two texture coordinate sets (32 byte stride), normals live in a separate array.
* **`u2, v2`** are either `(0, 0)` (592,926 vertices) or an exact copy of `(u, v)` (2,296,929 vertices; never different): the second set
  is unused data.
* **UV range**: values reach +-88 (tiled terrain/water); textures are sampled with the per-texture wrap/clamp flags of `text.txl` (5.4).
* **Indices are relative to the group**: `index + group.firstVertex` is the vertex; the indices of a group run from 0 to `vertexCount - 1`
  (checked for all groups). The groups are consecutive: `group[i].firstIndex = sum(indexCount of the groups before)`.
* **Group `flags` = draw pass**, not a material: the mesh draw routine **`FUN_0088aca2 @ 0x88aca2`** (wrapper `FUN_0087d9a7(mesh, ?, mode)`; the skinned variant is
  `FUN_0088b4c0` / `FUN_0087d9c5`) walks the group list three times and draws in pass 0 the groups whose `flags & 0x7f` is 0, in pass 1 those with 1, and in
  pass 2 everything that was not drawn yet (flags >= 2). Per group it binds texture slot = the group's index and issues one `DrawIndexedPrimitive`
  (type 4 = triangle list; vertex buffer, `indexCount`, pointer to the group's indices). The **render state** (blend, alpha test, culling...) is **not** per group: the caller's third
  argument selects one of 8 presets (`switch(mode)` calling `FUN_004092fd(n)` with n = 3, 1, 0x10, 0x12, 0xd, 0, 0x1a...). Values in the data: 0 (24,451 groups),
  1 (256), 2 (946); groups with 1 or 2 almost always use textures with alpha (the sea plane is flag 2, tower windows flag 1/2, hologram pieces flag 0 with 50 % alpha), so engines
  should draw 0 first, then 1, then 2, blending textures with soft alpha. The loader sets bit 7 (0x80, "initialised") and fills the group's texture slot (= its index) and material slot.
* **Texture binding is not stored in the mesh.** Group `i` is drawn with texture slot `i` of the model part's texture list; the lists
  are compiled into the EXE (section 6.4). The mesh carries no texture names.
* **`GTOM` / `MATL`**: when a group has a matrix, the draw code draws it with `world' = matl[gtom[g]] * world` (row-vector convention; `FUN_0043a9e5(out, world, matl)`
  computes `matl * world`). The matrix is built with the same routine as object placement, `FUN_0043a742(m, rx, ry, rz, tx, ty, tz, sx, sy, sz)`
  (see 7.3). It lets multi-part meshes (a vehicle with turning parts, a platform with moving pieces) keep each part's vertices in the part's own local
  space (`platform_lod1.msh`: groups 6-10 are modelled around the origin and the matrix places them; group 11-15 are moved by (11.42, 3.05, 0.88)).
  Meshes with one group nearly always have `GTOM=[0]` and `MATL=[0 0 0, 0 0 0, 1 1 1]` (identity). 5 meshes ship a `MATL` table that is shorter
  than their `GTOM` values (`z02LGI platform_lod1/2/3`, `z23DIP TRI2_HRhead`, `BrontGroup`): those groups simply have no matrix.
* **Skinned meshes** (399 with `SVWL`): vertices are stored in the space of their primary bone; positions/normals are skinned on the CPU every
  frame by `FUN_0088b87b` with per-bone matrices produced from a `.blk` clip (anim fragment). `bone = -1` = not skinned.
* **LOD naming**: the five levels of detail of a model are separate files `<NAME>_HR.msh` (high), `_MR`, `_LR`, `_SLR`, `_BGR` (background), or
  `<name>_LOD1..4` / `_lod0..2` for buildings. Which file is shown at which distance is stored in the model table in the EXE (section 6.3);
  typical switch-in distances: 0 / 20 / 40 / 70 (characters), 0 / 60 / 70 (terrain pieces).
* Coordinates: see section 7. Bounds over all meshes: x -2422..1820, y -1784..1784, z -1827..8401 (terrain and sky pieces are large; the island's
  buildings are 10-60 units, a minifig is ~3.2 units tall).

---------------------------------------------------------------------------------------------------------------------------

## 5. Textures

### 5.1 `.tga` - **high**

4,961 files, all plain Targa without colour map or image id: 24 bpp (3,794) or 32 bpp (1,167), type 2 (raw, 1,614 files) or type 10 (RLE,
3,347 files), all with a `TRUEVISION-XFILE` footer except 10. The origin bit (descriptor bit 5) is clear in all but one file: **rows are
stored bottom-up**. Sizes are powers of two (4x4 up to 512x512; one NPOT file), mostly 64x64 (1,643), 16x16 (1,052), 32x32 (645), 128x128 (450).
Alpha: 1,161 files have real alpha (cut-outs and soft alpha; some textures have one constant alpha, e.g. the water is uniformly 128).
The game's loader (`FUN_004100a1`, `TextureManager.cpp`) also handles 8-bit paletted files and type 10 RLE (`imageType & 8`) and chooses the D3D
surface format from the alpha content (all alpha equal -> opaque format, two distinct values -> 1-bit alpha format, else 4-bit alpha).
`src/formats/tga.ts` (`parseTga`) returns RGBA8 **in stored row order** (bottom row first).
**Orientation rule** (verified visually on text-bearing textures in the viewer): upload the rows exactly as stored and use the mesh V coordinate
unchanged (V = 0 at the first stored row = the bottom of the picture). An engine that decodes top-down must flip each texture vertically.

### 5.2 `.wib` animated textures - **high** (frame timing unknown)

329 files (mostly the 53 minifig face sheets, plus water, fire, portals). Replaces the `.tga` when a texture's `.tga` does not exist
(`FUN_004112ac` swaps the extension to `.wib`). Little endian:

| Part | Layout |
| --- | --- |
| `WIBF` | `n`, then `n` x u32: **frame sequence** (indices into the frames; repeats hold a frame longer) |
| `WIBT` | `width, height, kind, frameCount` (4 x u32) |
| pixels | `frameCount` x `width * height * bpp` raw bytes, **B,G,R(,A)** order, bottom-up like TGA |

`kind` 0 = 3 bytes/pixel opaque; `kind` 1 = 4 bytes, 1-bit alpha; `kind` 2 = 4 bytes, 4-bit/8-bit alpha. Sizes seen: 64x64 (16 frames, 53 files),
128x128 (16 frames, minifig faces of the main characters), 32x64, ... The face sheets are the frames of an expression set (`setexpression N` in
cutscene scripts). How fast the sequence advances is decided by game code (not found in the loader).
`src/formats/wib.ts` (`parseWib`) converts frames to RGBA.

### 5.3 Texture numbering - **high**

A zone's textures live in `<zone>/textures/TextNNN.tga` (3-digit number, 4 digits from 1000). **Texture id = that number.** The zone loader reads the
list file `textures/Text.txl` (name string in the EXE) and registers `n` textures with the names `%sText%03d.tga` (`FUN_00442e80` -> `FUN_004126e2` ->
`FUN_00411c86` -> `FUN_004100a1`); an id that has no `.tga` is looked up as `.wib`. Ids in the texture lists of the models (6.4) are these numbers.
Id `-1` (0xFFFFFFFF in the table) = no texture (the engine assigns one at run time, e.g. faces).

### 5.4 `text.txl` / `text.opt` - **high** (bit 2 and 7 unconfirmed)

`TEXT`, `u32 n`, then flag bytes, one per texture id. `.txl` is the texture directory list of a zone (`textures/text.txl`, `Shadow/text.txl`,
`SwapText/text.txl`), `.opt` the same for the overlay/particle/menu texture sets (e.g. `Overlays/Z02LGI/text.opt`, `GENERICBITS/Particle/text.opt`). **`n` equals the number of
`Text###.tga` + `.wib` files of the folder** (z02LGI: n = 539 = 539 files; ids 0..538 map 1:1 to the file numbers). In 29 of the 32 `.txl` files the file holds `n - 1` flag
bytes (the loader reads `n` bytes, so the flag of the last texture comes from beyond the end of the file/uninitialised memory); treat a missing flag as "wrap both". Flag bits as used by the
loader (`FUN_004100a1`): **bit 0: U coordinate wraps** (else clamp), **bit 1: V coordinate wraps** (else clamp) (the loader stores D3D address modes 1 = WRAP / 3 = CLAMP);
bit 7 (0x80) disables the loader's resolution reduction path; bit 2 (value 4) is stored but not used by the part of the code read. Values: 3 = wrap both (2,805
entries), 7 = 3 + bit 2 (1,297), 0 = clamp both (530), 4 (314), 5 (16), 1 (3).

---------------------------------------------------------------------------------------------------------------------------

## 6. The zone tables are compiled into the executable

**The archives contain no scene description.** Which meshes a zone loads, which texture each mesh group gets, which model uses which LOD meshes, where
every object stands (position/rotation), which collision file belongs to which object, and which meshes are bolted to which skeleton bone are all
**straight-line initialisation code** in the EXE: two giant functions per zone (about 28,000 and 60,000 instructions for the main island) made of
`push` / `mov` / `call` with constant operands. Ghidra fails to decompile the biggest ones (`FUN_004f645b` is marked "failed"); the smaller zones decompile fine
(see `z38PAR`: `FUN_0046add0` and `FUN_0046ea70`), which is how the structure was understood.

`src/formats/x86.ts` (length decoder + straight-line symbolic interpreter) and `src/formats/exe.ts` (`Pe`, `extractZone`) execute that code symbolically and
return plain tables, **at run time from the user's own EXE** (about 0.15 s per zone, 1.2 s for the island; no table is copied into the repository).

### 6.1 Layout of a zone's code (NL retail build)

For each zone two adjacent functions exist; the *loader* contains the mesh path strings (e.g. `_data\z02LGI\Meshes\SeaBed.Msh`), the *builder* sits
immediately before it in the code:

| function | does |
| --- | --- |
| **loader** (`z02LGI`: `FUN_004f645b`, 28,716 instructions) | allocates the global tables, calls the collision loader for each `.col` and `FUN_004459e0(path, 0)` for each `.msh` and stores the results in global arrays, runs `FUN_00442e80(".../textures/", "Text.txl")` (texture registration), then builds the **texture-id lists** with `FUN_00442e40(count, &ids[])` (the ids are first written to stack locals) |
| **builder** (`z02LGI`: `FUN_004c34c0`, 60,328 instructions) | allocates the **models** and fills them with LOD parts (`FUN_0043ec10`), attaches child models to bones (`FUN_0043e930`), then creates the **object records** (name, model, collision, matrix) |

The setup routine that calls both (`z02LGI`: `FUN_004b6475`, which calls the loader at 0x4b64a2) also initialises the sky/sea animation (`SeaAmin.c`),
characters and logic. All zone tables of the 30 zones with meshes (`z01BPK` ... `z50LTC`, `z60FRE`) were extracted this way:

| zone | builder fn | loader fn | mesh slots | col slots | texture lists | models | placed records | bone attachments |
|---|---|---|---|---|---|---|---|---|
| z01BPK | 0x4945c0 | 0x4a26df | 469 | 159 | 562 | 176 | 56 | 83 |
| z02LGI | 0x4c34c0 | 0x4f645b | 1030 | 340 | 1656 | 574 | 393 | 163 |
| z03PPH | 0x542b30 | 0x546012 | 99 | 38 | 99 | 38 | 34 | 4 |
| z04IFC | 0x54e760 | 0x55c4f9 | 396 | 107 | 540 | 134 | 54 | 119 |
| z05WAB | 0x56ce50 | 0x570679 | 72 | 54 | 72 | 54 | 48 | 5 |
| z07CSI | 0x57b7c0 | 0x59b3cb | 736 | 237 | 1058 | 360 | 208 | 160 |
| z08BKD | 0x5c2940 | 0x5ca0a5 | 75 | 75 | 106 | 106 | 95 | 16 |
| z09JST | 0x5d4b60 | 0x5e628a | 364 | 130 | 582 | 218 | 124 | 72 |
| z10RGB | 0x5f9200 | 0x60aeac | 366 | 134 | 591 | 236 | 147 | 12 |
| z13CAI | 0x61c3a0 | 0x621d05 | 130 | 44 | 150 | 64 | 55 | 9 |
| z14OSD | 0x62cd00 | 0x645d65 | 514 | 136 | 768 | 295 | 212 | 21 |
| z15SSH | 0x65a5c0 | 0x66f47d | 130 | 54 | 390 | 302 | 285 | 17 |
| z16PYA | 0x678ad0 | 0x68a987 | 488 | 131 | 704 | 198 | 115 | 21 |
| z17WAS | 0x69c040 | 0x6a00c1 | 73 | 57 | 77 | 62 | 52 | 13 |
| z18MMP | 0x6acc00 | 0x6b80f6 | 160 | 122 | 195 | 157 | 137 | 58 |
| z20DSP | 0x6c6f40 | 0x6e94b3 | 192 | 138 | 573 | 503 | 490 | 20 |
| z21FSH | 0x6f9dd0 | 0x701a78 | 79 | 44 | 184 | 104 | 96 | 8 |
| z22BIP | 0x7103c0 | 0x72057f | 102 | 95 | 260 | 223 | 222 | 5 |
| z23DIP | 0x72b7b0 | 0x74fac5 | 579 | 155 | 1307 | 365 | 270 | 37 |
| z27TRX | 0x76b230 | 0x786b7c | 71 | 47 | 654 | 342 | 337 | 5 |
| z28HAT | 0x797e90 | 0x7a6bf3 | 181 | 99 | 409 | 180 | 154 | 20 |
| z36CNT | 0x7b2910 | 0x7b48bc | 57 | 34 | 57 | 34 | 20 | 8 |
| z38PAR | 0x46add0 | 0x46ea70 | 50 | 27 | 81 | 58 | 49 | 5 |
| z39ASB | 0x7b9b50 | 0x7c965f | 246 | 246 | 246 | 246 | 247 | 0 |
| z40aPO | 0x7d5a70 | 0x7dda5a | 112 | 61 | 197 | 99 | 94 | 5 |
| z40OGL | 0x7e8800 | 0x7fe97e | 631 | 182 | 828 | 249 | 137 | 38 |
| z41MAP | 0x816ca0 | 0x81bcf7 | 151 | 67 | 164 | 73 | 36 | 22 |
| z42BRP | 0x8276f0 | 0x831690 | 246 | 115 | 275 | 132 | 96 | 21 |
| z50LTC | 0x83ac50 | 0x849bb2 | 411 | 117 | 558 | 156 | 62 | 126 |
| z60FRE | 0x4731d0 | 0x47ec85 | 730 | 98 | 470 | 116 | 46 | 85 |

(`z39ASB` has 247 records and 246 models: record 0 is a stub `" ASB"` without a model.)

Finding the functions without a symbol table: the loader is the function that contains a `push imm32` of the address of a string `_data\<zone>\Meshes\*.msh`
(function starts = `E8` call targets that begin with `55 8B EC`), the builder is the function start right below it. A zone function is executed by
`interpret()`: registers and the stack hold symbolic values (immediate, "contents of global G", "G + offset", "result of call #n", "address of frame
local"), calls record their arguments (resolved from the pushes; `add esp, N` after the call tells how many), memory stores to `[global + offset]` are logged.
The helper function addresses the extraction relies on are in the `PROFILE_NL` constant of `exe.ts`; they are specific to this build
(the English/other builds have other addresses, the code structure is the same). **medium** for portability, **high** for this build.

### 6.2 Global tables (NL build addresses)

| global | content |
| --- | --- |
| `DAT_00983804` | pointer to the **object record array**, stride 0x68 (`recordCount` in `DAT_00983800`) |
| `DAT_0098380c` | pointer to the **model array**, stride 0x18 (allocated by `FUN_0043eaa0(n)`, element i = `FUN_0043eaf0(array, i)`) |
| `DAT_00983814` | **mesh table**: `mesh[slot] = FUN_004459e0(path, 0)`; slot = index in the table; one entry per `.msh` string of the zone (z02LGI 1030) |
| `DAT_0098381c` | **texture-list table**: `list[k] = FUN_00442e40(count, ids)` (z02LGI 1656 lists; `-1` = no texture) |
| `DAT_00983824` | array of 0x144 bytes (81 entries), zero-initialised; passed to the part set-up as a second list pointer, role unknown (no data in it at load) |
| `DAT_0098382c` | **collision table**: `col[slot] = FUN_0043f370/FUN_0043f700(path)`; unused slots hold `0xBABABABA` |
| `DAT_00983838` | block of 0x18 bytes (+8 = array of extra "child" models used as attachments: heads, hats, hands...) |

### 6.3 Models, LOD parts, attachments

A **model** (0x18 bytes) holds: `+4` part count, `+0x10` array of **parts** (0x14 bytes each), `+0xc` the **attachment table** (10 slots x 0x10 bytes), `+0x14` the animation object
(`FUN_0043f1d0` binds a skeleton/animation set). Builders in the code:

* `FUN_0043e870(model, n)` allocates `n` parts and the 10 empty attachment slots.
* `FUN_0043ec10(model, partIndex, mesh, textureList, list2, lodDistance, flag)` fills a part:
  `part.mesh = mesh` (an element of the mesh table, i.e. `DAT_00983814[slot]`), `part.textureList = DAT_0098381c[k]`, `part.list2 = DAT_00983824[k]` (same index `k`),
  `part.lodDistance` (float; **0 for part 0, then 20/40/70... = the camera distance from which the next LOD mesh is used**), `model.flag = last argument`.
  So a model with five LOD meshes (`HR, MR, LR, SLR, BGR`) has five parts with increasing `lodDistance`.
* `FUN_0043e930(parent, child, bone, slot)`: attachment `slot` (0..9) of `parent` = model `child` bolted to skeleton bone `bone`:
  e.g. Pepper: slot 3 bag -> bone 8, slot 4 head -> bone 10, slot 5 hat -> bone 10, slot 6 right hand -> bone 14, slot 8 left hand -> bone 16
  (bone numbers are those of `MFIG.blk`, see the anim fragment). Child meshes are modelled around their own origin; their world matrix is
  `boneMatrix * recordMatrix`.
* `FUN_0043f1d0(model, slot | -1, clip, params, flag)`: starts/binds an animation for the model or one of its attachments (not decoded further).

### 6.4 Texture lists

`texList[k] = [id0, id1, ...]`: element `i` is the texture id (5.3) of **mesh group `i`** of the part's mesh (-1 = none). Checked on every part of every zone
(`tools/tests/exe.mjs`): 7,568 of 7,873 parts have exactly as many entries as the mesh has groups; 294 lists are longer (e.g. the minifig body `MFG_HR`: 6 groups, 10
entries `[416,417,416,416,416,416,416,416,416,418]`; the extra entries' purpose is unconfirmed, probably the textures of attached child parts) and 11 are shorter (a group without
entry gets no texture). All 26,133 non-negative ids resolve to a `TextNNN.tga` or `.wib` of the zone archive.

### 6.5 Object records and placement

An **object record** is 0x68 bytes at `DAT_00983804 + 0x68 * i`:

| offset | content |
| --- | --- |
| +0x00 | 4-byte name (not NUL terminated, copied with `FUN_0085c0b0(dst, str, 4)` from the string pool): e.g. `SEAB`, `LAND`, `PEPP`, `BRIK`, `INFO`, `PAPA`, `BBT0`, `SFT9` |
| +0x04 | model pointer = `FUN_0043eaf0(DAT_0098380c, modelIndex)` |
| +0x0c | **4x4 world matrix** (16 floats), written by `FUN_0043a5e4(&rec + 0xc, rx, ry, rz, px, py, pz)` or the scale variant `FUN_0043a742` |
| +0x4c | vec3 (zero) |
| +0x58 | collision pointer `DAT_0098382c[slot]` |
| +0x60 | flags (u16, 2 for all records in the builder; later logic clears bit 1 for hidden objects, see `FUN_0051c823`) |
| +0x64 | u32 (0 at build, set to 2 by the island's logic for the active records) |

Placement is therefore **position + three Euler angles** in the first column group of the record; the matrix is derived (7.3). Example (z02LGI): `PFM0` at
(203.25, 42.437, 171.102), `BRIK` at (-463.558, 31.307, 295.436) with ry = -0.785 (45 degrees). Records without rotation have rx = ry = rz = 0.
`extractZone()` returns `records[i] = {name, model, col, flags, matrix, rot, pos, scale}`; **393 records** in z02LGI (terrain `LAND`, `SEAB`, `SSEA`, `SEAE`, `SSKY`, all
characters `PEPP BRIK INFO PAPA MAMA NICK BILL ...`, vehicles, buildings, bricks), 4,371 over the 30 zones. Run-time objects (spawned effects, animals that are placed by logic, the
brick-built buildings of `BrickMorph`) are not in these tables; many moving objects are placed at 0,0,0 and positioned by game code each frame.

### 6.6 Verification

* All 4,371 placement records of the 30 zones were compared name/position/rotation with the tables of Moreno.LegoIsland2 (`data/*_placement.tsv`, extracted by a different method):
  **0 mismatches** (the tables are 1:1 identical). The mesh-slot and texture-list structure was verified separately against the archives (`tools/tests/exe.mjs`: all
  7,873 model parts resolve to existing meshes, all texture ids to existing files, 4,369 collision files resolve, 30 zones, 0 failures).
* Visual check with the viewer (section 9): the island (terrain, roads, trees, bridge, buildings, characters with heads/hats/hands at the correct bones), Pepper's house (trophies on shelves, door, sofa, computer),
  the castle island, the dinosaur island, the skate park interior; text on textures reads correctly (no mirroring).
* Special cases the game handles in code, not in the tables: **`SSKY`** (`sky.msh`, a unit sphere) and **`SSEA`** (`pPlane1.msh`, a unit plane at +-1) are scaled by the game's sky/sea code
  (`SeaAmin.c`); the viewer approximates them (sky scaled to 5000 and following the camera, sea plane scaled to 1400 at y = 2.4).

---------------------------------------------------------------------------------------------------------------------------

## 7. Conventions the engine needs

### 7.1 Coordinate system - **high**

* **Left-handed, +Y up** (Direct3D style; the EXE uses **DirectDraw 7 + Direct3D 7** (`IDirect3DDevice7`, state blocks, `CreateDevice` on the `IDirect3D7` object) through the "Graph" library: `Direct3D HAL` in `GameSetup.txt`; see rendering.md). X right, Z into the screen, Y up.
  The island's ground is near y = 20..45, sea level y = 2.4 (Moreno), characters ~3.2 units tall, the island spans about +-600 units in x/z.
* Units are arbitrary game units (a minifig is 3.2 high; a 1x1 brick stud pitch looks like 0.8..1 unit). 30 Hz is the animation sample rate (Moreno; anim fragment).
* **Matrices are row-major, row vectors**: `v' = v * M`; translation in row 3 (floats 12..14). A composed transform is applied left to right: `v * local * parent * world`. Uploading such an array to
  WebGL with `uniformMatrix4fv(loc, false, m)` makes GL see `M^T` and `M^T * v_col` is the same transform, so row-vector matrices can be fed unchanged.
* To use them in a right-handed engine mirror one axis once (e.g. Z) and flip the winding; the viewer instead keeps the left-handed space and uses a left-handed projection
  (`src/viewer/math.ts: perspectiveLH`, `lookDirLH`, GL clip space with `w = z`).

### 7.2 Winding and culling - **high**

Direct3D default: **clockwise triangles are front faces**. In the viewer with the LH projection above: `gl.frontFace(gl.CW); gl.cullFace(gl.BACK)`. Verified on closed buildings, Pepper's
room (inside faces visible, outside culled) and terrain. Sky domes are viewed from inside and drawn without culling in the viewer.

### 7.3 Euler matrix builders (`FUN_0043a5e4`, `FUN_0043a742`) - **high**

`buildMatrix(rx, ry, rz, px, py, pz, sx = 1, sy = 1, sz = 1)` in `src/formats/matrix.ts` reproduces both (`cx = cos(rx)`, `sx_ = sin(rx)` etc.):

```
row0 = ( cz*cy,                 sz*cy,                 -sy    ) * sxScale
row1 = ( cz*sy*sx_ - sz*cx,     cz*cx + sz*sy*sx_,      cy*sx_ ) * syScale        (scale multiplies the columns: column j * s_j)
row2 = ( sz*sx_ + cz*sy*cx,     sz*sy*cx - cz*sx_,      cy*cx  ) * szScale
row3 = ( px, py, pz, 1 )
```

(`FUN_0085d374` = cos, `FUN_0085d1c4` = sin in the EXE; angles in **radians**.) The rotation part equals `RotX(rx) * RotY(ry) * RotZ(rz)` with Direct3D's row-vector rotation matrices (`RotX = [[1,0,0],[0,c,s],[0,-s,c]]`, `RotY = [[c,0,-s],[0,1,0],[s,0,c]]`, `RotZ = [[c,s,0],[-s,c,0],[0,0,1]]`; checked numerically, error 2e-8), so a row vector is rotated about X first, then Y, then Z.
`FUN_0043a742`'s parameter order is `(m, rx, ry, rz, px, py, pz, sx, sy, sz)`; a `MATL` entry stores `{t, r, s}` and is passed in that order (`rx,ry,rz` = floats 3..5, `px,py,pz` = floats 0..2).
Note the `.man` animation tracks and skeleton code negate X in places (anim fragment).

### 7.4 Textures and UVs - **high**

Upload TGA/WIB rows as stored (bottom-up) and use the mesh UVs as they are; REPEAT or CLAMP per `text.txl` flag. Mipmaps: the game builds them itself unless texture
flag bit 7 is set. UVs are not wrapped to 0..1 in the data (|uv| up to 88). Alpha: use the draw pass of the group (4) for ordering, alpha test / blend per texture alpha.

### 7.5 What a faithful scene build needs (summary)

1. Parse the zone archive and run `extractZone(exe, zone)` (6).
2. For each record with a model: pick the part by distance (`part.lod <= distance`, last match), load `meshPaths[part.mesh]`, draw its groups in three passes with
   `texLists[part.texList][group]` (5.3/6.4) and the per-group `MATL` matrices (4), world matrix = record matrix.
3. Skinned characters: sample the zone's `anim/MFIG.blk` clip, skin with `SVWL/AVW2` (anim fragment), draw attachments with `boneMatrix * recordMatrix` (6.3).
4. Special objects: sky follows the camera; sea plane scale/height from the sea code (not extracted yet).

---------------------------------------------------------------------------------------------------------------------------

## 8. Collision, animation, scripts/text, sound

The four sub-sections below were written by the format workers against the same data and EXE; their internal numbering ("1.", "2.", ...) is local to the sub-section. Code: `col.ts`, `anim.ts`, `cutscene.ts text.ts waypoints.ts lights.ts particles.ts fonts.ts`, `sound.ts riff.ts` in `src/formats/`; tests: `tools/tests/{col,anim,cutscene,text,waypoints,particles,sound}.mjs`.

### 8.1 Collision (`.col`)

Parser: `src/formats/col.ts` (`parseCol`, `polygonCorners`, `extractTriangles`, `gridCellAt`, `polygonsNear`, `raycast`).
Test: `node tools/test-formats.mjs --only col` (all 5159 files, strict consumption).
Confidence: **high** for the byte layout, plane layout, triangle recovery, grid indexing (all verified against the data and the EXE loader);
**medium** for the meaning of the flag bits and of the surface ids (derived from the EXE footstep/landing switches and the mesh names, not from a spec).

#### 1. What they are

One `.col` per collidable mesh, stored next to the mesh in the zone archives (`<zone>.bod/.bob`, path `col/<Name>.col`, 5159 files in
39 archives, 47.8 MB). The name matches the mesh (`z02LGI/col/SeaBed.col` <-> `meshes/SeaBed.msh`, and the character part meshes like `MUM_HRhead`).
The file holds a bounding box/sphere, a list of triangles stored as **planes** (face plane + 3 edge planes, a "prism" test), and a uniform
3D grid whose cells list the triangles they overlap. It is loaded by the Collision module of the engine (`C:\projects\LegoIsland2\ms\GSMS\c_src\Collision.cpp`).

Space: the file's own local space (identical to the `.msh` vertex space, e.g. the recovered triangle corners of `OBJT_Cutlass.col` equal the
mesh vertices to float precision). Right/left-handedness is that of the meshes (Y up). The runtime transforms the query segment into this space
with the record's matrix (row vectors) before the test.

| count | files | note |
|---|---|---|
| `NCOL` (no collision) | 2469 | 2426 are exactly 36 bytes; 43 have 36 more bytes of heap debug fill (see 5) |
| `COLP` | 2690 | 507 947 polygons in total; largest `z27TRX/col/land.col` 17 419; 1172 files have a 1x1x1 grid, 1518 a bigger one (max 43x1x31 = 1333 cells, `z13CAI/col/wash.col`) |

#### 2. File layout (little endian)

| offset | type | field | notes |
|---|---|---|---|
| 0 | char[4] | `CBBX` | magic (loader FUN_0043f370 fails with 0xbabababa otherwise) |
| 4 | f32[3] | centre | centre of the bounding box (also used as the centre of the bounding sphere in the query) |
| 16 | f32[3] | half extents | box half sizes. **Not** "min/max": `min = centre - half`, `max = centre + half` |
| 28 | f32 | radius | bounding sphere radius = `length(halfExtents)` (verified for all 2690 `COLP` files, rel. error < 1e-3) |
| 32 | char[4] | `NCOL` or `COLP` | `NCOL`: stop, count = 0 (the EXE returns the object right here) |

`COLP` continues:

| offset | type | field |
|---|---|---|
| 36 | u32 | polygon count `n` |
| 40 | record[n] | `n` x 88-byte polygon records (section 3) |
| ... | char[4] `GRDP` | |
| +4 | u32 | `m` = length of the cell polygon list |
| +8 | u32[m] | polygon indices, concatenated per cell |
| ... | char[4] `GRDC` | grid with explicit cell size |
| +4 | u32[3] | `dims` = cells along x, y, z (`nx, ny, nz`) |
| +16 | f32[3] | cell size per axis |
| +28 | (u32,u32)[nx*ny*nz] | per cell: start index into the GRDP list, count |

The file ends right after the last cell (no trailer). Every `COLP` file in the data is exactly `GRDP` then `GRDC` and nothing else.

Tags the **loader** knows besides `GRDP`/`GRDC` (never present in the shipped data): `GRDA` = like `GRDC` but without the cell size (the loader computes
`cellSize = (halfExtents + 1 + halfExtents + 1) / dims`), `GRDB` = terminator (the loader returns at it; no grid). In GRDC files the stored cell size
equals that formula (verified for every file), so the exporter just wrote what the loader would compute.

#### 3. Polygon record (88 bytes)

| offset | type | field | notes |
|---|---|---|---|
| 0x00 | u32 | `flags` | see section 4. Values in data: 0x01, 0x02, 0x03, 0x12, 0x23, 0x32 |
| 0x04 | u32 | `surface` | footstep/landing material id, 0..10 (710 polygons hold the uninitialised fills 0xcccccccc / 0xcdcdcdcd) |
| 0x08 | f32[4] | face plane `(nx, ny, nz, d)` | `n . p = d`, unit normal, **outward** |
| 0x18 | f32[4] | edge plane 0 | unit normal perpendicular to the face normal (dot < 2e-3), inside = `n . p - d <= 0` |
| 0x28 | f32[4] | edge plane 1 | |
| 0x38 | f32[4] | edge plane 2 | |
| 0x48 | u32[4] | runtime data | uninitialised in the file (heap pointers like 0x1bafc1f0, 0xffffffff, 0xcdcdcdcd); for polygons with flag 0x04 the loader/query reads a **4th edge plane** here (FUN_00440810 loops `3 + (flags & 4 != 0)` edge planes at 0x18, 0x28, 0x38, 0x48). Flag 4 never occurs in the shipped data, so every polygon is a triangle |

Verified for all 495 954 polygons whose planes are finite: face and edge normals are unit length (tolerance 1e-3), edge normals are perpendicular to the face
normal, and the centroid of the recovered triangle is on the inner side of all three edge planes.

##### Triangle recovery

Each triangle corner is the intersection of the face plane with two of the three edge planes (3x3 linear solve, `polygonCorners`):
corner 0 = (e0, e1), corner 1 = (e1, e2), corner 2 = (e2, e0). With this order `(c1-c0) x (c2-c0)` points **against** the face normal (507 605 of 507 605 finite
polygons), so `extractTriangles` emits `c0, c2, c1` to get counter-clockwise triangles seen from the normal side.

Check against the visual meshes: for the 2636 `COLP` files that have a same-named `.msh` in the same archive, 463 404 of 495 954 recovered triangles have all three
corners (rounded to 0.01) equal to vertices of that mesh (the rest belong to collision-only or simplified geometry). The stored box equals the tight AABB of the recovered corners.
Example `OBJT_Cutlass`: box x -6.7816..-2.9559, mesh x -6.7816..-2.9559 (identical).

#### 4. `flags` and `surface`

`flags` is a mask that a query tests with `queryMask & flags != 0` (FUN_00441270, `param_6 & polygon.flags`). The masks the EXE passes: `3`
(ordinary walking/camera), `1`, `0x43`, `0xc3` (0x40 and 0x80 are query modifiers evaluated on the *record*, not polygon bits), and a few variable masks.

| flags | polygons | files | typical content |
|---|---|---|---|
| 0x23 | 453 798 | 2234 | props and character parts (bit 0x20 = "character/prop" class + both solid bits) |
| 0x03 | 50 161 | 377 | world geometry (land, bridges, buildings) |
| 0x01 | 2 600 | 85 | LOD5 low-detail proxies (`garage_LOD5`, `jail_LOD5`, SkatePark): hit by mask 1 queries only |
| 0x02 | 572 | 9 | z07CSI `Land`, `buns`, z10RGB `Cannon3`: hit by mask 2 only |
| 0x12 / 0x32 | 732 / 84 | 1 / 1 | `z04IFC/Flower1`, `z42BRP/brikbothead1` (bit 0x10 meaning unknown) |

Bit 0x04 = quad (never set). Bits 0x10/0x20 are never contained in any constant mask found in the code; the semantics above for 0x20 are inferred from where it occurs.

`surface` is read by FUN_004425c0 (id of the polygon hit last: `*(hitPolygon + 4)`) and drives the footstep/landing sounds:

| surface | walking sounds (FUN_0042b8e8, 4 variants each) | landing sound (FUN_0042a88f) | seen on |
|---|---|---|---|
| 0 | `SND_WALK_GRASS1-4` (ids 267-270) | `SND_LAND_GRASS` (395) | default (448 639 polygons) |
| 1 | `SND_WALK_ROAD1-4` (279-282) | `SND_LAND_ROAD` (391) | z02LGI `land` (895 polygons), z03PPH `Land1`, volcano |
| 3 | `SND_WALK_SAND1-4` (288, 289, 291, 292) | `SND_LAND_LAND` (392, plays Sand_2.wav) | seabeds, `under_sea`, z14OSD/z15SSH/z16PYA land |
| 4 | `SND_WALK_ROCK1-4` (283, 285-287) | `SND_LAND_ROCK` (396) | rocks, pillars |
| 5 | `SND_PEPP_IDLE` placeholder = silent | none | `Sea`, `pool_water`, `scum` (water surfaces) |
| 6 | `SND_WALK_GRAVEL1-4` (263-266) | `SND_LAND_GRAVEL` (393) | z28HAT land, tree trunks |
| 7 | `SND_WALK_PLASTIC1-4` (275-278) | `SND_LAND_PLASTIC` (394) | bridge sections, skate park, palm trunks |
| 8 | like 1 | like 1 | z02LGI `land` (10), Decking |
| 9 | like 7 | none | doors, planks, logs (z18MMP, z27TRX); additionally special-cased in FUN_0053adc3 |
| 2, 10 | default (silent) | none | Platform1, z02LGI `land` (8 polygons); 10 is special-cased in FUN_0053adc3 |

(`SND_WALK_BRIDGE*` / `SND_LAND_BRIDGE` exist in the sound table but are not selected by these two switches.)

#### 5. NCOL files and the 43 files with a tail

`NCOL` files are 36 bytes: header + tag. 43 files (`MAMA_Head`, `CEDR_HRlhand/rhand`, `speederHR`, `*_LOD1..4` space buildings, trees, lights...) are 72 bytes:
the 36 bytes after `NCOL` are `GRDP`, 4 fill bytes, `GRDC`, then 24 fill bytes, where the fill is the heap debug pattern `0xcdcdcdcd` (MSVC debug heap, 35 files) or
`0xbaadf00d` (LocalAlloc fill, 8 `CEDR_HR*hand` files). It is the tail of an uninitialised struct that the exporter dumped; the loader returns at `NCOL` and never reads it.

#### 6. The grid

* Origin (verified from the data): `origin = centre - halfExtents` per axis. Cell `(ix, iy, iz)` covers `origin + [i*cs, (i+1)*cs)`.
  The grid is therefore larger than the box by `2*margin` in total (cs = `2(h+1)/n`, margin 1.0 = the constant at 0x892020), so the last cells are partly empty.
* Index: `cell = (ix * ny + iy) * nz + iz` (**z fastest, x slowest**; EXE: `(piVar4[0x10] * ix + iy) * piVar4[0x11] + iz`). Verified: SeaBed (12x1x12), Cutlass (3x1x1).
* `cells[2*cell]` = start index into the GRDP list, `cells[2*cell+1]` = number of polygon indices. Cells tile the list contiguously (start = previous start + previous count; sum = list length) in every file.
* The listing rule of the exporter (all verified over 441 128 polygons in multi-cell grids): every cell that contains a triangle corner lists the polygon (7 exceptions in 441k), and a polygon is
  never listed outside the cell range of its bounding box (164 exceptions from rounding at cell borders). Cells crossed only by the triangle interior or by its bounding box are listed in about 94.6 % of the cases only (the generator appears to
  use corner/edge based registration). **Use the grid as a conservative candidate set only for ray/point queries** (`raycast` walks the bounding cell range of the segment), never as a complete cover.
* **1x1x1 grids are ignored** by the EXE: with `dims == (1,1,1)` it simply tests *every* polygon (FUN_00441270 case 0: loop over `count`). The lists in such files are incomplete (e.g. `gem*.col` list 56 of 62 polygons, `palm_trunk_low*` 0 of 2, `space_control_LOD5` 0 of 34) and must not be trusted; `polygonsNear`/`raycast` handle this.
* Polygons with a corner outside or exactly on the faces of the stored box are not listed anywhere (23 906 polygons): see the next section.

How the EXE walks the grid (FUN_00441270 -> FUN_004405f0): the segment's AABB (FUN_00440560) is converted to cell indices
`lo = ftol((min - O) / cs - 0.1)`, `hi = ftol((max - O) / cs + 0.5)`, clamped to `[0, dim-1]`, where `O = centre - halfExtents - 1.0` (!). Each visited cell is
first rejected with a segment-vs-box test (FUN_0043f810, box centre = `O + (i + 0.5) * cs`, half size `cs/2 + sweepRadius`), then its polygon list is scanned; a per-call
generation counter (`DAT_008b1a88` vs the `DAT_009dec20[polygon]` array) prevents testing a polygon twice.
Open point: the EXE walks the cells from `centre - h - 1.0` while the lists in the files are consistent with `centre - h` (exact for the 99.9 % of polygons that can be checked; an
origin shifted by 0.1, 0.5 or 1.0 fits far worse). The extra `+0.5 / -0.1` cell slack of the index range and the radius-inflated cell test hide most of the 1-unit shift in the game, but it looks like a genuine off-by-margin in the shipped
engine. The parser exposes `origin = centre - h` (the data-verified value).

#### 7. Data quirks (tolerated explicitly in the test)

| quirk | count | handling |
|---|---|---|
| polygons whose 16 plane floats are all NaN (degenerate source triangle) | 340 polygons in 91 files | `polygonCorners` returns null; skipped by `extractTriangles` |
| zero-width slivers (two edge planes exactly anti-parallel, corners not recoverable) | 2 polygons (z40OGL `ogel.col` #1178, #1181) | null corners |
| the stored box does not contain all triangles (stale box in the exporter; e.g. `SkBoard`, `HatesStick`, `SKEL_scorecard`, `Police_Chopper` whose box has half z = 0) | 384 files | such polygons are unlisted in the grid, but are still tested in 1x1x1 grids; use the triangles, not the box, when exact bounds matter |
| `surface` = 0xcccccccc / 0xcdcdcdcd | 710 polygons (burnt logs/stumps of z27TRX, `BrontyMesh`, `info_door_L_LOD1`...) | footstep switch falls through to default |
| centroid marginally outside an edge plane (float noise on near-degenerate slivers) | 5 | within tolerance |
| `NCOL` with 36 trailing fill bytes | 43 | ignored, see section 5 |

#### 8. Query code in the EXE (names are mine)

| function | role |
|---|---|
| FUN_0043f370 @ 0043f370 | **`.col` loader** (Collision.cpp lines 0x4e-0xc7: file open, tag checks, allocations) |
| FUN_0043f700 | header-only loader variant (reads `CBBX`, centre, half extents, radius; sets the shape parameters 2.0 / 4.0 at [0x14]/[0x15]); callers not traced |
| FUN_00441270 @ 00441270 | main collision query: sweep of a segment with radius/skin over all active collision records; args (ignore record, from, delta, out normal, out point, polygon mask, edge radius `param_7`, plane skin `param_8`); wrappers FUN_00441a90 and FUN_00441ac0 (edge radius 0.01, skin 0; the latter sets `DAT_009dec1c` = "skip current record") |
| FUN_00440810 @ 00440810 | segment vs one polygon: plane distance test with skin, then the 3 (4) edge planes widened by the radius |
| FUN_0043f810, FUN_0043f9b0 | segment vs AABB tests used for cull (record bounds, cell bounds) |
| FUN_00440560, FUN_004405f0 | min/max of the segment, conversion to cell index range (clamped) |
| FUN_00440a70 | bounding sphere test with `radius` and the file's sphere radius |
| FUN_00440d00 / 00440e00 / 00440f30 / 004410e0 | analytic shapes (sphere, cylinder, box) selected by the record's shape type `object[0x13]` = 1/2/3; set at runtime, not stored in `.col` |
| FUN_004425c0 | surface id of the last hit polygon |

In-memory object (0x64 bytes) as used by the loader: `[0]` polygon count, `[1]` polygon array (88-byte records, raw copy of the file), `[3..5]` centre, `[6..8]` half extents, `[9]` radius,
`[10]` GRDP count, `[11]` GRDP list, `[12..14]` cell size, `[15..17]` dims, `[18]` cell array, `[19]` shape type (0 = polygons), `[0x16..0x18]` copy of the half extents.

References: Moreno.LegoIsland2 `scripts/core/col_file.gd` and `scripts/engine/record_collision.gd` (same plane layout and sweep logic; their function addresses refer to another binary
build). Everything above was verified against the data and against `LE2.c`/`LE2.asm.txt` of this EXE.

#### 9. Open questions

* Meaning of flag bits 0x10 and 0x20 and the exact use of mask 2 (queries with the variable masks `local_70`/`local_c8` were not traced).
* Surfaces 9 and 10 (special behaviour in FUN_0053adc3, probably an interaction like "pushable"/"sticky" ground).
* Why the lists skip some cells that the triangle crosses (not needed to use the data).

### 8.2 Animation, cameras and skin weights (`.blk` `.man` `.anm` `.cam`, mesh `SVWL`/`AVW2`)

Code: `src/formats/anim.ts` (`parseBlk`, `sampleBlk`, `parseSvwl`, `skinPositions`, `parseMan`, `sampleMan`, `manRotationMatrix`,
`parseAnm`, `anmToQuaternion`, `parseCam`). Test: `node tools/test-formats.mjs --only anim` (all 136 .blk, 164 .man, 141 .cam,
1 .anm and the 399 skinned .msh of the 39 archives parse strictly, 0 failures).
All numbers little endian. Floats are IEEE f32.

| Format | Files | Magic | Used for | Confidence |
| --- | --- | --- | --- | --- |
| `.blk` | 136 (`anim/`, and 3 in `MatAnim/`/`anim/`) | `ABLK`, or none (offset-table variant, 3 files) | skeleton + per-frame bone rotation clips of characters/animals | high (loader read in the EXE, conventions proven to float precision on the skin data) |
| `.man` | 164 (`MatAnim/`) | `MATA` | per-object TRS tracks: camera moves, flying objects, paths | high layout, medium rotation convention |
| `.anm` | 1 (`z21FSH/anim/RODD_Swish.anm`) | none | the same clip as `RODD_Swish.blk` with 10-bit packed rotations | high layout (verified vs the .blk), axis order of the unused middle angle assumed. Not referenced by the EXE (no ".anm" string) |
| `.cam` | 141 (`camera/`) | `CAMA` | editor leftover cameras (front/persp/side/top...) | high layout. The EXE contains no "CAMA" and no ".cam" string, so the game never loads them |
| `SVWL` + `AVW2` (tail of `.msh`) | 399 skinned meshes | tags | per-vertex bone influences | high (weights sum to 1.000 on all 382,679 vertices; bind pose lines up to 1e-7) |

---------------------------------------------------------------------------------------------------------------------------

#### 1. `.blk` - skeleton and bone animation block

##### 1.1 Container

Two on-disk variants, both read by one EXE function: **`FUN_0043b1ff`** (source file `SDAnim.c`, Sdlib; it reads the file, compares
the first 4 bytes with `ABLK` (0x8b1788); if they match it reads tagged chunks, otherwise treats the whole file as the offset-table
variant and relocates the chunk offsets into pointers). The result is an array `[count, chunk0, chunk1, ...]`.

**Variant `ABLK`** (133 files):

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | char[4] | `ABLK` |
| 4 | u32 | chunk count `n` |
| 8 | repeated n times: char[4] tag (`ASKL` or `ANIM`), u32 size, `size` bytes of chunk body |

The four files `z02LGI/anim/OCTO.blk`, `z10RGB/anim/CATP.blk`, `z16PYA/anim/SCRP.blk`, `z17WAS/anim/SPID.blk` are exactly 8 bytes:
`ABLK` and count 1 but no chunk at all (an empty rig; the game never gets clips from them). `parseBlk` returns `clips: []` for them.

**Variant "offset table"** (3 files: `z02LGI/MatAnim/bb_TwirlCrash02.blk`, `bb_TwirlCrash03.blk`, `z21FSH/anim/RODD_Swish.blk`; they look
like "non-ABLK" files because the first u32 is the chunk count, 2):

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | chunk count `n` |
| 4 | u32[n] | absolute file offset of each chunk body (first = 4 + 4n); chunk i ends where chunk i+1 starts, the last at EOF |
| ... | chunk bodies without tag/size | same bodies as below; chunk 0 is the skeleton |

##### 1.2 Chunk body

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 `flags` | always has bits 0 and 1 (value 3). Seen: 3 (4172 chunks), 11 = 3+0x08 (146), 19 = 3+0x10 (2: skeleton chunk of `z40OGL/anim/CIT1.blk` and `z41MAP`'s). Bit `0x10` = **loop** (EXE `FUN_0043b76a`: if set the time wraps at `frameCount`, otherwise the clip ends at `frameCount - 1` and the player reports "finished"). Bit `0x08` is set on walk/run/sneak/swim/rail-slide style clips of the minifig (`MFIG` clips 8, 9, 13, 36, 46, 47, 89, 103/115...); meaning unknown (not read by the animation core I looked at) |
| 4 | u32 `bones` | bone count of the rig (1..44 seen) |
| 8 | u32 `frames` | frame count (1..160 seen) |
| 12 | f32[frames x (3 + 4 x bones)] | per frame: **root translation** x,y,z, then per bone a **quaternion** x,y,z,w (unit length, max deviation 5e-8 over 2.8 M quaternions) |
| 12 + frames x (3+4 bones) x 4 | only in `ASKL`: bones x { f32 x, y, z, i32 parent } | **bone records**: offset of the bone from its parent in the parent's frame, and the parent index (-1 for bone 0, `parent < index` always) |

Chunk kinds: the **first** chunk (`ASKL`, "animation skeleton") has `frames == 1` (a single pose, clip number 0) and carries the bone
records; every following chunk (`ANIM`) has the same layout without the bone records. Verified: chunk size equals either
`12 + frames x (3+4 bones) x 4` (ANIM) or that plus `16 x bones` (ASKL) for all 4,320 chunks of the 136 files. The root bone's record
(offset of bone 0) equals the root translation of the skeleton pose and is not used by the game (the root position comes from the frame).

An `ANIM` chunk can have a different bone count than the file's skeleton: 14 clips of `z50LTC/anim/MFIG.blk` have 14 or 21 bones
(they are the clips of the rabbit (14) and triceratops/T-rex (21) rigs; their frame sizes equal `RBBT`/`TRIC` chunks). The EXE
addresses a clip only by number, so such a file is just a larger clip list; use the skeleton whose bone count matches.

##### 1.3 Clip numbers

**Clip number = chunk index** (the skeleton chunk is clip 0). Proven by the name tables in the EXE: each zone loader registers
`FUN_0045bff4(table, "PEP_JUMPINAIR", 1)`, `("PEP_IDLE", 0x3a)`, ... and e.g. the 143-chunk `z03PPH/anim/MFIG.blk` has its last
registered name `BB_CRASHLANDING1A = 142`; `PEP_TREADWATER = 0x41 = 65`, `PEP_SITTING = 67`, `PEP_JUMPINAIR = 1` agree with Moreno's findings.
The flagged (0x08) clips of z03PPH `MFIG` are 8 SNEAK, 9 SWIM, 13 WALK, 36 RUN, 46 RAILBACK, 47 RAILFRONT, 89 NOD1, 103 XWALK.
Names are `<RIG>_<NAME>` where RIG selects the .blk (`PEP`/`X`/`BB`/`MUM`/`HATES`... = `MFIG.blk`, `PTER` = `PTER.blk`, `SHRK`, `RATT`,
`TRIC`, ...). The numbers restart per rig. Each zone has its own table (functions below), so the same number can mean different clips in
different zones: `MFIG.blk` has 4 to 526 chunks depending on the zone (z02LGI 317, z03PPH 143, z50LTC 526).

Name tables (`FUN_0045bff4` calls, per zone loader): z03PPH `FUN_00546012`, z05WAB `FUN_00570679`, z08BKD `FUN_005ca0a5`, z13CAI `FUN_00621d05`,
z15SSH `FUN_0066f47d`, z17WAS `FUN_006a00c1`, z18MMP `FUN_006b80f6`, z21FSH `FUN_00701a78`, z22BIP `FUN_0072057f`, z28HAT `FUN_007a6bf3`,
z36CNT `FUN_007b48bc`, z40APO `FUN_007dda5a`, z41MAP `FUN_0081bcf7`, z42BRP `FUN_00831690`, z38PAR `FUN_0046ea70` (the z02LGI island table, `FUN_00490aeb` in Moreno's notes, is not a function in the dump).

Pepper (`PEP_*`, rig `MFIG`), z03PPH table (names are literal EXE strings; 102 is unused):
1 JUMPINAIR 2 JUMPSTART 3 KUNGFUKICK 4 RAILSLIDE 5 SPINRIGHT 6 SPINRIGHTCYCLE 7 SPINLEFT 8 SNEAK 9 SWIM 10 TAILGRAB 11 THROWPIZZA
12 TWOPIZZASPLAT 13 WALK 14 BOARDRIGHT 15 FRONTGRAB 16 FRONTSSALTCYCLE 17 MIDDLEGRAB 18 PANIC 19 DIVESTART 20 CLIFFSLIDE 21 DIVE
22 ONTOBOARD 23 BACKGRAB 24 BACKSSALTCYCLE 25 BOARDLEFT 26 BANGINTO 27 INTOWALK 28 OFFBOARD 29 KICKBALL 30 JUMPINAIRCYCLE
31 JUMPDOUBLETAP 32 BJUMPINAIR 33 BJUMPEND 34 BJUMPSTART 35 CRASH 36 RUN 37 OUTOFWATER 38 BITTENBEHIND 39 BRIGHTCYCLE 40 BLEFTCYCLE
41 BOARDCYCLE 42 CROUCH 43 CROUCHCYCLE 44 JUMPINTOCOPTER 45 PEDAL 46 RAILBACK 47 RAILFRONT 48 SKID 49 SPINLEFTCYCLE 50 BANGINTOONBOARD
51 CLIFFSLIDEFRONT 52 SAULTTAILGRAB 53 SAULTMIDDLEGRAB 54 SAULTFRONTGRAB 55 SMOOTHCLIFFSLIDEFRONT 56 TEETERONEDGE 57 LOOKBEHIND 58 IDLE
59 INTORUN 60 INTOSNEAK 61 COMETOSTOP 62 OVERCLIFFSLIDE 63 RUNLEFT 64 RUNRIGHT 65 TREADWATER 66 THROWPIZZARUN 67 SITTING 68 TALK
69 PUSHINTOCHAIR 70 FASTSHAKE 71 GRABPAGE 72 SHRUG 73 GESTURE 74 LGIHITROCK 75 CLIMB 76 LGISTEER 77 LGIHORN 78 LGITURBO 79 LGIWAVE
80 CRASHBACKWARDS 81 BOARDSTEER 82 BACKGRABTEST 83 CROUCHSTEER 84 HANDSTAND 85 FALLDOWNHOLE 86 STARTLED 87 JUMPEND 88 TAPONSHOULDER
89 NOD1 90 OK 91 SURPRISEDBYMUMS 92 MOONONASTICK 93 INTOCARTWHEEL 94 CARTWHEEL 95 SUPERMOVE 96 STARFISH 97 TOEINTHEWATER 98 DIVEJUMPEND
99 DIVEJUMP; other minifigs: 100 XSURPRISED 101 XDUCKPIZZA 103 XWALK 104 XWAVE ... 124 XIDLEFAST; Brickster 125 BB_CHEEKYWALK2 ... 142 BB_CRASHLANDING1A.
Island placement tables (not part of this slice) refer to these numbers: the start clip of every actor is 1, the idle of Pepper 58.

##### 1.4 Rigs found in the data

| Rig file | Bones | Chunks per file | Rig file | Bones | Chunks |
| --- | --- | --- | --- | --- | --- |
| MFIG (minifig/Pepper/NPCs/Brickster) | 17 | 4-526 | SKBD (skateboard) | 2 | 9-16 |
| RBBT (rabbit) | 14 | 5 | SWFT (swift bird) | 10 | 2 |
| PTER (pterodactyl) | 11 | 2-5 | TREX / TRIC / STEG | 21 | 6-30 / 8 / 7 |
| HORS (horse) | 28 | 11-14 | BRON (brontosaurus) | 33 | 2-10 |
| MONK | 29 | 5-6 | OCTO | 44 (z-other files) / empty in z02LGI | 0-2 |
| PRRT, PRTB (parrots), BIGB | 12 | 4-6 | SNAK (snake) | 16 | 5 |

##### 1.5 The minifig skeleton (`MFIG`, 17 bones, identical in every zone)

Parents: `-1,0,0,0,1,4,2,6,3,8,9,9,9,11,13,12,15`. Offsets from the parent (file values, before the x flip described below):
bone 0 (0, 0.87, -0.01) hips; 1 (0.41,0,0) and 2 (-0.41,0,0) children of 0 (the two legs); 3 (0, 0.45, -0.02) waist/torso; 4 (0,-0.55,0.03)
child of 1, 5 (0,-0.43,-0.04) child of 4 (leg chain 1-4-5; the other leg 2-6-7); 8 (0,0.41,0) child of 3 (chest/neck); 9 (0,0.65,0.02) child of 8
(head joint); 10 (0,0.11,0) child of 9 (top of the head); 11 (-0.66, 0.07, 0) and 12 (0.66,0.07,0) children of 9 (shoulders); 13 (0.59,0,0) child
of 11, 14 (0.37,0,0) child of 13 (arm chain 11-13-14); 15 (0.59,0,0) child of 12, 16 (0.37,0,0) child of 15 (arm chain 12-15-16).
Vertex counts of the high-res body `MFG_HR` per primary bone: 0:246 1:162 2:162 3:180 4:24 5:66 6:24 7:66 8:90 11:258 12:253 13:60 15:65; bones
**9, 10, 14, 16 own no vertices**: they are attachment points. Moreno's csm_host.gd uses **bone 14 = right hand, bone 16 = left hand** for held
props, and the island attach tables (`<prefix>_attach.tsv` rows `record, child part, bone`) put separate meshes (hair/hats/helmets: bone 9/10, held
items 14/16) on a parent's bone: **the child mesh is drawn with the parent bone's world matrix from `sampleBlk`** (child origin at bone origin).
Names of the bones are my guess from the geometry; only the hand indices are corroborated by Moreno.

##### 1.6 Evaluating a clip (`sampleBlk`) - exact conventions

Taken from the EXE player (SDAnim.c: `FUN_0043b4e2` create instance, `FUN_0043b76a`/`FUN_0043b874` advance, `FUN_0043ba7a` evaluate, `FUN_0043b987`
build matrices, `FUN_0043e43d` quaternion -> matrix, `FUN_0043e59e`/`FUN_0043e815` slerp) and proven numerically against the skin data (section 2):

* The game builds **row-vector (Direct3D) 4x4 matrices**: `local = [ R(q) | translation in row 3 ]`, `world_k = local_k x world_parent`.
  `R(q)` is the standard quaternion matrix (`1-2(y²+z²)`, `2(xy-zw)`, `2(xz+yw)` in the first row ...), which in row-vector use rotates by the
  **inverse** of q. In column-vector form (WebGL): `world_k = world_parent * [ R(q)^T | t ]`.
* `t` of bone k>0 = `(-offset.x, offset.y, offset.z)` (the `-1` is the integer constant at 0x8b1720); the root (bone 0) uses the frame's first 3
  floats with x negated. The result lives in the same space as the vertex positions of the skinned meshes (the mesh x axis is mirrored w.r.t. the file offsets).
* Time is in frames. The game advances `frame += rate * DAT_008b1718` per DRAWN frame (`FUN_0043b76a(inst, rate)` multiplies by the global itself; rate 1.0, 2.0 in a few places), and `DAT_008b1718`
  is the frame time in 1/30 s units (0.5 at 60 Hz), so a clip plays at 30 frames per second whatever the display rate (verified in the decompile, WP-TIME; the float32 accumulation is checked bit for bit
  against the emulated function at dt 1, 0.5, 0.7 and 2: `m7-pose-emu`). A non-looping clip stops at `frames-1`;
  a looping one (flag 0x10) wraps at `frames` and interpolates from the last frame to frame 0.
* Interpolation (only when the instance flag bit 2 is clear, which is the normal case): `frac = time - floor(time)`; **if `frac >= 0.1`** the root
  is lerped and the bone quaternions are slerped (shortest path) toward the next frame, otherwise the frame is used exactly (constants 0x8920cc = 0.1f).
  `sampleBlk(..., snap = 0.1)` reproduces that; the default (snap 0) interpolates always. WP-TIME: `sampleBlk` is the original's `FUN_0043ba7a` / `FUN_0043b987` / `FUN_0043e43d` / `FUN_0043e59e` step for step
  at the x87's 24 bit precision (the translation lerp `(next - cur) * f + cur`, the quaternion matrix from products of 2x, 2y, 2z, the slerp weights `sin((1 - t) w) / sin w` with the CRT acos / sin, the bone
  chain `local * parent` with `FUN_0043a9e5`), bit-exact against the emulated original over all 132 rigs (`m7-pose-emu`, tolerance 0). The frame after the last one is frame 0 whatever the loop flag says
  (`i + 1 < frames ? i + 1 : 0`). `skinPositions` / `skinNormals` follow `FUN_0088b87b` with float32 steps.

Validation: for the minifig skin `MFG_HR` + `MFIG.blk`, the primary and the additional influences of every vertex (436 records in z02LGI) land on the same
world position to **1.1e-7** at frame 0 of clip 2 (the bind pose of the minifig), and the other human/Brickster meshes (`MFG_*`, `PEPP_*`, `BB_*`, the
pterodactyl) reach 3e-8 at some clip's frame 0. With the wrong transpose or without the x flip the mismatch is 0.3 to 0.7.
For the animal rigs (swift, rabbit, dinosaurs, parrot) no frame reaches zero (best 0.007..0.13 absolute); see open questions.

---------------------------------------------------------------------------------------------------------------------------

#### 2. Skin weights in `.msh`: `SVWL` + `AVW2`

`msh.ts` keeps everything after the `SVWL` count as raw bytes (`Msh.svwl`); `parseSvwl(svwl, vertexCount)` decodes it. All 399 meshes with an `SVWL` chunk have
exactly this layout (no trailing bytes, no length mismatch):

| Part | Layout |
| --- | --- |
| per vertex (n = vertexCount, in vertex order) | `i32 bone`, `f32 weight` (8 bytes). **Primary influence.** The vertex position stored in the mesh (`VERT` chunk) is the vertex's position **in the local space of this bone** (not world/bind space). `bone = -1` (6 vertices, `bat.msh`) = not skinned, weight 1 |
| `AVW2` | char[4] tag, `u32 m` records of 24 bytes: `f32 x,y,z` (position of the vertex in the local space of `bone`), `u32 vertex`, `u32 bone`, `f32 weight`. **Additional influences**, sorted by vertex, 0 to 4 per vertex (0 records in 16 meshes such as `SkBoard`, `CATA_*`) |

* For every vertex the weights of the primary and all additional influences sum to 1.00 (error < 2e-3; checked on 382,679 vertices); a vertex has 1 to 5 influences.
* Skinning (EXE `FUN_0088b87b`, identical to `skinPositions`/`skinNormals`): `P'(v) = sum_i w_i * M_{bone_i} * local_i` with `M` the matrices of `sampleBlk`; a vertex with `bone = -1` is copied unchanged;
  the weight multiplication is skipped when it equals 1.0. **Normals** have no per-influence data: every influence rotates the vertex's own normal with its bone matrix
  (rotation part only) and the results are summed with the same weights, without renormalisation (`skinNormals`).
* Which rig belongs to a mesh is not stored: the mesh names (`MFG_*`, `PEPP_*`, `BB_*` -> `MFIG`, `SWFT`, `RBBHR` -> `RBBT`, `PTER` ...) and the placement tables decide;
  all bone indices (primary and AVW2) are below the rig's bone count.
* EXE loader: `FUN_00888d4b` @ 00888d4b (library "Graph"; a second copy `FUN_00889774` for another entry point) loads a model from `param_2` mesh files: for each file it reads `VERT` (44-byte vertices),
  `INDL`/`GRPL` ..., and `SVWL` (`u32 n` then n x 8 bytes -> array of (bone, weight)) or the older `AVWL`/`AVW2` (`u32 m` then m x 24 bytes). Parts without an `SVWL` chunk get
  **bone = index of the part in the model's mesh list, weight 1.0** for every vertex (rigid parts, attach tables). `FUN_0088b87b` is the per-frame skinning (details above). The FX_Bricks reader
  (`FUN_0044dba0`, `BrickRead.c`) skips `AVWL`/`AVW2` (24 bytes/record) and `SVWL`/`SVW2` (8 bytes/record) by size, which independently confirms the record sizes.

---------------------------------------------------------------------------------------------------------------------------

#### 3. `.man` - material/transform animation track(s) (`MATA`)

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | char[4] | `MATA` |
| 4 | u32 `tracks` | **number of interleaved objects** (1 in 162 files, 2 in `z41MAP/matanim/PLAN_Planet.man`, 4 in `z02LGI/MatAnim/hanger_building_LOD1.man`). The first guess "version" is wrong; the value is 1 for nearly everything |
| 8 | u32 `count` | nominal frame count per track |
| 12 | `frames x tracks` records of 9 x f32 (36 bytes), frame-major (frame 0 track 0, frame 0 track 1 ...) | **rotation x,y,z** (Euler, radians), **translation x,y,z**, **scale x,y,z** |

* The file stores either `count` frames per track (120 files) or `count - 1` (44 files); file size = 12 + 36 x tracks x frames, checked on all 164. The EXE has two loaders and
  they disagree on purpose: `FUN_0043ee40` (GSMS_MI.c, used by the cutscene/path code `FUN_0045d68a`) requires `tracks == 1`, reads `count - 1` records and
  treats `count` as "last frame + 1"; `FUN_0043ecd0` (also GSMS_MI.c, `.man` called from `FUN_004454e0`/`FUN_004476b0`) reads `tracks x count` records, which overruns by
  one record in the 44 short files (it takes whatever the read buffer contains). So the last frame of the 44 files is simply missing; `parseMan` exposes `frameCount` (stored) and `declaredFrames`.
* `FUN_0043ecd0` converts each record with `FUN_0043a742(M, rx, ry, rz, -tx, ty, tz, sx, sy, sz)`: **the translation x is negated**, and M (row-vector D3D, 4x4) rows are
  `(cz*cy*sx, sz*cy*sy, -sin(ry)*sz) (cz*sin(ry)*sin(rx) - sz*cx, ...)`: the upper 3x3 equals `(Rz(rz) * Ry(ry) * Rx(rx))^T` times the per-axis scale on its rows. This is `manRotationMatrix`.
  `FUN_004454e0` keeps only the translation of each record (offset 0x30..0x38 of the matrix) to build a position spline/path (progress step = 1 / count).
* Observed ranges: |rot| <= 17.1 rad (spinning objects), |trans| up to 8465, scale 0.000..6.959 (1.0 for nearly all).
* Camera tracks (`*Cam*.man`) pair with target tracks (`*Targ*.man`, `*Target*`): in the file's own space the camera looks at the target along **-Z** of
  `(Rz Ry Rx)^T` (mean cosine 0.998 for `bbCrash1Cam`, 0.961 for `brikPalaceCam1`; tested in `anim.mjs`). Medium confidence for the axis choice; the matrix itself is from the EXE.
* Sample rate: one record per game tick like the skeleton clips (assumed 30 Hz); the path code advances by `1/count` per step.

Files named `Act_*`, `Cam_*`, `bb*`, `Page*a`, `emerge*`, `spiral*` ... are the Brickster/cutscene/camera/object animations; `PLAN_Planet`/`GALA_Galaxy` are the map-screen planets.

---------------------------------------------------------------------------------------------------------------------------

#### 4. `.anm` - packed rotation clip (`z21FSH/anim/RODD_Swish.anm`, 1572 bytes)

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | version = 1 |
| 4 | u32 | bones = 10 |
| 8 | u32 | frames = 30 |
| 12 | u32[frames x (3 + bones)] | per frame: 3 root words (all 0 in this file), then one word per bone |

Bone word: three **signed 10-bit angles in 1/1024 of a turn** (2pi/1024 = 0.00614 rad per step): bits 0-9 = rotation about Z, bits 10-19 = about Y (never non-zero in this file, assignment assumed),
bits 20-29 = about X, bits 30-31 unused. Verified against the sibling `RODD_Swish.blk` (same rod, 10 bones, 30 frames): the quaternion `Qx(f2) * Qy(f1) * Qz(f0)` equals the `.blk` quaternion
with 1 - |dot| <= 4.7e-6 over all 300 bones (quantisation by truncation toward zero). The fishing rod uses -512 (= 180 deg) on X for bones 6 and 7. Not referenced by the EXE (no ".anm" string): a leftover of an earlier
exporter; the `.blk` is what the game loads.

---------------------------------------------------------------------------------------------------------------------------

#### 5. `.cam` - static camera (`CAMA`, 32 bytes, 141 files)

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | char[4] | `CAMA` |
| 4 | u32 | version = 1 |
| 8 | f32[3] | eye position |
| 20 | f32[3] | look point = eye + 1 unit of view direction (distance to the eye 0.99996..1.00038) |

Files are the editor's views: `front`, `persp`, `persp1`, `side`, `top`, `camera1`, `tocamputer` per zone `camera/` folder (front looks along +Z, top along -Y, side along +X in file coordinates). The EXE has no "CAMA"
string and no ".cam" string: unused by the game (the in-game cameras are `.man` tracks and code).

---------------------------------------------------------------------------------------------------------------------------

#### EXE functions (decompiled `LE2.c`, `LE2.done` present: 4,895 functions)

| What | Function |
| --- | --- |
| .blk loader (ABLK + offset-table variant, SDAnim.c) | `FUN_0043b1ff` @ 0043b1ff; free `FUN_0043b48f` |
| anim instance create/free/set clip/set time/length | `FUN_0043b4e2`, `FUN_0043b611`, `FUN_0043b6a3`, `FUN_0043b64d`, `FUN_0043b72b`, `FUN_0043b73f`, `FUN_0043b753` |
| advance (loop flag 0x10) | `FUN_0043b76a`, `FUN_0043b874`, `FUN_0043b92a` |
| evaluate to bone matrices | `FUN_0043ba7a`, `FUN_0043b987`, `FUN_0043bcaf` |
| quaternion -> matrix / slerp | `FUN_0043e43d`, `FUN_0043e59e`, `FUN_0043e815` |
| .man loaders (GSMS_MI.c) | `FUN_0043ecd0` (matrices), `FUN_0043ee40` (raw records, tracks==1), callers `FUN_004454e0`, `FUN_004476b0`, `FUN_0045d68a` |
| Euler + scale -> matrix | `FUN_0043a742` |
| clip name tables | `FUN_0045bff4` (registers name, clip number) called from the zone loaders listed in 1.3 |
| skin tags in the brick reader | `FUN_0044dba0` (skips SVWL/SVW2/AVWL/AVW2) |
| skinned model loader / skinning | `FUN_00888d4b`, `FUN_00889774` (load VERT/INDL/GRPL/SVWL/AVW2), `FUN_0088b87b` (skin positions+normals by bone matrices) |

#### Open questions

* Meaning of clip flag bit 0x08 (146 chunks) and of the unused middle angle axis of `.anm`.
* The animal rigs (`SWFT`, `RBBT`, `TREX`, `PRRT`...) do not reach a zero mismatch between primary and additional influences at any frame (best 0.007-0.13 absolute). For the
  swift the relation of the two local spaces is an exact affine map with a **uniform scale 0.729** between the primary and additional influences (bone 0 to bones 1/2/3), so these rigs apparently have a
  per-model scale or bone scale that is not in the .blk (maybe in the model INI, or a flag in the skin data). Human, Brickster and pterodactyl meshes are exact (1e-8).
* The decompiled player takes the rate (frames per tick) as an argument; 30 Hz is Moreno's figure, not confirmed in the EXE.
* `.man` rotation order is exact from the EXE, but how the game combines the matrix with the camera/target (view vs world) was only confirmed empirically.
* Names of the minifig bones other than the two hands (14, 16) are interpretations.

#### References

* Moreno.LegoIsland2 `scripts/core/blk_file.gd` (ABLK chunk/ASKL layout, quaternion stride, bone records, x flip), `scripts/core/skinned_mesh.gd`, `scripts/core/mesh_file.gd` (SVWL bone+weight pairs, no AVW2),
  `scripts/game/island.gd` (clip numbers = loader indices, attach tables, flag 0x10 loops), `csm_host.gd` (hand bones 14/16). Re-implemented from the data and the EXE; no code copied.
* The data and the Ghidra decompilation of LE2.EXE (`/Users/sander/Documents/basdebeer-tools/decomp-le2/LE2.c`) are the authority.

### 8.3 Scripts, text and small configuration formats (`.cut` `.txt` `.str` `.wpt` `.lgt` `.par` `.gob` `.fnt` ... and the contents of the small archives)

Scope of this fragment: cutscene scripts (`.txt` source + `.cut` compiled), message files (`.str`), `TEXT` texture option lists
(`.opt` / `.txl`), `MATL` (`.mtl`), `SRCL` (`.src`), `.gob`, lights (`.lgt`), waypoints (`_C.wpt`, `WPTP` `.way`/`.wpt`, `.h`, `.wbt`),
particle definitions (`.par` `.app` `.emi` `.mov` `.swl`), bitmap fonts (`.fnt`), brick model text (`BrickMorph/*.txt`,
`Bricks/brickset.txt`), the remaining `.txt` notes, and a description of the contents of the small archives
(`menu`, `Overlays`, `GENERICBITS`, `SwapText`, `messages`, `BrickMorph`, `Fonts`, `Shadow`, `Bricks`).

All numbers are little endian. Parsers: `src/formats/cutscene.ts`, `text.ts`, `waypoints.ts`, `lights.ts`, `particles.ts`, `fonts.ts`.
Tests: `tools/tests/cutscene.mjs`, `text.mjs`, `waypoints.mjs`, `particles.mjs` (all pass with 0 failures on the 39 archives;
`node tools/test-formats.mjs --only cutscene,text,waypoints,particles`).

EXE loader names are the Ghidra names of `LE2.EXE` (`FUN_xxxxxxxx` = address, from `LE2.c`, decompilation complete).
Source files named in the EXE's assert strings: `C:\projects\LegoIsland2\COMMON\CSM\c_src\Manager.c` (cutscene manager),
`ms\GSMS\c_src\*` (message/texture lists), `ms\Graph\c_src\*` (textures, fonts, lights), `ms\FX_Particles\c_src\*`, `ms\FX_Bricks\c_src\*`,
`COMMON\c_src\W*.c` (waypoints).

#### 0. Overview

| Format | Files | Where | Loader in EXE | Confidence |
| --- | --- | --- | --- | --- |
| `Cutscene/*.txt` (source script) | 139 (87 with `.cut`) | `z02LGI`(96) `z07CSI`(19) `z40OGL`(7) `z16PYA`(4) `z23DIP`(4) `z28HAT`(3) `z14OSD`(3) `z21FSH`(2) `z42BRP`(1) | text->binary compiler `FUN_00459c46` / `FUN_00459fc6` | high (compiler port reproduces 86/87 `.cut` byte for byte) |
| `.cut` (compiled script) | 87 | same zones as the `.txt` | `FUN_0045d68a` (runtime), scheduler `FUN_00459119`/`FUN_00459597` | high |
| `.str` (message scripts) | 166 (2 empty) + `z27TRX/messages/english/english.txt` | `messages` archive, `z38PAR`, `z40aPO` | tag-file loader `FUN_00439126`, lookup `FUN_004396a0`, expand `FUN_004397b9`, text+voice `FUN_00439bf8` | high |
| `TEXT` `.opt` / `.txl` | 60 / 32 | per texture directory | `FUN_00442e80` -> `FUN_004100a1` | high (structure), medium (flag bit 2) |
| `MATL` `.mtl` | 4 | `z03PPH z13CAI z21FSH z28HAT` `material/Mat.mtl` | none (not referenced by the EXE) | high (only empty lists exist) |
| `SRCL` `.src` | 73 | `source/particle.src`, `sound.src` in every zone, 15 more in `z22BIP` | none (not referenced by the EXE) | medium (field meaning) |
| `.gob` | 4 | `z01BPK`, `z03PPH` `chars/` | none (editor/tool descriptor) | high (text) |
| `LGTL` `.lgt` | 30 + 8 editor variants | `lights/lights.lgt` per zone | `FUN_008864b6` + `FUN_008849c6` | high (layout), medium (some fields) |
| compiled waypoints `W_<MAP>_C.wpt` | 30 (4 in `backup/`) | `z02LGI z07CSI z08BKD z13CAI z14OSD z16PYA z21FSH z23DIP z28HAT z40OGL z40aPO z42BRP` | `FUN_004630c0` (route lookup `FUN_00448049`) | high |
| `WPTP` `.way`/`.wpt` (editor) | 48 | same zones + `z03PPH z10RGB` | none (waypoint editor; source of `_C.wpt`) | high |
| `aW_<MAP>_.h` | 19 | zone `waypoints/` dirs | none (C headers for the original game code) | high |
| `.wbt` | 3 | `z02LGI z07CSI z21FSH` | none (build list of the waypoint compiler) | high |
| `.par` `.app` `.emi` `.mov` | 99 / 101 / 98 / 96 | zone `particle/` dirs + `GENERICBITS/Particle` | `FUN_00450e20` (.par), `FUN_00450250` (.app), `FUN_00450640` (.mov), `FUN_004509b0` (.emi), actions `FUN_00455750` | high (text grammar), medium (parameter semantics) |
| `.swl` | 4 | `z02LGI`(2) `z10RGB` `z05WAB` | CParticleSwirl (not traced) | medium |
| `.fnt` | 2 | `Fonts` archive | `FUN_00413af1` | high |
| brick models `BrickMorph/*.txt` | 96 | `BrickMorph` archive | `FUN_0044d570` | high |
| `Bricks/brickset.txt` | 1 | `Bricks` archive | loop in `FUN_0044a5e0` | high |
| other `.txt` | 8 | see section 11 | none | n/a |

#### 1. Cutscene scripts

##### 1.1 What they are and how they map to the game

A cutscene is a list of commands for actors (Pepper, Brickster, the camera, switches ...). Actors are addressed by a 4-character code
(`PEPP`, `CMRA` = camera, `SWCH` = game switch, `BRIK` = Brickster, `INFO`, `PAPA`, `MAMA`, `BILL`, `HOLO` ...).
The cutscene manager (`Manager.c`) opens `<root>\<zone>\cutscene\<name>.txt` (`FUN_0045c397`) and the matching message file
`messages\<AREA>\Data\<name>.str` (area code `LI`, `CI`, `AI`, `OG`, `FE`; the `SayText` ids are looked up there: 420 of 430 SayText ids of scripts that have a
same-named `.str` resolve in it, 688/688 resolve in some `.str`).
`FUN_00459c46(path)` first tries to open the sibling `<name>.cut`; **only if it does not exist** does it compile the `.txt` to a `.cut`
(`FUN_00459fc6`) and use that. So the shipped `.cut` files are the compiled cache of the `.txt` files; the 52 `.txt` without `.cut` are 46 `*psx.txt`
(PlayStation variants, never loaded on PC) and 6 unused stubs (`lgibi01-04`, `Test`, `csi03` = a one line comment "NO LONGER USED").

##### 1.2 Source text (`.txt`)

CRLF text. The whole file is upper-cased before parsing (case does not matter; the `.cut` stores upper case).

```
[HEADER]
CSMSCRIPTVERSION<TAB>0
SCRIPTENAME<TAB><TAB>PhoneRings          <- name token (positional: the game does not check the keyword; adv09.txt has SCRIPTNAME)

[SCRIPT]
<wait>  <delay>  <actor>  <command>  <args...>
```

The three header lines are read positionally; the first script line is the line after the line containing `[SCRIPT]`.
Empty lines and lines starting with `//` are skipped. A script line is scanned with `sscanf("%i %f %s %s ...")`:

| Field | Type | Meaning |
| --- | --- | --- |
| wait | int (`%i`: decimal/0x/octal) | dependency id: the command starts when no command that **signals** this id is still running; `0` = start immediately. NOT a time. Compiled to u16 at body+8. |
| delay | float | delay in seconds (counted down by 1/30 s per frame, `0.0333 * DAT_008b1718`) after the wait condition is released. body+0x0c |
| actor | word | 4-char actor code (first 4 chars used). |
| command | word | see catalogue 1.5. |
| args | words | per command; some commands accept a trailing `<signalId> [<duration>]`. |

The optional trailing `<signalId>` (int, stored u16 at body+10) is the id this command signals when it finishes (`SayText LECSPP02 10` ends and releases everything waiting for id 10);
`<duration>` (float, body+0x10, seconds) is used by moves and SayText. Example (`PhoneRings`, lgi01):

```
0   0.0  swch  setswitch   SWITCH_GME_RADIO_SIGNAL 1
0   0.0  cmra  setposition actor pepp front        <- camera placed in front of Pepper
0   0.0  cmra  follow      actor Pepp
0   0.0  pepp  SayText     LECSPP02 10             <- says text LECSPP02, signals id 10
10  0.0  cmra  Settarget   actor Pepp              <- starts when id 10 is released
10  0.0  papa  SayText     LECSPP03 20
```

Parser: `parseCutsceneText()`. 5006 script lines in the 139 files, 0 rejected.

##### 1.3 Compiled form (`.cut`)

```
u32  nameLen                      (strlen+1)
char name[nameLen]                upper-cased SCRIPTENAME, NUL terminated
u32  version                      always 4
u32  lineCount                    number of non-blank, non-comment script lines (>= number of records)
repeat (records, one per accepted script line, in file order):
    u32  cmd                      command id 0..15 (table 1.5)
    char actor[4]                 actor code, upper case, no NUL (shorter names carry stack garbage in the original)
    u8   body[N]                  N = per command (table 1.5); body[0..4] = cmd again
    s32  trailer0, trailer1       compiler leftovers = trunc(delay*4096), trunc(duration*4096); ignored by the loader
    <command specific tail>       string = u32 len (incl. NUL) + chars; or 4 raw chars (actor code)
u32  splineNameCount
repeat: u32 len, char[len]        PSXSPLINE point names (informational; the PC loader reads and discards them)
```

`lineCount` is the number of lines, not records: lines the compiler rejects ("Error converting cut scene": wrong parameter count, unknown bone, SETEXPRESSION >= 16, ...) produce no record, and
`WAV`/`MIDI` lines (id 9) are never emitted. 27 of the 87 files have `lineCount` = records + 1..3 (all `lgiph*`, `lgibr*`, `lgi04`, `lgi09`, `csi02`, `csi02a`; the rejected lines are the malformed
`SETTARGET`/`SETPOSITION` lines without a target kind). The runtime loader `FUN_0045d68a` reads exactly `lineCount` records: after the real records it reads the first u32 of the spline table as a
command id and the next 4 bytes as an actor code; an unknown actor makes it stop (`break`, the spline name table is then not read; the unread slots stay zeroed = no-op commands). This is read from the
code, not observed at run time. The TS parser reads records until the first position that is not a record (`cmd <= 15` and `body[0..4] == cmd`), then the spline table, and requires 0 trailing bytes: all 87 files parse exactly.

Body layout (offsets inside `body`, i.e. after the 4 actor chars; runtime struct is 0x70 bytes per command):

| Off | Type | Name | Notes |
| --- | --- | --- | --- |
| 0x00 | u32 | cmd | |
| 0x04 | u32 | state | runtime: 0 pending, 1 running, 2 done->3 |
| 0x08 | u16 | waitId | start when counter[waitId] == 0 (counter[id] = number of unfinished commands whose signalId == id; built by `FUN_00458c15`) |
| 0x0a | u16 | signalId | decremented when the command finishes (`FUN_00459618`) |
| 0x0c | f32 | delay | seconds; copy at 0x1c is used to re-arm on restart |
| 0x10 | f32 | duration | seconds (moves: remaining time; SayText: extra display time); copy at 0x20 |
| 0x14 | ptr | actor | runtime (resolved actor pointer; 0 in file) |
| 0x18 | u8 | started | runtime |
| 0x24.. | | args | per command (table) |

Observed: waitId/signalId 0..51 (ids are per script and reused), delay 0..4 s (0.1 steps), duration 0..9 s.

##### 1.4 Execution model (from `FUN_00459119`, `FUN_00459597`)

Every frame: (1) every pending command (state 0) whose `counter[waitId] == 0` becomes running and its actor is registered; (2) every running command runs while `delay > 0`
(delay counts down 1/30 per frame), then its handler (`FUN_0045c49d` actor commands, `FUN_0045eaf0` camera/switch commands (`actor` pointer == 0)) is called every frame; it
returns 1 (still running) or 2 (done); (3) done commands decrement `counter[signalId]`. The script ends when all commands are done. Commands whose actor has no object (`SWCH`, `CMRA`) are "global" commands.

##### 1.5 Command table (ids from `FUN_0045988b`, body sizes from the compiler/loader) and field layout

Arg words are those of the `.txt` after the command word. "tail" = bytes after the 8 trailer bytes.

| id | Command | body size | Text args | body fields | tail | Runtime effect |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `SETVISIBILITY` | 0x28 | `true`/`false` (only the first 2 letters `TR` are tested) | u32@0x24 = 1/0 | - | sets/clears hidden flag (bit 1 of actor+0x60) |
| 1 | `SETANIM` | 0x30 | `<anim> [<signalId> [<duration>]]` | | len-string anim name (e.g. `XIDLE`, `XTALK`, `PEP_HANDSPIZZA1`) | plays animation, running until it finishes (anim ids resolved by name in the actor's animation table; unknown names are looked up as `FUN_0045c144` -1) |
| 2 | `SAYTEXT` | 0x3c | `<textId> [<signalId> [<duration>]]` | u8@0x24 = len+1 | len-string text id (`LECSPP02`) | looks the id up in the script's `.str` (`FUN_004396a0`): text shown as up to 4 subtitle lines (`FUN_0045d47f`), voice sample id = the 4-char field of the `.str` entry, played with `FUN_00435a11`; mouth animation random while talking; duration = (len + 20 + duration)/20 s |
| 3 | `SETTARGET` | 0x38 | `WAYPOINT <name>` / `ACTOR <code>` | u8@0x24 kind (0 waypoint, 1 actor, 2 spline) | waypoint: len-string; actor: 4 chars | camera look-at point, or turns an actor to face the target |
| 4 | `MOVETARGET` | 0x70 | `<kind> <name> [<signalId> [<duration>]]` (+ `PSXSPLINE n1 n2..` after a spline path) | u8@0x24 kind | waypoint: len-string; actor: 4 chars; spline: len-string (`.man` path, e.g. `z02lgi\matanim\pHel_flight1.man`) + u32 first + u32 count (indices into the trailing spline-name table; 12/0 or 12/15 are carry-over garbage from the compiler's globals) | moves the look-at target along the waypoint path / a MatAnim spline |
| 5 | `SETPOSITION` | 0x38 | `WAYPOINT <name>` / `ACTOR <code> [FRONT|BEHIND|LSIDE|RSIDE]` | u8@0x24 kind; u32@0x2c side 0 none, 1 front, 2 behind, 3 left side, 4 right side | as `SETTARGET` | puts an actor or the camera at a waypoint or relative to another actor |
| 6 | `MOVEPOSITION` | 0x70 | as `MOVETARGET` | as 4 | as 4 | moves along a waypoint path or `.man` spline |
| 7 | `FOLLOW` | 0x2c | `<actorCode> [<signalId> [<duration>]]` | | 4 chars | camera/actor follows another actor |
| 8 | `SETSWITCH` | 0x2c | `<SWITCH_NAME> <value> [<signalId> [<duration>]]` | s32@0x28 = value | len-string switch name | sets a global script switch (name -> id table built at start-up, `FUN_0045c144`; the `SWITCH_*` names are in the zone code) |
| 9 | `WAV` / `MIDI` | 0x38 | not compiled | s32@0x2c mode | mode 0: len-string; else 4 chars | sound hook (`FUN_0045f702`); no shipped script uses it |
| 10 | `SETMOVESPEED` | 0x28 | `<a> <b>` (ints, 0 -> 1) | u16@0x24 = a, u16@0x26 = b | - | camera position smoothing: `0.1*a`, `0.02*b` (defaults a=b=4) |
| 11 | `SETTARGETSPEED` | 0x28 | `<a> <b>` | as 10 | - | same for the camera target |
| 12 | `SETFOV` | 0x28 | `<fov>` (float, clamped to >= 0.01) | f32@0x24 | - | camera field of view (0.1 .. 1.4 in the data; radians) |
| 13 | `SETEXPRESSION` | 0x28 | `<n>` 0..15 (also named: HAPPY 10, SAD 12, ANGRY 11, AFRAID 13, SPECIAL1 14, SPECIAL2 15) | u8@0x24 | - | face expression index |
| 14 | `ATTACH` | 0x2c | `<bone> <actorCode>` bone: `GOB`(0) `RIGHTHAND`(14) `LEFTHAND`(16) | s32@0x28 bone id | 4 chars (the actor attached) | attaches an object to a bone of the actor |
| 15 | `ENABLEAI` | 0x28 | `true`/`false` | u32@0x24 | - | enables/disables the actor's AI |

`SETEXPRESSION` words listed in the EXE table (`HAPPY`, `ANGRY`, ...) are not used by the compiler (it reads `%i`); the numeric form is what occurs.
`SETMOVESPEED`/`SETTARGETSPEED` words `SLOW`/`MED`/`FAST` also exist in a table but are not parsed by the compiler either.

##### 1.6 Command / argument-shape catalogue (all 139 `.txt`, 5006 lines; counts = script lines)

| Command | lines | files | Argument shapes (count) |
| --- | --- | --- | --- |
| SETANIM | 1085 | 105 | `<anim>` 841; `<anim> <signalId>` 213; `<anim> <signalId> <duration>` 31 |
| SETPOSITION | 697 | 130 | `WAYPOINT <name>` 430; `ACTOR <code> FRONT|BEHIND|LSIDE|RSIDE` 229; `ACTOR <code> HEAD` 26 (side 0); `ACTOR <code>` 9; `WAYPOINT <name> <n>` 2; malformed (missing kind) 1 |
| SAYTEXT | 688 | 103 | `<textId> <signalId>` 646; `<textId>` 42 |
| SETVISIBILITY | 554 | 95 | `<bool>` 554 |
| FOLLOW | 548 | 116 | `<actor>` 413; `<actor> <signalId>` 127; `ACTOR <actor>` 6; `ACTOR <actor> <signalId>` 2 (the `ACTOR` keyword is taken as the actor code `ACTO` in these 8 lines) |
| SETTARGET | 399 | 98 | `ACTOR <code>` 303; `WAYPOINT <name>` 63; malformed (kind missing) 31; with extra number 2 |
| SETSWITCH | 363 | 72 | `<name> <value>` 299; `<name> <value> <n> <n>` 60 and `<name> <value> <n>` 4 (trailing `<signalId> [<duration>]`) |
| SETFOV | 185 | 44 | `<fov>` 185 |
| MOVEPOSITION | 140 | 32 | `WAYPOINT <name> <signalId> [<duration>]` 56; `WAYPOINT <name>` 8; `SPLINE <path.man> [<signalId>] PSXSPLINE [names...]` 75 (56 with only `<signalId>`); `SPLINE <signalId> PSXSPLINE n1 n2` 1 (path missing: malformed) |
| SETEXPRESSION | 127 | 29 | `<n>` 127 |
| MOVETARGET | 81 | 38 | `ACTOR <code> [<signalId> [<duration>]]` 56 (45 with only `<signalId>`); `WAYPOINT <name> [<signalId>]` 14; `SPLINE <path.man> [<signalId>] PSXSPLINE [names...]` 11 |
| ATTACH | 70 | 23 | `<bone> <actor>` 70 |
| SETTARGETSPEED | 32 | 18 | `<a> <b>` 32 |
| SETMOVESPEED | 29 | 19 | `<a> <b>` 29 |
| ENABLEAI | 8 | 4 | `<bool>` 8 |

Binary records per command (87 `.cut`): SETANIM 840, SETPOSITION 487, SAYTEXT 457, FOLLOW 404, SETVISIBILITY 402, SETSWITCH 256, SETTARGET 234,
SETFOV 177, SETEXPRESSION 124, MOVEPOSITION 110, ATTACH 58, MOVETARGET 57, SETTARGETSPEED 32, SETMOVESPEED 29, ENABLEAI 8 (total 3,675). The difference to the
text counts is the PSX-only scripts and the lines the compiler rejects.
Most common actor codes (`.cut`): `CMRA` 948, `PEPP` 564, `SWCH` 256, `INFO` 156, `BILL` 148, `BRIK` 117, `PAPA` 66, `JTHN` 58, `MAMA` 52, `HOLO` 50, `DRKL` 49 ...
Most common animations: `XIDLE` 191, `XTALK` 123, `XTALK3` 100, `XHAPPYJUMP` 30, `XWATCHDECON02` 29, `PEP_HANDSPIZZA1/2` 24 each, `HORS_IDLE` 17.
Distinct switch names: 92 (`SWITCH_LGI_CSM_FX_SWITCH05` 49x, `SWITCH_GME_BLDG_PHSE` 11, `SWITCH_GME_CSM_SFX1..30`, `SWITCH_LGI_BRICKFX_<BUILDING>`, ...).

##### 1.7 How the two forms correspond (verified)

`compileCutscene(text)` in `cutscene.ts` is a port of `FUN_00459fc6`. For all 87 `.txt` with a `.cut` the output is **byte-identical** except `lgici06` (86/87):
the `.cut` header name there has trailing heap-fill bytes (`fd fd fd fd dd 71`) because its `.txt` has no final newline and the original read the name past the end of the buffer. Two quirks reproduced:
* PSXSPLINE: tokens after `PSXSPLINE` are appended to the end-of-file name table when there are >= 2 of them; the record stores `(first, total)` = (start of this list, size of the table after adding it). `first` is a process
  global in the original and keeps its last value across lines/files (12 in `lgi09`, `lgi13`, `ogl03`), the compiler port takes it as an option.
* Header: the script name is the third token of line 3 regardless of the keyword (`SCRIPTNAME` vs `SCRIPTENAME`).

Unknown: semantic of `duration` for `SETANIM`/`FOLLOW`. Side words: `HEAD` (0, 26 lines: camera at the actor's head), `FRONT` 1, `BEHIND` 2, `LSIDE` 3, `RSIDE` 4; a missing word gives 0 too.

#### 2. Message files (`.str`) and the tag-file loader

`messages/<AREA>/Data/<NAME>.str` (AREA: `FE` front end 6 files, `LI` 92, `CI` 24, `AI` 31, `OG` 11) plus `z38PAR/Messages/English/PARSTR.str`,
`z40aPO/Messages/English/APOSTR.str`; `z27TRX/messages/english/english.txt` is the same tag format without the id field. `messages/Dutch.txt` is an empty (0 byte) marker.
The game language is Dutch in this release: all text is Dutch. Cutscene `X` uses `messages/<AREA>/Data/X.str` (see 1.1).

Loader `FUN_00439126` (generic "tag file", also used for `Credits.str`, ...): file read whole; a line starts a tag when its first byte is >= 0x20 and is not `#`; the tag runs to the first `:`;
the value is the rest of the line (bytes < 0x20 end it; `#` lines are comments; a line without `:` is dropped). Tags are then bubble-sorted with `strcmp` and looked up by binary search
(`FUN_004396a0`, case sensitive, upper case in all files). **Duplicate tags** exist (14 inside a file); the binary search returns whichever it hits.

`.str` entries: `TAG:` + 4-character field + text.

| Part | Layout |
| --- | --- |
| tag | e.g. `LECSPP02`, `CACSBR01`, `SGGOLD`; <= 16 chars, `[A-Za-z0-9_]` |
| id field | exactly 4 characters after `:`, a decimal int (`-1` or `775`) space padded: **voice sample id** (0..1868; LI 0..1032, CI 1033..1391, AI 1392..1635, OG 1636..1729, FE 775..777, PARSTR 761..774, APOSTR 1816..1868; -1 = none). `FUN_00439bf8` parses it into the SayText body (+0x2c) and `FUN_00435a11` plays that sample. |
| text | the rest of the line (`lookup` returns value+4) |

Text post-processing (`FUN_004397b9`): `\n` newline, `\t` tab, `\\` backslash; `$$` `%%` `&&` literal `$ % &`; `$x` / `%x` / `&x` followed by a parameter char are
substitution placeholders (none in the data except `&&` x2); bytes >= 0xE0 are folded to upper case (-0x20), i.e. the font only has capital accented letters. Text is Latin-1.
Tag naming convention (not parsed by the game): 2 letters area (`LE` Lego Island, `CA` castle island, `AD` adventurers', `OG` Ogel ...), 2 letters kind (`CS` cutscene, `SG` speech/game, `IN` info),
2 letters speaker (`PP` Pepper, `BR` Brickster ...) + 2 digit sequence; most frequent prefixes `LECS` 179, `FREC` 133 (front end credits), `CONT` 115 (controls), `ADSG` 104, `ADCS` 95, `OGSG` 85, `LEIN` 83, `CACS` 71, `LESG` 48, `CASG` 41, `HOLO` 41.
Totals: 2402 entries, 1412 distinct tags, 1743 distinct sound ids. Parser: `parseStr()`, `parseTagFile()`, `decodeMessage()`. Confidence high.

#### 3. `TEXT` option lists (`.opt` and `.txl`)

Used in every directory that has numbered textures: `Text.opt` next to `Text000.tga ...` (`menu/mOverlays`, `Overlays/<ZONE>`, `GENERICBITS/Particle`, `Bricks`, ...) and
`textures/text.txl` of every zone, `SwapText/text.txl`, `Shadow/text.txl`. Identical format (`.txl` = texture list of a zone, `.opt` = of a UI/particle set).

| Off | Type | Meaning |
| --- | --- | --- |
| 0 | char[4] | `TEXT` |
| 4 | u32 | count (number of textures `Text000.tga .. Text(count-1).tga`; names `Text%d` zero padded to 3 digits; `.wib` instead of `.tga` is accepted by the texture loader) |
| 8 | u8[] | one option byte per texture |

Loader `FUN_00442e80(dir, "Text.opt"|"Text.txl")`: reads chunks (tag, count, bytes) until EOF (reads the byte array with `count` single-byte `fread`s whose result is not checked), builds the file names and
hands `(count, names, flags)` to the texture manager (`FUN_00411c86` -> `FUN_004100a1`, the TGA loader). Flags (`FUN_004100a1`, param 3):

| Bit | Value | Meaning |
| --- | --- | --- |
| 0 | 0x01 | wrap in U (else clamp) |
| 1 | 0x02 | wrap in V (else clamp) |
| 2 | 0x04 | stored in the texture record (+0x84), use not traced; seen with bit 0/1 (values 4, 5, 7) |
| 7 | 0x80 | keep full resolution (otherwise the texture is halved while loading when not in high-detail mode) |

Observed values: 0x0 530x, 0x1 3x, 0x3 2805x, 0x4 314x, 0x5 16x, 0x7 1297x (so "wrap both" 3 is the default, 0 = clamp both, 7 = wrap both + bit 2).
**Quirk:** the number of flag bytes is not always `count`: in all zone `.txl` it is `count - 1` (the last texture has no flag byte: the failed read leaves the zero-initialised value, 0 = clamp),
in `Overlays` `.opt` 12 bytes for 2..8 textures, `menu/mOverlays` 80 for 72, `Shadow` 7 for 9, `Bricks` 3 for 1. All textures `Text000..Text(count-1)` exist in the same directory in every file (checked), except
the `Overlays/*/Save/text.opt` artist backups (named textures). Confidence high.

#### 4. `MATL` (`.mtl`) and `SRCL` (`.src`)

Not referenced by the EXE (editor leftovers).

`.mtl`: `MATL` + u32 count, **always 0** (8 bytes; `z03PPH z13CAI z21FSH z28HAT` `material/Mat.mtl`). Records unknown (never present).

`.src`: `SRCL` + u32 count, then `count` x 24 bytes: `f32 x,y,z` (position), `f32 dx,dy,dz` (direction: `-0.0, 0, 0` in all 30 points). `source/particle.src` and `source/sound.src` exist in every zone and are
empty (count 0, 8 bytes); `z22BIP` has `DTH1..DTH13`, `runwaystart`, `runwayend` with 2 points each (30 points; positions along the runway: x -690..+450, y ~38..115, z ~ 100..2000).
Meaning "source point list for particle/sound/path emitters" is inferred from the names. Confidence: layout high, meaning low.

#### 5. `.gob`

Text descriptor of a game object, no EXE loader (tool output; the object itself is a mesh + collision + textures in the zone archive):

```
GOB <ZONE3> <Name>
pos x y z
rot x y z            (degrees)
LODs 1
LOD <i> <mesh.msh> <distance>
Groups n
Group <i> <texture.tga>      (n lines; i = mesh group index)
Col <name.col>
```

4 files (`z01BPK/chars/Piz2.gob`, `z03PPH/chars/{Interior,Plaque,Receiver}.gob`); all referenced `meshes/<mesh>` and `col/<col>` exist; `Group i` assigns the texture of mesh group i (`mStud_blue.tga` ... the
`m` prefix = brick material textures). Parser `parseGob()`. Confidence high.

#### 6. Lights (`lights/lights.lgt`, magic `LGTL`)

30 zone files + 8 editor variants (`z40OGL`: `.original`, `_set1_1point-red`, `_set2_lots of pointlamps_amb1_dir.5`, `_set3_lotsofpoint_amb.1_dir1`, `_pos2`; `z40aPO`: `.original`, `_test1`, `.test3`).
The game loads `lights.lgt` only. Loader `FUN_008864b6`: reads `LGTL`, `u32 count`, then `count` records of 0x58 bytes with `fread` (records missing at the end of the file read as zeros) and builds runtime lights (`FUN_008849c6`);
`FUN_00884f68` evaluates them for software vertex lighting (diffuse term `max(0, -N.dir)`).

| Off | Type | Name | Notes |
| --- | --- | --- | --- |
| 0 | u32 | type | 0 = point (runtime type 2), 2 = directional / sun (runtime type 1), 1 = point too (never seen) |
| 4 | f32 | a | 0.5 in all 180 records |
| 8 | f32 | b | 0.5 in all |
| 0x0c | f32 | range | 1000 .. 60000; **not used** by the loader (runtime point radius is fixed at 60.0) |
| 0x10 | f32[3] | position | point lights (directional: 0,0,0) |
| 0x1c | f32[3] | direction | directional: unit vector, y component forced >= 0 by the loader; point: (0,1,0) |
| 0x28 | f32[3] + f32 pad | ambient colour | 0..1; the runtime ambient light is the per-channel **max** over all records |
| 0x38 | f32[3] + f32 pad | diffuse colour | used as light colour |
| 0x48 | f32[3] + f32 pad | specular colour | usually equal to diffuse; pad floats are 0 |

Header word at +4 is the loader's record count; the files contain fewer records than declared (`declared - 1` in most, up to `declared - 4` in `z03PPH`/`z07CSI`: 43 records in total are
absent and read as black point lights at the origin). The loader additionally drops the last record if its type is > 2 or < 0. 180 records in 38 files: 142 point, 38 directional (at most 1 sun per file).
Confidence: layout high (matches the loader's copies), colour slot naming medium.

#### 7. Waypoints

##### 7.1 Compiled `W_<MAP>_C.wpt` (loaded by the game, `FUN_004630c0(slot, "_Data\<zone>\Waypoints\W_<MAP>")`)

Slots: 0 `ROAD`, 1 `PATH`, 2 `CSM` (camera/cutscene positions), 3 `OTH`. Waypoint names in cutscenes are looked up in slot 2, then 1 (`FUN_00462b4e`).

```
s32 magic = -1
s32 version = 5
s32 zero
s32 nodeCount
s32 edgeCount           number of route matrices (0 for CSM files)
node[nodeCount]   32 bytes:
    f32 x, y, z               game coordinates (the editor x is NEGATED by the compiler; y, z unchanged)
    s16 group                 route group (= editor class - 1; -1 = not routed)
    s16 index                 index of the node inside its group (0.. in order)
    u8  kind                  0xff on CSM (camera) nodes; 1/2/4/8 on path/road nodes (Moreno: 1/2/4 mark crossings and links; unverified)
    u8  mask                  0x3f (editor flags) on CSM nodes; 0xff / 0x00 / 0x01 on path/road nodes
    s16 link                  index of a linked node (4 nodes in the data) or -1
    u8  runtime[12]           zero
matrixDesc[edgeCount]  16 bytes: s32 w, s32 h, u32 runtime pointer, u32 pad
matrix[edgeCount]: w*h x s16 next-hop table (rows = nodes of group g, columns = the h nodes of the same group followed by one column per group)
u32 nameBlobSize
u32 nameOffset[nodeCount]
char blob[nameBlobSize]  NUL terminated upper-case names (empty for unnamed path nodes)
```

`w = h + edgeCount` and `h` = number of nodes in the group (checked for all 67 matrices). `nextHop(a, b)` = `m[g(a)].hops[index(a) * w + (g(a)==g(b) ? index(b) : g(b) + h)]`
(`FUN_00448049`, port in `waypoints.ts` after Moreno.LegoIsland2 `waypoints.gd`, independently verified); `-1` = no route (z07CSI `W_OTH_C.wpt` has 396 such pairs: it is a stale copy; the island
`z02LGI` maps are fully connected inside groups). 30 compiled files (2353 nodes, 67 matrices), all parsed with 0 bytes left over. The `aW_<MAP>_.h` indices equal the node indices
(601 of 603 entries; the other 2 in `z16PYA` name nodes that were deleted). The nodes of `W_CSM_C` are camera positions (`CSM_...`, `CAM_...`, `HCAM01`) used by cutscenes.

##### 7.2 Editor maps `*.way` / `*.wpt` (magic `WPTP`)

48 files (names like `path_map.way`, `CSM_map.way`, `road_map.way`, `John_CSM.way`, `transform46.wpt` (z03PPH)); same content in the `.wpt` and `.way` variants. Not read by the EXE: they are the source of the `_C.wpt`.

```
'WPTP'  u32 nodeCount
node[nodeCount] 40 bytes: f32 x,y,z (editor coords)  u32 class (0..9)  u32 flags  u32 0  char name[16]
'WPTL'  u32 linkCount; link[linkCount] 12 bytes: u32 a, u32 b, f32 length
'WPTG'  u32 groupCount; entry[groupCount] 8 bytes: f32 value (10.0, 1.0, 3.7e-4, 3.7e-5), u32 0
```

`class` becomes the compiled `group + 1`; `flags` is `0x3f` (63) for ordinary nodes, `0x00ffff00`, `0x00ffff01` or `0xffffffff` for path/road nodes (which become `kind` 1, 8, 4...). Unnamed path nodes carry the
uninitialised text "WPT000" or "-2045911175". Links all reference valid nodes (3054 links). Compiled files contain the concatenation of the node lists of the listed editor files (verified for all `.wbt` layers: counts match
and `x_compiled == -x_editor`, same y, z).

##### 7.3 `.wbt` and `aW_*.h`

`*.wbt` (waypoint build list, 3 files): lines `Main|Merge <layer> <file.way> [as <name>]`, `//` comments (commented lines are kept in the files). Layer 0 `as path`, 1 `as road`, 2 `as csm`, 3 `as other` (z07CSI: layer 1 is `csm`).
`Main` starts the layer, `Merge` appends more `.way` files to the same compiled file (e.g. `Rich_Path.way`, `SOPHIES_path.way`: the team members' own waypoint files).
`aW_<MAP>_.h` (19 files): generated C header: `#ifndef <MAP>__INCLUDE_H`, `enum { WPT_<MAP>_<NAME> = <node index>, ... };`, `#endif`; 603 entries; header `aW_OTH_.h` of `z08BKD` is empty.
Parsers: `parseCompiledWaypoints`, `parseEditorWaypoints`, `parseWbt`, `parseWaypointHeader`.

#### 8. Particle systems

An effect = one `.par` script that executes an appearance (`.app`), movement (`.mov`) and emitter (`.emi`) file and may override values with timed actions. Files sit in `particle/` of a zone (`z02LGI` 23 effects, ...) and
`GENERICBITS/Particle` (4 effects: `GEM01`, `paul01`, `twinkle01`, `twinkle02`); each such directory also holds `text.opt` + `Text000.tga` (256x256 32-bit sprite sheet; `iSSprite/iESprite` go up to 64, so probably 8x8 sprites of 32 px - inferred).
Identical effect files are duplicated per zone archive.

##### 8.1 Key/value files (`.app` / `.emi` / `.mov`)

Line 1 = the file's own name (often not the same as the file name, informational), then `key = v [v v v]` lines (`sscanf("%s = %f %f %f %f")`; 1 value for scalars, 3 for vectors, 4 for colours). `//` lines are comments. Unknown keys are ignored.
The key vocabulary and ids are in the EXE data table at 0x8b72a4 (entries of 84 bytes: `char name[80]; u32 id`):

| File | Key (id) | N | Range in data | Meaning |
| --- | --- | --- | --- | --- |
| app | `fSCTIndex` (1) | 1 | 0..128 | start rotation index into a 256-entry sin/cos table (SCT = sin/cos table, FUN_00454460; rendering.md 7.3): the sprite's start angle in 1/256 turn |
| app | `fSCTIndexInc` (2) | 1 | 0..20 | spin speed in table steps per 1/30 s tick |
| app | `iSSprite` (3) / `iESprite` (4) | 1 | 0..60 / 0..64 | start / end sprite (frame) index in the 8x8 sprite sheet |
| app | `fSSize` (5) / `fESize` (6) | 1 | 0..10 / 0..20 | start / end size |
| app | `rgbaSColour` (7) / `rgbaEColour` (8) | 4 | 0..65280 | start / end colour r g b a, 8.8 fixed point (65280 = 255.0) |
| app | `fVSColour` (9) / `fVEColour` (10) | 1 | 0.2..0.9 | random variation of start/end colour (default -1 = none) |
| app | `fVSAlpha` (11) / `fVEAlpha` (12) | 1 | 0.15 | random variation of alpha |
| app | `fVSSize` (13) / `fVESize` (14) | 1 | 0.5..4 | random variation of size |
| app | `iUseModel` (15) | 1 | 0 | use a mesh instead of a sprite (always 0) |
| app | `iMaterial` (16) | 1 | 0..2 | material / blend mode |
| mov | `fAir` (18) / `fDAir` (19) | 1 | -0.2..1 / 0..0.2 | air drag factor per step (0.99) / its random deviation |
| mov | `fBounce` (20) / `fDBounce` (21) | 1 | 0..0.9 / 0..0.1 | bounce factor / deviation |
| mov | `fGround` (22) / `fDGround` (23) | 1 | 0..1 | ground plane flag/height / deviation |
| mov | `vGravity` (24) / `vDGravity` (25) | 3 | y -4..0.5 / dev | gravity vector / deviation |
| mov | `bRandInitRot` (26) `bRandBounceRot` (27) `bRandBounceAngle` (28) | 1 | 1 | randomise initial rotation / bounce rotation / bounce angle (booleans) |
| emi | `fDensity` (30) / `fDDensity` (31) | 1 | 0..100 / 0..15 | particles per second / deviation |
| emi | `fForce` (32) / `fDForce` (33) | 1 | 0..4 | initial speed / deviation |
| emi | `fIncAngle` (34) / `fExcAngle` (35) | 1 | 0..3.14 / 0..5 | emission cone: inclusion and exclusion angle (radians) |
| emi | `fSpeedScale` (36) | 1 | (unused) | |
| emi | `fLifespan` (37) / `fDLifespan` (38) | 1 | -1..10 / 0..5 | lifetime seconds (-1 = endless) / deviation |
| emi | `iMaxParticles` (39) | 1 | 4..5000 | particle pool size |

Prefix convention: `f` float, `i` int, `b` bool, `v` vector, `rgba` colour; `S`/`E` start/end; `D` (and `V`) random deviation. Ids 17, 29, 40 are unused.
Loader code: `FUN_00450250` (.app: the scalar keys store the float, `iSSprite/iESprite/iUseModel/iMaterial` are stored via `__ftol`, the colour keys 7/8 store four ints; unset variations default to -1.0),
`FUN_00450640` (.mov), `FUN_004509b0` (.emi). Missing keys keep defaults (6 `.app` files omit one or both colours). Confidence: grammar high; units/semantics medium (inferred from names, value ranges and the loader's store offsets).

##### 8.2 `.par` scripts

```
<name>                      first line (ignored)
[EMITS]                     optional: names of .par effects spawned by this one (3 files)
<name>.par
[SPLASH]                    optional: effect used on water impact (2 files: splash01 -> splash02)
<name>.par
[SCRIPT]
<when> <Action> <t0> <t1> <numbers...>
```

`<when>` is `ForNew` (apply to newly emitted particles) or `ForAll` (to live ones); a few lines start with `ResetScript` / `fornew` (typo-tolerant: the word is looked up in the same name table). Action tokens come from the table above
(ids 41..47); the generic "set value" form uses the key names with 2 time floats followed by one value (min/max pair) per component. Line shapes in the 99 files (count):

| Line | Args | Count | Meaning |
| --- | --- | --- | --- |
| `ForNew ExecuteScript <t> <file>` | 2 | 297 | run `.app` / `.mov` / `.emi` (three per effect, at t=0) |
| `ForNew SetEmiPrimitive <t0> <t1> <Prim> <Prop> [f..8]` | 4..10 | 150 | emitter shape: `Box` 0, `Line` 1, `Sphere` 2, `Ring` 3, `Circle` 4; property `Set`(-1) `EmitMode` 0 `AngleMode` 1 `Radius` 2 `Size` 3 `Points` 4 `Angle0/1` 5,6 `DAngle0/1` 7,8 `LineStart` 9 `LineEnd` 10; format `%s %s %f %f %s %s %f x8`; `Box Set` = default box, `Box Size x y z x y z` |
| `ForNew rgbaSColour/rgbaEColour <t0> <t1> r g b a r g b a` | 10 | 107 | timed colour RAMP of the emitter's template colour: the first rgba (four integers, `ftol`) at the start of the window to the second rgba at its end, linear per frame (step `ftol((end - start) / (30 t1))`, or the whole difference at once when `t1 <= 0`); the particles emitted meanwhile take the template's value of that frame (NOT a random pick between the two: the per-particle random spread is the `VSCOL` / `VECOL` / `VSALPHA` ... fields) |
| `ForAll rgbaSColour ...` | 10 | 15 | the same ramp written into every LIVE particle each frame (the value after the increment) |
| `ForNew fSSize/fESize/fDensity/fDDensity/fForce <t0> <t1> a b` | 4 | 12 | timed scalar RAMP (`FUN_00457850`): the template value goes from `a` to `b` over `t1` seconds, `value = a + n * step` with `step = (b - a) / (30 t1)` (float32, one step per frame, `cur = a` on the first frame; `t1 <= 0`: `step = b - a`), written to the template (or to every live particle for `ForAll`) every frame of the window |
| `ForNew vGravity / ForAll vGravity,vDGravity <t0> <t1> x y z x y z` | 8 | 4 | timed vector RAMP (`FUN_00457ab0`): the first frame already adds a step, the last frame of the window assigns the end vector exactly |
| `ForAll ResetScript <t> <f>` / `ResetScript ResetScript` | 2-3 | 35 | restart the script after `t` seconds |
| `ForNew EndSource <t> <f>` | 2 | 8 | stop the source after `t` |

Script interpreter `FUN_00455750` (CParticleActionManager): each line is scanned with `%s %s %f %f` + up to 10 floats; the action word selects the action object (colour/size/gravity ... ranges are created with
a start time `t0` and duration `t1`): an action runs in the window of FRAMES `[frame + trunc(30 t0), start + trunc(30 t1)]` of the global frame counter `DAT_009da5cc` (`frame` = the frame of the source's (re)start, so an included script's offset is added), once per update while the frame is inside it; the actions of a script are kept in time-ordered buckets (`FUN_00456600` / `FUN_004546a0`, with their insertion quirks, particles.md 2).
Dangling references exist in the shipped data (14: `splash01.par` -> `splash02.par`, `splasht02.par` -> `splash02.{app,mov,emi}` (in `z20DSP`, `z21FSH`), `Volcano01.par` -> `spray01.*`, `botexpl01.par` -> own missing triple).
Confidence: high: the `t0` / `t1` windows, the ramps and the bucket order are ported function by function (`src/fx/particles/actions.ts`) and verified against the original code in the x86 interpreter (particles.md 7: 99 effects x 11 scenarios, 0 differences).

##### 8.3 `.swl` swirl lists (4 files)

`//` comment lines, then whitespace separated tokens: name, ring count, per ring `<app file> <points> <direction +1/-1> <speed> <radius> <yawOffset> <sWobble> <dWobble>` (8 tokens). Describes rings of
particles (nuts and bolts, exclamation marks) circling an object (swirl effects in the Lego Island pizzeria/radio station). Parser `parseSwirl()`. Confidence medium (field order from the file's own comments).

#### 9. Fonts (`Fonts` archive: `Balloon12.fnt/.tga`, `Balloon24.fnt/.tga`)

Loader `FUN_00413af1(name)` reads `<name>.fnt`, texture `<name>.tga`; only the two names `_data/fonts/Balloon12` and `_data/fonts/Balloon24` are accepted (other fonts `data/fonts/main/main`, `menu/menu`, `csm/csm` are loose files outside the archives).

| Off | Type | Name | Notes |
| --- | --- | --- | --- |
| 0 | u32 x2 | - | 0, 0 (read and ignored) |
| 8 | u32 | lineHeight | 20 (12 pt) / 40 (24 pt) |
| 12 | u32 | glyphCount | 124 (Balloon12) / 119 (Balloon24) |
| 16 | u32 | kernOffset | `276 + 32*glyphCount` (must be non-zero) |
| 20 | u8[256] | charMap | char code -> glyph index (0 = none/space) |
| 276 | glyph[glyphCount] | | 32 bytes each: `f32 u0 v0 u1 v1` texture rect, `s32 width, height, offsetX, offsetY` (pixels) |
| 276+32n | u8[n*n] | kern | `kern[map[a]*n + map[b]]` = pen advance after `a` when `b` follows (1..36 / 1..19) |

Text is Latin-1; codes >= 0xE0 are folded to upper case (-0x20) before the map lookup (the same fold as in message text); drawing: left = x + offsetX, top = y + offsetY - lineHeight.
`.tga` are 32-bit textures (`Balloon24.tga` 256x256, `Balloon12.tga` 256x128). Layout identical to Moreno.LegoIsland2 `game_font.gd` (reimplemented; verified against `FUN_00413af1`). Confidence high. Parser `parseFnt`, `measure`.

#### 10. Brick models (`BrickMorph/*.txt`, `Bricks/brickset.txt`)

"BrickMorph": LEGO brick building models (Pepper's/other buildings, vehicles, the helicopter, shuttle ...) that morph between stages; a series `<name>00..NN.txt` (96 files: ambulance 00-06, animal 00-07, control, dinghy 00-.., house00-.., phel (helicopter), shuttle, shop, tower ...).
The bricks are meshes in `Bricks/lods/<name>_lodN.msh` (693 files for 257 bricks, 1 to 3 LODs each; the 257 names are exactly the entries of `brickset.txt`, checked).

`brickset.txt`: `//` comments; per line `name sym1 sym2 sym3 ox oy oz` (`sscanf("%s %i %i %i %f %f %f")`): three symmetry/rotation class ints 0..2 and a pivot offset in stud units. The loader scales `x,z` by 0.8 and `y` by 0.96 and builds mirrored
variants from the symmetry ints (`FUN_0044a5e0`).

Model file (`FUN_0044d570`):

```
NAME<TAB>name              line 1  (read positionally, keyword not checked; dinghy05.txt has a stray "auto01" glued to NAME)
MODELTYPE<TAB>HOUSE|HELICOPTER     line 2  (ignored by the loader)
CENTRE<TAB>AUTO | BASEDON | VECTOR x y z     line 3 (key looked up in a 3-entry table, 'VECTOR' reads 3 floats, x,z*0.8, y*0.96)
// comment lines
<group> <brick> x y z rx ry rz <colour> [<colour2>]      one brick
newlayer                                                   starts the next layer (the layer index is stored per brick)
```

`group` is looked up in a 30-entry table `AUTO09..AUTO00` (0..9), `PART00..PART19` (10..29); other group names (`auto`, `to`, `jet00`, `door00`, `to01`) map to 255. Positions are in stud-grid units (x,z * 0.8, y * 0.96 = world units);
rotations in degrees about x,y,z (multiples of 90 in practice). Colour = brick colour name (`white black red orange yellow blue green ltgrey trans_red trans_blue ...`, optional second colour for
two-tone bricks). Lines that `sscanf` rejects (< 9 fields) are silently ignored: `house04.txt` is written in an old syntax (`x y z BRICK_ORIENT_000 colour`, 132 placements, 14 unknown brick names) so the game loads
**zero** bricks from it; the other 95 files give 6155 placements (3 further stray lines are ignored: two `****` separators, one line missing a field in `jetski06.txt`). Colour names used: `black blue brown buff dkblue dkgrey green ltgey` (sic) `ltgreen ltgrey orange red white yellow trans_blue trans_green trans_lime trans_ltgrey trans_red trans_yellow`. Parsers `parseBrickModel`, `parseBrickSet`. Confidence high.

#### 11. Other `.txt` files (all 244, by kind)

| Kind | Count | Files |
| --- | --- | --- |
| cutscene source | 139 | `Cutscene/*.txt` (96 `z02LGI`, 19 `z07CSI`, 7 `z40OGL`, ...) |
| brick model | 96 | `BrickMorph/*.txt` |
| brick set | 1 | `Bricks/brickset.txt` |
| WhatsWhat | 4 | `Overlays/Z02LGI`, `Z07CSI`, `Z14OSD`, `Z40OGL` `/WhatsWhat.txt`: artist notes `Name --> textNNN` mapping UI element names to numbered overlay textures (e.g. `Pizza --> text002`); not read by the game |
| notes | 1 | `Overlays/Z40APO/how these equate.txt` (frame ranges of the medal spin animation: `14-43 bronze spin`, `44-73 silver spin`, `74-103 gold spin`, `104 fail bronze` ...) |
| messages | 1 | `z27TRX/messages/english/english.txt`: tag file `TRX_INST1:T-Rex Racing ...` (11 entries, no id field) |
| empty | 2 | `messages/Dutch.txt`, `z03PPH/New Text Document.txt` (0 bytes) |

Also non-text leftovers seen in the data: `z39ASB/Particle/Text000.tgaback` (backup of a TGA), `z21FSH/anim/RODD_Swish.anm`.

#### 12. Archives: contents and use

| Archive | Contents | Use |
| --- | --- | --- |
| `Fonts` (4) | `Balloon12/24.fnt` + `.tga` | in-game fonts of the front end/HUD (section 9) |
| `menu` (75) | `loading/` `text.opt` (count 1) + `text000.wib` (491,696 bytes; loading screen texture), `mOverlays/` `text.opt` (72 entries, 80 flag bytes) + `Text000..Text071.tga` (UI sprites, all 32-bit: 56 of 32x32, 10 of 64x64, 3 of 128x32, 2 of 16x32, 1 of 32x256) | main menu / front end overlays (`menu.bob`) |
| `Overlays` (730) | one folder per zone (`Z02LGI`, `Z07CSI`, `Z09jst`, `Z22Bip`, `Z38PAR` (180 files incl. `arrows3d` 72), `Z40APO` (109) ...) with `text.opt` + `TextNNN.tga` HUD/UI textures of that zone (clocks, pegs, arrows, medals, speech bubbles), `HUDFX` generic HUD effects, `Save`/`Originals` subfolders = artist backups (named TGAs, not used), `WhatsWhat.txt` notes | loaded as that zone's overlay texture list (`Text.opt`) |
| `GENERICBITS` (24) | `Backdrop/` (`Sea0.tga`, `Sky0.tga`, `CD.tga`, `Pizza.tga`, `loadingscreen.tga`, `OldLoadingScreen.tga`), `Particle/` (4 particle effects `.par/.app/.emi/.mov`, `text.opt`, `Text000.tga` sprite sheet) | sky/sea backdrop textures and effects shared by all zones |
| `SwapText` (145) | `text.txl` (144 entries) + `text000..text143.tga` (mostly 24-bit: 52 of 64x64, 32 of 4x8, 18 of 128x64, 16+6 of 16x16, 9+1 of 32x32, 8 of 128x32, 1 RLE 64x32, 1 of 32x8) | "swap texture" bank: path `_data\swaptext\` registered per zone (`FUN_004437d0`) and appended to the zone's texture list (`FUN_00443810`, offset `DAT_008b5718`) so meshes can switch textures at run time (face/skin swaps) |
| `messages` (166) | `<AREA>/Data/*.str` + empty `Dutch.txt` | all dialogue/message text (section 2) |
| `BrickMorph` (96) | brick model scripts (section 10) | building morph models |
| `Bricks` (696) | `lods/<brick>_lod0..2.msh` (693), `brickset.txt`, `text.opt` (count 1) + `Text000.tga` | brick mesh library used with `BrickMorph` |
| `Shadow` (11) | `Shadow.msh` (288 B), `text.txl` (9 entries) + `text000..008` (8 `.tga` 32-bit 128x64 / 64x64 / 32x32 + one `.wib`) | blob shadow geometry and textures |

#### 13. Test results (`node tools/test-formats.mjs --only cutscene,text,waypoints,particles`)

* cutscene: 226 files checked, 0 failures: 87 `.cut` parse exactly (no trailing bytes, version 4, all trailers == fixed-point of delay/duration), 139 `.txt` parse, 86/87 recompile byte-identical (`lgici06` tolerated: heap fill in name).
* text: 721 checked, 0 failures: 166 `.str` (2400+ entries), 92 `.opt/.txl`, 4 `.mtl`, 73 `.src`, 4 `.gob`, 96 brick models + `brickset.txt` (257 bricks == 257 `Bricks/lods` brick names), 244 `.txt` classified, 2 `.fnt`, 38 `.lgt`.
* waypoints: 100 checked, 0 failures: 30 compiled files with 70,636 in-group route lookups, 48 `WPTP` files, 3 `.wbt` (node counts and x mirror verified), 19 `.h` (index == node index, 2 stale entries).
* particles: 422 checked, 0 failures (14 dangling references pinned in the test as expected).

#### 14. Open questions

* `.cut`: semantics of `duration` per command, `SETMOVESPEED/SETTARGETSPEED` constants (names `a`,`b` are the two ints; constants 0.1 and 0.02 are exact from `FUN_0045f5b8`), the 9 files with `lineCount` > records (how the PC loader copes).
* `.opt/.txl`: purpose of flag bit 2 (value 4); behaviour for the missing last flag byte (`FUN_00433d38` flag 1 probably zero-fills).
* `.lgt`: fields `a`/`b` (always 0.5), ambient/diffuse/specular slot order is inferred from the loader's copies (ambient max over all, diffuse used for colour).
* Waypoints: exact meaning of `kind` 2/4/8 and `mask`; editor flag word 0x00ffff0x.
* `.src`: consumer unknown (not referenced by the EXE). `.mtl` always empty.
* (Closed, item 10: the action semantics of `t0/t1` and the `ForNew` ramps `FUN_00457850` / `FUN_00457970` / `FUN_00457ab0` / `FUN_00457c70`: section 8.3, particles.md 2.)
* `.str` voice ids are indices into the sound banks (owned by another slice).

#### References

* LE2.EXE decompilation (`LE2.c`, `LE2.asm.txt`) - function addresses above.
* Moreno.LegoIsland2 (`docs/formats.md`, `scripts/core/game_font.gd`, `scripts/core/waypoints.gd`) - font layout and the route-matrix lookup were re-implemented and verified against the data and the loader; nothing copied.

### 8.4 Sound, music and the other non-archive files

Parsers: `src/formats/riff.ts` (generic RIFF tree), `src/formats/sound.ts` (WAV incl. MP3-in-WAV, FINDER.DAT, `.pk`, MIDI header, DirectMusic summaries, PE identification, and
readers for the EXE's sound / speech / music / ambience tables). Test: `node tools/test-formats.mjs --only sound` (every file under `_data/sounds` plus `redist/`, 2953 files, 0 failures).
Playback is a later task; everything below that is about decoding is **high** confidence (verified on every file), the EXE tables are **high** (decoded from `LE2.c`/`LE2.asm.txt` and checked against the files), the
zone-name column and the speech-name semantics are **medium** (derived from `.str` strings and file names).

#### 1. Inventory of the game folder (`Game/`)

| path | files | what | parser |
|---|---|---|---|
| `LEGO eiland 2.exe` | 1 | the game, imports `mss32.dll` (Miles Sound System 6.0c) and COM DirectMusic | tables: `readExe*Table` |
| `mss32.dll` | 1 | MSS 6.0c core (352 256 bytes, "Copyright (C) 1991-98 RAD Game Tools"); differs from `redist/win32/Mss32.dll` (327 680 bytes, built 1999-11-02) | `parsePeInfo` |
| `redist/win32/*.flt, *.m3d, *.asi, Mss32.dll` | 36 | MSS plug-ins, see section 8 | `parsePeInfo` |
| `LeesMij.txt` | 1 | Dutch readme (system requirements, FAQ, contacts), no data | - |
| `Fotos/Fotos.txt` | 1 | one line: "press F10 during play to save a screenshot in this folder" | - |
| `_data/GameSetup.txt` | 1 | `ASET`, `version 4`, then `dialog f`, `video driver ...`, `video mode Mode 800x600x32`, `video exclusive t`, `video fog f`, `sound driver` (empty), `sound on f`; plain text, CRLF | - |
| `_data/sounds/` | 2910 | all audio (below) | |

`_data/sounds/` by type: 883 `.wav` (717 lower case + 166 upper case extension), 1698 `.mp3` (all speech, see 3), 229 `.sty` + 50 `.sgt` + 31 `.dls` (DirectMusic), 8 `.mid`, 7 `FINDER.DAT`,
2 `.pk`, 2 `.txt` (`speech/Dutch.txt` is 0 bytes, `DirectMusic/z10RGB/Cedric Reverb Settings.txt` is the sound designer's note: gain 0 dB, rev.mix -15 dB, rev.decay 5742 ms, 80 voices).
Also `messages.bod/.bob` contains an empty `Dutch.txt` (0 bytes).
There are **no** `.m3d/.flt/.asi` in `_data`: those are the Miles plug-ins in `redist/`.

#### 2. WAV (883 files)

Plain RIFF/WAVE, **all PCM** (`wFormatTag` 1, `fmt ` chunk of 16 bytes). Variants (count): 44.1 kHz mono 16-bit 448, 22.05 kHz mono 253, 16 kHz mono 73, 11.025 kHz mono 16-bit 75 (8-bit 5),
32 kHz mono 9, 44.1 kHz stereo 4, 22.05 kHz stereo 2, 11.025 kHz stereo 2, 16 kHz stereo 1, 8 kHz mono 2, 5564 Hz mono 1 (z20DSP), plus 12 files with 8-bit samples (11.025/16/22.05/44.1 kHz, e.g. `z38PAR/sea16_8.wav`).
Total 24.9 minutes. No ADPCM, no MP3 in the `.wav` files.

Chunk layouts: `fmt ,data` 641; `fmt ,data,LIST(INFO)` 196 (WaveConvertPro, `ISFT "WaveConvertPro "`, `ICOP "Silicon Dreams Studio Ltd."`, `IENG` = the sound designer, `ICRD` date mm/dd/yy hh:mm:ss, empty `ICMT/INAM/ISBJ`);
`fmt ,data,LIST,smpl` 35 (Awave v5.0 "(c) 1993 FMJ-Software": one sampler loop of type 255 from frame 0 to the last frame = "loop whole file"); `fmt ,data,cue ,LIST(adtl)` 8 (one cue + label);
`fmt ,data,cue ,LIST,plst,smpl` 1 (`z18MMP/Symbol Move.wav`: a normal forward loop 7543..21405 although the file has only 11 448 frames: the loop end lies outside the data; MSS ignores smpl loops when `AIL_set_sample_loop_count` is used, so this is harmless).
The data chunk never carries trailing bytes. `CUTSCENE/go.wav` and nothing else is a **0-byte file** (the EXE refers to a `go.wav` for a cutscene, see 9.1).
`SILENCE.WAV` (3848 bytes, 22.05 kHz mono, in the sounds root) is not referenced by path; the EXE uses `z02LGI\Silence.wav` as the placeholder for 5 sound-table slots.

`parseWav` returns the format, data offset/size, frame count, duration, sampler loops, cue count and INFO strings.

#### 3. Speech: `.mp3` files are MPEG Layer 3 inside a WAVE container (1698 files, `speech/Data/*.mp3`)

Despite the extension they start with `RIFF....WAVE`. Every one of the 1698 files has the identical format (the test asserts this):

| field | value |
|---|---|
| chunks | `fmt `(30 bytes), `fact`(4), `data`, `LIST INFO` (after the data) |
| `wFormatTag` | 0x0055 (MPEGLAYER3) |
| channels / rate / avg bytes per sec / block align / bits | 1 / 44100 / 6000 / 1 / 0 (48 kbit/s) |
| `cbSize` | 12 = MPEGLAYER3WAVEFORMAT: `wID` 1, `fdwFlags` 2 (padding off), `nBlockSize` 156, `nFramesPerBlock` 1, `nCodecDelay` 1393 |
| `fact` | sample count (e.g. 25 592 = 0.58 s for LECSBO08.mp3) |
| `data` | MPEG-1 layer-3 frames, 156 bytes each (48 kbit/s mono at 44.1 kHz), the last frame is truncated (50 of 156 bytes in all files), starts with `FF FB 30 C4` |
| `LIST INFO` | `ICMT ""`, `ICOP "Silicon Dreams Studio Ltd"`, `INAM ""`, `ISBJ ""`, `IENG` (voice director/engineer), `ICRD`, `ISFT "WaveConvertPro "` |

Total 102 minutes. The game decodes them through the MSS stream API (`AIL_open_stream`, `AIL_start_stream`, `AIL_set_stream_volume/pan/loop_count`) with the `Mp3dec.asi` codec from `redist/`. For a web port: decode with any
MP3 decoder after cutting out the `data` chunk (offset 70 in all files, `Wav.dataOffset`/`dataSize`) or with `decodeAudioData` on the whole file after rewrapping.

##### 3.1 Speech id -> file

`FUN_00875825`: `sprintf(buf, "_Data/sounds/speech/Data/%s.mp3", speechTable[index])` and `FUN_0087584e` opens it with `AIL_open_stream`. `speechTable` is an array of `char*` at **VA 0x979098** (`readExeSpeechTable`),
1732 entries (1635 distinct ids; duplicates are the same line used under several enum values), first entry `LECSIN01`. Scripts address a line by its id string:

* Cutscene scripts (`<zone>/Cutscene/*.txt`, binary twin `.cut`) contain `<time> <delay> <actor> SayText <ID> <next time>`, e.g. `0  0.0  Pepp  SayText  LECSPP02  10` in `z02LGI/Cutscene/lgi01.txt`.
  444 distinct ids appear in all cutscene scripts, 440 of them in the PC scripts; every one has an mp3 (the 4 others occur only in the `*psx.txt` scripts and also exist).
* The subtitles come from the `.str` tables in `messages.bod` (folders `FE`, `LI`, `AI`, `CI`, `OG` / `Data/*.str`): lines `ID:number text`, e.g. `LECSPP02:105 Hallo!`. `LI/Data/LGI01.str` belongs to cutscene `lgi01`,
  `CI/Data/CSI02.str` to a Castle island scene, `AI/Data/ADV02.str`, `OG/Data/*.str`. The `number` is the global string number, `-1` for plain UI strings (`FE`). 1412 ids in total; 741 of them have an mp3 (the rest are UI/menu strings).
* The table is the authoritative list of speech ids (the code addresses it by enum index; how scripts and code pick indices for the bark series was not traced): 1631 of the 1698 files are named by it; 67 files are not in the table
  (unused alternates: `LEDTHT03..42`-gaps, `...ALT`, `...B`, `ADSGSS01_`, `MAN_*`, `SGGOLD/SILVER/BRONZE` ...), and 4 table ids have no file (`CASGJO11`, `CARQAA03`, `CARQAA07`, `CARQBB06`). The test checks these exact numbers.

Naming convention (`AAXXYYnn`, eight letters/digits, medium confidence): `AA` = island/area (`LE` LEGO eiland 1080 files, `CA` Castle island 262, `AD` Adventurers 243, `OG` Ogel 95);
`XX` = kind (`CS` cutscene dialogue 360, `SG` in-game speech 264, `IN` information centre 83, `HM` hints, and per-character bark series such as `PH`, `DP`, `GF`, `SP`, `PC`, `FM`, `RS`, `CB`, `CC`, `CP`, `BE`, `SB`, `DT`...);
`YY` = speaker/topic (`PP` Pepper, `BR` Brickster..., or `AA`/`BB` = the two voice variants of a bark series); `nn` = 01..99 sequence.
Odd names: `GIRLa/b`, `MAN_1a..3b`, `cacsar03` (lower case), `LEGPAA08 ALT`, `OGSGPO11_NL ALTERNAT`.

#### 4. `FINDER.DAT` (7 files, `z02LGI/Footsteps/*/FINDER.DAT`)

368 bytes = 4 records of 92 bytes (one per footstep wav of that folder). It is a **Macintosh desktop-info file** produced when the sounds lived on a Mac/PC-Exchange volume and was copied along; **the game never reads it** (no reference in the EXE) and it does not index speech or anything else.

| offset | size | meaning |
|---|---|---|
| 0x00 | 1 + n | Pascal string: long file name, e.g. `Grass_1.WAV` (length byte, then the characters) |
| 0x0c-0x1f | 20 | dates/ids, not interpreted (0xffffffff at 0x0c in the first record, zero in the others) |
| 0x20 | 4 | Mac file type `.WAV` |
| 0x24 | 4 | creator `Sd2a` (Sound Designer II) |
| 0x28-0x4f | 40 | flags/ids, unused |
| 0x50 | 11 | 8.3 short name padded with a space: `GRASS_1 WAV` |
| 0x5b | 1 | 01 |

`parseFinderDat` reads name/type/creator/short name; the test verifies that each entry names an existing wav of the folder and that the entry count equals the number of wavs.

#### 5. `.pk` (2 files, `z90ADV/crickets.pk`, `z90ADV/chaseplane_parked.pk`)

Waveform peak caches written by the wave editor next to the edited `crickets.wav` / `chaseplane_parked.wav` (not referenced by the EXE). Layout: 18 u32 header words (word0 = 1777, word1 = 256, word2 = record count,
word3 = 8000, word5 = word2 - 1, word6 = 0xffffffff, words 8-10 look like stale pointers 0x5d0fa8 / 0x5d0f92 / 0x5d0f8a), then `word2` records of 8 bytes. File size is exactly `72 + word2*8` (verified for both). The record
contents (min/max peaks) are not decoded; irrelevant for the game.

#### 6. MIDI ambience (8 `.mid` + 5 `DLS ....dls`)

Standard MIDI files, format 1; division 768 ticks per quarter in 7 files and 480 in `DirectMusic/dance/BBSGTRDRMS.mid` (the same 768 as DirectMusic's native clock; the dance file is a development leftover that is not in the EXE tables).
Used for the six looping ambience beds, registered in a table at **VA 0x97ff48** (16-byte records: key, `.mid` path, `.dls` path, volume; `readExeAmbienceTable`; loader FUN_00875918 = `AIL_file_read(mid)`, `AIL_DLS_load_file(dls)`, `AIL_MIDI_to_XMI`, `AIL_init_sequence`):

| key | mid | dls | volume |
|---|---|---|---|
| LGIBirds | `z02LGI/MidiAmbient/Birds.mid` | `DLS Birds.dls` | 99 |
| LGIGulls | `z02LGI/MidiAmbient/Seagulls.mid` | `DLS Birds.dls` | 66 |
| Fishing | `z21FSH/Ambience MIDI/Fishing_Amb.mid` (folder is `Ambience_MIDI` on disk, the EXE says "Ambience MIDI") | `DLS Collection1.dls` | 95 |
| TRex | `z27TRX/Ambience/Trex Ambience.mid` | `DLS Collection1.dls` | 85 |
| Castle | `z07CSI/ambience/Castle Ambience.mid` | `DLS Collection1.dls` | 100 |
| Asteroid | `z39ASB/Ambience MIDI/Asteroid_Amb.mid` (disk: `Ambience_MIDI`) | `DLS Collection1.dls` | 64 |

`Birds'n'Bees.MID` is shipped but not in the table. `parseMidiInfo` checks `MThd` and walks every `MTrk` (sizes must add up to the file size, exact in all 8).

#### 7. DirectMusic (`DirectMusic/<dir>/`): 229 `.sty`, 50 `.sgt`, 26 `.dls` (+5 `.dls` next to the MIDI ambience)

All three are RIFF files (DirectMusic is a COM API: `CoCreateInstance` in FUN_0087671f, performance/segment/loader code in `Sound\c_src\DirectMusic.cpp`). Every file parses exactly (no trailing or truncated chunks);
`summarizeDirectMusic` returns the form, names (`UNAM`/`INAM`), chunk counts and the referenced file names (`DMRF/file`, UTF-16). Playback is not decoded here (the Moreno project documents the musical content: see its `docs/formats.md`, "DirectMusic segments" and `scripts/audio/dm_song.gd`, `dls_bank.gd`).

| ext | RIFF form | chunk inventory over all files (count) |
|---|---|---|
| `.sty` style | `DMST` | `styh` 229 (style header: time signature, grid, tempo), `guid` 672, `vers` 436, `LIST UNFO/UNAM` 9204 (names of style/parts/patterns/bands), `RIFF DMBD` 236 (band; `LIST lbil/lbin/bins` 3988 instrument entries), `LIST part` 6288 (`prth` part header, `note` 3876 note lists, `crve` 20 curves), `LIST pttn` 681 (`ptnh` pattern header, `rhtm` rhythm map), `LIST pref` 8080 (`prfc` part references), `LIST DMRF` 207 (`refh`, `name`, `file`: reference to a band/DLS) |
| `.sgt` segment | `DMSG` | `segh` 50 (header), `guid` 1255, `vers` 1195, `LIST UNFO/UNAM` 110, `LIST trkl` 50 with `RIFF DMTK` 223 tracks (`trkh` + `trkx`109): tempo `tetr` 49, chord `LIST cord` 47 (`crdh`, `crdb` 52), style `LIST sttr` 41 (`LIST strf` 382, `stmp`, `LIST DMRF` -> `.sty`), band `RIFF DMBT` 47 (`LIST lbdl/lbnd`, `bdih` 19, `bd2h` 41, `RIFF DMBD` 60 with `LIST lbil/lbin/bins` 1076, each band entry with a `DMRF` to the `.dls`), mute `mute` 1, command `cmnd` 28, sequence `seqt` 8, time sig `tims` 2 |
| `.dls` collection | `DLS ` | `colh` 31 (instrument count), `vers`, `dlid`, `LIST lins` -> 345 `LIST ins ` (`insh` header, `LIST lrgn` -> 1157 `LIST rgn ` with `rgnh` key/velocity range, `wsmp`, `wlnk` wave link, `LIST lart`/`lar2` articulation `art1` 448), `ptbl` pool table, `LIST wvpl` -> 1140 `LIST wave` (`fmt `, `data`, `smpl`, `wavu`/`guid`/`wavh`), `LIST INFO` 1516 (`INAM` instrument names, `ICOP`, `IENG`, `ISFT`, `DATE`), a few `cue `/`LIST adtl` (`ltxt`, `labl`) |

All DLS waves (1140) are PCM wave pool entries in `LIST wave`.

Segment -> style / dls references: 1145 `file` chunks in the 50 segments; all resolve to a file in the same directory (case-insensitive) except `DLS Collection1.dls` (98 band entries of 5 segments: `ad1/AdvIntro.sgt`, `ad1/AdvVartn.sgt`, `ad1/AdventurerTheme.sgt`, `ad1/AdventurerVartn.sgt`, `z41MAP/BDanube.sgt`),
a stale authoring name; the EXE loads the `.dls` explicitly from its table, so the band works anyway.

##### 7.1 Which segment plays where: music table at VA 0x97fcb8 (`readExeMusicTable`, 41 records of 4 string pointers; loader FUN_00876841 compares the requested key case-insensitively, then passes the directory to FUN_00876c97 and `segment`/`dls` to FUN_00876d42, which load them)

| key | directory (`DirectMusic\`) | segment | dls |
|---|---|---|---|
| Z01BPK | z01bpk | Skate Park Theme.sgt | Skate Park.dls |
| Z02LGIM / Z02LGIT / Z02LGIB | z02LGI | Lego Town Main.sgt / Lego Town Theme.sgt / Lego Town Bridge.sgt (**not shipped**) | LI2 Town Custom.dls |
| Z02Papa, Z02Mama, Z02Nick, Z02Laura, Z02Info, Z02Trom | z02LGI | PapaBrick, MamaBrick, Nick Brick, Laura Brick, Infoman1, TromSolo (.sgt) | LI2 Town Custom.dls |
| Z05WAB1/2/3 | z05WAB | WakLevel1, WakLevel2, WakLev3 | WakaBot.dls |
| Z07CSI | z07CSI | Medieval Theme.sgt | Medieval.dls |
| Z08BKD1/2 | Z08BKD | BDivingLev1, BDivingLev2 | Brick Diving.dls |
| Z10RGB | z10RGB | Cedric.sgt | Cedric.dls |
| Z15SSH | z15ssh | AdvRace.sgt | advrace.dls |
| Z17WAS1/2 | z17was | WakaSnake1, WakaSnake2 | WakaSnake.dls |
| Z18MMP, Z18MMPPre | Z18MMP | Matching Mummies.sgt, Pre-Matching.sgt | Matching Mummies.dls |
| Hotep | Hotep | Hoteps Tomb.sgt | Hoteps Tomb.dls |
| Z21FSH, Z21Jaws | z21FSH | Oasis.sgt, Fishing.sgt | OasisFishing.dls |
| Flying | Flying | Flying.sgt | Flying Max.dls |
| Z28HAT | z28HAT | MrHates.sgt | MrHates.dls |
| Z38PAR, Z39ASB, Z40APO | z38PAR | Asteroids.sgt (all three levels) | Asteroids.dls |
| Z41MAP | z41MAP | BlueDanube.sgt | BlueDanube.dls |
| Z42BRP | Z42BRP | Brickster.sgt | Brickster.dls |
| ad1T / ad1V | ad1 | AdvIntro.sgt / AdventurerVartn.sgt | Ad1.dls |
| ad2 | ad2 | Adv2.sgt | Adventurers2.dls |
| bbotsM / bbotsV | bbots | Bricksterbots.sgt / BBotsVartn.sgt | Bricksterbots.dls |
| ogel | ogel | Ogel.sgt | Ogel.dls |
| radio | dance | BBotdance.sgt | BBotdance.dls |
| carn | Carn | FlyingCarn.sgt | FlyingCarn.dls |
| menu | menu | Menu.sgt | Menu.dls |

Directories and file counts (sty/sgt/dls): ad1 29/4/1, ad2 25/1/1, bbots 2/2/1, Carn 1/1/1, dance 1/3/1 (+1 mid), Flying 10/2/1, Hotep 1/1/1, menu 1/1/1, ogel 1/1/1, Tomb 1/1/1 (`Hoteps Tomb.*`, a duplicate of `Hotep/`, not in the table), z01bpk 2/3/1, z02LGI 27/9/1,
z05WAB 5/3/1, z07CSI 24/1/1, Z08BKD 1/2/1, z10RGB 1/1/1 (+ the Cedric reverb note), Z140SD 28/1/1 (not in the table; contains `Adventurers.sgt`, `AdvIntro.sty`, `DLS Collection1.dls`: an older copy of the Adventurers music), z15ssh 1/2/2, z17was 1/2/1, Z18MMP 2/2/1, z21FSH 27/2/1,
z28HAT 1/1/1, z38PAR 1/1/1, z41MAP 2/2/1, Z42BRP 34/1/1. Files like `Sec1bar4.sty ... Sec3bar30.sty` (ad1, Z140SD) are bar-wise style files that a segment's style track (`sttr`/`strf`) selects.

#### 8. Miles Sound System redistributables (`redist/win32`, 36 PE DLLs, all built 1999-11-02, version string "Miles Sound System")

All are 32-bit x86 DLLs that import `RIB_register_interface` / `RIB_unregister_interface` / `_RIB_provider_library_handle` from `mss32.dll` (the "RAD Interface Broker"); the EXE calls `AIL_set_redist_directory("redist/WIN32")` (string at 0x965b60) then `AIL_startup`.

| ext | count | role | files |
|---|---|---|---|
| `.flt` | 19 | pipeline filters (DSP effects loadable through `AIL_enumerate_filters`) | Autopan, Bandpass, Capture, Chorus, Compress, Flange, Highpass, Laginter, Lowpass, Mdelay, Parmeq, Phaser, Reson, Reverb1/2/3, Ringmod, Sdelay, Shelfeq |
| `.m3d` | 12 | 3D audio providers (`AIL_open_3D_provider`): Aureal A3D (`Mssa3d`, `Mssa3d2`), Dolby Surround (`Mssdolby`), DirectSound3D hardware / software (`Mssds3dh`, `Mssds3ds`), DirectX 7 3D (`Mssdx7sh/sl/sn`), Creative EAX (`Msseax`, `Msseax2`), Miles fast 2D->3D (`Mssfast`), Intel RSX (`Mssrsx`, 356 KB) | |
| `.asi` | 4 | audio stream codecs: `Mp3dec.asi` (MPEG layer 3, "Layer 1/2 not supported", used for the speech), `Mssv12/24/29.asi` (by name the Voxware voice codecs, unused here) | |
| `.dll` | 1 | `Mss32.dll` (core, a different build from the root `mss32.dll`) | |

The EXE enumerates the 3D providers and opens the first match of this priority list (FUN_00874751): "Creative Labs EAX 2 (TM)", "Creative Labs EAX (TM)", "DirectSound3D Hardware Support",
"DirectSound3D 7 (Software - Full HRTF)", "DirectSound3D 7 (Software - Light HRTF)", "DirectSound3D 7 (Software - Pan and Volume)", "DirectSound3D Software Emulation".
These DLLs are irrelevant for the web port (WebAudio replaces them).

#### 9. How the engine plays sounds (SoundClass.cpp, VA 0x873e00-0x877550)

* Output: `AIL_waveOutOpen` + `AIL_midiOutOpen` + `AIL_DLS_open(midi, wave, ..., 22050 Hz, 16 bit, 2 channels)` for the MIDI ambience; DirectMusic is separate (COM).
* **16 two-dimensional sample handles + 16 3D sample handles**, and two caches of **200** loaded wave files each (16-byte slots: sound id, "playing" flag, voice index, file buffer pointer; file read whole with `AIL_file_read`, FUN_00874b68 / FUN_00874be4).
  Loading takes a **sound id** (index into the sound table below). Playing a sound: FUN_00874cb4 (2D) / FUN_00874f01 (3D).
* A master volume percentage (field 0x1a08 of the sound object, set from the options by FUN_008749dc) scales every entry: `AIL_set_sample_volume(h, tableVolume * master / 100)`.

##### 9.1 The sound table (`readExeSoundTable`)

902 records of **32 bytes at VA 0x969f80** (`PTR_s__Data_sounds__z02LGI_Silence_wav_00969f80`), index = sound id = the value that scripts pass; the names are registered once by
FUN_00877550 (`FUN_0045bff4(registry, "SND_NAME", id)` x 902, ids 0..901 with no gaps; the 50 `CSSND_` cutscene sounds are ids 822..901, the rest are `SND_` zone sounds).

| offset | type | field | MSS call |
|---|---|---|---|
| 0 | char* | path, e.g. `_Data\sounds\\z02LGI\Footsteps\GRASS\GRASS_1.WAV` (note `sounds\\`), or `UNDEFINED` / `_Data\sounds\PSX ONLY` placeholders (29) | `AIL_file_read` |
| 4 | u32 | base volume 0..127 | `AIL_set_sample_volume(vol*master/100)` |
| 8 | u32 | loop count: 1 = once (717), **0 = loop forever (179)**, 4 / 8 / 10 / 64 for a few | `AIL_set_sample_loop_count` |
| 12 | f32 | 3D min distance | `AIL_set_3D_sample_distances(h, max, min)` |
| 16 | f32 | 3D max distance (typically 1/200, 8/128, 16/256, 32/512, 64/756) | same |
| 20 | u32 | pan, 64 = centre (SND_CEDRIC_WALK has 512, out of range) | `AIL_set_sample_pan` |
| 24 | u32 | **playback rate in Hz** (applied on top of the file: differs from the wav header rate in 134 of 862 files; 21 entries are > 48 000 = pitch-shifted copies of one file, e.g. `SND_DIP_BREX` 99 372) | `AIL_set_sample_playback_rate` |
| 28 | u32 | copy of the loop count (always equal to offset 8) | - |

Facts verified by the test: 902 names, all unique and well-formed; every non-placeholder path exists on disk except the PSX-only skate stunts (`islestunts/*` and `SND_SKATE_SUPER..GEN`, 11), `z08BKD/bonk.wav` (`SND_HIT_ROCK`), `z15SSH/snake_amb2.wav` (`SND_SSH_AMBIENT`), 5 slots whose path is only a directory (`SND_BPK_CHEER1/2`, `SND_BPK_BOO1/2` -> `z01BPK\`, `SND_CAI_PORTAL` -> `z02lgi\`: unfinished entries) and `CSSND_HORSE_HOOVES` (`z07CSI\cutscene hooves` without the `.wav` extension, the file `cutscene hooves.wav` exists);
5 slots point at `Silence.wav` (flower growing/shrinking, silence). 788 wav paths are literals in the EXE; the 108 wavs on disk that no literal names are unused or built by pattern.
Examples: id 267-270 `SND_WALK_GRASS1-4` (`Footsteps/GRASS/GRASS_1-4.WAV`, volume 20, rate 22050), 391-396 `SND_LAND_ROAD/LAND/GRAVEL/PLASTIC/GRASS/ROCK`, 383-389 `SND_SKATE_*` (skateboard loops).
Footstep/landing selection by polygon surface id: see `col.md` section 4. The name prefixes group the table by zone (`TRX` 51 -> z27TRX, `BRP` 40 -> z42BRP, `BPK` 39 -> z01BPK, `HOOF` 32 -> z07CSI/z09JST, `WAS` 31 -> z17WAS, `MAP` 29, `DSP` 29,
`PPH` 27, `WALK` 28 + `LAND` 13 -> z02LGI, `DIP`/`CAI`/`OSD`/`PYA` -> z90ADV, `APO` 22, `IFC` 17, `CSI` 14, `CNT` 12, `OGL` 12, `MMP` 12, `CED`/`RGB` -> z10RGB, `FSH`/`FLOAT` -> z21FSH, `CS*` = cutscene sounds, 158 prefixes in total).

#### 10. Directory-by-directory map of `_data/sounds`

Zone codes are the archive/level codes (`zNNXXX`); names are the Dutch level names from `FRONTEND.str` (`LEVxxx`). Counts: files / wavs (rate Hz, duration), "ref" = wav paths named literally in the EXE.
Which file a game event plays is always decided by the sound table (9.1), the speech table (3.1), the music table (7.1) or the ambience table (6); a zone folder is only a place where the table's paths point.

| folder | level / purpose | files | contents |
|---|---|---|---|
| `(root)` | - | 1 | `SILENCE.WAV` (unreferenced) |
| `CUTSCENE/` | sound effects shared by cutscenes (`CSSND_*`) | 42 | 42 wav (44.1/32/22.05/16/11/8 kHz, 103 s), 36 ref; brick/rip/majick/vortex/summon/portal/bot effects; `go.wav` is 0 bytes |
| `DirectMusic/` | music: see 7; 25 sub-folders | 307 | 229 sty, 50 sgt, 26 dls, 1 mid, 1 txt |
| `speech/Data/` | all spoken lines: see 3 | 1699 | 1698 mp3-in-wav + `speech/Dutch.txt` (0 bytes) |
| `z00FRE/` | main menu (Hoofdmenu) UI | 7 | 7 wav, 44.1 kHz (`UpDown1/2`, select/back...), all ref |
| `z01BPK/` | Skate-park | 32 | wav 44.1 kHz, 39 s; skate/rail slide, cheer/boo (`SND_BPK_*`), 30 ref (`Railslide`, `pep_rap` unreferenced) |
| `z02LGI/` | LEGO eiland (main island) | 131 | 120 wav (22/11/44 kHz, 90 s) + `Footsteps/{GRASS,BRIDGE,ROAD,ROCK,GRAVEL,PLASTIC,SAND}` (7 x 4 wav + `FINDER.DAT`), `Skateboard/` (14: `SK_*` loops and `S_L_*` landings, 7 surfaces), `Menu/` (8 UI wavs `Back, OnOff, Select, UpDown*`), `MidiAmbient/` (3 mid + `DLS Birds.dls`), vehicle/animal/horn wavs; 96 ref (menu wavs and some animals are not named literally) |
| `z03PPH/` | Pepper's house | 27 | 27 wav (44/22/16/11 kHz, 32 s), all ref |
| `z04IFC/` | Informatiecentrum (Info Center) | 17 | 17 wav, 44.1 kHz incl. stereo `Printer.wav` |
| `z05WAB/` | Botten meppen (Whack-a-Bot) | 12 | 12 wav, 44.1 kHz (`SND_WAB_*`, `OPEN/CLOSE_*`) |
| `z07CSI/` | Castle eiland | 58 | 56 wav (hooves, swords, crows...), `ambience/Castle Ambience.mid` + `DLS Collection1.dls`; 44 ref |
| `z08BKD/` | Baksteenduiken (Brick Diving) | 28 | 28 wav (water, clam, brick); 27 ref (`bonk.wav` named but not shipped; `head_bonk.wav` instead) |
| `z09JST/` | Toernooi (Joust) | 38 | 38 wav (horses, crowd, `SND_JST_*`), 37 ref |
| `z10RGB/` | Razende stier (Raging Bull / Cedric) | 33 | 33 wav (cannon, Cedric, dogs); 26 ref (the unreferenced ones are the same files as in z90RGB) |
| `z15SSH/` | Slangen schieten (Snake Shooting) | 16 | 16 wav; 14 ref (`snake_amb2.wav` named, not shipped) |
| `z17WAS/` | Slangen meppen (Whack-a-Snake) | 28 | 28 wav incl. stereo `Tock high/mid/low.wav`, all ref |
| `z18MMP/` | Passende Poppen (Matching Mummies) | 45 | 45 wav (2 stereo), 43 ref |
| `z20DSP/` | Desert Speedster | 28 | 28 wav incl. 8 kHz and 5564 Hz, 27 ref; `skid_loop_PSX.wav` unused |
| `z21FSH/` | Vissen (Fishing) | 28 | 26 wav (cast, reel, line, float), `Ambience_MIDI/Fishing_Amb.mid` + `DLS Collection1.dls` |
| `z22BIP/` | Vliegtuig (Biplane) | 28 | 28 wav (plane, monkey) |
| `z27TRX/` | T-Rex jagen | 50 | 48 wav, `Ambience/Trex Ambience.mid` + `DLS Collection1.dls`, 44 ref |
| `z28HAT/` | Kamp Sam Sinister (camp) | 22 | 22 wav (winch, sandbag, elec fence, roars), 19 ref |
| `z36CNT/` | Centrifuge | 19 | 19 wav, all ref |
| `z38PAR/` | Parachutetraining | 28 | 28 wav (wind, chute, pterodactyl), 25 ref |
| `z39ASB/` | Asteroidengordel | 14 | 12 wav (2 stereo `Engine Static`), `Ambience_MIDI/Asteroid_Amb.mid` + `DLS Collection1.dls` |
| `z40APO/` | Parachutespringen op Ogel | 23 | 23 wav, 21 ref |
| `z40OGL/` | Ogel eiland | 25 | 25 wav, 22 ref |
| `z41MAP/` | Die-pizza's-maken (Make a Pizza) | 30 | 30 wav, 29 ref |
| `z42BRP/` | Paleis van Dondersteen (Brickster's palace) | 30 | 30 wav, 28 ref |
| `z90ADV/` | shared Adventurers' island / oasis / pyramid / dino-park ambience (`SND_DIP_*`, `SND_CAI_*`, `SND_OSD_*`, `SND_PYA_*`) | 37 | 35 wav (121 s, 6.0 MB: ambience loops, dinos, scorpion, volcano) + the 2 `.pk` peak files; 33 ref |
| `z90RGB/` | duplicate subset of z10RGB (27 of its 33 wavs, 26 byte-identical, `pep_hit2.wav` differs) | 27 | not referenced by the EXE, unused |

Not on disk but named by the EXE: `islestunts/*` (11 skate-stunt wavs, PSX-only), `z08BKD/bonk.wav`, `z15SSH/snake_amb2.wav`, `DirectMusic/z02LGI/Lego Town Bridge.sgt`.
Zones without a sound folder (z13CAI, z14OSD, z16PYA, z23DIP...) get their sounds from the shared `z90ADV` folder or from table entries pointing at other zones' folders (the sound table paths are the only truth); the other folders map 1:1 to the archive's zone code.

#### 11. Open questions

* The `Footsteps/*/FINDER.DAT` fields between 0x10 and 0x4f (Mac dates and ids) are not interpreted; irrelevant for the game.
* Content of the `.pk` records.
* Whether the playback-rate field of the sound table (differs from the wav rate in 134 entries) is meant to pitch the sample (the code applies it with `AIL_set_sample_playback_rate`, so yes for the engine): not verified by ear.
* DirectMusic: musical decoding (style/pattern/band chunk contents) is left to the playback task; only chunk trees are parsed here.


---------------------------------------------------------------------------------------------------------------------------

## 9. Viewer, tools, tests

* **Viewer**: `?viewer=1[&zone=z02LGI][&mode=grid][&cull=none]` in the dev app (`npx vite --port 5499 --strictPort`; needs `public/data/le2` -> the game folder).
  `src/viewer/index.ts` (UI, camera, picking), `renderer.ts` (WebGL2: meshes, texture upload with the `text.txl` wrap flags, three draw passes, per-group matrices), `data.ts` (HTTP loading of
  archives and the EXE), `math.ts` (left-handed row-vector matrices). Controls: WASD move, Q/E down/up, Shift fast, drag to look, wheel = speed, click = select (shows record/model/LOD/texture
  info), right-hand list = all placed objects (click flies there), H hides the UI, R resets the camera. `window.__viewer` offers `setCamera`, `view(name, dist, yaw, pitch)`, `select`, `info` for headless tests
  (`node tools/browse.mjs "http://localhost:5499/?viewer=1&zone=z03PPH" steps.mjs --size 1280x800`; screenshots under `/tmp/bdb-shots` or `--out`).
  "mesh grid" mode (`mode=grid`) shows every `.msh` of any archive scaled to equal size on a grid (textured when the zone's tables use the mesh).
* **Parsers**: `src/formats/*.ts` (pure, `Uint8Array` in, plain objects out, no DOM): `archive reader msh matrix tga wib x86 exe` (lead) plus the format workers' modules.
* **Tests**: `node tools/test-formats.mjs [--only name] [-v]` runs `tools/tests/*.mjs`; every check parses every file of its type of all 39 archives:
  `archive` (22,831 members, contiguous, markers), `msh` (10,731 meshes, bounds/UV/normal/index sanity), `textures` (4,961 TGA + 329 WIB), `exe-zones` (30 zones: tables vs archives),
  plus the checks of the other sections. `npx tsc` must pass.
* **Optional export for checking**: `node tools/export-obj.mjs <zone> [--mesh meshes/SeaBed.msh] [--out /tmp/le2-obj]` writes OBJ + MTL + PNG textures under `/tmp` only.

---------------------------------------------------------------------------------------------------------------------------

## 10. Still unknown / next steps for the engine

See the end of each section; the main open items from the lead's part:

* Role of the second per-part list pointer `DAT_00983824[k]` and of `model.flag` (last `FUN_0043ec10` argument; 0 in all but a few places).
* Texture list entries beyond the mesh's group count (10-entry lists for 6-group minifig bodies).
* `.wib` playback rate / which code advances `WIBF`'s sequence; the `text.txl` bit 2.
* The sea/sky set-up numbers (scale of `SSEA`/`SSKY`, wave animation `SeaAmin.c`), water blend render states; the game sets render states (alpha test/blend) in the material layer (`Material2.cpp`): per-group flags only give the pass order.
* The zone code also contains per-zone logic (`GameLoop.c`, `StartCSM.c`, `Bunny.c`, `BrickBot.c`, ...): what runs when is not covered here. The record table says what exists, the logic decides what is visible
  (hidden at start: collectible pages, pizzas, skateboard, helicopter...), what moves, and which `.blk` clip each model plays (`FUN_0043f1d0`).
* Other builds of the EXE (English etc.): the table extraction depends on the helper addresses in `PROFILE_NL`; a signature-based profile discovery would remove that.
* Next for the engine work: animation player on top of `sampleBlk` (clip tables per zone are in the anim fragment), collision from `.col` (fragment), cutscene runner for the `.cut`/`.txt` scripts (fragment),
  the `Overlays`/`menu` texture sets for the 2D UI, sound (fragment).
