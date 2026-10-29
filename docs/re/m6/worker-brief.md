# M6 worker brief (common part)

You are one of several parallel workers on milestone M6 ("the remaining mini-games") of `legoeiland2-web`: a TypeScript + Vite + WebGL2 browser port of
"LEGO Eiland 2: De Wraak van Dondersteen" (LEGO Island 2: The Brickster's Revenge, Silicon Dreams 2001, Dutch release; hobby project). You own ONE zone (named in your task).
Goal: that zone is fully playable like the original: zone runner + LoopConfig (intro / help texts from the zone's `.str`, countdown, results with the medal / score thresholds read from the EXE),
the zone's constructors / behaviour nodes ported from the decompile, the player controls, opponents / AI, physics, scoring / timers, HUD, sounds / music / speech, cutscene slots (existing
cutscene runner `src/shell/cutscene*.ts`), exits and story effects (trophies, hi-scores, FSM). Zones with special rigs / no PEPP record need their own player objects (docs/re/engine-m2.md, zone-setup.md).

## Rules
* Repo `/Users/sander/Documents/legoeiland2-web` (not a git repo; **never commit / push**). Other workers edit it concurrently: stay in your files (`src/zones/<zone>.ts`, `src/zones/<zonelower>/`, `tools/tests/m6-<zone>*.mjs`,
  `tools/steps/m6-<zone>*.mjs`, `docs/re/m6/<zone>.md`). Shared files (`src/zones/index.ts` (add ONE import line), `src/game/*`, `src/shell/*`, `src/render/*`, `src/audio/*`, `docs/re/m6/progress.md`): small surgical additive edits only,
  re-read right before editing, never rewrite; list every such edit in your report. Do NOT edit `src/island/`, `src/zones/z02LGI/`, other zones' files.
* Node 26 runs `.ts` directly in strip-only mode: erasable TypeScript only (no parameter properties, enums, namespaces); imports use the `.ts` extension. `npx tsc` clean (strict, noUnusedLocals), `npx vite build` and
  `node tools/test-formats.mjs` must pass (`--only name,name` for yours; a test is `tools/tests/<file>.mjs` default-exporting `{ name, run(ctx) -> { checked, failures, notes? } }`; see tools/tests/m3-z17WAS.mjs). If a failure is in somebody else's area, ignore it and say so.
* No EXE-derived code or data blobs in the repo: named constants with the EXE address in a comment; tables read from the EXE at run time (`pe.u32(va)`, `pe.cstr(va)`, `pe.f32`).
* Original data (read-only): `/Users/sander/Documents/legoeiland2-extract/game/Game/` (dev symlink `public/data/le2`). Decompile: `/Users/sander/Documents/basdebeer-tools/decomp-le2/` (`LE2.c`, `LE2.asm.txt`, `tools/fn.py 0xADDR` / `fa.py` (floats annotated) / `cg.py` (callees, callers) /
  `calls.py` (real call args) / `zones.py` / `fsm_dump.py` / `gamevars.tsv`; run with `/Users/sander/Documents/basdebeer-tools/venv/bin/python -I tools/<x>.py`, cwd = decomp dir). Decompile artefacts: `DAT_00983804 + 0x680` = record array + BYTE offset (record = offset / 0x68),
  floats show as hex ints, `__ftol` = truncation, `float10` = x87, `FUN_0085xxxx` = CRT math (sin/cos/atan2 = 0085d1c4 / 0085d374 / 0085d640 / 0085d260). The Ghidra project is `basdebeer-tools/ghidra_proj/proj_le2`. Web gameplay videos / descriptions are fine as reference.
* Port from the decompile, don't invent. Timing: fixed 30 Hz, `w.dt` = 1 per tick; the original multiplies by `DAT_008b1718` where the decompile does. Where something can't be known say so in your doc instead of guessing silently.
* Codex only after `python3 ~/.claude/hooks/codex-subscription-guard.py` exits 0 (optional). Never GLM is needed (hobby, allowed, but not required).
* **Headless and muted browser only** (never the user's own Chrome; no chrome-devtools MCP / Claude_Browser tools): `node tools/browse.mjs "<url>" steps.mjs --size 1280x800 --out /tmp/m6-<zone>`; steps examples `tools/steps/m3-z17WAS.mjs`, `m3-z17WAS-loss.mjs`; URL e.g. `http://localhost:<port>/?zone=<zone>&mute=1`
  (see docs/engine-api.md; the page exposes `window.__zone`). Do NOT use port 5499 / 5497 / 5498 (others). Serve a snapshot for long bot runs: `sh tools/m4-snapshot-server.sh <your port>` (re-run it to refresh after edits, stop with `pkill -f m4snap-<port>`);
  your port is given in the task. Look at screenshots yourself (Read the PNG). Real key input for the bots (win + loss + results screen + return to the hub / story effect).
* Also required per zone: node tests (scoring, timers, AI with scripted inputs: a win and a loss) in `tools/tests/m6-<zone>.mjs`.

## The pattern to follow (M3)
Read first: `docs/re/architecture.md` (3.4 / 3.6 per-zone notes, 4, 5, 8), `docs/re/engine-m1.md`, `engine-m2.md`, `zone-setup.md`, `docs/re/m3/*.md` (esp. `ui.md`, `z17WAS.md`, `z38PAR`, `z39ASB`, `z41MAP`), `docs/re/m4/emu.md` (an x86 interpreter can RUN the zone's own set-up code from the EXE:
consider it if the zone's registration / data tables are heavy), `rendering.md`, `audio.md`, `formats.md`, `docs/engine-api.md`; code: `src/zones/z17WAS.ts` + `src/zones/z17was/rules.ts`, `src/zones/z38PAR.ts` + `parachute/`, `src/zones/z39ASB*`, `src/zones/z41MAP*`, `src/shell/zonegame.ts`, `playzone.ts`, `loopmachine.ts`,
`helpscreen.ts`, `src/game/` (controller, setup `registerCtor`, walk, swim, record, world), `src/audio/`, `src/formats/`. Per-zone doc: `docs/re/m6/<zone>.md` (files, ported functions with addresses, constants, findings, approximations). Keep your status line in `docs/re/m6/progress.md` current (one section per zone; add yours).
If you stall for a long time: stop, update the log and report instead of waiting. Final report (under 50 lines): status, ported functions, files, shared-file edits, tests (counts), screenshots looked at, approximations / missing, open questions.
