#!/usr/bin/env node
// Catalogue of the LDraw plates / bricks with a true 45-degree edge in plan (docs/re/lego3d.md section 16.11): for every plain part up to 8 studs and 3.5 plates high the convex hull of its footprint (bottom plane,
// stud units); a part is listed when a hull edge runs 45 degrees between stud corners (dx = dz, whole studs). Used to find the cut-corner plates of tools/lego3d/bldg-wedge.mjs (26601, 2450, 30503, 6106, 2639, 30504, tiles 5091 / 5092).
//   node tools/lego3d/wedge-catalog.mjs | grep -v -E "^[0-9]+p|Pattern"
import fs from 'node:fs'; import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW } from './lib.mjs';
const dir = path.join(LDRAW,'lib/ldraw'); const lib = new LDrawLib(dir);
function hull(P){P=[...P].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[];for(const p of P){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=1e-9)lo.pop();lo.push(p);}const up=[];for(const p of [...P].reverse()){while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=1e-9)up.pop();up.push(p);}return lo.slice(0,-1).concat(up.slice(0,-1));}
const files = fs.readdirSync(path.join(dir,'parts')).filter(f=>/^\d+[a-z]?\.dat$/.test(f));
for (const f of files){
  const t = fs.readFileSync(path.join(dir,'parts',f),'utf8').split('\n')[0].slice(2).trim();
  if(/Moved|Technic|Duplo|Hinge|Sticker|Baseplate|Train|Rail|Road|Boat|Minifig|Gear|Heart|Star|Cloud/i.test(t)) continue;
  let fl; try{ fl = lib.flatten(f,{res:'low'});}catch(e){continue;}
  const tr=fl.tris; if(!tr.length)continue; let ymin=1e9,ymax=-1e9,x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  for(let i=0;i<tr.length;i+=3){x0=Math.min(x0,tr[i]);x1=Math.max(x1,tr[i]);ymin=Math.min(ymin,tr[i+1]);ymax=Math.max(ymax,tr[i+1]);z0=Math.min(z0,tr[i+2]);z1=Math.max(z1,tr[i+2]);}
  const H=(ymax-ymin)/8, W=(x1-x0)/20, D=(z1-z0)/20; if(H>3.6||W>8.1||D>8.1) continue;
  const B=[];const s2=new Set();for(let i=0;i<tr.length;i+=3){if(Math.abs(tr[i+1]-ymax)<0.5){const k=[+((tr[i]-x0)/20).toFixed(2),+((tr[i+2]-z0)/20).toFixed(2)];const ks=k.join();if(!s2.has(ks)){s2.add(ks);B.push(k);}}}
  if(B.length<3)continue; const h=hull(B); let diag=0;
  for(let i=0;i<h.length;i++){const a=h[i],b=h[(i+1)%h.length];const dx=Math.abs(b[0]-a[0]),dz=Math.abs(b[1]-a[1]);if(dx>0.95&&Math.abs(dx-dz)<0.06&&Math.abs(dx-Math.round(dx))<0.08)diag++;}
  if(diag) console.log(f.replace('.dat',''),'|',t,'| H',H.toFixed(2),'|',h.map(p=>`(${p})`).join(''));
}
