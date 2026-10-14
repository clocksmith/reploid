"""Diff a campaign-3 placement's expectations against campaign 2's, as campaign 2 recorded its own diff.
Usage: python3 expectations-diff.py <attempt dir>"""
import json, hashlib, sys, pathlib
attempt = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent
old_path = root.parent / 'completion-qualification-2-20261013/expectations.json'
new_path = root / attempt / 'expectations.json'
old, new = json.loads(old_path.read_text()), json.loads(new_path.read_text())
def walk(a, b, p=''):
    if type(a) != type(b): yield (p, a, b); return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b: yield (f'{p}.{k}', a.get(k, '<absent>'), b.get(k, '<absent>'))
            else: yield from walk(a[k], b[k], f'{p}.{k}')
    elif isinstance(a, list):
        if len(a) != len(b): yield (p, f'len {len(a)}', f'len {len(b)}')
        for i, (x, y) in enumerate(zip(a, b)): yield from walk(x, y, f'{p}[{i}]')
    elif a != b: yield (p, a, b)
sha = lambda path: 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
diff = [{'path': p, 'campaign2': a, 'campaign3': b} for p, a, b in walk(old, new)]
out = {'schema': 'reploid.expectations-diff/v1',
       'originalExpectations': {'path': 'artifacts/completion-qualification-2-20261013/expectations.json', 'hash': sha(old_path)},
       'freshExpectations': {'path': f'artifacts/completion-qualification-3-20261014/{attempt}/expectations.json', 'hash': sha(new_path)},
       'changedFields': diff, 'changedPaths': sorted({d['path'].split('[')[0] if d['path'].startswith('.placements') else d['path'] for d in diff})}
(root / attempt / 'expectations-diff.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out['changedPaths'], indent=1))
