import sys,re,json,bisect
sys.path.insert(0,'/Users/sander/Documents/basdebeer-tools/decomp-le2/tools')
from zonemap import zreg,builders,loaders,nxt
lines=open('/Users/sander/Documents/basdebeer-tools/decomp-le2/LE2.asm.txt').read().split('\n')
res={z:{} for z in builders}
for i,l in enumerate(lines):
    if 'call' in l and l.rstrip().endswith('0x43eaf0'):
        a=int(l.split(':')[0],16)
        # zone
        zone=None
        for z,(x,y) in zreg.items():
            if x<=a<y: zone=z
        if zone not in builders: continue
        b=builders[zone]; le=nxt(loaders[zone])
        if b<=a<le: continue
        # look back for pushes
        w=[lines[j] for j in range(max(0,i-8),i)]
        idx=None; arr=None
        for t in w:
            m=re.search(r'push (0x[0-9a-f]+|\d+)$',t.strip().split('  ',1)[-1].strip()) if 'push' in t else None
        txt='\n'.join(w)
        pushes=[re.search(r'push\s+(\S+)\s*$',t).group(1) for t in w if re.search(r'push\s+\S+\s*$',t)]
        arrs=[t for t in w if '0x98380c' in t or '0x983838' in t]
        res[zone].setdefault('sites',[]).append({'a':hex(a),'pushes':pushes,'arr':[x.split(':',1)[1].strip()[:60] for x in arrs]})
json.dump(res,open('modelrefs.json','w'))
for z,r in res.items(): print(z,len(r.get('sites',[])))
