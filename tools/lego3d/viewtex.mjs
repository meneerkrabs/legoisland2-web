#!/usr/bin/env node
// node tools/lego3d/viewtex.mjs out.png cell file.tga|zone#id ...   contact sheet of mod textures (.tga) and/or game textures (zone#id), side by side for before / after
import fs from 'node:fs';
import { parseTga } from '../../src/formats/tga.ts';
import { archive, textureOf, contactSheet } from './lib.mjs';
const [out, cell, ...items] = process.argv.slice(2);
contactSheet(out, items.map((s) => { if (s.includes('#')) { const [z, id] = s.split('#'); return textureOf(archive(z), +id); } const t = parseTga(new Uint8Array(fs.readFileSync(s))); return { width: t.width, height: t.height, rgba: t.rgba }; }), +cell, Math.min(items.length, 4));
