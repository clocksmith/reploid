from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent;repo=root.parents[3];previous=json.loads((root.parent/'grammar-experiment/freeze.json').read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
reused={}
for directory,names in [('grammar-experiment',['constraint.py','grammar.py','freeze.json']),('row-tag-experiment',['inputs.json','suite.json','template-binding.json','token-preflight.json','source-weight-binding.json','freeze.json']),('row-tag-proposal',['locked-holdouts.json'])]:
 for name in names:
  path=root.parent/directory/name;reused[str(path.relative_to(repo))]=sha(path)
freeze={
 'schema':'reploid.single-price-relation-freeze/v1','status':'prepared; no source-model execution; parent review required',
 'model':previous['model'],'sourceRevision':previous['sourceRevision'],'sourceIdentity':previous['sourceIdentity'],
 'dopplerSources':previous['dopplerSources'],'libraries':previous['libraries'],'processorSourceSha256':previous['processorSourceSha256'],
 'files':{p.name:sha(p) for p in sorted(root.iterdir()) if p.suffix in ['.py','.json'] and p.name not in ['freeze.json','runner-control.json']},'reusedSources':reused,
 'hypothesis':'A single local mutually exclusive relation may be selectable when whole-ledger global tag-list assignment fails. This isolates context/decision breadth; it does not establish full document capability.',
 'selectionRule':'Exactly the first document monetary occurrence in the first reused original case, retained row2. No outcome-based case/seed selection.',
 'input':'Exact D1:P1 passage/value/occurrence offsets and exact original question context; original ordered history and all full-task criteria retained in input.json but not duplicated inside this source-only diagnostic.',
 'output':'One JSON relation field, with seven globally available labels. All labels, including unknown and incorrect alternatives, remain model-selected. No source-dependent semantic masking or output repair.',
 'relationAuthority':'Local textual role of this particular occurrence. quoted_total excludes occurrences used only inside deposit calculations; deposit_basis excludes occurrences introducing a quote total. If the same occurrence supports multiple definitions, unknown; no precedence/default.',
 'policy':'Original cached Qwen3-1.7B, nonthinking greedy/repetition1.0, unchanged source/template/math. Diagnostic max64 tokens within original aggregate4096generated/8192total/16000rawUTF16; no extra calls.',
 'cost':{'promptTokens':407,'maximumGenerated':64,'maximumCharged':471,'composition':'Tokenizer-only money-stage costs are in token-preflight.json. First full case money stage needs7calls,2881prompt+448maximumgenerated; old empty final control878 leaves3985 for all remaining work. Long retained correction leaves3240. Actual full composition, nonmonetary interpretation, tool result growth and final prose are not qualified.'},
 'stopping':'One source call only, then retain raw IDs/logits-mask decisions and await independent semantic review. No next occurrence, calculator, final answer, seed, fallback, or retry. Any structural/budget failure retained.',
 'acceptance':'Correct relation is only a local diagnostic observation. Full seven factual/citation/condition/correction cases and two locked holdouts remain unchanged and unqualified; original ordered history must be restored in any future final-answer path. Source-exact operands are not semantic entailment.',
 'sourceReceiptValidation':previous['sourceReceiptValidation'],'launch':'No source model before reviewed freeze/resource window. If approved CPUs4-7,fourthreads,nice10,noGPU/download.'}
(root/'freeze.json').write_text(json.dumps(freeze,indent=2)+'\n');print(sha(root/'freeze.json'))
