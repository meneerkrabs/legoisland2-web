# A LEGO-model look for the game (pilot): inventory, pipeline, results, licence, proposal

Players find LEGO Island 2 flat next to LEGO Island 1. The idea: the game's meshes are already (stylised) LEGO parts, so rebuild them from the real LEGO part models of the LDraw library and keep everything
the game does with them (skeletons, animations, bone attachments, LOD distances, texture slots, collision, waypoints), then map the game's OWN textures onto them at run time. This is an optional
mod layer (`src/mods`): nothing changes for the default game. **This is a pilot**: Pepper (body, head, hands), the island's jet ski, 14 bricks of the brick library, 10 LEGO-surface textures and real 3D studs on the jetties' and bridges' stud plates.
Everything here is under `tools/lego3d/` (generators, run with node and headless Blender) plus this document and **one additive engine hook** (section 7: `src/mods/lego3d/studs.ts` + 3 lines in `src/zones/z02LGI/index.ts`, only active when a mod carries `lego3d/studs.json`).

Numbers below come from `tools/lego3d/inventory.mjs`, `textures-inventory.mjs`, `bricks.mjs --verify --all`, `pose-check.mjs`, `bench.mjs`, `compare-counts.mjs` and the headless browser runs
(`tools/lego3d/steps/*.mjs`); the data lives outside the repository in `~/Documents/legoeiland2-extract/lego3d/` (inventory JSON, previews, shots) and
`~/Documents/legoeiland2-extract/mods/lego3d-pilot/` (the mod folder, LI2 Mod Manager layout).

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

## 6. Proposal and estimate for doing everything

Goal: every character, the brick library, the LEGO-built buildings / vehicles and the LEGO-surface textures of the game rebuilt from LDraw, as one optional "LEGO 3D" option (start screen, next to "HD-textures"),
off by default, the original look untouched without it. What the pilot proved: the mod layer takes the new meshes as they are (no engine change), the skeleton / animation / attachments / LOD scheme / texture slots
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
