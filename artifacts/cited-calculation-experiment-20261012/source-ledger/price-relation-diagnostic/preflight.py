"""Exact tokenizer costs without source weights; never claim complete-workflow feasibility."""
from pathlib import Path
import argparse,hashlib,json
from transformers import AutoTokenizer
from contract import DEFINITIONS
p=argparse.ArgumentParser();p.add_argument('--source',required=True);args=p.parse_args();root=Path(__file__).resolve().parent
source=Path(args.source);binding=json.loads((root.parent/'row-tag-experiment/template-binding.json').read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert sha(source/'tokenizer_config.json')==binding['tokenizerConfigSha256']
t=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
assert hashlib.sha256(t.chat_template.encode()).hexdigest()==binding['templateSha256']
fixture=json.loads((root/'input.json').read_text());controls=json.loads((root/'composition-inputs.json').read_text());old=json.loads((root.parent/'row-tag-experiment/token-preflight.json').read_text())
def size(messages):
 rendered=t.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
 ids=t.encode(rendered,add_special_tokens=False)
 return {'tokens':len(ids),'inputIdsSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()}
rows=[]
for case,previous in zip(controls['cases'],old['cases'],strict=True):
 assert case['id']==previous['id']
 calls=[size(value['messages']) for value in case['occurrences']];prompt=sum(v['tokens'] for v in calls);maximum=64*len(calls)
 empty=previous['phases']['emptyAnswerControl']['promptTokens']
 rows.append({'id':case['id'],'moneyCalls':len(calls),'selectionPrompts':prompt,'selectionGenerationMaximum':maximum,
 'exactOccurrencePrompts':calls,'oldEmptyFinalPromptControl':empty,'residualForNonmoneyInterpretationActualToolGrowthAndFinalGeneration':8192-prompt-maximum-empty,
 'scope':'Only money-stage admission cost. Existing empty final control is not the actual future tool response. Residual does not qualify or implement conditions/dates/relations/followups.'})
print(json.dumps({'schema':'reploid.single-price-preflight/v1','sourceModelExecuted':False,'templateSha256':binding['templateSha256'],'inputSha256':sha(root/'input.json'),
 'diagnostic':{**size(fixture['messages']),'maximumGenerated':64,'maximumPromptPlusGenerated':size(fixture['messages'])['tokens']+64},
 'canonicalOutputTokenCounts':{key:len(t.encode(json.dumps({'relation':key},separators=(',',':')),add_special_tokens=False))+1 for key in DEFINITIONS},
 'composition':rows,'wholeTaskFeasibilityQualified':False},indent=2))
