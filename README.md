# LEGO Eiland 2: De Wraak van Dondersteen in de browser

Een web-port van *LEGO Eiland 2: De Wraak van Dondersteen* (LEGO Island 2: The Brickster's Revenge, Silicon Dreams, 2001;
Nederlandse uitgave 2002), in TypeScript en Vite.

Status: in ontwikkeling. Het startscherm leidt naar de echte spelstroom (films, hoofdmenu, verhaal, opslaan/laden); de meeste zones zijn nog een wandel-stub (zie docs/re/engine-m2.md).

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
importeer een mod in het formaat van de [LI2 Mod Manager](https://github.com/JeffRuLz/LI2-Mod-Manager) (een zip of map; bestandsvervangers en patches van het programma,
ook de 2 GB grote HD Texture Pack). Mods worden in je browser bewaard en gelden bij de volgende keer Spelen, zie [docs/re/mods.md](docs/re/mods.md).

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

## Credits

- [JSMpeg](https://github.com/phoboslab/jsmpeg) (MIT, Dominic Szablewski): MPEG-1 video- en MP2-audiodecoder, aangepast voor B-frames
  (zie `src/vendor/jsmpeg/`, ook [pl_mpeg](https://github.com/phoboslab/pl_mpeg)).
- [unshield](https://github.com/twogood/unshield) (MIT, David Eriksson): naslag voor het InstallShield-cabinetformaat.
