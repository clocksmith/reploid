"""Print one answer record's phase breakdown. Usage: python3 summarize.py answers/<file>.json"""
import json, sys
r = json.load(open(sys.argv[1]))
s = (r.get('execution') or {}).get('stepSummary') or {}
p = s.get('phases') or {}
print(r['placement'], r['rung']['id'], 'status', (r.get('attempt') or {}).get('status'), 'stop', (r.get('attempt') or {}).get('stopReason'),
      'promptTokens', (p.get('prompt') or {}).get('inputTokens'), 'generated', s.get('count'), 'failure', (r.get('failure') or '')[:160])
keys = ['executionMs', 'encodeMs', 'submitWaitMs', 'inputUploadMs', 'activationReadbackMs', 'logitsMs', 'logitsReadbackMs', 'samplingMs', 'gpuKernelsMs']
for st in (p.get('prompt') or {}).get('stages', []):
    rt = st['runtime']
    print('  prefill stage', st['partitionIndex'], 'elapsed', round(st['elapsedMs'] or 0), {k: round(rt[k], 1) for k in keys if rt.get(k) is not None})
for st in (p.get('decode') or {}).get('stages', []):
    n = st['elapsedMs']['count'] or 1
    rt = st['runtime']
    print('  decode  stage', st['partitionIndex'], 'steps', st['elapsedMs']['count'], 'elapsed/step', round(st['elapsedMs']['total'] / n),
          'min', round(st['elapsedMs']['min'] or 0), 'max', round(st['elapsedMs']['max'] or 0),
          {k: round(rt[k]['total'] / rt[k]['count'], 1) for k in keys if rt[k]['count']})
print('  answer', repr((r.get('answer') or '')[:200]))
