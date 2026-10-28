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

## Dev / test URLs

`?play=1` (start at once; click once for sound), `&intro=0` (skip the intro), `&movie=SdLogo` (only that movie), `&mute=1` (silent),
`&source=archive` (archive.org even when the dev copy exists), `&throttle=150000` (hand movies out at that many bytes/s: exercises the stall handling). Headless: `node tools/browse.mjs "<url>" tools/steps/<steps>.mjs`.
`window.__le2Movies` holds the statistics of the movies played.
