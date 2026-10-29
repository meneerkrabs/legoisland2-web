import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { parseTga } from '/Users/sander/Documents/legoeiland2-web/src/formats/tga.ts';
import { parseWib } from '/Users/sander/Documents/legoeiland2-web/src/formats/wib.ts';
const X='/tmp/le2-unused/story/x'; const z=JSON.parse(fs.readFileSync('zones.json','utf8'));
const rows=JSON.parse(fs.readFileSync('rows.json','utf8'));
export function png(w,h,rgba,topDownRgba){ // rgba stored bottom-first -> flip
  const raw=Buffer.alloc((w*4+1)*h);
  for(let y=0;y<h;y++){ raw[y*(w*4+1)]=0; const sy=topDownRgba?y:h-1-y; Buffer.from(rgba.buffer,rgba.byteOffset+sy*w*4,w*4).copy(raw,y*(w*4+1)+1); }
  const crcT=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
  const crc=b=>{let c=-1;for(const x of b)c=crcT[(c^x)&255]^(c>>>8);return (c^-1)>>>0;};
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function loadTex(f){ const d=fs.readFileSync(f); if(f.toLowerCase().endsWith('.wib')){ const w=parseWib(d); return {w:w.width,h:w.height,rgba:w.frames?w.frames[0]:null,wib:w}; } const t=parseTga(d); return {w:t.width,h:t.height,rgba:t.rgba}; }
if(process.argv[1].endsWith('tex.mjs')){
const res={};
for(const [zn,v] of Object.entries(z)){
  const listed=new Set(v.texInLists), reach=new Set(v.texReach);
  const files=rows.filter(r=>r.a===zn&&r.sub==='textures'&&/^text\d+$/.test(r.stem));
  const unl=files.filter(r=>!listed.has(+r.stem.slice(4)));
  const unr=files.filter(r=>listed.has(+r.stem.slice(4))&&!reach.has(+r.stem.slice(4)));
  res[zn]={files:files.length,unlisted:unl.map(r=>r.base),unreach:unr.map(r=>r.base)};
  console.log(zn,'textures',files.length,'unlisted',unl.length,'listed-but-unreachable',unr.length, unl.slice(0,12).map(r=>r.stem.slice(4)).join(','));
}
fs.writeFileSync('texres.json',JSON.stringify(res));
}
