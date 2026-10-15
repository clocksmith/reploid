"""Summarizes envelope-matrix cells (run-cell.mjs outputs) with the samplers that ran beside them. Read-only.
Per requester: outcome, generated tokens (coordinator count when completed, else durable publication records),
time to first visible text, wall decode time per token after the first ((answer - first text) / (tokens - 1),
or from stream samples for unfinished attempts), complete-answer latency, the largest single stage call of the
prompt step (the 300 s per-stage bound applies per call; the Mac prefill is the largest), and per-stage decode
elapsed and execution. Per cell: mac-host ICMP RTT and WebRTC STUN RTT (median, p90, max) and the amd-host
native scopes' memory maximum and minimum MemAvailable during the cell, and the binding constraint:
- admission: a requester refused before any token (served limit 2 concurrent attempts);
- answer deadline: the application ended an attempt at 900 s ("Response timed out");
- otherwise the nearest bound for a completed cell: the larger used fraction of the answer deadline (slowest
  answer / 900 s) and of the per-stage bound (largest stage call / 300 s); concurrent cells also report the
  spread of first-token times (the Mac prefill serialization).
Usage: python3 summarize-matrix.py <cells dir> <mac-health log> <webrtc-stats jsonl> <amd-sampler jsonl> <out json> [<out md>]"""
import glob, json, statistics, sys, datetime
cells_dir, health_path, webrtc_path, amd_path, out_path = sys.argv[1:6]
md_path = sys.argv[6] if len(sys.argv) > 6 else None
ts = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()
health = []
for line in open(health_path):
    parts = line.split()
    rtt = parts[3].split('=')[1]
    health.append((ts(parts[0]), None if rtt == 'timeout' else float(rtt)))
webrtc = []
for line in open(webrtc_path):
    row = json.loads(line)
    if 'connections' in row:
        for c in row['connections']:
            if c.get('pair') and c['pair'].get('currentRoundTripTime') is not None: webrtc.append((ts(row['at']), c['pair']['currentRoundTripTime'] * 1000))
amd = []
for line in open(amd_path):
    row = json.loads(line)
    amd.append((ts(row['at']), row['scopesCurrentTotal'], max([s['current'] for s in row['scopes'].values()] or [0]),
                row['meminfo'].get('MemAvailableKb', 0) * 1024, max([g['mem_info_gtt_used'] for g in row['amdgpu']] or [0])))
def window(rows, a, b): return [r for r in rows if a <= r[0] <= b]
def stats(values):
    values = sorted(v for v in values if v is not None)
    if not values: return None
    return {'median': round(statistics.median(values), 1), 'p90': round(values[min(len(values) - 1, int(0.9 * len(values)))], 1), 'max': round(values[-1], 1), 'n': len(values)}
cells = []
for path in sorted(glob.glob(cells_dir + '/c*-p*-n*.json')):
    cell = json.load(open(path))
    label = cell['label']; _, p, n = label.split('-')
    a, b = ts(cell['startedAt']), ts(cell['finishedAt'])
    h = window(health, a, b)
    row = {'label': label, 'requesters': cell['requesters'], 'promptTokens': int(p[1:]), 'countTo': int(n[1:]),
           'requestedAnswerTokens': {24: 63, 88: 255, 283: 1024}[int(n[1:])], 'ok': cell.get('ok'), 'failure': cell.get('failure'),
           'network': {'icmpRttMs': stats(r[1] for r in h), 'icmpTimeouts': sum(1 for r in h if r[1] is None),
                       'stunRttMs': stats(r[1] for r in window(webrtc, a, b))},
           'amd': None, 'runs': []}
    w = window(amd, a, b)
    if w: row['amd'] = {'scopesMaxBytes': max(r[1] for r in w), 'largestScopeMaxBytes': max(r[2] for r in w),
                        'memAvailableMinBytes': min(r[3] for r in w), 'gttMaxBytes': max(r[4] for r in w)}
    for run in cell.get('runs', []):
        t = run.get('timing') or {}
        req = t.get('requester', {}); coord = t.get('coordinator', {})
        answer = (req.get('attemptMs') or {}).get('value')
        first = (req.get('firstVisibleTextMs') or {}).get('value')
        tokens = run.get('coordinatorTokens') or run.get('publishedRecords')
        r = {'index': run.get('index'), 'status': run.get('status'), 'error': run.get('error'), 'failure': (run.get('failure') or '')[:300] or None,
             'tokens': tokens, 'stopReason': run.get('stopReason'), 'answerMs': answer, 'firstTextMs': first,
             'answerCharacters': run.get('answerCharacters'), 'answerTail': run.get('answerTail')}
        if answer and first and tokens and tokens > 1: r['decodeMsPerToken'] = (answer - first) / (tokens - 1)
        if run.get('status') != 'completed' and run.get('firstTextAt') and run.get('lastTextAt') and tokens and tokens > 1:
            r['decodeMsPerToken'] = (ts(run['lastTextAt']) - ts(run['firstTextAt'])) * 1000 / (tokens - 1)
        phases = coord.get('phases')
        if phases:
            r['promptStageCallsMs'] = [s.get('elapsedMs') for s in phases['prompt']['stages']]
            r['largestStageCallMs'] = max(v for v in r['promptStageCallsMs'] if v is not None)
            r['decodeStages'] = [{'index': s['partitionIndex'], 'elapsedMs': s['elapsedMs']['total'] / s['elapsedMs']['count'],
                                  'executionMs': s['runtime']['executionMs']['total'] / s['runtime']['executionMs']['count']}
                                 for s in phases['decode']['stages'] if s['elapsedMs']['count']]
        row['runs'].append(r)
    runs = row['runs']
    refused = [r for r in runs if r['status'] != 'completed' and not r['tokens']]
    timed = [r for r in runs if r['error'] and 'timed out' in r['error'].lower()]
    done = [r for r in runs if r['status'] == 'completed']
    if any(r['failure'] for r in runs) or cell.get('failure'): binding = 'harness or application failure (see runs)'
    elif timed: binding = 'answer deadline (900 s)'
    elif refused: binding = 'admission: ' + (refused[0]['error'] or 'refused')[:120]
    elif len(done) == len(runs):
        slow = max(r['answerMs'] for r in runs) / 1000; stage = max((r.get('largestStageCallMs') or 0) for r in runs) / 1000
        row['margins'] = {'deadlineS': round(900 - slow, 1), 'stageBoundS': round(300 - stage, 1),
                          'deadlineUsed': round(slow / 900, 3), 'stageBoundUsed': round(stage / 300, 3)}
        binding = (f'nearest: answer deadline ({100 * slow / 900:.0f}% used)' if slow / 900 >= stage / 300
                   else f'nearest: per-stage bound, Mac prefill ({100 * stage / 300:.0f}% used)')
    else: binding = 'mixed outcome (see runs)'
    if len(runs) > 1:
        firsts = sorted(r['firstTextMs'] for r in runs if r['firstTextMs'])
        if len(firsts) > 1: row['firstTextSpreadS'] = round((firsts[-1] - firsts[0]) / 1000, 1)
    row['binding'] = binding
    cells.append(row)
cells.sort(key=lambda c: (c['requesters'], c['countTo'] == 283, c['promptTokens'], c['countTo']))
json.dump({'schema': 'reploid.placement-c-envelope-matrix/v1', 'cells': cells}, open(out_path, 'w'), indent=1)
lines = ['| Cell | Prompt | Answer asked | Req. | Outcome | Tokens | First token (s) | Decode (ms/token) | Answer (s) | Largest stage call (s) | ICMP RTT median/p90 (ms) | Binding constraint |',
         '|---|---|---|---|---|---|---|---|---|---|---|---|']
f = lambda v, d=1: '-' if v is None else f'{v:.{d}f}'
for c in cells:
    for r in c['runs']:
        net = c['network']['icmpRttMs'] or {}
        lines.append(f"| {c['label']} | {c['promptTokens']} | {c['requestedAnswerTokens']} | {c['requesters']} | {r['status']}{(': ' + r['error'][:40]) if r['error'] else ''} | {r['tokens'] or '-'} | "
                     f"{f(r['firstTextMs'] and r['firstTextMs'] / 1000)} | {f(r.get('decodeMsPerToken'), 0)} | {f(r['answerMs'] and r['answerMs'] / 1000)} | "
                     f"{f(r.get('largestStageCallMs') and r['largestStageCallMs'] / 1000)} | {net.get('median', '-')}/{net.get('p90', '-')} | {c['binding']} |")
text = '\n'.join(lines) + '\n'
print(text)
if md_path: open(md_path, 'w').write(text)
