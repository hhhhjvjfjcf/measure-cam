import re, os, sys
d = r'C:\Users\jiev\Doubao\chats\2026-10-21\new-chat\measure-cam'
html = open(os.path.join(d, 'index.html'), encoding='utf-8').read()
ids = set(re.findall(r'id="([^"]+)"', html))
js = ''
for f in ['js/app.js', 'js/estimate-mode.js', 'js/ar-mode.js']:
    js += open(os.path.join(d, f), encoding='utf-8').read()
refs = set(re.findall(r"getElementById\('([^']+)'\)", js))
refs |= set(re.findall(r"\$\('([^']+)'\)", js))
missing = sorted(refs - ids)
print('JS引用的id数:', len(refs), ' HTML中的id数:', len(ids))
print('缺失(JS引用但HTML没有)的id:', missing if missing else '无')
