"""Summarizes the application's own timing records (reploid.signed-completion-answer-timing/v2) of one or more
journey reports: per attempt, the complete-answer latency (requester attemptMs), time to first visible text,
prompt tokens, and per stage the prompt step (prefill plus first sampled token) and the decode steps
(coordinator elapsed per token; contributor Doppler execution per token; the remainder bounds transfer,
waiting and publication from above, as the timing README states). Read-only.
Usage: python3 summarize-timing.py <report.json>... [--json out.json]"""
import json, sys

args = sys.argv[1:]
out = None
if '--json' in args:
    i = args.index('--json'); out = args[i + 1]; args = args[:i] + args[i + 2:]
value = lambda field: field.get('value') if isinstance(field, dict) and 'value' in field else None
rows = []
for path in args:
    report = json.load(open(path))
    for rec in report.get('timing', []):
        coordinator = rec.get('coordinator', {})
        phases = coordinator.get('phases') or {}
        row = {'report': path.split('/')[-1], 'attemptId': rec.get('attemptId'), 'status': rec.get('status'),
               'promptTokens': value(coordinator.get('promptTokens')),
               'attemptMs': value(rec.get('requester', {}).get('attemptMs')),
               'firstVisibleTextMs': value(rec.get('requester', {}).get('firstVisibleTextMs')), 'stages': []}
        prompt = {s['partitionIndex']: s for s in (phases.get('prompt') or {}).get('stages', [])}
        decode = {s['partitionIndex']: s for s in (phases.get('decode') or {}).get('stages', [])}
        for index in sorted(set(prompt) | set(decode)):
            p, d = prompt.get(index, {}), decode.get(index, {})
            stage = {'index': index, 'promptElapsedMs': p.get('elapsedMs'), 'promptExecutionMs': (p.get('runtime') or {}).get('executionMs')}
            el, ex = d.get('elapsedMs'), (d.get('runtime') or {}).get('executionMs')
            if isinstance(el, dict) and el.get('count'):
                stage['decodeSteps'] = el['count']
                stage['decodeElapsedMsPerToken'] = el['total'] / el['count']
                stage['decodeMaxMs'] = el['max']
                if isinstance(ex, dict) and ex.get('count'):
                    stage['decodeExecutionMsPerToken'] = ex['total'] / ex['count']
                    stage['decodeOutsideExecutionMsPerToken'] = stage['decodeElapsedMsPerToken'] - stage['decodeExecutionMsPerToken']
                for key in ['submitWaitMs', 'logitsMs', 'encodeMs']:
                    field = (d.get('runtime') or {}).get(key)
                    if isinstance(field, dict) and field.get('count'): stage[key + 'PerToken'] = field['total'] / field['count']
            row['stages'].append(stage)
        steps = [s.get('decodeSteps') for s in row['stages'] if s.get('decodeSteps')]
        row['generatedTokens'] = (steps[0] + 1) if steps else None
        row['decodeMsPerTokenSum'] = sum(s.get('decodeElapsedMsPerToken', 0) for s in row['stages']) or None
        rows.append(row)
fmt = lambda x, d=0: '-' if x is None else (f'{x:.{d}f}' if isinstance(x, (int, float)) else str(x))
for r in rows:
    print(f"{r['report'][:40]} {str(r['attemptId'])[:8]} {r['status']:<10} prompt={fmt(r['promptTokens'])} gen={fmt(r['generatedTokens'])} "
          f"answer={fmt(r['attemptMs'] and r['attemptMs'] / 1000, 1)}s first-text={fmt(r['firstVisibleTextMs'] and r['firstVisibleTextMs'] / 1000, 1)}s "
          f"decode-sum={fmt(r['decodeMsPerTokenSum'])}ms/token")
    for s in r['stages']:
        print(f"    stage {s['index']}: prompt {fmt(s['promptElapsedMs'] and s['promptElapsedMs'] / 1000, 2)}s (exec {fmt(s['promptExecutionMs'] and s['promptExecutionMs'] / 1000, 2)}s) "
              f"decode {fmt(s.get('decodeElapsedMsPerToken'))} ms/token (exec {fmt(s.get('decodeExecutionMsPerToken'))}, outside {fmt(s.get('decodeOutsideExecutionMsPerToken'))}, "
              f"submit-wait {fmt(s.get('submitWaitMsPerToken'))}, logits {fmt(s.get('logitsMsPerToken'))}) max {fmt(s.get('decodeMaxMs'))}")
if out:
    with open(out, 'x') as handle: json.dump(rows, handle, indent=1); handle.write('\n')
