import fs from 'node:fs'; import path from 'node:path';
const X='/tmp/le2-unused/story/x';
const S=JSON.parse(fs.readFileSync('exestr.json','utf8')).map(s=>s.toLowerCase().replace(/\\/g,'/'));
const blob='\n'+S.join('\n')+'\n';
const zones=JSON.parse(fs.readFileSync('zones.json','utf8'));
function* walk(d){ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); if(e.isDirectory()) yield* walk(p); else yield p; } }
const bricknames=new Set(fs.readFileSync(X+'/Bricks/brickset.txt','latin1').split(/\r?\n/).filter(l=>l&&!l.startsWith('//')).map(l=>l.split(/\s+/)[0].toLowerCase()));
const rows=[];
for(const a of fs.readdirSync(X)){
  for(const f of walk(path.join(X,a))){
    const rel=path.relative(X,f).replace(/\\/g,'/');
    const st=fs.statSync(f).size;
    const base=path.basename(f).toLowerCase(); const stem=base.replace(/\.[^.]+$/,''); const ext=path.extname(f).slice(1).toLowerCase();
    const sub=rel.split('/').slice(1,-1).join('/').toLowerCase();
    rows.push({a,rel,sub,base,stem,ext,size:st});
  }
}
console.log(rows.length);
const has = s => blob.includes(s.toLowerCase());
const out=[];
for(const r of rows){
  let named = false, how='';
  if(r.ext==='msh'||r.ext==='col'){
    const z=zones[r.a]; if(z){ const key=(r.sub+'/'+r.base); const rl=(r.ext==='msh'?z.meshAll:z.colAll); if(rl.includes(key)) {named=true;how='loader';} }
  }
  if(!named && r.a==='Bricks' && r.sub==='lods'){ const nm=r.stem.replace(/_lod\d+$/,''); if(bricknames.has(nm)){named=true;how='brickset';} }
  if(!named && blob.includes('/'+r.a.toLowerCase()+'/'+(r.sub?r.sub+'/':'')+r.base+'\n')) {named=true;how='exact-path';}
  if(!named && !['msh','col','man','blk','wpt','way','par','app','emi','mov','swl','cam','cut'].includes(r.ext) && blob.includes('/'+r.base+'\n')) {named=true;how='exact-name';}
  if(!named && (r.ext==='tga'||r.ext==='wib') && /^text\d+$/.test(r.stem)) {named=null;how='texid';}
  if(!named && named!==null && r.stem.length>=3 && blob.includes(r.stem)) {named=true;how='stem-substr';}
  r.named=named; r.how=how;
}
fs.writeFileSync('rows.json',JSON.stringify(rows));
const tab={};
for(const r of rows){ const k=r.ext; tab[k]??={n:0,named:0,tex:0,unnamed:0,bytes:0}; tab[k].n++; if(r.named===true)tab[k].named++; else if(r.named===null)tab[k].tex++; else {tab[k].unnamed++; tab[k].bytes+=r.size;} }
console.table(tab);
