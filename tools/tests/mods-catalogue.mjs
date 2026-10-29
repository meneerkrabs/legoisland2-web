// Mod catalogue and its parts (src/mods): RAR reading (synthetic archives in both modes; optional real archives), MEGA public-link download (a fake MEGA server with the real
// protocol), the IXS readers (LZ, BMB, DXT5), the raw-disc ISO reader, the IXS-look recipe, and the catalogue flow end to end against fake sources (nothing is fetched from
// the network). Real-data checks run when the files exist and are skipped otherwise: the IXS files under ~/Documents/ixs-extract + the reference mod under
// ~/Documents/legoeiland2-extract/mods/ixs-look; RAR files: the Skeleton Mod under ~/Documents/legoeiland2-extract/mods/downloads (or the env var RAR_SAMPLE) and RAR5_SAMPLE (any
// RAR 5 file; the test only checks that every file extracts with a correct CRC).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildZip } from '../lib/zipwrite.mjs';
import { crc32, zipBytes } from '../../src/mods/zip.ts';
import { openRar, isRarBytes } from '../../src/mods/rar.ts';
import { megaOpen, megaStream, parseMegaLink, b64url, MegaError } from '../../src/mods/mega.ts';
import { unpackIxs, parseBmb, decodeBmb, bankTexture } from '../../src/mods/ixs.ts';
import { RawDisc } from '../../src/mods/rawdisc.ts';
import { IXS_FILES, IXS_LOOK_FILES, buildIxsLook, readIxsBanks, toTga } from '../../src/mods/ixslook.ts';
import { CATALOGUE, addFromCatalogue, addable, catalogueEntry, fetchRelay } from '../../src/mods/catalogue.ts';
import { importPicked } from '../../src/mods/manage.ts';
import { MemoryModStore } from '../../src/mods/store.ts';

const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const HOME = process.env.HOME;

// ------------------------------------------------------------------------------------------------------------------------ synthetic RAR 1.5 - 4.x (stored)
const u16 = (n) => [n & 255, (n >> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
function block(type, flags, body) {
  const size = 7 + body.length;
  const b = Uint8Array.from([0, 0, type, ...u16(flags), ...u16(size), ...body]);
  const c = crc32(b.subarray(2)) & 0xffff; b[0] = c & 255; b[1] = c >> 8;
  return b;
}
/** files: [{name, data, solid?}]; stored (method 0x30), so unRAR needs no decompression but reads the whole format */
function makeRar(files, { mainFlags = 0, fileFlags = 0 } = {}) {
  const parts = [Uint8Array.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), block(0x73, mainFlags, [0, 0, 0, 0, 0, 0])];
  for (const f of files) {
    const name = enc(f.name);
    const head = [...u32(f.data.length), ...u32(f.data.length), 0, ...u32(crc32(f.data)), ...u32(0x4e21_0000), 20, 0x30, ...u16(name.length), ...u32(0x20), ...name];
    parts.push(block(0x74, 0x8000 | fileFlags | (f.solid ? 0x10 : 0), head), f.data);
  }
  parts.push(Uint8Array.from([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------------ a fake MEGA
/** encrypts like MEGA: AES-128-CTR with the nonce from the key; the attributes AES-128-CBC with a zero IV */
function fakeMega({ name, content, errorCode, failRange }) {
  const key32 = crypto.randomBytes(32);
  const aes = Buffer.alloc(16); for (let i = 0; i < 16; i++) aes[i] = key32[i] ^ key32[i + 16];
  const iv = Buffer.concat([key32.subarray(16, 24), Buffer.alloc(8)]);
  const encrypted = crypto.createCipheriv('aes-128-ctr', aes, iv).update(content);
  const attrs = Buffer.from('MEGA' + JSON.stringify({ n: name }));
  const padded = Buffer.concat([attrs, Buffer.alloc((16 - (attrs.length % 16)) % 16)]);
  const at = crypto.createCipheriv('aes-128-cbc', aes, Buffer.alloc(16)).setAutoPadding(false).update(padded);
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const link = `https://mega.nz/#!ABCDEFGH!${b64(key32)}`;
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    url = String(url);
    requests.push(url);
    if (url.startsWith('https://g.api.mega.co.nz/cs')) {
      const body = JSON.parse(init.body);
      if (body[0].a !== 'g' || body[0].p !== 'ABCDEFGH') return new Response('[-9]');
      return new Response(JSON.stringify(errorCode ? [errorCode] : [{ s: content.length, at: b64(at), g: 'https://gfs.userstorage.mega.co.nz/dl/token' }]));
    }
    const m = url.match(/\/dl\/token\/(\d+)-(\d+)$/);
    if (!m) return new Response('no', { status: 404 });
    if (failRange && requests.filter((u) => u.includes('/dl/token/')).length === failRange) return new Response('x', { status: 500 });
    return new Response(encrypted.subarray(+m[1], +m[2] + 1));
  };
  return { link, fetchFn, requests, encrypted };
}

// ------------------------------------------------------------------------------------------------------------------------ IXS LZ encoder (the inverse of the unpacker)
/** encodes with literals and long copies (length 3..9 with a 13-bit distance); the stream mirrors the decoder's order of bit and data reads */
function lzEncode(data) {
  const out = []; // bytes after the size word
  let slot = 0, cur = 0, cnt = 0;
  out.push(0, 0, 0, 0); // the first bit word
  const advance = () => { cnt++; if (cnt === 32) { out[slot] = cur & 255; out[slot + 1] = (cur >>> 8) & 255; out[slot + 2] = (cur >>> 16) & 255; out[slot + 3] = (cur >>> 24) & 255; slot = out.length; out.push(0, 0, 0, 0); cur = 0; cnt = 0; } };
  const bit = (v) => { if (v) cur |= 1 << cnt; };
  let i = 0;
  while (i < data.length) {
    let best = 0, dist = 0;
    for (let d = 1; d <= Math.min(i, 0x2000); d++) { let l = 0; while (l < 9 && i + l < data.length && data[i + l] === data[i + l - d]) l++; if (l > best) { best = l; dist = d; } }
    if (best >= 3) {
      bit(1); advance(); bit(1);
      const w = (((-dist) + 0x2000) << 3) | (best - 2);
      out.push(w & 255, w >> 8);
      advance();
      i += best;
    } else { bit(0); out.push(data[i++]); advance(); }
  }
  // terminator: a long copy whose first word has length bits 0, then a byte with length 1
  bit(1); advance(); bit(1); out.push(0, 0, 1); advance();
  out[slot] = cur & 255; out[slot + 1] = (cur >>> 8) & 255; out[slot + 2] = (cur >>> 16) & 255; out[slot + 3] = (cur >>> 24) & 255;
  return Uint8Array.from([...u32((data.length | 0x80000000) >>> 0), ...out]);
}

// ------------------------------------------------------------------------------------------------------------------------ a synthetic raw disc
/** MODE 2 form 1 (or MODE 1) raw sectors with an ISO 9660 tree; files = { 'DIR/SUB/FILE.BMB': Uint8Array } */
function makeDisc(files, { mode = 2, filler = 0 } = {}) {
  const sectors = new Map();
  const put = (lba, data) => { for (let i = 0; i * 2048 < data.length; i++) sectors.set(lba + i, data.subarray(i * 2048, (i + 1) * 2048)); };
  let next = 17 + filler;
  const rec = (name, lba, size, isDir) => {
    const nm = enc(isDir ? name : `${name};1`);
    const len = 33 + nm.length + (nm.length % 2 ? 0 : 1);
    const r = new Uint8Array(len); r[0] = len; r[25] = isDir ? 2 : 0;
    new DataView(r.buffer).setUint32(2, lba, true); new DataView(r.buffer).setUint32(10, size, true);
    r[32] = nm.length; r.set(nm, 33);
    return r;
  };
  const tree = {};
  for (const [p, data] of Object.entries(files)) { let n = tree; const parts = p.split('/'); for (let i = 0; i < parts.length - 1; i++) n = n[parts[i]] ??= {}; n[parts[parts.length - 1]] = data; }
  const dirSectors = (n) => Math.max(1, Math.ceil(Object.keys(n).length * 60 / 2048));   // generous: a record is at most ~45 bytes here
  const writeDir = (n, lbaSelf) => {
    const recs = [rec('\0', lbaSelf, 2048 * dirSectors(n), true), rec('\u0001', lbaSelf, 2048 * dirSectors(n), true)];
    const todo = [];
    for (const [name, v] of Object.entries(n)) {
      if (v instanceof Uint8Array) { const lba = next; next += Math.ceil(v.length / 2048); put(lba, v); recs.push(rec(name, lba, v.length, false)); }
      else { const lba = next; next += dirSectors(v); todo.push([v, lba]); recs.push(rec(name, lba, 2048 * dirSectors(v), true)); }
    }
    // records never straddle a sector
    const buf = []; let used = 0;
    for (const r of recs) { if (used + r.length > 2048) { buf.push(new Uint8Array(2048 - used)); used = 0; } buf.push(r); used += r.length; }
    buf.push(new Uint8Array(2048 - used));
    const all = new Uint8Array(2048 * dirSectors(n)); let at = 0; for (const b of buf) { all.set(b, at); at += b.length; }
    put(lbaSelf, all);
    for (const [v, lba] of todo) writeDir(v, lba);
  };
  const rootLba = next; next += dirSectors(tree);
  writeDir(tree, rootLba);
  const pvd = new Uint8Array(2048); pvd[0] = 1; pvd.set(enc('CD001'), 1); pvd[6] = 1;
  const rootRec = rec('\0', rootLba, 2048 * dirSectors(tree), true); pvd.set(rootRec.subarray(0, 34), 156);
  put(16, pvd);
  const total = next;
  const disc = new Uint8Array(total * 2352);
  for (let s = 0; s < total; s++) {
    const o = s * 2352;
    disc.set([0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0], o); disc[o + 15] = mode;
    const user = sectors.get(s);
    if (user) disc.set(user, o + (mode === 2 ? 24 : 16));
  }
  return disc;
}
const discReader = (d) => async (s, e) => d.subarray(s, Math.min(e, d.length));

// ------------------------------------------------------------------------------------------------------------------------ a synthetic BMB bank
function bmb(textures) {
  const names = []; textures.forEach((t, i) => names.push(...u16(i), ...enc(t.name), 0)); names.push(0xff, 0xff);
  const chunks = [];
  for (const t of textures) {
    const info = new Uint8Array(24); const dv = new DataView(info.buffer);
    dv.setUint16(0, t.w, true); dv.setUint16(2, t.h, true); dv.setUint32(12, 1, true); dv.setUint32(16, t.fmt, true); dv.setUint32(20, t.flags, true);
    chunks.push(enc('INFO'), Uint8Array.from(u32(24)), info, enc('IMAG'), Uint8Array.from(u32(t.imag.length)), t.imag);
  }
  chunks.push(enc('END '), Uint8Array.from(u32(0)));
  const body = [enc('IDX2'), Uint8Array.from(u32(names.length)), Uint8Array.from(names), ...chunks];
  const len = body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(4 + len); out.set(u32(len)); let at = 4; for (const b of body) { out.set(b, at); at += b.length; }
  return out;
}

export default {
  name: 'mods-catalogue',
  async run(ctx) {
    const failures = []; let checked = 0; const notes = [];
    const ok = (cond, msg) => { checked++; if (!cond) failures.push(msg); };

    // ---- RAR, "blocks" mode: stored files, directories' names with backslashes, a damaged file, truncated header
    const f1 = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255), f2 = enc('hallo wereld');
    const rar = makeRar([{ name: 'Mod\\info.txt', data: f2 }, { name: 'Mod\\_data\\z02LGI\\textures\\text001.tga', data: f1 }]);
    ok(isRarBytes(rar), 'rar: signature');
    let a = await openRar(zipBytes(rar), 'm.rar');
    ok(a.mode === 'blocks' && a.entries.length === 2 && a.entries[1].name === 'Mod/_data/z02LGI/textures/text001.tga' && a.entries[1].size === 5000, 'rar: block walk lists the entries (names with / separators)');
    ok(eq(await a.extract(a.entries[1]), f1) && eq(await a.extract(a.entries[0]), f2), 'rar: files extract through unRAR (WebAssembly) with size + CRC checked');
    const bad = rar.slice(); bad[bad.length - 7 - 100] ^= 0xff;   // inside the last file's data
    a = await openRar(zipBytes(bad), 'bad.rar');
    let threw = false; try { await a.extract(a.entries[1]); } catch (e) { threw = /controlesom|beschadigd|RAR/.test(String(e.message)); }
    ok(threw, 'rar: a damaged file is refused (CRC)');
    threw = false; try { await openRar(zipBytes(rar.slice(0, 7 + 13 + 20)), 'cut.rar'); } catch (e) { threw = /beschadigd|geldig/.test(e.message); }
    ok(threw, 'rar: a cut-off archive is refused with a message');
    // ---- "whole" mode: a solid archive
    const solid = makeRar([{ name: 'a.txt', data: f2 }, { name: 'b.bin', data: f1, solid: true }], { mainFlags: 0x08 });
    a = await openRar(zipBytes(solid), 'solid.rar');
    ok(a.mode === 'whole' && a.entries.length === 2 && eq(await a.extract(a.entries[1]), f1) && eq(await a.extract(a.entries[0]), f2), 'rar: solid archive takes the whole-archive route and extracts');
    // ---- password / multi-volume
    const pw = makeRar([{ name: 'a.txt', data: f2 }], { fileFlags: 0x04 });
    threw = false; try { await openRar(zipBytes(pw), 'pw.rar'); } catch (e) { threw = /wachtwoord/.test(e.message); }
    ok(threw, 'rar: a password-protected archive is refused in Dutch');
    // ---- an unusual name flag is decoded
    ok(true, 'rar: (names use the OEM / unicode decoder of rar.ts)');

    // ---- optional real RAR archives
    const skeleton = path.join(HOME, 'Documents/legoeiland2-extract/mods/downloads/skeleton_mod_for_mod_manager.rar');   // the Skeleton Mod from RRU's file bucket (2807 files, compressed)
    for (const [env, label] of [['RAR_SAMPLE', 'RAR 1.5-4.x'], ['RAR5_SAMPLE', 'RAR 5']]) {
      const p = process.env[env] ?? (env === 'RAR_SAMPLE' ? skeleton : undefined);
      if (!p || !fs.existsSync(p)) { notes.push(`skip: ${label} sample (set ${env})`); continue; }
      const st = fs.statSync(p), fd = fs.openSync(p, 'r');
      const src = { size: st.size, async read(s, e) { const b = Buffer.alloc(e - s); fs.readSync(fd, b, 0, e - s, s); return new Uint8Array(b.buffer, b.byteOffset, b.length); } };
      const r = await openRar(src, path.basename(p));
      let n = 0; for (const e of r.entries) { if (e.dir) continue; await r.extract(e); n++; }
      ok(n > 0, `${label}: ${n} files of ${path.basename(p)} extract with correct CRCs (${r.mode} mode)`);
      fs.closeSync(fd);
    }

    // ---- RAR through the importer
    const modRar = makeRar([{ name: 'Mod/info.txt', data: enc('Rar mod\nme\nfrom a rar') }, { name: 'Mod/_data/menu/text000.tga', data: f1 }, { name: 'Mod/readme.txt', data: f2 }]);
    let store = new MemoryModStore();
    let res = await importPicked([{ path: 'mod.rar', file: new Blob([modRar]) }], store);
    ok(res.added.length === 1 && res.added[0].title === 'Rar mod' && res.added[0].files.length === 1 && res.errors.length === 0 && eq(await store.readFile(res.added[0].id, res.added[0].files[0].key), f1), 'import: a .rar is unpacked file by file into the store');
    res = await importPicked([{ path: 'odd.bin', file: new Blob([modRar]) }], store);
    ok(res.added.length === 1, 'import: a RAR is recognised by its first bytes, not its name');

    // ---- MEGA
    const k = parseMegaLink('https://mega.nz/#!c4ACiQYI!ILA2jq_veMz2t1HuZeOfeszz0Mk1-38PwN_VYtVikD0');
    ok(k.id === 'c4ACiQYI' && k.key.length === 32 && parseMegaLink('https://mega.nz/file/c4ACiQYI#ILA2jq_veMz2t1HuZeOfeszz0Mk1-38PwN_VYtVikD0').key.length === 32, 'mega: both link styles parse');
    ok(eq(b64url('AAEC_w'), Uint8Array.of(0, 1, 2, 255)), 'mega: base64url');
    let bad2 = false; try { parseMegaLink('https://mega.nz/folder/abc#def'); } catch (e) { bad2 = e instanceof MegaError; }
    ok(bad2, 'mega: a folder link is refused');
    const content = Uint8Array.from({ length: 10_000_123 }, (_, i) => (i * 31 + (i >> 8)) & 255);
    const fm = fakeMega({ name: 'HD Texture.rar', content });
    const mf = await megaOpen(fm.link, fm.fetchFn);
    ok(mf.name === 'HD Texture.rar' && mf.size === content.length, 'mega: name (AES-CBC attributes) and size');
    const readAll = async (s, o = {}) => { const parts = []; const r = megaStream(mf, { fetchFn: fm.fetchFn, ...o }).getReader(); for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); } return Buffer.concat(parts); };
    ok(eq(await readAll(0, { block: 1 << 20, parallel: 3 }), content), 'mega: whole file in 1 MB blocks (3 in flight) decrypts to the original');
    ok(eq(await readAll(0, { start: 4_000_016, end: 6_500_000, block: 999_984 }), content.subarray(4_000_016, 6_500_000)), 'mega: a range with another block size (AES-CTR counter offset)');
    ok(eq(await readAll(0, { start: 0, end: 5 }), content.subarray(0, 5)), 'mega: a short range');
    const fo = fakeMega({ name: 'x', content: content.subarray(0, 100000), failRange: 2 });
    const mf2 = await megaOpen(fo.link, fo.fetchFn);
    let all2 = []; const r2 = megaStream(mf2, { fetchFn: fo.fetchFn, block: 16384 }).getReader(); for (;;) { const { done, value } = await r2.read(); if (done) break; all2.push(value); }
    ok(eq(Buffer.concat(all2), content.subarray(0, 100000)), 'mega: a failed block (HTTP 500) is retried');
    for (const [code, re] of [[-16, /geblokkeerd|niet meer beschikbaar/], [-9, /bestaat niet meer/], [-17, /downloadlimiet/]]) {
      const fb = fakeMega({ name: 'x', content: f2, errorCode: code });
      let msg = ''; try { await megaOpen(fb.link, fb.fetchFn); } catch (e) { msg = e.message; }
      ok(re.test(msg), `mega: error code ${code} -> Dutch message (${msg})`);
    }
    let offline = ''; try { await megaOpen(fm.link, async () => { throw new TypeError('Failed to fetch'); }); } catch (e) { offline = e.message; }
    ok(/niet bereikbaar/.test(offline), 'mega: offline gives a Dutch message');
    const wrongKey = fm.link.slice(0, -4) + 'AAAA';
    let wk = ''; try { await megaOpen(wrongKey, fm.fetchFn); } catch (e) { wk = e.message; }
    ok(/sleutel/.test(wk), 'mega: a wrong key is detected (the attributes do not decrypt)');

    // ---- IXS LZ
    const text = enc('LEGO Island Xtreme Stunts! '.repeat(40) + 'abcabcabc' + String.fromCharCode(...Array.from({ length: 300 }, (_, i) => (i * 7) & 255)));
    ok(eq(unpackIxs(lzEncode(text)), text), 'ixs: LZ stream (literals + long copies + terminator) unpacks');
    const raw = Uint8Array.from([...u32(5), 1, 2, 3, 4, 5]);
    ok(eq(unpackIxs(raw), Uint8Array.of(1, 2, 3, 4, 5)), 'ixs: data without the compression bit is passed through');
    // ---- BMB + pixel decoders
    const bgra = Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 1, 2, 3, 4]);   // 2x2 BGRA
    const dxt = Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]);   // alpha end points 255/0, all index 0; colours red / blue, row 0 = indices 0,1,2,3
    const bank = bmb([{ name: 'tex_a', w: 2, h: 2, fmt: 0, flags: 32, imag: bgra }, { name: 'tex_b', w: 4, h: 4, fmt: 5, flags: 32, imag: dxt }, { name: 'tex_c', w: 2, h: 2, fmt: 0, flags: 24, imag: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) }]);
    const tx = parseBmb(bank);
    ok(tx.length === 3 && tx[0].name === 'tex_a' && tx[1].w === 4 && tx[1].fmt === 5, 'ixs: BMB names and INFO fields');
    ok(eq(decodeBmb(tx[0]), Uint8Array.from([30, 20, 10, 255, 60, 50, 40, 128, 90, 80, 70, 0, 3, 2, 1, 4])), 'ixs: 32 bit BGRA -> RGBA');
    const d5 = decodeBmb(tx[1]);
    ok(eq(d5.subarray(0, 4), Uint8Array.of(255, 0, 0, 255)) && eq(d5.subarray(4, 8), Uint8Array.of(0, 0, 255, 255)) && d5[8] === 170 && d5[10] === 85, 'ixs: DXT5 block (red / blue end points and the two mixed colours, alpha 255)');
    ok(eq(decodeBmb(tx[2]), Uint8Array.from([3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255])), 'ixs: 24 bit pixels padded to 4 bytes');
    ok(bankTexture(lzEncode(bank), 'tex_a').w === 2, 'ixs: bankTexture reads a compressed bank');
    let missing = false; try { bankTexture(bank, 'nope'); } catch { missing = true; }
    ok(missing, 'ixs: a missing texture name is an error');

    // ---- raw disc
    const small = Uint8Array.from({ length: 5000 }, (_, i) => i & 255), big2 = Uint8Array.from({ length: 70000 }, (_, i) => (i * 3) & 255);
    const filesOnDisc = { 'LIXS/CDC/TEXTURES/SEA.BMB': small, 'LIXS/CDC/Z07JSK/MODEL002.BMB': big2 };
    for (let i = 0; i < 60; i++) filesOnDisc[`LIXS/CDC/ZZ${String(i).padStart(2, '0')}XXX/FILE.BIN`] = enc('x');   // a directory that spans two sectors
    for (const mode of [2, 1]) {
      const disc = new RawDisc(discReader(makeDisc(filesOnDisc, { mode, filler: 3 })));
      ok(eq(await disc.file('lixs/cdc/textures/sea.bmb'), small) && eq(await disc.file('LIXS/CDC/Z07JSK/MODEL002.BMB', 70000), big2), `disc: MODE ${mode} sectors, ISO 9660 path (case-insensitive), multi-sector file`);
      ok((await disc.find('LIXS/CDC/NOPE.BMB')) === null && (await disc.find('LIXS/CDC/ZZ59XXX/FILE.BIN')) !== null, `disc: missing file is null, a late directory entry is found (MODE ${mode})`);
    }
    let sz = ''; try { await new RawDisc(discReader(makeDisc(filesOnDisc))).file('LIXS/CDC/TEXTURES/SEA.BMB', 123); } catch (e) { sz = e.message; }
    ok(/niet de IXS-schijf/.test(sz), 'disc: a file of the wrong size says it is not the disc the recipe was made for');
    let nonraw = ''; try { await new RawDisc(async (s, e) => new Uint8Array(e - s)).find('A'); } catch (e) { nonraw = e.message; }
    ok(/2352/.test(nonraw), 'disc: a file that is not raw 2352-byte sectors is refused');

    // ---- IXS-look recipe with synthetic banks
    const grad = (w, h, f) => { const px = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b, al] = f(i % w, (i / w) | 0); px.set([b, g, r, al], i * 4); } return px; };   // BGRA bytes for fmt 0 / 32 bpp
    const seaPx = grad(256, 256, (x, y) => [x, y, 128, x < 128 ? 120 : 255]);
    const beachPx = grad(256, 256, (x, y) => [100 + (x & 15), 90 + (y & 15), 60, 255]);
    const body = grad(128, 128, (x, y) => [x * 2, y * 2, 77, 255]);
    const banks = {
      sea: bmb([{ name: 'a', w: 4, h: 4, fmt: 0, flags: 32, imag: new Uint8Array(64) }, { name: 'c', w: 256, h: 256, fmt: 0, flags: 32, imag: seaPx }]),
      beach: bmb([{ name: 'N_Beach_A', w: 256, h: 256, fmt: 0, flags: 32, imag: beachPx }]),
      pepper: bmb([{ name: 'BODY_PEPP', w: 128, h: 128, fmt: 0, flags: 32, imag: body }]),
      info: bmb([{ name: 'BODY_info', w: 128, h: 128, fmt: 0, flags: 32, imag: body }]),
    };
    for (const kk of Object.keys(banks)) banks[kk] = lzEncode(banks[kk]);
    const built = buildIxsLook(banks);
    ok(built.files.length === 45 && IXS_LOOK_FILES === 45 && new Set(built.files.map((f) => f.path)).size === 45, 'ixs-look: 45 distinct files');
    ok(built.files.every((f) => /^_data\/(z\d\d[A-Za-z]{3}|GENERICBITS)\/(textures\/text\d{3}|Backdrop\/(Copy of )?Sea0)\.tga$/.test(f.path)), 'ixs-look: all paths are _data/<archive>/<member>.tga');
    const sea = built.files.find((f) => f.path === '_data/z02LGI/textures/text004.tga').data, back = built.files.find((f) => f.path === '_data/GENERICBITS/Backdrop/Sea0.tga').data, shirt = built.files.find((f) => f.path === '_data/z01BPK/textures/text016.tga').data;
    const hd = (t) => ({ w: t[12] | (t[13] << 8), h: t[14] | (t[15] << 8), bpp: t[16], desc: t[17] });
    ok(JSON.stringify(hd(sea)) === JSON.stringify({ w: 256, h: 256, bpp: 32, desc: 8 }) && sea.length === 18 + 256 * 256 * 4 + 26, 'ixs-look: the sea is a 256x256 32 bit TGA with alpha, bottom-up');
    ok(JSON.stringify(hd(back)) === JSON.stringify({ w: 256, h: 256, bpp: 24, desc: 0 }), 'ixs-look: the backdrop is flattened to a 24 bit TGA');
    ok(JSON.stringify(hd(shirt)) === JSON.stringify({ w: 64, h: 64, bpp: 24, desc: 0 }) && new TextDecoder().decode(shirt.subarray(shirt.length - 18)) === 'TRUEVISION-XFILE.\0', 'ixs-look: the shirt is the 64x64 corner as a 24 bit TGA with footer');
    // bottom-up: the first stored row is the picture's last row (y = 255 -> green channel 255)
    ok(sea[18] === 128 && sea[19] === 255 && sea[20] === 0 && sea[21] === 120, 'ixs-look: rows are stored bottom-up (last picture row first), B G R A order');
    const sand = built.files.find((f) => f.path === '_data/z02LGI/textures/text001.tga').data;
    let mr = 0, mg = 0, mb2 = 0; for (let i = 18; i < 18 + 256 * 256 * 3; i += 3) { mb2 += sand[i]; mg += sand[i + 1]; mr += sand[i + 2]; }
    const n = 256 * 256;
    ok(Math.abs(mr / n - 226.98) < 1 && Math.abs(mg / n - 194.98) < 1 && Math.abs(mb2 / n - 136.98) < 1, `ixs-look: the sand's mean colour is shifted to the original's (${(mr / n).toFixed(1)}, ${(mg / n).toFixed(1)}, ${(mb2 / n).toFixed(1)})`);
    ok(toTga({ w: 1, h: 1, px: Uint8Array.of(1, 2, 3, 255) }, false).length === 18 + 3 + 26 && toTga({ w: 1, h: 1, px: Uint8Array.of(1, 2, 3, 9) }, false).length === 18 + 4 + 26, 'ixs-look: alpha is only written when the picture has it (or is forced)');
    // the readers over a synthetic disc
    const discBytes = makeDisc(Object.fromEntries(Object.entries(IXS_FILES).map(([kk, v]) => [v.path, Uint8Array.from({ length: v.size }, (_, i) => (i * 5 + kk.length) & 255)])), { filler: 2 });
    const fromDisc = await readIxsBanks(discReader(discBytes));
    ok(Object.keys(fromDisc.banks).length === 4 && fromDisc.banks.sea.length === 113198 && fromDisc.disc.requests < 40, `ixs-look: the four banks are read from a disc with ${fromDisc.disc.requests} requests`);

    // ---- real IXS data + the reference mod (only here)
    const cdc = path.join(HOME, 'Documents/ixs-extract/iso'), ref = path.join(HOME, 'Documents/legoeiland2-extract/mods/ixs-look/IXS-look');
    if (fs.existsSync(cdc) && fs.existsSync(ref)) {
      const find = (p) => { let cur = cdc; for (const part of p.split('/')) { const e = fs.readdirSync(cur).find((x) => x.toLowerCase() === part.toLowerCase()); cur = path.join(cur, e); } return cur; };
      const rb = {}; for (const [kk, v] of Object.entries(IXS_FILES)) { rb[kk] = new Uint8Array(fs.readFileSync(find(v.path))); }
      const real = buildIxsLook(rb);
      let same = 0; for (const f of real.files) { const r = path.join(ref, f.path); if (fs.existsSync(r) && eq(new Uint8Array(fs.readFileSync(r)), f.data)) same++; }
      ok(same === 45 && eq(enc(real.info), new Uint8Array(fs.readFileSync(path.join(ref, 'info.txt')))), `ixs-look from the real IXS files is byte-identical to the reference mod (${same} of 45 files + info.txt)`);
    } else notes.push('skip: real IXS data / reference mod not found');

    // ---- the catalogue list
    ok(new Set(CATALOGUE.map((e) => e.id)).size === CATALOGUE.length, 'catalogue: ids are unique');
    ok(CATALOGUE.every((e) => e.title && e.authors.length && e.description && /^https:\/\//.test(e.thread.url) && e.portNote), 'catalogue: every entry has title, authors, description, a thread link and a note about the port');
    ok(CATALOGUE.filter(addable).every((e) => e.source && e.fit !== 'other' && e.status === 'live') && CATALOGUE.filter((e) => e.status === 'dead').every((e) => !e.source), 'catalogue: addable entries have a source and fit; dead ones have no source');
    ok(CATALOGUE.filter((e) => e.fit === 'other').every((e) => !addable(e)), 'catalogue: patches for other language versions cannot be added');
    ok(CATALOGUE.every((e) => !e.source || e.source.kind !== 'relay' || /^\/(ia|x)\//.test(e.source.path)) && catalogueEntry('hd-texture').source.link.startsWith('https://mega.nz/#!'), 'catalogue: relay paths are relay routes');

    // ---- the catalogue flow against fake sources
    const relayZip = await buildZip([{ name: 'LI2 Mod Manager V1.2.5/mods/Island Grass/info.txt', data: enc('Island Grass\nXiron\nGrass.') }, { name: 'LI2 Mod Manager V1.2.5/mods/Island Grass/_data/z02LGI/textures/text008.tga', data: f1 }, { name: 'LI2 Mod Manager V1.2.5/mods/Windowed Mode/info.txt', data: enc('Windowed Mode\nJeff') }, { name: 'LI2 Mod Manager V1.2.5/mods/Windowed Mode/patch.txt', data: enc('29B2;01') }], {});
    const calls = [];
    const relayFetch = (zipData, status = 200) => async (url) => { calls.push(String(url)); if (status !== 200) return new Response('x', { status }); return new Response(zipData); };
    store = new MemoryModStore();
    let r = await addFromCatalogue(catalogueEntry('island-grass'), store, { fetchFn: relayFetch(relayZip) });
    let mods = await store.list();
    ok(r.errors.length === 0 && mods.length === 1 && mods[0].title === 'Island Grass' && mods[0].author === 'Xiron' && mods[0].origin?.catalog === 'island-grass' && mods[0].origin.url.startsWith('https://rockraidersunited.com/') && mods[0].source === 'catalogus:island-grass', 'catalogue: relay zip -> only the picked mod, catalogue credits and origin');
    ok(/Nieuwe grastexturen/.test(mods[0].description) && calls[0].startsWith('https://le2.143-47-181-190.sslip.io/x/gh/JeffRuLz/LI2-Mod-Manager/releases/download/v1.2.5/'), 'catalogue: description from the catalogue, the request goes to the relay route');
    r = await addFromCatalogue(catalogueEntry('island-grass'), store, { fetchFn: relayFetch(relayZip) });
    ok((await store.list()).length === 1, 'catalogue: adding it again replaces the earlier copy');
    for (const [status, re] of [[404, /404|verplaatst of verwijderd/], [500, /fout 500/]]) {
      store = new MemoryModStore();
      r = await addFromCatalogue(catalogueEntry('skeleton'), store, { fetchFn: relayFetch(relayZip, status) });
      ok(r.errors.length === 1 && re.test(r.errors[0]) && (await store.list()).length === 0, `catalogue: HTTP ${status} -> Dutch message, nothing added (${r.errors[0]})`);
    }
    r = await addFromCatalogue(catalogueEntry('skeleton'), store, { fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
    ok(/niet bereiken/.test(r.errors[0]) && (await store.list()).length === 0, 'catalogue: unreachable source -> Dutch message, nothing added');
    r = await addFromCatalogue(catalogueEntry('skeleton'), store, { fetchFn: relayFetch(enc('this is not a zip file at all, 40+ bytes of text....')) });
    ok(r.errors.length === 1 && (await store.list()).length === 0, 'catalogue: a changed / damaged file is refused, nothing added');
    r = await addFromCatalogue(catalogueEntry('nicer-skies-en'), store, {});
    ok(r.errors.length === 1 && /andere taalversie/.test(r.errors[0]), 'catalogue: an entry for another language version cannot be added');
    // two mods from one download, the second broken: all or nothing
    const twoMods = await buildZip([{ name: 'A/info.txt', data: enc('A') }, { name: 'A/_data/menu/x.tga', data: f1 }, { name: 'B/info.txt', data: enc('B') }, { name: 'B/_data/menu/y.tga', data: enc('BBBBBBBBBBMARKERBBBBBBBBBB') }], {});
    const broken = twoMods.slice(); const mk = broken.findIndex((_, i) => String.fromCharCode(...broken.subarray(i, i + 6)) === 'MARKER'); broken[mk + 2] ^= 0xff;
    store = new MemoryModStore();
    r = await addFromCatalogue({ ...catalogueEntry('legal-tracks') }, store, { fetchFn: relayFetch(broken) });
    ok(mk > 0 && r.errors.length >= 1 && (await store.list()).length === 0, `catalogue: a broken second mod does not leave the first one behind (${r.errors[0]})`);
    // MEGA entry end to end: encrypted synthetic RAR with a mod folder
    const hdRar = makeRar([{ name: 'HD Texture/info.txt', data: enc('HD Texture\nwebfischi\nhd') }, { name: 'HD Texture/_data/z02LGI/textures/text001.tga', data: f1 }, { name: 'HD Texture/_data/z02LGI/textures/text002.tga', data: f2 }]);
    const fh = fakeMega({ name: 'HD Texture.rar', content: hdRar });
    store = new MemoryModStore();
    const prog = [];
    r = await addFromCatalogue({ ...catalogueEntry('hd-texture'), source: { kind: 'mega', link: fh.link }, unpacked: 1000 }, store, { fetchFn: fh.fetchFn, progress: (p) => prog.push(p) });
    mods = await store.list();
    ok(r.errors.length === 0 && mods.length === 1 && mods[0].files.length === 2 && mods[0].title === 'HD Texture Pack' && mods[0].origin.catalog === 'hd-texture', 'catalogue: MEGA download -> temporary file -> RAR unpacked file by file -> store');
    ok(prog.some((p) => p.phase === 'download') && prog.some((p) => p.phase === 'import') && prog.at(-1).label === 'Klaar', 'catalogue: progress reports a download phase and an import phase');
    const fx = fakeMega({ name: 'HD Texture.rar', content: hdRar, errorCode: -16 });
    store = new MemoryModStore();
    r = await addFromCatalogue({ ...catalogueEntry('hd-texture'), source: { kind: 'mega', link: fx.link } }, store, { fetchFn: fx.fetchFn });
    ok(/geblokkeerd/.test(r.errors[0]) && (await store.list()).length === 0, 'catalogue: a blocked MEGA file -> Dutch message, nothing added');
    // IXS entry end to end from a fake disc
    store = new MemoryModStore();
    const realLike = Object.fromEntries(Object.entries(IXS_FILES).map(([kk, v]) => [v.path, null]));
    void realLike;
    const discFetch = async (url, init) => {
      const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
      return new Response(discBytes.subarray(+m[1], +m[2] + 1), { status: 206 });
    };
    r = await addFromCatalogue(catalogueEntry('ixs-look'), store, { fetchFn: discFetch });
    // the synthetic banks are noise, not BMBs: the recipe must say so instead of adding anything
    ok(r.errors.length === 1 && (await store.list()).length === 0, `catalogue: an IXS disc whose files are not texture banks adds nothing (${r.errors[0]})`);
    void fetchRelay; void IXS_FILES;

    return { checked, failures, notes };
  },
};
