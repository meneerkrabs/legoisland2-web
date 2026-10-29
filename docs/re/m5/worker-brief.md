# M5 worker brief (common part)

M5 = "the hub zones": every hub between the mini-games plays like the original (z07CSI castle, z13CAI Adventure Island, z14OSD Oasis, z16PYA Pyramid, z23DIP Dino island,
z40OGL Ogel's island) plus the audit of the zones that were ported earlier. Project: `legoeiland2-web` (TypeScript + Vite + WebGL2 browser port of the Dutch PC game
"LEGO Eiland 2", reverse-engineered from a Ghidra decompile of the debug-build EXE; hobby project; live at https://meneerkrabs.github.io/legoeiland2-web/).

## The user's hard requirement: NO APPROXIMATIONS
Port behaviour from the decompile exactly: set-up, behaviour nodes, cutscenes, talking, story handler, triggers, doors, vehicles, HUD, sounds, music, camera.
Where something is not certain, find out from the code, or run the original's code in the x86 emulator (`src/formats/x86emu.ts`, `emusetup.ts`, as M4 / M6 did:
see `docs/re/m4/emu.md`, `tools/lib/*-emu.mjs`, `tools/tests/m6-z09JST-emu.mjs`, `m6-z18MMP-emu.mjs`) instead of guessing, and record what you verified and how
in your zone doc. If something truly cannot be known, say so explicitly in the doc and the report (do not hide it).

## Read first
`docs/re/engine-m4.md` (the island: design, modules, findings), `docs/re/m4/progress.md`, `docs/re/m4/emu.md` + `wp*.md` (node families), `docs/re/m6/progress.md` and
`docs/re/m6/worker-brief.md` (how the mini-games were done: tests, oracle tests against the emulated original, headless bots), `docs/engine-api.md`,
`docs/re/architecture.md`, `docs/re/m3/*.md`, `docs/re/zone-setup.md`. Code: `src/island/` (shared node families, registered by constructor address with `registerCtor`),
`src/zones/z02LGI/` (the island's zone game: story handler, ctx, objective, arrival), `src/shell/cutscene*.ts`, `src/shell/playzone.ts` + `zonegame.ts` + `loopmachine.ts`,
`src/game/*`. The foundation worker's notes will be in `docs/re/m5/foundation.md` and `docs/re/m5/progress.md` (read them when they exist).

## Rules
* Repo: `/Users/sander/Documents/legoeiland2-web` (NOT a git repo for your purposes: **never run git commands that change the index, HEAD or working tree** (no add / commit /
  stash / checkout / reset), never push; the user commits). Other work runs in the same tree at the same time (other M5 workers, an approximation inventory writing
  `docs/re/gaps.md`, later packages: particles renderer, audio / music timing, gamepad, original RNG, saves, M4 island details, mini-game fixes). Stay in your own files.
  Shared engine files (`src/shell/*`, `src/render/*`, `src/game/*`, `src/audio/*`, `src/island/*`, `src/formats/*`, `src/zones/index.ts`): **additive, surgical edits only**,
  re-read the file immediately before editing, never rewrite a whole file, keep existing behaviour of other zones unchanged (all their tests must stay green), and list
  every such edit (file, what, why) in your doc and report. Do not touch `docs/re/gaps.md`. Do not use Codex or GLM.
* Node 26 runs `.ts` directly in strip-only mode: erasable TypeScript only (no parameter properties, enums, namespaces); imports use the `.ts` extension.
  `npx tsc --noEmit` (strict, noUnusedLocals), `npx vite build` and `node tools/test-formats.mjs` must stay green (`--only name,name` runs yours; a test is
  `tools/tests/<file>.mjs` default-exporting `{ name, run(ctx) -> { checked, failures, notes? } }`; see `tools/tests/m6-z09JST-emu.mjs`, `m4-wp8-story.mjs`). If a failure is in
  somebody else's area, ignore it and say so.
* No EXE-derived code or data blobs in the repo: named constants with the EXE address in a comment; tables are read from the EXE at run time (`pe.u32(va)`, `pe.cstr(va)`, `pe.f32`).
* Original data (read-only): `/Users/sander/Documents/legoeiland2-extract/game/Game/` (dev symlink `public/data/le2`). Decompile: `/Users/sander/Documents/basdebeer-tools/decomp-le2/`
  (`LE2.c`, `LE2.asm.txt`, `atlas.md`, helper scripts `tools/fn.py 0xADDR` / `fa.py` (floats annotated) / `cg.py` (callees, callers) / `calls.py` (real call args) / `zones.py` /
  `fsm_dump.py` / `gamevars.tsv`, run with `/Users/sander/Documents/basdebeer-tools/venv/bin/python -I tools/<x>.py`, cwd = the decomp dir; `tools/README.txt`).
  Decompile artefacts: `DAT_00983804 + 0x680` = record array + BYTE offset (record = offset / 0x68), floats show as hex ints, `__ftol` = truncation, `float10` = x87,
  `FUN_0085xxxx` = CRT math (sin / cos / atan2 = 0085d1c4 / 0085d374 / 0085d640 / 0085d260). Ghidra project: `basdebeer-tools/ghidra_proj/proj_le2`.
* Timing: fixed 30 Hz, `w.dt` = 1 per tick; the original multiplies by `DAT_008b1718` where the decompile does.
* **Headless and muted browser only** (never the user's own Chrome; never the chrome-devtools / Claude_Browser tools): `node tools/browse.mjs "<url>" steps.mjs --size 1280x800 --out /tmp/m5-<zone>`
  (step examples `tools/steps/m4-era1.mjs`, `lib-island.mjs`, `m6-*.mjs`; `window.__zone`, `?zone=<archive>&node=N&mute=1`, see docs/engine-api.md). **At most two bots run at a
  time on this machine**: start every browser bot through `sh tools/m5-botslot.sh node tools/browse.mjs ...` (it waits for a free slot). Prefer a snapshot server for long runs
  (`sh tools/m4-snapshot-server.sh <port>`, stop with `pkill -f m4snap-<port>`), your own port is given in your task; never use 5497 / 5498 / 5499. Real key input for the bots.
  Look at screenshots yourself (Read the PNG): a bot that "passes" with a black screen is not a pass.
* Every hub / zone gets: its set-up (from the EXE through the emulator, like the island), all its behaviour nodes, cutscenes + story transitions, node tests (`tools/tests/m5-<zone>*.mjs`),
  oracle tests against the emulated original where possible (the original's node code run in the x86 interpreter next to the port, as M6 did), a headless bot with real key input
  (`tools/steps/m5-<zone>*.mjs`) that plays the hub's part of the story, a doc `docs/re/m5/<zone>.md` (files, ported functions with addresses, constants, findings, what was verified
  and how, what is not exact and why) and a status section in `docs/re/m5/progress.md` (append your own section; re-read before editing).
* If you stall for a long time: stop, update the log and report instead of waiting. Final report (under 60 lines): status, ported functions, files (new / changed), shared-file edits,
  tests (counts), bot runs and screenshots looked at, anything not exact and why, open questions.

## Update for the hub workers (after the foundation, read this too)
* The foundation is DONE: read `docs/re/m5/foundation.md` (set-up emulation for any zone: `emulateZoneSetup`, `profile.emu`, `emu.run(fn, args)` = call any original function in the same
  emulated machine after the set-up = your ORACLE; `src/hub/` framework: `registerHub({...})`, `HubContext`, `HubGame`, story-handler protocol) and `docs/re/m5/foundation-ctors.md`
  (every ctor per node, ported or not). Your hub folder `src/zones/<hub>/` exists as a stub `registerHub({ archive })`: fill it. Test helpers: `tools/lib/hub-load.mjs`, `tools/lib/emu-oracle.mjs`;
  bot helpers: `tools/steps/lib-hub.mjs` (`?zone=<archive>&node=N&mute=1&hold=1&debug=1`).
* `docs/re/gaps.md` is the inventory of approximations (read section 0, section H for your hub, and H7); do not edit it. Decisions that affect you: the simulation will later move to a fixed 60 Hz step
  with dt = 0.5 (WP-TIME, done by someone else) so port node code EXACTLY as the original (multiply by dt where the original does, keep per-frame code per frame, never bake in dt = 1); all random
  numbers will go through one shared MSVC-rand port later: until then do not add Math.random without a `// RNG:` comment (so they can be found). Particles: another package builds `src/fx/particles/**`
  (it implements `ctx.particles` and zone fx hooks): do not write emitters; instead list in your doc every emitter / `.par` / `.swl` your hub's code starts (name, call site, VA, when).
  Rendering: WP-RENDER delivered APIs every hub must use like the original: `setPartMode` / `setShiny` (FUN_00444550 / FUN_004446c0, `src/game/render.ts`; constructors call them at set-up:
  `extractCtorRenderCalls`), blob shadows and Pepper's marker (`src/game/shadow.ts`), the node probe pass `armProbe` + `probePass` (`src/game/probe.ts`, FUN_00427233 / FUN_00427014), fog phases per zone
  (`src/game/fogphases.ts`, FUN_00442d90: the last SetupFog call wins, with play / start / restart addresses), the flowing-water node (ctor 0x426f55, hook FUN_00426e9a; CAI). Docs: `docs/re/rendering.md`,
  `docs/engine-api.md`. Wire them into your hub where the original does. Audio / music / input / time / island packages work in parallel in their own files (src/audio, audiohost.ts, input.ts, camera.ts,
  src/island/**, src/zones/z02LGI/**): shared node families in `src/island/` are now owned by the island package: extend them only additively and list every change in your report.
* Ownership: you own `src/zones/<hub>/**` (and sub-folders named for your hub), `tools/tests/m5-<hub>*.mjs`, `tools/steps/m5-<hub>*.mjs`, `docs/re/m5/<hub>.md`. Shared constructors are registered by address
  in one global map: **z14OSD owns Gems 0x62b220, scorpion 0x62ad35 / 0x62af8d, Tumblewd 0x629d7e** (z16PYA and z23DIP do not port these again; they port their own parts first and, when OSD's land
  (grep `registerCtor` / `src/zones/z14OSD`), verify the hub-specific argument blocks / PEPP chain differences and add what differs; if still missing when you are otherwise done, write the need under "Requests" in `docs/re/m5/progress.md` and finish your report with it); **z13CAI owns Bunny 0x4b4000** (also used by OSD). Hub workers never edit each other's folders; if you need something from another hub's area, write a short request
  into `docs/re/m5/progress.md` under a "Requests" heading (addressed to the hub: csi, csi-horse, cai, osd, pya, dip, ogl, ogl-peppswit); workers cannot message each other, so read that section now and then (e.g. before every big step) for requests addressed to you, and answer in the same place.
* Your hub must be played end to end by a headless bot (real key input) for every story node that maps to it, from the arrival (as the original arrives: from the island / the previous mini-game) through
  its cutscenes / conversations / objectives to the story node's completion and the hand-over to the next zone (the `nextAfterExit` mapping), including the way back to the island where the story requires it.
  Shortcut between chapters via the `node=` skip is fine; the hub's own part must be played.

## Updates from finished packages (2026-10-29, late)
* Audio: music now starts where the original calls Play, from `ZONE_MUSIC` in src/audio/zonemusic.ts (per-zone table; init plays for the hubs too): if your hub also plays music via `ctx.music`, set that zone's `plays: []`
  there to avoid a restart. Per-zone sound preload lists are generated in src/audio/zonesounds.ts (AudioHost.enterZone loads them before the loop); constructor-loaded sounds with data ids (`Sound3d`, `SGMFIG`)
  must be loaded via `AudioHost.loadExtra`. The DirectMusic notification queue (FUN_00443370) is `MusicEngine.pollNotification`, forwarded by src/hub/ctx.ts (`musicNotified`). z07CSI's sound-switch table is unported (csi worker).
* Particles: the runtime exists now (src/fx/particles, docs/re/particles.md has the wiring how-to; zone API `ZoneParticles`, start calls must pass the real parent matrix like the original). WIRE every particle
  emitter of your hub yourself (instead of only listing them), and list them in your doc.
* Dev aids F9/F10 only with `?debug=1`; lib-hub defaults to it. Input is sampled once per tick like the original: bot key taps must be held >= 70 ms.
* Rate limits: at most 4 workers run at once; if you get cut off, a lead resumes you: keep your progress log in docs/re/m5/progress.md up to date as you go.
