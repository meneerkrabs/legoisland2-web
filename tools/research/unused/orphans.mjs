import fs from 'node:fs';
const S=new Set(JSON.parse(fs.readFileSync('/tmp/le2-unused/data/exestr.json','utf8')).map(s=>s.toLowerCase().trim()));
const D='/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/speech/Data/';
const f=fs.readdirSync(D).filter(x=>/\.mp3$/i.test(x));
const orphans=f.filter(x=>!S.has(x.replace(/\.mp3$/i,'').toLowerCase()));
console.log(f.length,orphans.length); fs.writeFileSync('orphans.txt',orphans.join('\n'));
