"""Frozen evaluator hook control with artificial logits; no neural weights or inference."""
import argparse,copy,hashlib,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import torch
from tokenizers import Tokenizer
from constraint import SyntaxConstraint,install_evaluator
from grammar_test import call
p=argparse.ArgumentParser();p.add_argument('--doppler',required=True);p.add_argument('--tokenizer',required=True);p.add_argument('--out',required=True);args=p.parse_args()
sys.path.insert(0,str(Path(args.doppler)/'tools'))
from lib import source_task_quality as quality
expected='37586f498f393570e499859deb0bcaba520e86bb85a03365c176a4981079127f'
assert hashlib.sha256((Path(args.doppler)/'tools/lib/source_task_quality.py').read_bytes()).hexdigest()==expected
tokenizer=Tokenizer.from_file(args.tokenizer);vocab=max(tokenizer.get_vocab().values())+1
source_tokenizer=SimpleNamespace(apply_chat_template=lambda messages,**kwargs:'unrelated input',encode=lambda text,**kwargs:tokenizer.encode(text,**kwargs).ids)
config=SimpleNamespace(pad_token_id=None,eos_token_id=151645)
suite={'cases':[{'id':'arbitrary','messages':[{'role':'user','content':'unrelated'}],'reviewCriteria':['Requires independent review']}],
 'generation':{'temperature':0,'topK':1,'topP':1,'maxTokens':128,'maxSeqLen':1024,'repetitionPenalty':1.0,'repetitionPenaltyWindow':0,'presencePenalty':0,'stopSequences':[]},'eosTokenIds':[151645,151643],'maxOutputCharacters':16000,'enableThinking':False}
original_cache=quality.StoredHalfCache;quality.StoredHalfCache=lambda **kwargs:None
class Artificial:
 def __init__(self,ids):self.ids=ids;self.index=0
 def __call__(self,**kwargs):
  scores=torch.zeros((1,1,vocab));scores[0,0,self.ids[self.index]]=10;self.index+=1
  return SimpleNamespace(logits=scores)
def evaluate(ids,path):
 report={'results':[]};quality.evaluate_tasks(Artificial(ids),config,tokenizer,source_tokenizer,copy.deepcopy(suite),report,path);return report
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);controller=SyntaxConstraint(tokenizer,[151645,151643]);controller.disable()
 ids=tokenizer.encode('arbitrary response',add_special_tokens=False).ids+[151645]
 baseline=evaluate(ids,root/'baseline.json')
 identity,restore=install_evaluator(quality,controller,expected)
 try:
  inactive=evaluate(ids,root/'inactive.json');assert baseline==inactive
  props={
   'factRoles':{'minItems':1,'maxItems':1,'items':{'maxItems':2,'items':{'enum':['red','blue']}}},
   'passageRelations':{'minItems':1,'maxItems':1,'items':{'maxItems':1,'items':{'enum':['left']}}}}
  schema=[{'function':{'name':'AnnotateSource','parameters':{'properties':props}}}]
  controller.arm(schema);text=call([['blue']],[[]]);tokens=tokenizer.encode(text,add_special_tokens=False).ids+[151645]
  constrained=evaluate(tokens,root/'active.json');controller.finish(constrained['results'][0]['tokenIds'])
  assert constrained['results'][0]['tokenIds']==tokens
  assert constrained['results'][0]['passed'] is None
  assert constrained['results'][0]['completionPassed'] is True
  assert all(s['rawWinnerAllowed'] for s in constrained['results'][0]['syntaxConstraint']['steps'])
 finally:restore();quality.StoredHalfCache=original_cache
receipt={'schema':'reploid.syntax-evaluator-hook-control/v1','modelExecuted':False,'artificialLogits':True,'disabledHookExactReportEquality':True,
 'validConstrainedTokenSequencePreserved':True,'manualFactualAcceptanceStillPending':True,'patchIdentity':identity}
Path(args.out).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
