"""Exact tokenizer admission only; no weights or model output."""
from pathlib import Path
import argparse,hashlib,json
from transformers import AutoTokenizer
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent;suite=json.loads((root/'suite.json').read_text());inputs=json.loads((root/'inputs.json').read_text());binding=json.loads((root/'template-binding.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(Path(args.source)/'tokenizer_config.json')==binding['tokenizerConfigSha256']
assert sha(Path(args.source)/'download-receipt.json')==binding['sourceReceiptSha256']
tokenizer=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest()==binding['templateSha256']
rows=[]
for task,prepared in zip(suite['cases'],inputs['cases'],strict=True):
 assert task['id']==prepared['id'] and prepared['messages'][1:-1]==task['messages']==prepared['originalMessages']
 prompt=tokenizer.apply_chat_template(prepared['messages'],tools=prepared['schema'],tokenize=False,add_generation_prompt=True,enable_thinking=suite['enableThinking'])
 ids=tokenizer.encode(prompt,add_special_tokens=False)
 maximum=min(suite['aggregateBudgets']['generatedTokens'],suite['aggregateBudgets']['promptPlusGeneratedTokens']-len(ids))
 rows.append({'id':task['id'],'promptTokens':len(ids),'admittedGeneratedTokenLimit':max(0,maximum),'inputIdsSha256':hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest(),'fullOrderedHistoryPreserved':True,'admitted':maximum>0})
print(json.dumps({'schema':'reploid.source-ledger-token-preflight/v1','weightsLoaded':False,'modelGenerated':False,'files':{p.name:sha(p) for p in [root/'suite.json',root/'inputs.json',root/'template-binding.json',root/'preflight.py']},'cases':rows,'allAdmitted':all(r['admitted'] for r in rows),'limits':'Actual generated tokens and raw output plus report characters remain checked after the one call. Admission is not semantic acceptance.'},indent=2))
