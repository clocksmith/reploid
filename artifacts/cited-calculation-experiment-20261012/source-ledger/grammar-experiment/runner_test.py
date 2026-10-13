"""Exercise the actual runner with artificial logits and exact retained prompts; no weights."""
import argparse,copy,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import torch
from tokenizers import Tokenizer
from transformers import AutoTokenizer
from grammar_test import call
p=argparse.ArgumentParser();p.add_argument('--doppler',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True);args=p.parse_args()
root=Path(__file__).resolve().parent;data=root.parent/'row-tag-experiment'
sys.path.insert(0,str(Path(args.doppler)/'tools'))
from lib import source_task_quality as quality
import run
suite=json.loads((data/'suite.json').read_text());prepared=json.loads((data/'inputs.json').read_text())['cases'][0]
props=prepared['schema'][0]['function']['parameters']['properties']
selection=call([[] for _ in range(props['factRoles']['minItems'])],[[] for _ in range(props['passageRelations']['minItems'])])
tokenizer=Tokenizer.from_file(str(Path(args.source)/'tokenizer.json'))
official=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False)
vocab=max(tokenizer.get_vocab().values())+1;sequences=[tokenizer.encode(text,add_special_tokens=False).ids+[151645] for text in [selection,'Unqualified artificial answer.']]
config=SimpleNamespace(pad_token_id=None,eos_token_id=151645)
original_spec=importlib.util.spec_from_file_location;original_cache=quality.StoredHalfCache;original_evaluate=quality.evaluate_tasks
records=[]
class Artificial:
 def __init__(self,fail):self.phase=-1;self.position=0;self.fail=fail
 def __call__(self,**kwargs):
  if kwargs['input_ids'].shape[-1]>1:self.phase+=1;self.position=0
  if self.fail and self.position==2:raise RuntimeError('Injected source boundary failure')
  scores=torch.zeros((1,1,vocab));scores[0,0,sequences[self.phase][self.position]]=10;self.position+=1
  return SimpleNamespace(logits=scores)
class Loader:
 def create_module(self,spec):return None
 def exec_module(self,module):
  def execute(options):
   report={};quality.evaluate_tasks(Artificial(inject),config,tokenizer,official,copy.deepcopy(suite),report,Path(options.out))
  module.run=execute

def intercepted(name,path,*a,**kw):
 if name=='frozen_loader':return importlib.util.spec_from_loader(name,Loader())
 return original_spec(name,path,*a,**kw)
quality.StoredHalfCache=lambda **kwargs:None
try:
 with tempfile.TemporaryDirectory() as temporary:
  for inject in [False,True]:
   output=Path(temporary)/('failed.json' if inject else 'completed.json')
   sys.argv=['run.py','--doppler',args.doppler,'--source',args.source,'--out',str(output)]
   importlib.util.spec_from_file_location=intercepted
   run.main();report=json.loads(output.read_text());row=report['cases'][0]
   assert report['qualified'] is False and report['passed'] is False and row['passed'] is None
   assert len(report['unrunCases'])==6
   assert row['originalMessages']==suite['cases'][0]['messages']
   assert row['calls'][0]['inputIds'] and row['calls'][0]['syntaxConstraint']['steps']
   assert row['promptTokens']==sum(len(c['inputIds']) for c in row['calls'])
   assert row['generatedTokens']==sum(len(c['tokenIds']) for c in row['calls'])
   assert quality.evaluate_tasks is original_evaluate
   assert '_artifact_syntax_controller' not in quality.__dict__
   if inject:
    assert report['stoppedAtStructuralBoundary'] and row['executionFailure']['message']=='Injected source boundary failure'
    assert row['generatedTokens']==2 and len(row['calls'])==1
   else:
    assert report['awaitingFactualReview'] and row['complete'] and row['reviewStatus']=='pending'
    assert len(row['calls'])==2 and 'syntaxConstraint' not in row['calls'][1]
    assert row['calls'][1]['messages'][1:-2]==suite['cases'][0]['messages']
    assert row['answerText']=='Unqualified artificial answer.'
    assert row['selectionCompletion'].startswith('grammar-terminal EOS')
   records.append({'failureInjected':inject,'promptTokens':row['promptTokens'],'generatedTokens':row['generatedTokens'],'complete':row['complete'],'factualAcceptance':False,'unrunCases':len(report['unrunCases'])})
finally:
 importlib.util.spec_from_file_location=original_spec;quality.StoredHalfCache=original_cache;quality.evaluate_tasks=original_evaluate
Path(args.out).write_text(json.dumps({'schema':'reploid.syntax-runner-control/v1','modelExecuted':False,'artificialLogits':True,'passed':True,'controls':records},indent=2)+'\n')
