// prints the PATH-map route (hop matrix, FUN_00448049) between two nodes of the Dino island: node tools/m5-z23DIP-route.mjs 0 15
import fs from 'node:fs'; import path from 'node:path';
import { Archive } from '../src/formats/archive.ts';
import { nextHop, parseCompiledWaypoints } from '../src/formats/waypoints.ts';
const dir = 'public/data/le2/_data';
const a = new Archive('z23DIP', fs.readFileSync(path.join(dir, 'z23DIP.bod')), fs.readFileSync(path.join(dir, 'z23DIP.bob')));
const wp = parseCompiledWaypoints(a.read(a.find('Waypoints/W_PATH_C.wpt')));
const [from, to] = process.argv.slice(2).map(Number);
let n = from; const r = [n];
for (let i = 0; i < 80 && n !== to; i++) { n = nextHop(wp, n, to); r.push(n); }
console.log(JSON.stringify(r));
