import fs from 'node:fs'; import path from 'node:path'; import {collapse} from './collapse.mjs';
const X='/tmp/le2-unused/story/x';
const rows=JSON.parse(fs.readFileSync('rows.json','utf8'));
const S=JSON.parse(fs.readFileSync('exestr.json','utf8')).join('\n').toLowerCase().replace(/\\/g,'/');
// used scripts: txt with same-stem .cut named in the EXE (named flag) in same dir
const cutNamed=new Set(rows.filter(r=>r.ext==='cut'&&r.named===true).map(r=>r.a+'/'+r.sub+'/'+r.stem));
const corpus={}; const usedTxt=[], unusedTxt=[];
for(const r of rows.filter(r=>r.ext==='txt'&&/cutscene/i.test(r.sub))){
  const used=cutNamed.has(r.a+'/'+r.sub+'/'+r.stem);
  (used?usedTxt:unusedTxt).push(r.a+'/'+r.base);
  if(used) corpus[r.a]=(corpus[r.a]||'')+'\n'+fs.readFileSync(path.join(X,r.rel),'latin1').toLowerCase().replace(/\\/g,'/');
}
console.log('used scripts',usedTxt.length,'unused/source-only .txt',unusedTxt.length); console.log(unusedTxt.join(' '));
const unref={};
for(const ext of ['man','cam','wpt','way','h','wbt','blk']){
 for(const r of rows.filter(r=>r.ext===ext)){
  const key=r.stem; const c=corpus[r.a]||'';
  const inScript=c.includes(key)||c.includes(r.base);
  const inExe=S.includes(r.base)||S.includes(r.stem);
  r.refd = inScript?'script':inExe?'exe':null;
  if(!r.refd){ const k=ext+' '+r.a+'/'+r.sub; (unref[k]??=[]).push(r.stem); }
 }
}
for(const k of Object.keys(unref).sort()) console.log('##',k,unref[k].length,collapse(unref[k]).join(' ').slice(0,900));
