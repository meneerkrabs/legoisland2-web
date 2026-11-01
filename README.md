# LEGO Island 2: The Brickster's Revenge in the browser

**English** · [Nederlands](README.nl.md)

A web port of the Dutch release *LEGO Eiland 2: De Wraak van Dondersteen* (LEGO Island 2: The Brickster's Revenge, Silicon Dreams, 2001;
Dutch edition 2002), written in TypeScript with Vite. Play it at **https://meneerkrabs.github.io/legoisland2-web/**.

Status: playable from start to finish. Every zone is ported (the island, the six hubs, all mini-games and rooms); a bot plays the whole story from "Nieuw spel" (new game)
to the end. The port is now being made exact against the original step by step (differential tests run the original's code in an x86 emulator next to the port; see
docs/re/gaps.md). The game itself is in Dutch, as the edition it is based on.

**This repository contains no game files.** The app fetches them from the ISO on [archive.org](https://archive.org/details/legoeiland2dutch) (or from your own ISO
or CD) and keeps them in the browser.

## Where the game files come from

On the CD the game sits in an InstallShield cabinet (`LEGO Eiland 2/data1.hdr`, `data1.cab`, `data2.cab`); the four movies (`IntroFmv`, `LegoSoftware`, `SdLogo`,
`outroFmv`) are separate MPEG-1 files in `LEGO Eiland 2/Movies/`. `src/engine/installshield.ts` reads that cabinet directly in the browser (a port of the needed parts
of [unshield](https://github.com/twogood/unshield)), so the files appear the way the installer would place them: `_data/z02LGI.bob`, `LEGO eiland 2.exe`, and so on.

Sources, in order of preference (see `src/library.ts`):

1. **Your own ISO**: "Eigen cd of ISO gebruiken" on the start screen; the ISO is kept in the browser (Origin Private File System, about 450 MB).
2. **Your own CD folder**: a folder with the CD (or its `LEGO Eiland 2` folder, or an installed game folder); for that session only.
3. **Development folder** (`npm run dev` only): `public/data/le2/` (the unpacked game folder) and `public/data/le2-movies/` (the movies).
4. **archive.org** (default): through a CORS relay only the needed parts of the ISO are fetched (about 30 MB on the first start, `tools/proxy/`); without the relay
   `data1.hdr`, `data1.cab` and `data2.cab` (about 342 MB together) are downloaded at once while you can already start playing. Everything stays in the browser
   afterwards; the movies are streamed.

archive.org has two Dutch ISOs with the same layout and identical cabinet files (`legoeiland2dutch` and `legoeiland2`); the first is the default, the second the fallback.

## Display, intro movies and mods

On the start screen: **Beeld** (display: 4:3 like the original, or widescreen, where the 3D world shows more at the sides while menus and movies stay 4:3; also in
Opties > Afbeeldingen, see [docs/re/widescreen.md](docs/re/widescreen.md)), **Introfilms overslaan** (skip intro movies), **Debugmenu** (the developers' story-checkpoint
menu) and **Mods**: import a mod in the format of the [LI2 Mod Manager](https://github.com/JeffRuLz/LI2-Mod-Manager) (a zip, a rar or a folder; file replacements and
patches of the executable, including the 2 GB HD Texture Pack). Mods are kept in your browser and apply the next time you play, see [docs/re/mods.md](docs/re/mods.md).

**HD textures** (port extra): the start screen has an "HD-textures" checkbox for webfischi's HD Texture Pack (all 5000+ textures four times sharper), **on by default on
capable devices** (a desktop-class browser with enough memory and storage room; phones and tablets get it unchecked, with a short explanation, and can still turn it on). The
textures are read on demand from webfischi's upload on archive.org (through a byte-range relay): only the zones you visit are fetched (the island is about 65 MB) and kept in your
browser, instead of a 2.2 GB download up front; MEGA is the fallback. Fetching happens in the background while you already play; a zone that is not ready yet starts with the original
textures and is sharper the next time, and unchecking stops it and offers to remove what was stored. Off = exactly the original look. Nothing of the pack is hosted here. Details:
[docs/re/mods.md](docs/re/mods.md).

**LEGO 3D** (port extra, **on by default**; off on weak devices): a start-screen checkbox that rebuilds the game from real LEGO parts of the [LDraw](https://www.ldraw.org)
library (CC BY 4.0 / CCAL 2.0): the minifigs (bodies, heads, hands, hair and hats where a part exists), the brick library, real 3D studs on the stud plates, 4x stud / brick-wall pictures and
seven LDraw set models (jet ski, ambulance, Island Racer, ...) and brick-built versions of the island's Res-Q centre and Gas N' Wash garage, the train carriage and the airstrip seaplane. It is assembled **in your browser** from a small data pack (about 1 MB, LDraw-derived, with `ATTRIBUTION.txt`) plus your own
game files; nothing of the game is hosted, nothing of it leaves your browser. It never blocks play (no pack in time = the original game), weak devices get a warning, unchecking removes
what was cached. Details and numbers: [docs/re/lego3d.md](docs/re/lego3d.md).

The **mod catalogue** (in the mods section) adds the known community mods with one click, with the authors' names and a link to their original topic on Rock Raiders
United. **No mod is stored in this repository or on the website**: on "Toevoegen" (add) your browser fetches the mod directly from where its author published it (MEGA,
Rock Raiders United, GitHub, archive.org; the last three through the same relay as the ISO). Nothing is switched on by itself. "IXS-look" is built in your browser from
the LEGO Island Xtreme Stunts disc on archive.org (only the five texture banks it needs, less than half a MB, are read).

Saves use the original's `.lgo` format byte for byte; the load page can import and export them, so saves can move between the port and the original game
([docs/re/save.md](docs/re/save.md)).

### Debug options (only with Debugmenu on)

Everything that is not in the original is behind the start screen's **Debugmenu** option (or `?debug=1` in the URL):

* **Ontwikkelaarshoek** (developer corner): button on the start screen or the **`** key in the game. Twelve sections: jump to any story node and zone, all 319 game
  variables, cheats and secrets, the original's free camera, debug drawing and autoplay, objects, galleries of unused models, textures, sounds, texts and cutscenes, and
  flying with the station master (see [docs/re/devcorner.md](docs/re/devcorner.md) and [docs/re/unused.md](docs/re/unused.md)).
* **F8** (in the zones with a view plane: z10RGB and z22BIP) or `?debug=1&viewplane` / `?debug=1&viewplane=<n>`: the textured pass of the view plane
  (`FUN_0087f01e`) that the original never runs (an endless floor at the zone's level with a slowly waving texture, `n` = the texture number; see
  [docs/re/rendering.md](docs/re/rendering.md) section 10). Off by default: the game is then exactly the original.

**Herstelde inhoud** (restored content; an option on the start screen, off by default): cut content of the original back in the game, such as an unused cutscene, the
radio battery quest, the objective arrow and Darren's tips; for every item the docs say what is original and what is reconstructed ([docs/re/restore.md](docs/re/restore.md)).

## Development

```bash
npm install
npm run dev          # http://localhost:5499
npm run build        # tsc + vite build
```

For quick local tests: unpack the cabinet with `unshield` and put the `Game` folder at `public/data/le2` and the movies at `public/data/le2-movies` (symlinks are fine;
`public/data/` is ignored by git and not built).

Tests:

```bash
node tools/test-formats.mjs                                       # all node tests (parsers, ports, oracle tests against the original's code)
node tools/test-installshield.mjs [cab-dir] [unshield-output]     # every file from the cabinet, compared byte for byte with unshield
node tools/test-mpeg.mjs <movie.mpg>                              # decodes a movie and compares it with ffmpeg (picture and sound)
node tools/browse.mjs "<url>" tools/steps/movie.mjs               # headless, muted browser (see the header of tools/browse.mjs)
```

See [docs/engine-api.md](docs/engine-api.md) for the modules; the reverse-engineering notes are in [docs/re/](docs/re/).

## Credits and licences

- [JSMpeg](https://github.com/phoboslab/jsmpeg) (MIT, Dominic Szablewski): MPEG-1 video and MP2 audio decoder, adapted for B-frames
  (see `src/vendor/jsmpeg/`, also [pl_mpeg](https://github.com/phoboslab/pl_mpeg)).
- [unshield](https://github.com/twogood/unshield) (MIT, David Eriksson): reference for the InstallShield cabinet format.
- Mods in the catalogue (references only; the files themselves are fetched from their source when added): HD Texture Pack by webfischi; Island Grass, Legal Tracks,
  Nicer Skies and Bi-Plane Fuel Fix by Xiron (and JappaWakka for the Dutch versions); Skeleton Mod by Terrev; HD Font by EDlTOR; the Mod Manager itself by
  [JeffRuLz](https://github.com/JeffRuLz/LI2-Mod-Manager). See [Rock Raiders United](https://rockraidersunited.com/topic/8970-mods-collected-for-all-languages/).
  "IXS-look" uses textures of *LEGO Island Xtreme Stunts* (Silicon Dreams / LEGO Interactive, 2002) read from the disc on archive.org; they are not stored or hosted.
- RAR files are read with [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (MIT, Jianrong Yu), a WebAssembly build of the official UnRAR source code
  (`unrar.wasm`, loaded separately as soon as you use a RAR). UnRAR licence (RARLAB, Alexander L. Roshal), the provision that applies here:
  *"UnRAR source code may be used in any software to handle RAR archives without limitations free of charge, but cannot be used to develop RAR (WinRAR) compatible archiver and to
  re-create RAR compression algorithm, which is proprietary. Distribution of modified UnRAR source code in separate form or as a part of other software is permitted, provided that
  full text of this paragraph, starting from "UnRAR source code" words, is included in license, or in documentation if license is not available, and in source code comments of
  resulting package."* Only extraction is done here, no compression.
- LEGO, the LEGO logo and LEGO Island are trademarks of the LEGO Group, which does not sponsor, authorise or endorse this project.
