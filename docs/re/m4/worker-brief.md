# M4 worker brief (common part)

You are one of several parallel workers on milestone M4 ("the island z02LGI with its story") of `legoeiland2-web`: a TypeScript + Vite + WebGL2 browser port of
"LEGO Eiland 2: De Wraak van Dondersteen" (LEGO Island 2: The Brickster's Revenge, Silicon Dreams 2001, Dutch release; hobby project). The lead (me) integrates; you
own one work package (WP) and the files of it. Read `docs/re/m4/progress.md` for the plan and the other WPs.

## Environment and rules

* Repo: `/Users/sander/Documents/legoeiland2-web`. **Do not commit, push or touch git.** Do not delete other people's files. Other workers edit the repo at the same time:
  keep to your own directory/files; for shared files (`src/island/ctx.ts`, `tools/lib/island-load.mjs`, `src/game/walk.ts`, `src/game/setup.ts`, `src/game/swim.ts`, `docs/re/m4/progress.md`)
  make small surgical edits (re-read right before editing, never rewrite a whole shared file).
* Node 26 runs `.ts` directly in strip-only mode: **erasable TypeScript only** (no parameter properties `constructor(private x)`, no `enum`, no `namespace`); imports use the `.ts` extension.
  `cd /Users/sander/Documents/legoeiland2-web && npx tsc` must stay clean (strict, noUnusedLocals); `node tools/test-formats.mjs --only <name>[,<name>]` runs tests
  (a test is `tools/tests/<file>.mjs` default-exporting `{ name, run(ctx) -> { checked, failures: string[], notes? } }`; see `tools/tests/engine-walk.mjs`, `tools/tests/emusetup.mjs`);
  `npx vite build` must also pass at the end. Name your tests `m4-<wp>-<topic>`.
* Original game data (read-only): `/Users/sander/Documents/legoeiland2-extract/game/Game/` (dev symlink `public/data/le2`, with `LEGO eiland 2.exe` and `_data/*.bob`).
  Decompile of the executable: `/Users/sander/Documents/basdebeer-tools/decomp-le2/` (`LE2.c` = Ghidra decompile, `LE2.asm.txt` = disassembly, grep by `xxxxxxxx:`).
  Helper scripts (cwd = that directory, `/Users/sander/Documents/basdebeer-tools/venv/bin/python -I tools/<x>.py`): `fn.py 0xADDR ...` prints functions, `fa.py` the same with `.rdata`/`.data`
  constants annotated (floats!), `cg.py 0xADDR` callees (with sizes) and callers, `calls.py 0xADDR` real call arguments (Ghidra drops arguments), `gamevars.tsv` = the 319 game variables
  (index, hex, name); `tools/README.txt`. Decompile artefacts: `DAT_00983804 + 0x680` = record array base + offset in BYTES (record = offset / 0x68), floats appear as hex ints
  (`0x3f800000`), `__ftol` = truncation, `float10` = x87, `FUN_0085xxxx` = CRT (sin/cos/atan2: `FUN_0085d1c4/0085d374/0085d640/0085d260`).
* **No EXE-derived code or data blobs in the repo**: constants go into the source as named constants with the EXE address in a comment; tables are read from the EXE at run time
  (`Pe`: `pe.u32(va)`, `pe.cstr(va)`; see how `src/game/walk.ts`, `src/zones/z50LTC/people.ts` do it).
* Headless browser runs only when you need them (never the user's own browser, no chrome-devtools / Claude_Browser tools): dev server on port 5499 is usually running already
  (`curl -sI http://localhost:5499/`; do not stop it; if it is down start `npx vite --port 5499 --strictPort` in the repo and stop only what you started), then
  `node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=2&mute=1" steps.mjs --size 1280x800 --out /tmp/m4-<wp>` (steps examples: `tools/steps/m3-z50LTC-island.mjs`; the page exposes
  `window.__zone` = `{ info, loaded, world, machine, gr, hud, sh, game, ctx }`). Look at your screenshots yourself (Read the PNG). The island zone game that wires everything is
  built by the lead (WP8) in `src/zones/z02LGI/`; until it exists your tests run in node.
* Codex (second opinion) only after `python3 ~/.claude/hooks/codex-subscription-guard.py` exits 0; optional.
* Report (final message, under 60 lines): what you ported (functions with addresses), files, tests and results, what is approximated or missing, open questions for the lead, what the lead must wire
  (constructor addresses you registered, ctx members you added). Keep a section for your WP in `docs/re/m4/<wp>.md` (design, findings about the original, constants, approximations).
  Do not write other report files.

## The architecture you plug into (read these first)

* `docs/re/architecture.md` sections 3.5, 4 (object model, controllers and nodes, NPCs, vehicles), 5 (cutscenes); `docs/re/engine-m1.md`; `docs/re/m4/emu.md` (how the island's set-up is produced);
  `src/game/controller.ts` (behaviour nodes: `update(w, rec, ctrl)`, return codes, gates `(var & mask) == value`, passes), `src/game/record.ts`, `src/game/world.ts`, `src/game/walk.ts`
  (Pepper's walk node), `src/game/walker.ts` (waypoint walker, `waypoints` singleton: create/goTo/step...), `src/game/swim.ts` (swim + `PepSwitchNode` with an extensible `pepperModeRules` list),
  `src/game/setup.ts` (`registerCtor(address, factory)`: the factory gets the extracted attach (`record`, `ctor`, `pos`, gate `var/mask/value`, and for the island `args`: the 0x80 bytes of the
  argument block the original's set-up code built) and returns a `BehaviourNode`; the node is inserted at `pos` of the record's controller; attaches whose constructor is not registered are skipped).
* **Island set-up**: `src/formats/emusetup.ts` RUNS the original set-up code (FUN_004b6475 with the per-era roster functions) in an x86 interpreter for the actual story node and produces every attach
  (record index, constructor address, argument block bytes, position in the node list, gate), the record flag/position changes, cutscene slots, dictionaries. `profileFor('z02LGI', pe, scene, starts, { islandVars, archive })`
  -> `profile.island`; `setupZone` consumes it. The constructors' argument layouts are **yours to decode from the decompile**: read the constructor `FUN_xxxxxxxx` (called by FUN_00423532 as
  `ctor(rec, arg, node, var, mask, value)`; the node is a heap block whose private state starts at +0x14; the handler table the constructor stores at node+4 gives update / pre-render / destroy / draw)
  and the update function, port them 1:1 (state machines on `*(float*)(node + off)` become class fields with the offset in a comment).
  `src/island/args.ts` `ArgView.of(attach)` reads the block (`f32`, `i32`, `rec(off, world)` resolves record pointers, ...).
  To see the real data of an era: `node tools/island-roster.mjs <node> [ctor regex]` prints every attach with decoded words (tool by the lead); era = story node 2 (era 0), 7 (1), 30 (2), 52 (3), 61 (4).
* **Island context** `src/island/ctx.ts` (`ctxOf(world)`): cutscene start / active, speech (`say`), the message tables of the story handler (`text.npc` = `LI/Data/lifsmN.str`: the lines the talking NPCs say,
  tags `<NAME>A/B/C...`; `text.hol`), sound, the animation-name and switch-name dictionaries, a `shared` bag for what the original keeps in globals. Add members (optional, documented with the original
  function) when you need a service; the lead implements them in the real zone game (`src/zones/z02LGI/ctx.ts`). Tests use the mock in `tools/lib/island-load.mjs` (`loadIsland(ctx, { node })` builds the real island
  world for a story node with the mock context; `tick`, `press`, `hold`); extend the mock for your needs with small additive edits.
* Game variables: names in `docs/re/architecture.md` 6.1 and `gamevars.tsv`; `V` / `PC` in `src/game/vars.ts`; `world.vars.get/set/or/andNot/add`. The island's `SWITCH_LGI_*` names map to vars 250.. (`ctx.switchVar(name)`).
  Zone-local vars (0xfa..0x13e = `SUBGAME:n`) are used by scripts and trigger nodes as flags (`S277` = var 277 = 0x115 is the node-2 progress var, `SUBGAME:n` numbering = var index).
* Timing: the simulation runs at a fixed 60 Hz (one sim step = one drawn frame of the original), `w.dt` = 1.0 for the first 5 frames, then 0.5 (WP-TIME, `World.advanceDt`); the original multiplies by `DAT_008b1718` (= dt) exactly where you see it in the decompile. Positions are world units; the walker works in units / 8 (see walker.ts).
* Pepper = record `PEPP` (index 16) with the node chain extracted from FUN_004b4220: `Music` (0), `PepSwitc` (1), `SGwalk` gate `PEPPER_CONTROL & 1`, `sgswim` & 2, skateboard & 4, `SGVehic` & 8, `Ptera` & 0x40.
* Rendering and the shell are not your business, except where your node has to ask for something (HUD icon, subtitle, sound): go through `IslandCtx`.

## What good looks like

Port from the decompile, don't invent: story logic, NPC behaviour, tuning constants (read floats with `fa.py` or from the EXE at run time), sounds (sound ids), animation clip ids (`ctx.animClip(name)`
or the number the decompile passes to `FUN_0043b6a3`). Write node-level node tests that drive the real island world (real records, real collision, real waypoint maps) and assert on behaviour (positions over time,
state transitions, variable writes, sounds, cutscene starts). Where something cannot be known from the decompile, say so in your doc rather than guessing silently. Prefer fewer things done well.
