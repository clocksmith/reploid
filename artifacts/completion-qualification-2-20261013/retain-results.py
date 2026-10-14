"""Retain immutable capture and bounded measurements; never infer release acceptance."""
from pathlib import Path
import json, hashlib, gzip

ROOT = Path(__file__).resolve().parent
fixture = Path('/var/tmp/reploid-completion-qualification-2-20261013')
raw = (fixture / 'output/reference.json').read_bytes()
capture = json.loads(raw)
config = json.loads((ROOT / 'config.json').read_text())
sha = lambda data: 'sha256:' + hashlib.sha256(data).hexdigest()
assert not any(op['status'] == 'pending' for op in capture['operations']['operations'])
assert len(capture['residentSettlement']) == len(capture['descriptors'])
(ROOT / 'reference.json.gz').write_bytes(gzip.compress(raw, mtime=0))
rows = [row for run in capture['runs'] for row in run['numerical']]
cleanup = []
for stage in capture['residentSettlement']:
    snapshot = stage.get('snapshot') or {}
    cleanup.append({
        'executorId':stage['executorId'], 'residentClosed':stage['residentClosed'],
        'barriers':stage['barriers'], 'attemptsClosed':stage['attemptsClosed'],
        'error':stage.get('error'), 'ownership':stage.get('ownership'),
        'elapsedMs':stage['elapsedMs'],
        'devicePeakBytes':snapshot.get('device',{}).get('peakBytes'),
        'owners':{key:snapshot.get('pool',{}).get('resources',{}).get(key,{})
                  for key in ['active','deferredCleanup','retainedModel']},
        'deviceEvents':snapshot.get('deviceEvents'),
        'observationErrors':snapshot.get('observationErrors'),
    })
operations = capture['operations']['operations']
summary = {
    'schema':'reploid.completion-candidate-physical-summary/v1',
    'scope':capture['scope'], 'archiveSha256':config['archive']['hash'],
    'captureSha256':sha(raw), 'captureBytes':len(raw),
    'captureGzipSha256':sha((ROOT/'reference.json.gz').read_bytes()),
    'expectationsHash':config['expectations']['hash'],
    'prefixes':len(rows), 'requiredPrefixes':55, 'tolerance':0.001,
    'allNumericalMatches':len(rows)==55 and all(row.get('maxDifference',float('inf')) <= 0.001 for row in rows) and all(run.get('completed') for run in capture['runs']) and not capture.get('failure'),
    'maxDifference':max((row['maxDifference'] for row in rows),default=None),
    'maxStageMs':max((stage['elapsedMs'] for row in rows for stage in row['stageExecutions']),default=None),
    'logicalActivationBytes':sum(stage['activationOutput']['byteLength'] for row in rows
        for stage in row['stageExecutions'] if stage['activationOutput']),
    'transferScope':'Logical activations through diagnostic controller; network framing, peer acquisition and egress unmeasured',
    'operations':[ {k:op.get(k) for k in ['label','status','startedAt','finishedAt']} for op in operations],
    'cleanup':cleanup, 'nativeHostSettlements':capture['nativeHostSettlements'],
    'executorSettlements':capture['executorSettlements'],
    'failure':capture.get('failure'), 'cleanupFailure':capture.get('cleanupFailure'),
    'gpuLimitBytes':1420000000, 'publicPinChanged':False, 'applicationQualified':False,
    'performanceQualified':False,
}
(ROOT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
producer = {key:config[key] for key in ['expectations','reference','manifest','graph','archive','delivery','requestContracts']}
producer['capture']={'path':str(fixture/'output/reference.json'),'hash':sha(raw)}
evaluator = ROOT.parents[2] / 'doppler/tools/qwen35-f64-reference.py'
producer['evaluator']={'path':str(evaluator),'hash':sha(evaluator.read_bytes())}
(ROOT/'producer-config.json').write_text(json.dumps(producer,indent=2)+'\n')
print(json.dumps({key:summary[key] for key in ['prefixes','allNumericalMatches','maxDifference','failure','cleanupFailure']}))
