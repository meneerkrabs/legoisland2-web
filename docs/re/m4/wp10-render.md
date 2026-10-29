# WP10: island rendering fixes

Owner files: `src/game/render.ts` (GameRenderer), surgical edits in `src/render/renderer.ts`, `src/formats/exe.ts`, `src/formats/emusetup.ts`,
`src/zones/z02LGI/ctx.ts`, `src/island/ctx.ts`, `src/island/ambient/misc.ts`, `tools/tests/m4-wp8-island.mjs`. Test `m4-wp10-render`.

## 1. Faces (Faces.c, GSMS_MI.c)

* **Set-up**: the zone builders call `FUN_0043f1d0(model, slot, maxParts, groups[5], type)` once per character model (island builder FUN_004c34c0:
  records SBRD and 9..66). `slot` = the attachment slot whose child model carries the face (-1 = the model itself; the island always uses slot 4 = the head,
  bone 10); the call does nothing when the slot is empty (swifts, bunnies, Ptera: type-0 calls without a head) or the child has more than `maxParts` parts.
  `groups[i]` = the mesh group of LOD part i that shows the face (island minifigs: group 1 in every LOD; PEPP: 0, 0, 1, 1, 0). The face object is created by
  `FUN_0087dea0` (type 0, vtable 0x898a0c) or `FUN_0087e3fd` (type 1, vtable 0x898a18) and stored at model +0x14.
* `extractZone` (`src/formats/exe.ts`) now records these calls as `Model.face = { slot, maxParts, groups, type }` (the group array is a frame local of the
  builder; read from the interpreter's locals snapshot).
* **Type 1** (every island character): the head mesh maps the face into the top-left quarter of its texture (u 0..0.25, v 0.75..1). At set-up
  `FUN_0087e260(group, 4, 4)` rescales that group's UVs once: `u' = 4u`, `v' = 4(v - 1) + 1` (DAT_00892020 = 1.0), so the face fills the 64x64 `.wib`
  sheet (16 frames, identity sequence: 509 INFO, 462 PAPA, 445 MAMA, 473 PEPP ...), and `FUN_00443120(model, i, group, 2, n)` -> `FUN_00411202` freezes the
  sheet on frame n. `FUN_0043f2f0(model, n)` = vtable +4 = `FUN_0087e570`: sets the frame of every LOD's face texture; `FUN_0043f310` reads it back.
  Before WP10 the port drew the quarter unscaled at frame 0 (a magnified corner of the sheet: the "flat yellow head").
* **Type 0** (a 4x4 atlas texture): `FUN_0087e038` -> `FUN_0087e0cf` adds `(DAT_00981190[n], DAT_00981194[n])` = `((n & 3) / 4, -(n >> 2) / 4)` to the
  group's UVs relative to the base UVs. No island model uses it with a head attachment; implemented for the other zones.
* **Port** (`GameRenderer.applyFace`): per draw of the face carrier, the face group gets a UV scale (new `DrawOpts.uvScale`, about (0, 1), shader uniform
  `uUvScale`) or offset, and the sheet is set to `rec.face` with `Renderer.setTextureFrame(..., mode 2, frame)` right before the draw. The original keeps
  ONE frame per texture (the last `FUN_0043f2f0` wins for every model that shares the sheet); the port's per-record selection only differs when two records
  share a face texture and show different expressions at the same time. `rec.face` 0 = frame 0 = the set-up default.
* Applies to all zones (every builder calls FUN_0043f1d0 for its minifigs); z03PPH checked visually.

## 2. Lighting of skinned characters

Checked against the decompile, **no change needed**: the skinned path `FUN_0088b87b` skins positions and normals with the bone matrices (model space,
no renormalisation; MFIG/SWFT/RBBT bind poses have unit-length rotation rows), `FUN_00885664` brings each directional light into model space
(`FUN_0043b0c5` = transpose of the world rotation, negated, normalised with FUN_0043cec0) and `FUN_0088589e` evaluates `I = -(L . n)`,
`acc += (1 - acc) * I * diffuse`, `max(acc, ambient)` = exactly the static formula `FUN_00885a9a` (directional + ambient; point lights only in the static
one, range 1.0). In world terms that is `dir . (n R)`, i.e. the renderer's world-space shader formula (test: 50 random rotations / normals, max difference
< 1e-6). z02LGI's `lights.lgt` has ONE light (declared count 2, the second record is absent): sun toward (0.707, 0.600, 0.375), white, ambient
(0.18, 0.18, 0.24). A character whose lit side faces away from the camera therefore shows texture x 0.18 (dark red torso 46/255, grey-ish hats) - the
opening cutscene films Infomaniac against the sun (camera at the INFC looking +x, sun from +x). Mesh normals of MFG_HR / PEPP_HR / heads point outward;
Pepper and the NPCs use the same body mesh and formula. Attachments (heads, hats, hands) are drawn with mode 1 (lit every draw) or 2 (unlit) by
`FUN_004440f0` (part +0x10 == 0xffffff -> 2): the port lights them per vertex like mode 1.

## 3. Live part matrices (WP4 contract)

`DrawOpts.groupMatrix(g)` replaces the static MATL matrix of a group (`renderer.ts drawMesh`); `GameRenderer.partMatrices(rec)` (hook, null by default)
maps a record to its live MATL matrices and the renderer looks up `gtom[g]` per group (all LODs, skinned or not). The island context wires it in
`IslandContext.bind`: `zg.gr.partMatrices = (rec) => partOverrides(world, rec)`. Verified in the browser: INFC exit doors (parts 1 / 2) swing open to
-1.57 / +1.57 and the roof swing part turns (`/tmp/wp10/a/d-INFC-*.png`), PHEL's rotors (parts 1 / 3) turn while flying in era 3 (node 52).
PHSE's doors could not be seen at node 2: PHSE has flags 0x20 (hidden) until the story gives Pepper the house.

## 4. Frustum flag (FUN_00444370) and the shore foam

* `FUN_00444370` (per frame, after the update pass): for every record, flag 1 is cleared when `flags & 2` is clear, set when the record has no collision
  object (+0x58 null / 0xbabababa), else set when the collision sphere (col +0xc centre transformed by the record matrix, col +0x24 radius) passes the six
  frustum planes (FUN_00416590 / FUN_004164f1: `dot(plane, c) - d > -r`).
* Port: `GameRenderer` keeps the six normalised planes of the last drawn view (`clipPlanes(viewProj)`, exported; GL clip space, real canvas aspect) and
  `sphereVisible(c, r)`; `IslandContext.inFrustum` (an arrow property: `src/island/npc/globals.ts` calls it unbound) applies the rules above with
  `rec.colObj.col.center` / `colObj.radius`. Before the first frame (and in node tests without a renderer) every record is in view. Every z02LGI record has
  a collision object. The flag is NOT written into `rec.flags` (the nodes ask the context; `inView` helpers of WP3 / WP7 already do).
* **SeaAmin** (`FUN_004b109e`): `FUN_0043ebe0(model, 0, &0, &v)` -> `FUN_0087dd20` -> `FUN_0088350d` mode 0 ADDS (du, dv) to the UVs of every vertex of the
  part-0 mesh every drawn frame (it is not an absolute offset): with v = sin(phase) * 0.003 and the phase stepping 0.0524 on the positive half and 0.0175 on
  the negative half the foam texture drifts (net about -0.19 V per 200 ticks) with a back-and-forth. New optional `IslandCtx.uvScroll(rec, du, dv)`; the
  node calls it from its pre-render (per tick, the original per drawn frame); `IslandContext.uvScroll` forwards to `GameRenderer.scrollGroup` for every
  group of the record.

## 5. Emulator: FUN_0043cec0 native

`emusetup.ts NATIVE_ENGINE` += 0x43cec0 (vector normalise, only CRT sqrt inside). The vehicle arrivals of the emulated set-up (SPBT from zone 6, PHEL
from 10 / 13 / 19) now place Pepper exactly where `arrival.ts` does; `m4-wp8-island` checks the vehicle places against the emulated PEPP too (99 checks).

## 6. Blob shadows of other records (FUN_00444940)

Was: only Pepper. Now as the original: Pepper always (type var 0xc5, -1 = none), other records only when their controller's flags (+0xc) have 0x10 or
0x40 and the record is within 80 units of the camera (`_DAT_008921ec` = 6400 squared), type 4. The blob centre and heading come from bone 0 of the pose
(hips) unless SWITCH_GME_PEPP_IN_VEHICLE (var 0xa9) is set or the record has no pose. The ground rays now ignore the record itself (the original casts
only against its registered collision list DAT_009e5714; with `sweep(null)` an NPC's own bound box caught the ray and hid the blob inside the body).
Island NPCs have controller flags 0x13 (shadow), buildings 0x83, animals / props 0x86, vehicles 0x26 (none).

## 7. Walk-around findings (nodes 2, 7, 30, 52 -> 54, 61; screenshots /tmp/wp10/tour, /tmp/wp10/a)

* Fixed: faces, door / rotor parts, NPC shadows, foam drift (above).
* Records left enabled at the origin (all eras): JETT(8), SPLH, BS00, OBL0, JAK0, BRL0, CT00, CA00, CR00, FO00, LE00, FL00, FF00, OS00, TS00, TRGO, TRSI,
  TRBR, OPL1, OPL2. They sit inside the terrain under (0, 0, 0) and are invisible in play (checked by hiding LAND: `origin-2.png`). Not changed (they are
  carried / effect objects the nodes place; whether the original hides them could only be told from the emulated flags, which leave them enabled).
* Era 3 (node 52 -> 54 after the intro): TOWE, CTRL, PLAT, SHTL have flags 0 (hidden) while TBOB stands on the mountain top: story state (WP8), not a
  rendering issue; worth a check by the lead.
* PTER shows its bind pose on the mountain (the Ptera node is not ported, WP6 / WP7).
* Sea: thin light seams in the water follow the seabed's triangle edges (the seabed is drawn without depth and the cyan clear colour shows through
  T-junction cracks, then the 50 % sea plane over it). Probably the same in the original (same draw order and states); not changed.
* Animation: NPC idles, Pepper, bunnies (RBBT clips 1-3) and swifts (SWFT) advance; butterflies have no animation instance (static meshes in the loader).
* Lighting: see 2 (dark sides are the 0.18 ambient).

## 8. Tests

`m4-wp10-render` (54 checks): face set-ups of the builder (INFO, PAPA, MAMA, NICK, BILL, BBT0, NUBB, HOLO, PEPP, swifts / bunnies), the scaled face UVs of
every LOD of INFO / PAPA / PEPP and their 16-frame sheets, `clipPlanes` / `sphereVisible` (ahead, behind, far, crossing far, left / right, near with
radius), `IslandContext.inFrustum` rules (in view, behind, no collision object, disabled, before the first frame), the `partMatrices` binding, SeaAmin's
`uvScroll` calls (per tick, |dv| <= 0.003, net negative drift), and the skinned-lighting equivalence. `m4-wp8-island` extended (vehicle arrival = emulated).
Browser: private dev server 5495, bots in /tmp/wp10 (close-up camera by wrapping `gr.render`).
