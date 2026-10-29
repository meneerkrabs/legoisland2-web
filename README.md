# LEGO Eiland 2: De Wraak van Dondersteen in de browser

Een web-port van *LEGO Eiland 2: De Wraak van Dondersteen* (LEGO Island 2: The Brickster's Revenge, Silicon Dreams, 2001;
Nederlandse uitgave 2002), in TypeScript en Vite.

Status: in ontwikkeling. Het startscherm leidt naar de echte spelstroom (films, hoofdmenu, verhaal, opslaan/laden); 23 van de 30 zones zijn gepoort (de 6 hubs z07CSI, z13CAI, z14OSD, z16PYA, z23DIP, z40OGL nog niet volledig; zie docs/re/gaps.md en docs/re/engine-m2.md).

**Er zitten geen spelbestanden in deze repo.** De app haalt de bestanden uit de ISO op
[archive.org](https://archive.org/details/legoeiland2dutch) (of uit je eigen ISO of cd) en bewaart ze in de browser.

## Waar de spelbestanden vandaan komen

Het spel staat op de cd in een InstallShield-cabinet (`LEGO Eiland 2/data1.hdr`, `data1.cab`, `data2.cab`); de vier films
(`IntroFmv`, `LegoSoftware`, `SdLogo`, `outroFmv`) staan als losse MPEG-1-bestanden in `LEGO Eiland 2/Movies/`.
`src/engine/installshield.ts` leest die cabinet rechtstreeks in de browser (een port van de benodigde delen van
[unshield](https://github.com/twogood/unshield)), zodat de bestanden verschijnen zoals het installatieprogramma ze zou
neerzetten: `_data/z02LGI.bob`, `LEGO eiland 2.exe`, enzovoort.

Bronnen (in volgorde van voorkeur, zie `src/library.ts`):

1. **Eigen ISO**: via "Eigen cd of ISO gebruiken" op het startscherm; de ISO wordt in de browser bewaard (Origin Private File System, ongeveer 450 MB).
2. **Eigen cd-map**: een map met de cd (of de map `LEGO Eiland 2` ervan, of een geinstalleerde spelmap); alleen voor die sessie.
3. **Ontwikkelmap** (alleen `npm run dev`): `public/data/le2/` (de uitgepakte spelmap) en `public/data/le2-movies/` (de films).
4. **archive.org** (standaard): via een CORS-proxy worden alleen de benodigde stukken van de ISO opgehaald (ongeveer 30 MB bij de eerste start, `tools/proxy/`); zonder proxy worden `data1.hdr`, `data1.cab` en `data2.cab` (samen ongeveer 342 MB) in een keer gedownload terwijl je al kunt beginnen. Alles blijft daarna in de browser; de films worden gestreamd.

Op archive.org staan twee Nederlandse ISO's met dezelfde indeling en identieke cabinet-bestanden
(`legoeiland2dutch` en `legoeiland2`); de eerste is de standaard, de tweede de reserve.

## Beeld, introfilms en mods

Op het beginscherm: **Beeld** (4:3 zoals het origineel, of breedbeeld: de 3D-wereld toont dan meer aan de zijkanten, menu's en films blijven 4:3; ook te kiezen in
Opties > Afbeeldingen, zie [docs/re/widescreen.md](docs/re/widescreen.md)), **Introfilms overslaan**, **Debugmenu** (het verhaalpuntenmenu van de ontwikkelaars) en **Mods**:
importeer een mod in het formaat van de [LI2 Mod Manager](https://github.com/JeffRuLz/LI2-Mod-Manager) (een zip, een rar of een map; bestandsvervangers en patches van het programma,
ook de 2 GB grote HD Texture Pack). Mods worden in je browser bewaard en gelden bij de volgende keer Spelen, zie [docs/re/mods.md](docs/re/mods.md).

De **Mod-catalogus** (in het mods-onderdeel) laat de bekende community-mods met één klik toevoegen, met de namen van de makers en een link naar hun oorspronkelijke topic op
Rock Raiders United. **Geen enkele mod staat in deze repo of op de website**: bij "Toevoegen" haalt je browser de mod rechtstreeks op bij de plek waar de maker hem publiceerde
(MEGA, Rock Raiders United, GitHub, archive.org; de laatste drie via dezelfde doorgeefserver als de ISO). Niets staat vanzelf aan. "IXS-look" wordt in je browser gemaakt van
de schijf van LEGO Island Xtreme Stunts op archive.org (alleen de vijf benodigde texturebanken, minder dan een halve MB, worden gelezen).

### Debug-opties (alleen met Debugmenu aan)

Alles wat niet in het origineel zit staat achter de **Debugmenu**-optie van het beginscherm (of `?debug=1` in de URL). Naast het verhaalpuntenmenu en de F9 / F10-hulpjes in de mini-games:
* **F8** (in de zones met een kijkvlak: z10RGB en z22BIP) of `?debug=1&viewplane` / `?debug=1&viewplane=<n>`: de getextureerde pass van het kijkvlak (`FUN_0087f01e`) die het origineel nooit draait
  (een oneindige vloer op het niveau van de zone met een langzaam golvende texture, `n` = het texturenummer; zie [docs/re/rendering.md](docs/re/rendering.md) sectie 10). Standaard uit: het spel is dan precies het origineel.

## Ontwikkelen

```bash
npm install
npm run dev          # http://localhost:5499
npm run build        # tsc + vite build
```

Voor snelle lokale tests: pak de cabinet uit met `unshield` en zet de map `Game` als `public/data/le2` en de films als
`public/data/le2-movies` (symlinks mogen; `public/data/` wordt door git genegeerd en niet gebouwd).

Tests:

```bash
node tools/test-installshield.mjs [cab-map] [unshield-uitvoer]   # alle bestanden uit de cabinet, byte voor byte vergeleken met unshield
node tools/test-mpeg.mjs <film.mpg>                              # decodeert een film en vergelijkt met ffmpeg (beeld en geluid)
node tools/browse.mjs "<url>" tools/steps/movie.mjs               # headless, gedempte browser (zie de kop van tools/browse.mjs)
```

Zie [docs/engine-api.md](docs/engine-api.md) voor de modules.

## Credits en licenties

- [JSMpeg](https://github.com/phoboslab/jsmpeg) (MIT, Dominic Szablewski): MPEG-1 video- en MP2-audiodecoder, aangepast voor B-frames
  (zie `src/vendor/jsmpeg/`, ook [pl_mpeg](https://github.com/phoboslab/pl_mpeg)).
- [unshield](https://github.com/twogood/unshield) (MIT, David Eriksson): naslag voor het InstallShield-cabinetformaat.
- Mods in de catalogus (alleen verwijzingen, de bestanden zelf worden bij het toevoegen bij de bron opgehaald): HD Texture Pack door webfischi; Island Grass, Legal Tracks,
  Nicer Skies en Bi-Plane Fuel Fix door Xiron (en JappaWakka voor de Nederlandse varianten); Skeleton Mod door Terrev; HD Font door EDlTOR; de Mod Manager zelf door
  [JeffRuLz](https://github.com/JeffRuLz/LI2-Mod-Manager). Zie [Rock Raiders United](https://rockraidersunited.com/topic/8970-mods-collected-for-all-languages/).
  "IXS-look" gebruikt textures van *LEGO Island Xtreme Stunts* (Silicon Dreams / LEGO Interactive, 2002) die uit de schijf op archive.org worden gelezen; ze worden niet bewaard of gehost.
- RAR-bestanden worden gelezen met [node-unrar-js](https://github.com/YuJianrong/node-unrar.js) (MIT, Jianrong Yu), een WebAssembly-versie van de officiele UnRAR-broncode
  (`unrar.wasm`, apart geladen zodra je een RAR gebruikt). UnRAR-licentie (RARLAB, Alexander L. Roshal), de bepaling die voor ons geldt:
  *"UnRAR source code may be used in any software to handle RAR archives without limitations free of charge, but cannot be used to develop RAR (WinRAR) compatible archiver and to
  re-create RAR compression algorithm, which is proprietary. Distribution of modified UnRAR source code in separate form or as a part of other software is permitted, provided that
  full text of this paragraph, starting from "UnRAR source code" words, is included in license, or in documentation if license is not available, and in source code comments of
  resulting package."* Hier wordt alleen uitgepakt, niets ingepakt.
