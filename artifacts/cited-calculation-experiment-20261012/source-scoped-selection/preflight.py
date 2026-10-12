"""Tokenizer-only admission; empty tool probes are never model evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from transformers import AutoTokenizer
from protocol import response_messages

parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent
suite=json.loads((root/'suite.json').read_text());parent=json.loads((root.parent/'lexical-catalog/suite.json').read_text())
for key in ['cases','generation','aggregateBudgets','modelId','sourceRevision','modelIdentity','enableThinking','eosTokenIds','toolAttributionCriteria']:
    assert suite[key]==parent[key],key
binding=json.loads((root/'template-binding.json').read_text())
assert hashlib.sha256((Path(args.source)/'tokenizer_config.json').read_bytes()).hexdigest()==binding['tokenizerConfigSha256']
tokenizer=AutoTokenizer.from_pretrained(args.source,trust_remote_code=False)
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest()==binding['templateSha256']
tools=json.loads((root/'tools.json').read_text())
def tokens(messages):
    prompt=tokenizer.apply_chat_template(messages,tools=tools,tokenize=False,add_generation_prompt=True,enable_thinking=False)
    return len(tokenizer.encode(prompt,add_special_tokens=False))
def scopes(messages):
    code='import {sourceScopes} from '+json.dumps((root/'scope.js').as_uri())+';console.log(JSON.stringify(sourceScopes('+json.dumps(messages)+')));'
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',code],text=True))
def extraction(scope):
    history=[{'role':'system','content':suite['extractionInstruction']+suite['sourceInstructionSuffix'].format(documentId=scope['documentId'])},*map(dict,scope['messages'])]
    history[-1]['content']+='\n<reploid-literal-catalog-v1>\n'+json.dumps({'documentId':scope['documentId'],'entries':scope['entries'],'scope':'Exact source literals only; no semantic attribution.'})+'\n</reploid-literal-catalog-v1>'
    return history
result={'schema':'reploid.source-scoped-token-preflight/v1','weightsLoaded':False,'modelGenerated':False,'cases':[]}
empty='<tool_call>\n<function=Calculate>\n<parameter=operations>\n[]\n</parameter>\n</function>\n</tool_call>'
for case in suite['cases']:
    views=scopes(case['messages'])
    counts=[tokens(extraction(view)) for view in views]
    final=[{'role':'system','content':suite['answerInstruction']},*case['messages']]
    for view in views:
        final=response_messages(final,empty,{'ok':True,'result':{'documentId':view['documentId'],'results':[],'scope':'Preflight only; no generated output or actual calculation.'}})
    last=tokens(final)
    result['cases'].append({'id':case['id'],'sourceCount':len(views),'sourcePromptTokens':counts,'sourceMaxTokens':1536//len(views),'finalPromptTokensEmptyProbe':last,'minimumPromptTotal':sum(counts)+last,'headroomBeforeActualToolOutputs':8192-sum(counts)-last,'caveat':'Actual generated calls and tool results enlarge the final prompt and are charged again; runtime must enforce every admission.'})
print(json.dumps(result,indent=2))
