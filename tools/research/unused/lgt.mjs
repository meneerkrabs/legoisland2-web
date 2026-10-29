import fs from 'node:fs'; import path from 'node:path';
import * as L from '/Users/sander/Documents/legoeiland2-web/src/formats/lights.ts';
const f=Object.keys(L).find(k=>/parse/i.test(k)); console.log(Object.keys(L));
const X='/tmp/le2-unused/story/x';
for(const z of ['z40OGL','z40aPO']){ const d=path.join(X,z,'lights'); for(const n of fs.readdirSync(d)){ try{ const r=L[f](fs.readFileSync(path.join(d,n))); console.log(z,n,JSON.stringify(r).slice(0,420)); }catch(e){console.log(z,n,'ERR',e.message);} } }
