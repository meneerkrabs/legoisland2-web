import fs from 'node:fs'; import path from 'node:path';
import { parseCompiledWaypoints, parseWaypointHeader } from '/Users/sander/Documents/legoeiland2-web/src/formats/waypoints.ts';
const X='/tmp/le2-unused/story/x';
for(const z of fs.readdirSync(X).filter(d=>/^z\d/.test(d))){
  const d=['Waypoints','waypoints'].map(n=>path.join(X,z,n)).find(p=>fs.existsSync(p)); if(!d) continue;
  const hs=fs.readdirSync(d).filter(f=>/\.h$/i.test(f));
  for(const h of hs){ const kind=h.match(/aW_(\w+?)_?\.h/i)[1]; const ent=parseWaypointHeader(fs.readFileSync(path.join(d,h),'latin1')).entries;
    const cf=fs.readdirSync(d).find(f=>f.toLowerCase()===`w_${kind.toLowerCase()}_c.wpt`); let n='-';
    if(cf){ try{ n=parseCompiledWaypoints(fs.readFileSync(path.join(d,cf))).nodes.length; }catch(e){ n='ERR '+e.message; } }
    console.log(z,h,'header entries',ent.length,'compiled nodes',n, ent.length!==n?'  <-- differs':''); }
}
