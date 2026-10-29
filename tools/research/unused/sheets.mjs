import fs from 'node:fs'; import path from 'node:path';
import { png, loadTex } from './tex.mjs';
const X='/tmp/le2-unused/story/x';
const tr=JSON.parse(fs.readFileSync('texres.json','utf8'));
function thumb(t,S){ const out=new Uint8Array(S*S*4); // bottom-first source -> make top-down output
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){ const sx=Math.min(t.w-1,Math.floor(x*t.w/S)), sy=Math.min(t.h-1,Math.floor(y*t.h/S)); const srow=t.h-1-sy; const si=(srow*t.w+sx)*4, o=(y*S+x)*4; const a=t.rgba[si+3]/255; // composite over checker
    const chk=((x>>3)+(y>>3))&1?90:60; out[o]=t.rgba[si]*a+chk*(1-a); out[o+1]=t.rgba[si+1]*a+chk*(1-a); out[o+2]=t.rgba[si+2]*a+chk*(1-a); out[o+3]=255; }
  return out; }
export function sheet(items,name,cols=8,S=96){ // items: [{file,label}]
  const rowsN=Math.ceil(items.length/cols); const W=cols*S,H=rowsN*S; const buf=new Uint8Array(W*H*4).fill(30);
  items.forEach((it,i)=>{ try{ const t=loadTex(it.file); const th=thumb(t,S-4); const cx=(i%cols)*S+2, cy=Math.floor(i/cols)*S+2; for(let y=0;y<S-4;y++)for(let x=0;x<S-4;x++){ const o=((cy+y)*W+cx+x)*4, s=(y*(S-4)+x)*4; buf[o]=th[s];buf[o+1]=th[s+1];buf[o+2]=th[s+2];buf[o+3]=255; } }catch(e){ console.log('ERR',it.file,e.message); } });
  fs.writeFileSync(`/tmp/le2-unused/sheets/${name}.png`,png(W,H,buf,true));
  fs.writeFileSync(`/tmp/le2-unused/sheets/${name}.txt`,items.map((it,i)=>`r${Math.floor(i/cols)}c${i%cols} ${it.label}`).join('\n'));
}
if(process.argv[1].endsWith('sheets.mjs')){
  let all=[]; for(const [z,v] of Object.entries(tr)) for(const b of v.unlisted){ const f=path.join(X,z,'textures',b); all.push({file:f,label:z+'/'+b}); }
  for(let i=0;i<all.length;i+=40) sheet(all.slice(i,i+40),'unlisted-'+(i/40),8,96);
  console.log(all.length,'unlisted textures');
}
