"""Exact tokenizer controls; no model weights, generated answers or semantic selections."""
from pathlib import Path
import argparse,hashlib,json
from transformers import AutoTokenizer
p=argparse.ArgumentParser();p.add_argument('--source',required=True);args=p.parse_args()
root=Path(__file__).resolve().parent;suite=json.loads((root/'suite.json').read_text());inputs=json.loads((root/'inputs.json').read_text());binding=json.loads((root/'template-binding.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(Path(args.source)/'tokenizer_config.json')==binding['tokenizerConfigSha256']
assert sha(Path(args.source)/'download-receipt.json')==binding['sourceReceiptSha256']
t=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
assert hashlib.sha256(t.chat_template.encode()).hexdigest()==binding['templateSha256']
rows=[]
for task,item in zip(suite['cases'],inputs['cases'],strict=True):
 assert task['id']==item['id']
 assert task['messages']==item['selectionMessages'][1:-1]==item['minimumAnswerMessages'][1:-2]
 phases={}
 for phase,messages,tools in [('selection',item['selectionMessages'],item['schema']),('emptyAnswerControl',item['minimumAnswerMessages'],[])]:
  rendered=t.apply_chat_template(messages,tools=tools,tokenize=False,add_generation_prompt=True,enable_thinking=suite['enableThinking'])
  ids=t.encode(rendered,add_special_tokens=False)
  phases[phase]={'promptTokens':len(ids),'inputIdsSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()}
 minimum=sum(row['promptTokens'] for row in phases.values())
 residual=suite['aggregateBudgets']['promptPlusGeneratedTokens']-minimum-suite['selectionMaximumGeneratedTokens']
 rows.append({'id':task['id'],'phases':phases,'sumPromptsWithEmptyToolControl':minimum,'remainingAtSelectionCapAndEmptyToolControl':residual,'evenEmptyControlFits':residual>0,'actualFinalAdmissionRequired':True})
print(json.dumps({'schema':'reploid.row-tag-token-preflight/v1','modelExecuted':False,'weightsLoaded':False,'files':{n:sha(root/n) for n in ['inputs.json','suite.json','template-binding.json','preflight.py']},'cases':rows,'allEmptyControlsFit':all(r['evenEmptyControlFits'] for r in rows),'scope':'Empty tool response controls are not actual model outputs or upper-bound proofs. All actual final messages must be tokenized and charged before invocation. No history/input dropping, budget increase or guaranteed final allowance.'},indent=2))
