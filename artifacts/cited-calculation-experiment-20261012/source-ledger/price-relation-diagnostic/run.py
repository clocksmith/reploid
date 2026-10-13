"""One reviewed source classification only; no automatic semantic pass or next call."""
import argparse,hashlib,importlib.util,importlib.metadata,inspect,json,sys
from pathlib import Path
from types import SimpleNamespace

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser()
 for name in ['doppler','source','out']:p.add_argument('--'+name,required=True)
 args=p.parse_args();root=Path(__file__).resolve().parent;repo=root.parents[3]
 freeze=json.loads((root/'freeze.json').read_text())
 for key,directory in [('files',root),('reusedSources',repo),('dopplerSources',Path(args.doppler)),('sourceIdentity',Path(args.source))]:
  for name,digest in freeze[key].items():assert sha(directory/name)==digest,name
 for name,version in freeze['libraries'].items():assert importlib.metadata.version(name)==version,name
 from transformers import PrefixConstrainedLogitsProcessor
 assert sha(inspect.getsourcefile(PrefixConstrainedLogitsProcessor))==freeze['processorSourceSha256']
 sys.path.insert(0,str(Path(args.doppler)/'tools'))
 from lib import source_task_quality as quality
 from constraint_adapter import PriceConstraint,install_evaluator
 from contract import parse
 original=quality.evaluate_tasks;fixture=json.loads((root/'input.json').read_text());preflight=json.loads((root/'token-preflight.json').read_text())
 def evaluate(model,config,tokenizer,official,suite,report,out):
  assert len(suite['cases'])==1 and quality.task_messages(suite['cases'][0],suite)==fixture['messages']
  rendered=official.apply_chat_template(fixture['messages'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
  ids=tokenizer.encode(rendered,add_special_tokens=False).ids
  assert hashlib.sha256(official.chat_template.encode()).hexdigest()==preflight['templateSha256']
  assert hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()==preflight['diagnostic']['inputIdsSha256']
  assert len(ids)+64<=8192 and suite['generation']['maxTokens']==64
  constraint=PriceConstraint(tokenizer,fixture['eosTokenIds'],official);constraint.arm()
  quality.evaluate_tasks=original;identity,restore=install_evaluator(quality,constraint,freeze['dopplerSources']['tools/lib/source_task_quality.py'])
  report.update(schema='reploid.single-price-source-result/v1',identity=freeze,qualified=False,passed=False,sourceOccurrence=fixture['occurrence'],exactMessages=fixture['messages'],syntaxHookIdentity=identity,reviewRequired=True)
  error=None
  try:quality.evaluate_tasks(model,config,tokenizer,official,suite,report,out)
  except Exception as failure:error={'type':type(failure).__name__,'message':str(failure)}
  finally:restore()
  row=report['results'][0] if report.get('results') else None
  report['accounting']={'promptTokens':len(ids),'generatedTokens':len(row['tokenIds']) if row else 0}
  report['accounting']['totalChargedTokens']=sum(report['accounting'].values())
  raw=tokenizer.decode(row['tokenIds'],skip_special_tokens=False) if row else ''
  report['accounting']['rawUtf16']=len(raw.encode('utf-16-le'))//2
  report['withinBudgets']=report['accounting']['totalChargedTokens']<=8192 and report['accounting']['generatedTokens']<=64 and report['accounting']['rawUtf16']<=16000
  if error:report['executionFailure']=error
  elif row:
   try:
    assert row['inputIds']==ids and report['withinBudgets']
    constraint.finish(row['tokenIds']);raw=tokenizer.decode(row['tokenIds'][:-1],skip_special_tokens=False)
    if raw!=row['text']:raise ValueError('Unexpected stripping; no output repair')
    report['selectedRelation']=parse(raw);report['completionAuthority']='grammar-terminal EOS, not unconstrained natural completion'
   except (ValueError,AssertionError) as failure:report['executionFailure']={'type':type(failure).__name__,'message':str(failure)}
  report['status']='rejected boundary' if report.get('executionFailure') else 'completed diagnostic awaiting independent semantic review'
  report['fullTaskQualification']=False;report['additionalSourceCalls']=0
  quality.write_quality_report(out,report)
 quality.evaluate_tasks=evaluate
 spec=importlib.util.spec_from_file_location('frozen_loader',Path(args.doppler)/'tools/source-model-task-quality.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 try:loader.run(SimpleNamespace(source=args.source,suite=str(root/'suite.json'),out=args.out,threads=4,deployed=None,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None))
 finally:quality.evaluate_tasks=original;quality.__dict__.pop('_artifact_syntax_controller',None)
if __name__=='__main__':main()
