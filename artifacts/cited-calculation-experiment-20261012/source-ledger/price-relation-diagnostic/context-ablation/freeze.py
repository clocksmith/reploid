from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent;parent=root.parent;repo=parent.parents[3]
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
old=json.loads((parent/'freeze.json').read_text())
reused=dict(old['reusedSources'])
for name in ['contract.py','constraint_adapter.py','freeze.json','composition-inputs.json','token-preflight.json','first-result/review.json','first-result/source.json.gz']:
 path=parent/name;reused[str(path.relative_to(repo))]=sha(path)
freeze={key:old[key] for key in ['model','sourceRevision','sourceIdentity','dopplerSources','libraries','processorSourceSha256','sourceReceiptValidation']}
freeze.update(schema='reploid.price-context-ablation-freeze/v1',status='frozen; parent reviewed exact preflight and authorized one matched CPU batch after checkpoint',
 templateSha256='a55ee1b1660128b7098723e0abcd92caa0788061051c62d51cbe87d9cf1974d8',
 files={p.name:sha(p) for p in sorted(root.iterdir()) if p.suffix in ['.py','.json'] and p.name not in ['freeze.json','runner-control.json']},reusedSources=reused,
 hypothesis='Global task-wide comparison context may distract from the explicit local role of a monetary occurrence. Test removal of that context only. Previous semantic failure remains rejected; this mechanism is unproven.',
 selectionRule='Exactly nine fresh occurrences, original declared order, control then treatment for each. Includes all seven labels, two deposit wordings, and both unconditional/conditional additional charges. No output-based selection.',
 mechanism='Only questionContext array changes from the frozen global comparison question to empty. Same seven global labels, definitions, source passages/offsets, model, official template, greedy nonthinking repetition1.0 and grammar. All labels remain available. No arithmetic, output repair, retry or final answer.',
 preflight={'calls':18,'promptTokens':6503,'maximumGenerated':1152,'maximumCharged':7655,'aggregateLimits':{'generated':4096,'charged':8192,'rawUtf16':16000}},
 stop='Stop on first structural or aggregate budget failure. Otherwise complete all18 calls, retain every matched semantic outcome, and obtain independent review. No favorable subset or retry.',
 acceptance='Treatment must satisfy all9 frozen local semantic criteria. Even9/9 does not qualify complete tasks, any converted model, or production. Every original factual/citation/followup/condition criterion and two locked holdouts remains unchanged.',
 composition='This is diagnostic comparison cost, not overhead to append inside a conversation. A selected local format replaces the money stage. Original first-case money max2951 plus empty final prompt878 leaves4363 for missing condition/date/deposit work, actual tool growth and final generation; retained contractor correction money2120 plus empty final1957 leaves4115. Actual full composition still requires preflight and full task evaluation.',
 launch='Parent reviewed concrete preflight and residual full-task limitation, authorizing one batch after synthetic controls and commit. CPU4-7 fourthreads nice10, coexecution with numerical correctness; no GPU/download/performance claim.')
(root/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n');print(sha(root/'freeze.json'))
