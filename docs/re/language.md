# Language: the English edition as a language pack

The port's code and every verified address belong to the **Dutch** executable (`LEGO eiland 2.exe`). The option **Taal / Language** ("Nederlands" = default, "English") keeps that
executable and lays the English edition's language files over the Dutch game under the Dutch names (`src/lang/`). With "Nederlands" nothing is wrapped and nothing changes: `applyLanguage`
(`src/main.ts`) returns the files as they are, and `tools/tests/lang-en.mjs` checks that the Dutch tables / archives are byte for byte what they were.

## 1. The two discs compared (member by member)

English disc: archive.org item `LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng`, file `LegoIsland2-Windows.iso` (445 495 296 bytes, md5 `09e8b4d3b3a9c472e2177a61e92f1e41`, cabinet
`data1.hdr` 325 891 / `data1.cab` 443 824 / `data2.cab` 339 088 630 bytes, dated 2001-03-04; the Dutch cabinet is 316 414 / 444 906 / 341 851 148, mastered 2003). Layout: the same InstallShield
cabinet (`LEGO Island 2/data1.hdr` + `data1.cab` + `data2.cab`), group `Game` = the installed folder, plus `Movies/*.mpg` as plain files on the disc. `src/engine/installshield.ts` reads it
unchanged (`node tools/test-installshield.mjs "<cab dir>" <unshield output>`: 3137 files identical to unshield's output, 0 md5 differences). Compared with `tools/research/lang-compare.mjs`
(cabinet against cabinet, md5 of every member, group `Game`: Dutch 3029 files, English 3126):

| | files | note |
|---|---:|---|
| identical in both | 1322 | all 29 zone archives, `Bricks`, `BrickMorph`, `GENERICBITS`, `Overlays`, `menu`, `SwapText`, `Shadow` (74 `.bod`/`.bob` files), 1210 of the 1211 other sounds (music, ambience, effects, `SILENCE.WAV`), 38 small files (`GameSetup.txt`, ...) |
| differ | 5 | `_data/messages.bod`+`.bob`, `_data/Fonts.bod`+`.bob`, `_data/sounds/z07CSI/cedric defeat.wav` (a voice) |
| English only | 6 | `LEGO Island 2.exe`, `Readme.txt`, `Photos/Photos.txt`, and three files the disc shipped after a test run: `_data/Settings.set` (92 B), `_data/sw.dat` (880 B), `_data/SaveDef.lgo` (334 988 B); the port writes its own |
| Dutch only | 3 | `LEGO eiland 2.exe`, `LeesMij.txt`, `Fotos/Fotos.txt` |
| speech `.mp3` | EN 1793 (34 344 968 B) / NL 1698 (37 178 712 B) | by name (case-insensitive): 1677 in both (all differ in content), 116 English only, 21 Dutch only; plus `speech/dutch.txt` (empty marker) |

The four movies (`IntroFmv`, `LegoSoftware`, `outroFmv`, `SdLogo`; 21 997 572 / 6 502 404 / 23 234 564 / 6 021 124 bytes) are **byte-identical** (md5) on both discs: the movies carry
no language. So the zones' meshes / away / collision / waypoints / cutscene scripts / textures (also the menu and `Overlays` pictures: **no baked language-specific text exists**, whatever
words a picture shows are the same in both editions) are the same data.

### The message tables (`messages.bod/.bob`)

Dutch: `<AREA>/Data/<NAME>.str` (`FE` 6, `LI` 92, `CI` 24, `AI` 31, `OG` 11 = 164 tables + the empty marker `Dutch.txt`). English: `<area>/English/<NAME>.str` (176 tables: 36 `ai`, 25 `ci`,
7 `fe`, 96 `li`, 12 `og`) and, next to it, `Danish/`, `French/`, `German/` folders (text only; this disc has speech for English only). The English executable carries the strings
`_data/messages/AI/English/...` where the Dutch one has `.../AI/Data/...` (and `_data\English.bmp` for `_data\Data.bmp`, a file neither disc has): the language is a folder name, the code
is the same engine (`.text` 0x486000 against 0x491000 bytes: a different build, so addresses differ: the speech table is at VA 0x968148 there, 0x979098 in the Dutch EXE).

* 164 tables exist in both: 162 have exactly the same tags, `FE/FRONTEND.str` (the English one lacks 28: the key names `SPACE`, `ENTER`, `PAGEUP` ..., `ACTION`, `SET`, `HISCORE`, `EndGame3M0_1/2`)
  and `FE/STD.str` (no `PHOTOS`: the English executable has the folder name `Photos` literally) have fewer. A missing tag answers with its own id (FUN_00439788), so the English game
  shows `SPACE` / `ACTION` - and so does the port in English (the same lookup, the same result); only `PHOTOS` (the port saves photos as downloads: `src/shell/screenshot.ts`) is not used.
* The voice field of each line is an index of the speech table: it is the same in all 2370 lines but 3 (`CSIFSM4.str UNUSED`, `LIHOL6/9.str HOLOA`: the duplicates the Dutch build shadows).
* The 12 English-only tables (`ADVFSM0/6/7/9/10`, `CSIFSM7`, `fe/WAS`, `LI/FRONTEND`, `LGI04PSX`, `LIFSM16`, `LI/STD`, `OGLFSM1`) are referenced by neither executable (no such string in either): unreachable.
* Every voiced line of the 164 shared tables has its clip in English (1750 of 1755 voiced lines of the English folder, the five others are those unreferenced tables; the Dutch tables miss 4).

### The speech table

`readExeSpeechTable` of the Dutch EXE (VA 0x979098) and the table of the English EXE (VA 0x968148): 1732 entries each, **identical except three**: index 1631 / 1633 / 1635 are `MAN_1b` /
`MAN_2b` / `MAN_3b` in the Dutch EXE and `MAN_1c` / `MAN_2c` / `MAN_3c` in the English one (the English disc has `MAN_1c.mp3` ...). `EN_PACK.speechAliases` maps the three Dutch ids to the
English files. The English clips cover all 1732 ids (1635 distinct ids; the Dutch ones cover 1631 distinct ids).

### The fonts

`Balloon12/24.fnt` + `.tga`: the English fonts have 114 glyphs each, the Dutch ones 124 / 119: the Dutch font has `# $ < = > [ ] { } °` extra; no table of either edition uses them
(English text has no byte above 0x7e but 0x92, the apostrophe, which both fonts map). The English fonts are used (faithful to the English edition).

## 2. Design: a language pack over the Dutch game

* `src/lang/pack.ts` (pure, node-testable): `EN_PACK` (item, folder name `English`, the three speech aliases, the members), `packRedirects` (the pack's files under their Dutch names:
  `_data/sounds/speech/English/X.mp3` -> `_data/sounds/speech/Data/X.mp3`, `messages.bod/.bob`, `Fonts.bod/.bob`, `cedric defeat.wav`), `renameLanguageDir` (the English `messages.bod` has
  its `English` folder names overwritten in place with `Data`: the names are NUL-terminated strings in front of the records, "Data" is shorter, so no offset changes; every path the
  Dutch tables and `src/ui/strings.ts` ask for, `FE/Data/FRONTEND.str`, `LI/Data/lifsm3.str`, ..., then resolves), and `LanguageFiles implements GameFiles` (list / has / size / read /
  loaded / ready answer in the Dutch layout; **Dutch speech clips the pack does not have are hidden** - no Dutch voice in an English game; the movies and the executable are the base's).
* `src/lang/source.ts`: where the pack's files come from, in this order: (1) an English CD folder / installed folder picked this session, (2) an English ISO added to the browser
  (`isos/le2-en.iso`, OPFS), (3) `public/data/le2-en` (dev server only, `vite.config.ts` lists it at `/__le2/manifest-en.json`), (4) **archive.org through the range relay**: the same
  mechanism as the Dutch ISO (`HttpRangeSource` + `CachedSource` in Cache Storage, `IsoVfs`, `InstallShieldCab`): the disc's directory (at the end of the ISO) and the cabinet header are read, then only the
  pack's members are fetched, on demand: messages + fonts ~0.3 MB at once (compressed 0.2 MB), the speech as the game asks for it (all 1793 clips are 31.9 MB compressed and contiguous in
  the cabinet: neighbours become one request); a start that hears the whole opening needs about 7 MB. The first clips of a new game (`LECSIN01..03`) are fetched ahead (`langWarmPaths`).
  **Never blocks play**: `openLanguage` has a 30 s limit; on any failure (no relay, relay not whitelisted, wrong file) the Dutch files play on and a notice says why (tested with a dead relay: the game
  starts in Dutch after ~6.5 s of retries with the notice "English niet beschikbaar (...)").
* `library.ts addIso`: an ISO whose cabinet has `sounds/speech/English` is kept as `isos/le2-en.iso` (the language), not as the game; `main.ts`: an English CD folder (`LEGO Island 2.exe`)
  is kept in memory for the session; the start screen's "Taal / Language" select + note says where the English comes from; `?lang=nl|en` overrides the stored choice, `?langsource=archive` skips the
  local routes (tests of the relay).
* Port-wide switches: `src/lang/state.ts` (`activeLanguage()`), `display.ts` pref `lang`; the page title is the English edition's title in English.

### Relay (nginx) and the PHP proxy

`tools/proxy/nginx/le2-proxy.conf`, map `$le2_ia_path`: add

```
    "~^/ia(?<le2p>/LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng/LegoIsland2-Windows\.iso)(\?.*)?$" $le2p;
```

(the app asks `https://le2.143-47-181-190.sslip.io/ia/LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng/LegoIsland2-Windows.iso` with `Range`; archive.org answers `206`, `Content-Range: bytes 0-99/445495296`
- checked directly). `le2-cors-proxy.php` allows the same item. `tools/proxy/local-range-relay.mjs` is a local stand-in for tests.

## 3. What does not carry over / Dutch only

* **"Herstelde inhoud"** (restored content) is switched off in English (`restoredOn()`): its subtitles are Dutch transcripts of Dutch clips (`src/restore/lines.nl.ts`), and its tags/orphan
  ids belong to the Dutch speech set. The start screen says so.
* The port's own interface stays Dutch: the start screen, notices, loading status lines, the movie skip hint, the touch buttons' labels, the developer corner's transcripts. (The game's own texts - menus, loading card,
  subtitles, help screens, credits, level names - all come from the tables and are English.)
* The code is the Dutch executable's: the logic of the English executable (a different build) is not ported; the texts, fonts, voices and the one voice sound are the English edition's.
* A missing tag answers with its id (`SPACE`, `ACTION` in the controls page): as in the English game; `CONTROL4` on a help screen is the echo of a line that does not exist, in both languages.

## 4. Tests

* `node tools/test-formats.mjs --only lang-en` (`tools/tests/lang-en.mjs`; the English Game folder: `LE2_EN_DIR`, default `public/data/le2-en`): the redirects (1801 = 1793 clips + 3 aliases + 5 members),
  only language members replaced, the renamed archive contains every Dutch `.str` path, tags / voice fields as in section 1, the speech table of the Dutch EXE resolves in English for all 1732 ids, the Dutch side
  unchanged (the Dutch directory has no `English` folder: the rename is the identity; the base's files come back byte for byte).
* Headless (`sh tools/m5-botslot.sh node tools/browse.mjs ...`): `tools/steps/lang-en.mjs` (island opening cutscene: 11 subtitles + 11 speech lines in English, 0 missing; the same in Dutch with `LANG=nl`; a save slot),
  the mini-game bot `tools/steps/m3-ui.mjs` with `&lang=en` (intro panel, help screen), the front end (menu, options, credits). Also over the relay stand-in (`LANGSRC=archive`): 15 range requests, 6.9 MB.
