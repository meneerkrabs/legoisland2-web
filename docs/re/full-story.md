# The full-story bot (`tools/steps/full-story.mjs`)

A headless, muted browser plays LEGO Island 2 from the front end (Starten -> Nieuw spel) to the free roam at story node 68, with real key input through the port's input mapper.
It chains the chapter bots of the earlier milestones **in place**: the page is never reloaded between chapters, so every chapter starts in the state the previous one left (arrival
vehicle, `PREV_SUBGAME`, loaded rosters ...) and the story advances only through the game's own triggers. No story-node jumps, no F9 / F10, no `&debug=1`.

```
sh tools/m4-snapshot-server.sh 5801        # a snapshot of the repo: no HMR, no watcher (see "Reload guard" below); stop it with pkill -f m4snap-5801
sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5801/?start=frontend&mute=1&hold=1" tools/steps/full-story.mjs --size 800x600 --out /tmp/full-story
```

Env: `RESUME=<chapter id>` (or `auto`: after the last chapter of the checkpoint file) starts at a chapter through its URL start point (`?zone=<zone>&node=<node>`, the original's own chapter
jump; used only to resume), `STOP_AFTER=<id>`, `CHECKPOINT=<file>` (default `/tmp/full-story-checkpoint.json`, written after every chapter that arrived where the story goes on),
`LIST=1`. The log prints a time stamp per chapter, every chapter's `steps ok` / `STEP FAILURES` and whether the game `arrived` at the next chapter's zone and node; the story ends with
`FULL STORY: all chapters played` (exit code 0) or `FULL STORY FAILED: ...` (1). The window is 800x600: the software GL of a headless browser costs time per pixel and a run at 1280x800
takes twice as long on a busy machine. `&hold=1` keeps browse.mjs from tapping the hubs' mode 1 for the bot (the chapter bots take the frozen first frame with their own key).
A whole game takes about an hour (58.9 min, 25 chapters, no retry, no failed step, on a machine with a load average above 20). Resuming (`RESUME=...`) uses the original's chapter jump
(URL `?zone=&node=`, the vars of the skipped nodes are forced to their node values), so a resumed chapter starts in a slightly different state than the played one; the checkpoint is the
chapter id, not a save game (the in-game save is exercised by `era1`, which saves, quits and loads in the middle of the story and plays on).

## Chapters

| id | story nodes | played by |
|---|---|---|
| fe-ch1 | front end, 2..11 | `m4-chapter1.mjs` (customers, house, pizzeria, jail, pages, bot heads, INFC door, Whack-A-Bot win) |
| era1 | 11..14 | `m4-era1.mjs` (`STOP=castle INPLACE=1`: mainframe, save / load, Res-Q, boat, sea portal) |
| castle | 15..29 | `m5-z07CSI.mjs` (hub part) with the mini-games BKD (18), JST (23), RGB (26) played by their own win bots (`LE2_MINIGAME` hook) |
| era2 | 30..33 | `m4-era2.mjs` (`FROM=castle STOP=stubs INPLACE=1`) |
| cai33 osd34 z15SSH pya36 z17WAS pya38 z18MMP pya40 z20DSP z21FSH osd45 z22BIP dip47 z27TRX z28HAT dip50 cai51 | 33..51 | the M5 hub bots and the M3 / M6 mini-game bots |
| home | 52, 53 | `m4-era2.mjs` tail (`FROM=stubs INPLACE=1`): the Pterodactyl / helicopter lands |
| era3 | 54..61 | `m4-era3.mjs` (`FROM=pages STOP=asb`): pages, bot heads, police, Space Port, z36CNT, z38PAR, island era 4, the shuttle |
| ogel | 62..67 | `lib-ogelarc.mjs`: z39ASB, z40aPO, z40OGL, z41MAP, z40OGL, z42BRP (outro movie) |
| end | 68 | `m4-era3.mjs` (`FROM=end`): free roam |

## How the steps are chained (`lib-story.mjs`)

* `runModule(file, { env, until })` imports a step module and runs it with a wrapped helper set. The steps' `page.goto(<chapter-skip URL>)` is not a story jump here: when the game already is
  where that URL would put it the call does nothing, otherwise it is refused (resume mode allows it). `until(state)` stops a step early (the later part of a step is often a loss run):
  every later call of its page / key / wait helpers throws and the keys it still held are released.
* `playMini(...)`: a mini-game's win bot, stopped when the result menu's Continue has led out of the zone. A bot can lose a run (a ring missed by a tick); like a player it takes "Opnieuw"
  (page 19) and tries again (up to 4 attempts, reported at the end). The step is stopped the moment the failure menu opens.
* Shortcuts that remain, all inherited from the chapter bots and logged by them: long walks are teleports (Pepper put next to the target, facing it; the keys do the actions), `SHORTCUT` legs of
  the Pyramid route (Pepper put on a PATH node when a leg times out), `BOT-HELP` lines in the castle (Pepper / the horse put on a route node when wedged), and the mini-game bots' own
  shortened clocks (documented in the headers of the m3 / m6 steps: the clock of Whack-A-Snake and the skate park, the vehicle at 90 % of the course in z15SSH / z20DSP, a fish put at the
  bobber in z21FSH, the remaining cannons of z10RGB after one real kill).

## Reliability rules (what changed, and why)

* **Wait in game ticks, not wall time.** A loaded page (two bots, other jobs) runs 10 .. 25 ticks a second instead of 30; `THROTTLE=4` (browse.mjs) simulates the live site. Waits are
  `S.untilTicks(...)` (which also gives up after 12 s of wall time without a tick: a paused game must not hang a bot), `S.until(fn, ms)` (now `ms` of GAME time, wall-clock ceiling 12 x),
  the sail / flight helpers of the castle and Adventure Island (ticks), and ceilings only otherwise. In-page waits end when the zone changed or the game stood still for 20 s
  (`lib-pya.mjs` `H.keys` hung for ever on the old world when the story moved on while a leg was being walked: a hand-over to z18MMP in the middle of the Pyramid route).
* **Decide per tick, not per frame.** A decision that runs between frames (`requestAnimationFrame`, a timer, a node-side poll) is up to a whole frame late and a frame runs several ticks on
  a loaded page. `lib-pagebot.mjs` now decides inside the input mapper's per-tick update (`sh.input.update()` runs right before every simulation tick) and sets the keys on the mapper;
  z21FSH's strike / reel loops do the same; the pilots of z38PAR / z40aPO are armed before the game starts.
* **Steer like a player.** The arrow keys are camera relative (FUN_0042a654: the stick is rotated by the camera's right / forward axes). `lib-walkbot.mjs` follows a route by pure pursuit and
  presses the arrows on the wanted direction as seen from the camera (z40OGL: no fall from the spiral any more, 550 ticks for node 64; z23DIP: 104 ticks for the walk to the Pterodactyl, which the
  node-side steering lost behind the dinosaurs).
* **The end banner is left as soon as ANY button is held** (the original's rule): a bot key still down at the end takes the loop straight to the result menu (mode 5). Steps accept both.
* **The story is not rewound by the palace, the page was reloaded.** A dev server with HMR reloads the page when someone edits `src/` during a long run; the game then restarts at the URL's
  chapter jump (`zone=z39ASB&node=62`), which looks exactly like "z42BRP:67 -> z39ASB:62 -> z40aPO:63". Reproduced (an edit of `src/shell/shell.ts` on a watching server loses window state and
  restarts the zone). Run long bots on a snapshot server; `lib-story.mjs` arms a reload guard (`window.__le2guard`) and reports `PAGE RELOADED` instead of failing later. Leaving z42BRP
  by its win goes to the island at node 68 (OutroFMV first): `installStoryTrace` records every move of the story FSM with its stack if it ever does otherwise.

## Mini-game bots under load

Every mini-game win bot was run alone under `THROTTLE=6` (browse.mjs: CPU throttling of the page, ticks run at about a fifth of the normal wall-clock rate) with
`tools/steps/mini-once.mjs` (`MINI=<zone> NO_RETRY=1`): z17WAS, z18MMP, z20DSP, z15SSH, z28HAT, z27TRX, z36CNT, z41MAP, z10RGB, z08BKD, z22BIP, z38PAR, z40aPO, z39ASB, z09JST all win on
the first attempt after these changes. Before them z18MMP (decisions between frames: lost), z09JST (a node-side loop: stalemate at 2 : 2 for 15 minutes) and z10RGB (wall-clock limits)
failed under load. A bot that is slow in wall time but exact in game time is a bot that waits and decides in ticks.

## Hang and fault diagnostics

* `lib-story.mjs` runner: **heartbeat** (every minute: when zone / node / mode / tick did not change for two minutes the probe is logged `[heartbeat]`), **pause guard** (the pause menu
  open for 25 s without ticks is nobody's doing: Esc resumes it), **reload guard** (`PAGE RELOADED`), **stable arrival** (a hub chapter's step is stopped 6 s after the game stands where
  the story goes on, so a step that waits for something that never comes cannot hang the run), **headless pointer lock** (the game asks for the pointer lock every few seconds for the
  chase camera and turns an unlock into the pause key, src/game/input.ts `onLockChange`: a headless run has no pointer, so the request is refused like a browser would without user activation;
  the first events are logged `[le2-ev]`).
* Retries: a lost mini-game run takes "Opnieuw"; the end of the log lists the mini-games that needed it (z10RGB: Pepper can be hit on the bridge before she reaches a cannon).
