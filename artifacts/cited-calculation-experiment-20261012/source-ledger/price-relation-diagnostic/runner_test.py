"""Synthetic exact runner controls; all semantic labels remain unqualified."""
import argparse,copy,importlib.util,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import torch
from tokenizers import Tokenizer
from transformers import AutoTokenizer
p=argparse.ArgumentParser();p.add_argument('--doppler',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True);args=p.parse_args()
root=Path(__file__).resolve().parent;sys.path.insert(0,str(Path(args.doppler)/'tools'))
from lib import source_task_quality as quality
import run
suite=json.loads((root/'suite.json').read_text());tokenizer=Tokenizer.from_file(str(Path(args.source)/'tokenizer.json'))
official=AutoTokenizer.from_pretrained(args.source,local_files_only=True,trust_remote_code=False);vocab=max(tokenizer.get_vocab().values())+1
config=SimpleNamespace(pad_token_id=None,eos_token_id=151645);original_spec=importlib.util.spec_from_file_location;original_cache=quality.StoredHalfCache;original_evaluate=quality.evaluate_tasks
class Artificial:
 def __init__(self):self.position=0
 def __call__(self,**kwargs):
  if failure and self.position==2:raise RuntimeError('Injected diagnostic failure')
  scores=torch.zeros((1,1,vocab));scores[0,0,ids[self.position]]=20;self.position+=1
  return SimpleNamespace(logits=scores)
class Loader:
 def create_module(self,spec):return None
 def exec_module(self,module):
  def execute(options):quality.evaluate_tasks(Artificial(),config,tokenizer,official,copy.deepcopy(suite),{'results':[]},Path(options.out))
  module.run=execute

def intercepted(name,path,*a,**kw):
 if name=='frozen_loader':return importlib.util.spec_from_loader(name,Loader())
 return original_spec(name,path,*a,**kw)
records=[];quality.StoredHalfCache=lambda **kwargs:None
try:
 with tempfile.TemporaryDirectory() as directory:
  for label,failure in [('unknown',False),('quoted_total',False),('unit_price',True)]:
   ids=tokenizer.encode(json.dumps({'relation':label},separators=(',',':')),add_special_tokens=False).ids+[151645]
   out=Path(directory)/(label+'.json');sys.argv=['run.py','--doppler',args.doppler,'--source',args.source,'--out',str(out)]
   importlib.util.spec_from_file_location=intercepted;run.main();report=json.loads(out.read_text())
   assert report['qualified'] is False and report['passed'] is False and report['fullTaskQualification'] is False and report['reviewRequired']
   assert report['additionalSourceCalls']==0 and report['accounting']['promptTokens']==407
   assert report['accounting']['totalChargedTokens']==407+report['accounting']['generatedTokens']
   assert report['exactMessages']==quality.task_messages(suite['cases'][0],suite)
   if failure:assert report['executionFailure']['message']=='Injected diagnostic failure' and report['accounting']['generatedTokens']==2
   else:assert report.get('selectedRelation')==label and report['results'][0]['tokenIds']==ids,report
   assert quality.evaluate_tasks is original_evaluate and '_artifact_syntax_controller' not in quality.__dict__
   records.append({'artificialLabel':label,'injectedFailure':failure,'tokens':report['accounting'],'modelExecuted':False,'semanticAcceptance':False})
finally:
 importlib.util.spec_from_file_location=original_spec;quality.StoredHalfCache=original_cache;quality.evaluate_tasks=original_evaluate
Path(args.out).write_text(json.dumps({'schema':'reploid.single-price-runner-control/v1','passed':True,'sourceModelExecuted':False,'controls':records},indent=2)+'\n')
