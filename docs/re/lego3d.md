# LEGO 3D: the game rebuilt from real LEGO parts (optional, generated in the browser): inventory, pipeline, results, licence

Players find LEGO Island 2 flat next to LEGO Island 1. The idea: the game's meshes are already (stylised) LEGO parts, so rebuild them from the real LEGO part models of the LDraw library and keep everything
the game does with them (skeletons, animations, bone attachments, LOD distances, texture slots, collision, waypoints), then map the game's OWN textures onto them at run time.

**Status (full build).** Sections 1-7 are the pilot (a hand-built mod folder: Pepper, a jet ski, 14 bricks, 10 textures, studs on the jetties) and its findings, which everything else builds on; **section 8 onwards is the full build**:
a built-in start-screen option **"LEGO 3D"** (default OFF) that assembles the upgrade **in the player's browser** from an LDraw-derived data pack (~2 MB, hosted with `ATTRIBUTION.txt`) plus the player's own game files:
characters (section 9), the brick library (10), 4x stud / brick-wall textures (11), real 3D studs (12), the OMR set models (13), QA and performance (14), what is not done (15), the tables behind it (`docs/re/lego3d-tables.md`).
Everything lives in `tools/lego3d/` (builders, tests helpers, scene drivers), `src/mods/lego3d/` (pack reader, generators, runtime, option UI), `tools/tests/lego3d-*.mjs`, plus tiny inert hooks
(`src/viewer/data.ts`, `src/mods/overlay.ts`, `src/formats/bricks.ts` sidecar, `src/display.ts` preference, `src/main.ts` option). The pilot numbers below come from the pilot tools; the full build's numbers are in the later sections.

The data lives outside the repository in `~/Documents/legoeiland2-extract/lego3d/` (inventory JSON, previews, shots, proof sheets, pack parts) and `~/Documents/legoeiland2-extract/mods/` (local mod folders written by `tools/lego3d/build-mod.mjs`).

## 1. What the game's models turned out to be (facts the pilot relies on)

* **Characters share a handful of bodies.** 96 characters have head meshes (`<PREFIX>_<LOD>head`); their bodies (`MFG_`, `PEPP_`, `PEP_`, `BB_` ... `_HR/_MR/_LR/_SLR/_BGR`) are only **8 unique HR meshes** (by content hash): 552 triangles
  (MFG, PEPP and 2 more: identical topology and groups, only the per-character texture list differs), 762 (the Brickster), 1098 (skeleton / mummy), 1404. The body is one skinned mesh of **9 groups**: group 0 = every limb /
  hips in the base colour (texture 374 for Pepper: blue), group 1 = the torso (371: red), then the **decal groups** (prints on torso, thighs, knees, socks, arm bands: a few flat quads each, with their own textures).
  The texture slot of a group is fixed by the model's texture list *per LOD part*, and the groups of MR / LR / SLR come in another order than HR (`PEPP_HR` [374,371,377,378,379,380,381,382,383], `PEPP_MR`
  [374,371,377,380,378,379,382,384]): a replacement must follow the list of the LOD it replaces.
* **Skin weights** (`SVWL` + `AVW2`): LEGO parts are rigid in the model, the bone blends sit at: torso bone 0 up to y 1.62 (bind pose, game units), blending to bones 3 / 8 (0.7 / 0.3 at 1.98, 0.2 / 0.8 at 2.55, bone 8 from 2.84);
  arms bone 11 / 12 down to 2.43, 50 % forearm bone 13 / 15 at 2.04, forearm below 1.77; legs thigh bone 1 / 2 down to 0.81, knee bone 4 / 6 blended in (0.8 at 0.41), shoe bone 5 / 7 below 0.31; hips bone 0. (Read from the
  original's vertices; `tools/lego3d/pepper.mjs` `SKIN`.)
* **Head**: a separate attachment on bone 10 (`FaceSetup` type 1): group "473" is the face, a 16-frame `.wib`; the engine scales its UVs x4 about v = 1 (`FACE_WIB_SCALE`), so the mesh stores the face in the top-left quarter
  (u 0..0.25, v 0.75..0.98). The face covers x +-0.35, y 0.30..0.92 of the head (head body: 0.98 wide, 0.95 high, in bone-10 space). Hair is group 371 of the head, the hat a separate attachment (bone 10), hands bones 14 / 16, backpack bone 8.
* **Scale**: bricks (`Bricks/lods/*.msh`) and the set models in the buildings / vehicles are **exactly LDU x 0.04** (a stud pitch of 20 LDU = 0.8; brick height 24 LDU = 0.96, stud 4 LDU = 0.16). The island's jet ski
  (`z02LGI Jetski_group1..5`, 7.14 long) is the official set model 6415 *Res-Q Jet-Ski* at 0.04 (same wedge plates, handlebar, 180 LDU long), simplified (no studs, other panels).
* **Bricks are drawn with a palette cell**: the FX_Bricks code writes the UV of the colour into every vertex (`brickPaletteUv`, the 64x64 `Bricks/text000.tga`: 8x8 px cells), so brick meshes need no UVs; the
  first-colour count of a two-colour brick is `vertexCount - secondColour` (`BrickLibrary.splitOf`), so only single-colour bricks may change their vertex count freely.
* **Lighting is on the CPU per vertex** (`src/render/meshlight.ts`, exact): geometry with other normals than the original shades differently. The head / hands of the pilot take the original's normals (nearest 4 vertices)
  so they keep the original's cartoon shading.
* **Winding / axes**: game = left-handed, +Y up, the front of a character +Z, triangles with `(b-a) x (c-a)` along the outward normal. LDraw = right-handed, -Y up, front -Z. The pilot maps `p = -(x, y, z)`
  (a reflection: triangles are re-wound) and the character's right arm (`3818`) lands on +x.

## 2. Inventory

Method: `node tools/lego3d/inventory.mjs` (all 10,731 `.msh` of the 39 archives, classified by name + skin data, hashed, scored for studs: vertices on a 0.24 ring around the 0.8 stud grid),
`textures-inventory.mjs` (every texture a mesh group uses, via the zone tables of the EXE: size, flat / periodic by autocorrelation, tiling, stud meshes), `bricks.mjs --verify --all`.

### 2.1 Meshes

| class | files | unique (content) | median tris | LDraw part(s) | mapping of the game's texture |
|---|---|---|---|---|---|
| brick library (`Bricks/lods`) | 693 | 692 | - | by name: `3001`, `3004`, `3022`, `3039` ... (section 2.3) | palette cell (no UVs) |
| minifig body | 350 | 75 (8 HR bodies, section 1) | 234 | hips `3815b`, legs `3816`/`3817`, torso `973`, arms `3818`/`3819` | groups 0 / 1 flat colour (one UV point); decal groups kept |
| minifig head | 1743 | 65 | 104 | `3626b` (+ `3626bpNN` prints) | face group: planar front band, UV = the game's face frame (see 3.1); skin: flat |
| minifig hand | 715 | 57 (40 within 0.08 of the standard 0.52 x 0.70 x 0.52) | 42 | `3820` (claw only, peg cut) | one flat colour |
| minifig hair | 1389 | 80 | 104 | family: `3901`, `4530`, `92081` ... | flat colour (hair group of the head or own mesh) |
| minifig headgear | 1585 | 127 | 71 | family: caps `4506` (`4485` is obsolete), police hat `3624`, helmets `3833` `3834` `3844` `3896` `3842a`, top hat `3878`, tricorne `2544` | flat colours + the print on the front (decal group) |
| minifig accessory | 339 | 30 | 41 | backpack `2524`, quiver `4498`, loudhailer `4349`, tools `3836` `3837` `3841` `3848` | flat colours |
| creatures (skinned, other rigs) | 37 | 16 | 472 | none (horse, dinosaurs, monkeys: no LDraw part; some LEGO animal parts exist) | - |
| other (buildings, vehicles, scenery, effects, props) | 3794 | 1830 | - | sets (2.4) | see 2.2 |
| LOD-named leftovers | 86 | 24 | - | - | - |

Of the 1830 unique "other" meshes **1061 carry stud geometry** (>= 8 ring vertices), **726 distinct model names** (island: garage, shop01/02, house01-03, housePEP, hospital, control, space_control, locomotive,
loco_tender, Steam_Train, Heli_*, speedster, Jetski_group*, Ambulance, ...; the zones' temples, castles, planes...): these are real brick models, simplified.

Character parts measured against the LDraw parts (the numbers behind "mapping coverage"): bodies 8 / 8 HR meshes have the 17-bone minifig topology that the pilot's build keys on (the 4 identical-topology ones are
covered by the pilot build; the other 4 need the same pipeline with their group tables); heads 64 of 65 have <= 250 triangles and 43 of 65 are 0.9-1.0 wide (the `3626b` head body is 0.95 x 0.98 after fitting:
hair makes the rest wider); hands 40 of 57 within 0.08 of the standard size. Hair / headgear / accessories (237 unique meshes) are a *family* mapping: each needs an LDraw part chosen per character (about 35
distinct parts cover the ones that are real LEGO elements, the rest - turbans, fez, crowns of cloth, capes, skirts, dragon helmets - are modelled shapes without an LDraw part).

### 2.2 Textures that depict LEGO surfaces

4,116 textures are used by meshes of the zone archives (a texture id is local to its zone, many pictures repeat across zones). 1,136 are flat colours, 399 periodic. By the autocorrelation test
"period of half the tile only" **139 are stud plates** (a 2 x 2 stud tile at 16-64 px, in black, white, greys, red, blue, green, yellow, tan, soft or ring-outlined studs; island: #76 #84 #86 #138 #222 #259 #260 #268
#277 #284 #287 #288 #296 #331; Whack-A-Bot #2 blue, #3 red; castle, desert, dinosaur, temple zones have their own) and **brick walls** (dark #35 / z04IFC #55: 16 x 8 px bricks in running bond on a 128 tile, white z05WAB #16)
plus the minifig face sheets (`.wib` atlases of 4 x 4 faces: not surfaces). Painted content (signs, panels, windows, the colour / print tiles of characters) is not LEGO-surface. The first 96 candidates were
checked by eye (`inventory/tex-cand-*.png`): about 60 stud plates, 4 brick walls, the rest metal, wood, knit, face atlases.

### 2.3 The brick library (257 bricks, `brickset.txt`)

Names follow the game's grid: `fatWxD` = brick (72), `thinWxD` = plate (51), `flatWxD` = tile (7), slopes / wedges / roofs 38, windows 20 + windscreens 4, doors 6, cars 12, wings 7, props / wheels / hinges / bars / antennas
and a long tail (`dingy`, `hose_*`, `parasol*`, `track`, `winch`...). `brickmap.mjs` maps by rule to LDraw (bricks `3005 3004 3010 3009 3008 3003 3001`, plates `3024 3023 3710 3022 3020`, tiles, slopes `3039 3040 3297` ...)
and `bricks.mjs` **verifies by measurement** (bounding box to 0.045 and chamfer distance after the best of 24 rotations against the game's own LOD 0): **44 of the 64 table entries are verified, 8 do not match** (plates
4x4 and up have no studs in the game; `fat10x1` / `fat12x1` differ by 0.08), 12 are not in the game's set. So today **44 / 257 (17 %)** are mapped automatically; slopes, windows, doors, wheels and tiles
(about 100 more) have a standard LDraw part and need table rows; ~85 (cars, dinghy, hoses, specials) are custom or need a model.

### 2.4 Sets in the game (Brickset list "LEGO Island 2: The Brickster's Revenge", SJPlego) and LDraw models

The LDraw.org **Official Model Repository** (OMR, 1,468 sets read from library.ldraw.org) has seven of them (licence line of the files: `Redistributable under CCAL version 2.0` = CC BY 2.0): 6415 Res-Q Jet-Ski, 6666 Ambulance,
6479 Emergency Response Centre, 6397 Gas N' Wash Express, 7750 Steam Engine, 5935 Island Hopper, 5920 Island Racer. For the other ~25 no OMR model exists (community models may; unchecked, licence per model).
LE2 meshes found by name (to be confirmed visually, except the jet ski):

| set | LE2 model(s) | OMR | how well a set model could replace it |
|---|---|---|---|
| 6415 Res-Q Jet-Ski | z02LGI `Jetski_group1..5` (record JSKI); z07CSI `Jetski_group1..5` | yes (26 parts, 7.3k triangles) | **done in the pilot**: same set at 0.04, same groups / textures; panels differ (game: black wedge halves; set: black top), the game has no studs |
| 6666 Ambulance | z02LGI `Ambulance` | yes (93 parts, 48k triangles) | likely 1:1 at 0.04; recoloured |
| 6479 Emergency Response Centre | z02LGI `rescue` / `hospital` / `police` / `Heli_resq` | yes (373k triangles) | the game's buildings are simplified versions; check by bounding box |
| 6397 Gas N' Wash Express | z02LGI `garage` (LOD1-4) | yes (458k triangles unpruned) | large; needs hidden-face pruning |
| 7750 Steam Engine (+ 2585 Stationmaster) | z02LGI `locomotive`, `loco_tender`, `loco_carriage`, `Steam_Train` | yes (1980 12V set, 314k) | likely good |
| 5935 Island Hopper, 5920 Island Racer | z14OSD `RIPP_seaplane`, `airstrip_seaplane`; z02LGI / z16PYA `speedster_red` | yes | to check |
| 6332 Command Post Central | z02LGI `police`, `jail` | no | rebuild |
| 6456 Mission Control, 6455 Space Simulation Station, 6585 Hang-Glider | z02LGI `control`, `space_control`, `space_platform`, `space_tower`, `shuttle`; z40OGL centrifuge; z02LGI `microlight` | no | rebuild |
| 5928 Bi-Wing Baron | z22BIP / z13CAI / z14OSD `biplane`, `airstrip_biplane` | no | rebuild |
| 5975, 5955 (T-Rex, trapper), 5936 Spider's Secret, 5976 River Expedition, 5986 Amazon Ancient Ruins, 5978 Sphinx, 5988 Temple of Anubis, 2996 Tomb, 5919 Valley of the Kings | z23DIP, z17WAS, z22BIP `aztec`, z16PYA `sphinx` `pyramids` `temple_*`, z13CAI `temple`, z20DSP `BigTomb` | no | rebuild |
| 6559 Deep Sea Bounty, 6262 King Kahuka's Throne, 4950 Loader Dozer | z08BKD `wreck` `chesty` `clambot` `mask`; z22BIP; rock monsters | no | rebuild |
| 6098 King Leo's Castle, 6096 Bull's Attack, 383-2 Knight's Joust, 4811 Defense Archer | z07CSI `lioncastle` `LionCastle1-3` `bullcastle1/2`; z09JST `Bridge` `Decking` `Tent*` | no | rebuild |

## 3. Pipeline (`tools/lego3d/`)

| file | what |
|---|---|
| `lib.mjs` | game folder (`LE2_GAME`), scene tables from the EXE (`extractZone`), texture decode, PNG writer, contact sheets, **`LE2_MODS=dir,...` lays mod folders over the archives for every tool** |
| `ldraw.mjs` | own LDraw reader (no third-party code): sub-files, BFC (CCW / CW / INVERTNEXT), resolution `low` (`p/8`) / `std` / `high` (`p/48`), skip patterns, multi-part `.mpd` (`splitMpd`) |
| `geom.mjs` | rotations, chamfer distance, vertex-clustering decimation, crease-angle weld, plane splitting, closest-point / ray tests, hidden-face pruning |
| `mshwrite.mjs` | writer for `.msh`: VERT / normals / INDL / GRPL / GTOM+MATL / SVWL+AVW2; parsed back and validated with `validateMsh` after every write |
| `pepper.mjs` | Pepper: body (4 LODs), head, hands |
| `jetski.mjs` | island jet ski from OMR 6415 |
| `studs.mjs` | stud grids of the stud-plate records (from the texture mapping) + stud mesh from LDraw `stud.dat` -> `lego3d/studs.json`; drawn by `src/mods/lego3d/studs.ts` |
| `bricks.mjs`, `brickmap.mjs` | brick library meshes, verified by measurement |
| `textures.mjs`, `blender/lego_texture.py` | stud-plate and brick-wall textures at 4x, optional normal maps |
| `inventory.mjs`, `textures-inventory.mjs`, `modelio.mjs`, `preview-*.mjs`, `blender/preview.py`, `blender/montage.py`, `viewtex.mjs` | analysis and looking at things (bind pose / any clip frame, before / after sheets) |
| `pose-check.mjs`, `bench.mjs`, `compare-counts.mjs` | skinning stress test over all clips, CPU skinning cost, counts against the originals |
| `attribution.mjs` | writes `ATTRIBUTION.txt` from the LDraw file headers |
| `build-pilot.sh` | all of it into `~/Documents/legoeiland2-extract/mods/lego3d-pilot/` |
| `steps/pilot.mjs`, `steps/wab.mjs`, `steps/build.mjs` | headless browser scenes: shots at fixed cameras, render-time probe |

Setup: LDraw `complete.zip` (library.ldraw.org/library/updates/complete.zip, 147 MB) unzipped to `~/Documents/legoeiland2-extract/ldraw/lib/ldraw`; OMR `.mpd` files in `ldraw/omr/` (outside the repository).
Blender 5.2 headless: `/Applications/Blender.app/Contents/MacOS/Blender -b -P <script> -- args`. The mod is imported in the browser as a folder (start screen, "Mods") or by
`tools/lego3d/steps/pilot.mjs` (`MOD=<folder>`).

### 3.1 Pepper

1. Original in bind pose (clip 2 frame 0 of `MFIG.blk`, the renderer's `bindBones`), skinned with the game's own `skinPositions`.
2. Each LDraw part is mapped to the game's axes and **fitted per axis to the bounding box of the matching region of the original** (hips: bone 0, legs: bones 2/6/7 and 1/4/5, torso: group 1, arms: 11/13 and 12/15; solid
   groups only, so decals do not widen the boxes). **Arms** get their own x fit: the LDraw sleeve is 10.1 LDU wide and the shoulder hinge on top reaches 7 LDU further in, so the box fit made thin sleeves with a gap to the
   torso and the hinge notches showing ("holes in his shoulders"); now the sleeve gets the original's thickness (0.5) with its outer face on the original's outer edge, the hinge sits inside the torso. Hands: best of the 24 rotations by chamfer distance against the original hand (peg cut at LDraw z > 4, only the claw and a stub stay); the head body (LDraw y 0..24) to the
   original skin group. The LDraw minifig is 40 : 32 : 24 (legs : torso : head), Pepper 40 : 23 : 33, hence the per-axis fit; the cost is a few percent of shape (shoulders, torso 26 % shorter than LEGO).
3. **Skinning**: per LDraw part a rule of position only (`SKIN`: the bands of section 1). Triangles are split at the band edges so the blend has vertices to act on. (First try, "copy the weights of the nearest original
   vertex", tore thin geometry in motion: max edge stretch 12x against 3x; a 4-nearest average still 28x on decals; the rule gives median 1.4x, p90 2.8x, max 5.6x over 942 poses of all clips against the
   original's 1.8 / 2.4 / 3.8, `pose-check.mjs --all`.)
4. **Decals** (the prints on torso, thighs, knees, socks, arm bands): the original groups are kept (their UVs and textures are the game's), subdivided (longest edge <= 0.35 / 0.7 / 1.2 at HR / MR / LR), draped on the new
   surface by the closest facing triangle of the part they lie on (planar decals as one piece, +0.012 above it) and skinned with the rule of that part - so they move with the surface they sit on.
5. **Head**: LDraw `3626b` (skin 361), front band `|x| <= 0.35`, y 0.30..0.92 split off as the face group (UV = the face frame: `u/4`, `1 + (v - 1)/4` so that the engine's x4 gives the full frame), hair (371) and the other groups
   copied from the original head, normals of the original (lighting parity).
6. **Hidden faces** (inner walls, sockets) are removed per part only (a ray along the face normal hits another face *of the same part*): removing faces that merely another part covers left holes where a big torso side face is covered by the arm in part. **Winding**: all 199 files read are BFC-certified (`ldraw.mjs` reports uncertified geometry files: none), CW / INVERTNEXT / mirrored sub-files are honoured; the previews can be drawn with back-face culling (`preview-model.mjs --cull`) to see missing or inverted triangles: none in the parts used.
7. LODs: HR = LDraw standard resolution; MR = low-resolution primitives (`p/8`); LR = low + studs removed + vertex clustering; **SLR (70+) stays the game's own** (clustering at that size leaves holes). Hidden faces
   (inner walls, sockets, overlaps) are removed at every LOD (`pruneHidden`: a ray along the face normal hits another face).

### 3.2 Bricks, jet ski, textures

* Bricks: rotation by chamfer, scale 0.04, bounding boxes centred; LOD 0 = standard primitives, LOD 1 = low-resolution primitives, hidden faces removed; **no LOD 2 file** (the game's 12-triangle box stays; the
  mod contains none of the game's data). UVs are not needed (palette cell).
* Jet ski: OMR 6415 `jetski.ldr` (7,320 triangles, colours 14 yellow, 0 black, 7 grey, 15 white) at 0.04, best rotation by chamfer (0.28, the next 0.39), x / z centred and the lowest point on the original's. Groups per LOD
  follow the texture list (111 black, 126 yellow, 112 grey; grey / white -> 112, which in the original is a 3-vertex placeholder drawn with MATL entry 1: the geometry is pre-shifted by it); the "R.E.S.Q" decal (314) is the
  game's quad lifted onto the hull. LOD 0-2 replaced, LOD 3-4 (two-tone texture 292) stay the game's.
* Textures (`textures.mjs`): the **surface colour is the median pixel of the original (three numbers)**; the picture itself is rendered in Blender from LDraw geometry: stud plates = the middle 2 x 2 studs (40 LDU) of an
  8 x 8 plate (`41539`), orthographic from above, Cycles 48 samples with real ambient occlusion, one sun, 4x the original size (32 -> 128, 64 -> 256); brick walls = running bond of `3004` bricks with 1 LDU joints, rendered from the
  front at the brick's real proportions and stretched to the game's square tile (16 x 8 px bricks in 128 px = 40 x 20 LDU), 4x (128 -> 512, 64x32 -> 256x128). Output `.tga` (24 bit) with the same name in the
  mod folder; the UV mapping and wrap flags of the game stay. The render is normalised so its median pixel equals the surface colour. `--normals` also writes tile-wrapped normal maps from ray casts of the same view
  (`lego3d/textures/*_normal.png`; not used: there is no shader for them).

## 4. What the pilot shows

(Screenshots: `~/Documents/legoeiland2-extract/lego3d/shots/`, headless Chromium + SwiftShader, 800 x 600, muted, one mod import per run; `orig-*` / `r2-*` = `?mods=off`, `new-*` / `f2-*` = with the mod.)

All numbers: headless Chromium (SwiftShader, no GPU), 800 x 600, muted. Before = `?mods=off` (`orig-*`, `o3-*`, `p1-*`, `p2-*`), after = the mod (`new-*`, `g3-*`, `h1-*` .. `h3-*`). Sheets that put them side by side
(before left, after right): `~/Documents/legoeiland2-extract/lego3d/shots/final-pepper.png`, `final-studs.png`, `final-jetski.png`, `final-surfaces.png`; Blender previews of the bind pose / clip poses with and without back-face culling in `~/Documents/legoeiland2-extract/lego3d/preview/`
(`sh1.png` shoulders, `sh2.png` side / back / top, `cull.png` five views culled, `poses*.png` clip poses).

**4.1 Pepper** (`final-pepper.png`: front, running pose, back; `p1-*` / `h3-*`). The mod's Pepper is the LDraw minifig in the game's own proportions, animated by the game's own clips (all 317 clips of `MFIG.blk` pose it without tearing: max
edge stretch 5.6x against the original's 3.8x, median 1.44x against 1.84x). What is different and visible: claw hands with the real shape, the hip block with its studs and the gap between the legs, the torso and the sleeves with their
LDraw shoulder / hinge shape, a head with a stud and a flat front. The face (the animated `.wib`, all 16 expressions) and the prints (torso pizza, knee pads, thigh panels, socks, arm bands) are the game's own, draped on the new surface.
Problems found on the way and fixed: (1) *holes in the shoulders*: the LDraw arm is thinner than the game's and its hinge reaches into the torso; a first fit left thin sleeves with a gap and notches, and removing faces "hidden" by a
neighbouring part left a hole in the torso side where an arm covers a big face in part. Now: sleeve fit (section 3.1), hidden faces removed per part only, **small holes capped** (the torso's arm sockets show black once the game's
animation swings the arm out of them: `capSmallHoles`, 15 loops in the torso), checked from front / side / back / top and in poses with culling on. (2) *pale blue legs in motion*: the flat LDraw faces caught the skinned meshes'
specular term (the same lighting that gives the original its look); every solid part now takes the original's nearest normals (head and hands already did): dark blue legs, red torso, as before. (3) skin weights (section 3.1): the first
version tore. Honest assessment: **at the game's camera distance and 640 x 480 Pepper looks nearly the same as before**, a little more LEGO (hands, hips, shoulders), a few more polygons; the gain shows in close-ups and in
silhouettes, not in a big "wow". It is also not better everywhere: the sleeves are a bit narrower and the shoulders squarer than the original's rounded cartoon arms; the hat, hair and backpack are still the game's (the LDraw head
is wider at the top than the original's, hidden by the hair). The far LODs are bigger than the originals' (below).

**4.2 Stud plates and brick walls** (`final-surfaces.png` top: the bridge pier base and the dark wall behind; WAB: `wab-orig-3-play.png` / `wab-new-3-play.png`). The 4x renders keep the tile and the colour of the original; the studs are rendered
as a height field in Blender and shaded without a sun (dark foot, light rim: the game's own plates are shaded like that, and a baked sun reads as pits on a plate that the mesh maps rotated). Seams: none (tile-wrapped); the 4x size is
sharper and has more relief than the original at the same UV scale. On a stud plate seen at a grazing angle a texture alone still reads flat: hence 4.4.

**4.3 Bricks and the jet ski** (`final-surfaces.png` bottom: the foundation of Pepper's house falling into place, `b3o/build-orig-03.png` / `b3/build-new-03.png`; `final-jetski.png`). The 14 bricks have LDraw studs (24-48 triangles
each instead of the game's 8-10 per stud) and slopes; LOD 0 / 1 are replaced, the 12-triangle far box is the game's. The jet ski (set 6415) sits where the original does (rotation found by chamfer distance, 0.28) with LDraw's studs and
hull panels; it is bulkier (3.28 against 2.99 high, black hull slab) and sits a little higher on the water than the game's simplified version, whose black wedge halves are not in the set model: *a set model is not a drop-in
replacement*, the game's version is a recoloured, simplified build of it (section 2.4).

**4.4 Real studs on the dock and bridges** (`final-studs.png`: jetty seen from the jet ski, the same at the water line, and from the end of the plate; `p2-*` before, `h2-*` after). `studs.mjs` reads the stud grid from the texture mapping of
each plate record (one tile = 2 x 2 studs at the quarter points; stud pitch measured from the UVs: the jetty's is 1.0, bricks 0.8; the whole stud disc must lie on the plate: 806 studs on each jetty, 20-40 per bridge deck, 1,852 in
the island) and writes them with an LDraw `stud.dat` mesh (48 triangles at 16 sides, 24 at 8 sides) to `lego3d/studs.json` in the mod. `src/mods/lego3d/studs.ts` draws them every frame **like the game draws its brick effects**: vertices on the CPU,
the game's own light set (the specular variant of `lightShiny`), the brick palette texture cell of the plate's colour (blue / light grey: the edge strips get grey studs), preset 5, 4096-vertex batches. Per frame one stud mesh per (record,
LOD) is rotated and lit (24-48 vertices), every stud then copies it to its place: no per-stud transform or lighting. LOD by distance: 16-sided studs within 8 units, 8-sided within 22, none beyond (the texture's own studs remain there), at most
1,500 per frame. Numbers (frame at the dock / jet ski / grazing views): 313-390 studs, 13.1-16.0 k vertices, 6-7 batch draws, **+9.3 to +10.6 k triangles** on the frame (jet-ski view 42.9 k against 33.8 k; dock 45.8 k against 35.2 k); the JS side
of the frame (render call + `gl.finish`, 3 s median, min in brackets) 1.4-1.9 ms (1.3-1.7) against 1.6-2.0 ms (1.5-1.7) without the studs: **within noise**; the page's frame time (rAF median) 50-67 ms at 800 x 600 with the studs against 33-50 ms
without in the software-rasterised browser (SwiftShader draws the extra 10 k triangles on the CPU; a GPU does not care). Real studs at the water line / grazing angles: depth reads correctly, the rim and the flank are lit by the game's lighting
like every other brick. The painted stud rings of the texture stay under them as contact shadows. Limits: moving vehicles (helicopters, speedsters, the glider) are not done, only static plate records; the jetty has no LOD part of its own, so
the distance rule above is the LOD.

**4.5 Cost** (vertex / triangle counts from `compare-counts.mjs`, game -> mod): Pepper HR body 1,656 / 552 -> 4,591 / 4,323; MR 834 / 278 -> 3,205 / 3,010; LR 702 / 234 -> 1,774 / 1,425; SLR unchanged (456 / 152); head HR 405 / 235 -> 618 / 667;
hands 156 / 74 -> 209 / 191; jet ski LOD 0 485 / 267 -> 1,616 / 1,530; brick `fat4x2` LOD 0 296 / 204 -> 452 / 386. **The far LODs are not lighter than they should be (MR is 11x the original's triangles): the pilot's weak point; it needs a
real decimator (coplanar merge / quadric), see section 6.** CPU skinning per character per frame (`bench.mjs`, quiet machine, minimum of 3): HR 54 -> 170 us, MR 25 -> 111, LR 23 -> 59, SLR 18 -> 19. A frame with Pepper in front of the camera:
33.9 k -> 38.4 k triangles (+13 %), 969 draws against 963; JS time of the render call 1.9-2.5 ms against 2.3-2.5 ms; page frame time 33.3 ms (the 30 fps cap) with and without when the machine is quiet (the first runs showed 2x slower
frames with the mod: an installed HD pack and other agents' browsers on the same machine; always compare back to back). Size: the pilot mod folder is 2.3 MB (meshes 1.0 MB, textures 0.9 MB as TGA, bricks 0.36 MB, stud data 44 kB).

## 5. Licensing and what may be hosted

* **LDraw Parts Library**: every file carries `0 !LICENSE`: in the 199 files the pilot reads, 196 are CC BY 4.0, 2 "CC BY 2.0 and CC BY 4.0", 1 "CCAL version 2.0" (= CC BY 2.0; the OMR model 6415). Older headers say
  "Redistributable under CCAL version 2.0", which the library's `CAreadme.txt` defines as CC BY 2.0. Requirements (CAreadme.txt section 2): name the creator, give a URL for the work, name the licence, give a URL for
  the licence, note whether the work was modified. `attribution.mjs` writes all of it from the headers (authors, titles, licence line, the modifications: conversion, scaling / fitting, hidden-face removal, LODs,
  re-skinning) to `ATTRIBUTION.txt` in the mod. Commercial use is allowed. LDraw(TM) is a trademark of the Estate of James Jessiman; LEGO(R) is a trademark of the LEGO Group, "not sponsored or endorsed": say so.
* **May go into the repository / be hosted (GitHub Pages)**: `tools/lego3d/**`, this document, the attribution, and geometry that is derived *only* from LDraw (e.g. the brick meshes without the LOD 2 copy, the LDraw part
  fits as data) with `ATTRIBUTION.txt`. **May not**: any game texture (never baked: the minifig mapping points at the game's own texture files at run time; the stud / wall replacements are our own renders of LDraw
  geometry that use three colour numbers of the original, not its pixels - hosting these is fine, but a reviewer should confirm that three numbers are not "the art"), and the pilot's `.msh` files **as they are**:
  Pepper's meshes contain copies of the game's own geometry (hair group, decal quads, the LR head's other groups), the jet ski the game's decal quad, so the *mod folder* is local. A hosted variant must assemble
  at run time in the player's browser: ship the LDraw-derived geometry (fits, parts as compact data) and the generator code, read the decal / hair groups from the player's own archive and write the result into the
  mod layer's memory (`Archive.override`), never to disk or the server - the same rule the HD pack option follows (nothing of the game is hosted).
* Nothing GPL was vendored: LDraw reading, fitting and the writer are own code; the existing GPL tools (LI2GE, importers) were not used. Blender is used as a renderer only; its output is ours.
* The OMR model files (CCAL 2.0) and the library zip stay outside the repository (`ldraw/`), as the task asked.

## 6. Proposal and estimate for doing everything (the pilot's plan; the full build below follows it, with the changes listed in section 8)

Goal: every character, the brick library, the LEGO-built buildings / vehicles and the LEGO-surface textures of the game rebuilt from LDraw, as one optional "LEGO 3D" option (start screen, next to "HD-textures"),
on by default (off on weak devices), the original look untouched without it. What the pilot proved: the mod layer takes the new meshes as they are (no engine change), the skeleton / animation / attachments / LOD scheme / texture slots
survive, the original's textures map at run time, the cost is modest. What it did not prove: that the result is *dramatically* better (section 4), and the hosting route (section 5).

**Phases** (working days of one person who knows this code base; ranges, the first number if everything goes the way of the pilot):

| # | work | what exists | days |
|---|---|---|---|
| 1 | **Characters**: `pepper.mjs` generalised: group roles by index (0 = limbs, 1 = torso) instead of by texture id, so the 4 identical-topology bodies (MFG / PEPP / PEP and 2 more: 96 characters) are one build x 5 LODs (HR / MR / LR / SLR / BGR); the 3 other bodies (Brickster 762, skeleton / mummy 1098, 1404) with their tables; 65 heads (face frame mapping type 1 `.wib` and type 0 4 x 4 atlas of the other zones), 57 hands | body, head, hands for Pepper at 4 LODs, skin rule, decal draping, pose test over all clips | 8-12 |
| 2 | **Hair, headgear, accessories**: 237 unique meshes; a table of about 35 LDraw parts (hair `3901` `4530` `92081`, caps, police hat, helmets, top hat, backpack, quiver, loudhailer, tools) with their fits; the cloth / animal / fantasy shapes stay the game's | none (the head keeps the original hair) | 6-9 |
| 3 | **Bricks**: extend `brickmap.mjs` to the ~150-170 bricks that have a standard part (slopes, windows, doors, tiles, wheels, hinges, bars), verified by measurement as now; two-colour bricks (windows) need the first-colour vertex count (`splitOf`): one additive hook in `BrickLibrary` reading a sidecar number from the mod (about 1 day, mod-only); the ~85 specials (cars, dinghy, hoses) custom or left | 14 bricks verified | 4-6 |
| 4 | **Textures**: all 139 stud plates and the brick walls through `textures.mjs` (a per-texture table: studs per tile, colour; dedupe the pictures that repeat across zones, about 50 designs), review; tiles / grilles / other LEGO surfaces as found; normal maps are already produced | 10 textures, relief tuned | 2-3 |
| 4a | **Stud geometry** for every stud-plate record (the 1,061 stud meshes of the inventory, of which the plate surfaces of buildings, bridges, docks, the 139 stud textures): `studs.mjs` already handles any record with a stud texture on an upward face (static ones, 1,852 studs in the pilot); moving vehicles need the stud list to follow the record matrix (the draw already uses `rec.m`, a moving record just has more studs per frame to place); a per-zone hook (2 lines in each zone's effects pass, or one shared in `GameRenderer`); a per-frame stud budget and LOD tuning; the 8-sided and a 6-sided LOD | one island zone, 1,852 studs, 2 LODs | 4-6 |
| 4b | optional: **normal-map shader path** (per-pixel lighting only when the mod ships normal maps; the game's CPU vertex lighting stays the default and stays exact) | normal maps rendered | 4-6 |
| 5 | **Vehicles and buildings** (726 stud-bearing model names): the 7 sets that exist in LDraw's OMR (Jet-Ski done; Ambulance, Steam Engine + tender + carriage, Island Racer, Island Hopper, Gas N' Wash, Emergency Response Centre) 1-3 days each incl. pruning (the OMR models are 40-460k raw triangles, the game's models 1-6k) and LOD, ~10-15; the ~25 sets without an LDraw model: rebuild in an LDraw editor (3-5 days per large set) or keep the game's models and only add studs / replace textures | jet ski | 10-15 (OMR sets) + 40-100 (rebuilds, optional) |
| 6 | **Hosting**: an in-browser generator (TypeScript port of the generators, in a worker) that assembles the mod layer in memory from the LDraw-derived data pack (a few MB) plus the player's own archives (decals, hair, textures stay theirs), start-screen option + licence / attribution page, progress, caching of the result per version | the node generators | 8-12 |
| 7 | **QA**: pose test of every clip for every body, LOD silhouette / pop check (SLR and BGR stay the game's unless clustered with care), z-fighting of the draped decals, frame time on the real site, island / zone walk-throughs, the cutscene close-ups | `pose-check.mjs`, `bench.mjs`, the browser scenes | 5-8 |

Total for the character + brick + texture + stud + hosting core (phases 1-4a, 6, 7): **about 40-55 working days (8-11 weeks)**; with the 7 OMR vehicles / buildings about 50-70; every set rebuilt by hand
would add 8-20 weeks and is better treated as a community-content question (models contributed to LDraw under CC BY would be hostable).

Risks / decisions: (a) the look: with the game's flat per-vertex lighting and 640 x 480 the gain is mostly in silhouettes (hands, hips, studs, stud-textured plates, bricks) and close-ups; a shader with real lighting
would be the bigger step and conflicts with "exact to the original"; (b) triangle budget: the pilot's Pepper is 7.8x the original in triangles at HR (+13 % per frame in the close-up, the island with 30-60 characters in range
would be about +15-30 %); MR / LR / SLR must be cut hard with a real decimator (the pilot's MR is 11x the original, LR 6x) and the HR build should drop to about 2,500 triangles (the hole caps and the per-part hidden-face rule cost about 1,700); (c) the hosted route needs the generator to run in the player's browser (the mod folder as built here contains pieces of the game's own geometry); (d) 4 of 8 bodies and the
non-human skeletons (animals, dinosaurs, monkeys) have no LDraw counterpart and stay as they are; (e) a few LDraw parts used (`3816`, `3817`, `3815`) are marked obsolete in the library (same mould, newer numbers exist).


## 7. What the engine needed (additive, only with the mod) - and what it did not

Meshes, textures and bricks: nothing. The mod layer replaced archive members as it is; higher vertex counts (Pepper's HR body 2,937 vertices against 1,656; 16-bit indices per group are plenty), the same groups / slots, `GTOM` / `MATL` copied, skinned
meshes with `AVW2` extras all went through unchanged. Not done and possibly needed later: per-pixel normal maps (a shader path with lights), mip maps / anisotropy for the 4x textures (the HD pack's `isUpscaled` rule
already turns them on for any mod texture larger than the original), and an in-browser generator for hosting (section 5).

**The one engine addition (stud geometry, section 4.4)**: `src/mods/lego3d/studs.ts` (new file) and, in `src/zones/z02LGI/index.ts`, `loadLegoStuds(ctx.archive)` plus one call in the island's `effects` pass (the pass that draws the brick effects); `loadLegoStuds` returns null unless the zone's archive has the member `lego3d/studs.json` (only a mod can add it), then `drawLegoStuds` is never called and the draw is byte-for-byte what it was. Other zones would need the same two lines.


## 8. The full build: architecture, hosting and the option

The pilot (sections 1-7) built a mod folder with node and Blender and carried pieces of the game's own geometry. The full build turns that into a **built-in option "LEGO 3D"** with the same
hosting rule as the HD option: nothing of the game is hosted. Two layers:

* **Data pack** (`src/mods/lego3d/data/lego3d.pack`, built by `node tools/lego3d/pack/build-pack.mjs`; ~1.1 MB, served by Vite as a hashed asset next to the app, with `ATTRIBUTION.txt`): only LDraw-derived geometry
  (fitted, simplified, skinned by position rules), our own Blender renders, numbers measured from the game (boxes, fits, tables of member names, texture ids, content hashes). Container `LG3P`
  (`pack.ts`: index JSON + raw-deflate blobs, read with `DecompressionStream`; writer `tools/lego3d/pack/packfile.mjs`). Builders per area `tools/lego3d/pack/<id>.mjs` (`textures`, `bricks`, `chars`, `sets`, `studs`)
  write their blobs to `~/Documents/legoeiland2-extract/lego3d/pack-parts/<id>/`; the merge step writes the pack and `ATTRIBUTION.txt` (every LDraw file / OMR model used, authors, licence lines, modifications).
* **Generators** (isomorphic TypeScript, `src/mods/lego3d/gen/{textures,bricks,characters,sets,studs}.ts`, interface `gen/types.ts`, runner `gen/index.ts`): pack + the player's own archive -> replacement members.
  Order: textures, bricks, characters, sets, studs (the studs never touch a member an earlier generator wrote). Each generator keys on the CONTENT hash of the member it replaces (recorded in the pack): a member the
  player's own mod replaced does not match and stays untouched; any failure keeps the original member (never throws a zone). Decals, face groups, hair groups and texture colours are read from the player's archive at run time.

**Run-time path** (`src/mods/lego3d/{runtime,hook,ui,packurl}.ts`, `src/mods/overlay.ts` `ModdedFiles.generateOverrides`, `src/viewer/data.ts` `FileSource.generateOverrides`):
`GameData.archive()` calls the generator after the mods' own files are in an archive (so LEGO 3D's textures win over an HD pack's) and puts the result into the archive layer (`Archive.override`, memory only; zone
archives let go of it with the zone, like mod files). The generated members of an archive are cached in OPFS `le2-lego3d/<archive>.l3d` (key = pack version + a fingerprint of the archive's member list + generator switches), the
pack itself in Cache Storage `le2-lego3d`. **Never blocks play**: the pack is awaited at most 8 s at game start, otherwise the game starts without it; a failing archive stays original.

**Option** (`ui.ts`, start screen under "HD-textures"; Dutch label "LEGO 3D"): stored as `lego3d` in `le2-display` (`?lego3d=1|0` for one visit, `?lego3d=chars,-studs` = only / without those generators, for tests).
**Default: OFF** (an explicit decision: it changes the look away from the original and costs frame time; the original look stays the default). Device guard (`judgeLego3d`): phone / tablet, < 4 GB memory or <= 2 cores
get a confirm that names the reason, the box stays selectable. Checking fetches the pack (shows size), unchecking removes the cache. With the option off (or `?mods=off`) `attachLego3d` is never called, `GameData`
sees no `generateOverrides` and takes exactly its old path: no wrapper, no extra file lookups (`window.__le2Mods` and `window.__lego3d` stay undefined; test `tools/tests/lego3d-runtime.mjs`).
Licences: the pack's `ATTRIBUTION.txt` is linked from the option ("Bronnen en licenties").

Tests: `tools/tests/lego3d-*.mjs` (all run in `node tools/test-formats.mjs`; they skip with a note without the pack / game folder). Browser scenes: `tools/lego3d/steps/l3d.mjs` (the real option: `PARAMS='&hd=0&lego3d=1'`,
`BASE=<snapshot server>`), headless and muted through `sh tools/m5-botslot.sh node tools/browse.mjs ...`. Node build for looking at things: `node tools/lego3d/build-mod.mjs` (the same generator over the game folder, writes a
mod folder; local only, contains game pieces).

## 9. Characters (minifigs: bodies, heads, hands, gear)

Built by `tools/lego3d/pack/chars*.mjs` (builder, node) and assembled at run time by `src/mods/lego3d/chars/*.ts` + `gen/characters.ts` (isomorphic). Two-layer rule as everywhere: the pack holds LDraw-derived positions / indices / groups / bone weights only (no UVs, no normals, no game geometry; `tools/tests/lego3d-chars-audit.mjs` decodes every blob, checks its byte size against the format and looks every triangle up among the triangles of all game meshes: 5 of 26260 coincide on a 0.01 grid, worst blob 1.1 %). The assembler is keyed by the content hash of the player's mesh; unknown content is left alone, any failure is logged and the original stays. UVs and normals come from the player's own mesh (nearest facing surface), so the game's face / torso / hair textures, groups, materials, bone pivots and animations are untouched. Chars part of the pack: about 0.4 MB raw (bodies 88 KB, statics 232 KB, tables 68 KB) plus the gear blobs. Every LDraw part used is recorded with `ctx.use` for `ATTRIBUTION.txt`.

### What exists in the game (inventory: `tools/lego3d/chars-inventory.mjs`)

96 character models in 87 distinct head prefixes ("characters" below), 8 unique HR bodies, 65 heads, 57 hands, 237 hair / headgear / accessory meshes. `chars-coverage.mjs` lists, per body content hash, the characters and LODs; `chars-table.mjs` writes the per-character table (below).

### Bodies (HR, MR, LR, SLR, BGR LODs; triangles original -> LDraw-derived)

| body (hash) | characters | HR | MR | LR | SLR | BGR | how |
|---|---|---|---|---|---|---|---|
| MFG (241310a8..) | 69 | 552 -> 448 | 278 -> 216 | 234 -> 216 | 156 -> 144 | 110 -> 96 | per-part loft, painted decals |
| PEPP (Pepper) | 2 | 552 -> 544 (round 3; 813 before) | 278 -> 278 | 234 -> 220 | 152 original kept | - | per-part loft, prints painted into the surface |
| BB (Brickster-bots) | 4 | 762 -> 464 | 498 -> 216 | 302 -> 216 | 234 -> 216 | 126 -> 112 | per-part loft |
| Space_pep_white | 3 | 552 -> 546 | - | - | - | - | like PEPP, overlay groups left out |
| SKEL_HR (skeleton) | 1 | 1098 -> 2562 (round 3; 871 before) | | | | | LDraw skeleton parts 6260 / 6265 / 6266 taken apart into rigid pieces, see Round 3 |
| MUMM_HR (mummy guards) | 1 (15 models) | 1098 -> 2534 | | | | | same skeleton shape |
| MUM_HRbody (diver, PEPD rig) | 1 | ORIGINAL | | | | | non-human skeleton / different rig: kept |

Every LOD <= the original's triangle count (tests assert it per member); the only HR above the original is PEPP (717 vs 552, 1.30x) because the prints are painted into the surface (see below). Measured frame cost of that is in the performance section: the CPU skinning of PEPP_HR is 42 us against 39 us (+8 %, 1170 vertices against 1656), i.e. nothing.

Method. Body = per-part loft (rings of K points at skin-plane levels, sliced from the LDraw part: watertight, exact on the skin planes), not quadric edge collapse (the open LDraw shells leave spikes and holes). Skin weights are position-only ring rules measured from the original's weights; candidates (ring counts 2..9, minimum gaps) are scored against the original's stretch and drift over posed frames, penalty 50*(max(0,max/orig.max-1)+max(0,p90/orig.p90-1)) + 10*drift + 0.05*max. "Painted" decals: the decal textures of the game are opaque, so in the original the print is part of the surface. The triangles inside the footprint of the original decal get the decal's group (cut along the footprint planes, T-junction free, coplanar slivers merged again with `mergeFlat`), so the print cannot hide behind the surface in a pose (this was the main bug of the first version: decals were buried by the new shape). Overlay decals that stay (arm bands at LOD > 0) ride their host triangle exactly (`rideSkin`: one influence per bone with its own bind point, AVW2 extras carry the local positions). The game rotates ONE stored normal by every influence and sums them, so the assembler stores n*M^-1 normalised (`Rig.normal`).

### Round 2: richer HR / MR bodies (default) and the decimated variant

New rule: triangle counts are not forced to the original's. HR bodies keep the detail of the LDraw parts (hidden faces / insides already removed by `cleanPart`: `visiblePrune`, plane caps, small-hole caps), MR up to 1.5x, far LODs (LR / SLR / BGR) stay decimated and <= the original. Builder switch: `CHARS_BODY=decimated node tools/lego3d/pack/build-pack.mjs --only chars` builds the round-1 decimated variant (loft K 8 / 4 points, 2 torso levels); the default is `rich` (`RICH`, `RICH_HR`, extra rungs at the top of `LOFT_LADDER` in chars.mjs). What changed in the loft: 12-point arms, 8-point legs, torso / hips with chamfered rectangles (`bevel` 0.06, so the flat faces keep flat vertex normals: this removed the glossy-gradient look of the Brickster-bot torso), rings at every shape change (tol 0.004) and a ring pair at every jump of a leg (shoe toe step, which the first rich build slanted into a ramp), squareBottom heads.

Triangles per body / LOD, three variants (original / decimated round 1 / rich default). The raw LDraw parts after hidden-face removal are 1541 triangles at standard resolution (1041 low, 2949 high) before the cuts at the skin planes and the prints; the lofts are slices of those parts.

| body LOD | original | decimated | rich (default) | CPU skin us/mesh original | decimated | rich |
|---|---|---|---|---|---|---|
| MFG_HR | 552 | 448 | 1232 | 51 | 13 | 34 |
| MFG_MR | 278 | 216 | 384 | 27 | 6 | ~17 |
| PEPP_HR | 552 | 717 | 813 | 52 | 42 | 50 |
| PEPP_MR | 278 | 278 | 332 | 24 | 14 | 22 |
| BB_HR | 762 | 464 | 992 | 73 | 13 | 39 |
| BB_MR | 498 | 216 | 736 | 53 | 7 | 29 |
| Space suit | 552 | 546 | 1054 | - | - | - |
| LR / SLR / BGR | as table above, unchanged (<= original) | | | | | |

(us from tools/lego3d/bench-chars.mjs, minimum of 5 rounds, the decimated column from the round-1 run on a quieter machine: absolute values drift with load, ratios hold.) The rich bodies skin FEWER vertices than the original (the original splits vertices for its UVs: MFG_HR 1656 vs 1038), so CPU skinning per mesh stays at or below the original at every LOD: no CPU argument against the rich default. Skeleton / mummy stayed 871 (not enriched).

Skinning of the rich bodies over all 509 clips (median / p90 / max, original -> rich): MFG_HR 1.62 / 3.04 / 5.89 -> 1.40 / 1.96 / 4.01; MFG_MR 1.29 / 1.66 / 3.00 -> 1.16 / 1.36 / 2.15; PEPP_HR 1.80 / 2.38 / 3.32 -> 1.30 / 1.58 / 2.81; PEPP_MR 1.24 / 1.80 / 2.97 -> 1.08 / 1.50 / 2.20; BB_HR 1.68 / 2.77 / 3.58 -> 1.35 / 1.72 / 3.04; BB_MR 1.91 / 2.82 / 4.33 -> 1.36 / 1.73 / 3.04; space 1.85 / 2.43 / 4.35 -> 1.26 / 1.59 / 2.03. Still better than the original in every statistic. (The decimated variant is lower still, e.g. MFG_HR max 1.99.)

Tried and rejected in round 2 (measured): painting the wrap decals (Pepper's arm bands) at HR: PEPP_HR becomes 1078 triangles but its max stretch is 3.38 against the original's 3.32 (p90 2.23 vs 2.38): "no worse than the original" fails, so the arm band stays an overlay at HR. HR gear at 3x instead of 2x: the INFO / NICK flat caps (the two 'rumpled' denials) still come out rumpled (looked at in the engine), and 3x for all accepted HR gear triples their cost (8070 -> 19612 triangles) for no visible gain; reverted to 2x, the two caps are denied again with that reason. Run-time path (`?lego3d=1`, whole generator set): the z02LGI opening cutscene (INFO with the cap, then Pepper) and the plaza scenes look the same as the baseline except for the known differences; the frame time of those scenes is dominated by the bricks generator (111k vs 34k triangles in the plaza), not the characters.

Weak spots found in round 2 (the skeleton and the arm band are fixed in round 3, below): the skeleton's rib cage is too small and sits low (the neck tube shows above it); it was also not enriched. The arm band of Pepper is still an overlay with jagged edges at HR. Hips of the robots are a plain plate (the original has a crotch gap).  (The MR shoe toe step was missing in the first rich build; fixed with leg ring cap 8 and jump rings.)

### Skinning, no worse than the original (all clips of every rig used), round 1 (decimated) numbers

`tools/lego3d/pose-check-chars.mjs`: 509 distinct MFIG clips over all zones, every 3rd frame = 8336 poses per body; mesh edge stretch (pose length / bind length) median / p90 / max, original -> mod:

| body LOD | tris | original | mod |
|---|---|---|---|
| PEPP_HR | 552 -> 717 | 1.80 / 2.38 / 3.32 | 1.34 / 1.62 / 2.67 |
| PEPP_MR | 278 -> 278 | 1.24 / 1.80 / 2.97 | 1.10 / 1.54 / 2.31 |
| PEPP_LR | 234 -> 220 | 1.20 / 1.51 / 2.19 | 1.09 / 1.53 / 2.18 |
| MFG_HR | 552 -> 448 | 1.62 / 3.04 / 5.89 | 1.24 / 1.57 / 1.99 |
| MFG_MR | 278 -> 216 | 1.29 / 1.66 / 3.00 | 1.24 / 1.49 / 2.17 |
| MFG_LR | 234 -> 216 | 1.22 / 1.43 / 2.41 | 1.13 / 1.28 / 1.65 |
| MFG_SLR | 156 -> 144 | 1.19 / 1.38 / 2.22 | 1.16 / 1.34 / 1.66 |
| MFG_BGR | 110 -> 96 | 1.19 / 1.40 / 2.23 | 1.07 / 1.18 / 1.55 |
| BB_HR | 762 -> 464 | 1.68 / 2.77 / 3.58 | 1.17 / 1.40 / 1.75 |
| BB_MR | 498 -> 216 | 1.91 / 2.82 / 4.33 | 1.12 / 1.27 / 1.72 |
| BB_LR | 302 -> 216 | 1.35 / 1.86 / 3.43 | 1.12 / 1.27 / 1.72 |
| BB_SLR | 234 -> 216 | 1.23 / 1.47 / 2.43 | 1.12 / 1.27 / 1.72 |
| BB_BGR | 126 -> 112 | 1.25 / 1.50 / 2.47 | 1.10 / 1.24 / 1.56 |
| Space_pep_white | 552 -> 546 | 1.85 / 2.43 / 4.35 | 1.24 / 1.57 / 1.99 |
| SKEL_HR / MUMM_HR | 1098 -> 871 (round 3: 2562) | 1.13 / 2.01 / 2.66 | 1.40 / 1.78 / 2.47 (round 3: 1.07 / 1.25 / 1.27) |

Worse than the original in round 1: only the skeleton MEDIAN (1.40 against 1.13; p90 and max are better; fixed in round 3). The skeleton is rigid per region with a short linear blend band at each joint; the original has no blend at all, so its median edge is a bind length edge. Nothing tears (max stretch below the original everywhere). PEPP_LR p90 1.53 vs 1.51 is noise level.

Decals hidden behind the surface (`decal-check.mjs`, area share of the decal that is occluded over the poses, median / p90 / max): PEPP_HR original 16.9 / 42.8 / 73.5 %, mod 16.6 / 46.5 / 62.3 %; PEPP_MR 11.1 / 26.4 / 34.9 -> 7.3 / 19.2 / 58.3; PEPP_LR 10.5 / 27.8 / 36.9 -> 5.1 / 19.3 / 69.6 (the maxima are single frames of the extreme arm clips; the original has them too). MFG and BB have no decal groups.

### LOD pop (the jump of the surface where the game switches LODs)

`tools/tests/lego3d-chars-lod.mjs`: symmetric mean nearest-surface distance between consecutive LODs, converted to pixels at the switch distance (LOD parts start at 20 / 40 / 70 / 100 units, 60 degrees, 600 px high). Test limit: mod must stay below 1.5 px and below 1.2x the original + 0.4 px. 11 families (3 bodies, 3 heads, 2 hand families, hair, helmet) = 32 pairs, all pass; worst mod pop 1.38 px.

### Skeleton and mummy

SKEL_HR / MUMM_HR are flat white single-group rigid models on the MFIG rig. The LDraw minifig skeleton parts (torso with ribs and pelvis 6260, arm 6265, leg 6266) are fitted to the regions of the game body (best of the 24 rotations by chamfer distance after a box fit); arms and legs are lofts (K 8 / 6 points, 7 / 8 levels, a ring on each side of the joint band), the torso is decimated with the joint planes locked. Rigid per region, blend band `ramp` each side of the joint (torso 0.18, arms 0.12, legs 0.12).

### Round 3: arm band and skeleton

**Pepper's arm band (HR).** Cause of the jagged band: the band is two decal groups of the game's mesh (g6 = the back strip, g8 = the strips around the front and sides, textures 381 / 383) that share their edges; at HR g8 stayed an overlay draped on the 12-sided loft arm (original band: 10 quads, outer face slanted with the arm), and its ragged boundary, cut by one plane per boundary segment, never lined up with the loft. Painting it as a wrap (as at MR / LR) failed the old way for the same reason (every ragged segment its own cut plane: 1078 triangles with zigzag edges). Now (`chars-paint.mjs` `bandPlanes`, `bandLevels`, `bandGroups`; `chars.mjs`): decal groups that share an edge form ONE band; its two closed edge rings are cut by one HORIZONTAL plane each (the original's tilt is 0.03 over the band width), the group border by one wall; the arm loft gets a ring exactly at both heights (`buildLodGeometry` `bandY`), and every triangle of a host part between the two planes is tagged with the group of its nearest band triangle (`tagTri`), so the band is a clean strip of quads with no overlay shell, no z fight and welded edges. Wraps are painted at every LOD now (HR too). Scoring (`score`) compares a painted band's stretch also with the original WITHOUT the band (the stricter bar).
Numbers (all 8336 poses): PEPP_HR 552 -> 544 triangles (813 before), stretch median / p90 / max 1.16 / 1.45 / 2.01 against the original 1.85 / 2.43 / 4.35 (band included in both) and against 1.80 / 2.38 / 3.32 for the original without the band; round 2 had 1.30 / 1.58 / 2.81 with the overlay left out of the measurement. MR / LR unchanged (332 / 220 triangles, 1.08 / 1.50 / 2.20 and 1.09 / 1.53 / 2.18). Looked at: raster close-ups (`scratch/round3/band-orig.png` / `band-C.png`, the band in red / blue) and in the engine (`scratch/round3/shots/newB-z02LGI-PEPP-58_10-three2.0-L0.png` against `orgB-...`): a clean grey ring around the sleeve.

**Skeleton / mummy.** Cause of "too thin", the small rib cage and the stretch: the first build box-fitted the whole 6260 part (neck tube and shoulder pins included) to the torso region, which squeezed the ribs low and left the tube above them; arms and legs were lofts (blobby, spiky); every region had a soft ramp (median 1.40). Now `chars-skel.mjs` takes the LDraw parts apart into their rigid pieces (components): rib frame + spine rod -> bone 8, pelvis -> bone 0 (coil rings, neck tube, shoulder pins dropped: the game has none), arm clip + rod / collar + shaft (hand block dropped: the game's hand is its own mesh), leg clip + shaft + collar / foot block; each piece is warped by anchor levels (where the game's pieces start and end, read off the game's mesh) and half widths measured per level, so every piece is as wide and deep as the game's (rib frame +-0.65 x +-0.255, thigh bulb 0.46 x 0.52, collar, foot 0.60 x 0.70 ...; the silhouette per 0.1 slab agrees within about 0.05 everywhere; the arms follow the lean of the game's arm). Skin: every piece rigid on its bone (the game's elbow bone sits exactly on the collar's top face), only the shaft between the leg's collar block and the foot is a soft bridge (as the game's own 0.07 bridge). A soft arm rod measured 1.25 median, so the rod stays rigid (the elbow hinges at the collar like the LEGO part). Stretch over all 509 clips: median / p90 / max 1.07 / 1.25 / 1.27 against the original's 1.13 / 2.01 / 2.66 (SKEL_HR and MUMM_HR). Triangles 1098 -> 2562 (mummy 2534), HR only (the game has no other LOD, so no LOD pop); allowed up to 2.6x (`SKEL_LIMIT`). Tests lego3d-chars / audit / lod pass (32 pairs).
Honest leftovers: 2.3x the original's triangles for 15 mummy guards in z18MMP (about 38k instead of 16k); the arm clip is the LDraw fork (open at the top, the game has a closed bullet cap; the shoulder pins that would sit in it are dropped); the elbow shows a hinge wedge in strongly bent poses; the ribs get the original's smooth normals (a glossy gradient like the original).

### Heads

65 head meshes are 54 distinct contents; **44 replaced (5618 -> 5600 triangles), 10 kept**. The LDraw head 3626b is rebuilt as a loft (K 16..4 points, 3..9 levels; the ring ladder rung closest to the game's own head wins, measured by mean surface distance) fitted to the skin group; the front band between the face group's y limits becomes the face group, with rings at the rows where the game's face quad changes UV slope (so the mouth stays where the game has it), a square bottom edge (the LDraw head has a rounded one that squeezes the mouth and chin print: found in the engine with the INFO close-up, fixed), and a neck tube when the skin group reaches below the chin. Face system type 1 (.wib with 16 frames: the engine scales the face group UV x4 about v=1 and selects the frame with rec.face) and type 0 (4x4 atlas) both work because UVs come from the original face group; verified in the engine (INFO, PEPP; expression frames change). 

Heads kept original, with the reason: PEPP_SLRhead (40 triangles, no loft fits), BBT x4 (cube head of a Brickster-bot, not a minifig head), PEPJ_HRhead (3 groups, face group 0: no skin group to identify), CEDR_BGRhead, MFG_MRhead (4 groups, no face group), MFG_BGRhead (46 triangles: no loft fits), PEPP_CentrifugeHelm (not a head).

### Hands

57 hands are 46 distinct contents; **24 replaced (1472 -> 2128 triangles), 22 kept**. HR (74 triangles in the game) and MR (42-66) hands are the LDraw claw 3820 fitted by chamfer distance, HR at most 120 triangles (the claw has real tines, 1.6x), MR decimated to at most the original; LR (26), SLR (10), BGR (4) hands are blocks / a cone in the game: a claw decimated that far is lumpier, they stay the game's. HATE (hook) stays original. Over all archives: 338 hand members, triangles 19968 -> 27664.

### Gear (hair, headgear, accessories)

See the gear section below (merged from gear-report.md). Replaced 48 of 265 contents (hair 15, accessory 12, headgear 21), everything else (cloth, capes, fez, crowns with veils, mushroom hats, spiky hair, bags, torches, plumes, bows, quivers) stays the game's, each with its reason in the lists below. HR gear is 2x the original's triangles (hair 110 -> 220, hat 133 -> 265, helmet 291 -> 582, tools 48 -> 96, sword 232 -> 464); the same CPU cost argument applies as for the bodies: skinning of a whole HR body is 35-42 us, the gear is rigid (no skinning) and at most a few hundred triangles per character; HR parts exist only within 20 units of the camera.

### What stays the game's mesh, and why (summary)

- Non-human skeletons / other rigs (diver MUM_HRbody on the PEPD rig, CIT1 citizens, animals): the minifig loft would not follow their bones.
- PEPP_SLR body (152 triangles): no loft within 152 triangles beat the original's stretch.
- Brickster-bot cube heads, PEPJ / CEDR / MFG far heads (listed above).
- LR / SLR / BGR hands (4-26 triangle blocks).
- Cloth, capes, fez, crowns, mushroom hats, hair with spikes, two-colour hair, the pizza shield, torch, plume / wings helmets: no LDraw counterpart (gear lists).

### Generator cost and safety

`tools/lego3d/bench-gen.mjs`: per archive in node, cold, median 84 ms, max 311 ms over 30 archives (z60FRE, 344 files: 224 ms). Generation is hash-keyed and fail-safe: wrong or unknown data keeps the original (corrupt-pack and tampered-mesh cases in `lego3d-chars.mjs`); nothing throws a zone.

### Performance (taken at a load average of about 6, not on a quiet machine)

CPU skinning + normals per mesh (`bench-chars.mjs`, microseconds, original -> mod, minimum of 5 rounds): PEPP_HR 36 -> 42, PEPP_MR 16 -> 14, PEPP_LR 17 -> 9.5, MFG_HR 35 -> 13, MFG_MR 18 -> 6, MFG_LR 15 -> 6, MFG_SLR 10 -> 4, MFG_BGR 7.3 -> 2.3, BB_HR 48 -> 13, BB_MR 31 -> 7, BB_LR 17 -> 6.5. The mod skins fewer vertices everywhere except PEPP_HR (1170 vertices against 1656 but more bone influences per vertex from the overlay riders).

Render call of the game with a crowd (`steps/chars-perf.mjs`, ms per frame median, gl.finish included, original / mod): z04IFC (28 characters): 0.2 / 0.2 and 0.2 / 0.3 (two runs; 3731 -> 4027 triangles, 63 draws both); z02LGI (35 characters + town): 1.4 / 1.3 and 1.5 / 1.3 (37195 -> 37044 triangles, 1199 draws both). No measurable frame cost; the machine was loaded (load 6) so the absolute numbers carry noise of about 0.1 ms.

### Visual checks

Headless before / after galleries (every character record of a zone, game camera distance, original left, mod right, contact sheets in (scratch folder, not in the repo)<zone>-N.png) for z04IFC, z07CSI, z09JST, z23DIP, z50LTC (then z60FRE, z16PYA, z14OSD as they finished); frozen-pose close-ups of heads (INFO, PEPP) in (scratch folder, not in the repo) Looked at critically: no tears, holes or buried decals; faces, torso prints, hair textures and expressions in place.

### Weak spots (honest list)

- Fixed in round 2: BB torso gloss (chamfered rings give flat vertex normals), shoe toe step of the legs, mouth / chin of the heads. Still open: BB legs are a little brighter than the original.
- Arms are slimmer than the original at HR (the LDraw arm is thinner than the game's); (Pepper's arm band is painted into the arm from round 3).
- Hips and legs are plain lofts without the original's small bevels; the bottom of the torso loses a tiny gradient.
- Head height is a little shorter than the game's (chin about 0.05 higher); the mouth and chin print are in place.
- A small notch at the cape / shoulder of INFO (original cape mesh, not ours).
- Legs of light trousers (z50LTC) show a thin dark seam line down the front where the two leg halves meet; the leg split line of the original is not reproduced.
- PEPP_SLR, 22 hands and 10 heads are original (above).
- Performance numbers were taken with a loaded machine.

### Files

Builder: `tools/lego3d/pack/chars.mjs` (+ `chars-paint.mjs`, `chars-geom.mjs`, `chars-body.mjs`, `chars-core.mjs`, `chars-loft.mjs`, `chars-head.mjs`, `chars-hand.mjs`, `chars-skel.mjs`, `chars-pose.mjs`, `chars-gear*.mjs`, `chars-gear-table.json`, `chars-try.mjs` dev loop). Assembler: `src/mods/lego3d/chars/{body,static,geo,rig,bodypack,hash,orig}.ts`, `src/mods/lego3d/gen/characters.ts` (additive: `resetCharsCache`). Tests: `tools/tests/lego3d-chars.mjs`, `lego3d-chars-audit.mjs`, `lego3d-chars-lod.mjs`, `lego3d-gear.mjs`. Tools: `tools/lego3d/{chars-inventory,chars-coverage,chars-table,pose-check-chars,decal-check,bench-chars,bench-gen}.mjs`, `tools/lego3d/steps/{chars-view,chars-perf}.mjs`. Shared files `decimate.ts`, `pack.ts`, `gen/index.ts`, `mshio.ts` were not changed.


## 10. The brick library (bricks generator)

**Built.** 159 of the 257 bricks are rebuilt from LDraw parts (317 LOD meshes: LOD 0 and LOD 1 of each, 693 meshes in the archive in total, LOD 2 stays the game's 12-triangle box): 110 verified by the numbers (strict rule), 14 reviewed by eye (the first worker's near misses), 35 new "class" bricks (same functional element, loosened rule, each looked at on QA sheets and in the game). 51 stay original after a measurement / look (reason per brick below), 17 have no library part with a similar box, 30 are plain 12-triangle slabs (nothing to replace). Earlier state: 124 (110 + 14).

**Class rule (new).** For windows, windscreens, doors, wheels, inverted slopes, pins, hinges, headlights, round bricks and similar parts where a real LDraw part does the same job as the game's simplified brick: bounding box <= 0.1 per axis (after the per-axis fit of the body, `fit`, studs stay on the stud grid and only follow the body's height), surface mean distance <= 0.1 (a poor judge for thin frames and panes: the sheets decide), the STUD LAYOUT EQUAL to the game's (same count, every stud within 0.09, `studDiff`), a second colour kept where the game has one, a LOD 1 where the game has one. The 110 verified bricks keep the strict rule (box 0.045, mean 0.02, far 8 %). Every class brick has its deviation in the table below (`note`) and was looked at (`brick-sheets.mjs`: game blue next to the replacement from two sides, then `brick-final-sheets.mjs --only class` on the generated meshes).

**Glass / panes.** Two-colour bricks: the first colour is the frame, the second the pane at the END of the vertex list (the first-colour count of each replaced mesh is in the sidecar `lego3d/bricksplit.json`, read by `BrickLibrary.splitOf`). The pane is the LDraw glass: LDraw colours that are transparent (ALPHA < 200 in LDConfig.ldr) form the second class (`second: trans`), or a glass part given with a trailing `!` (3861c + 4344!, 57894 + 57895!). Studs always belong to the first colour (a stud under a transparent colour used to disappear). Windscreens / windows whose LDraw frame has no glass part stay original (list below).

**Detail vs triangle count (coordinator rule: counts need not match the game's).** LOD 0 and LOD 1 of the class bricks keep more LDraw detail than the game's (budgets: LOD 0 up to 5x the game's + 60, LOD 1 up to 2.2x + 40; test limits); the old bricks keep their old budgets (2.2x + 40 and 1.3x + 24). Both numbers are in the pack index (`tris` = decimated, `raw` = un-decimated: hidden faces removed, underside closed, no merging) and in the table. Only LOD 2 stays the game's 12-triangle box. Per-brick knobs in `brick-review.json` (`flags`): `trans`, `fit`, `b0=` / `b1=` (budget multiples, 0 = none), `mc0=` / `mc1=` (merge cost), `bc1=`, `nostud`.

**CPU cost (bench-bricks.mjs: the engine's BrickBatchCpu.add, one of each brick per pass, min of 7 repeats, original -> new).**
LOD 0 total (159 bricks): vertices 45418 -> 63083, triangles 31996 -> 47402, CPU 2.03 -> 2.69 ms (+33 %). LOD 1: vertices 27815 -> 30601, triangles 18044 -> 19530, CPU 1.12 -> 1.23 ms (+10 %).
Per class, LOD 0: verified x110 vertices 31007 -> 39611, tris 21956 -> 30978, +23 %; reviewed x14 +35 %; windows x12 vertices 4783 -> 7428, tris 3262 -> 5364, +63 %; doors x4 +111 %; slopes x5 +25 %; pins x2 +126 %; other x10 +61 %; wheel x1 vertices 202 -> 1185 (tyre tread), +499 %; hinge x1 -60 %.
LOD 1: windows +19 %, doors +19 %, slopes +23 %, pins +13 %, other +27 %, wheel +275 % (one brick), verified +12 %.
Un-decimated vs decimated vs game (LOD 0 / LOD 1 triangles, sums over the class): verified x110 42322 / 30978 / 21956, 22504 / 12126 / 11819; reviewed x14 7160 / 4370 / 3048, 4343 / 1909 / 1787; windows x12 8921 / 5364 / 3262, 5271 / 2593 / 2066; doors x4 2575 / 1555 / 706, 1917 / 837 / 574; slopes x5 1496 / 1160 / 718, 739 / 412 / 330; pins x2 936 / 557 / 232, 568 / 115 / 116; other x10 5758 / 2702 / 1744, 4257 / 1285 / 1094; wheel 1711 / 570 / 188, 1455 / 294 / 156. The brick effects draw a few hundred bricks at once (houses up to 380 bricks, mostly plain bricks), so the +33 % at LOD 0 is the cost of the richer LOD 0 only close to the camera (LOD 1 from 35.8 units, LOD 2 from 84.8 units).

**Gameplay check.** Oracle `tools/tests/lego3d-bricks.mjs` per replaced mesh: valid .msh, bounding box within 0.045 per face (verified) / 0.1 (reviewed, class) at LOD 0 (LOD 1: 0.12), stud rings equal in position / count to the game's (plain bricks, slopes and every class brick except `nostud`), triangle budgets per tier, BrickLibrary over the generated archive (split counts valid, second colour kept at the end, untouched bricks unchanged), determinism, a foreign member left alone (no sidecar entry), nothing else written, other archives untouched, pack size. `node tools/test-formats.mjs --only lego3d-bricks` green; `npx tsc --noEmit` green.

**In the game** (`?lego3d=bricks&hd=0`, headless, muted, snapshot server 5745; steps `tools/lego3d/steps/bricks-view.mjs` (finished models of the island's brick-effect slots: runs the slot's morph to its end, Pepper stands in front on two sides), `bricks-house.mjs`, `bricks-probe.mjs`, `bricks-lib.mjs` (vertex counts of the library in the running page: window4x2 295 triangles, door4x5_1pane 276, wheel01 570: the generated meshes are in use)). The police station (policestation.txt: 4 bay windows, 5 bay mantles, 4 three-pane windows) before / after at 11 and 20 units: the real LDraw frames with the green glass as second colour, plain bricks unchanged; at the normal camera distance of the cars / ambulance the differences are hardly visible. The finished buildings are not drawn by the game outside the build effect, so the steps keep the slot's `drawn` flag on (QA only, not in the game). Pepper's house (peppershouse01: door, shutters, windows) builds up over several story steps and could not be reached headless in one run.

**Weak / not done.** (1) Inverted slopes: the LDraw parts have a recessed pocket for one or two studs (the game has a flat deck); visible from above, documented per brick. (2) The wheel's tyre has the real tread (the game's is smooth) and 570 triangles. (3) The bay window is a faceted LDraw part, the game's is rounder; the bay mantle has other corners. (4) Doors: the game's door is a thin leaf; the LDraw doors have hinge pins and handles; panes are the LDraw glass. (5) Window variants of the game with more mullions (window1x4x3, _, _1pane share one LDraw window). (6) The bricks effect at LOD 1 is built from the 'low' LDraw primitives. (7) 51 bricks stay original (below) and 17 have no counterpart; the roofs stay original because the game's are hipped and LDraw has no hipped 2x1 / 2x2 / 4x2 roof. (8) The building models are only seen through the QA hack, not in an unmodified headless run.

**Files.** `src/mods/lego3d/gen/bricks.ts` (unchanged), `src/mods/lego3d/meshpack.ts` (unchanged), `src/formats/bricks.ts` (sidecar hook, unchanged since the first worker), `tools/lego3d/{brickfit,brickmesh,brickbuild,brick-sheets,brick-final-sheets,bench-bricks,brick-map-write}.mjs` (class rule, glass classes, stud follow, flags, stud layout check, per-class bench), `tools/lego3d/pack/bricks.mjs`, `tools/lego3d/{brickmap.json,brick-review.json}` (the class table is `cls` in brick-review.json), `tools/lego3d/steps/bricks-{view,house,probe,lib}.mjs`, `tools/tests/lego3d-bricks.mjs`.


## 11. Textures (generator `textures`)

**Built.** 139 pictures of 23 zone archives are regenerated at 4x (16/32/64 px -> 64/128/256, 128 px wall -> 512): **135 stud plates + 4 brick walls** (dark wall z02LGI #35 and z04IFC #55, the dark wall with the painted grass strip z02LGI #24, white wall z05WAB #16).
The list is not curated by hand: `tools/lego3d/pack/textures.mjs` takes every texture the zone meshes use that repeats at the stud pitch (autocorrelation) and scores it against our own designs
(Pearson correlation on the luminance, phase searched to 1/4 original pixel); >= 0.45 is taken, 6 baked-sun / thin-outline plates (z04IFC #12, z05WAB #2/#3, z36CNT #12, z02LGI #138, z15SSH #62 = 4x4 studs) are accepted lower after looking at them,
2 periodic pictures that are not studs (hazard-stripe X, z14OSD #46, z23DIP #52) are excluded. (The pilot inventory said "139 stud plates"; the correlation finds 135 plus the walls; the sand tile, stone noise, star field,
doors and window frames that the autocorrelation lets through are rejected.)

**Pack (hosting).** Only our own renders and numbers: 5 designs (`textures/design/*.bin`: a signed shading field f in [-1,1], 8 bit; stud cell `plain` (real LDraw stud + soft AO foot), `ring` (stud with outline ring, links, tube circles: the game's
"ring style"), `cross` (2x2 stud tile with the cross hole), `wall-dark` / `wall-white` (running bond of LDraw 3004 bricks, 40 x 20 LDU) rendered in headless Blender/Cycles from LDraw geometry (`tools/lego3d/designs.mjs`, `blender/lego_design.py`): orthographic,
uniform white world, **no sun** (real ambient occlusion only), seamless by construction) + a table per archive (`textures/arch/<archive>.json`: id, design, repeats per tile, phase, size and FNV-1a hash of the original member).
The pack part is **95 kB stored (702 kB raw)**. The colour never enters the pack: at run time the assembler reads the player's picture, takes the per-channel median (f = 0), 3rd percentile (f = -1) and 97th percentile (f = +1),
mixes the design with them, and corrects the base until the **median equals the original's exactly** (the pilot's normalisation). Three colours per picture are measured, no pixel is copied (the one exception, by design, is the grass strip of z02LGI #24, which is the player's own pixels kept at run time).

**Run time (`gen/textures.ts`).** 24 bit bottom-up TGA, same member name/case as the original (UV mapping, wrap flags untouched), 4x size => `Archive.isUpscaled` turns on mip maps + anisotropy. Phase: the design is shifted to the original's stud phase in whole output pixels
(56 of the 139 are offset from the cell centre, e.g. the CSI ring plates by half a stud). Safety: a member whose hash/size is not the table's is left alone; a larger version of the same picture (HD pack) is taken if it is still periodic at the table's pitch;
anything else (a mod) is skipped with a log line. HD pack: the generator reads `env.read` (HD already applied) and writes after it, so the LEGO 3D picture wins (4x of the *original* size, same as the HD pack's 4x).
Cost: all 23 archives in node 0.3 s; island 30-45 ms; output 27.4 MB TGA for the whole game, largest archive 2.56 MB (about 3.4 MB on the GPU with mips; only the zone's own textures are ever loaded).

**Verification.** `tools/tests/lego3d-textures.mjs` (139 textures): size 4x, 24 bit/bottom-up form, no alpha, median per channel equal (max error 0), luminance sd between 0.4x and 2.5x of the original's (actual range 0.62-1.54),
seam test (the wrap-around column/row pair is no rougher than the roughest ordinary pair: max ratio 1.00; 1.26 on the grass wall, which is the original's non-tiling grass), periodic at the cell, deterministic, foreign member left alone, HD-size copy taken.
Proof sheets (original 4x nearest | generated | 3x3 tiled): `~/Documents/legoeiland2-extract/lego3d/proof-textures/<archive>.png` (+ `.txt` row index, `proof.csv`/`proof.json` with the numbers per texture); `tools/lego3d/textures-proof.mjs`.

**What stays original / weak.** The 6 baked-sun plates lose their crescent shading (replaced by the sun-free plain design). Ring plates have thicker, brighter rings than a real LEGO plate has (it is the game's style, kept). The grey z16PYA-style cross plates are matched
by one `cross` design. Other LEGO-like pictures (the green brick panels, roof tiles, grilles) are not done. No normal maps (no shader).


### Round 2

* **Shaded ("3D look") plates.** New design `shaded` (Blender, same real stud geometry, a light crescent on one rim and a shadow on the other derived from the height field, the stud top stays the plate colour); the table's `inv` flag picks bump (lit from the upper left, the white z04IFC #12 / z36CNT #12) or pit (the blue / red z05WAB #2/#3). The proof sheet shows the WAB pair now close to the originals' character. The crescents match with a lower correlation (0.2-0.35) than flat plates (>= 0.45) because the originals' shadows are pixel-art: accepted after looking at them.
* **z15SSH #62** (4 x 4 small studs with long baked cast shadows) is **left to the game's own picture** (excluded in the table, and so without 3D studs): neither the plain nor the shaded design reproduce it (the shadow is a baked sun and a sun-free design cannot draw it; both candidates looked worse than the original in `proof-textures/z15SSH.png`). Table now 138 textures: 134 stud plates + 4 walls (designs: plain 86, ring 41, shaded 4, cross 3, wall 4).
* **Green brick panels, tiles, grilles** looked at (`z02LGI #106`, `z07CSI #0/#63`, `z09JST #13/#39`, `z10RGB #0/#77`, `z13CAI #153`, `z16PYA #84/#86`, `z23DIP #83/#85`, `z40OGL #90/#91` ...): the green pattern is a 5 x 8 grid of lit rectangles on dark green (a screen / light panel, not bricks: no joints, no stud or brick geometry to render), the cracked sand tile, stone noise, star field, red roof plaid and the dark ledge-brick of z16PYA #3 are painted surfaces, not LEGO parts. Not added; there is no LEGO-surface texture left in the periodic list that is not covered.


## 12. 3D studs (generator `studs`)

**Finding that changed the scope.** The inventory's "1,061 meshes / 726 model names with stud geometry" counts vertices near a stud ring, which also fires on wheels, pipes, windows. Looking at the meshes: the surfaces that carry **painted stud-plate textures** (the 135 stud textures above) are on
**177 meshes (529 group uses; 176 of them in the pack table; 5,188 triangles in those groups)** of 23 zone archives; the rest of the "stud" meshes either already have geometry studs or are no stud surface. That is what gets real studs.

**Design: baked into the game's own meshes.** `gen/studs.ts` appends stud prisms to the *same group* of the plate they stand on (vertices/indices spliced into the player's .msh bytes; every other byte - colours, UV2, GTOM/MATL, skin data - is copied), so the engine's own CPU vertex lighting
(static meshes once, moving records every draw), every record that draws the mesh (vehicles, boats, train, shuttle, planes), every LOD part the game already switches by distance and the GPU culling work unchanged. No per-frame code, no engine hook (the pilot's hook `src/mods/lego3d/studs.ts` + the 3 lines in `src/zones/z02LGI/index.ts`
stay inert - they need `lego3d/studs.json` which the new generator never writes - and can be deleted: nothing else uses them).
Measured against the pilot's per-frame batch: no JS cost per frame at all (the JS side of the render call 1.4 -> 1.8 ms in the worst island view), moving records and all LODs for free, one more upload of vertex data at zone load.

**Pack (hosting).** `studs/arch/<archive>.json`, 6.6 kB stored: per archive the mesh member name + FNV-1a hash, the stud groups with texture id, the lattice of each stud texture (studs per tile, offset: copied from the textures part's measured phase) and the part's switch-in distance; nothing of the game's geometry.

**Placement (derived at run time from the player's mesh + UVs).** Per group: every triangle -> UV Jacobian (pitch = world length of one stud; a stretched or sheared mapping is skipped: round studs need a square lattice), triangles grouped by plane; every lattice point (UV = (i + 0.5) / n + offset) inside a triangle becomes a candidate;
kept only if the whole stud disc (12 samples, +1.5 % margin) lies on the **coplanar triangles of the group** (no stud over an edge: partial plates keep their painted half studs), no stud within 0.75 pitch of another (two triangles' lattices disagree), and **nothing covers it** (rays along the normal from the centre and 4 ring points against every triangle of the mesh in the group matrices' common frame: studs under another plate or inside a wall are not generated).
Faces turned down (normal.y < -0.5, undersides) get none; studs follow the surface normal, so a vertical fin (the shuttle) or a sloped plate gets studs standing out of it. Skinned meshes (catapult): studs ride the bone of their triangle (all three vertices weight 1) or are skipped.
Stud: prism radius 0.3 pitch, height 0.2 pitch (LDraw stud proportions), flat top (normal = surface normal), radial smooth side normals, UV = stud centre in the group's texture = a flat colour of the plate (our design has a constant there); 3 x sides vertices, 3 x sides - 2 triangles (4: 10, 6: 16, 8: 22, 12: 34).

**Level of detail / budget rule.** Each LOD part of the game is its own mesh, so: a part that switches in at >= 100 units gets none (painted studs only); 40-100: budget 3,500 triangles; nearer parts 11,000; a model with one LOD part (jetty, bridge sections: they are drawn at every distance) 20,000 and at most 8 sides.
Sides = the richest of 12/8/6/4 that fits. Result over the game: **133 meshes baked, 43 left (far parts / no budget / no fitting stud), 18,224 studs, +419,558 triangles in total (sides: 12 x 55 meshes, 8 x 71, 6 x 2, 4 x 5), +22.7 MB of mesh data in memory (all zones; island +8 MB)**.
Worst meshes (island): Jetty / Jetty2 900 studs, 8-sided, 19,800 triangles each (the pilot's jetty had 806 studs x 24 per frame); BridgeSection(2) 312 studs, 6,900; shuttle LOD1 318 studs, 10,800; voie_lod1 (platform) 511 studs, 6-sided, 8,200.
Generation time in node: 85-140 ms for the island, <= 0.18 s for any archive (browser: same code, single thread).

**Verification.** `tools/tests/lego3d-studs.mjs` (176 table meshes): parseMsh/validateMsh of every result, group count/flags/GTOM/MATL unchanged, the game's own vertices and indices of every group byte-identical, group without stud texture untouched, winding of every stud triangle outward and unit normals,
every stud on the texture's lattice (UV) with its base ring planar, radius/height = 0.3 / 0.2 pitch, each stud one of the placement's candidates (surface/disc/lattice rules), no two studs overlapping, count <= placeable lattice points and >= half of them, triangle budget per rules, no far part with studs, determinism, hash mismatch -> left alone.
Browser (headless, muted, 800x600, `tools/lego3d/steps/surfaces.mjs`, shots in `~/Documents/legoeiland2-extract/lego3d/shots-surf/`, `o*` = original, `n*` = LEGO 3D): grazing along the jetty, at the water line (depth correct, studs vs. sea), the dock from the jet ski side, the speedboat deck, the bridge, the shuttle's vertical fin, the train rotated/moving.
Per view, triangles original -> LEGO 3D (draws unchanged): jetty graze 34.4k -> 85.9k, water line 35.0k -> 86.5k, dock 33.3k -> 71.1k, speedboat 32.9k -> 77.5k, platform/bridge view 38.3k -> 107.4k, shuttle 35.0k -> 110.8k, bridge 42.1k -> 121.7k. JS time of the render call (min of 3 s): 1.2-1.4 ms -> 1.6-1.8 ms (jetty views), 1.3 -> 1.3 (dock);
page frame time in the software-rasterised browser 33 ms -> 33-50 ms (SwiftShader draws the triangles on the CPU, a GPU does not care: +80k triangles per frame is below 1 % of a GPU's budget).

**Weak / not done.** (1) Single-LOD meshes (jetties, bridge sections) always carry their studs: in an island view they add most of the +50-80k triangles even when 200 units away; the rule keeps them at 8 sides (a per-frame distance cut would need the pilot's engine hook). (2) 43 far-LOD meshes keep only the painted studs (by rule). (3) Stud meshes on records that share a mesh but swap the texture list at run time
are skipped when the lists disagree (none found). (4) The moving-record check is a record turned by a harness (train), not a driven vehicle. (5) Non-flat studs (stud textures on curved meshes) are not handled: such triangles are skipped by the plane rule.


### Round 2: CPU cost per frame, soft studs, real-game checks

**Finding about the cost.** The engine re-lights every mesh of an island record at every draw (draw mode 1, "always"): `renderer.lightMesh` ran 90 times / frame, 407 k + 1,370 k vertices in 2 s. Stud vertices ride along, so what costs CPU per frame is the *vertex count of the studs in range*, not triangles
(draw calls are unchanged: the studs live in the existing groups, 915 -> 917 draws). Measured with `tools/lego3d/steps/l3d-surf.mjs` (PERF=1: vertices lit per frame, JS time of the render call without a GPU wait, with `gl.finish`), headless 800x600, back to back, machine load 10+ (so p50 / min of ~3 s, treat +-0.2 ms as noise):

| option (island, `&hd=0`) | plaza tris / lit verts per frame / CPU p50 ms | jetty graze | platform view (far) |
|---|---|---|---|
| original (`lego3d=0`, twice) | 32.6k / 19.4k / 1.9 | 34.8k / 18.1k / 1.7 | 41.3k / 24.4k / 2.3 |
| round 1 studs (hard, 8-sided singles) | 86.4k / 49.4k / 2.9 | 86.4k / 48.0k / 2.6 | 116k / 69.4k / 3.5 |
| **soft studs, singles <= 8 sides (new default)** | 86.0k / 40.6k / 2.1 | 85.4k / 39.3k / 1.9 | 117.9k / 56.3k / 2.5 |
| soft, singles <= 6 sides (`s6`) | 78.6k / 35.6k / 2.6 | 77.9k / 34.3k / 2.4 | 103.5k / 48.8k / 3.4 |
| soft, singles <= 4 sides (`s4`) | 65.7k / 30.7k / 2.3 | 65.2k / 29.3k / 2.1 | 86.9k / 41.3k / 3.2 |
| no studs on single-LOD models (`s0`, = what a distance-LOD hook gives in a far view) | 39.9k / 19.4k / 2.2 | 39.2k / 18.1k / 1.9 | 56.7k / 24.4k / 2.3 |

*Soft stud* (`studGeometry`, default): centre vertex (surface normal) + one top ring whose normal leans 45 degrees outwards, shared by the cap and the wall + the bottom ring: **2 x sides + 1 vertices** (8-sided: 17 instead of 24), 3 x sides triangles; the top edge reads rounded. Over the island: +66.8 k vertices / +3.5 MB (hard: +108 k / +5.4 MB), the singles 34 k vertices (was 58 k); lighting every baked mesh once costs 2.7 ms in node (a one-off), generation 130 ms. Options `hard`, `s0`, `s4`, `s6` exist in the generator (`&lego3d=textures,studs,<option>`) for measuring.
Result: the extra lit vertices per frame fell from +30 k to +21 k (+109 % over the original in the plaza view); all of that +21 k is the single-LOD models (jetties, bridge sections: with `s0` the lit count equals the original's). Extra CPU per frame about +0.2 ms (min +0.1-0.3) in the quiet back-to-back run.

**Hook (not built).** The only way to drop the remaining +21 k lit vertices in far views is a distance LOD for single-LOD records: `src/game/render.ts` around line 580 (`const pi = ... selectLod(rv.parts, dist, this.fov)`), a record whose model has one part and whose mesh has a sibling member `lego3d/far/<member>` (the generator would put the unbaked mesh there) would draw that sibling beyond ~100 units: about 12 lines, inert without the member, +1 original-size mesh per single-LOD model of memory. Gain, from the `s0` row: far views -21 k lit vertices (-0.2...-0.3 ms), -46 k triangles; near views (jetty graze) nothing. At +0.2 ms I recommend not adding it; decide when the real-hardware frame time is known.

**Cache caveat for testing.** The run-time cache key is the pack date + the generator options, not the generator code: a profile that ran an earlier build (`lego3d=textures,studs` twice) serves the old result (my "soft8" run first came back as round-1 geometry). Use a fresh `--profile` or an extra option string (`...,soft`) when comparing builds.

**Real game state.** `tools/lego3d/steps/surf-ride.mjs`: the speedboat driven by the game's own controller (Ctrl + Space, z 430 -> 927 and wrapping the island), studs on its black deck carried along and lit (`shots-surf3/ride-on-SPBT-*.png`).
`surf-zone.mjs`/`wab.mjs` through `?lego3d=textures,studs`: Whack-A-Bot floor and red platform (3D studs on both, 4x brick wall; `wab-on-3-play.png` vs `wab-off-3-play.png`), z08BKD bridge deck at a grazing angle (`bkd-on-G002-0.8.png`); z14OSD's seaplane airstrip starts with a cutscene letterbox in that scene driver, so its shots are not usable (listed as not checked at the water line).


## 13. The OMR sets as vehicle meshes (generator `sets`)

**What is in the game (confirmed by measurement - sorted box + chamfer after the best of 24 rotations with the MATL matrices applied, and by eye; recon `(scratch folder, not in the repo)`).**
6415 jet ski = `Jetski_group1..5` (z02LGI, z07CSI); 6666 ambulance = `Ambulance_lod1..3` (z02LGI); 5920 Island Racer is the CAR `speedster_red_lod1..3` (z02LGI, z16PYA); 6479 Res-Q centre: the set's boat `speedboat_group1..5` (z02LGI, z07CSI), helicopter `Heli_resq_lod1..3` (z02LGI, z13CAI, z14OSD), inflatable boat `Dingy_group1..3`; the buildings `rescue_LOD*` (and `police`, `hospital`) are NOT the set; 6397 `garage_LOD*` likewise; 7750 `locomotive_lod*` near 1:1, `loco_tender_lod*` the set's trailer (the game's is closed); `loco_carriage` is not in the set; 5935 Island Hopper = z38PAR `seaplane` (1:1, stored pitched), z22BIP `seaplane` (set x 1.33), `airstrip_seaplane_LOD*` (family only).

### Built (pack part `sets`, 21 meshes in 7 archives; `node tools/lego3d/pack/build-pack.mjs --only sets`, 125 s)

| model (archives) | mesh | game tris | new tris | x | how |
|---|---|---|---|---|---|
| jet ski (z02LGI, z07CSI) | group1 / group2 (25) / group3 (40) | 267 / 223 / 119 | 995 / 490 / 479 | 3.7 / 2.2 / 4.0 | LOD 0 std primitives + 6-sided studs; LOD 1, 2 low-res primitives |
| ambulance (z02LGI) | lod1 / lod2 (70) | 1362 / 347 | 3357 / 1706 | 2.5 / 4.9 | std + 4-sided studs / low |
| speedster (z02LGI, z16PYA) | lod1 / lod2 (70) | 1046 / 521 | 4336 / 2324 | 4.1 / 4.5 | std + 8-sided studs / low |
| speedboat (z02LGI; z07CSI is a 961-triangle variant) | group1 | 1229 (961) | 4132 (4077) | 3.4 (4.2) | low |
| Res-Q helicopter (z02LGI; z13CAI, z14OSD) | lod1 | 1162 (1090) | 5227 (3757) | 4.5 (3.4) | std + 4-sided studs (low) |
| locomotive (z02LGI) | lod1 | 1680 | 6077 | 3.6 | low |
| tender (z02LGI) | lod1 | 780 | 3004 | 3.9 | std, HYBRID (below) |
| Island Hopper z38PAR / z22BIP (set x 1.327) | seaplane | 868 / 850 | 3201 / 2086 | 3.7 / 2.5 | std |

Far LODs not in the table (ambulance lod3 ... = the `.col` source and the LODs whose build misses the ceiling) stay the game's, see "Far LODs". Generated output of the 7 archives 4.1 MB, set data in the pack 0.93 MB, run time generation 12-240 ms per archive in node (z02LGI 11 meshes: 238 ms).

### What changed against the first version (all of it measured, looked at in the browser)
1. **Real browser QA exposed what the software sheets had hidden** (`tools/lego3d/steps/sets.mjs`, `sets-ride.mjs`, `sets-zone.mjs`: game left / replacement right from a fixed camera around the frozen vehicle, the vehicle driving, Pepper riding): (a) the wheels were wrong (the LDraw wheel is 0.72 radius and 0.6 above the axle where the game's is 1.0 radius round its axle: they orbited when spinning), (b) picture groups (the ambulance's side windows with blinds) were stretched over the set's much bigger window with the interior showing, (c) every UV-affine fit had silently failed (a Gauss-Jordan bug: UV fell back to nearest-point), (d) hollow undersides (anti-studs, tubes) showed as shards from a low camera, (e) a decal (R.E.S.Q on the jet ski) was classified as a 2-triangle placeholder and half buried, (f) decals on moving parts (rotor blades) were pulled onto the hub.
2. **Moving parts (MATL matrix != identity) are re-fitted onto the game's own box** (`setlib.fitMovingParts`): translation to the box centre and per-axis scale (0.6..2.2) so that axle / hinge / rotor span are the game's. A wheel (two equal long axes) is rebuilt as ONE lathe body: the tyre silhouette of the set's wheel (max radius per axial slice, 12 slices, simplified) revolved in 20 sides, caps 0.04 inside, into the group of the game's tyre; the game's hub groups (flat disc with the game's spoke picture, hub-cap decal) stay the player's own. Result: the game's chunky tyres (ambulance 1.18 wide x 2.0, speedster 0.76 x 2.14), 184 triangles per wheel instead of 300-700, no tread shards, closed.
3. **Picture groups** (texture with range >= 60 in a channel and >= 16 px: `kinds` has `pic`): the planar pieces of the player's group are found (connected, each with its own least-squares affine position -> UV map, so two side windows with mirrored UVs work); every new triangle goes to the nearest piece, is CUT at the edge of that piece's UV range and the cut-off part becomes the player's body there (group and UV of the nearest triangle of the player's other groups). The window is the game's window (a big see-through pane in the set), the picture is not stretched. Non-planar pictures (tyre tread) keep nearest-point UV.
4. **Gap filling**: where the player's own hull has a surface and the new hull has none within 0.4 (0.2 for the tender) the player's triangle stays - but only when at least half of its connected piece is uncovered (a tall antenna the set's shorter one does not reach stays whole, no floating fragments). This is what closes the tender's lid and gives the dinghy's / jet ski's tall rods.
5. **Hollow undersides** of bricks / plates are closed by a flat cap over the outer rim loop before the hidden-face test (`brickmesh.closeBottom`, as in the brick library): the plate bottoms are flat, the tubes and anti-studs behind them are hidden: triangle counts -15 %.
6. **Decals** are lifted rigidly along their own normal (one offset above the highest hull point under them) when the hull under them is parallel within 0.15, else per vertex; moving parts' decals stay.
7. `gameGroups` placeholder rule: <= 3 triangles AND < 0.05 extent (a 2-triangle quad of the jet ski's logo is a decal, the MATL translation carriers are placeholders).
8. Two new models: the **tender** and the **z22BIP seaplane** (below), a scale fit (`refineScale`: per-axis or uniform scale about the centre by coordinate descent on the truncated chamfer) for models the game made at another scale.

### The items the first version left out, decided by measurement (`(scratch folder, not in the repo)*.mjs`)
* **Tender (7750 trailer.ldr)**: the set's wagon is an open frame, the game's tender a closed green box with a stepped lid. Rigid fit at 0.04: score 0.182 (the locomotive's is 0.170; no stretch helps: per-axis 0.997/0.997/1.059, chamfer 0.181 -> 0.174). Built as a HYBRID: the green body groups (texture ids 286, 281, 287, 291 of the game's tender) stay the player's, chassis, wheels, buffers, couplers come from the set (3004 triangles at 3.9x, studs on the plates). Deviation: the body is the game's.
* **z22BIP seaplane**: uniform scale fit 1.327 (chamfer 0.369 at 1.0 -> 0.290; per-axis would go to 1.8/1.28/1.39 = a different plane); built with the set's models at 1.327 x (stud pitch 1.33x the set's, exactly as the game's own model has it; the stud prisms are placed at the scaled positions but keep the set's radius). 850 -> 2086 triangles.
* **airstrip seaplane (z14OSD, z23DIP, z13CAI `airstrip_seaplane_LOD*`)**: NOT replaced. After the best rotation the chamfer is 0.396, 0.378 with a free per-axis scale (0.88 / 1.22 / 1.09), 0.396 uniform (0.861): the wings are 17.4 against the set's 32: a different plane (design family only).
* **Buildings** (6479 `rescue_LOD1..5`, 6397 `garage_LOD1..5`; `police`, `hospital` are not OMR sets): NOT replaced. Evidence (`(scratch folder, not in the repo)`): best rigid fit of the building sub-model chamfer 0.412 (garage) / 0.463 (Res-Q centre) against 0.10-0.17 for every replaced vehicle; with a FREE per-brick translation (+-2.4, "every brick finds its own place on the game's surface") only 102 of 324 (31 %) garage bricks and 5 of 158 (3 %) Res-Q bricks come within 0.12 of the game's surface (the garage ones are big flat wall bricks, 19k of 159k triangles), 3 resp. 0 without any shift. The game's buildings are other layouts (garage: solid wash block + canopy 42.5 deep and 17.1 high, the set 32.0 x 13.3 on a baseplate with an open wash bay; Res-Q: a compact black box, 23.6 x 17.3 x 12.8 against the set's 34.6 x 25.7 x 19.2 sprawling plate), the dimensions are not multiples of the stud pitch of one another; a per-axis stretch (x0.68 / 0.90 / 0.50, x1.0 / 1.28 / 1.33) would change the stud pitch by 30-50 % and the walls would have holes. A replacement of recognisable components (the Res-Q radar dish and antenna, the Octan pylon and pumps) was weighed and not built: they sit inside the game's merged colour groups (no per-component record), a dish is 3 % of the building. The original buildings stay (all LODs, doors, `.col`).
* **Dinghy (6479 inflatable boat, `Dingy_group1..3`)**: built, looked at in the game, and dropped. The set's rubber tubes come to 2215 triangles (4.3x) at best and look faceted and wrinkled next to the game's smooth tubes (its tall antenna had to come from gap filling); the game's mesh is the better model. Not in the table.
* **z07CSI speedboat**: now replaced (961 -> 4077) after the ceiling went from 4.5x to 5.2x when nothing smaller exists (soft ceiling 4.5x: the finest build under it wins; else the smallest under 5.2x).

### Far LODs (the measured answer to "each LOD at most the original's triangle count")
* Tried for the ambulance LOD 2 (347): (a) per-group open-border decimation of the visible bricks (the first version): 2386-2549 triangles at any cost; (b) a **closed outside shell** (voxelise the visible surface of the bricks 0.08-0.12, flood-fill the outside, surface nets, label faces by the nearest game group, two-pass quadric decimation; manifold: 0 open edges, but the decimator reaches the target exactly): at 347 triangles 20-30 % of the volume is gone (56-65 against 81) and the planes tilt (roof wedge, lost window), at 1.5x (456) volume 73, at 2.5x (804) 78, at maxCost 0.3 (1064 triangles) 80.9 - and at those counts the facets are ragged and the shape clearly worse than the game's own hand-made LOD 2 (which has mean deviation 0.122 / p95 0.676 against the set surface, the shell's 0.150 / 0.318: the game's is closer on average but with big outliers). The shell code was removed again (3 min of build time per LOD for nothing).
* What is built instead: the same build as LOD 0 with the low-resolution primitives and a cost that grows with the distance the LOD starts at (3 px of deviation at 800 px: (0.0044 x distance)^2), accepted up to 4.5x (5.2x when nothing is smaller). With the flat underside caps the LODs that make it are: jet ski LOD 1, 2; ambulance LOD 1; speedster LOD 1. The `.col` source LOD (the last of every record) is NEVER replaced; all others that miss the ceiling (heli LOD 1: 2579 needed, speedboat LOD 1-3, loco LOD 1-3, tender LOD 1-3, dinghy) keep the game's mesh. So far LODs are not "<= the original's count": 2.2x-4.9x, and the pop is judged by volume ratios (test notes): jet ski x1.17 / 1.14 / 1.09, ambulance x1.35 / 0.58 (the game's own LOD 2 is bigger than its LOD 1: 206 against 119), speedster x1.37 / 1.30, boat x1.01, loco x1.29, tender x1.35, seaplanes x0.88 / 1.02 (the helicopter x2.7: thin rotor and skid surfaces; not a pop in the pictures).

### LOD 0 triangle ratio against measured frame cost
LOD 0 ends at 2.5-4.5x (z07 boat 4.2x, heli z02LGI 4.5x). Measured with the game's render call + `gl.finish` (headless swiftshader, quiet machine, back to back, 2 rounds, `sets.mjs PERF=1`): with the whole Res-Q dock in view (jet ski + boat + heli + dinghy) the frame has +9.6k triangles (34.7k -> 44.3k, +28 %) and the median render call is the same within noise: ambulance 2.1 -> 1.9 / 1.9 -> 2.1 ms, jet ski 1.4 -> 1.3 / 1.3 -> 1.3, speedster 2.0 -> 1.9 / 1.8 -> 1.8, helicopter 1.4 -> 1.2 / 1.3 -> 1.4, boat 1.3 -> 1.3, loco 1.6 -> 1.6 / 1.4 -> 1.6 (p90 differences are page noise: the same 0.1-0.2 ms). The CPU lighting of the vertices (30 ns / vertex, 6.6k vertices ~ 0.2 ms) is inside that number. A vehicle in view is 2.5-6k triangles on a 35-45k island frame: the ratio stays. Where it was wasteful it was cut: wheels 560 -> 184 triangles (4 per vehicle: -1.5k), hollow undersides closed (-15 %), speedboat std 6364 -> low 4132 by the soft ceiling.

### Deviations from the game / the set (documented)
* Colours follow the game's groups (texture slots) of the nearest game surface, not the LDraw colours; groups nothing was assigned to stay the game's.
* Wheels: the game's chunky proportions, a lathe tyre (20 sides), the game's hub picture; the set's rim spokes and tread are not modelled (the game's hub texture carries the spokes).
* Picture groups (windows with blinds): the game's footprint, not the set's bigger window; the rest of the opening is the game's body colour.
* Open cab doors and interiors: the game's cab is open as well (the same black opening, the red seats show in both); no interior was added.
* Tender: body = the game's. Speedster / heli / loco: the game's tall details that the set does not reach (the loco's chimney funnel, the antennas) come from the player's own triangles (gap filling): the set's short chimney is under the game's funnel.
* z22BIP plane: the set at 1.327 x (stud pitch 1.33 x).
* Studs: 4-8 sided prisms on the vehicles where the budget allows (jet ski 16, ambulance 106, speedster 41, heli 81, tender 72), none on the low builds and the far LODs.

### Verification
* `tools/tests/lego3d-sets.mjs` (passes, 1.1 s; 21 meshes / 7 archives / 29 checks): valid msh; group count / order / flags, GTOM + MATL identical; kept groups byte-identical; decals: topology / UV identical, lifted <= 0.45; flat groups' UV inside the original's range (0.5 or the player's own carried-over UV); picture groups' UV inside the original's range; **moving parts (per GTOM index) keep the game's local box within 12 % + 0.15**; texture list covers the groups; every record's model uses the mesh; the record's far mesh (the `.col` source) is never replaced; no `.col` / waypoint member written; culling sphere radius change <= 20 % (worst 5.0 %), centre <= 0.2 radii (worst 0.04), world box 15 % + 0.8; volume sign (winding) and ratio 0.4..3.5 (listed per model in the notes); unit normals, finite UVs; triangle ceiling 5.7x (+ the player's own gap triangles); determinism; foreign member left alone; archives without a table get nothing; set data < 8 MB.
* Gameplay oracles by construction + test: collision = `.col` files untouched (byte-identical, never written), waypoints / records / animations untouched, GTOM + MATL identical, texture list per LOD part unchanged (group count, order), bounding sphere the renderer reads (LOD 0 raw positions) within 5 %, nothing else in `src/**` reads these meshes' vertices (grep: only `renderer.ts` uploads / skins / lights; `partMatrix` reads MATL).
* Browser (headless, muted, snapshot server 5742, `tools/lego3d/steps/*.mjs`, images `(scratch folder, not in the repo)`): game vs replacement from 2 angles for the ambulance, jet ski, speedster, helicopter, speedboat, locomotive, tender (`m-*.png`); the ambulance DRIVING (6 frames: wheels spin and steer, Pepper in the cab: `mv.png`), the speedster driving and the train running (`mv2.png`), Pepper RIDING the jet ski, the boat and the helicopter (Ctrl at the vehicle, Space: `ride2.png`, `ride4.png`; the jet ski has Pepper's seat where the original has it: the same picture as the original), the z38PAR plane in its loop (`z38.png`: colours match: red body, grey wings, black canopy). z22BIP could not be driven by a bot (the zone needs its story); checked in the software sheets only (`set-sheets.mjs`).

### Not done / weak (honest)
* **Buildings (rescue, garage), airstrip seaplanes**: rebuilt in section 16 (brick reconstructions, round 3). The dinghy stays a set build; the tender is a hybrid.
* **Far LODs are mostly the game's** (only jet ski 1-2, ambulance 1, speedster 1 replaced); the replaced ones are 2.2-4.9x the game's counts, not <= 1x (evidence above); the closed-shell decimation was tried and is worse.
* **Close-ups (< 7 units) show roughness**: slivers at plate edges, thin black strands (a linkage on the speedster), the decals of the speedboat read mirrored when seen from behind through the open cockpit, the heli's canopy decals are busy, the ambulance rear bumper has small shards. The game's chase cameras stay beyond 10 units.
* The heli main rotor's blades are the player's own kept blade quads (+ the set's hub): checked in 2 frames only.
* The z38PAR plane has no stud prisms (394 studs, 0 sides: no budget) and shows the studded wing texture; z22BIP only in sheets.
* The vehicle "looks" (Enter key: repaint by group position): exercised for the ambulance only (looks 0, 2, 4, 6: tan, military green, the brick-built variant; `ambulance-looks.png`): the recolouring follows the group positions with the replaced mesh (the tan and green paints are right); the other vehicles' looks were not looked at.
* No `?lego3d=1` run-time path was available: all browser runs import `tools/lego3d/build-mod.mjs` output as a mod (the same generator code).
* The shared `lego3d.pack` is rewritten by other workers' parts: the sets part lives in `~/Documents/legoeiland2-extract/lego3d/pack-parts/sets`.

### Files
`src/mods/lego3d/gen/sets.ts` (gap filling, picture clipping, affine UV, decal lifting; exports `fitUvAffine`, `closestOnTri`), `src/mods/lego3d/meshpack.ts` (unchanged), `tools/lego3d/{setlib,sets-table,set-sheets,part-sheets,geomx,brickmesh(placeStuds `post`)}.mjs`, `tools/lego3d/pack/sets.mjs`, `tools/lego3d/steps/{sets,sets-ride,sets-zone}.mjs`, `tools/tests/lego3d-sets.mjs`. Additive in shared files: `brickmesh.placeStuds` got an optional `post` argument (scale about a centre), `setlib` exports `toLocal`, `soupOf`.

### 13.1 Round 2 (rule: no triangle ceiling for what is seen close; every LOD replaced; un-decimated and decimated numbers) - supersedes the numbers above

**Rule as built (`tools/lego3d/pack/sets.mjs`).** NEAR = LOD 0 and every LOD that starts within 45 units: LDraw standard primitives, hidden faces removed (cone test, flat underside caps), real studs (12 sides on LOD 0, 8 on the near LOD 1), collapse cost 0.004 (coplanar / collinear merges only = 0.06 units), NO target. FAR = low-resolution primitives, cost (0.0044 x distance)^2 tried at 1x, 3x, 9x, the first within 3x of the game's count wins; when the per-brick decimation still leaves more than 5x the game's count at a LOD that starts at >= 80 units, the closed outside shell (voxel 0.06-0.16, flood-fill, surface nets, faces labelled by a 10-sample vote of the nearest game group, two-pass quadric decimation) to 3x the game's count (min 150). The `.col`-source LOD of every record is still never replaced. Dinghy, z07CSI speedboat variants and Jetski_group4 (LOD from 90) are in; wheels stay the lathe tyre (it looks better than the LDraw one and is not a budget cut). Carriage: NOT built (below).

**Per LOD (game triangles / undecimated = the set after hidden-face removal, studs included / final)**:

| mesh | archives | LOD from | game | undecimated | final | build |
|---|---|---|---|---|---|---|
| Jetski_group1 | z02LGI, z07CSI | 0 | 267 | 1329 | 1315 (4.9x) | std |
| Jetski_group2 | z02LGI, z07CSI | 25 | 223 | 1137 | 1123 (5.0x) | std, 8-sided studs |
| Jetski_group3 | z02LGI, z07CSI | 40 | 119 | 1137 | 1123 (9.4x) | std, 8-sided studs |
| Jetski_group4 | z02LGI, z07CSI | 90 | 39 | 537 | 172 (4.4x) | shell |
| Ambulance_lod1 | z02LGI | 0 | 1362 | 8755 | 6370 (4.7x) | std |
| Ambulance_lod2 | z02LGI | 70 | 347 | 4373 | 1608 (4.6x) | low, cost 0.85 |
| speedster_red_lod1 | z02LGI, z16PYA | 0 | 1046 | 8453 | 5351 (5.1x) | std |
| speedster_red_lod2 | z02LGI, z16PYA | 70 | 521 | 5558 | 2285 (4.4x) | low, cost 0.85 |
| speedboat_group1 | z02LGI / z07CSI | 0 | 1229 / 961 | 11922 | 9486 (7.7x / 9.9x) | std |
| speedboat_group2 | z02LGI, z07CSI | 40 | 469 | 10722 | 8287 (17.7x) | std, 8-sided studs (LOD 1 starts at 40) |
| speedboat_group3 | z02LGI, z07CSI | 140 | 192 | 6702 / 6680 | 576 (3.0x) | shell |
| speedboat_group4 | z02LGI, z07CSI | 180 | 123 | 6568 / 6598 | 374 / 378 (3.0x) | shell |
| Heli_resq_lod1 | z02LGI / z13CAI, z14OSD | 0 | 1162 / 1090 | 8810 | 8077 (7.0x / 7.4x) | std |
| Heli_resq_lod2 | z02LGI, z13CAI, z14OSD | 90 | 496 | 4656 | 1514 (3.1x) | shell |
| Dingy_group1 | z02LGI / z07CSI | 0 | 518 / 430 | 3280 | 3260 (6.3x / 7.6x) | std |
| Dingy_group2 | z02LGI, z07CSI | 70 | 108 | 1068 | 978 (9.1x) | low, cost 0.85 |
| locomotive_lod1 | z02LGI | 0 | 1680 | 24334 | 21239 (12.6x) | std |
| locomotive_lod2 / 3 / 4 | z02LGI | 80 / 130 / 280 | 742 / 328 / 74 | 9446 / 8260 / 8233 | 2226 / 1006 / 594 (3.0x / 3.1x / 8.0x) | shell |
| loco_tender_lod1 | z02LGI | 0 | 780 | 6422 | 6185 (7.9x) | std (hybrid) |
| loco_tender_lod2 | z02LGI | 50 | 356 | 2617 | 2067 (5.8x) | low, cost 0.44 |
| loco_tender_lod3 / 4 | z02LGI | 100 / 170 | 182 / 48 | 2600 / 1884 | 700 / 434 (3.8x / 9.0x) | shell |
| seaplane | z22BIP (x1.327) / z38PAR | 0 | 850 / 868 | 13907 / 41015 | 11816 (13.9x) / 28023 (32.3x) | std, 12-sided studs |

(Not in the table because they are the `.col` source or the game's only LOD: ambulance lod3, speedster lod3, jet ski group5, boat group5, heli lod3, loco/tender lod5, dinghy group3.) 42 meshes in 7 archives; 21.8k game triangles -> 183k; generated output 11.8 MB, set data in the pack 2.7 MB; node generation 0.8-1.5 s for all 7 archives (z02LGI 11 -> 24 meshes). The pack build takes 19 minutes now (the shell remeshes of the big locomotive LODs take 3-5 minutes each), the pack part stays in `pack-parts/sets`.

**Far LOD choices (looked at in `set-sheets.mjs` sheets, game left / replacement right).** Per-brick decimation is used where it gets to <= 5x (ambulance lod2, speedster lod2, tender lod2, dinghy lod2): clean, boxy, close to the game's own LODs. The shell is used where the per-brick result would be 6-60x (loco lod2-4, boat lod2-3, heli lod2, tender lod3-4, jet ski lod3): the silhouette and the colours of the groups stay (the group label is now a 10-sample vote: the game's own locomotive LOD 4 is brown / red sided in the texture-average sheet too, so that is not a mislabel), small parts merge (the heli's skids become a slab at 90+ units). No pop measured beyond the volume ratios in the test notes (0.25x .. 4x allowed for far LODs; the game's own LOD 4 locomotive is a big box of volume 536 against the shell's 176).

**Test (`tools/tests/lego3d-sets.mjs`, passes: 42 meshes, 50 checks).** Budget assert replaced by the new rule: near LODs <= 60k triangles (sanity), far LODs (>= 80 units) <= 12x the game's (min 600), numbers per mesh in the notes (`game->final@lodFrom`); moving-part box tolerance 12 % + 0.15 near, 35 % + 0.5 far (the game's far tail rotor is a flat quad); volume ratio 0.4..4 near, 0.25..4 far.

**Runtime path verification (`?lego3d=sets&hd=0`, snapshot server 5742, `RM=1` removes my earlier imported mod; images in `(scratch folder, not in the repo)`).**
* Game vs replacement from two angles for all models, `m-*.png` (AMBU, JSKI, SPD0, RHEL, SPBT, DNGY, TRNL): the same pictures as through the imported mod. Dinghy at full detail looks good now (smooth tubes, studs on its floor plate, the tall antenna from the player's own triangles); the 4.3x version that looked faceted was the over-decimated one.
* **All 7 ambulance looks** (`ambulance-looks-all.png`: white/blue, police black/white, tan, tan/blue, military green, orange, red/blue): the group-position recolouring is right for every look with the replaced mesh.
* **Helicopter rotor in motion** (`rotor-frames.png`, Pepper flying it, 6 frames 5 ticks apart): the long game blade and the set's hub turn together, no tearing; the tail rotor spins.
* **z22BIP** (`z22BIP-plane.png`): it IS possible with `sets-zone.mjs` (`ZONE=z22BIP REC=SEPL`, 3 Space presses for the help panels, camera patched around the record while the game flies the plane in the canyon): the plane at 1.327x matches the game's size and colours; the fuselage underside and tail show dense black stud bumps (noisy), wings fine.
* **Close-up checks (2-7 units, from below: `spd.png`, `boat.png`, `amb.png`)**: speedster plate edges are flat now but the plate top shows the game's stud picture with a higher contrast than the game's (nearest-point UV on a picture group); the thin strand on the speedster is still there; the ambulance rear bumper is the set's stepped red plates (hangs a little below the game's); speedboat decals: a brick behind the picture had taken the picture's texture (mirrored text inside the cockpit): the picture is now only kept within 0.4 of the game's own picture surface (`PIC_DEPTH`) and decals are only pulled onto hull within 0.2 (`DECAL_REACH`); re-shot after the change (`(scratch folder, not in the repo)`): the far side's "R.E.S.Q" is STILL visible from inside the open cockpit, seen from its back (mirrored), because the set's cockpit side is open where the game's hull is solid - NOT fixed.
* **Performance (`sets.mjs PERF=1`, render call + gl.finish, headless swiftshader, 2 rounds back to back, baseline `lego3d=0` / `lego3d=sets`)**: triangles per frame 36.5k -> 42.5k (ambulance), 34.7k -> 55.3k (jet ski + the Res-Q dock), 39.0k -> 43.4k / 46.1k (speedster), 37.8k -> 56.7k / 57.7k (heli), 32.5k -> 51.6k (boat), 34.9k -> 53.4k / 53.9k (dinghy), 37.3k -> 62.8k / 62.9k (locomotive: +25k triangles); the median render call is the same within noise in all 14 pairs: ambulance 2.1 / 2.1 against 2.3 / 2.1 ms (round 1 / 2, off / on: 2.3 -> 2.5, 2.1 -> 2.1), jet ski 1.5 -> 1.6, 1.4 -> 1.3, speedster 2.2 -> 2.3, 2.0 -> 2.0, heli 1.6 -> 1.5, 1.4 -> 1.3, boat 1.6 -> 1.3, 1.3 -> 1.3, dinghy 1.6 -> 1.3, 1.3 -> 1.4, loco 1.9 -> 1.5, 1.5 -> 1.8 (the raster is software here; on a GPU the triangles are free; the CPU lighting per vertex is what scales: 60k triangles ~ 35k vertices ~ 1 ms at 30 ns / vertex, only while the locomotive is in view).

**Weak / not done (round 2).**
* **Carriage (`loco_carriage_lod*`): built in section 16 (as bricks, not from the set).** The round-2 finding:  it is a game-made open flat wagon with stake panels that is in no set model; the only candidate, `wheelcase A` (7750 bogie, 22 instances), fits the chassis at chamfer 0.237 (uniform scale 1.035: 0.236; wheelcase B 0.262 / 0.209 with a free axis) and is 11.96 long against the game's 14.23: a bogie from the set cannot give a good looking wagon without inventing the layout.
* Buildings: see section 16 (measured why the set fit fails; brick reconstructions built).
* The Res-Q boat, locomotive and z38PAR plane at LOD 0 are big (9.5k, 21k, 28k triangles): fine for a GPU, 12.6x / 32x the game's; the stud prisms (394 on the z38 plane, 321 on the loco at 12 sides) are most of the z38 plane's count.
* Close-ups under ~7 units from below still show the speedster's strand, the busy underside of the z22BIP fuselage, the heli canopy decals, and the ambulance bumper; the picture-depth / decal-reach fix was re-shot for the speedboat only.
* The pack build is slow (19 min) because of the shell remeshes; they could be cached by their inputs if the part is rebuilt often.

## 14. QA and performance (full build)

**Tests** (all in `node tools/test-formats.mjs`; they skip with a note when the pack or the LDraw library is absent): `lego3d-runtime` (option off by default, URL forms, device guard, cache blob, `GameData` without a
generator untouched / with one generating, all 39 archives generate without throwing in at most ~0.8 s each in node, deterministic, damaged pack leaves the archive alone), `lego3d-textures` (156 checks: size, form, median colour, seams,
periodicity, determinism, foreign member left alone), `lego3d-studs` (194: valid meshes, game vertices byte-identical, lattice, planarity, overlap, budgets, an earlier generator's member left alone), `lego3d-bricks` (bounding boxes and stud
grids against the game's for every replaced brick, `BrickLibrary` split counts, determinism, nothing else written), `lego3d-sets` (50: valid, groups / GTOM / MATL / texture lists identical, collision source never replaced, moving-part boxes, budgets),
`lego3d-chars`, `-chars-audit` (no game triangle in the pack), `-chars-lod` (LOD pop), `lego3d-gear`. Pose / animation check: `tools/lego3d/pose-check-chars.mjs` over all clips of every rig used (section 9).
**Exactness with the option off**: `attachLego3d` is never called, `GameData` finds no `generateOverrides` and takes its old path; in the headless browser `window.__le2Mods` and `window.__lego3d` are undefined and the file layer is the plain one
(`?lego3d=0` and no parameter behave the same). Collision oracles: the mesh each record's `.col` is made from is never replaced by the sets generator; bricks keep box and stud grid; the engine reads no other vertex data for gameplay.

**Run-time cost** (headless Chromium, SwiftShader, 800 x 600, muted, machine load 10+, so ratios only; scene driver `tools/lego3d/steps/l3d.mjs`, island start / plaza view, `&hd=0`):

| | original (`lego3d=0`) | LEGO 3D (all) |
|---|---|---|
| triangles per frame | 33.7 k | 111 k (the studs of the single-LOD jetties / bridges are most of it; `-studs`: 34 k) |
| draw calls | 958 | 963 |
| vertices lit per frame (the engine lights every island mesh on the CPU, exactly like the original) | 19.4 k | about 41 k |
| JS time of the render call (min / median) | 1.7 / 2.0 ms | 2.3 / 2.5 ms |
| page frame time in the software rasteriser | 33 ms | 50 ms (SwiftShader draws the triangles on the CPU; a GPU does not) |

Generation in the browser: first visit of the island 1.2 s (pack fetch + generate; the Bricks archive 0.6 s), later visits 25 ms / 6 ms (read back from the OPFS cache). The pack is 2.13 MB (bricks 0.35, sets 1.0+, chars 0.2, textures 0.1,
studs 0.007), the cache of generated members a few MB per zone. Memory: +15.8 MB of stud mesh data over all zones (island +8 MB), 27 MB of generated TGA over the whole game (only the visited zone is ever loaded).
Characters: CPU skinning per mesh at or below the original at every LOD (section 9); sets: only while the vehicle is in view (the locomotive's 21 k triangles cost about 1 ms of lighting).
**Not measured**: a real GPU / a real quiet machine / Safari / Firefox (they were not available; CompressionStream, DecompressionStream and OPFS are the browser features the runtime needs: where one is missing the option does nothing and the game plays as the original).

## 15. What is not done, and open items

* **Sets**: the Res-Q centre, the Gas N' Wash garage, the airstrip seaplane and the train carriage are NOT set models (measured, section 16) and are rebuilt as brick reconstructions of the game's own massing (section 16); the dinghy-style leftovers of section 13 are unchanged. Far LODs of the locomotive, speedboat, tender and helicopter are closed-shell remeshes at about 3x the game's counts.
* **Bricks**: 159 of 257 bricks replaced (317 of 693 meshes), the rest stays original with a reason each (`docs/re/lego3d-tables.md`): hipped roofs, eye prints, cars' custom parts, 8 windows and 3 doors whose pane / frame has no LDraw counterpart.
* **Textures**: 138 pictures (134 stud plates + 4 walls) instead of the pilot's 139; z15SSH #62 (baked cast shadows) stays the game's; green panels, tiles and grilles are painted surfaces, not LEGO parts.
* **Studs**: single-LOD models (jetties, bridge sections) carry their studs at every distance (a distance-LOD hook is specified in section 12 but not built: about +0.2 ms); 43 far-LOD meshes keep only the painted studs.
* **Characters**: 10 heads, the LR / SLR / BGR block hands and the hook, 217 of 265 hair / hat / accessory contents (cloth, capes, crowns, spiky hair, shields ...) stay the game's; robot hips are a plain plate.
* **The pilot's stud hook** (`src/mods/lego3d/studs.ts` and 3 lines in `src/zones/z02LGI/index.ts`) is inert (it needs `lego3d/studs.json`, which no generator writes) and can be deleted together with the 3 lines.
* **Cache invalidation**: the cache key is `GEN_VERSION` (`gen/index.ts`, bump when generator code changes its output) + the pack's version (date + index hash) + a fingerprint of the archive's member list + the generator switches. A developer who changes generator code without bumping it sees stale caches (use a fresh profile).
* **Building the pack** needs the LDraw library and the OMR files (`~/Documents/legoeiland2-extract/ldraw`), the game folder (for measuring) and Blender (textures); the sets part takes about 19 minutes (shell remeshes). The pack in the repository is the build used for the numbers above.
* **Hosting check**: the Vite build emits the pack and `ATTRIBUTION.txt` as hashed assets (`dist/assets/lego3d-*.pack`); the live site was not redeployed from here.

## 16. Brick-built reconstructions: the Res-Q centre, the Gas N' Wash garage, the train carriage, the airstrip seaplane (generator `sets`, second table; pack part `bldg`)

The four models the vehicle rounds left out (docs section 13: "no good fit"). Asked: find out WHY the set fit failed, then build a proper replacement that keeps collision and waypoints untouched; choose between (a) a better-fit set model, (b) a brick-built
reconstruction (the game's own masses voxelised onto an LDraw brick grid, real bricks), (c) the game's massing plus LEGO detail, by measurement; quality gate: silhouette IoU against the game's own mesh >= 0.9 from 4+ views, no floating parts, colour match, screenshots looked at.

### 16.1 Why the set fit failed (measured, `fit` helpers of `setlib.mjs`, scratch scripts in `~/Documents/legoeiland2-extract/lego3d/scratch`)

* **The game's buildings are the game's own, simplified massing of the sets' buildings, not scaled copies.** Every coordinate of `rescue_LOD1` / `garage_LOD1` is a multiple of 0.08 on a grid of 0.4 (stud) x 0.16 (plate) x 0.4 = the brick library's grid
  (S = 0.02 per LDU, the vehicles use 0.04), the baseplates of the sets are not in the meshes, the extras (pumps, signs, the dumpster) lie elsewhere, the proportions differ (the garage building is 25 deep x 12.5 high; set 6397's `building.ldr` is 32 x 13 with its baseplate).
  The pilot fitted the WHOLE set including the baseplate with one uniform scale.
* Measured with the baseplate / ground parts removed, all 24 rotations (+ mirror), then a free per-axis scale on the truncated chamfer (vehicles: 0.10-0.17): **Res-Q** (`base.ldr`, parts above the ground deck) best 0.33 (a degenerate squash of 0.3 in z), 0.35 mirrored, uniform 0.43-0.46; **garage** (`building.ldr` without `309p03` / `4187`) uniform S = 0.04: 0.426 (0.417 mirrored in x or z), scales 0.8 / 1.2 / 1.3 of S: 0.436 / 0.414 / 0.408. No rotation / scale / mirror gets near a vehicle-like fit (the composition matches by eye: three sloped roof sections on black ribs and white walls, the roof deck on four black legs with the round bay and the dish; the details do not).
* **Airstrip seaplane**: IS the 5935 Island Hopper (`plane.ldr`) at scale 1.00 (axes 1.00 / 1.03 / 1.01), rotation (-1,0,0,0,1,0,0,0,-1), but only its static groups 3-10 fit (chamfer 0.22 with the outer wings left out, 0.33 with the whole set): **its wings are the game's moving groups 11-20 (MATL translation = the hinge at x = +-7.03, y 4.06), modelled folded UP in the bind pose**; the earlier pilot compared the plane with the horizontal wings. Built as the set model (`SETS_B`, tried: pack `bldg` first version, fit + `buildMeshGroups`) it reaches a silhouette IoU of only **0.77 min / 0.87 mean (LOD 1), 0.72 / 0.80 (LOD 3)**: the set is an open frame (floats ride lower, the tail boom is a thin beam, the fuselage is hollow) where the game has solid massing.
* **Carriage**: in no set (section 13: wheelcase A 11.96 long against 14.23, chamfer 0.237); the game's is an open wagon (deck, four stake panels, buffer beams, two axles).

### 16.2 The choice: (b) for all four, with (c) for what a brick cannot say

(a) is out by measurement (above: chamfer 0.33-0.46, IoU 0.77). (c) (keep the massing, add LEGO detail) would score IoU 1.0 but it is not brick-built. **(b)**: the game's flat-colour static groups are voxelised and rebuilt from bricks; **(c) remains for every group that is not a flat colour mass**: pictures and decals (the Octan sign, the door pictures), translucent panes, the groups with a MATL matrix (moving doors, the radar dish, the sliding arm, the seaplane's props and folded wings: GTOM / MATL are the player's own, the game animates them), thin parts (the antenna, the wheel discs) stay the player's own triangles. Collision (`.col`, made from each record's last LOD: `rescue_LOD5`, `garage_LOD5`, `loco_carriage_lod5`, `airstrip_seaplane_LOD5`), waypoints, records are never written.

**How it is built** (`tools/lego3d/bldg.mjs`, builder `tools/lego3d/pack/bldg.mjs`, run time `src/mods/lego3d/gen/sets.ts` unchanged in principle: a second table `sets/arch/<archive>.b.json` in the same format):
1. Mass groups = static (identity MATL), opaque, flat colour (4x4 texture), >= 12 triangles (carriage: textured allowed, >= 6; seaplane: groups thinner than 0.6 left out) of every LOD but the last.
2. **Voxelise** onto the brick grid (stud 0.4 x plate 0.16 x 0.4; carriage the same): a cell belongs to the group whose surface it lies directly BEHIND (centre at most 0.75 of a stud behind a front face, projection inside that triangle: the game's surfaces are open, there is no inside/outside by parity), enclosed hollows are filled. The grid offset is searched per LOD on a 4^3 lattice for the best silhouette IoU against the game's surface (the plane-alignment guess is the start).
3. **Cover with real bricks**: per column the runs are cut into bricks (3 plates) and plates, then greedy rectangles of the LDraw sizes (bricks 1x1..2x8: 3005 3004 3622 3010 3009 3008 3003 3002 3001 2456 3007; plates up to 6x12: 3024 3023 3623 3710 3666 3460 3022 3021 3020 3795 3034 3031 3032 3035 3958 3036 41539 3033 3028), the long side alternating per layer (the parts list in the report / ATTRIBUTION; Res-Q LOD 1 = 840 bricks, garage 2008, carriage 273, airstrip plane ~880).
4. **Emit** the outer surface of the union of the bricks: faces merged into rectangles per plane (the seams of one colour are invisible at this scale), a real LDraw stud (radius 6 / height 4 LDU on the 20 / 8 grid) on every exposed top cell, 6 sides (8 on the carriage, 4 on the seaplane), except the interior of big flat areas (smooth tiles: studs stay on a one-cell rim); no studs from the LODs that start at 100 units (the airstrip plane's LOD 2 starts at 30 and keeps them).
5. At run time: decals are lifted onto the new surface, the player's pictures / panes / moving parts are kept byte-identical, pieces of the player's group the new bricks do not cover (antenna, thin parts) stay (gap filling, unchanged); the new table field `hold` (boxes of triangles that always stay: the carriage's four wheel discs, which are round) is the one addition; textured brick walls (the carriage's green panels, whose ribs the game models as geometry) get the median texel of the player's group, other textured groups the uv of the nearest FACING triangle.

### 16.3 Measured (post-generator, the browser's path, 9 views, 512 px; `node tools/lego3d/bldg-iou.mjs zone Mesh.Msh ...`, test `tools/tests/lego3d-bldg.mjs`, gate >= 0.9 for every replaced LOD)

| model (LOD from) | game tris -> new | silhouette IoU min / mean |
|---|---|---|
| Res-Q centre LOD 1 (0) / 2 (100) / 3 (150) / 4 (190) | 1609 -> 16.3k / 1034 -> 1.9k / 458 -> 1.5k / 180 -> 0.9k | 0.968 / 0.982, 0.966 / 0.983, 0.934 / 0.955, 0.944 / 0.961 |
| garage LOD 1 / 2 / 3 / 4 | 2195 -> 46.2k / 1499 -> 3.1k / 769 -> 2.2k / 298 -> 1.2k | 0.976 / 0.982, 0.983 / 0.987, 0.977 / 0.987, 0.968 / 0.977 |
| carriage LOD 1 / 2 / 3 / 4 | 790 -> 11.7k / 478 -> 1.2k / 254 -> 0.7k / 102 -> 0.6k | 0.931 / 0.950, 0.937 / 0.950, 0.922 / 0.934, 0.955 / 0.966 |
| airstrip seaplane z14OSD (z23DIP alike) LOD 1 / 2 / 3 / 4 | 938 -> 14.1k / 812 -> 13.5k / 553 -> 3.5k / 292 -> 2.7k | 0.928 / 0.960, 0.930 / 0.958, 0.927 / 0.956, 0.923 / 0.956 |

(The thickness factor 0.75 of a stud and the per-LOD offset search each moved the minima by +0.03 .. +0.06 against the first build: seaplane LOD 4 0.822 -> 0.923.) Test also checks per mesh: group count / order / flags, GTOM + MATL, kept groups and decal topology identical, `hold` triangles present, outward winding, unit normals, finite UVs, culling sphere within 20 % (centre 0.2 radii), world box within 0.5 units, <= 60k triangles, deterministic, foreign member left alone, no `.col` written, the record's last LOD never listed.

**Cost** (headless Chromium, SwiftShader, 800 x 600, quiet machine, `steps/sets.mjs PERF=1 FREEZE=...`, render call + `gl.finish`, median / p90 ms; "off" = `lego3d=0`, "no sets" = every generator but `sets`, "on" = everything):

| scene | triangles off / no sets / on | render ms off | no sets | on |
|---|---|---|---|---|
| Res-Q centre, 30 units | 35.4k / 92.0k / 123.5k (+31.5k from the building) | 1.2 / 1.3 | 1.6 / 1.7 | 1.6 / 1.8 |
| garage, 36 units | 38.5k / 116.0k / 161.9k (+45.9k) | 1.5 / 1.6 | 1.9 / 2.1 | 1.9 / 2.1 |
| train carriage + tender + locomotive, 13 units | 39.0k / 105.9k / 138.9k (+33.1k incl. the vehicles of section 13) | 1.4 / 1.5 | 1.8 / 1.9 | 1.8 / 1.9 |

The sets generator costs no measurable render time here (the rasteriser is software; the CPU lighting per vertex is what scales: the garage's 46k triangles are about 1 ms on a slow machine). Pack: 2.15 -> 3.13 MB (+0.98 MB: the new meshes 0.9 MB), generation in the browser per archive a few ms more.

**Screenshots looked at** (headless, muted, `tools/lego3d/steps/sets.mjs`, `sets-zone.mjs`; originals with `lego3d=0` beside them): the Res-Q centre from three angles and from 70 units (black roof deck on four legs, yellow front bay with the game's blue panes, the radar dish and antenna the game's own, studs on the rim of the roofs), the garage from three angles and 80 units (white walls, red sloped roof sections stepped in plates, the Octan picture on the wall, the pump island with its studded forecourt), the carriage beside the tender (studded red deck, brick buffers, the game's wheel discs, green panels), the airstrip seaplane in z14OSD (red hull of bricks, folded wing panels of the game, blue props). Sheets by `tools/lego3d/set-sheets.mjs --pack FILE` and the IoU masks.

### 16.4 Deviations, weak spots (honest)
* **Not the set's detail**: the Res-Q centre and the garage are the game's massing in bricks, not set 6479 / 6397 parts: no window frames / door frames from LDraw (the game's panes and door pictures stay), stairs where the game's roofs and the round bay slope (voxel steps of 0.16 high x 0.4), no slope bricks, the underside of roofs flat (no anti-studs). Seams between bricks of one colour are invisible (flat shading, one texel colour).
* **The carriage is built at 0.4 / 0.16 (the buildings' brick scale), not at the 0.8 / 0.32 stud pitch of the locomotive and tender** (the 7750 set at 0.04): at 0.8 the best silhouette IoU was 0.84-0.91 (thin deck and rails vanish), at 0.4 it is 0.92-0.96; its studs are half the size of the locomotive's. The wheel discs, axles of the bogies and the buffers' ends stay the game's (round).
* **The seaplane's wings, props and the radar dish / door / sliding arm of the Res-Q centre / the garage's car-wash doors stay the game's** (moving groups; the animation turns them, rebuilding them as bricks would need per-group pivots: not done). The seaplane's LOD 4 / the far LODs hold the IoU only by the ground rule above (>= 0.92); its LOD 1 / 2 are 14k triangles (studs of the 0.4 grid) against 0.9k.
* The garage LOD 1 is 46k triangles (2400 studs x 12-16); reducing the studs to 4 sides would save 14k (not done: looked at, 6 sides read better at 600 px).
* Textured brick walls get one texel colour; the carriage panels lost the game's ribs (they are geometry in the game).
* `?lego3d=-sets` now removes these four as well (one generator); there is no switch for the second table alone.

### 16.5 Files
`tools/lego3d/bldg.mjs` (voxeliser, brick covering, surface emitter, offset search), `tools/lego3d/iou.mjs` (silhouette IoU), `tools/lego3d/ldcolors.mjs` (LDraw colours for the sheets), `tools/lego3d/bldg-iou.mjs` (the gate as a tool), `tools/lego3d/pack/bldg.mjs` (builder `bldg`, `node tools/lego3d/pack/build-pack.mjs --only bldg`, 35-50 s; spec list `BLDG`), `tools/lego3d/pack/sets.mjs` (`buildSpecs` split out), `tools/lego3d/set-sheets.mjs` (`--pack`), `src/mods/lego3d/gen/sets.ts` (second table `.b.json`, `hold`, facing-uv, median texel for brick walls), `tools/tests/lego3d-bldg.mjs`, `tools/tests/lego3d-sets.mjs` (skips the second table), `tools/lego3d/steps/sets.mjs` (`FREEZE=`), `GEN_VERSION` 4.
