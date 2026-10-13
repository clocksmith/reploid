from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent;parent=root.parent;repo=parent.parents[3]
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
old=json.loads((parent/'freeze.json').read_text());fixture=json.loads((root/'input.json').read_text())
reused=dict(old['reusedSources'])
for name in ['contract.py','constraint_adapter.py','freeze.json','composition-inputs.json','token-preflight.json','first-result/review.json','first-result/source.json.gz']:
 path=parent/name;reused[str(path.relative_to(repo))]=sha(path)
freeze={key:old[key] for key in ['model','sourceRevision','sourceIdentity','dopplerSources','libraries','processorSourceSha256','sourceReceiptValidation']}
freeze.update(schema='reploid.remaining-price-relation-freeze/v1',status='prepared six remaining source decisions; first observation retained, not repeated',
 templateSha256='a55ee1b1660128b7098723e0abcd92caa0788061051c62d51cbe87d9cf1974d8',
 files={p.name:sha(p) for p in sorted(root.iterdir()) if p.suffix in ['.py','.json'] and p.name not in ['freeze.json','runner-control.json']},reusedSources=reused,
 selectionRule='Exactly occurrences 2 through 7 in original first-case document-money row order. No source, relation, or seed selected by outcome. Observed first call remains unchanged.',
 mechanism='Same seven global relation labels, system definition, greedy nonthinking repetition1.0 original cached model, tokenizer and reviewed grammar. No source-specific semantic mask, retry, output repair, calculator or final answer.',
 preflight={'additionalCalls':6,'additionalPromptTokens':2474,'additionalMaximumGenerated':384,'retainedFirstActualCharged':415,'maximumAggregateCharged':3273,'aggregateLimits':{'generated':4096,'charged':8192,'rawUtf16':16000}},
 stop='Stop on first structural or budget failure; otherwise complete all six and obtain independent semantic review of all seven. A wrong semantic label is retained, never retried or repaired.',
 acceptance='Local relations only. Full original factual, citation, correction, condition and budget gates are unchanged and remain open. Additional_charge never proves a condition holds. No all-in total inferred from quoted_total.',
 launch='Parent authorized CPU4-7 four threads nice10 after freeze and tests; no GPU, downloads or production adoption.')
(root/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n');print(sha(root/'freeze.json'))
