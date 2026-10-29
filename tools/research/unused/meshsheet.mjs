import fs from 'node:fs'; import path from 'node:path';
import { parseMsh } from '/Users/sander/Documents/legoeiland2-web/src/formats/msh.ts';
import { png } from './tex.mjs';
const X='/tmp/le2-unused/story/x';
function render(file,S){
  const m=parseMsh(fs.readFileSync(file)); const buf=new Uint8Array(S*S*4); const zb=new Float32Array(S*S).fill(1e9);
  for(let i=0;i<S*S;i++){buf[i*4]=28;buf[i*4+1]=30;buf[i*4+2]=36;buf[i*4+3]=255;}
  const P=m.positions; let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<m.vertexCount;i++)for(let k=0;k<3;k++){mn[k]=Math.min(mn[k],P[i*3+k]);mx[k]=Math.max(mx[k],P[i*3+k]);}
  const c=[0,1,2].map(k=>(mn[k]+mx[k])/2), r=Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])/2||1;
  const ya=0.7, pa=0.45, cy=Math.cos(ya), sy=Math.sin(ya), cp=Math.cos(pa), sp=Math.sin(pa);
  const tr=(x,y,z)=>{x=(x-c[0])/r;y=(y-c[1])/r;z=(z-c[2])/r; const x1=x*cy+z*sy, z1=-x*sy+z*cy; const y2=y*cp-z1*sp, z2=y*sp+z1*cp; return [x1,y2,z2];};
  const pal=[[220,90,80],[90,170,230],[240,200,70],[110,210,120],[200,120,220],[240,150,60],[160,160,170],[90,220,200]];
  for(let gi=0;gi<m.groups.length;gi++){ const g=m.groups[gi]; const col=pal[gi%pal.length];
    for(let t=0;t<g.indexCount;t+=3){ const ia=m.indices[g.firstIndex+t]+g.firstVertex, ib=m.indices[g.firstIndex+t+1]+g.firstVertex, ic=m.indices[g.firstIndex+t+2]+g.firstVertex;
      const A=tr(P[ia*3],P[ia*3+1],P[ia*3+2]),B=tr(P[ib*3],P[ib*3+1],P[ib*3+2]),C=tr(P[ic*3],P[ic*3+1],P[ic*3+2]);
      const ux=B[0]-A[0],uy=B[1]-A[1],uz=B[2]-A[2],vx=C[0]-A[0],vy=C[1]-A[1],vz=C[2]-A[2]; let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx; const nl=Math.hypot(nx,ny,nz)||1; nx/=nl;ny/=nl;nz/=nl;
      const sh=0.35+0.65*Math.abs(nx*0.3+ny*0.6-nz*0.7);
      const sx=p=>(p[0]*0.45+0.5)*S, sy2=p=>(0.5-p[1]*0.45)*S;
      const x0=sx(A),y0=sy2(A),x1=sx(B),y1=sy2(B),x2=sx(C),y2=sy2(C);
      const minx=Math.max(0,Math.floor(Math.min(x0,x1,x2))),maxx=Math.min(S-1,Math.ceil(Math.max(x0,x1,x2))),miny=Math.max(0,Math.floor(Math.min(y0,y1,y2))),maxy=Math.min(S-1,Math.ceil(Math.max(y0,y1,y2)));
      const den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2); if(Math.abs(den)<1e-9) continue;
      for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){ const px=x+0.5,py=y+0.5; const a=((y1-y2)*(px-x2)+(x2-x1)*(py-y2))/den, b=((y2-y0)*(px-x2)+(x0-x2)*(py-y2))/den, cc=1-a-b; if(a<-0.001||b<-0.001||cc<-0.001) continue; const z=a*A[2]+b*B[2]+cc*C[2]; const o=y*S+x; if(z<zb[o]){zb[o]=z; buf[o*4]=col[0]*sh;buf[o*4+1]=col[1]*sh;buf[o*4+2]=col[2]*sh;} }
    } }
  return {buf, tris:m.indices.length/3, verts:m.vertexCount, dim:[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]].map(v=>+v.toFixed(1))};
}
export function msheet(items,name,cols=6,S=140){
  const rowsN=Math.ceil(items.length/cols),W=cols*S,H=rowsN*S; const out=new Uint8Array(W*H*4).fill(10); const lines=[];
  items.forEach((it,i)=>{ try{ const r=render(it.file,S-4); const cx=(i%cols)*S+2,cy=Math.floor(i/cols)*S+2; for(let y=0;y<S-4;y++)for(let x=0;x<S-4;x++){const o=((cy+y)*W+cx+x)*4,s=(y*(S-4)+x)*4;out[o]=r.buf[s];out[o+1]=r.buf[s+1];out[o+2]=r.buf[s+2];out[o+3]=255;} lines.push(`r${Math.floor(i/cols)}c${i%cols} ${it.label} tris=${r.tris} dim=${r.dim}`);}catch(e){lines.push(`ERR ${it.label} ${e.message}`);} });
  fs.writeFileSync(`/tmp/le2-unused/sheets/${name}.png`,png(W,H,out,true)); fs.writeFileSync(`/tmp/le2-unused/sheets/${name}.txt`,lines.join('\n')); console.log(lines.join('\n'));
}
if(process.argv[1].endsWith('meshsheet.mjs')){
  const L=(z,names)=>names.map(n=>({file:path.join(X,z,'meshes',n+'.msh'),label:z+'/'+n}));
  msheet([...L('z27TRX',['boulder1','boulder10','lava1','lavastream','statue5','stump_burnt1','logs_short1','volcano3','eggs1','swing_log1','pter_pterodactyl','test2','collision_cube1','sky_back_3']),
          ...L('z02LGI',['ferry','mfig_bill','mfig_brickbot0','mfig_brickster','mfig_pepper','police_chopper','steam_train','sandboard1','platform1','platform_arm1','speederhr','rbbt_rabbit1','hrtree','richsalltrees_rocks','space_tower_lod1','portal_sea_temp','bridgesection1','train_barrier_body1','fence_1a_blue','lamp_pc_a','t_light_a','page_polysurface2'])],'meshes-a');
  msheet([...L('z23DIP',['brontgroup','prrt_parrot','village_gate','wall1','gate_door2','default1']),...L('z03PPH',['pepphouseinterior','pepp_gold','plaque','phonebase','receiver','tsk4','flower2','ast_gold','dps_gold']),
          ...L('z21FSH',['lastmodel','bullrush1','pole_pol1']),...L('z14OSD',['tumble_sprite1','gull_seagull','hpad_heli_pad','airstrip_building_lod1','cactus11']),...L('z17WAS',['head_squasher','skel_skeleton']),...L('z18MMP',['rays','coff_2']),
          ...L('z13CAI',['skeleton_one','skeleton_two']),...L('z36CNT',['viso_visor']),...L('z41MAP',['piz7_pizza','cit1_ogelcitizen','papa_papabrickolini','bb_mrhead1']),...L('z40OGL',['marker_blue_0']),
          ...L('z07CSI',['cannon_lod1','cata_lod1','bigtent1','lrtree1','castlebanner','spare_melon1']),...L('z16PYA',['pyramids','temple_obelisk1']),...L('z22BIP',['rock_mocster_template']),...L('z15SSH',['particlesource1','bolder10','hrpalm44'])],'meshes-b');
}
