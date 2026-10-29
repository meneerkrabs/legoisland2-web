# Particles (FX_Particle.c, CParticle*.cpp): the port in `src/fx/particles`

Gap R1 / R1b (WP-PART). The runtime is ported function by function from the decompile and checked against the ORIGINAL code in the x86 interpreter (section 7).
Read this first when you wire the emitters of a zone (section 5, about an hour per zone).

## 1. Files

| file | content |
|---|---|
| `core.ts` | `PState` (the shared tables: sin[256], cos[256], rnd[4096], index), `msvcRand` (injectable `rand()`, `// RNG:`), flat records `Rec` (byte offsets of the original), `ftol` |
| `layout.ts` | field offsets: appearance `AP` (0xe8 bytes), movement `MV` (0x144), emitter `EM` (0xb4), block `BK` (0x350), particle `PT` (0x308) |
| `text.ts`, `keys.ts`, `defs.ts`, `files.ts` | the loaders `FUN_0044fe30` (directory scan), `FUN_00450e20` .app, `FUN_00450250` .mov, `FUN_00450640` .emi, `FUN_004509b0` .par / .swl, the key table (48 keys); `ParticleDefs` = the loaded lists |
| `actions.ts` | the script action manager `FUN_00455750` and its action classes (ramps, SetEmiPrimitive, ExecuteScript, EndSource, ResetScript), `forAll` |
| `source.ts` | `FUN_00454020` init, `FUN_00452300` update (emission, primitives, ageing, movement, collision), `FUN_00453410` sub-emitter ([EMITS]) update, spawn functions |
| `swirl.ts` | `CParticleSwirl`: `FUN_00451600` / `FUN_004517f0` / `FUN_00451ef0` / `FUN_00451fa0` / `FUN_00451f60` / `FUN_00451760` |
| `mat.ts` | the matrix helpers: `FUN_0043ac78` identity, `0043a5e4` Euler, `0043a9e5` multiply, `0043ab72` / `0043abe6` transform point / direction, `0043cec0` normalise, `0043cfee` reflect |
| `pool.ts` | the particle pools / blocks (`FUN_0044f1d0` / `0044f1f0` extra sources) |
| `engine.ts` | `ParticleEngine` = `FUN_0044ec60` + the API (`start` 0044f710, `startSwirl` 0044f7c0, `setMatrix` 0044f850, `setGate` 0044f900, `stop` 0044f9e0, `setCollision` 0044fa00, `setParam` 0044fa30, `finishSetup` 0044f090, `update` 0044f2c0 / 0044f220) |
| `sprites.ts` | the CPU draw functions: `buildQuad` (`FUN_0044f4c0`), `clipPolygon` (`FUN_008885e0`), `sortSprites` (`FUN_00887ae5`), `frustumPlanes` / `visibleFlags` (D3D `ComputeSphereVisibility`), `projectPoint` (`ProcessVertices`), `spinStep` |
| `draw.ts` | `ParticleDraw`: the GL pass (`FUN_0044f380`, state blocks 6 / 7 / 3, depth test + write, alpha test >= 1/255) |
| `zone.ts` | `ZoneParticles`: the zone-facing `fx` hooks (section 4), installs the draw hook on `GameRenderer.particles` |
| `island.ts` | `IslandCtx.particles(name, mode, pos, owner)`: the island's emitters (section 6) |

## 2. How the original works (what is ported)

* One engine `DAT_05d3b09c`: 150 sources (0x620 bytes), 150 swirls (0x9e4), extra "splash" sources, a draw list of 4096 sprites (400 model particles, unused: `iUseModel` is 0 in all data).
  Created per zone by `FUN_00442900(archive name)` (hubs and zones without a `Particle/` folder use `GENERICBITS`); `FUN_0044e8d0` (`finishSetup`) once after the zone created its emitters; `FUN_00442930` updates and draws every frame
  (`FUN_0044f2c0(dt)` then `FUN_0044f380`).
* Records are found by the FIRST LINE of their file (exact, case-insensitive; the file name is irrelevant). Callers use `"bolts01.par"` and `"bolts01"` alike. All shipped files are CRLF.
* Everything is float32 in memory and double (x87, 53 bit) in expressions: the port keeps double arithmetic and rounds with `Math.fround` at the stores the asm has. **The decompile's expression order and spills are not reliable: the asm decides.** Found by the oracle: the reflect
  function rounds three intermediates; the API inputs `pos` / `rot` / `dt` are float32.
* The random table: sin[256], cos[256] and rnd[4096] are consecutive in memory (an index overrun reads the next table). `rnd()` is `idx = (idx + 1) & 0xfff`, the index persists across effects. `rand()` (C runtime) is used for the circle primitive and the spin sign.
* Script actions (`.par`) run on windows of the global frame counter `DAT_009da5cc`: `start = frame - ftol(t0 * -30)`, `end = start - ftol(t1 * -30)`. The buckets are sorted by the first action's t0 with the original's insertion quirks. A `ForAll` writes the value AFTER the
  increment to the live particles; the vec3 ramp adds a step on the first frame and assigns `end` exactly on the last frame.
* Emitter primitives: box 0, line 1, sphere 2, ring 3, circle 4; ring / sphere AngleMode 13 reads the POINTS table (2 pi / n; entry 11 is garbage 1.79e25 in the executable: reproduced).
* Sub-emitters ([EMITS]): their particles get NO velocity from the direction; positions get rnd x parent velocity twice; the main particle's life uses the unrounded double, a sub-particle's life uses `ftol`.
* Gate: `(getVar(var) & mask) == value` (var 1 is always 0, var 2 always 1: `GameVars.get`). The gate skips only the emission / script, particle ageing continues. A `SetGate` with another var and non-zero value / mask restarts the script manager.
* Source slots are never reused in the original (150 starts per level at most). Distance LOD (only z27TRX sets `DAT_05d3b0a0`): emission scale 0 beyond 400, 0.25 beyond 200, 0.5 beyond 120.
* **The stale appearance pointer** (found by the oracle, z38PAR cloud01 + a floor): in the main update loop `FUN_00452300` the register that holds the appearance record is only reloaded for particles with `life > 0`; an IMMORTAL particle
  (`fLifespan < 0`) that collides is handed the record of the last particle spawned / aged: its SIZE is the collision radius and its SCTINC is the one reset on a hit (`eng.staleApp`, the stack slot persists between calls).
* The splash path (`[SPLASH]` + a collision list: z20DSP / z21FSH splash01) dereferences a NULL parent matrix in the original (a crash); the port throws the same way. No other effect is affected.

### Drawing (`FUN_0044f380`)

1. Per particle: sphere visibility (radius = its current size) against the view frustum; a sprite is kept when `(flags & 0xf) == flags`: only the overall bits and the LEFT plane may be "intersecting", right / top / bottom / near / far must be fully inside (**inferred D3D
   behaviour, see section 8**).
2. `ProcessVertices` with the identity world: x, y in pixels, z in 0..1, rhw. Sort ascending by rhw (the exact hybrid quicksort of `FUN_00887ae5`, not stable).
3. Quad: half extent `S = sin[ANGLE] * size * R * sizeScale`, `C = f32(cos[ANGLE] ...)`, `R = invZoom * rhw`, `sizeScale = f32(designWidth / zoom0)`; corners `(x+C, y+S) (x-S, y+C) (x-C, y-S) (x+S, y-C)`; UV0..7 from the sprite; diffuse ARGB from the 8.8 ints.
   Sutherland-Hodgman clip to the viewport (left, right, top, bottom), fan triangulation. `designWidth` = 4/3 x viewport height (the original's 640 x 480 back buffer is the design size: in a wide window the sprites keep their size relative to the height).
4. State: material 0 = block 6 (colour tex x vertex, alpha tex x vertex, SRCALPHA / INVSRCALPHA), 1 = block 7 (colour = vertex colour only, alpha = tex x vertex, SRCALPHA / ONE: the additive glow), 2 = block 3 (colour tex x vertex, alpha = tex). Depth test and WRITE on, fog off, no culling.
5. The spin (`SCT += SCTINC * dt; ANGLE = ftol(SCT + 256) % 256`) advances once per game tick after the draw, for the sprites that were visible (`ParticleDraw.flushSpin`: applied lazily at the first draw after a tick, with a generation check for recycled particles).

## 3. Time

`ParticleEngine.update(dt, frame)` is the original's per-frame update with `dt` = `DAT_008b1718` (1.0 at 30 Hz) and `frame` = `DAT_009da5cc` (`world.frame`). **It must run once per logic tick.** `ZoneParticles` catches up in the draw hook with `world.tickCount`; when the simulation moves to the fixed
60 Hz step with dt = 0.5 only `World.dt` changes: all emission / ageing counts are per tick and scale with dt like the original's (the script windows are in frames of `world.frame`, not of seconds). Pause (`vars.get(10)`) runs the repaint path (`FUN_0044f220`: nothing moves, the sprites are re-listed).

## 4. The API (`ZoneParticles`, src/fx/particles/zone.ts)

```ts
const fx = await ZoneParticles.create(zg);      // in the zone factory, AFTER ctx.gr.fov was set; null when the archive has no Particle data
const h = fx.start('bolts01.par', rec.m, [0, 5, 0], [-Math.PI / 2, 0, 0]);       // FUN_00442960; default gate OFF (1,1,1); the matrix is the record's LIVE matrix (rec.m)
fx.collideWith(h, groundRecord);                // FUN_00442a50: reflects the particles; a record named PCOL* kills them
fx.finish();                                    // FUN_0044e8d0, once after the emitters were created
fx.on(h); fx.off(h);                            // FUN_00442a20(h, 2,1,1) / (h, 1,1,1)
fx.setGate(h, [var, mask, value]);              // any gate, e.g. [0x110, 2, 2] (the island's rocket01 switch bits)
fx.setMatrix(h, matrix);                        // FUN_00442a00 (a source keeps the reference, a swirl copies)
fx.setParam(h, PARAM.DENSITY, 3.5);             // FUN_0044ebd0: overrides (re-applied every tick)
fx.stop(h);                                     // FUN_00442a40
const s = fx.startSwirl('wabswirl.swl', [0, 0, 0], [-Math.PI / 2, 0, 0]);       // FUN_004429a0: its parent matrix only comes from setMatrix (the matrix argument is ignored, like the original)
```

Hosts that run the engine once per pass of the original's main loop instead of per update pass (the front end: `FUN_00442930` runs in every mode of its loop, also during the fades, but not in its exit block) set `fx.manual = true` and call `fx.step()` per pass (`src/shell/frontend.ts`, gaps.md R11); the front end creates its engine from the z60FRE archive and never calls `fx.finish()`.

Handles: sources `0..149`, swirls `0x1000 + i`, failure `NO_HANDLE` (0xbabababa); every call accepts them (invalid handles are ignored like `FUN_0044ea00`). Effect names are the first line of the `.par` (case-insensitive), with or without `.par`.
Debug: `window.__particles` (the ZoneParticles of the running zone: `.stats`, `.engine.drawList`, `.liveParticles(h)`), `tools/steps/particles-island.mjs` and `particles-zones.mjs` start effects in the headless browser.

## 5. Wiring a zone (WP-PART-WIRE), the recipe

1. In the original find the zone's start calls: `/tmp`-style listing of all call sites is `grep -n "FUN_00442960\|FUN_004429a0\|FUN_00442a20\|FUN_00442a00\|FUN_00442a40\|FUN_00442a50\|FUN_0044ebd0" LE2.c` (names: 00442960 start, 004429a0 swirl, 00442a20 gate, 00442a00 matrix, 00442a40 stop, 00442a50 collision list,
   0044ebd0 param). The constructor / setup function lists the effect name, the parent record (`DAT_00983804 + k` = record `(k - 0xc) / 0x68`: record `k` has its matrix at `+0xc`), the local position (3 floats) and the Euler rotation (usually `0xbfc90fdb` = -pi / 2 about x: "up"),
   and the gate (almost always `(1,1,1)` = off; `(2,1,1)` = always on). Read the hex floats with `struct.unpack('<f', struct.pack('<I', h))` (see the z17WAS wiring: exact values).
2. Create `const fx = await ZoneParticles.create(ctx)` in the zone factory (after the zone set its fov), start the effects exactly as the constructor does, call `fx.finish()`.
3. Find the game code that switches them (`FUN_00442a20(h, 2, 1, 1)` on a hit, `(1, 1, 1)` at reset; `FUN_00442a00` when the emitter follows something) and call `fx.on / off / setMatrix` at the same place of the port's logic (one line each; see `z05WAB/wab.ts` `host.fx`).
4. A collision record (`FUN_00442a50(h, record)`): `fx.collideWith(h, rec)`. The query is the original's `FUN_00441b10` (`world.col.rayRecord(rec, pos, vel, 0, radius, radius)`); no extra port work.
5. Check with `window.__particles.stats` (visible / polygons) and a screenshot (`tools/steps/particles-zones.mjs` is a template). Do not approximate: if an effect looks wrong, compare the start call (position / rotation / gate / matrix) with the original first, the engine is verified (section 7).

Pitfalls: a `bolts01` that never shows has usually its gate left at the initial `(1,1,1)`; an emitter with a record matrix needs the record's LIVE matrix (`rec.m`, not a copy); effects in z27TRX need `fx.setLod(true)` (FUN_0076b070); hub zones create their engine with
`GENERICBITS` (the `create` fallback does this for zones without a `Particle/` folder).

## 6. The island (`IslandCtx.fx`, src/island/emitters.ts)

The island's nodes start their emitters through `ctx.fx` (the zone's ZoneParticles) exactly like the original's calls: `fxStart` (FUN_00442960 / FUN_0044e920: name, PARENT MATRIX = the record's live matrix or a private static matrix, offset, Euler rotation, gate), `fxGate` (FUN_00442a20 / FUN_0044ea60), `fxMatrix` (FUN_00442a00 / FUN_0044ea00), `fxParam` (FUN_0044ebd0), `fxStartSwirl`. The era functions' emitters (bill01, rocket01, twinkle03, zzz, shuttle, problow, eatpizza, twinkle01 / 02) are replayed from the emulated set-up's calls (`startSetupEmitters`); the director binds rocket / bill / zzz to bone matrices (`boneWorld` = FUN_0043bc58 + FUN_0043a9e5, verified against the original). Hand pizzas have no emitters in the original (FUN_0044ebb0 returns NO_HANDLE). Tests: `m4-fx-island`. The old `particles(name, mode, pos, owner)` abstraction and src/fx/particles/island.ts are gone.
Not exact: where the original passes a dead stack slot as the matrix (none found in the island) ; emitters of nodes created after the first tick miss the FUN_0044e8d0 [SPLASH] extras.

## 7. Verification

`node tools/test-formats.mjs --only particles-oracle` (~30 s; `PARTICLES_FULL=1` runs every effect x scenario, several minutes):

* **Exact numbers** from the original (seed 7, dt 1, matrix [3 2 -5]): particle counts, RNG index and the first particle's position / size / life of five effects (bit patterns).
* **Loaders**: every `.app / .emi / .mov / .par` record byte for byte against the original loader (`FUN_0044fe30` ...), the maximum particle counts and the [EMITS] blocks (all 24 archives: 595 checks, run once with the scratch script; the test covers three).
* **Simulation oracle** (`tools/lib/particle-oracle.mjs` + `particle-emu.mjs`): the original engine code (0x44e860-0x458b00, the text reader, the C runtime) runs in `src/formats/x86emu.ts`; per frame the whole draw list (every particle record byte for byte), the emitter blocks, the matrices /
  velocities / flags of every source and the RNG index are compared. Scenarios: stationary, moving parent matrix, dt 0.5..1.3, gate switching, parameter overrides, stop, floor collision, PCOL collision, pause, distance LOD, swirls (incl. `setMatrix`, pause). Result: 99 effects x 11 scenarios in all 24 archives and the 4 swirls: **0 differences**
  (only the two splash01 + floor cases fault, in the original and in the port, as the original does).
* **Draw functions** (`tools/lib/particle-draw-oracle.mjs`): quad build, clip, sort and the spin step against `FUN_0044f4c0` / `FUN_008885e0` / `FUN_00887ae5`: 20,164 checks, 0 differences.
* Screenshots (headless, muted): `tools/steps/particles-island.mjs` (explode01, twinkle01, trainsmoke01 on the island), `particles-zones.mjs` (z17WAS torches, z05WAB bolts).

## 8. Not exact / open

* `ComputeSphereVisibility` and `ProcessVertices` are Direct3D internals (not in the executable): re-implemented (plane layout, inclusivity at the boundary inferred; the flag rule `(flags & 0xf) == flags` is the executable's). A sprite exactly on a frustum boundary may differ.
* The GL draw is not a bit-exact rasteriser (z precision, interpolation of the 8-bit diffuse in the shader); geometry, colours, sorting, clipping are exact.
* FPU precision is assumed 53 bit (the executable's control word was not checked per call site).
* An immortal sub-particle (`[EMITS]` with `fLifespan < 0`) loops forever in the original; the port throws. No shipped effect has it.
* `DAT_05d478f8` (sprite mirror modes), `DAT_05d3b0d4` (matrix override) and model particles are never active in the shipped data; model particles throw.
