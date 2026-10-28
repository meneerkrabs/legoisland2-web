# CORS-proxy voor de spelbestanden (optioneel)

De app kan de ISO op archive.org met HTTP-Range-aanvragen lezen, zodat bij de eerste start alleen de benodigde delen
(ongeveer 30 MB) worden gedownload in plaats van alle 342 MB. archive.org zelf staat dat vanuit een browser niet toe: de
CORS-endpoints negeren `Range`, en de server die `Range` wel snapt stuurt geen CORS-headers. Daarvoor is een kleine
tussenserver nodig. Zonder proxy werkt de app ook: dan downloadt hij de bestanden in een keer (je kunt al beginnen terwijl
dat doorloopt).

`le2-cors-proxy.php` is zo'n proxy voor gewone PHP-hosting (PHP 7.4 of nieuwer met de curl-extensie, geen frameworks).

## Wat het doet

- Alleen `GET`, `HEAD` en `OPTIONS` (de preflight van de browser).
- Alleen de ISO-bestanden `https://archive.org/download/legoeiland2dutch/<naam>.iso` en `.../legoeiland2/<naam>.iso`
  (redirects naar archive.org zelf worden server-side gevolgd; een redirect naar een andere host wordt geweigerd).
- Een `Range: bytes=a-b` is verplicht (anders zou de hele ISO komen); een range wordt tot 32 MB ingekort.
- Stuurt `206`/`200`, `Content-Range`, `Content-Length`, `Accept-Ranges` door en streamt de body met curl zonder hem
  eerst te bufferen.
- CORS alleen voor de ingestelde websites (standaard `https://meneerkrabs.github.io` en `http://localhost:5499`), met
  `Access-Control-Allow-Headers: Range` en `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`.
- **Slaat niets op** (geen cache op schijf) en logt niets behalve fouten (`error_log`).

## Installeren

1. Upload `le2-cors-proxy.php` naar je hosting (bijvoorbeeld `https://jouwsite.nl/le2/le2-cors-proxy.php`).
2. Zet bovenin het bestand bij `$ALLOWED_ORIGINS` de websites die de proxy mogen gebruiken (de plek waar je de app host).
   Tijdelijk extra origins kan ook met de omgevingsvariabele `LE2_PROXY_ORIGINS` (komma-gescheiden).
3. Test met curl (de tweede opdracht moet `206` geven met `Content-Range: bytes 0-99/450813952` en een
   `Access-Control-Allow-Origin`):

   ```bash
   P='https://jouwsite.nl/le2/le2-cors-proxy.php'
   U='https://archive.org/download/legoeiland2dutch/LEGO%20Eiland%202%20De%20Wraak%20van%20Dondersteen%20%28Dutch%29.iso'
   E=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$U")
   curl -si -H 'Origin: https://meneerkrabs.github.io' -H 'Range: bytes=0-99' "$P?url=$E" | head -15
   ```
4. Zet de proxy in de app: de constante `PROXY_BASE` in `src/library.ts` (de URL van het PHP-bestand), of om te testen
   `?proxy=https://jouwsite.nl/le2/le2-cors-proxy.php` achter de URL van de app, of in de browserconsole
   `localStorage.setItem('le2-proxy', '<url>')`. `?proxy=off` (of `localStorage.setItem('le2-proxy', 'off')`) forceert
   de gewone download zonder proxy.

`PROXY_BASE` mag ook een sjabloon zijn met `{item}` en `{iso}` (de naam van de ISO, URL-gecodeerd), bijvoorbeeld voor een
nginx-relay: `https://host/ia/{item}/{iso}`. Een URL zonder `{item}` wordt als PHP-stijl gebruikt (`?url=...`).

## Lokaal testen

```bash
LE2_PROXY_ORIGINS=http://localhost:5498 PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:8765 -t tools/proxy
# app: ...?source=archive&proxy=http://127.0.0.1:8765/le2-cors-proxy.php
```

(`PHP_CLI_SERVER_WORKERS` laat de ingebouwde server meerdere aanvragen tegelijk afhandelen; de app doet er tot 6 parallel.)

## Opmerkingen

- Bij hosting die uitvoer bufferd (mod_deflate, FastCGI-buffers) komt de body pas aan het eind door; dat werkt, maar
  zet voor de snelheid compressie voor dit bestand uit (de proxy stuurt `X-Accel-Buffering: no` voor nginx).
- Een aanvraag kost ongeveer 1,5 s voordat de eerste byte komt (archive.org-redirect); daarom vraagt de app grote
  stukken (tot 6 MB) tegelijk en een paar parallel.
