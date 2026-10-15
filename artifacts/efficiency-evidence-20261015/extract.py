"""Extract only numeric latency evidence; never edit the other session's campaign."""
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
SOURCE=REPO/'artifacts/placement-c-envelope-20261015/breakdown'
rows=[]
for filename in ['breakdown-1.json','breakdown-2.json']:
    path=SOURCE/filename
    raw=path.read_bytes(); data=json.loads(raw)
    assert data['schema']=='reploid.placement-c-latency-breakdown/v1'
    for t in data['turns']:
        d=t.get('decode')
        if not d: continue
        rows.append({'source':str(path.relative_to(REPO)),'source_sha256':hashlib.sha256(raw).hexdigest(),
                     'source_status':'other-session diagnostic, uncommitted when extracted; not release acceptance',
                     'label':t['label'],'input_tokens':t['promptTokens'],'output_tokens':t['generatedTokens'],
                     'answer_ms':t['attemptMs'],'first_token_ms':t['firstVisibleTextMs'],
                     'prompt_captured':t.get('prompt') is not None,'step_error_count':len(t.get('stepErrors') or []),
                     'decode_mean_ms':d['totalMean'],'decode_median_ms':d['totalMedian'],
                     'decode_mean_segments_ms':{k:v['mean'] for k,v in d['segments'].items()}})
controls=[]
for path in sorted(SOURCE.glob('turns-*.json')):
    raw=path.read_bytes();d=json.loads(raw)
    controls.append({'source':str(path.relative_to(REPO)),'sha256':hashlib.sha256(raw).hexdigest(),
                     'started_at':d['startedAt'],'finished_at':d['finishedAt'],
                     'turns':[{'label':t['label'],'tokens':t['generatedTokens'],
                               'answer_ms':t['timing']['requester']['attemptMs']['value']} for t in d['turns']]})
(HERE/'trace-extract.json').write_text(json.dumps({'schema':'reploid.efficiency-trace-extract/v1',
    'status':'provisional diagnostics; all six turns retained, including incomplete prompt capture',
    'scope':'transfer is a residual including transport and event-loop delivery; execution boundary is not pure GPU time',
    'rows':rows,'uninstrumented_and_instrumented_controls':controls},indent=2)+'\n')
print('Extracted six diagnostic turns and four baseline/instrumented runs; originals unchanged.')
