import re,json
b=open('/Users/sander/Documents/legoeiland2-extract/game/Game/LEGO eiland 2.exe','rb').read()
S=set()
for m in re.finditer(rb'[\x20-\x7e]{3,}',b):
    S.add(m.group().decode('latin1'))
S=sorted(S)
json.dump(S,open('exestr.json','w'))
ext=re.compile(r'\.(msh|col|tga|wib|man|blk|cut|txt|str|wpt|way|wbt|par|app|emi|mov|swl|cam|lgt|src|gob|mtl|fnt|opt|txl|anm|h|wav|mp3|mpg|sty|sgt|dls|mid|bmp)\b',re.I)
x=[s for s in S if ext.search(s)]
print(len(S),len(x))
open('exepaths.txt','w').write('\n'.join(x))
pc=[s for s in x if '%' in s]
print('\n'.join(pc))
