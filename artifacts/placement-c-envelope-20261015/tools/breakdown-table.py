"""Groups the per-step breakdown (breakdown.py output) into the reported categories and prints a markdown table
per decode token (mean and median over decode steps) for each instrumented turn, plus the prompt step.
Readback and sampling are Doppler's own metrics inside the stage execution rows (shown indented, not added).
Usage: python3 breakdown-table.py <breakdown json>... > table.md"""
import json, sys, statistics
GROUPS = [
    ('Mac stage 0 execution: GPU wait', ['mac.gpuWait']),
    ('Mac stage 0 execution: browser host', ['mac.browserHost']),
    ('AMD stage 1 execution (Doppler)', ['amd1.doppler']),
    ('AMD stage 2 execution (Doppler, incl. logits and sampling)', ['amd2.doppler']),
    ('Transfer, hop 1 (Mac <-> AMD stage 1, 8 one-way crossings)', ['transfer.hop1']),
    ('Transfer, hop 2 (Mac <-> AMD stage 2, 4 one-way crossings)', ['transfer.hop2']),
    ('Grant authorization checks (coordinator + both natives)', ['coordinator.authorization', 'amd1.authorization', 'amd2.authorization']),
    ('Activation serialization, validation and fingerprints', ['serialization.coordinator', 'serialization.amd1', 'serialization.amd2', 'amd1.fingerprint', 'amd2.fingerprint']),
    ('AMD native host time outside execution', ['amd1.hostOther', 'amd2.hostOther']),
    ('Publication (durable requester commit, per token)', ['publication']),
    ('Coordinator waits and scheduling gaps', ['coordinator.gaps', 'coordinator.leaseWait', 'coordinator.callOther']),
]
SUB = [('stage 1 activation readback', '1', 'activationReadbackMs'), ('stage 2 logits (projection)', '2', 'logitsMs'),
       ('stage 2 logits readback', '2', 'logitsReadbackMs'), ('stage 2 sampling', '2', 'samplingMs'),
       ('stage 1 GPU submit wait', '1', 'submitWaitMs'), ('stage 2 GPU submit wait', '2', 'submitWaitMs')]
for path in sys.argv[1:]:
    data = json.load(open(path))
    for turn in data['turns']:
        steps = [s for s in turn['steps'] if 'error' not in s and s['step'] > 0]
        if not steps: continue
        total = [s['totalMs'] for s in steps]
        print(f"\n**{data['probe']} / {turn['label']}** ({turn['promptTokens']} prompt tokens, {turn['generatedTokens']} generated; answer {turn['attemptMs'] / 1000:.1f} s; "
              f"{len(steps)} decode steps; route steps {turn['routeStepsMs'] / 1000:.1f} s"
              + (f"; admission {turn['admissionMs'] / 1000:.1f} s, completion {turn['completionMs'] / 1000:.1f} s" if turn.get('admissionMs') is not None else
                 f"; outside route steps {turn['outsideStepsMs'] / 1000:.1f} s") + ")\n")
        print('| Component per decode token | Mean ms | Median ms | Share of mean |')
        print('|---|---|---|---|')
        mean_total = statistics.fmean(total)
        for name, keys in GROUPS:
            values = [sum(s['segments'].get(k, 0) for k in keys) for s in steps]
            print(f"| {name} | {statistics.fmean(values):.1f} | {statistics.median(values):.1f} | {100 * statistics.fmean(values) / mean_total:.0f}% |")
            if name.startswith('AMD stage 2'):
                for sub, stage, key in SUB:
                    vals = [s['stages'][stage]['metrics'].get(key) for s in steps if s['stages'][stage]['metrics'].get(key) is not None]
                    if vals: print(f"| &nbsp;&nbsp;Doppler metric: {sub} | {statistics.fmean(vals):.1f} | {statistics.median(vals):.1f} | |")
        print(f"| **Route step (sum of the above)** | **{mean_total:.1f}** | **{statistics.median(total):.1f}** | 100% |")
        resid = max(abs(s['totalMs'] - s['sumMs']) for s in steps)
        print(f"\nLargest difference between a step's wall time and its component sum: {resid:.3f} ms.")

# Prompt steps (step 0: prefill of the whole prompt plus the first sampled token). For the prompt step Doppler's
# submit wait covers only the last submission, so the Mac row is the whole stage 0 call.
PROMPT = [('Mac stage 0 execution (whole call)', ['mac.gpuWait', 'mac.browserHost']), ('AMD stage 1 execution (Doppler)', ['amd1.doppler']),
          ('AMD stage 2 execution (Doppler)', ['amd2.doppler']), ('Transfer, hop 1 (incl. bulk activation both ways)', ['transfer.hop1']),
          ('Transfer, hop 2 (incl. bulk activation one way)', ['transfer.hop2'])]
print('\n**Prompt steps** (ms; everything else is grouped as "other")\n')
print('| Probe / turn | Prompt tokens | Step total | ' + ' | '.join(name for name, _ in PROMPT) + ' | Other |')
print('|---|---|---|' + '---|' * (len(PROMPT) + 1))
for path in sys.argv[1:]:
    data = json.load(open(path))
    for turn in data['turns']:
        step = next((s for s in turn['steps'] if s.get('step') == 0 and 'error' not in s), None)
        if not step: continue
        parts = [sum(step['segments'].get(k, 0) for k in keys) for _, keys in PROMPT]
        print(f"| {data['probe']} / {turn['label']} | {turn['promptTokens']} | {step['totalMs']:.0f} | " + ' | '.join(f'{v:.0f}' for v in parts)
              + f" | {step['totalMs'] - sum(parts):.0f} |")
