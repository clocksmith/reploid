"""Per-step latency breakdown of placement C from latency-probe.mjs rows (coordinator page and both natives) and
the requester turn records (run-turns.mjs). Read-only.

Every route step is cut on the coordinator clock into contiguous segments that add up exactly to the step's
wall time (r-step-begin to the next step's r-step-begin). Each remote stage call is split into coordinator
processing (coordinator clock), native processing (that native's own clock, durations only) and transfer, the
remainder: time during which neither side was processing that call, i.e. messages in flight, including
delivery through each side's event loop. Transfer therefore needs no clock alignment. Bulk uploads (the
prompt step's activation fragments) count as transfer from the end of the send permit to the last fragment.
Native processing is further split into Doppler stage execution (with Doppler's own metrics inside it),
grant authorization, fingerprinting, frame serialization/validation and other host time.

A clock offset per native (NTP-style, the minimum-delay request/ready exchanges) is estimated only to report
one-way crossing times for illustration; no component depends on it.
Usage: python3 breakdown.py <probe dir> <turns json> <out json>"""
import json, sys, statistics, bisect, gzip, os
from collections import defaultdict

probe, turns_path, out_path = sys.argv[1:4]
load = lambda name: [json.loads(line) for line in (open(f'{probe}/{name}.jsonl') if os.path.exists(f'{probe}/{name}.jsonl') else gzip.open(f'{probe}/{name}.jsonl.gz', 'rt'))]
page, natives = load('page'), {1: load('native1'), 2: load('native2')}
turns = json.load(open(turns_path))['turns']
for rows in [page, *natives.values()]: rows.sort(key=lambda r: r[0])
times = {id(rows): [r[0] for r in rows] for rows in [page, *natives.values()]}

def after(rows, t, pred, limit=None):
    i = bisect.bisect_left(times[id(rows)], t)
    for r in rows[i:]:
        if limit is not None and r[0] > limit: return None
        if pred(r): return r
    return None
def before(rows, t, pred, floor=None):
    i = bisect.bisect_right(times[id(rows)], t)
    for r in reversed(rows[:i]):
        if floor is not None and r[0] < floor: return None
        if pred(r): return r
    return None
def between(rows, a, b, pred=lambda r: True):
    i, j = bisect.bisect_left(times[id(rows)], a), bisect.bisect_right(times[id(rows)], b)
    return [r for r in rows[i:j] if pred(r)]
def perm_time(rows, a, b, tags=('d-perm-begin', 'd-perm-end')):
    """Sum of permit intervals fully inside [a, b] (begin/end paired in order)."""
    total, open_at = 0.0, {}
    for r in between(rows, a, b):
        if r[1] in ('d-perm-begin', 'r-perm-begin'): open_at[r[1][:2]] = r[0]
        elif r[1] in ('d-perm-end', 'r-perm-end') and r[1][:2] in open_at: total += r[0] - open_at.pop(r[1][:2])
    return total
def send_after(rows, t, label='reploid-partitions-ordered'):
    r = after(rows, t, lambda r: r[1] == 'w-send' and r[2] == label, t + 200)
    return r[0] if r else t
PEERS = {}  # native index -> participant prefix as seen by the coordinator

def native_call(n, attempt, step):
    """Native-clock processing of one stage call; returns component durations and anchors."""
    rows = natives[n]
    recv = next((r for r in rows if r[1] == 'p-sv-recv-begin' and r[2] == attempt and r[3] == step), None)
    if not recv: return None
    serve = before(rows, recv[0], lambda r: r[1] == 'd-serve-begin' and r[4] == 'step', recv[0] - 500)
    rid = serve[3]
    ctrl = before(rows, serve[0], lambda r: r[1] == 'd-ctrl-recv' and r[3] == 'request' and r[4] == rid, serve[0] - 400000)
    ready_send = after(rows, ctrl[0], lambda r: r[1] == 'd-ready-send' and r[3] == rid)
    ready_wire = send_after(rows, ready_send[0])
    binc = after(rows, ready_send[0], lambda r: r[1] == 'd-bin-complete' and r[3] == rid)
    result_send = after(rows, binc[0], lambda r: r[1] == 'd-result-send' and r[3] == rid)
    result_wire = send_after(rows, result_send[0])
    dop_b = after(rows, recv[0], lambda r: r[1] == 'p-ex-doppler-begin' and r[2] == attempt and r[3] == step)
    dop_e = after(rows, dop_b[0], lambda r: r[1] == 'p-ex-doppler-end' and r[2] == attempt and r[3] == step)
    intervals = [(ctrl[0], ready_wire)]
    upload = 0.0
    so = None
    if n == 1:
        so_begin = after(rows, recv[0], lambda r: r[1] == 'p-sv-so-begin' and r[2] == attempt and r[3] == step)
        req = after(rows, so_begin[0], lambda r: r[1] == 'd-req-new' and r[3] == 'stage-output' and r[4] == step)
        cs = after(rows, req[0], lambda r: r[1] == 'd-ctrl-send')
        sid = cs[3]
        so_wire = send_after(rows, cs[0])
        rr = after(rows, cs[0], lambda r: r[1] == 'd-ready-recv' and r[3] == sid)
        up_perm_end = after(rows, rr[0], lambda r: r[1] == 'd-perm-end' and r[3] == 'send' and r[4] == sid)
        up_end = after(rows, rr[0], lambda r: r[1] == 'd-up-end' and r[3] == sid)
        res = after(rows, up_end[0], lambda r: r[1] == 'd-ctrl-recv' and r[3] == 'result' and r[4] == sid)
        intervals += [(binc[0], so_wire), (rr[0], up_perm_end[0]), (res[0], result_wire)]
        upload = up_end[0] - up_perm_end[0]
        so = {'ctrlWire': so_wire, 'readyRecv': rr[0], 'uploadEnd': up_end[0], 'resultRecv': res[0]}
    else:
        intervals += [(binc[0], result_wire)]
    proc = sum(b - a for a, b in intervals)
    perms = sum(perm_time(rows, a, b) for a, b in intervals)
    sperm = 0.0
    for a, b in intervals:
        for tag_b, tag_e in [('s-perm1-begin', 's-perm1-end'), ('s-perm2-begin', 's-exec-begin'), ('s-await-end', 's-perm3-end')]:
            for x in between(rows, a, b, lambda r: r[1] == tag_b and r[2] == attempt and r[3] == step):
                y = after(rows, x[0], lambda r: r[1] == tag_e and r[2] == attempt and r[3] == step)
                if y and y[0] <= b: sperm += y[0] - x[0]
    fp = 0.0
    x = after(rows, recv[0], lambda r: r[1] == 's-perm1-end' and r[2] == attempt and r[3] == step)
    y = after(rows, recv[0], lambda r: r[1] == 's-fp-end' and r[2] == attempt and r[3] == step)
    if x and y: fp += y[0] - x[0]
    ser = 0.0
    a = after(rows, recv[0], lambda r: r[1] == 'p-ex-begin' and r[2] == attempt and r[3] == step)
    ser += dop_b[0] - a[0]  # activation frame validation before execution
    if n == 1:
        sb = after(rows, recv[0], lambda r: r[1] == 'p-sv-ser-begin' and r[2] == attempt and r[3] == step)
        fb = after(rows, recv[0], lambda r: r[1] == 'p-sv-fp-begin' and r[2] == attempt and r[3] == step)
        sob = after(rows, recv[0], lambda r: r[1] == 'p-sv-so-begin' and r[2] == attempt and r[3] == step)
        ser += fb[0] - sb[0]; fp += sob[0] - fb[0]
    doppler = dop_e[0] - dop_b[0]
    return {'processing': proc, 'doppler': doppler, 'authorization': perms + sperm, 'fingerprint': fp, 'serialization': ser,
            'other': proc - doppler - perms - sperm - fp - ser, 'upload': upload, 'crossings': 8 if n == 1 else 4,
            'anchors': {'ctrlRecv': ctrl[0], 'readyWire': ready_wire, 'binComplete': binc[0], 'resultWire': result_wire, 'so': so}}

def coordinator_call(attempt, step, stage, t0, t1):
    """Coordinator-clock processing inside one remote stage call [t0, t1]."""
    peer = PEERS[stage]
    req = after(page, t0, lambda r: r[1] == 'd-req-new' and r[2] == peer and r[3] == 'step' and r[4] == step, t1)
    cs = after(page, req[0], lambda r: r[1] == 'd-ctrl-send' and r[2] == peer, t1)
    cid = cs[3]
    ctrl_wire = send_after(page, cs[0])
    rr = after(page, cs[0], lambda r: r[1] == 'd-ready-recv' and r[2] == peer and r[3] == cid, t1)
    up_perm_end = after(page, rr[0], lambda r: r[1] == 'd-perm-end' and r[2] == peer and r[3] == 'send' and r[4] == cid, t1)
    up_end = after(page, rr[0], lambda r: r[1] == 'd-up-end' and r[2] == peer and r[3] == cid, t1)
    res = after(page, up_end[0], lambda r: r[1] == 'd-ctrl-recv' and r[2] == peer and r[3] == 'result' and r[4] == cid, t1)
    intervals = [(t0, ctrl_wire), (rr[0], up_perm_end[0]), (res[0], t1)]
    anchors = {'ctrlWire': ctrl_wire, 'readyRecv': rr[0], 'uploadEnd': up_end[0], 'resultRecv': res[0]}
    if stage == 1:
        acc = after(page, up_end[0], lambda r: r[1] == 'd-acc-begin' and r[2] == peer and r[4] == 'stage-output', t1)
        aid = acc[3]
        ctrl_in = before(page, acc[0], lambda r: r[1] == 'd-ctrl-recv' and r[2] == peer and r[3] == 'request' and r[4] == aid, t0)
        rs = after(page, acc[0], lambda r: r[1] == 'd-ready-send' and r[2] == peer and r[3] == aid, t1)
        binc = after(page, rs[0], lambda r: r[1] == 'd-bin-complete' and r[2] == peer and r[3] == aid, t1)
        resend = after(page, binc[0], lambda r: r[1] == 'd-result-send' and r[2] == peer and r[3] == aid, t1)
        intervals += [(ctrl_in[0], send_after(page, rs[0])), (binc[0], send_after(page, resend[0]))]
        anchors.update({'soCtrlRecv': ctrl_in[0], 'soReadyWire': send_after(page, rs[0]), 'soBinComplete': binc[0], 'soResultWire': send_after(page, resend[0])})
    proc = sum(b - a for a, b in intervals)
    perms = sum(perm_time(page, a, b) for a, b in intervals)
    ser = 0.0
    for tb, te in [('p-pe-ser-begin', 'p-pe-ser-end'), ('p-pe-dec-begin', 'p-pe-dec-end'), ('p-so-begin', 'p-so-ret')]:
        x = after(page, t0, lambda r: r[1] == tb and r[2] == attempt and r[3] == step and r[4] == stage, t1)
        y = x and after(page, x[0], lambda r: r[1] == te and r[2] == attempt and r[3] == step and r[4] == stage, t1)
        if x and y: ser += y[0] - x[0]
    return {'processing': proc, 'authorization': perms, 'serialization': ser, 'other': proc - perms - ser,
            'upload': up_end[0] - up_perm_end[0], 'anchors': anchors}

def first(rows, tag, attempt, step, stage=None, t=0):
    for r in rows[bisect.bisect_left(times[id(rows)], t):]:
        if r[1] == tag and r[2] == attempt and r[3] == step and (stage is None or r[4] == stage): return r
    return None

def step_breakdown(attempt, step, t_begin, t_end):
    seg = defaultdict(float)
    r = lambda tag, stage=None: first(page, tag, attempt, step, stage, t_begin)
    permits_done = r('r-permits-done')
    seg['coordinator.authorization'] += perm_time(page, t_begin, permits_done[0])
    seg['coordinator.gaps'] += (permits_done[0] - t_begin) - perm_time(page, t_begin, permits_done[0])
    stages = {}
    metrics = None
    pub_end = r('r-pub-end')
    if pub_end: metrics = {m['partitionIndex']: m for m in json.loads(pub_end[4])}
    cursor = permits_done[0]
    for s in range(3):
        sb, cs, ce, lo = r('r-stage-begin', s), r('r-call-start', s), r('r-call-end', s), r('r-lease-out', s)
        seg['coordinator.gaps'] += sb[0] - cursor
        p = perm_time(page, sb[0], cs[0])
        seg['coordinator.authorization'] += p
        seg['coordinator.leaseWait'] += (cs[0] - sb[0]) - p
        call = ce[0] - cs[0]
        m = (metrics or {}).get(s, {}).get('metrics') or {}
        row = {'callMs': call, 'metrics': m}
        if s == 0:
            gpu = m.get('submitWaitMs', 0.0)
            seg['mac.gpuWait'] += gpu
            seg['mac.browserHost'] += call - gpu
            row.update({'gpuWait': gpu, 'host': call - gpu})
        else:
            c = coordinator_call(attempt, step, s, cs[0], ce[0])
            n = native_call(s, attempt, step)
            transfer = call - c['processing'] - n['processing']
            seg[f'transfer.hop{s}'] += transfer
            seg['coordinator.authorization'] += c['authorization']
            seg['serialization.coordinator'] += c['serialization']
            seg['coordinator.callOther'] += c['other']
            seg[f'amd{s}.doppler'] += n['doppler']
            seg[f'amd{s}.authorization'] += n['authorization']
            seg[f'amd{s}.fingerprint'] += n['fingerprint']
            seg[f'serialization.amd{s}'] += n['serialization']
            seg[f'amd{s}.hostOther'] += n['other']
            row.update({'coordinator': {k: v for k, v in c.items() if k != 'anchors'}, 'native': {k: v for k, v in n.items() if k != 'anchors'},
                        'transfer': transfer, 'transferPerCrossing': transfer / n['crossings'], 'bulkUpload': c['upload'] + n['upload'],
                        'anchors': {'coordinator': c['anchors'], 'native': n['anchors']}})
        stages[s] = row
        if s < 2:
            ee = r('r-edge-end', s)
            p = perm_time(page, ce[0], ee[0])
            seg['coordinator.authorization'] += p
            seg['serialization.coordinator'] += (ee[0] - lo[0]) - p
            seg['coordinator.gaps'] += lo[0] - ce[0]
            cursor = ee[0]
        else:
            cursor = lo[0]; seg['coordinator.gaps'] += lo[0] - ce[0]
    ob, oe, de, pb, act_e, se = r('r-outperm-begin'), r('r-outperm-end'), r('r-delivery-end'), r('r-pub-begin'), r('r-act-end'), r('r-step-end')
    seg['coordinator.gaps'] += ob[0] - cursor
    seg['coordinator.authorization'] += oe[0] - ob[0]
    seg['coordinator.gaps'] += pb[0] - oe[0]
    seg['publication'] += pub_end[0] - pb[0]
    seg['coordinator.gaps'] += t_end - pub_end[0]
    total = t_end - t_begin
    return {'step': step, 'totalMs': total, 'segments': dict(seg), 'sumMs': sum(seg.values()), 'stages': stages,
            'activity': act_e[0] - pub_end[0], 'stepEndToNext': t_end - se[0]}

def offsets():
    """Per native: clock offset (native minus coordinator) from minimum-delay exchanges of ordered step requests
    (request control frame out, ready back); describe traffic on the control channel is excluded."""
    out = {}
    for n in (1, 2):
        best = None
        native_req = {}
        for x in natives[n]:
            if x[1] == 'd-acc-begin' and x[4] == 'step':
                ctrl = before(natives[n], x[0], lambda y: y[1] == 'd-ctrl-recv' and y[3] == 'request' and y[4] == x[3], x[0] - 50)
                rs = after(natives[n], x[0], lambda y: y[1] == 'd-ready-send' and y[3] == x[3], x[0] + 5000)
                if ctrl and rs: native_req[x[3]] = (ctrl[0], send_after(natives[n], rs[0]))
        for r in page:
            if r[1] != 'd-req-new' or r[2] != PEERS[n] or r[3] != 'step': continue
            cs = after(page, r[0], lambda x: x[1] == 'd-ctrl-send' and x[2] == PEERS[n], r[0] + 1000)
            if not cs or cs[3] not in native_req: continue
            rid = cs[3]; t1 = send_after(page, cs[0])
            ready = after(page, cs[0], lambda x: x[1] == 'd-ctrl-recv' and x[2] == PEERS[n] and x[3] == 'ready' and x[4] == rid, cs[0] + 60000)
            if not ready: continue
            t2, t3 = native_req[rid]; t4 = ready[0]
            delay = (t4 - t1) - (t3 - t2)
            if delay > 0 and (best is None or delay < best[1]): best = (((t2 - t1) + (t3 - t4)) / 2, delay)
        out[n] = {'offsetMs': best[0], 'minRoundTripMs': best[1]} if best else None
    return out

# Native participant prefixes as seen by the coordinator: the PEER of the coordinator's step requests.
for r in page:
    if r[1] == 'd-req-new' and r[3] == 'step':
        nxt = after(page, r[0], lambda x: x[1] == 'r-call-end', r[0] + 600000)
        if nxt and nxt[4] in (1, 2) and nxt[4] not in PEERS: PEERS[nxt[4]] = r[2]
    if len(PEERS) == 2: break

def crossings(step_rows, offs):
    """Median one-way time per crossing type, with the estimated clock offset (illustrative only)."""
    kinds = defaultdict(list)
    for st in step_rows:
        for h in (1, 2):
            if not offs.get(h): continue
            th = offs[h]['offsetMs']; a = st['stages'][h]['anchors']; c, n = a['coordinator'], a['native']
            kinds[f'hop{h} request control C->N'].append(n['ctrlRecv'] - th - c['ctrlWire'])
            kinds[f'hop{h} ready N->C'].append(c['readyRecv'] - (n['readyWire'] - th))
            kinds[f'hop{h} activation payload C->N'].append(n['binComplete'] - th - c['uploadEnd'])
            kinds[f'hop{h} result N->C'].append(c['resultRecv'] - (n['resultWire'] - th))
            if h == 1 and n['so']:
                kinds['hop1 stage-output request control N->C'].append(c['soCtrlRecv'] - (n['so']['ctrlWire'] - th))
                kinds['hop1 stage-output ready C->N'].append(n['so']['readyRecv'] - th - c['soReadyWire'])
                kinds['hop1 stage-output payload N->C'].append(c['soBinComplete'] - (n['so']['uploadEnd'] - th))
                kinds['hop1 stage-output result C->N'].append(n['so']['resultRecv'] - th - c['soResultWire'])
    return {k: {'median': round(statistics.median(v), 1), 'p90': round(sorted(v)[int(0.9 * (len(v) - 1))], 1)} for k, v in kinds.items()}

result = {'schema': 'reploid.placement-c-latency-breakdown/v1', 'probe': probe.split('/')[-1], 'clockOffsets': offsets(), 'turns': []}
for turn in turns:
    attempt = turn['attemptId'][:8]
    begins = [r for r in page if r[1] == 'r-step-begin' and r[2] == attempt]
    steps = []
    for i, b in enumerate(begins):
        end = begins[i + 1][0] if i + 1 < len(begins) else first(page, 'r-step-end', attempt, b[3], None, b[0])[0]
        try: steps.append(step_breakdown(attempt, b[3], b[0], end))
        except Exception as error: steps.append({'step': b[3], 'error': repr(error)})
    created = turn['timing']['requester']['attemptMs']
    t = turn['timing']
    row = {'label': turn['label'], 'attemptId': turn['attemptId'], 'generatedTokens': turn['generatedTokens'],
           'attemptMs': t['requester']['attemptMs'].get('value'), 'firstVisibleTextMs': t['requester']['firstVisibleTextMs'].get('value'),
           'promptTokens': t['coordinator']['promptTokens'].get('value'), 'steps': steps}
    ok = [s for s in steps if 'error' not in s]
    row['stepErrors'] = [s for s in steps if 'error' in s]
    if ok:
        row['routeStepsMs'] = sum(s['totalMs'] for s in ok)
        row['firstStepBeginEpochMs'] = begins[0][0]
        row['outsideStepsMs'] = (row['attemptMs'] or 0) - row['routeStepsMs']
        if turn.get('attemptCreatedAt'):
            last_end = first(page, 'r-step-end', attempt, ok[-1]['step'], None, begins[-1][0])[0]
            row['admissionMs'] = begins[0][0] - turn['attemptCreatedAt']
            row['completionMs'] = turn['attemptFinishedAt'] - last_end
        decode = [s for s in ok if s['step'] > 0]
        keys = sorted({k for s in ok for k in s['segments']})
        agg = lambda rows: {k: {'mean': statistics.fmean(s['segments'].get(k, 0) for s in rows), 'median': statistics.median(s['segments'].get(k, 0) for s in rows)} for k in keys}
        row['prompt'] = ok[0] if ok[0]['step'] == 0 else None
        if decode:
            row['decode'] = {'steps': len(decode), 'totalMean': statistics.fmean(s['totalMs'] for s in decode),
                             'totalMedian': statistics.median(s['totalMs'] for s in decode), 'segments': agg(decode),
                             'transferPerCrossing': {f'hop{h}': statistics.median(s['stages'][h]['transferPerCrossing'] for s in decode) for h in (1, 2)},
                             'residualMax': max(abs(s['totalMs'] - s['sumMs']) for s in decode),
                             'oneWayCrossings': crossings(decode, result['clockOffsets'])}
    result['turns'].append(row)
json.dump(result, open(out_path, 'x'), indent=1)
for row in result['turns']:
    print(row['label'], row.get('generatedTokens'), 'attempt', row.get('attemptMs'), 'route steps', round(row.get('routeStepsMs', 0)), 'errors', len(row['stepErrors']))
    if row.get('decode'):
        d = row['decode']
        print('  decode steps', d['steps'], 'mean', round(d['totalMean'], 1), 'median', round(d['totalMedian'], 1), 'residual max', round(d['residualMax'], 3))
        for k, v in sorted(d['segments'].items(), key=lambda kv: -kv[1]['mean']):
            print(f'    {k:32s} mean {v["mean"]:8.1f}  median {v["median"]:8.1f}')
        print('  transfer per crossing (median)', {k: round(v, 1) for k, v in d['transferPerCrossing'].items()})
        print('  one-way crossings (median/p90 ms)', {k: (v['median'], v['p90']) for k, v in d['oneWayCrossings'].items()})
    if row.get('prompt'):
        p = row['prompt']
        print('  prompt step', round(p['totalMs']), {k: round(v) for k, v in sorted(p['segments'].items(), key=lambda kv: -kv[1])})
print('offsets', result['clockOffsets'])
