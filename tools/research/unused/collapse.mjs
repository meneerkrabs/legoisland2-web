import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync('rows.json','utf8'));
export function collapse(names){
  // group by prefix with trailing digits
  const g=new Map(); const single=[];
  for(const n of names){ const m=n.match(/^(.*?)(\d+)$/); if(m){ const k=m[1]; if(!g.has(k)) g.set(k,[]); g.get(k).push(+m[2]); } else single.push(n); }
  const out=[...single];
  for(const [k,v] of g){ if(v.length>=3){ v.sort((a,b)=>a-b); out.push(`${k}{${v[0]}..${v[v.length-1]}}x${v.length}`); } else for(const x of v) out.push(k+x); }
  return out.sort();
}
if(process.argv[1].endsWith('collapse.mjs')){
  const ext=process.argv[2]; 
  const by={};
  for(const r of rows){ if(r.ext!==ext||r.named===true||r.named===null) continue; const k=r.a+'/'+r.sub; (by[k]??=[]).push(r.base.replace(/\.[^.]+$/,'')); }
  for(const k of Object.keys(by).sort()) console.log('##',k,by[k].length,'\n'+collapse(by[k]).join(' '));
}
