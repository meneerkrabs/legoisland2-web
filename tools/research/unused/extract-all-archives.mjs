import fs from 'node:fs';
import { Archive } from '/Users/sander/Documents/legoeiland2-web/src/formats/archive.ts';
const D='/Users/sander/Documents/legoeiland2-extract/game/Game/_data/';
const out=process.argv[2];
fs.mkdirSync(out,{recursive:true});
let n=0;
for (const f of fs.readdirSync(D).filter(f=>f.endsWith('.bod'))) {
  const name=f.slice(0,-4);
  const a=new Archive(name,fs.readFileSync(D+f),fs.readFileSync(D+name+'.bob'));
  for (const e of a.entries){
    const p=out+'/'+name+'/'+e.path;
    fs.mkdirSync(p.slice(0,p.lastIndexOf('/')),{recursive:true});
    fs.writeFileSync(p,a.read(e.path)); n++;
  }
}
console.log(n,'files');
