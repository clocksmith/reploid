"""Freeze artifact-only syntax treatment; never inspect generated model results."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent;repo=root.parents[3];parent=root.parent/'row-tag-experiment'
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
previous=json.loads((parent/'freeze.json').read_text());reused=dict(previous['reusedSources'])
for name in previous['files']:reused[str((parent/name).relative_to(repo))]=previous['files'][name]
reused[str((parent/'freeze.json').relative_to(repo))]=sha(parent/'freeze.json')
for name,digest in reused.items():assert sha(repo/name)==digest,name
freeze={
 'schema':'reploid.syntax-row-treatment-freeze/v1','status':'frozen before source-model output; launch requires parent review',
 'model':previous['model'],'sourceRevision':previous['sourceRevision'],'parentRejectedRevision':'f64214a1',
 'sourceIdentity':{**previous['sourceIdentity'],'tokenizer.json':'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4'},
 'files':{p.name:sha(p) for p in sorted(root.iterdir()) if p.suffix=='.py'},
 'reusedSources':reused,'dopplerSources':previous['dopplerSources'],
 'libraries':{'transformers':'5.6.2','tokenizers':'0.22.2','torch':'2.11.0'},
 'processorSourceSha256':'e0b62e949a3510cac6d762ce7ac1968f2622ae01edb7a2ef7d555bff9da310cf',
 'hypothesis':'The prior 300-token selection failed envelope, row counts and allowed tags. Constrain only that output language before token selection; test whether unchanged source model can now choose useful roles. No semantic selection is constrained or repaired.',
 'changedMechanism':'One hash-verified in-memory insertion before the frozen evaluator greedy argmax calls installed Transformers PrefixConstrainedLogitsProcessor. Model, cache, logits, penalty policy, prompts, original histories, calculator, and final-answer generation otherwise unchanged.',
 'grammar':{'canonicalEnvelope':'<tool_call>\\n{"name":"AnnotateSource","arguments":{"factRoles":ARRAY,"passageRelations":ARRAY}}\\n</tool_call>',
 'arrays':'Exact input schema row counts; each row contains zero or more unique schema enum strings, up to unchanged schema maxItems.',
 'semanticFreedom':'Every global allowed role is available on every fact row; no row-specific type masks or expected roles. Invalid semantics still fail unchanged adapter/manual review.',
 'tokenAdmission':'ASCII ByteLevel tokens and exact special wrappers; before sampling every candidate full decode must equal trie concatenation and official tokenizer decode with cleanup disabled. Fail closed on mismatch.',
 'termination':'Only EOS can follow complete grammar. This is grammar-terminal EOS, not evidence of unconstrained natural stopping. Record raw winner, allowed count, selected raw score, forced-EOS flag, and every generated token. Final answer remains unconstrained and must naturally stop.'},
 'policy':previous['policy'],'budgets':previous['budgets'],'criteria':previous['criteria'],'stopping':previous['stopping'],
 'accounting':'All syntax, tags and EOS tokens count toward 1024 selection and shared4096 generated/8192 prompt-plus-generated/16000 UTF16. No forced output insertion, hidden retries, additional allowance or answer rewrite. Actual final history is admitted after selected tool result.',
 'sourceReceiptValidation':previous['sourceReceiptValidation'],
 'scope':'Artifact-only source configuration. Parser success does not prove factual selection, entailment, converted/runtime quality, or production qualification.',
 'launch':'Do not start model before parent freeze review and resource coordination. CPU4-7,4threads,nice10; no GPU/download.'}
(root/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n')
print(sha(root/'freeze.json'))
