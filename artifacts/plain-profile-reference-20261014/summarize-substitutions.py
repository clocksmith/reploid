#!/usr/bin/env python3
"""Collect substitution-check.mjs reports into one table (small JSON, no logits).

Usage: python3 summarize-substitutions.py <runs dir> <batch log>... <out.json>
"""
import json
import sys
from pathlib import Path


def main(runs_dir, *rest):
    *logs, out = rest
    runs_dir = Path(runs_dir)
    exits = {}
    for log in logs:
        for line in Path(log).read_text().splitlines():
            parts = line.split()
            if len(parts) > 1 and parts[1].startswith('exit='):
                exits[parts[0]] = {'exit': int(parts[1][5:]), 'seconds': int(parts[2][8:]),
                                   'amdgpuErrorsAfter': int(parts[-1]), 'batch': Path(log).stem}
    rows = []
    for name in sorted(exits):
        report_path = runs_dir / name / 'report.json'
        if not report_path.exists():
            rows.append({'run': name, **exits[name], 'report': None})
            continue
        report = json.loads(report_path.read_text())
        summary, speed = report.get('summary', {}), report.get('speed', {})
        rows.append({
            'run': name, 'label': report['label'], **exits[name],
            'manifestIdentity': report['manifestIdentity'], 'configSha256': report['configSha256'],
            'passed': summary.get('passed'), 'stepsWithinTolerance': summary.get('withinTolerance'),
            'comparedSteps': summary.get('comparedSteps'), 'tokenMatches': summary.get('tokenMatches'),
            'maxDifference': summary.get('maxDifference'), 'valuesOverTolerance': summary.get('valuesOverTolerance'),
            'requests': [{'attempt': r['attempt'], 'promptTokens': r['promptTokens'], 'promptMatchesFrozenPrefix': r['promptMatchesFrozenPrefix'],
                          'maxDifference': r['maxDifference'], 'failedSteps': r['failedSteps'],
                          'stepMax': [s['maxDifference'] for s in r['steps']]} for r in report['requests']],
            'prompt56Ms': speed.get('summary', {}).get('prompt56Ms'), 'prompt184Ms': speed.get('summary', {}).get('prompt184Ms'),
            'decodeMedianMs': speed.get('summary', {}).get('decodeMedianMs'),
            'speedPasses': speed.get('passes'), 'checkRequest2Decode': speed.get('checkRequest2Decode'),
            'substitutionCounts': report.get('substitutionCounts'), 'hybridTransfers': report.get('hybridTransfers'),
            'hybridParameterDifferences': report.get('hybridParameterDifferences'),
            'finalCaches': [r.get('finalCaches') for r in report['requests'] if r.get('finalCaches')] or None,
            'gpu': report.get('gpu'), 'startedAt': report['startedAt'], 'finishedAt': report.get('finishedAt'),
        })
    Path(out).write_text(json.dumps({'schema': 'reploid.plain-substitution-summary/v1', 'runs': rows}, indent=1) + '\n')
    for row in rows:
        if row.get('label'):
            print(f"{row['run']:<46} pass={row['passed']!s:<5} within={row['stepsWithinTolerance']:>2}/55 max={row['maxDifference']:.3e} "
                  f"p56={row['prompt56Ms'] / 1000:.2f}s p184={row['prompt184Ms'] / 1000:.2f}s dec={row['decodeMedianMs']:.1f}ms")


if __name__ == '__main__':
    main(*sys.argv[1:])
