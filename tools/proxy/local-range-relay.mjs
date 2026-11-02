#!/usr/bin/env node
// A local stand-in for the nginx relay (tools/proxy/nginx/le2-proxy.conf) to test the archive.org routes without the network: serves local ISO files by HTTP Range with CORS
// headers at /ia/<item>/<iso file name>, exactly the URL shape the app asks for. Nothing is stored; only the files named on the command line are reachable.
//   node tools/proxy/local-range-relay.mjs 8766 'LEGO_Island_2_The_Bricksters_Revenge_-_Windows_Eng/LegoIsland2-Windows.iso=/path/to/LegoIsland2-Windows.iso' [more item/file=path ...]
//   app: http://localhost:5741/?lang=en&langsource=archive&proxy=http://127.0.0.1:8766/ia/{item}/{iso}
import http from 'node:http';
import fs from 'node:fs';

const [port, ...maps] = process.argv.slice(2);
const files = new Map(maps.map((m) => { const i = m.indexOf('='); return [m.slice(0, i), m.slice(i + 1)]; }));
let requests = 0, bytes = 0;
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url === '/stats') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ requests, bytes })); }
  const m = /^\/ia\/([^/]+)\/([^/?]+)/.exec(req.url ?? '');
  const file = m && files.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
  if (!file) { res.writeHead(404); return res.end('not whitelisted'); }
  const size = fs.statSync(file).size;
  const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (!r) { res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' }); return fs.createReadStream(file).pipe(res); }   // (the real relay refuses a rangeless request; fine here)
  const start = Number(r[1]), end = Math.min(size - 1, r[2] === '' ? size - 1 : Number(r[2]));
  requests++; bytes += end - start + 1;
  res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
  fs.createReadStream(file, { start, end }).pipe(res);
}).listen(Number(port), '127.0.0.1', () => console.log(`relay on 127.0.0.1:${port}: ${[...files.keys()].join(', ')}`));
