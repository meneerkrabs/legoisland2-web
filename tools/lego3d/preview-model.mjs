#!/usr/bin/env node
// node tools/lego3d/preview-model.mjs <zone> <mesh-name-regexp> [--lod 0] [--views front,side,three] [--out name]
// Renders the model that uses that mesh as its first part (bind pose, with attachments) to PNGs under $LE2_LEGO3D/preview/<name>_<view>.png through headless Blender.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { scene, archive, WORK } from './lib.mjs';
import { modelParts, writePreviewScene, baseName } from './modelio.mjs';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); if (i < 0) return d; const v = a[i + 1]; a.splice(i, 2); return v; };
const poseArg = opt('--pose', ''), pose = poseArg ? poseArg.split(':').map(Number) : null;
const li = +opt('--lod', 0), views = opt('--views', 'front,side,three').split(','), name = opt('--out', '');
const cullFlag = a.includes('--cull'); if (cullFlag) a.splice(a.indexOf('--cull'), 1);
const [zone, rx] = a;
const sc = scene(zone), re = new RegExp(rx, 'i');
const model = sc.models.find((m) => m.parts.some((p) => re.test(baseName(sc.meshPaths[p.mesh] ?? ''))));
if (!model) { console.error('no model'); process.exit(1); }
const parts = modelParts(zone, model, li, sc, pose);
const nm = name || `${zone}_${rx.replace(/\W/g, '')}_lod${li}`;
const focusArg = opt('--focus', ''), focus = focusArg ? focusArg.split(',').map(Number) : null;
const scale = +opt('--scale', 0);
const js = writePreviewScene(nm, parts, archive(zone), { ...(focus ? { focus, scale } : {}), ...(cullFlag ? { cull: true } : {}) });
const BL = '/Applications/Blender.app/Contents/MacOS/Blender';
execFileSync(BL, ['-b', '-P', path.join(path.dirname(new URL(import.meta.url).pathname), 'blender/preview.py'), '--', js, path.join(WORK, 'preview', nm), ...views], { stdio: ['ignore', 'inherit', 'inherit'] });
