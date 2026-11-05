#!/usr/bin/env node
// Contact sheet of PNGs (headless chromium, no window): node tools/fx-sheet.mjs <out.png> <cols> <thumbWidth> <a.png> [b.png ...]   (a label under each tile = the file name)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [out, cols, tw, ...files] = process.argv.slice(2);
if (!out || !files.length) { console.error('usage: node tools/fx-sheet.mjs <out.png> <cols> <thumbWidth> <png...>'); process.exit(1); }
const W = +tw, C = +cols;
const html = `<body style="margin:0;background:#222;color:#ddd;font:11px monospace"><div style="display:grid;grid-template-columns:repeat(${C},${W}px);gap:4px;padding:4px">${files.map((f) => `<div><img style="width:${W}px;display:block" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"><div>${path.basename(f)}</div></div>`).join('')}</div></body>`;
const b = await chromium.launch({ headless: true, args: ['--mute-audio'] });
const p = await b.newPage({ viewport: { width: C * (W + 4) + 8, height: 400 } });
await p.setContent(html);
await p.waitForLoadState('load');
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
