# M4 WP2: the cutscene runner for the island scripts

The CSM (Common\CSM, 0x458a4c-0x45f9d2; architecture.md 5) is ported in `src/shell/cutscene.ts` (`CutsceneRunner`, DOM-free) and `src/shell/cutscene-host.ts`
(`CutsceneHost`, browser glue). M3 had a minimal port for z40aPO's `ogl02`; WP2 makes it faithful for the ~60 island scripts (`z02LGI/cutscene/*.cut`).
Tools / tests: `tools/m4-cutscene-coverage.mjs` (what the scripts use), `tools/lib/m4-wp2-fixture.mjs`, `tools/tests/m4-wp2-scripts.mjs` (every island script of every
era), `tools/tests/m4-wp2-commands.mjs` (command by command), `tools/tests/m3-cutscene.mjs` (synthetic rules + ogl02, still passing).

## 1. What the island scripts use (coverage tool)

`node tools/m4-cutscene-coverage.mjs [--zone z02LGI | --all] [--scripts]`: 62 scripts, 2431 commands. Per command: SETANIM 542 (anims `XIDLE` 157, `XTALK` 88, ...:
all in the dictionary), SETPOSITION 316 (camera: 103 waypoint + 112 actor-relative with FRONT 61 / HEAD 27 / BEHIND 23 / LSIDE 1; actors: 101 waypoint), SETVISIBILITY
324, SAYTEXT 255, SETSWITCH 217 (`SWITCH_LGI_CSM_FX_SWITCHnn`, `SWITCH_LGI_BRICKFX_*`, `SWITCH_GME_CSM_SFXnn`, `SWITCH_GME_BLDG_PHSE`...), FOLLOW 209 (camera 75,
actors 134), SETTARGET 145, SETEXPRESSION 104, MOVEPOSITION 98 (**actor splines 54**, actor waypoints 22, camera waypoints 15, camera splines 7), SETFOV 95, ATTACH 44
(PIZ3 26, RHCP 12: bones LEFTHAND 25, RIGHTHAND 15, GOB 4; 10 x `NULL` = detach), MOVETARGET 40 (camera: actor 22, waypoint 10, spline 8), SET*SPEED 42. No WAV / MIDI,
no ENABLEAI, no `PLAY`. So `.man` splines are needed (61 + 8 uses).
Slots per era (emulated set-up `IslandSetup.cutscenes`): node 2: 41 (bpk01, LGICI01-25, LGIPH01-11 (09-11 with the strings of 08-10), LGI01-04); node 7: LGI05, LGIBR01-04,
LGI06, LGI07; node 30: LGIBR05-07, LGI08 (7 slots declared, 4 defined); node 52: LGIBR08-12, LGI09-12; node 61: LGI13.

## 2. Ported functions

| address | function | port |
|---|---|---|
| 0x45c40c / 0x458d15 | start (var 0xb check), FUN_00458d15 set-up | `start` / `begin` |
| 0x458a4c | FUN_0045c310 reset | `allocate` |
| 0x45d68a / 0x45d5c0 | loader, actor lookup | `load`, `find`, `resolveWaypoint` (done at start) |
| 0x45c144 / 0x45c0b6 / 0x45c242 / 0x45c28e | TDict lookup (case-insensitive) | `dictLookup`, `switchResolver` |
| 0x458c15 / 0x459618 | wait counters | `counterInit`, pass 3 |
| 0x458f50 / 0x459119 / 0x459597 | frame, scheduler + end, delay | `tick`, `schedule` + `end`, `run` |
| 0x458fa6 / 0x4590d0 | actor registration (AI off, walker paused, lane / face saved) | `register`, `entry` |
| 0x459740 / 0x45965d | per-frame anim advance, ground snap | `actorFrame`, `groundSnap` |
| 0x45c49d | actor dispatch | `runActor` |
| 0x45c595 / 0x45ce77 / 0x43b92a | SETVISIBILITY, SETANIM, clip-ended test | `runActor` 0, `setAnim`, `clipEnded` |
| 0x45cf83 / 0x43f2f0 / 0x43f310 | SAYTEXT (+ mouth frames) | `sayText`, `GameRecord.face` |
| 0x45cd23 / 0x45c5e2 | actor SETTARGET (yaw), SETPOSITION | `turnTo`, `teleport` |
| 0x45c66b / 0x45c80d / 0x45c470 | actor MOVEPOSITION (walker / spline), its step and skip | `moveActor`, `moveStep`, `walkerOf` |
| 0x45cb50 | actor FOLLOW (walker follow mode 0x462729) | `followActor` |
| 0x45d294, 0x45d2b9 / 0x429638, 0x45d301 | SETEXPRESSION, ATTACH, ENABLEAI | `runActor` 13 / `attach` / 15 |
| 0x42992a (matrix part) | carry node pre-render (bone matrix) | `carryMatrix` (export) |
| 0x45eaf0 | global dispatch | `runGlobal` |
| 0x45ec4f / 0x45ebc8 / 0x45eeaa / 0x45ecec / 0x45f543 | camera SETTARGET / SETPOSITION / MOVETARGET / MOVEPOSITION / FOLLOW | `camSetTarget`, `camSetPosition`, `camMove`, `runGlobal` 7 |
| 0x45edae / 0x45eff9 / 0x45f1bc / 0x45f2f4 | eased move, driver | `EasedMove`, `camStep` |
| 0x422f21 / 0x422e36 | actor-relative camera, side vector | `actorCamera`, `sideVector` (exports) |
| 0x45f670 / 0x45f5b8 / 0x45f64b | SETSWITCH, speeds, FOV | `runGlobal` |
| 0x4454e0 / 0x43ecd0 / 0x445340 / 0x447340 / 0x4466f0 / 0x4456e0 | camera spline: translations of the `.man` records (x negated), uniform cubic B-spline | `CameraSpline` |
| 0x43ee40 / 0x43efa0 | actor spline: matrix track | `ActorSpline` |
| 0x45d47f / 0x45d34b / 0x4606e3 | subtitle wrap (4 lines, only with CS_TEXT_ON) | already in helpscreen.ts `wrapSubtitle` (host `draw`) |

## 3. Findings about the original (all reproduced)

* **Loader**: actors are looked up by 4 characters, the first record wins (`PEPP` is unique on the island; no script actor is a duplicated name). `CMRA` / `SWCH` / `PLAY`
  are global only when no record has that name. An **unknown actor stops the loader**: the command array comes from the debug heap (0xCD fill), so that command and
  all later ones have wait id 0xcdcd (outside the 0x201 counters, never 0) and never start. Island case: **lgibr07** (actors `FECM`, `FECN` do not exist): its commands
  24..28 never run. The same applies to the extra commands the header counts (lgi04 543/542, lgi09, LGIPH*, LGIBR*): the loader reads garbage records that either stop
  it or never start; the PSX spline name table is then not read (unused on PC).
* **Waypoints** resolve at load: CSM map (slot 2) first, then PATH (slot 1), first node whose name starts with the word (FUN_00462b4e); an actor's MOVEPOSITION looks only in
  PATH. The **actor SETPOSITION handler reads PATH[index] whatever map the index came from**: two island commands hit this (lgibr04 BILL `CSM_INFOBUILT02` (CSM 98) ->
  PATH[98] at (62.7, 21.2, 265.3) instead of (-302.4, 56.7, -22.1); lgibr08 PAPA `PIZZA01` (CSM 51) -> PATH[51]). Reproduced. Unresolved waypoints give (0, 0, 0)
  (the file's zero fields); none on the island.
* **Empty scripts** (LGICI05-07 have 0 commands): FUN_00458d15 selects the slot but the command array is a null pointer, so nothing runs **and the manager stays selected**:
  every later start only queues and never runs until the next zone set-up (FUN_00458a4c). Started from the queue instead, the scheduler runs one empty frame and ends
  normally. Both reproduced (`start` returns false; `inspect().selected`). WP4 / WP8: check whether the game can start slots 5..7 at all.
* **FOLLOW**: only the *camera* FOLLOW is left out of "something ran this frame"; an actor's FOLLOW keeps the script alive until its walker faces the target (-3).
  Camera FOLLOW (`DAT_05d482f4`) is cleared by SETTARGET / MOVETARGET of the camera, after which it finishes. `ACTO` (the keyword `ACTOR` parsed as a name) -> no record -> done.
* **Actor walks need the actor's walker** (`ctrl + 0x10`); FUN_0045c470's fallback `DAT_05d4dc94` is never written, so without one MOVEPOSITION (waypoint) / FOLLOW end
  at once. Pepper's walker is created by FUN_0042207d (PATH, node -3, speed 0.016667, lane 0.01, turn 0.5236, radii 0.2 / 0.75, limit 0.25) and re-pinned by the StartCSM
  trigger (FUN_0051dd7e calls FUN_004625d7 with its waypoint) before the script; MOVEPOSITION re-tunes it (speed 0.05, lane 0, turn 0.5236, radii 0.2 / 0.75 / 0.25).
* **Skip (Shift, pressed edge 0x40)**: zeroes every delay, ends SETANIM / SAYTEXT (voice stopped) / SETSWITCH durations, snaps camera moves and splines to their end,
  walks an actor out (up to 0x5dd walker steps, then onto the node; the walker keeps "ignore others" set, FUN_004618a5 always reads 1) and makes FOLLOW one step at turn
  rate pi (sic: the step's new yaw ends up as the walker's turn rate, the record's yaw is not changed).
* **SAYTEXT**: time = (strlen + 20 + duration) / 20 s, and the voice must have finished (the voice starts when speech is idle; `DAT_05d4dc90` is one global flag for
  all lines); mouth frames: random 0..9 (FUN_004388ae(10)), held 2 + rand 4 ticks for 0..5, rand 4 + 1 otherwise; afterwards the frame from the start. Subtitles
  (CS_TEXT_ON) are wrapped to 4 lines by FUN_0045d47f (ported in M3).
* **SETANIM**: FUN_0043b92a(anim, 2.0): ended when `frameCount < frame + 2 * dt + 1`; then the duration. XIDLE (157 uses) has a 1-frame clip: it ends at once.
  The dictionary (339 names, capacity 340) maps names case-insensitively; an unknown name gives -1 (the last slot), FUN_0043b6a3 fails and the old clip plays on.
* **Every frame** (FUN_00459740) the registered actors' animations advance by 1 and those with a controller (flag 0x80 clear) are put on the ground: a probe from 4 above
  down to the terrain height (or 160 deep) against the other records; they stand on the hit point, else on the terrain (FUN_0045965d). Spline-driven actors are skipped
  until one frame after their spline ended. This also runs once more in the frame the script ends.
* **End of a script**: per registered actor: AI on (`ctrl.flags |= 2`), walker lane restored; for PEPP (with a walker) the walker is unregistered (FUN_0046265d), her clip is
  restarted with DAT_008ae088 (forced to 0x1b when PEPPER_CONTROL & 1) and the camera is put BEHIND her: FUN_00422f21(PEPP, ry, 2, 3.2, (0, 4, -20)) -> look at
  pos + 3.2, eye 20.4 away, with the blocked-view retry over sides 1 5 2 3 4 (sweep radius 2.4, mask 3; the cutscene's own actor camera uses side | 0x1000 which skips the
  sweep from story node 8 on). Face frames restored, FOV restored (FUN_0040ccd8 / 0040cd1a), then the queued script starts (one deep, first request wins) or bars off,
  PEPPER_CONTROL &= ~0x100, near plane back to the zone's (DAT_0089df30 = DAT_0089df50; during a script 1.0 at the start, 2.0 every frame). The saved camera block is never
  restored. The camera is not put back for actors other than Pepper.
* `NS_CSM_ACTIVE` (var 7) is never written by the executable; "active" is DAT_05d47908 or the FUN_0045c456 override (`override` / `CutsceneHost.hold`).
  `DAT_05d47b10` (an extra end frame) is never set; `DAT_05d4831c` / `DAT_05d4dca0` / `dca4` are only read inside the CSM: not ported.
* Timers (+0xc delay, +0x10 duration, spline progress +0x40) are floats: the port rounds with `Math.fround` so tick counts match.

## 4. Approximations and what the port cannot know

* **ATTACH** hands parent / bone to the actor's carry node (handler table 0x8adf50, constructor **0x429d1b "Pizza"**: PIZ3, CNST, RHCP, BRIK, and PAPA / MAMA in era 3) through
  FUN_00429638. That node is not ported yet (WP5 / lead): the runner looks for a node with a `setParent(parent, bone)` method (`CarryNode`) and otherwise keeps a logical
  attachment (`runner.carried`) and moves the child with `carryMatrix` (no offset: the node's offset / scale come from its argument block) every runner tick; the zone loop
  should call `CutsceneHost.applyCarried()` every frame since the original keeps carrying after the script. The bone matrix is `AnimInstance.pose()` (assumed to be what
  FUN_0043bc58 returns; unverified).
* Records without an animation instance count as "clip ended" for SETANIM (the original always has one: it would crash otherwise). The port's island NPCs have none until
  their nodes / rigs exist (WP3); then SETANIM works unchanged.
* Records without a controller: SETVISIBILITY etc. work; ENABLEAI / ATTACH skip the controller part (the original would crash).
* Camera MOVEPOSITION to an actor (no script uses it) only logs.
* M3 zones (no waypoint system given to the runner) keep the M3 approximations: waypoint positions from `env.waypoint`, actor MOVEPOSITION a straight walk. The host now
  always gives the runner a waypoint system (its own CSM / PATH maps), so z40aPO also runs the faithful handlers (ogl02's waypoints are unambiguous).

## 5. Tests

* `m4-wp2-scripts`: all 62 island scripts (the slots of nodes 2 / 7 / 30 / 52 / 61) on the real island world: **62 / 62 run to their end** (0.0 s for the three empty
  ones, 4.7 s .. 225 s; LGI04 6763 ticks), **62 / 62 end with Shift held** (3..70 ticks). Checked every frame: no NaN; records move only through running SETPOSITION /
  MOVEPOSITION commands or carried attachments (y also through the ground snap); at the end the variables differ from the start exactly by the SETSWITCH writes in
  execution order, PEPPER_CONTROL / FOV / bars / near plane restored, the camera looks at Pepper + 3.2 from 20.4 away (all 59 non-empty scripts register Pepper).
  Commands approximated per script: none logged except lgibr07's unknown actor (faithful) and the fixture's stand-ins (`-v` lists them per script: Pepper's walker,
  NPC walkers for FOLLOW / MOVEPOSITION, MFIG animation instances for SETANIM actors). The long ones are Pepper's walks from the arrival point (the trigger would start
  the script near the target).
* `m4-wp2-commands` (66 checks): dictionary SETANIM + end test + duration + Shift, unknown animation name, SETSWITCH through both dictionaries, walker MOVEPOSITION (speed,
  arrival, AI off, lane restored, Pepper's end clip / camera), Shift walk-out, SETPOSITION re-pin, FOLLOW, null walker, all five camera sides (node 30, no sweep), camera
  FOLLOW / SETTARGET reset, eased moves with SETMOVESPEED, the B-spline at a knot, the actor track = record k at t = k / count, spline durations, SETEXPRESSION, mouth
  frames, face restore, SAYTEXT time, ATTACH fallback / NULL / carry-node hand-over, unknown actor, empty script lock and queued empty script, queue depth, menu start,
  hold, near plane, Shift on delays / speech, the end camera, the ground snap, every island SETANIM / SETSWITCH name resolves.
* `node tools/test-formats.mjs --only m4-wp2-scripts,m4-wp2-commands,m3-cutscene,cutscene -v`

## 6. For the lead (wiring)

* `new CutsceneHost(sh, world, archive, gr, hud, { waypoints, dictionaries: profile.island.dictionaries })` (or `host.setDictionaries(...)` later). Pass the global
  `waypoints` of src/game/walker.ts with the island maps loaded (the host loads PATH / CSM into it if missing) so the actors' walkers (`ctrl.walker`) are found.
* `declare` the slots of `IslandSetup.cutscenes` (`zone: 'z02LGI'`, `script: name`, `strings: messages`, `area: 'li'`); it also loads the `.man` files the scripts name.
* Pepper needs her walker: port FUN_0042207d in the zone game (create on PATH with node -3 and the tuning above, `pepper.ctrl.walker = h`), else her cutscene walks /
  turns are no-ops and the end-of-script camera / clip rule does not run (it is tied to the walker in the original).
* Call `host.applyCarried()` every frame (after the update pass) until the carry node is ported.
* `GameRecord.face` (new field) is the face / mouth frame for the renderer (FUN_0043f2f0).
