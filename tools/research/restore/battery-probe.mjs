// probe: the ten BTB records at story node 56 (research for the battery feature)
import fs from 'node:fs'; import path from 'node:path';
import { Archive } from '../../../src/formats/archive.ts';
import { loadIsland } from '../../lib/island-load.mjs';
const dataRoot = 'public/data/le2', dir = path.join(dataRoot, '_data');
const archives = fs.readdirSync(dir).filter((f) => f.endsWith('.bod')).map((f) => { const n = f.slice(0, -4); return new Archive(n, fs.readFileSync(path.join(dir, n + '.bod')), fs.readFileSync(path.join(dir, n + '.bob'))); });
const ctx = { dataRoot, archives };
const I = loadIsland(ctx, { node: 56 });
for (let i = 295; i <= 304; i++) { const r = I.world.records[i]; const t = I.world.col?.terrainHeight?.(r.x, r.z); console.log(i, r.name, r.flags.toString(16), r.x.toFixed(1), r.y.toFixed(1), r.z.toFixed(1), 'model', !!r.model, 'col', !!r.colObj, 'ctrl', !!r.ctrl, 'terr', t); }
console.log('var22', I.vars.get(22), 'var225', I.vars.get(225), 'names', I.vars.nameOf(22), I.vars.nameOf(225), I.vars.nameOf(0x22));
console.log(Object.keys(I.world).join(','));
for (const r of I.world.records) for (const n of r.ctrl?.nodes ?? []) if (n.kind === 'BOTMUSIC' || n.kind === 'GETO') console.log(r.index, r.name, n.kind, 'var', n.var, n.mask, n.value);
console.log('anim dj_throw', I.ictx.animClip('dj_throw'));
const k=[...I.ictx.setup.dictionaries.anims.keys()]; console.log(k.length, k.filter(x=>/THROW|DJ/i.test(x)), k.slice(0,5));
