<?php
/**
 * CORS-proxy voor LEGO Eiland 2 in de browser (legoisland2-web).
 *
 * archive.org stuurt bij de "gewone" downloads geen CORS-headers (of negeert Range). Dit bestand haalt alleen de twee
 * Nederlandse ISO's van archive.org op, met Range-ondersteuning, en stuurt ze met CORS-headers door naar de app.
 * Er wordt niets opgeslagen en niets gelogd behalve fouten.
 *
 *   GET  le2-cors-proxy.php?url=<https://archive.org/download/legoeiland2dutch/...iso>   + header "Range: bytes=a-b"
 *   HEAD / OPTIONS (preflight) worden ook beantwoord.
 */

// ---- instellingen -------------------------------------------------------------------------------------------------

/** Websites die de proxy mogen gebruiken (de Origin-header van de browser). */
$ALLOWED_ORIGINS = [
    'https://meneerkrabs.github.io',
    'http://localhost:5499',
];

// Extra origins (komma-gescheiden) via de omgevingsvariabele LE2_PROXY_ORIGINS, handig bij testen.
if (getenv('LE2_PROXY_ORIGINS')) {
    $ALLOWED_ORIGINS = array_merge($ALLOWED_ORIGINS, array_filter(array_map('trim', explode(',', getenv('LE2_PROXY_ORIGINS')))));
}

/** Toegestane doel-URL's: alleen de ISO-bestanden van deze twee archive.org-items. */
$ALLOWED_URL = '#^https://archive\.org/download/(legoeiland2dutch|legoeiland2)/[^/?\#]+\.iso$#';

/** Maximale grootte van een enkele range (bytes). Grotere aanvragen worden ingekort (het antwoord is dan een kleinere 206). */
$MAX_RANGE = 32 * 1024 * 1024;

// ---- einde instellingen -------------------------------------------------------------------------------------------

ini_set('display_errors', '0'); // foutmeldingen mogen nooit in de bytes terechtkomen

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$originOk = $origin === '' || in_array($origin, $ALLOWED_ORIGINS, true);

function fail(int $code, string $msg): void
{
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: text/plain; charset=utf-8');
    }
    echo $msg . "\n";
    exit;
}

header('Vary: Origin');
if ($origin !== '' && $originOk) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges');
}

if ($method === 'OPTIONS') {
    if ($origin !== '' && $originOk) {
        header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
        header('Access-Control-Allow-Headers: Range');
        header('Access-Control-Max-Age: 86400');
    }
    http_response_code(204);
    exit;
}
if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, HEAD, OPTIONS');
    fail(405, 'Alleen GET, HEAD en OPTIONS.');
}
if (!$originOk) {
    fail(403, 'Deze website mag deze proxy niet gebruiken.');
}
if (!function_exists('curl_init')) {
    fail(500, 'PHP-extensie curl ontbreekt.');
}

$url = $_GET['url'] ?? '';
if (!is_string($url) || strlen($url) > 400 || !preg_match($ALLOWED_URL, $url)) {
    fail(400, 'Alleen de ISO-bestanden van legoeiland2dutch en legoeiland2 op archive.org zijn toegestaan.');
}

// Range: "bytes=a-b" of "bytes=a-"; zonder Range zou de hele ISO (450 MB) komen: niet toegestaan
$range = $_SERVER['HTTP_RANGE'] ?? '';
if (!preg_match('/^bytes=(\d+)-(\d*)$/', $range, $m)) {
    fail(416, 'Een Range-header (bytes=a-b) is verplicht.');
}
$start = (int)$m[1];
$end = $m[2] === '' ? $start + $MAX_RANGE - 1 : (int)$m[2];
if ($end < $start) {
    fail(416, 'Ongeldige range.');
}
if ($end - $start + 1 > $MAX_RANGE) {
    $end = $start + $MAX_RANGE - 1;
}

// ---- doorsturen met curl (de body wordt direct doorgegeven, niet gebufferd) ----------------------------------------

while (ob_get_level() > 0) {
    ob_end_clean();
}
set_time_limit(0);
ignore_user_abort(false);

$status = 0;
$upHeaders = [];
$sent = false;
$redirectBad = false;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RANGE => $start . '-' . $end,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 300,
    CURLOPT_LOW_SPEED_LIMIT => 1024,
    CURLOPT_LOW_SPEED_TIME => 30,
    CURLOPT_ENCODING => 'identity',
    CURLOPT_USERAGENT => 'le2-cors-proxy/1.0',
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$status, &$upHeaders, &$redirectBad) {
        $len = strlen($line);
        $line = trim($line);
        if (stripos($line, 'HTTP/') === 0) {
            $parts = explode(' ', $line, 3);
            $status = (int)($parts[1] ?? 0);
            $upHeaders = []; // een nieuw antwoord (na een redirect): opnieuw beginnen
        } elseif (strpos($line, ':') !== false) {
            [$k, $v] = explode(':', $line, 2);
            $upHeaders[strtolower(trim($k))] = trim($v);
            // redirects mogen alleen naar archive.org zelf
            if (strtolower(trim($k)) === 'location') {
                $host = parse_url(trim($v), PHP_URL_HOST);
                if ($host !== null && $host !== false && !preg_match('/(^|\.)archive\.org$/i', $host)) {
                    $redirectBad = true;
                }
            }
        }
        return $redirectBad ? 0 : $len;
    },
    CURLOPT_WRITEFUNCTION => function ($ch, $data) use (&$status, &$upHeaders, &$sent, $method) {
        if (!$sent) {
            if ($status !== 206 && $status !== 200) {
                return 0; // geen bruikbaar antwoord: afbreken, de fout wordt hieronder gemeld
            }
            $sent = true;
            http_response_code($status);
            foreach (['content-range' => 'Content-Range', 'content-length' => 'Content-Length', 'accept-ranges' => 'Accept-Ranges'] as $k => $h) {
                if (isset($upHeaders[$k])) {
                    header($h . ': ' . $upHeaders[$k]);
                }
            }
            header('Content-Type: application/octet-stream');
            header('Cache-Control: public, max-age=86400');
            header('X-Accel-Buffering: no');
        }
        if ($method === 'HEAD') {
            return 0; // alleen de headers: de verbinding met archive.org afbreken
        }
        echo $data;
        flush();
        return strlen($data);
    },
]);

$ok = curl_exec($ch);
$err = curl_errno($ch) ? curl_error($ch) : '';
if (PHP_VERSION_ID < 80000) {
    curl_close($ch); // sinds PHP 8.0 zonder effect (en 8.5: deprecated)
}

if (!$sent) {
    if ($redirectBad) {
        error_log('le2-cors-proxy: redirect naar een andere host geweigerd');
        fail(502, 'Ongeldige redirect van archive.org.');
    }
    if ($status === 416) {
        fail(416, 'Range buiten het bestand.');
    }
    error_log('le2-cors-proxy: upstream status ' . $status . ' ' . $err);
    fail(502, 'archive.org gaf geen bruikbaar antwoord (status ' . $status . ').');
}
if ($ok === false && $err !== '' && $method !== 'HEAD') {
    error_log('le2-cors-proxy: afgebroken: ' . $err);
}
