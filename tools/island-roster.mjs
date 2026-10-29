import fs from 'node:fs';
import { Pe, extractZone } from '../src/formats/exe.ts';
import { Archive } from '../src/formats/archive.ts';
import { emulateIslandSetup, recIndexOfPtr } from '../src/formats/emusetup.ts';
import { ctorName } from '../src/formats/zonesetup.ts';
const root=new URL('../public/data/le2/', import.meta.url).pathname;
const pe = new Pe(new Uint8Array(fs.readFileSync(root+'LEGO eiland 2.exe')));
const scene = extractZone(pe,'z02LGI');
const d=root+'_data/';
const archive=new Archive('z02LGI',fs.readFileSync(d+'z02LGI.bod'),fs.readFileSync(d+'z02LGI.bob'));
const node=+process.argv[2]||2;
const m=new Map([[0x58,node],[2,1],[0x4f,11],[0xb0,11]]);
const s=emulateIslandSetup(pe,scene,{vars:{get:i=>m.get(i)??0,set:(i,v)=>m.set(i,v)},archive});
const only=process.argv[3];
for (const a of s.attaches) {
  const nm=a.ctorName ?? a.ctor.toString(16);
  if (only && !new RegExp(only).test(nm+a.ctor.toString(16))) continue;
  const dv=new DataView(a.args.buffer,a.args.byteOffset);
  const w=[];for(let i=0;i<8;i++){const u=dv.getUint32(i*4,true); const r=recIndexOfPtr(u); w.push(r>=0?`R${r}(${scene.records[r].name})`:(u>0x100000&&u<0x80000000? u.toString(16):`${u}|${dv.getFloat32(i*4,true).toPrecision(4)}`));}
  console.log(a.at.toString(16).padStart(6), 'rec',a.record, scene.records[a.record]?.name, nm, a.ctor.toString(16),'pos',a.pos,'gate',`${a.var.toString(16)}&${a.mask.toString(16)}=${a.value.toString(16)}`,'cf',a.ctrlFlags?.toString(16), w.join(' '));
}
console.log('cutscenes',s.cutscenes.length);
