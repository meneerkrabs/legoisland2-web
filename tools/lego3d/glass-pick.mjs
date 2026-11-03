#!/usr/bin/env node
// Camera positions INSIDE a building that look at its glass (docs/re/lego3d.md section 16.10): in mesh space, a grid of points (0.5 units, four heights) that are room points (at least three of the four horizontal
// directions and the ceiling end on a front-facing surface within 30 units, the other three directions too), with the game's own culled BACK face of a glass group `g` between 4.6 and 9 units ahead in one of the four
// directions (the game's near plane is 4.0 in the island: a pane closer than that is not drawn at all). Prints the best candidates with eye / target in world coordinates (the record's matrix applied).
//   node tools/lego3d/glass-pick.mjs z02LGI SHP2 shop02_LOD1 0          (zone, record, mesh without .Msh, glass group indices)  ->  CAMS="SHP2:ex,ey,ez:tx,ty,tz:label" for tools/lego3d/steps/glass-look.mjs
import { archive, memberOf, scene } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { transformPoint } from '../../src/render/math.ts';
const [zone, rec, mesh, ...rest] = process.argv.slice(2);
const a = archive(zone), sc = scene(zone);
const r = sc.records.find(x=>x.name===rec);
const m = parseMsh(a.read(a.find('Meshes/'+mesh+'.Msh')));
const gm = groupMatrices(m);
const cross=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],dot=(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2];
const T=[];
m.groups.forEach((g,gi)=>{for(let i=0;i<g.indexCount;i+=3){const P=[0,1,2].map(k=>{const v=m.indices[g.firstIndex+i+k]+g.firstVertex,p=[m.positions[v*3],m.positions[v*3+1],m.positions[v*3+2]];return gm[gi]?transformPoint(gm[gi],p):p;});const e1=P[1].map((q,j)=>q-P[0][j]),e2=P[2].map((q,j)=>q-P[0][j]);T.push({g:gi,P,e1,e2,n:cross(e1,e2)});}});
function cast(o,d){let front=1e30,back=1e30,bg=-1;for(const t of T){const h=cross(d,t.e2),A=dot(t.e1,h);if(Math.abs(A)<1e-12)continue;const f=1/A,s=[o[0]-t.P[0][0],o[1]-t.P[0][1],o[2]-t.P[0][2]],u=f*dot(s,h);if(u<0||u>1)continue;const q=cross(s,t.e1),v=f*dot(d,q);if(v<0||u+v>1)continue;const tt=f*dot(t.e2,q);if(tt<1e-4)continue;if(dot(t.n,d)<0){if(tt<front)front=tt;}else if(tt<back){back=tt;bg=t.g;}}return{front,back,bg};}
const D=[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
const glassG = rest.map(Number);
const best=[];
for (const y of [1.5,2.5,3.5,5.5]) for(let x=-30;x<=30;x+=0.5) for(let z=-30;z<=30;z+=0.5){const o=[x,y,z];const rs=D.map(d=>cast(o,d));const up=cast(o,[0,1,0]);
 if(rs.filter(q=>q.front<30).length<3||!(up.front<30))continue;
 rs.forEach((q,di)=>{ if(glassG.includes(q.bg)&&q.back<q.front&&q.back<9&&q.back>4.6&&rs.filter((_,i)=>i!==di).every(z=>z.front<30)){ // glass seen from inside: back hit before any front
   const opp=rs[di^1]; if(opp.front<30) best.push({o,di,dist:q.back,g:q.bg,opp:opp.front}); }});}
best.sort((p,q)=>Math.abs(p.dist-5.5)-Math.abs(q.dist-5.5));
const M=r.matrix; const xf=(p)=>[p[0]*M[0]+p[1]*M[4]+p[2]*M[8]+M[12],p[0]*M[1]+p[1]*M[5]+p[2]*M[9]+M[13],p[0]*M[2]+p[1]*M[6]+p[2]*M[10]+M[14]];
console.log(best.length,'candidates; record',rec,r.pos.map(v=>+v.toFixed(2)),'rot',r.rot.map(v=>+v.toFixed(3)));
for(const b of best.slice(0,6)){const tgt=[b.o[0]+D[b.di][0]*b.dist,b.o[1]+D[b.di][1]*b.dist,b.o[2]+D[b.di][2]*b.dist];console.log(JSON.stringify(b),'world eye',xf(b.o).map(v=>+v.toFixed(2)),'tgt',xf(tgt).map(v=>+v.toFixed(2)));}
