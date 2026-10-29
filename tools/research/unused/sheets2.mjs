import fs from 'node:fs'; import path from 'node:path';
import { sheet } from './sheets.mjs';
const X='/tmp/le2-unused/story/x';
const rows=JSON.parse(fs.readFileSync('rows.json','utf8'));
const un=rows.filter(r=>r.ext==='tga'&&r.named!==true&&r.named!==null);
console.log(un.length);
const g={}; for(const r of un){ const k=r.a+'/'+r.sub; (g[k]??=[]).push(r.base); }
for(const k of Object.keys(g)) console.log(k,g[k].length,g[k].slice(0,40).join(' '));
const items=un.map(r=>({file:path.join(X,r.rel),label:r.rel}));
for(let i=0;i<items.length;i+=40) sheet(items.slice(i,i+40),'overlay-unnamed-'+(i/40),8,96);
