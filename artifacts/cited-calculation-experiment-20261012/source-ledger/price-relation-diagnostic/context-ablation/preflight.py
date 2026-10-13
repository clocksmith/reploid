import argparse,hashlib,json
from pathlib import Path
from tokenizers import Tokenizer
from transformers import AutoTokenizer
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',required=True);args=p.parse_args()
root=Path(__file__).resolve().parent;suite=json.loads((root/'suite.json').read_text());q=Tokenizer.from_file(str(Path(args.source)/'tokenizer.json'));official=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
sha=lambda b:hashlib.sha256(b).hexdigest();assert sha(official.chat_template.encode())=='a55ee1b1660128b7098723e0abcd92caa0788061051c62d51cbe87d9cf1974d8'
rows=[]
for task in suite['cases']:
 messages=[{'role':'system','content':suite['instruction']}]+task['messages'];rendered=official.apply_chat_template(messages,tokenize=False,add_generation_prompt=True,enable_thinking=False)
 ids=q.encode(rendered,add_special_tokens=False).ids;assert ids==official.encode(rendered,add_special_tokens=False)
 rows.append({'id':task['id'],'promptTokens':len(ids),'maximumGenerated':64,'maximumCharged':len(ids)+64,'inputIdsSha256':sha(json.dumps(ids,separators=(',',':')).encode())})
total=sum(x['maximumCharged'] for x in rows);assert total<=8192 and len(rows)*64<=4096
# Composition projection uses the exact retained full-task monetary occurrences, not fresh diagnostic labels.
composition=json.loads((root.parent/'composition-inputs.json').read_text());projections=[]
for case in composition['cases']:
 sizes=[]
 for occurrence in case['occurrences']:
  msg=occurrence['messages'];payload=json.loads(msg[-1]['content']);payload['questionContext']=[]
  changed=[*msg[:-1],{'role':'user','content':json.dumps(payload,ensure_ascii=False,separators=(',',':'))}]
  text=official.apply_chat_template(changed,tokenize=False,add_generation_prompt=True,enable_thinking=False);sizes.append(len(q.encode(text,add_special_tokens=False).ids))
 projections.append({'id':case['id'],'moneyCalls':len(sizes),'moneyPromptTokens':sum(sizes),'moneyMaximumGenerated':64*len(sizes),'moneyMaximumCharged':sum(sizes)+64*len(sizes),'remainingForEveryOtherCallAndFinalAnswer':8192-sum(sizes)-64*len(sizes),'fullyAdmitted':False})
Path(args.out).write_text(json.dumps({'schema':'reploid.price-context-token-preflight/v1','sourceModelExecuted':False,'suiteSha256':sha((root/'suite.json').read_bytes()),'templateSha256':sha(official.chat_template.encode()),'rows':rows,'aggregate':{'promptTokens':sum(x['promptTokens'] for x in rows),'maximumGenerated':64*len(rows),'maximumCharged':total,'limit':8192},'fullTaskMoneyStageProjections':projections,'limitation':'Fresh matched diagnostic calls are not production overhead. A selected format would replace previous money-stage calls, not accumulate experiments inside a conversation. Exact condition/date/deposit calls, actual tool-result growth and original-history final response must fit the stated residual. Full workflow not yet admitted.'},indent=2)+'\n')
