import fs from 'node:fs'; import path from 'node:path';
const R='/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds';
const S=JSON.parse(fs.readFileSync('exestr.json','utf8')).map(s=>s.toLowerCase().replace(/\\/g,'/').replace(/\/+/g,'/'));
const exeSet=new Set(); const exeBase=new Set();
for(const s of S){ if(/\.(wav|mp3|sty|sgt|dls|mid|midi)\b/.test(s)){ exeSet.add(s); exeBase.add(s.split('/').pop()); } }
function* walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) yield* walk(p); else yield p; } }
const files=[...walk(R)].map(f=>({f,rel:path.relative(R,f).replace(/\\/g,'/'),size:fs.statSync(f).size}));
const by={};
for(const x of files){ const top=x.rel.split('/')[0]; const ext=path.extname(x.rel).toLowerCase(); const k=top+' '+ext; by[k]=(by[k]||0)+1; }
console.log(files.length); console.log(Object.entries(by).sort().map(([k,v])=>v+' '+k).join('\n'));
const unref=[];
for(const x of files){ const ext=path.extname(x.rel).toLowerCase(); if(!['.wav','.sty','.sgt','.dls','.mid','.midi'].includes(ext)) continue; const rl=x.rel.toLowerCase(); const b=rl.split('/').pop(); const full=exeSet.has('_data/sounds/'+rl); const bs=exeBase.has(b); x.exe=full?'path':bs?'basename':null; if(!x.exe) unref.push(x); }
console.log('unref (wav/dm)',unref.length, 'bytes',unref.reduce((a,x)=>a+x.size,0));
fs.writeFileSync('snd-unref.json',JSON.stringify(unref));
const g={}; for(const x of unref){ const k=x.rel.split('/').slice(0,-1).join('/'); (g[k]??=[]).push(path.basename(x.rel)+' '+Math.round(x.size/1024)+'k'); }
for(const k of Object.keys(g).sort()) console.log('##',k,g[k].length,'\n'+g[k].join(', '));
