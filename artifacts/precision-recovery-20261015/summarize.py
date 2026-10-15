#!/usr/bin/env python3
"""Collect the precision-recovery session runs (precision-check.mjs reports) into one summary.

Usage: python3 summarize.py <session dir> <approved-cache-identities.json> <K/V control run> <summary.json> <run>...

Two separate results per run, never merged:
  acceptance  the unchanged 55-step comparison: every one of the 248,320 logits within 0.001 of the
              approved F64 reference at all 55 steps and every token equal. Margin = 1 - max/0.001.
  K/V         (regression, reported separately) the twelve request-2 full-attention caches after all 51
              prefixes against the approved F64 identities, and value by value against the control run's
              stored F16 bytes (the paired control, whose caches equal the approved identities). An F32
              cache has no F16 identity; its values are rounded to nearest F16 (numpy, ties to even) for
              the value comparison, and that rounding is labelled.
Speed, preparation and memory come from the same process (precision-check.mjs) and the session logs
(scope peak).
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

session_dir, identities_path, control_name, summary_path, *runs = sys.argv[1:]
session_dir = Path(session_dir)
approved = {row['layer']: row for row in json.loads(Path(identities_path).read_text())['caches']}


def scope_peaks():
    peaks = {}
    for log in sorted(session_dir.glob('session-*.log')):
        for line in log.read_text().splitlines():
            match = re.match(r'(\S+) exit=(-?\d+) seconds=(\d+) .*scope-peak-bytes=(\d+)', line)
            if match:
                peaks[match.group(1)] = {'exit': int(match.group(2)), 'seconds': int(match.group(3)),
                                         'scopePeakBytes': int(match.group(4)), 'stopped': 'STOPPED' in line}
    return peaks


def cache_values(name):
    """{(layer, kind): uint16 nearest-F16 bits}, plus whether the stored values were F32."""
    directory = session_dir / 'out' / name / 'caches'
    meta_path = directory / 'request-2.json'
    if not meta_path.exists():
        return None, None
    meta = json.loads(meta_path.read_text())
    is_f32 = any(row.get('kvDtype') == 'f32' for row in meta['layers'])
    data = (directory / ('request-2.f32' if is_f32 else 'request-2.f16')).read_bytes()
    values, cursor = {}, 0
    for row in meta['layers']:
        count = row['seqLen'] * row['numHeads'] * row['headDim']
        for kind in ('key', 'value'):
            if row.get('kvDtype') == 'f32':
                chunk = np.frombuffer(data, dtype='<f4', count=count, offset=cursor)
                values[(row['layer'], kind)] = chunk.astype('<f2').view('<u2')
                cursor += 4 * count
            else:
                values[(row['layer'], kind)] = np.frombuffer(data, dtype='<u2', count=count, offset=cursor)
                cursor += 2 * count
    return values, {'layers': meta['layers'], 'storedF32': is_f32}


def ordered(bits):
    bits = bits.astype(np.int32)
    return np.where(bits & 0x8000, -(bits & 0x7fff), bits)


control_values, _ = cache_values(control_name)
peaks = scope_peaks()
summary = {'schema': 'reploid.precision-recovery-summary/v1', 'kvControl': control_name, 'runs': {}}
for name in runs:
    report_path = session_dir / 'out' / name / 'report.json'
    if not report_path.exists():
        summary['runs'][name] = {'report': None, 'session': peaks.get(name)}
        continue
    report = json.loads(report_path.read_text())
    acceptance = report.get('summary') or {}
    speed = report['speed']
    row = {'label': report['label'], 'manifestIdentity': report['manifestIdentity'],
           'splitFrontManifestIdentity': report.get('splitFrontManifestIdentity'), 'dopplerVersion': report['dopplerVersion'],
           'configSha256': report['configSha256'], 'acceptance': acceptance,
           'marginToTolerance': (1 - acceptance['maxDifference'] / 0.001) if acceptance.get('maxDifference') is not None else None,
           'error': report.get('error'),
           'perRequest': [{'promptTokens': r['promptTokens'], 'maxDifference': r.get('maxDifference'),
                           'failedSteps': r.get('failedSteps')} for r in report['requests']],
           'speed': {**(speed.get('summary') or {}), 'checkRequest2DecodeMedianMs': (speed.get('checkRequest2Decode') or {}).get('medianMs'),
                     'passes': speed.get('passes')},
           'preparation': report.get('preparation'), 'memory': report.get('memory'), 'resolved': report.get('resolved'),
           'splitBoundary': report.get('splitBoundary'), 'session': peaks.get(name),
           'stepMaxDifferences': [s['maxDifference'] for r in report['requests'] for s in r['steps']]}
    final = report['requests'][2].get('finalCaches') if len(report['requests']) > 2 else None
    if final:
        values, meta = cache_values(name)
        kv = {'storedF32': meta['storedF32'] if meta else None, 'layers': []}
        for cache in final:
            expected = approved[cache['layer']]
            entry = {'layer': cache['layer'], 'kvDtype': cache.get('kvDtype'), 'partition': cache.get('partition'),
                     'keyIdentityMatches': cache['keySha256'] == expected['keySha256'],
                     'valueIdentityMatches': cache['valueSha256'] == expected['valueSha256']}
            if values is not None and control_values is not None:
                for kind in ('key', 'value'):
                    a, b = values[(cache['layer'], kind)], control_values[(cache['layer'], kind)]
                    differ = a != b
                    steps = np.abs(ordered(a[differ]) - ordered(b[differ]))
                    entry[kind + 'DifferingVsControl'] = int(differ.sum())
                    entry[kind + 'MaxF16Steps'] = int(steps.max()) if steps.size else 0
            kv['layers'].append(entry)
        kv['identitiesMatched'] = sum(l['keyIdentityMatches'] + l['valueIdentityMatches'] for l in kv['layers'])
        kv['identities'] = 2 * len(kv['layers'])
        if values is not None and control_values is not None:
            kv['differingVsControl'] = sum(l.get('keyDifferingVsControl', 0) + l.get('valueDifferingVsControl', 0) for l in kv['layers'])
            kv['valuesCompared'] = int(sum(v.size for v in values.values()))
            kv['comparison'] = ('nearest F16 of each stored F32 value' if kv['storedF32'] else 'stored F16 bits') + ' vs control stored F16 bits'
        row['kv'] = kv
    summary['runs'][name] = row

Path(summary_path).write_text(json.dumps(summary, indent=1) + '\n')
for name, row in summary['runs'].items():
    if not row.get('label'):
        print(f'{name:16s} no report {row.get("session")}')
        continue
    a, s, p, m, kv = row['acceptance'], row['speed'], row['preparation'] or {}, row['memory'] or {}, row.get('kv') or {}
    if not a:
        print(f"{name:16s} no result (process exit {(row.get('session') or {}).get('exit')}; see out/{name}.log)")
        continue
    print(f"{name:16s} {a.get('withinTolerance')}/55 tok {a.get('tokenMatches')} max {a.get('maxDifference'):.3e} "
          f"margin {row['marginToTolerance']:+.1%} pass={a.get('passed')} | K/V id {kv.get('identitiesMatched')}/{kv.get('identities')} "
          f"diff {kv.get('differingVsControl')} | p56 {s['prompt56Ms'] / 1000:.2f}s p184 {s['prompt184Ms'] / 1000:.2f}s "
          f"dec {s['decodeMedianMs']:.1f}ms (chk {s['checkRequest2DecodeMedianMs']:.1f}) | open {sum(p.get('openMs', {}).values()) / 1000:.1f}s "
          f"first-use p56 {p.get('firstUsePrefill56Ms', 0) / 1000:.1f}s | pool {m.get('pool', {}).get('peakBytesAllocated')} "
          f"hwm {m.get('process', {}).get('vmHWMBytes')} scope {(row.get('session') or {}).get('scopePeakBytes')}")
