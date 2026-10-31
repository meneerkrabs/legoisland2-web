# M6 progress log (remaining mini-games)

> **Historical log.** The "Open" / "not ported" remarks below are the state of the day they were written; the particle runtime, music start, RNG, gamepad (analogue values are always 0 in the original), rumble (empty function), saves of node state, the decor / outfit swap of the hubs and the other items were closed later: `docs/re/gaps.md` and the zone docs carry the current state.


One section per zone (status, what's next). Brief for workers: [worker-brief.md](worker-brief.md).

Zones: z15SSH, z21FSH, z27TRX, z20DSP (+ Replay.c), z09JST, z10RGB, z08BKD, z28HAT, z22BIP, z18MMP, z01BPK, z42BRP.

## z01BPK (skate park)

Status: playable end to end. Zone loop (intro BPK2, walk to the board, 2:00 clock, banner, result menus 16 / 19, pause 18, retry / abort / continue), the zone's three behaviours
(clock + score node, walk-in, skateboard with the CURRENT_SUBGAME == 1 branches: half-pipes, arena walls, 20 stunts, landing judgement), spectators, stunt-name text, HUD, wheels sound,
trophy / hi-score (0x8d / 0xc0). Doc: [z01BPK.md](z01BPK.md). Tests: `m6-z01BPK` (443 checks incl. a full-length WIN bot and a LOSS), browser steps `tools/steps/m6-z01BPK.mjs` /
`m6-z01BPK-loss.mjs`. Open: music starts at zone entry (the board record is excluded from the board's own sweeps exactly like the original: header-only .col; the pad's analogue values are always 0 in the original, input.md).
Shared-file edits: `src/zones/index.ts` (import), `src/shell/zonegame.ts` (`skipBanner?()`), `src/shell/playzone.ts` (one line: `skipBanner` leaves the banner like a button).

## z27TRX (T-Rex Racing)
Done: full port (rex node, probes, props, clock / arrival / score / medals, HUD, banner, sounds, speech, camera, gate), 125-check node test, bot, browser win + loss runs. See [z27TRX.md](z27TRX.md).

## z15SSH (Slangen schieten / coconut buggy)

Status: playable end to end. Zone loop (intro ADSGSS14, help of 5 lines, ride, pause 18, banner with the medal and the ADSGSS lines, result menus 16 / 19, retry / abort / continue -> z16PYA node 36), the buggy that rides the CARBUT path by itself
(path objects `FUN_004476b0` / `00447550` / `00447bf0` ported and checked against the original's code in the x86 emulator), turret aiming + crosshair, coconuts (reload, flight, hit sphere), the three snakes (spawn, run, leap, theft, hit),
the crew, the Brickbot carts, camera, engine / skid / stage sounds, speech, HUD (gem count, score), HISCORE_SSH / TROPHY_SSH. Doc: [z15SSH.md](z15SSH.md). Tests: `m6-z15SSH` (257 checks incl. a scripted LOSS, WIN bots and bronze / silver runs),
browser steps `tools/steps/m6-z15SSH.mjs` (win, real key presses) / `m6-z15SSH-loss.mjs` (loss, pause, retry, abort). Open: the dust particles at the wheels are not drawn, music starts at zone entry, the focus record's blob shadow is switched off for the ride.
Shared-file edits: `src/zones/index.ts` (import), `src/game/render.ts` (`GameRenderer.poseRange`, default unchanged).

## z28HAT (hot-air balloon)

Status: playable end to end. Zone loop (intro cutscene ADV08 at the first start, brief ADSGMC19, help of 5 lines, flight, pause 18, banner with medal / ADSGMC01-05, outro cutscene ADV09 before the result menu when a medal was earned, result menus 16 / 19,
retry / abort / continue -> story node 50), all ten behaviour nodes of the zone (balloon flight + knock-back + camera + music fade, winch hook, six big dinosaurs, five babies, Bronty / Mr Hates state machine with the pizza path, fireball, three sandbags,
pterodactyl, Pepper in the basket), HUD (score, dinosaurs left, sandbag icon), the winch rope, 22 sounds, HISCORE_HAT 0x4a / TROPHY_HAT 0x9d. Doc: [z28HAT.md](z28HAT.md). Tests: `m6-z28HAT` (340 checks incl. a scripted WIN bot and a LOSS),
browser steps `tools/steps/m6-z28HAT.mjs` (win with real key presses, ~5 min) / `m6-z28HAT-loss.mjs` (pause, loss, retry, restart, abort). Open: the fireball is drawn as three flame sheets instead of the original's particle emitter (no particle system),
the dinosaurs' 3D sound positions are the true ones (the original's pointer is one float off), the analogue stick branch never fires and rumble is an empty function in the original (not gaps).
Shared-file edits: `src/zones/index.ts` (import), `src/shell/zonegame.ts` (`resultHold?` / `resultTick?`), `src/shell/playzone.ts` (mode 5 calls them).

## z22BIP (jungle biplane)

Status: playable end to end. Zone loop (intro ADSGBI15, help of 5 lines, take-off, flight along the course behind Johnny, pause 18, banner with BRONS / ZILVER / GOUD and the ADSGBI lines, result menus 16 / 19, retry / abort / continue -> story node 47),
all nodes of the zone ported (flight with banana cannon / fuel / crash, Takeoff, Landing, Recover, Johnny, 16 monkeys with melons, 5 rock monsters with stones, rope targets, props, fuel cans, river, propellers), the path object, HUD (ammo, score, fuel %, gauge), sounds, speech,
HISCORE_BIP 0x27 / TROPHY_BIP 0xd6. Doc: [z22BIP.md](z22BIP.md). Tests: `m6-z22BIP` (~400 000 checks: the original's node code run in the x86 interpreter next to the port, tick by tick; whole flights incl. a scripted WIN (lands, bronze) and a passive LOSS),
browser steps `tools/steps/m6-z22BIP.mjs` (`BIP_RUN=win` with real key presses, ~2 min; `loss`: banner, menu 19, retry). Open: no particles (palm leaves, waterfall spray), music starts at zone entry, the monkeys' / stones' draw scale is baked into helper records.
Shared-file edits: `src/zones/index.ts` (one import line) only.

## z10RGB (cannon duel at the Bull castle)

Status: playable end to end. Zone loop (intro `HOLOA`, help of 11 lines, play with the phase machine bridge -> cannons, pause 18, win banner with the medal and `CASGRB01..04`, loss banner `CASGRB05`, result menus 16 / 19, retry / abort / continue -> z07CSI node 27), all five
behaviour nodes ported from the decompile: `PepSwitc` (bridge fall rule, entering / aiming / firing / leaving the four cannons, camera of sub-game 9), `PeppHit` (knock-up, blinking), `rgbgame` (phases, score, results, flags), the nine enemy `cannon`s (phase 1 volleys, Cedric's shots) and `cedric` (hops
between the cannons on a parabola), the ten-ball pool, HUD gauge + barrel overlay, 2D / 3D sounds, speech, HISCORE_RGB 0x3b / TROPHY_RGB 0x23. Doc: [z10RGB.md](z10RGB.md). Tests: `m6-z10RGB` (381 checks incl. a scripted WIN bot (silver) and a LOSS) and `m6-z10RGB-emu` (the original's code in the x86 interpreter next to the port: 9.3 million comparisons, 0 differences), browser steps `tools/steps/m6-z10RGB.mjs`
(win, real key presses, rest of the cannons removed through the page unless `NOSHORT=1`) / `m6-z10RGB-loss.mjs` (pause, loss, retry). Open: no particle runtime (muzzle smoke, splashes, dust), ball shadows and the underwater plane are not drawn, analog aim axes always 0 in the original / rumble an empty function, music starts at zone entry.
Shared-file edits: `src/zones/index.ts` (one import line) only.

## z20DSP (Desert Speedster race / time trial)

Status: playable end to end. Zone loop (intro, help, countdown, race along the car1.man spline with the Speedster, pickups, hazards, finish autopilot, banner with medal and time score, result menus 16 / 19, pause 18, retry / abort / continue),
Speedster FUN_006c2627, props (falling rocks, turbo, Bertha, Spin, saucers, cones, whirlwind, WalkRock), spline, camera, scoring 6c6d57, Replay.c recorder (6f3270) as ReplayBuffer. Doc: [z20DSP.md](z20DSP.md).
Tests: `m6-z20DSP` (314 checks incl. the spline / replay / Speedster / props compared with the original's code in the x86 emulator), browser steps `tools/steps/m6-z20DSP.mjs` (win) / `m6-z20DSP-loss.mjs` (loss, retry, pause, abort).
Open: no particles (dust, sparks), the analog axis is always 0 in the original, win bot teleports to 92 % of the track, music starts at zone entry, one prop-oracle run (start 0.7, seed 3) diverges by about 1e-3 after 777 ticks.
Shared-file edits: `src/zones/index.ts` (import), `src/shell/zonegame.ts` (`everyTick?`), `src/shell/playzone.ts` (calls it), `src/game/render.ts` (`poseRange`).

## z18MMP (mummy tomb)

Status: playable end to end. Zone loop (intro ADSGMM18, help of 5 lines, memory match of 6 pairs on 12 coffins, key, door, corridor with pillars / spiders / rats, page, boulder chase, gate, pause 18, banner with the medal and ADSGMM lines, result menus 16 / 19, retry / abort / continue -> z16PYA node 40).
All nodes ported from the decompile (Pepper / puzzle FUN_006a4fd0, coffin 6aadf6, camera, mummy, key, page, rock, pillar, torch, spider, rat, Walk 6a81f6). HISCORE 0x14 / TROPHY 0x48. Doc: [z18MMP.md](z18MMP.md).
Tests: `m6-z18MMP` (1913 checks incl. smart-bot wins, careless bot, idle loss) and `m6-z18MMP-emu` (~2.3 M checks: the original's node code run in the x86 interpreter next to the port); browser steps `tools/steps/m6-z18MMP.mjs` (win, real keys, ~3 min; `MMP_LOSS=1`: pause, loss, menu 19, retry).
Open: no particles (torch flames, twinkles, smoke, dust), specular flags not ported.
Shared-file edits: `src/zones/index.ts` (one import line) only.

## z21FSH (Fishing)

Status: playable end to end. Opening cutscene ADV04, brief ADSGFI14, help of 4 lines, walk to one of 8 spots, aim, cast with power meter, bite / strike / reel / tension fight, shoal of 15 fish + Big Bertha, score panel, end cutscene ADV11, result menus 16 / 19, retry / abort / continue (-> node 45). Doc: [z21FSH.md](z21FSH.md).
Tests: `m6-z21FSH` (199 checks incl. scripted WIN, LOSS, natural bite), browser steps `tools/steps/m6-z21FSH.mjs` (win) / `m6-z21FSH-loss.mjs`. Open: no particles, no x86 differential test, fisherman talk needs the island context.
Shared-file edits: `src/zones/index.ts` (import), `src/shell/loopmachine.ts` (`skipBanner`), `src/render/renderer.ts` (`drawLine`).

## z09JST (jousting duel against the Dark Knight)

Status: playable end to end. Zone loop (intro `CASGJO13`, help of 7 lines, bugle, charge, ride, aim, pause 18, round popups, end panel in the banner mode, result menus 16 / 19, retry / abort / continue -> z07CSI node 24), the duel node `JSTGame` ported from the decompile (all 36 states of `FUN_005ce506`:
charge by alternate LEFT / RIGHT, release, too-slow throw, ride with the wobbling aim point, hit / hurt / glance with 4 reactions each, rounds to 3 points, medals, `CASGJO01..13` speech, HISCORE_JST 0x18 / TROPHY_JST 0xcb), mfigman (horse + saddle + cloak + knight groups), the 16 camera modes incl. the B-spline fly-in, spectators / flags / bugle players,
lance and shield attachments, HUD (two counters, score, charge gauge), the aim marker, 43 sounds. No PEPP record: own player objects. Doc: [z09JST.md](z09JST.md). Tests: `m6-z09JST` (328 checks incl. scripted WIN / LOSS / GLANCE / TOO-SLOW matches) and `m6-z09JST-emu` (**the original's duel code run in the x86 interpreter next to the port: 13.5 million comparisons, 0 differences**: node state,
records, animations, camera, every sound / speech / gear call, the popup texts), browser steps `tools/steps/m6-z09JST.mjs` (win, loss, retry, abort with real key presses) / `m6-z09JST-look.mjs`. Open: no particles (landing explosion, hoof mud), the aim marker is laid out on the 640 x 480 grid (the original used raw back-buffer pixels) and sits on bone 16 of the dark knight (inferred from the draw order), analogue stick not read, no music (the zone has none).
Shared-file edits: `src/zones/index.ts` (one import line) only.

## z42BRP (Brickster's palace, final boss)

Status: playable end to end. Intro OGSGBP34, help (mode 9), side run up the tower (pepbrp, sliders, switches, crumbling bridge, lift), second help (mode 10, world frozen), roof with pizzas, Brickster (3 hits), bots, collapsing floor, end cutscene BRP01, banner with clock score and medal, result menu 16, OutroFMV + credits -> island node 68, pause 18 (restart / abort -> z40OGL node 66). Doc: [z42BRP.md](z42BRP.md).
Tests: `m6-z42BRP` (257 checks incl. EXE tables, scripted WIN 1280 ticks / score 10000, LOSS, snapshot/restore); browser steps `tools/steps/m6-z42BRP.mjs` (win) / `m6-z42BRP-loss.mjs` (fall, restart, abort) / `m6-z42BRP-look.mjs`.
Open: no particles, music starts at zone entry, widened switch-2 trigger for the fixed 30 Hz step.
Shared-file edits: `src/zones/index.ts` (import), `src/shell/loopmachine.ts` (`help2` input, `MODE.HELP2` handling), `src/shell/zonegame.ts` (`wantsHelp2?`, `onHelp2End?`), `src/shell/playzone.ts` (passes `help2`, calls `onHelp2End`).

## z08BKD (Brick Dive)

Status: playable end to end. Zone loop (brief CASGBD13 / 14, help of 5 lines, dive, pause 18, banner with score + medal and the CASGBD lines, result menus 16 / 19, retry / abort / continue), all twelve constructors of the zone (diver + camera with the zone's own player object, five bricks with the 4 s rule,
page, anchor, cannon + ten balls, clam, octopus with the tentacle, three pirates, shark / two swordfish / six mantas on the waypoint loops, dolphin), hurt zones, oxygen clock / score / medals, HUD (five brick icons, page icon, 12-segment oxygen gauge), 26 sounds with the diver as listener, HISCORE 0x2f / TROPHY 0x3d.
Doc: [z08BKD.md](z08BKD.md). Tests: `m6-z08BKD` (278 checks incl. EXE constants, scripted LOSS and a bot WIN with all five bricks, 12224 ticks), browser steps `tools/steps/m6-z08BKD.mjs` (win, the bot's keys as DOM key events from the page loop, ~14 min wall) / `m6-z08BKD-loss.mjs` (loss, pause, retry, abort).
Open: no bubble particles, music starts at zone entry, no matrix lag.
Shared-file edits: `src/zones/index.ts` (import), `src/game/render.ts` (`GameRenderer.setAttach`), `src/shell/hud.ts` (`HudGauge.tint`).

## Lead summary (2026-10-29)
All 12 zones ported and playable (tests + headless bots win/loss per zone). Lead checks: `npx tsc` clean, `npx vite build` ok, `node tools/test-formats.mjs` all ok (zonesetup: the bare stub tick of z08BKD/z18MMP/z20DSP/z21FSH is skipped, their nodes need the zone game's prepare step; four early-return guards added). z22BIP browser win + loss re-run after the final fixes: ok.
