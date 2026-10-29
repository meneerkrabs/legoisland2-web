import fs from 'node:fs'; import path from 'node:path';
const R='/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/DirectMusic';
const S=JSON.parse(fs.readFileSync('exestr.json','utf8')).join('\n').toLowerCase().replace(/\\/g,'/');
function* walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) yield* walk(p); else yield p; } }
const files=[...walk(R)].map(f=>({f,rel:path.relative(R,f).replace(/\\/g,'/')}));
const sgt=files.filter(x=>/\.sgt$/i.test(x.rel)), sty=files.filter(x=>/\.sty$/i.test(x.rel)), dls=files.filter(x=>/\.dls$/i.test(x.rel));
const u16=s=>Buffer.from(s,'utf16le');
const refs=new Map(); 
for(const g of sgt){ const b=fs.readFileSync(g.f); const hit=[]; for(const t of sty){ const nm=path.basename(t.rel,'.sty'); if(b.includes(u16(nm))||b.includes(Buffer.from(nm,'latin1'))) hit.push(t.rel); } refs.set(g.rel,hit); }
const sgtUsed=sgt.filter(g=>S.includes(path.basename(g.rel).toLowerCase())||S.includes(g.rel.toLowerCase()));
console.log('sgt',sgt.length,'named in EXE',sgtUsed.length);
console.log('UNNAMED sgt:',sgt.filter(g=>!sgtUsed.includes(g)).map(g=>g.rel).join(' | '));
const usedSty=new Set(); for(const g of sgtUsed) for(const h of refs.get(g.rel)) usedSty.add(path.basename(h).toLowerCase());
const orphanSty=sty.filter(t=>!usedSty.has(path.basename(t.rel).toLowerCase())&&!S.includes(path.basename(t.rel).toLowerCase()));
console.log('sty',sty.length,'referenced via used sgt/exe',sty.length-orphanSty.length,'orphan',orphanSty.length);
console.log(orphanSty.map(x=>x.rel).join(' | '));
console.log('DLS',dls.map(x=>x.rel+' named='+S.includes(path.basename(x.rel).toLowerCase())).join(' | '));
