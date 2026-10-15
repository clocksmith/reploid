# Collects one session's runs into a summary.
#
# Usage: python3 summarize.py <out dir> <session prefix> <approved-cache-identities.json>
#          <cache control check name> <summary.json>
#
# For each 55-step check (<prefix>-*-check/report.json) it reports two separate gates:
#   acceptance  all 55 steps within 0.001 of the approved F64 reference and every token equal
#               (the unchanged comparison of substitution-check.mjs);
#   cache       the twelve request-2 F16 K/V cache hashes after all 51 prefixes equal the approved
#               F64 evaluator's identities. When a run dumps cache bytes, the number of stored F16
#               values that differ from the named control run's bytes is counted per layer.
# Speed rows come from the same checks (56- and 184-token prompts, decode median) and from the
# speed ladder (paired-unsplit / ordinary-per-token turns, paired-profile / ordinary-profile GPU
# time per kernel family).
import glob
import json
import os
import sys

out_dir, prefix, identities_path, control_name, summary_path = sys.argv[1:6]
approved = {row['layer']: row for row in json.load(open(identities_path))['caches']}


def load(path):
    with open(path) as handle:
        return json.load(handle)


def ordered_half(bits):
    # Monotone integer order of F16 bit patterns: adjacent representable values differ by one.
    return -(bits & 0x7fff) if bits & 0x8000 else bits


def cache_bytes(name):
    path = os.path.join(out_dir, name, 'caches', 'request-2.f16')
    meta = os.path.join(out_dir, name, 'caches', 'request-2.json')
    if not os.path.exists(path):
        return None, None
    return open(path, 'rb').read(), load(meta)


control_bytes, control_meta = cache_bytes(control_name)
summary = {'session': prefix, 'checks': {}, 'ladder': {}}
for report_path in sorted(glob.glob(os.path.join(out_dir, f'{prefix}-*-check', 'report.json'))):
    name = os.path.basename(os.path.dirname(report_path))
    report = load(report_path)
    row = {'label': report['label'], 'manifestIdentity': report['manifestIdentity'],
           'dopplerVersion': report['dopplerVersion'], 'acceptance': report.get('summary'),
           'perRequestMax': [request.get('maxDifference') for request in report['requests']],
           'speed': report['speed'].get('summary')}
    final = report['requests'][2].get('finalCaches') if len(report['requests']) > 2 else None
    if final:
        layers = []
        for cache in final:
            expected = approved[cache['layer']]
            layers.append({'layer': cache['layer'], 'seqLen': cache['seqLen'],
                           'keyMatches': cache['keySha256'] == expected['keySha256'],
                           'valueMatches': cache['valueSha256'] == expected['valueSha256']})
        row['cacheGate'] = {'identitiesMatched': sum(l['keyMatches'] + l['valueMatches'] for l in layers),
                            'identities': 2 * len(layers), 'layers': layers}
        row['cacheGate']['passed'] = row['cacheGate']['identitiesMatched'] == 12
        data, meta = cache_bytes(name)
        if data is not None and control_bytes is not None and name != control_name:
            def shape(layers):
                return [{k: v for k, v in l.items() if not k.endswith('Sha256')} for l in layers]
            if shape(meta['layers']) != shape(control_meta['layers']):
                raise SystemExit(f'{name}: cache layout differs from control')
            counts, examples, cursor = [], [], 0
            for layer in meta['layers']:
                size = layer['seqLen'] * layer['numHeads'] * layer['headDim'] * 2
                for kind in ('key', 'value'):
                    a, b = data[cursor:cursor + size], control_bytes[cursor:cursor + size]
                    differing, steps = 0, {}
                    for i in range(0, size, 2):
                        if a[i:i + 2] == b[i:i + 2]:
                            continue
                        differing += 1
                        candidate, control = int.from_bytes(a[i:i + 2], 'little'), int.from_bytes(b[i:i + 2], 'little')
                        distance = abs(ordered_half(candidate) - ordered_half(control))
                        steps[distance] = steps.get(distance, 0) + 1
                        if len(examples) < 50:
                            element = i // 2
                            token, rest = divmod(element, layer['numHeads'] * layer['headDim'])
                            head, dim = divmod(rest, layer['headDim'])
                            examples.append({'layer': layer['layer'], 'kind': kind, 'token': token, 'head': head, 'dim': dim,
                                             'controlBits': control, 'candidateBits': candidate, 'f16Steps': distance})
                    counts.append({'layer': layer['layer'], 'kind': kind, 'differingValues': differing,
                                   'f16StepHistogram': {str(k): v for k, v in sorted(steps.items())}})
                    cursor += size
            row['cacheGate']['differingStoredValuesVsControl'] = {'control': control_name, 'perLayer': counts,
                                                                 'total': sum(c['differingValues'] for c in counts),
                                                                 'firstDifferences': examples}
    row['stepMaxDifferences'] = [step['maxDifference'] for request in report['requests'] for step in request['steps']]
    summary['checks'][name] = row

control_steps = summary['checks'].get(control_name, {}).get('stepMaxDifferences')
for name, row in summary['checks'].items():
    if control_steps and name != control_name and len(row['stepMaxDifferences']) == len(control_steps):
        pairs = list(zip(row['stepMaxDifferences'], control_steps))
        row['logitsMarginVsControl'] = {'control': control_name, 'maxDifference': max(a for a, _ in pairs),
                                        'controlMaxDifference': max(b for _, b in pairs),
                                        'maxStepChange': max(abs(a - b) for a, b in pairs),
                                        'stepsLarger': sum(1 for a, b in pairs if a > b)}

for path in sorted(glob.glob(os.path.join(out_dir, f'{prefix}-*.json'))):
    name = os.path.basename(path)[:-5]
    report = load(path)
    if 'mode' not in report:
        continue  # memory-peak and other non-ladder results
    row = {'mode': report['mode'], 'dopplerVersion': report.get('dopplerVersion'),
           'kernelSubstitution': report.get('verification', {}).get('kernelSubstitution', {}).get('substituted'),
           'executionIdentity': report.get('verification', {}).get('executionIdentity'), 'turns': []}
    for turn in report['turns']:
        if 'kernels' in turn:
            row['turns'].append({'label': turn['label'], 'promptTokens': turn['promptTokens'],
                                 'profiledSteps': turn['profiledSteps'], 'gpuPerStepMs': turn['gpuPerStepMs'],
                                 'wallMedianMs': (turn.get('wall') or {}).get('medianMs'),
                                 'kernels': {k['label']: k['perStepMs'] for k in turn['kernels']}})
        else:
            row['turns'].append({'label': turn['label'], 'promptTokens': turn['promptTokens'], 'tokens': turn.get('tokens'),
                                 'stopReason': turn.get('stopReason'), 'prefillMs': turn.get('prefillMs'),
                                 'decodeMedianMs': (turn.get('decode') or {}).get('medianMs'),
                                 'decodeTokensPerSecond': turn.get('decodeTokensPerSecond')})
    summary['ladder'][name] = row

with open(summary_path, 'w') as handle:
    json.dump(summary, handle, indent=1)
    handle.write('\n')

for name, row in summary['checks'].items():
    gate = row.get('cacheGate', {})
    acceptance = row['acceptance'] or {}
    print(f"{name:34s} 55-step {acceptance.get('withinTolerance')}/{acceptance.get('comparedSteps')} "
          f"tokens {acceptance.get('tokenMatches')} max {acceptance.get('maxDifference'):.3e} passed={acceptance.get('passed')} | "
          f"cache {gate.get('identitiesMatched')}/{gate.get('identities')} "
          f"diff-vs-control {gate.get('differingStoredValuesVsControl', {}).get('total')} | "
          f"p56 {row['speed']['prompt56Ms'] / 1000:.2f}s p184 {row['speed']['prompt184Ms'] / 1000:.2f}s "
          f"decode {row['speed']['decodeMedianMs']:.1f}ms")
for name, row in summary['ladder'].items():
    for turn in row['turns']:
        if 'kernels' in turn:
            top = ', '.join(f'{k} {v:.2f}' for k, v in sorted(turn['kernels'].items(), key=lambda kv: -kv[1])[:10])
            print(f"{name:34s} gpu {turn['gpuPerStepMs']:.1f}ms/step wall {turn['wallMedianMs']:.1f}ms | {top}")
        else:
            print(f"{name:34s} {turn['label']} prompt {turn['promptTokens']} tok {turn['prefillMs'] / 1000:.2f}s "
                  f"decode {turn['decodeMedianMs']:.1f}ms x{turn['tokens']} stop={turn['stopReason']}")
