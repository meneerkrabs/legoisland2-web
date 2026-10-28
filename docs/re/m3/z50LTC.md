# z50LTC: the "Meet the team" cave (M3)

Easter egg room of the developers, zone table index 34 (`z50LTC`, kind 1 = hub loop). 26 minifigs of the development team stand around a lava cave; Pepper
walks up to one, presses Shift (the interact button, logical bit 0x40) and the minifig plays a talk animation while the name and the job of the developer are
shown between cinematic bars. Talking to three of them swaps the two halves of the team. A wormhole at the end of the cave leads back to the island.
It is reached from the island through the `WORM` wormhole while game variable `0xd` is non-zero (cheat code `SDREAMS`, architecture.md 7.1). The room is not part of the
story (node 71 of the FSM is `NS_OFF == 1`, never complete): nothing in it changes a story variable.

Code: `src/zones/z50LTC.ts` (zone game, `buildLtc` = the set-up on top of the extraction), `src/zones/z50LTC/people.ts` (people table, `PeopleNode`, `LtcPepSwitch`,
`LtcGlobals`; pure), `src/zones/z50LTC/portal.ts` (`PortalNode`, the box portal of StartCSM.c; pure). Test: `tools/tests/m3-z50LTC.mjs`. Browser: `tools/steps/m3-z50LTC.mjs`,
`tools/steps/m3-z50LTC-island.mjs`.

## 1. What the executable does (functions)

| address | function | role |
|---|---|---|
| 0x83942f | wrapper | opens `data\z50LTC.bob`, `FUN_00839c09` (set-up root), loop, tear down. `FUN_00435a07("adventur", "adv", 0)` is a stub returning 1: **the room plays no music** (no `ZONE_MUSIC` entry) |
| 0x838e41 | loop | the hub loop template (architecture.md 2.3): pause `FUN_0041bd3d(&mode, 0x80, 0)` (page 5, mask 0x80), modes 7 / 0 / 1 / 2 / 3 / 4 / 5 / 8; per frame `FUN_0045c402` + `FUN_0045c42d` (cutscene manager: no slots, `FUN_0045c310(0)`), `FUN_00839cbc` (HUD icon), `FUN_0046055f` (HUD). Leaves when var 5 != var 0x59 (exit 8). **No call of the story check `FUN_00423bad`**: entering the room mid-story must not move the player; the port's `Story.frame()` does nothing then either (it only acts when the current zone is the node's zone) |
| 0x839c09 / 0x8399da | set-up | `GENERICBITS` pool, fog `FUN_00442d90(4.0, 100, 800, 500, 0xffff /* cyan clear colour */, 1)`, gravity -10, ground record CAVE, `FUN_0042382c/004238b7(PEPP, 0xb)`, Pepper's chain: **pepswitc** (own copy, 0x83ab7b) @0, **SGwalk** @1 (gate var 0x5e & 1), skateboard node 0x43310c @2 (gate & 4: never active), `FUN_00839748`, camera `FUN_00422b50`, Pepper placed with `FUN_0043a5e4` (0, pi, 0) at (-4.684, 5.196, 114.424) heading 3.1415 (the same as the placement in the zone data, so the port needs no change) |
| 0x839748 | people set-up | x of record 28 (RICH) += 8.0; for every row of the people table: controller (flags 0x13), `People` node at position 0 (gate var 2), record flag 0x40 (NPC bound); records whose name starts with `G` and have no controller get the box of their `.col` (`FUN_004427e0`); sea level -800; the portal: record 53 PORC, controller flags 0x26, `FUN_0051ea3c` (StartCSM box portal) at position 0 with the block (16, 24, 16 half extents, target zone 2, spin + face flags 1, key mask 0) |
| 0x839560 | people sounds | 27 x `FUN_004433b0(sound id)` into `DAT_05d5f660[k]` (the ids are immediates in the code: the port scans them out of the executable, `readPersonSounds`) |
| 0x83a7d2 | `People` constructor (People.c) | node of 0xb8 bytes, vtable 0x95d990; creates the twinkle emitter `TWINKLE01.par` attached to the record at (0, 2, 0) and two `paul01` emitters (hands of Paul Scully), starts the idle clip, puts the minifig on the ground (`FUN_00441270(rec, pos, (0,-80,0), ..., mask 3, radius 1.0, skin 0)`) |
| 0x839e20 | People update | see 3 |
| 0x83a292 | People pre-render ("talk") | see 3 |
| 0x83ab7b / 0x83a9e0 / 0x83aa48 / 0x83aa8d | pepswitc | constructor (stores the creation position at +0x14..0x1c), update, pre-render, draw: see 4 |
| 0x51ea3c / 0x51e5ab | StartCSM portal | see 5 |
| 0x45f750 | `FUN_0045f750(mode)` | **the cinematic bars** (letterbox): `DAT_05d4dcbc = mode`, the HUD draws top + bottom bars of H / 30 per tick up to 0.21875 H (`Ui2D.letterbox`, `Hud.letterbox`); mode 0 = off. While the bars are on the normal HUD overlays are not drawn (`FUN_0046055f`) |
| 0x460003 | HUD text slots | four text slots (`DAT_05d4dd7c / 4de4c / 4df1c / 4dfec`); the room fills the third (name) and the fourth (job): font 0 (Balloon12, `data/fonts/csm/csm`), centred, x = 400 / 800 W, y = 494 / 600 H and 518 / 600 H, colour 0 (yellow) |
| 0x839cbc | HUD hint | var 0xc (interaction icons) -> overlay slot 0 texture 1..5 of `Overlays/z50LTC`; nothing in the room sets var 0xc (the portal's icon bits are 0, the people never set it), so **no icon is ever shown**. The corner icons / counters (var 0x12 as `%04d`) have texture index -1: not drawn |

## 2. The people table (0x95d2c0, 0x24 bytes per row, 26 rows, terminated by record -1)

Fields: `+0 cond`, `+4 record` (zone record index), `+8 name`, `+0xc job` (pointers to English strings in the executable, read at run time), `+0x10 idle clip` (s16, a
one-frame pose), `+0x12 talk clip` (s16), `+0x14 type` (s16), `+0x1c sound index`, `+0x20 Pepper's clip` (s16). All clips are chunk numbers of `MFIG.blk` (526 chunks, 17 bones).

* `cond`: -2 always present; -1 always present **and talking to this person swaps the two sets**; 0 / 1 present while `DAT_05d5f6dc` (the toggle, initially 0) has that value.
* `type`: 0 plain; 1 Paul Scully (two `paul01` particle emitters at the hand bones 0xe / 0x10 while he talks); 2 Andy Bray (his talk clip's frame > 32 starts Pepper's reaction clip 437, once); 3 / 4 / 5 the talk clip is played 2 / 3 / 4 times (the original's jump table at 0x83a721; Phil Hodgson is the only row with type 4 = 3 loops, no row has 3 or 5).
* `sound`: index into the 27 sound ids of `FUN_00839560` (300 = `SND_SILENCE`, nothing); the sound is played at Pepper's position when the talk starts (`FUN_004433f0`; the port plays it 2D).

| # | record | name | job | cond | type | idle | talk | Pepper | sound |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 12 PBAK | Paul Baker | Programmer | 0 | 0 | 120 | 119 | 120 | 314 SND_PEPP_KNOCK |
| 1 | 13 SCUL | Paul Scully | Programmer | 0 | 1 | 120 | 302 | 120 | 868 SND_BRICKIMAL_MOVE |
| 2 | 14 PHIL | Phil Hodgson | Programmer | 0 | 4 | 120 | 343 | 120 | 704 SND_TOY_CAHNGE |
| 3 | 15 ANDY | Andy Bray | Programmer | -2 | 2 | 120 | 12 | 437 | 180 SND_DSP_CACTUS |
| 4 | 16 MOSS | John Moss | Artist | 0 | 0 | 120 | 128 | 120 | silence |
| 5 | 18 ROYS | Roy Stewart | Artist | 0 | 0 | 120 | 130 | 120 | silence |
| 6 | 19 TOBY | Toby Harrison-Banfield | Artist | 0 | 0 | 120 | 116 | 120 | silence |
| 7 | 20 MATT | Matt Pearson | Artist | 0 | 0 | 120 | 133 | 120 | silence |
| 8 | 21 LARA | Lara Sweeney | Associate Producer | -1 | 0 | 120 | 123 | 120 | 96 SND_CROWD_BK_FALLEN |
| 9 | 22 RICK | Rich Carter | Artist | 0 | 0 | 120 | 126 | 120 | 120 SND_MONK_CHAT2 |
| 10 | 24 SEAN | Sean Parkinson | Programmer | -2 | 0 | 120 | 261 | 120 | 245 SND_FANFARE_SHORT |
| 11 | 25 JIMS | Jim Southworth | Lead Animator | -2 | 0 | 120 | 121 | 120 | 382 SND_LAUGH_6 |
| 12 | 27 JALE | Jalea Clements | Programmer | 0 | 0 | 120 | 210 | 120 | 182 SND_DSP_COW2 |
| 13 | 28 RICH | Rich Hancock | Associate Producer | -1 | 0 | 120 | 225 | 120 | 381 SND_LAUGH_5 |
| 14 | 29 STEV | Steve Hughes | Lead Programmer | 0 | 0 | 137 | 137 | 137 | 18 SND_BRONTY_BURP |
| 15 | 30 DARR | Darren Drabwell | Producer | -1 | 0 | 72 | 95 | 117 | 875 CSSND_MEET_DARKKNIGHT |
| 16 | 31 ROBB | Robert Carter | Lead Artist | 0 | 0 | 120 | 125 | 120 | 119 SND_MONK_CHAT3 |
| 17 | 26 ANDR | Andronikos Antonakakis | Artist | 1 | 0 | 120 | 131 | 120 | silence |
| 18 | 33 ADEY | Ade Smith | Programmer | 1 | 0 | 130 | 122 | 120 | 331 SND_KING_BUMP |
| 19 | 34 ALEX | Alex Comer | Programmer | 1 | 0 | 120 | 297 | 120 | 333 SND_SOLDIER_BUMP |
| 20 | 35 EDBR | Ed Bradley | Programmer | 1 | 0 | 120 | 217 | 121 | 380 SND_LAUGH_4 |
| 21 | 36 LARD | Gary Leonardi | Artist | 1 | 0 | 120 | 131 | 120 | 98 SND_CROWD_WIN |
| 22 | 37 IAIN | Ian Peaker | Artist | 1 | 0 | 120 | 148 | 120 | silence |
| 23 | 38 JEBB | Jeb | Programmer | 1 | 0 | 120 | 225 | 120 | 379 SND_LAUGH_3 |
| 24 | 39 DAVE | David Spencer | Programmer | 1 | 0 | 120 | 3 | 120 | 378 SND_LAUGH_2 |
| 25 | 40 SIMS | Simon Philips | Lead Artist | 1 | 0 | 120 | 147 | 120 | 377 SND_LAUGH_1 |

Records 17 (SOPH), 23 (JAME), 32 (SBRD) are in the zone data but not in the table: SOPH and JAME are hidden by the set-up, SBRD never appears. 3 + 3 (switchers) +
11 people of set 0, 9 of set 1: 17 are present at the start, 15 after a swap.

## 3. People: update `FUN_00839e20`, talk `FUN_0083a292`

Globals: `DAT_05d5f6dc` toggle, `DAT_05d5f6e0` timer (float, .bss 0), `DAT_009daa80` candidate record, `DAT_008ae330` candidate distance^2, `DAT_00983840` pressed buttons.
Node fields: +0x14 table row, +0x18 twinkle handle, +0x1c / +0x20 `paul01` handles, +0x24 pushed flag, +0x25 twinkle ticks, +0x28..0x30 saved position, +0x34 talk loops left, +0x36 reaction flag.
The update returns 0 (hidden half: the pre-render does not run), 2 (running), 1 (talking: stop the chain).

Update, per tick (asm-verified; the Ghidra output of this function has the two branches mixed up):

1. A person that was pushed back and whose controller distance^2 is > 4.3264 (0x8920c0) goes back to the saved place.
2. The twinkle counter (+0x25) counts down; at 0 the twinkle effect is stopped.
3. Not present (`cond >= 0 && cond != toggle`): if the record is visible and the timer is <= 0: hide it, start the twinkle, counter 3, **timer = 5.0**; return 0.
4. Present: if the record is hidden and the timer <= 0: show it, twinkle, counter 3, timer 5.0. The pepswitc pre-render takes 1 off the timer every tick, so **one person per 5 ticks appears / vanishes** (the first one in tick 1 after the zone starts: set 1 vanishes in ticks 1, 6, 11 ... 41).
5. Not talking: advance the minifig's clip by 1; if Shift went down this tick and `DAT_008ae330 > distance^2` the person becomes the candidate (`DAT_009daa80`, `DAT_008ae330 = distance^2`); return 2. The walk node (SGwalk 0x42d514) starts its update with `DAT_008ae330 = 576.0` (so the radius is 24 units) and the pepswitc draw hook resets it to 64 and the candidate to none; the nearest of several people wins.
6. Talking: advance the clip; each wrap (`FUN_0043b76a` != 0, also the wrap of a one-shot clip) takes one off the loop counter; type 2: frame > 32 and not yet done -> Pepper's clip 437; **Shift again or loops = 0 ends the talk**: idle clip, `cond == -1` toggles `DAT_05d5f6dc`, loops 0, candidate none, candidate distance -1.0, the text slots emptied, bars off (`FUN_0045f750(0)`), var 0x5e = 1, Pepper's clip 0x1b; return 2. Otherwise return 1.

Pre-render (`FUN_0083a292`, runs for people whose update returned non-zero):

1. The person turns to Pepper (yaw `atan2(dx, dz)` wrapped once into [-pi, pi]).
2. If Shift went down this tick and this person is the candidate: var 0x5e = 0x20 (talk: the walk node's gate fails, Pepper stands still); Pepper turns to the person (and `FUN_00429e00` aligns him to the ground slope: not ported); if the distance is < 1.28 (0x8920b8) the person is pushed back along its facing by the difference (saved place remembered on the first push); `FUN_0045f750(1)` (bars); name / job copied into the HUD text slots; the minifig's talk clip and Pepper's clip start (frame 0); loops = 1, or 2 / 3 / 4 for types 3 / 4 / 5; type 1 starts the `paul01` emitters; type 2 clears the reaction flag **and starts Pepper's clip 0x78** (overriding the clip just started: the reaction clip 437 follows at frame 32); the sound of the row plays.

Pepper's talk state is advanced by the zone's pepswitc (4). Pressing Shift also starts a talk with a person that is still waiting to appear (hidden, timer > 0): the original does that too.

## 4. pepswitc (own copy of PepSwitc.c, 0x83ab7b, vtable 0x95da00)

* update (`FUN_0083a9e0`, gate var 0x5e mask 0): var 0x5e != 0x20 -> return 2 (the walk node runs after it); == 0x20 -> advance Pepper's clip by 1, on a wrap start clip 0x78 (one-frame hold pose), return 1.
* pre-render (`FUN_0083aa48`): `if (timer >= 0) timer -= dt`.
* draw (`FUN_0083aa8d`): if Pepper's y < -80 (0x8920bc) he is put back at the position stored by the constructor (the placement); then `DAT_008ae330 = 64`, `DAT_009daa80 = 0`. The port's renderer does not call node draw hooks: the zone game calls `LtcPepSwitch.draw` after every tick (`ZoneGame.update`).

The port removes the stub safety net node (`StubGuard`) of `setupZone` from Pepper's chain for this zone: pepswitc is the zone's own guard.

## 5. The wormhole (PORC, record 53) = StartCSM box portal (`FUN_0051ea3c` / update `FUN_0051e5ab`)

Argument block (words stored by `FUN_00839748`): half extents (16, 24, 16), target zone 2, flags `spin` and `face camera` = 1, key mask 0, icon bits 0, var / bits 0 / 0.
Node: +0x20 radius^2 = 16^2 + 24^2 + 16^2 + 16 (0x8921f4) = 1104, +0x3c previous distance^2 (-1), +0x40 age.
Per tick: age += dt; `spin`: rx += 0.0087266 (0x892590), `face camera`: ry = atan2(rec.x - cam.x, rec.z - cam.z) + pi / 2 and the matrix is rebuilt from (rx, ry, rz); if the controller distance^2 < radius^2: with
key mask 0 the portal only reacts while the player **gets nearer** (distance^2 < the previous one; otherwise the previous value is just updated), after 30 ticks (`ARM_TICKS`) and inside the box
(|dx| <= 16, |dy| <= 24, |dz| <= 16 to the player) it writes **var 5 = 2** (and ORs the icon bits into var 0xc / the var bits, both 0 here); outside the radius the previous distance resets to -1.
The update returns 0 on every path (the node never counts as having run: no hooks). Var 5 != var 0x59 makes the loop fade out and return the zone in var 5 (the island). The portal is below the floor edge of the cave's far end (y = -9.9, x -3.7, z 155.7), so Pepper triggers it by walking to the end of the tunnel (z about 140): the cyan area seen
there is the clear colour (the zone's fog colour, argument 0xffff of `FUN_00442d90`).

`PortalNode` (portal.ts) keeps every field of the original block so the island's portals (`PORS`, `PORA`, `WORM`) can reuse it (`table` > 0 = the table variant with `DAT_05d58688` is not ported).

## 6. Game variables

| var | use |
|---|---|
| 0x5e PEPPER_CONTROL | 1 walking; 0x20 talking (written by the people, `PC.TALK`); the skateboard bit 4 is never set |
| 5 NS_NEXT_SUBGAME | written 2 by the portal; read by the loop (exit 8) |
| 0x59 CURRENT_SUBGAME | 34 in the room |
| 0xc INTERACT_ICONS | cleared every frame by `FUN_00839cbc`; nothing sets it in this room |
| 0xd | cheat code `SDREAMS` (`FUN_004375a8`): enables the island's WORM wormhole to this room; **not ported (M4)** |
| 0x58 story node | not touched; `?zone=z50LTC` jumps to the first node of zone 34 (node 71) |

Process globals the room keeps between visits (never reset by the original): `DAT_05d5f6dc` (which half of the team is present) is kept in `persisted.toggle`.

## 7. What the port does differently / does not do

* **Particles are not drawn.** The twinkle (`TWINKLE01.par` at 2 units above the head: sphere emitter, 30 particles, 0.75 s, white-grey sprite 0 of `GENERICBITS/Particle/Text000.tga`, additive material 1) and Paul Scully's `paul01` hand emitters need the particle engine (rendering.md 8, not implemented yet). The logic runs: `LtcGlobals.onTwinkle(record, start)` / `onPaul(record, start)` are called at the places where the original starts and stops the emitters (twinkle: when a person appears or vanishes, stopped 3 ticks later), so the particle milestone only has to attach.
* Sounds play 2D (by sound-table id) instead of 3D at Pepper's position; the first play of an id is dropped by the audio host (it loads the sample), so the port primes the 27 ids when the zone starts (silent) and the sounds are heard from the first talk on.
* `FUN_00429e00` (align Pepper's matrix to the slope under his feet when he turns to the person) is not called; he turns by yaw only.
* The update return values: `People` returns what the asm returns (0 / 1 / 2) and the port's controller passes (NODE_NONE / NODE_STOP / NODE_CONTINUE) are the same codes, so the hidden half does not turn or talk.
* Mode 1 of the loop waits for any button in the original (`DAT_00983840 != 0`), like the island's loop; the shell's hub template skips it, as it does for the island.
* Talking while Pepper is in the air freezes him there for the talk (the walk node is gated off), as the original does.

## 8. Tests and how to run

`node tools/test-formats.mjs --only m3-z50LTC` (76 checks): the table (26 rows, names, jobs, sets, types, records), the 27 sound ids against the executable's code and the sound table, set-up (26 People nodes with controller flags 0x13 / flag 0x40 / idle clip, pepswitc @0 + SGwalk @1, portal on record 53 with flags 0x26, no skipped attaches, people on the ground, x of RICH + 8, sea / gravity), the vanish order (first in tick 1, then every 5 ticks), the twinkle hook (start / stop 3 ticks later), the talk with scripted Shift presses (candidate, var 0x5e, bars, name / job text, clips, sound 314, facing, no walking, end after the clip, second Shift, out of range), loops (Phil 3 x 60 frames), Andy's reaction (clip 0x78 then 437 after frame 32), Lara swapping the sets (set 1 shows up, the toggle survives into the next visit), push back and return (1.28 / 2.08), the fall guard (y < -80), the portal (not armed for 30 ticks, a stationary player does not fire, approaching does, above the box nothing), collision with a person, 200 ticks of walking.

Browser (headless, muted; the dev server on 5499 may reload the page when other agents edit files, a second server without HMR is more stable: `vite --config <cfg with server.hmr=false, watch=null> --port 5497`):

```
node tools/browse.mjs "http://localhost:5499/?zone=z50LTC&mute=1" tools/steps/m3-z50LTC.mjs --size 1280x800 --out /tmp/m3/z50LTC
node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=5&mute=1" tools/steps/m3-z50LTC-island.mjs --size 1280x800 --out /tmp/m3/z50LTC
```

The first plays the room with real key input (walk, Shift talk with Paul Baker, Phil Hodgson skipped with a second Shift, Lara Sweeney swapping the sets, pause menu page 5, walk into PORC = back on the island); the second enters the room from the island the way the wormhole does (var 5 = 34) with the story at node 5 and returns through PORC (story unchanged, the island arrival is the default skate-park place: `FUN_004c2d22` has no case for previous zone 34).

## Shortcuts

* `?zone=z50LTC` (also `?zone=z50LTC&node=71`): starts in the room (zone name or archive; the story node of zone 34 is 71). `window.__zone.game.debug()` gives toggle, timer, candidate, talking people, visible people, portal state.
* Walk to a person and press **Shift** (the interact button); Shift again skips; Esc = pause menu (page 5).
* The way out: walk to the far end of the cave (z about 140 from the start at z 114, in the direction of the camera).

## For the island work (M4)

* The island's `WORM` portal (-409, 129, -98, `FUN_0052bc9b` activates the portals from story node 0x35) must write var 5 = 34 only while var 0xd != 0; `SDREAMS` (6 scan codes at 0x8aed70, handler `FUN_004375a8`) must set var 0xd. Neither exists in the port yet. Entering the room does not touch the story; leaving writes var 5 = 2 and the island starts the player at its default place (SKTP), the same as after any other zone without a case in `FUN_004c2d22`.
* `PortalNode` (`src/zones/z50LTC/portal.ts`) is the box portal for `FUN_0051ea3c`; `registerCtor(0x51ea3c, ...)` is left to the island because the argument block is built in each zone's own code (the extraction cannot read it: `attach.arg` is null).
* The extraction does not see the dynamic attaches of this zone (the people loop of `FUN_00839748`): `buildLtc` rebuilds them from the table at 0x95d2c0 (`dynamic: { attach: 1 }` in `ZoneSetup`).
