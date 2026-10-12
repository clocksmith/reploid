"""Tokenizer-only preflight. No model weights or answers, no approval by sizing."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from transformers import AutoTokenizer
from protocol import response_messages

parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);args=parser.parse_args()
root=Path(__file__).resolve().parent
suite=json.loads((root/'suite.json').read_text());parent=json.loads((root.parent/'qwen3-17b-typed/suite.json').read_text())
for key in ['cases','generation','aggregateBudgets','enableThinking','toolAttributionCriteria','answerInstruction','correctionInstruction','sourceInstructionSuffix']:
    assert suite[key]==parent[key],key
binding=json.loads((root/'template-binding.json').read_text())
assert hashlib.sha256((Path(args.source)/'tokenizer_config.json').read_bytes()).hexdigest()==binding['tokenizerConfigSha256']
tokenizer=AutoTokenizer.from_pretrained(args.source,trust_remote_code=False)
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest()==binding['templateSha256']
def tokens(messages,tools):
    prompt=tokenizer.apply_chat_template(messages,tools=tools,tokenize=False,add_generation_prompt=True,enable_thinking=False)
    return len(tokenizer.encode(prompt,add_special_tokens=False))
def scopes(messages):
    code='import {sourceScopes} from '+json.dumps((root.parent/'source-scoped-selection/scope.js').as_uri())+';'
    code+='import {typedScopes} from '+json.dumps((root/'adapter.js').as_uri())+';'
    code+='const messages='+json.dumps(messages)+';console.log(JSON.stringify(typedScopes(messages)));'
    return json.loads(subprocess.check_output(['node','--input-type=module','-e',code],text=True))
def extraction(scope):
    history=[{'role':'system','content':suite['extractionInstruction']+suite['sourceInstructionSuffix'].format(documentId=scope['documentId'])},*map(dict,scope['messages'])]
    history[-1]['content']+='\n<reploid-literal-catalog-v1>\n'+json.dumps({'documentId':scope['documentId'],'entries':scope['entries'],'scope':'Exact source literals only; no semantic attribution.'})+'\n</reploid-literal-catalog-v1>'
    return history
result={'schema':'reploid.available-typed-token-preflight/v1','weightsLoaded':False,'modelGenerated':False,'cases':[]}
empty='<tool_call>\n{"name":"Calculate","arguments":{"money":[],"dates":[]}}\n</tool_call>'
for case in suite['cases']:
    views=scopes(case['messages']);counts=[tokens(extraction(view),view['schema']) for view in views if view['schema']]
    final=[{'role':'system','content':suite['answerInstruction']},*case['messages']]
    for view in views:
        if not view['schema']:continue
        empty='<tool_call>\n'+json.dumps({'name':'Calculate','arguments':{family:[] for family in view['families']}})+'\n</tool_call>'
        final=response_messages(final,empty,{'ok':True,'result':{'documentId':view['documentId'],'results':[],'scope':'Preflight only; no generated output or actual calculation.'}})
    last=tokens(final,[])
    result['cases'].append({'id':case['id'],'sourceCount':len(views),'sourcePromptTokens':counts,'sourceMaxTokens':1536//len(views),'finalPromptTokensEmptyProbe':last,'minimumPromptTotal':sum(counts)+last,'headroomBeforeActualToolOutputs':8192-sum(counts)-last,'caveat':'Actual calls/results and any validator correction require additional prompt charges; runtime must enforce every admission. Empty probes are not semantic passes.'})
print(json.dumps(result,indent=2))
