#!/usr/bin/env node
// A stand-in for the archive.org relay that serves a SMALL synthetic "HD Texture.zip" (the real one is 709 MB and the real relay refuses a localhost origin: CORS), so that the HD path
// (src/mods/hdremote.ts -> hdfill.ts worker -> OPFS le2-hd/ -> overrides) can be driven in webkit / firefox / chromium:
//   node tools/browser-hd-standin.mjs [port=5612] [real.zip]      then open  http://localhost:5497/?zone=z02LGI&hd=1&relay=http://localhost:5612&mute=1
// The zip holds `HD Texture/_data/z02LGI/<member>` for the first 40 .tga members of the island (4x nearest-neighbour enlarged, tinted red so that a replaced texture is easy to see).
// With a path to a real pack (e.g. the local `HD Texture.zip` re-zip of the extracted pack) that file is served instead (bigger test: the island's 4x textures).
// Serves Range (incl. suffix ranges) and CORS like the nginx relay (tools/proxy/nginx/le2-proxy.conf).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Archive } from '../src/formats/archive.ts';
import { parseTga } from '../src/formats/tga.ts';

const realFile = process.argv[3];
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? 5612);
const D = path.join(here, '../public/data/le2/_data');
const arch = new Archive('z02LGI', fs.readFileSync(path.join(D, 'z02LGI.bod')), fs.readFileSync(path.join(D, 'z02LGI.bob')));
const members = [];
for (const e of realFile ? [] : arch.entries) {
  if (!/\.tga$/i.test(e.path)) continue;
  const raw = arch.read(e);
  let img; try { img = parseTga(raw); } catch { continue; }
  if (img.width < 32 || img.height < 32 || img.width > 256) continue;
  const W = img.width * 4, H = img.height * 4, out = Buffer.alloc(18 + W * H * 4);
  out[2] = 2; out.writeUInt16LE(W, 12); out.writeUInt16LE(H, 14); out[16] = 32; out[17] = raw[17] & 0x20 ? 0x28 : 0x08;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((y >> 2) * img.width + (x >> 2)) * 4, o = 18 + (y * W + x) * 4;
    out[o] = img.rgba[s + 2] >> 1; out[o + 1] = img.rgba[s + 1] >> 1; out[o + 2] = Math.min(255, img.rgba[s] + 90); out[o + 3] = img.rgba[s + 3];   // B G R A, redder
  }
  members.push({ name: `HD Texture/_data/z02LGI/${e.path}`, data: out });
  if (members.length >= 40) break;
}
// zip with deflate members and a central directory
const parts = [], cd = [];
let pos = 0;
const push = (b) => { parts.push(b); pos += b.length; };
for (const m of members) {
  const name = Buffer.from(m.name), body = zlib.deflateRawSync(m.data), crc = zlib.crc32(m.data), off = pos;
  const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(m.data.length, 22); h.writeUInt16LE(name.length, 26);
  push(h); push(name); push(body);
  const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(m.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
  cd.push(c, name);
}
const cdOff = pos, cdBuf = Buffer.concat(cd); push(cdBuf);
const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(members.length, 8); eocd.writeUInt16LE(members.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(cdOff, 16);
push(eocd);
const zip = realFile ? null : Buffer.concat(parts);
const fd = realFile ? fs.openSync(realFile, 'r') : -1, total = realFile ? fs.statSync(realFile).size : zip.length;
const slice = (s, e) => { if (zip) return zip.subarray(s, e + 1); const b = Buffer.alloc(e - s + 1); fs.readSync(fd, b, 0, b.length, s); return b; };
console.log(realFile ? `stand-in relay on http://localhost:${port}: the real pack ${realFile} (${total} bytes)` : `stand-in relay on http://localhost:${port}: ${members.length} members of z02LGI, ${zip.length} bytes`);

http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'range', 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-expose-headers': 'content-range, content-length, accept-ranges' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (!/^\/ia\/lego-island-2-hd-textures\//.test(req.url)) { res.writeHead(404, cors); res.end('no'); return; }
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  let s = 0, e = total - 1, code = 200;
  if (m) { code = 206; if (m[1] === '') { s = Math.max(0, total - Number(m[2])); } else { s = Number(m[1]); if (m[2] !== '') e = Math.min(e, Number(m[2])); } }
  const body = slice(s, e);
  res.writeHead(code, { ...cors, 'content-type': 'application/zip', 'accept-ranges': 'bytes', 'content-length': body.length, ...(code === 206 ? { 'content-range': `bytes ${s}-${e}/${total}` } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port);
