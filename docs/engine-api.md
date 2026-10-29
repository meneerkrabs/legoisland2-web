# Engine API (for module authors)

How the TypeScript modules fit together. The game files are never part of the repo: they come out of the CD's
InstallShield cabinet (own ISO, CD folder, dev copy, or archive.org).

## Files

| file | what |
|---|---|
| `src/engine/inflate.ts` | `inflateRaw(src, sp, se, dst, dp)`: synchronous raw-DEFLATE decoder into a preallocated buffer; returns the new write position |
| `src/engine/installshield.ts` | `InstallShieldCab`: reader for InstallShield cabinets (data1.hdr + data1.cab, data2.cab, ...) |
| `src/engine/bytesource.ts` | `ByteSource` (random access over bytes that may still be arriving), `GrowingSource`, `LoadState`, `blobSource`, `sliceSource` |
| `src/engine/rangesource.ts` | `HttpRangeSource` (HTTP Range via the CORS proxy), `CachedSource` (256 KB block cache in Cache Storage) |
| `src/engine/vfs.ts` | `IsoVfs`: read-only ISO9660 (Joliet preferred) over a `Blob`, lazy slices |
| `src/engine/mpeg.ts` | `PsDemuxer` (MPEG-1/2 program stream), `MpegPlayer` (decoders + WebGL canvas + Web Audio) |
| `src/engine/movie.ts` | `playMovie(host, media, name)`: a movie full screen, skippable by click/key |
| `src/engine/audio.ts`, `skip.ts` | Web Audio context (`audio.ctx`, `audio.master`, `audio.unlock()`), "Sla over" (`onSkip`, `skipMedia`) |
| `src/vendor/jsmpeg/` | vendored JSMpeg decoders (MIT, with our B-frame / MP2 fixes; see the header of `jsmpeg.js`) |
| `src/files.ts` | `GameFiles` interface, `FileSet`, movie table, helpers to find the cabinet on a CD |
| `src/library.ts` | where the files come from: `availableSource()`, `isoFiles`, `cdFolder`, `addIso`, archive.org download + OPFS |
| `src/main.ts` | start screen (Dutch: Spelen, Beeld / Introfilms overslaan / Debugmenu, Mods, own ISO), intro movies, placeholder page with the file list; `play()` wraps the files with the enabled mods |
| `src/display.ts` | start-up preferences of the port (localStorage `le2-display`): `mode` 4:3 / wide ("Beeld"), `skipIntro`, `debugMenu`; URL `?wide= ?intro=0 ?debug=1`; `canvasBox()`; docs/re/widescreen.md |
| `src/mods/` | mod import and override layer: `zip.ts` (streaming zip / zip64 reader), `package.ts` (LI2 Mod Manager package format), `store.ts` (OPFS store), `manage.ts` (streamed import), `overlay.ts` (`ModLayer`, `ModdedFiles`, `withMods`), `patch.ts` + `effects.ts` (EXE patches and which can have an effect), `ui.ts` (start-screen section); docs/re/mods.md |
| `vite.config.ts` | dev-only plugin: `/__le2/manifest.json` lists `public/data/le2` and `public/data/le2-movies` |
| `src/render/` | the shared WebGL2 renderer reproducing the game's Direct3D 7 look: `renderer.ts` (`Renderer`), `states.ts` (state presets), `lighting.ts`, `camera.ts`, `environment.ts` (sky / sea), `math.ts`; see "Rendering" below |
| `src/formats/zoneparams.ts` | `extractRenderParams(pe, builderAt)`: per-zone fog / draw-distance setup and sea level read from the executable |
| `src/viewer/` | the zone viewer (`?viewer=1`), the first user of `src/render/` |

## `GameFiles` (`src/files.ts`)

```ts
interface GameFiles {
  source: 'iso' | 'cd' | 'dev' | 'archive';
  list(): string[];                // installed-layout paths, original case: "_data/z02LGI.bob", "LEGO eiland 2.exe"
  has(path): boolean;
  size(path): number;              // -1 when missing
  read(path): Promise<Uint8Array>; // whole file; throws when missing
  totalSize(): number;
  movie(name): Promise<MediaFile | null>; // "SdLogo" | "LegoSoftware" | "IntroFmv" | "outroFmv"; any case, ".mpg" optional
}
interface MediaFile { size: number; stream(): ReadableStream<Uint8Array> }
```

- With mods enabled `files` is a `ModdedFiles` (src/mods/overlay.ts): loose files of the mods win over the same path, `GameData.archive()` puts a mod's `_data/<archive>/...` files into the `Archive` (`Archive.override`) and `read('LEGO eiland 2.exe')` returns the patched bytes (docs/re/mods.md).
- Paths are looked up case-insensitively and may use `\` or `/` (the EXE asks for `_data\Bricks.bob`, `_Data\sounds\...`).
- The listing is the cabinet's `Game` group (3029 files, 659 MB): `LEGO eiland 2.exe`, `mss32.dll`, `LeesMij.txt`, `redist/win32/*.flt`, `_data/...`.
- `read` of a compressed file decompresses on demand (about 55 MB/s in node); the biggest file is `_data/z02LGI.bob` (44 MB).
- `movie()` streams: from the ISO/CD folder via `Blob.stream()`, from archive.org per file with `fetch` (no byte ranges there, so a movie is fetched whole, lazily on the first read).
- `INTRO_MOVIES` (`SdLogo`, `LegoSoftware`, `IntroFmv`) is the original intro order; `MOVIES` has the exact file names and sizes.

## Getting a `GameFiles` (`src/library.ts`)

```ts
const lib = await availableSource();     // { source, cached, proxy, open(onProgress?) }
const files = await lib.open((done, total, label) => ...);
```

`availableSource()` picks, in order: an ISO stored in OPFS, the dev copy (dev server only, not with `?source=archive`), archive.org. Also: `isoFiles(blob)`, `cdFolder(...)`, `addIso(file, onFraction)`, `removeIso()`, `removeArchiveCache()`.

## Loading: waiting for data (`GameFiles.loaded / ready / loading`)

The first start from archive.org no longer needs the whole 342 MB `data2.cab` first. `GameFiles` is returned as soon as the cabinet header is
in; the data arrives later, and `read()` of a file waits until its bytes are there. New members of `GameFiles` (all compatible: everywhere
except archive.org-in-progress they are trivially "already loaded"):

```ts
files.loaded(path): boolean                    // true: read(path) will not wait
await files.ready(paths: Iterable<string>)     // resolves when all those files are local (fetches them first on the range route)
files.loading: LoadState | null                // null = everything local; else { done, total, fraction, complete, error, subscribe(fn) }
files.route                                    // 'range' | 'progressive' | 'stored' | undefined (dev / own ISO / cd folder)
```

What the shell should do before starting a zone (`src/shell`): collect the files the zone needs, and
`if (!paths.every((p) => files.loaded(p))) { show the loading card; await files.ready(paths); }` - the card can show
`files.loading.fraction` (subscribe for updates) or "nog X% te laden". `ready()` never throws for unknown paths; it rejects when the
download failed (then `files.loading.error` is set too). Do not call `ready()` with hundreds of paths one by one: pass them in one call, it
merges neighbouring files in the cabinet into few requests. `main.ts` already shows a small corner badge ("Spelbestanden laden: nog X%")
while `files.loading` is not complete.

Where things are in `data2.cab` (compressed, by cabinet order): EXE 0%, Bricks/BrickMorph/Fonts/GENERICBITS/menu/messages/Overlays 1-2.2%,
z02LGI.bob (island) 2.8-6.7%, other zones 6.7-39% (z60FRE.bob, the front end, at 39%), then sounds (speech 35 MB, DirectMusic 86 MB) late.
On the progressive route a file at 39% is there after ~39% of the download; on the range route `ready()` fetches exactly it.

Two routes (`src/library.ts`, `availableSource().open()`), tried in this order for archive.org:

1. **Range route** (default; `PROXY_BASE` in `src/library.ts`, override `?proxy=<url or template>`, `?proxy=off`, localStorage `le2-proxy`):
   the ISO is read by HTTP Range through a CORS proxy (nginx relay or `tools/proxy/le2-cors-proxy.php`, see `tools/proxy/README.md`).
   `IsoVfs` (Joliet) -> `data1.hdr`/`data1.cab`/`data2.cab` extents -> `InstallShieldCab` over `sliceSource`s; a file is one contiguous
   compressed range. Blocks of 256 KB are cached in Cache Storage (`le2-range-<item>`), nothing is fetched twice; requests are 6 MB, up to 6 parallel.
   After the cabinet header it prefetches `WARM_PATHS` (EXE, shared archives, front end, island). Movies stream by range with their own request queue.
2. **Progressive route** (fallback, and `?proxy=off`): `data1.hdr` + `data1.cab` (0.8 MB), then `data2.cab` as one sequential download into a
   `GrowingSource` (chunks folded into a Blob every 8 MB; also written to OPFS `le2-archive/`, marker `complete.json`; a broken connection restarts
   and skips what we already have, 3 times). The tab can start while it runs. A reload mid-download starts over (no ranges on archive.org).

Stored/own sources: ISO in OPFS (`isos/le2.iso`), CD folder, dev copy: always `loading === null`.

## Byte sources (`src/engine/bytesource.ts`, `rangesource.ts`)

```ts
interface ByteSource { size; read(start, end): Promise<Uint8Array>; has?(start, end): boolean; prefetch?(start, end): Promise<void>; preferredChunk? }
blobSource(blob), sliceSource(src, offset, length), toSource(blobOrSource)
new GrowingSource(size, onData?)   // append(chunk) in order; read() waits for its range; finish(file); fail(err)
new HttpRangeSource(url, size) + HttpRangeSource.probe(url)   // Range requests (needs 206 + Content-Range)
new CachedSource(inner, cacheName)                           // block cache (Cache Storage) with .loading
new LoadState()                                              // done/total + subscribe
```
`IsoVfs.open(blobOrSource)` has `source(path): ByteSource` (and `file(path)` for Blob-backed ISOs); `InstallShieldCab.open(header, volumes)` takes
Blobs or ByteSources and has `extent(entry)`, `loaded(entry)`, `ready(entry)`.

Debug: `?trace=1` logs every `files.read()` into `window.__le2Trace` (`tools/steps/trace.mjs`); `tools/steps/measure.mjs` measures bytes and time to the
front end / island from a fresh profile (`MEASURE=frontend|island`, `TWICE=1`, `WAITFULL=1`); `node tools/test-bytesource.mjs` tests the loading layer in node.

## `InstallShieldCab` (`src/engine/installshield.ts`)

```ts
const cab = await InstallShieldCab.open(hdrBlob, [data1Cab, data2Cab]);   // hdr = data1.hdr (or data1.cab without .hdr)
cab.entries            // CabEntry[]: { index, group, dir, name, path, size, compressedSize, md5, flags, volume }
cab.groups             // file group names ("Game", "<Engine>Engine Files", ...)
cab.files('Game')      // the entries of one group; path = install path below the group ("_data/sounds/x.wav")
cab.find('Game', '_DATA\\bricks.BOB')   // case-insensitive
await cab.read(entry)  // Uint8Array
for await (const piece of cab.chunks(entry)) ...   // decompressed 32 KB pieces, for streaming big files
```

Supports versions 5 and 6..16 (this CD is version 6), compressed (chunked raw deflate), obfuscated, linked and volume-split files.
Volume splitting and version 5 follow unshield's code but have not been exercised (this CD has no split files); UTF-16 (version 17+) is refused.
`tools/test-installshield.mjs` extracts all 3040 files and compares byte for byte with unshield's tree (and the MD5 from the file table).

## Movies (`src/engine/mpeg.ts`, `movie.ts`)

All four movies: MPEG-1 system stream, 640x480, 25 fps, video with B-pictures (`I B B B P ...`), MP2 44.1 kHz joint stereo 112 kbit/s.

```ts
const player = new MpegPlayer(canvas, audio.ctx, audio.master);
const stats = await player.play(media.stream());   // resolves 'ended' | 'stopped'; player.stop() ends it early
await playMovie(host, media, 'SdLogo');            // canvas + hint + click/key skip (also skipMedia())
```

- `PsDemuxer.write(chunk)` takes arbitrary chunks (packets may be split); PES packets without PTS are merged into the previous run.
- Video frames are decoded when the audio clock (`ctx.currentTime` minus output latency) says they are due; one frame of look-ahead because the
  decoder shows pictures in display order. Audio frames (26 ms) are scheduled as `AudioBufferSource`s 0.4 s ahead.
- Prebuffer 2.5 s of media; when the stream runs dry the timeline is re-anchored (`stalls` in the statistics) instead of drifting.
- Without a running `AudioContext` the movie plays silently on the wall clock.
- WebGL (YCbCr to RGB in a shader) with a 2D-canvas fallback.
- `tools/test-mpeg.mjs` decodes a movie with the demuxer and decoders in node and compares with ffmpeg (luma PSNR >= 44 dB on all four movies, same frame and sample counts).

## Rendering (`src/render/`)

Reproduces the render pipeline of the original executable (docs/re/rendering.md). The renderer is independent of the viewer: a caller supplies meshes, textures, a camera and the zone's environment, and calls `drawMesh` per object **in record order**.
Game conventions: left-handed, +Y up, row-vector matrices (`Mat4` = row-major `Float32Array(16)`, `v' = v * M`), clockwise front faces, textures uploaded as stored (bottom-up rows, V unchanged).

```ts
import { Renderer, cameraFromFog, projection, lightSetFromLgt, SkyState, SeaState, selectLod, modePreset, SKY_MODE, SEA_MODE } from '../render/index.ts';
import { lookDirLH, mul } from '../render/math.ts';
import { extractRenderParams } from '../formats/zoneparams.ts';
import { parseLgt } from '../formats/lights.ts';

const r = new Renderer(canvas);                        // WebGL2 context, programs, caches
const zp = extractRenderParams(pe, scene.builderAt);   // { fog: FogSetup[], seaLevel: number | null } from the exe (FUN_00442d90 calls + DAT_009da858 store)
const cam = cameraFromFog(zp.fog[0], 50);              // CameraSetup { fov, near, far, fog{enabled,color,start,end}, clear } (slider 0..100, game default 50)
r.lights = lightSetFromLgt(parseLgt(archive.read(archive.find('lights/lights.lgt')!)));   // directional lights + ambient (docs 5)
r.fog = cam.fog; r.setMipmaps(false);                  // the game has no mip maps

// per frame
r.updateTextures(dt);                                  // .wib animations: one sequence entry per 1/30 s
sky.update(dt); sea.update(dt);
r.begin(cam.clear, mul(lookDirLH(eye, forward), projection(cam, canvas.width / canvas.height)));   // clears, sets camera, fog, lights
for (const o of records) {                              // record order = draw order (SEAB, SSEA, SEAE, SSKY, LAND, ...)
  const part = o.parts[selectLod(o.parts, distanceToRecordPosition, 1)];
  const world = o.kind === 'sky' ? sky.matrix(eye, cam.far, o.y) : o.kind === 'sea' ? sea.matrix(eye, cam.far, zp.seaLevel ?? 0) : o.matrix;
  r.drawMesh(meshGpu, world, (group) => r.texture(archive, part.texList[group]), { mode: o.mode });   // 3 group passes inside
}
```

| API | what |
|---|---|
| `new Renderer(canvas)` | creates the WebGL2 context and shader programs. Fields: `fog: FogState`, `lights: LightSet`, `eye` (camera position for the specular term), `cull` (0/1), `cwFront`, `mipmaps`, `stats` |
| `r.mesh(archive, member)` / `r.uploadMesh(msh)` | parse + upload a `.msh` (cached) / upload an already parsed (e.g. CPU-skinned) mesh; returns `MeshGpu` (`groups`, `min`, `max`, `center`, `radius`) |
| `r.texture(archive, id, dir = 'textures')` | `TextNNN.tga` or `.wib` as `TexGpu`; wrap / clamp per `text.txl`; animated `.wib` register themselves for `updateTextures` |
| `r.updateTextures(dt)` | steps animated textures (seconds in, 30 entries per second); expression sheets (16 frames, identity sequence) stay frozen |
| `r.setMipmaps(on)` | mip maps on / off for all textures (default off = the game's look) |
| `r.begin(clear, viewProj)` | `clear` = fog colour of the zone; resets depth, uploads lights and fog, sets culling |
| `r.drawMesh(mesh, world, texOf, opts)` | draws a mesh the way the game does: one state preset (from `opts.mode` or `opts.preset`), three group passes (flags 0, 1, rest), and the game's CPU vertex lighting into the mesh's own vertex-colour buffer (`world` = the matrix the lighting sees). `opts`: `mode` (0..7: 0 / 4 light the mesh once at its first draw, 1 at every draw, the others keep the colours), `lit` (`'once' | 'always' | 'never'` overrides), `skinned`, `preset` (0..29, never lights), `tint` (vertex colour / alpha of unlit presets), `flat` (colour of untextured groups), `highlight`, `pass` |
| `r.setShiny(mesh, on)`, `r.resetLighting()` | `FUN_00883013`: vertex format 0x2c2 (specular colour per vertex, added after the texture stage); a new zone lights every mesh afresh |
| `r.createBatch(nv, ni)`, `r.drawBatch(...)` | dynamic world-space triangle batches (the brick effects' 4096-vertex buffers, the view plane's polygon) |
| `prepareLights`, `lightStatic`, `lightSkinned`, `lightShiny` (`meshlight.ts`) | the original's lighting functions (`FUN_00885664` / `00885a9a` / `0088589e` / `0088612c` / `00885e33`), verified byte for byte on the emulator |
| `viewPlaneMesh` (`viewplane.ts`) | `FUN_0087f01e` |
| `r.drawBox(world, min, max, color)` | debug wire box |
| `PRESETS`, `modePreset(mode)` | the 30 Direct3D state blocks as data (`colorOp`, `alphaOp`, `blend`, `z`, `specular`) and the mode -> preset switch of `FUN_0088aca2` |
| `lightSetFromLgt(file)`, `lightVertex(set, n)` | runtime light set (ambient = max of all ambient colours, directional lights with Y forced to be >= 0 = towards the light) and the per-vertex formula `max(ambient, screen-combine(N.L * diffuse))` |
| `cameraFromFog(fogSetup, slider, fov)`, `projection(cam, aspect)` | far / fog from the zone's `SetupFog` constants and the draw-distance slider; D3D-style perspective (game: vertical FOV 1.0 rad, near 4) |
| `selectLod(parts, dist, zoom, force)` | LOD index: last part with `lod^2 < zoom * dist^2`, `dist` = camera to record position |
| `SkyState`, `SeaState` | per-frame matrices of the sky dome (`SSKY`, scale 1.2 * far x (camera y + 100)) and the sea plane (`SSEA`, 2.5 * range, snapped anchor + orbit, y = sea level); modes `SKY_MODE` 2, `SEA_MODE` 3, `SEABED_MODE` 3, `SEA_EDGE_MODE` 2 |
| `GAME_TICK` (30), `DEFAULT_FOV` (1.0 rad), `GAME_ASPECT_HW` (0.75) | constants of the game's time base and projection |

Second pass (WP-RENDER): `render/math.ts` `mulGame` / `transformPointGame` / `transformDirGame` = `FUN_0043a9e5` / `FUN_0043ab72` / `FUN_0043abe6` (float-exact: x87 in 24-bit mode, adds in x, y, z order); `render/states.ts` `GAME_Z_RANGE` / `d3dZRange` (viewport depth range [0, 0.001]); `render/viewplane.ts` `viewPlaneTexturedMesh` (the original's unused textured pass, `GameRenderer.viewPlaneTextured` / `viewPlaneTexture`, debug option: F8 or `?debug=1&viewplane[=n]`);
`game/controller.ts` `runDrawHooks(w, rec, hook?)` = the per-record dispatch of `FUN_0042271b` (called by `GameRenderer.render` for every record; `drawPass` uses it too); `Controller.probe` + `game/probehost.ts` (`armControllerProbe` = `FUN_00427014`, `runProbePass` = `FUN_00427233`, run by `World.tick` before the pre-render pass); `game/shadow.ts` `shadowGate` (what `FUN_00444940` returns to the draw pass); `game/fogphases.ts` `pickFogCall`.

GameRenderer (src/game/render.ts) adds the record-level pieces: `setPartMode(record, mask, mode)` = `FUN_00444550`, `setShiny(record)` = `FUN_004446c0`, `drawBlobShadow(...)` = `FUN_00444940` (src/game/shadow.ts), `setViewPlane`, the flowing-water scroll, the fog phases (src/game/fogphases.ts) and the probe pass module (src/game/probe.ts). Particles and the 2D layer: docs/re/rendering.md sections 8 and 11.

Viewer options (`?viewer=1`): `&zone=z02LGI`, `&mode=grid`, HUD checkboxes `game look` (game projection, fog, lighting; also `&game=0`), `draw distance` slider (`&slider=50`), `mip maps` (`&mips=1`), `force LOD0`, `winding`.
Headless screenshots: `VIEWS='name:x,y,z,yaw,pitch;...' TAG=prefix node tools/browse.mjs "http://localhost:5499/?viewer=1&zone=z02LGI" tools/steps/viewer.mjs --size 1280x800`
(`window.__viewer.setCamera(x, y, z, yaw, pitch)`, `.home()`, `.view(name)`). Parameter / maths tests: `node tools/test-formats.mjs --only render`.

## Audio (`src/audio/`)

Web Audio engine with the semantics of the game's sound layer, plus a re-implementation of the DirectMusic playback the game uses
(styles, chords, bands, DLS wavetable synth). Reverse-engineering notes and the evidence behind every rule: `docs/re/audio.md`
(sections 1-9: the game's API; section 10: DirectMusic file formats, composer rules, DLS synth, verification). Nothing in `src/audio` touches the DOM
except `test.ts`; the style player and the synth are pure TypeScript and also run in node (`tools/audio-*.mjs`).

| file | what |
|---|---|
| `index.ts` | `GameAudio.create(ctx, destination, files)`: reads the EXE tables, builds `sfx`, `speech`, `music`, `ambience`; `options` (music / sfx / speech sliders, 0..100, default 80); `resetZone()` |
| `tables.ts`, `files.ts` | `readAudioTables(exeBytes)` (sound / speech / music / ambience tables of the EXE); `AudioFiles` (`read(path)`; `GameFiles` fits), `normalizePath`, `readTolerant` |
| `sfx.ts` | `SoundEngine`: slots, 16 + 16 voices, 2D / 3D, pitch, listener |
| `speech.ts` | `SpeechEngine`: MP3-in-WAV lines; the original's request / state machine (`say(a, b)` = FUN_00435a11, `tick(dt)` = FUN_00435a5e once per frame, `idle` = FUN_00435ad3), subtitle hooks |
| `music.ts` | `MusicEngine`: `load(key)`, `warm()`, `play(handle)` (starts one DirectMusic prepare time, 1000 ms, later on the render clock; a running segment is cut exactly then), `stopAll()`, `setGroove(n)`, `pollNotification()` (FUN_00443370), volume (the game's dB formula), `log` |
| `ambience.ts`, `midi.ts` | `AmbienceEngine` + `parseSmf` / `MidiRenderer`: the six looping MIDI beds through the DLS synth |
| `stream.ts` | `SynthStream`: renders a synth block by block ahead of time and schedules `AudioBuffer`s at exact context times (no AudioWorklet; 0.3 s ahead; `lead` = how far the render head is ahead of the audible output) |
| `zonesounds.ts`, `zonemusic.ts`, `listener.ts`, `sea.ts` | the original's per-zone sound lists (generated by `tools/gen/gen-zonesounds.py`), per-zone music keys and Play moments, the zones' 3D listener rule, the island's shore-clamped sea sound |
| `footsteps.ts` | `walkSounds(surface)`, `landSound(surface)`, `SND_UI` ids (menu sounds) |
| `dm/dls.ts` | DLS level 1/2 parser (instruments, regions, articulation connections, wave pool, loops) |
| `dm/format.ts` | `.sgt` segment, `.sty` style, band parsers (all tracks / chunks the game's files use) |
| `dm/sequencer.ts` | `DmPerformance`: tempo map, primary / secondary segments, pattern + variation + chord composer, `musicValueToKey` |
| `dm/synth.ts` | `DlsSynth`: wavetable synth (regions, loops, EG1, pan, bend, volume / expression / sustain, key groups, voice stealing) |
| `dm/player.ts`, `dm/assets.ts`, `dm/instruments.ts` | `MusicRenderer` (performance + synth -> stereo float blocks, soft limiter), `loadSegment(read, dir, sgt, dls)`, band entry -> DLS instrument |
| `test.html`, `test.ts` | test page (dev server: `/src/audio/test.html`) and `window.__audio` hook |

### Using it

```ts
import { audio } from './engine/audio.ts';              // existing AudioContext + master gain
import { GameAudio } from './audio/index.ts';
const ga = await GameAudio.create(audio.ctx, audio.master, files);   // files: GameFiles; reads "LEGO eiland 2.exe" for the tables

// sound effects: load once per zone, play every frame for loops (like the game)
const select = await ga.sfx.load2D('SND_MENU_SELECT');   // id or SND_/CSSND_ name; max 200 slots per kind
ga.sfx.play2D(select);                                     // dropped when 16 voices are busy; no restart while playing
const sea = await ga.sfx.load3D('SND_LGI_SEA');
ga.sfx.setListener(camPos, camFront, camUp);               // game coordinates (left-handed); Z is flipped for Web Audio
ga.sfx.play3D(sea, emitterPos);                            // plays inside the table's max distance, stops (voice freed) outside
ga.sfx.setRate(engineSlot, 11000);                         // pitch in Hz (the game's FUN_00443600), 2D only
ga.sfx.stop(slot); ga.sfx.reset();                         // reset = zone change

// speech (speech table index = the number of the .str line)
ga.speech.say(105);  ga.speech.sayId('LECSPP02', 'LECSPP03');   // ignored while busy; B starts when A ended
ga.speech.idle;      ga.speech.stop();  ga.speech.onLineStart = (i, id) => showSubtitle(i);

// music: hard cut, groove level = activity - 3 (-2..0), reset to 0 by load()
const m = await ga.music.load('Z02LGIM');  ga.music.setGroove(-2);  ga.music.play(m);   // load() -> null for a missing file (Z02LGIB): play(null) is a no-op
ga.music.stopAll();                          // stop + unload;  ga.music.setFade(0.5), ga.music.setMute(true), ga.setMusicVolume(80)

await ga.ambience.start('LGIBirds');  ga.ambience.stop();       // MIDI beds, level follows the SFX slider
```

Offline use (node, tests, pre-rendering): `new MusicRenderer(sampleRate)`; `r.play(await loadSegment(read, 'menu', 'Menu.sgt', 'Menu.dls'))`; `r.perf.grooveLevel = -2`; `r.render(L, R, n)` in a loop.
Everything is deterministic for a given `seed` (pattern and variation choices).

### Limits and semantics (from the EXE, see docs/re/audio.md)

* 16 2D + 16 3D voices, 200 + 200 slots, no stealing, one voice per slot, re-triggering a playing one-shot only refreshes its volume.
* Sample gain `floor(tableVol * sfxSlider / 100) / 127`, pan `(table.pan - 64) / 64`, rate `table.rate / fileRate`, loop count 1 / 0 (forever) / n.
* 3D: inverse-distance law, ref distance = table min, game-side cull at table max; listener = camera. No doppler / cones / EAX.
* Speech: one request at a time (A, then optionally B), started by the per-frame `tick` (the first request of a session after 6 frames), centre, gain `speechSlider / 100`, no ducking; MP3 frames are cut out of the RIFF wrapper before `decodeAudioData`.
* Music: DirectMusic master volume `dB = 0.22 * opt0 * fade - 22`; 99 synth voices; reverb off (the game switches it off); the music table's `.dls` replaces every band reference.
* DirectMusic playback is a re-implementation, not a decoder: see the fidelity notes in docs/re/audio.md section 10.8; the start time and cut semantics, notifications and the per-zone Play moments are in section 11.

### The shell's audio host (`src/shell/audiohost.ts`)
`sh.audio` (`AudioHost`) sits between the zones and `GameAudio`: `enterZone(zone)` (awaited by the zone runner) loads the zone's sound list and music key(s) like the original's zone start, `leaveZone()` resets, `play(id)` / `playAt(id, pos)` / `stop(id)` / `rate(id, hz)` act on the zone's slots by sound id (a sound the list does not hold is loaded on demand and plays when ready: nothing is dropped), `modeChange(prev, mode)` starts the music at the original's moment (leaving the intro / the help), `frame(camera, dt)` (3D listener + speech tick, once per loop frame), `playMusic(key, groove?)`, `preloadMusic(keys)`, `loadExtra(loads)`, `slot(kind, id, n)` / `slots(kind, id)` for zones that hold slots themselves. Debug: `window.__shell.audio.log`, `.missed`, `.ga.music.log`.

### Tests and tools

* `node tools/audio-test.mjs`: 1845 checks without a browser (every `.sty` / `.sgt` / `.dls` / `.mid` parses, every music key plays 30 s with sane levels, music values, comparison with the
  MIDI export in `DirectMusic/dance`, timing / groove / loop / replacement, synth pitch at 44.1 and 48 kHz, ambience, table cross-checks).
* `node tools/audio-dm-stats.mjs [key ...]`: note counts, key ranges, channels per music key.
* `node tools/audio-render-music.mjs <key> [--seconds 30] [--groove -2]`: renders to `/tmp/le2-music/<key>.wav` and prints peak / RMS / voice use / notes outside DLS regions (nobody listens: numbers only).
* `node tools/audio-render-ambience.mjs`: the MIDI beds.
* Browser smoke test (headless, muted): `npx vite --port 5611 --strictPort`, then `node tools/browse.mjs "http://localhost:5611/src/audio/test.html?auto=1&mute=1" tools/steps/audio-test.mjs`
  (decodes all 902 sounds, plays speech lines, ambience and four music keys through Web Audio and prints the stream statistics). By hand: open `/src/audio/test.html` and press Start.

## Dev / test URLs

Shell (M2, the real flow: movies -> front end -> story -> zones; `src/shell/`):

| URL | what |
|---|---|
| `/` | start screen, "Spelen" starts the shell |
| `?play=1` | the shell at once (movies, front end); `&intro=0` skips the movies |
| `?start=frontend` | straight to the front end (no movies) |
| `?zone=z05WAB[&node=N]` | start in that zone (story node jumped to the zone's first node, or `node=N`); no movies |
| `?save=N` | continue from save slot N (0..6) of this browser (IndexedDB), no movies |
| `&mute=1` | no sound |
| `?play=1&zone=z02LGI` | unchanged M1 dev entry (`src/game/play.ts`, no shell) |

Debug handles: `window.__shell` (the `Shell`: `vars`, `story`, `options`, `slots`, `menu`, `live`, `importSlot`, `exportSlot`), `window.__zone` (running zone: `info`, `loaded`
(incl. `loaded.setup`, `loaded.skipped`), `world`, `machine` (loop mode / exit), `gr`, `hud`), `window.__fe` (front end mode / page).
Stub aids in zones without ported gameplay (only with `?debug=1` / the "Debugmenu" option: default play has no F9 / F10 aids, F10 is the original's screenshot key, docs/re/input.md): F9 completes the story step the zone waits for (mini-game: success; room: back to the previous zone), F10 fails a mini-game.
Save slots: on the load / save / erase page press E (export the highlighted slot as `SaveNN.lgo`) or I (import a `.lgo`).
Headless tests: `tools/steps/shell-{flow,menu,story,zones,minigame,house}.mjs` (header of each file has the command), `node tools/test-formats.mjs --only shell-menu,shell-ui,shell-save,shell-story,shell-tables,zonesetup,ui-layout,ui-strings`.

Older / other URLs:

`?play=1` (start at once; click once for sound), `&intro=0` (skip the intro), `&movie=SdLogo` (only that movie), `&mute=1` (silent),
`&source=archive` (archive.org even when the dev copy exists), `&throttle=150000` (hand movies out at that many bytes/s: exercises the stall handling). Headless: `node tools/browse.mjs "<url>" tools/steps/<steps>.mjs`.
`window.__le2Movies` holds the statistics of the movies played.

## Game engine (`src/game/`): browser side

The engine core (records, controllers / behaviour nodes, game variables, collision, animation player, input mapper, Pepper's walk / swim, chase camera, `World` / `GameLoop`, zone set-up) is documented in docs/re/engine-m1.md (modules, ported functions, constants, findings, tests); these are the browser-side parts.

* `src/game/render.ts`: `GameRenderer(renderer, data, archive, scene, loaded, fog, lights, shadowArchive).render(alpha, dt)` draws one frame of a `Loaded` zone. Chase camera interpolated between `camera.prev` and `camera.c`
  (`viewEye` is the plain eye: the original's wall push is compiled out), game projection from the zone's fog setup (draw-distance slider `gr.slider`, default 50), records in record order with interpolated matrices
  (`prev` -> `m`), LOD, sky / sea special records as in the viewer. Records with `anim` within 150 units are CPU-skinned every frame from `anim.pose(alpha)` into a per-record dynamic mesh (`Renderer.updateMeshVertices`);
  others show the bind pose (MFIG clip 2 frame 0). Attachments use `mul(bone, world)`. Pepper gets the type 4 blob shadow (`Shadow.msh`, four `world.col.sweep` rays down, lifted 0.08).
  `gr.info` = last eye / target / camera distance / draw counts. `Renderer.texture(archive, id, '')` reads textures at the archive root (the Shadow archive).
* `src/game/play.ts`: `startPlay(root, files, params)` loads the zone, calls `setupZone`, reads var names and the key table from the EXE, attaches the input and runs the `GameLoop`. HUD (top left, H toggles): fps, zone, Pepper position,
  state (hex), clip / frame, speed, camera distance, key help. Sound: `GameAudio` unless muted; `world.sfx.play(id)` lazily loads each id (the first play of an id is dropped), footstep / land ids and a few UI ids are preloaded,
  island music `Z02LGIM` and ambience `LGIBirds` are started (all failures ignored).
* Entry: `/?play=1&zone=z02LGI|z03PPH` (also the two "Rondlopen ... (test)" buttons on the placeholder page). Params: `zone`, `pos=x,y,z` (Pepper start), `from=z03PPH` (island: arrive at the house door instead of the skate park), `era=N` (stored in `__game.era`, unused), `mute=1` (no audio).
* Debug handle `window.__game`: `{ ready, world, loaded, loop, renderer (GameRenderer), gl (Renderer), setPepper(x, y, z, yaw?), state(), era, zone, sfx }`; `state()` returns `{ tick, pos, yaw, walkState, clip, frame, speed, mode, cam: [eye, target], fps, lastSurface }`.
  Headless: `node tools/browse.mjs "http://localhost:5611/?play=1&zone=z02LGI&mute=1" steps.mjs --size 1280x800` (wait for `__game.ready`, hold keys with `page.keyboard.down('ArrowUp')`).


## Shell (`src/shell/`, M2)

Details, ported addresses and approximations: docs/re/engine-m2.md (+ shell-m2.md, ui-m2.md, zone-setup.md).

| file | what |
|---|---|
| `shell.ts` | `Shell`: canvas (4:3, WebGL2: `Renderer` + `Ui2D`), game vars, `StoryFsm`, `ZoneLoopState` (FUN_00404dc9), options, save slots, audio, input, `run()` zone loop, `runLoop()` fixed 30 Hz; `registerZoneRunner(id, fn)` replaces the stub of a zone (M3+) |
| `frontend.ts`, `fenodes.ts`, `credits.ts` | z60FRE stage, menu, credits |
| `playzone.ts`, `loopmachine.ts`, `hud.ts` | stub zone runner, loop template (`LoopConfig`, modes 7/0/1/9/2/3/4/5/8), HUD |
| `menu.ts`, `menudraw.ts`, `menuui.ts` | menu engine + drawing + event handler (FUN_0041fd45 / 0041d765 / 0041b500) on the page table of the EXE |
| `tables.ts`, `story.ts`, `save.ts`, `savestore.ts`, `options.ts` | EXE tables, story FSM, `.lgo` format, IndexedDB store, `Settings.set` |
| `audiohost.ts`, `dik.ts` | audio per zone / menu sounds, DirectInput key codes |

A ported zone: `registerZoneRunner('z05WAB', async (shell, info) => ...)` returning the next zone index (-1 front end, -2 quit), or reuse `LoopMachine` + `nextAfterExit`;
behaviours attach by constructor address with `registerCtor(address, factory)` (src/game/setup.ts, `Loaded.setup.attaches`).


## The island (`src/island/`, `src/zones/z02LGI/`, M4)

Design, modules, ported functions, findings, approximations: docs/re/engine-m4.md (+ docs/re/m4/*.md; the set-up emulation: docs/re/m4/emu.md).

```ts
// the island's set-up, run out of the executable for the live game variables (era = var 0x58); the result also feeds setupZone
const profile = profileFor('z02LGI', pe, scene, starts, { islandVars: vars, archive });   // profile.island: IslandSetup (attaches with argument blocks, dictionaries, ...)
import '../island/index.ts';                       // registers every behaviour constructor (registerCtor by address)
const ictx = ctxOf(world);                         // IslandCtx: cutscene start / active, say, text tables of the story handler, sfx, dictionaries, objective, music ...
```

| URL | what |
|---|---|
| `?zone=z02LGI&node=N&mute=1` | the island at story node N (era from N: nodes < 7 era 0 = zone id 2, < 0x1e id 31, < 0x34 id 32, < 0x3d id 33, else id 2); mode 1 waits for a button like the original |
| `?start=frontend&mute=1` | front end -> Starten -> Nieuw spel -> chapter 1 |

Debug: `window.__zone.game.debug()` (node, era, texts, objective, cutscene, attaches), `window.__zone.game.ictx`, `window.__zone.world`; bots: `tools/steps/m4-*.mjs`, helpers `tools/steps/lib-island.mjs`
(`island(h)`: `start`, `skipCutscenes`, `teleportNear`, `tap` / `hold` in game ticks, `collectHead`), node tests `tools/lib/island-load.mjs` (`loadIsland(ctx, { node })`, `tick`, `press`, `hold`),
snapshot server `sh tools/m4-snapshot-server.sh 5497` (no HMR, for long runs), `THROTTLE=4` (CPU throttle for `tools/browse.mjs`), `&hold=1` / `NOPRESS=1` (do not tap the island's start key).
