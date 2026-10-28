# Engine API (for module authors)

How the TypeScript modules fit together. The game files are never part of the repo: they come out of the CD's
InstallShield cabinet (own ISO, CD folder, dev copy, or archive.org).

## Files

| file | what |
|---|---|
| `src/engine/inflate.ts` | `inflateRaw(src, sp, se, dst, dp)`: synchronous raw-DEFLATE decoder into a preallocated buffer; returns the new write position |
| `src/engine/installshield.ts` | `InstallShieldCab`: reader for InstallShield cabinets (data1.hdr + data1.cab, data2.cab, ...) |
| `src/engine/vfs.ts` | `IsoVfs`: read-only ISO9660 (Joliet preferred) over a `Blob`, lazy slices |
| `src/engine/mpeg.ts` | `PsDemuxer` (MPEG-1/2 program stream), `MpegPlayer` (decoders + WebGL canvas + Web Audio) |
| `src/engine/movie.ts` | `playMovie(host, media, name)`: a movie full screen, skippable by click/key |
| `src/engine/audio.ts`, `skip.ts` | Web Audio context (`audio.ctx`, `audio.master`, `audio.unlock()`), "Sla over" (`onSkip`, `skipMedia`) |
| `src/vendor/jsmpeg/` | vendored JSMpeg decoders (MIT, with our B-frame / MP2 fixes; see the header of `jsmpeg.js`) |
| `src/files.ts` | `GameFiles` interface, `FileSet`, movie table, helpers to find the cabinet on a CD |
| `src/library.ts` | where the files come from: `availableSource()`, `isoFiles`, `cdFolder`, `addIso`, archive.org download + OPFS |
| `src/main.ts` | start screen (Dutch), intro movies, placeholder page with the file list |
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

- Paths are looked up case-insensitively and may use `\` or `/` (the EXE asks for `_data\Bricks.bob`, `_Data\sounds\...`).
- The listing is the cabinet's `Game` group (3029 files, 659 MB): `LEGO eiland 2.exe`, `mss32.dll`, `LeesMij.txt`, `redist/win32/*.flt`, `_data/...`.
- `read` of a compressed file decompresses on demand (about 55 MB/s in node); the biggest file is `_data/z02LGI.bob` (44 MB).
- `movie()` streams: from the ISO/CD folder via `Blob.stream()`, from archive.org per file with `fetch` (no byte ranges there, so a movie is fetched whole, lazily on the first read).
- `INTRO_MOVIES` (`SdLogo`, `LegoSoftware`, `IntroFmv`) is the original intro order; `MOVIES` has the exact file names and sizes.

## Getting a `GameFiles` (`src/library.ts`)

```ts
const lib = await availableSource();     // { source, cached, open(onProgress?) }
const files = await lib.open((done, total, label) => ...);
```

`availableSource()` picks, in order: an ISO stored in OPFS (`isos/le2.iso`), the dev copy (dev server only, not with `?source=archive`), archive.org.
Also: `isoFiles(blob)`, `cdFolder([[relativePath, blob], ...])`, `addIso(file, onFraction)`, `removeIso()`, `removeArchiveCache()`.

archive.org: the three cabinet files (316 414 + 444 906 + 341 851 148 bytes) are downloaded through
`https://archive.org/download/<item>/<iso>/LEGO%20Eiland%202%2F<file>` (CORS, redirects to `view_archive.php`, no byte ranges, no
`content-length`, so the sizes are constants in `files.ts`) into OPFS (`le2-archive/`, marker `complete.json`), streamed in 4 MB writes with a progress callback.
Without OPFS the blobs stay in memory for the session. Items tried in order: `legoeiland2dutch`, then `legoeiland2`.

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
| `new Renderer(canvas)` | creates the WebGL2 context and shader programs. Fields: `fog: FogState`, `lights: LightSet`, `cull` (0/1), `cwFront`, `mipmaps`, `stats` |
| `r.mesh(archive, member)` / `r.uploadMesh(msh)` | parse + upload a `.msh` (cached) / upload an already parsed (e.g. CPU-skinned) mesh; returns `MeshGpu` (`groups`, `min`, `max`, `center`, `radius`) |
| `r.texture(archive, id, dir = 'textures')` | `TextNNN.tga` or `.wib` as `TexGpu`; wrap / clamp per `text.txl`; animated `.wib` register themselves for `updateTextures` |
| `r.updateTextures(dt)` | steps animated textures (seconds in, 30 entries per second); expression sheets (16 frames, identity sequence) stay frozen |
| `r.setMipmaps(on)` | mip maps on / off for all textures (default off = the game's look) |
| `r.begin(clear, viewProj)` | `clear` = fog colour of the zone; resets depth, uploads lights and fog, sets culling |
| `r.drawMesh(mesh, world, texOf, opts)` | draws a mesh the way the game does: one state preset (from `opts.mode` or `opts.preset`), three group passes (flags 0, 1, rest). `opts`: `mode` (0..7), `preset` (0..29), `tint` (vertex colour / alpha of unlit presets), `flat` (colour of untextured groups), `highlight`, `pass` |
| `r.drawBox(world, min, max, color)` | debug wire box |
| `PRESETS`, `modePreset(mode)` | the 30 Direct3D state blocks as data (`colorOp`, `alphaOp`, `blend`, `z`, `specular`) and the mode -> preset switch of `FUN_0088aca2` |
| `lightSetFromLgt(file)`, `lightVertex(set, n)` | runtime light set (ambient = max of all ambient colours, directional lights with Y forced to be >= 0 = towards the light) and the per-vertex formula `max(ambient, screen-combine(N.L * diffuse))` |
| `cameraFromFog(fogSetup, slider, fov)`, `projection(cam, aspect)` | far / fog from the zone's `SetupFog` constants and the draw-distance slider; D3D-style perspective (game: vertical FOV 1.0 rad, near 4) |
| `selectLod(parts, dist, zoom, force)` | LOD index: last part with `lod^2 < zoom * dist^2`, `dist` = camera to record position |
| `SkyState`, `SeaState` | per-frame matrices of the sky dome (`SSKY`, scale 1.2 * far x (camera y + 100)) and the sea plane (`SSEA`, 2.5 * range, snapped anchor + orbit, y = sea level); modes `SKY_MODE` 2, `SEA_MODE` 3, `SEABED_MODE` 3, `SEA_EDGE_MODE` 2 |
| `GAME_TICK` (30), `DEFAULT_FOV` (1.0 rad), `GAME_ASPECT_HW` (0.75) | constants of the game's time base and projection |

What a particle / shadow / 2D module should do (not implemented yet) is specified in docs/re/rendering.md sections 8, 9 and 11.

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
| `speech.ts` | `SpeechEngine`: MP3-in-WAV lines, `say(a, b)`, subtitle hooks |
| `music.ts` | `MusicEngine`: `load(key)`, `play(handle)`, `stopAll()`, `setGroove(n)`, volume (the game's dB formula) |
| `ambience.ts`, `midi.ts` | `AmbienceEngine` + `parseSmf` / `MidiRenderer`: the six looping MIDI beds through the DLS synth |
| `stream.ts` | `SynthStream`: renders a synth block by block ahead of time and schedules `AudioBuffer`s (no AudioWorklet; 0.3 s ahead, 0.4 s worst-case music cut latency) |
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
* Speech: one line at a time, centre, gain `speechSlider / 100`, no ducking; MP3 frames are cut out of the RIFF wrapper before `decodeAudioData`.
* Music: DirectMusic master volume `dB = 0.22 * opt0 * fade - 22`; 99 synth voices; reverb off (the game switches it off); the music table's `.dls` replaces every band reference.
* DirectMusic playback is a re-implementation, not a decoder: see the fidelity notes in docs/re/audio.md section 10.8.

### Tests and tools

* `node tools/audio-test.mjs`: 1845 checks without a browser (every `.sty` / `.sgt` / `.dls` / `.mid` parses, every music key plays 30 s with sane levels, music values, comparison with the
  MIDI export in `DirectMusic/dance`, timing / groove / loop / replacement, synth pitch at 44.1 and 48 kHz, ambience, table cross-checks).
* `node tools/audio-dm-stats.mjs [key ...]`: note counts, key ranges, channels per music key.
* `node tools/audio-render-music.mjs <key> [--seconds 30] [--groove -2]`: renders to `/tmp/le2-music/<key>.wav` and prints peak / RMS / voice use / notes outside DLS regions (nobody listens: numbers only).
* `node tools/audio-render-ambience.mjs`: the MIDI beds.
* Browser smoke test (headless, muted): `npx vite --port 5611 --strictPort`, then `node tools/browse.mjs "http://localhost:5611/src/audio/test.html?auto=1&mute=1" tools/steps/audio-test.mjs`
  (decodes all 902 sounds, plays speech lines, ambience and four music keys through Web Audio and prints the stream statistics). By hand: open `/src/audio/test.html` and press Start.

## Dev / test URLs

`?play=1` (start at once; click once for sound), `&intro=0` (skip the intro), `&movie=SdLogo` (only that movie), `&mute=1` (silent),
`&source=archive` (archive.org even when the dev copy exists), `&throttle=150000` (hand movies out at that many bytes/s: exercises the stall handling). Headless: `node tools/browse.mjs "<url>" tools/steps/<steps>.mjs`.
`window.__le2Movies` holds the statistics of the movies played.
