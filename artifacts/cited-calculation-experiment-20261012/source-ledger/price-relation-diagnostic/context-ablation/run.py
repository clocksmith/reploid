"""One matched fresh-occurrence batch; only global question context changes."""
import argparse,copy,hashlib,importlib.util,importlib.metadata,inspect,json,sys
from pathlib import Path
from types import SimpleNamespace

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser()
 for name in ['doppler','source','out']:p.add_argument('--'+name,required=True)
 args=p.parse_args();root=Path(__file__).resolve().parent;parent=root.parent;repo=parent.parents[3]
 freeze=json.loads((root/'freeze.json').read_text())
 for key,directory in [('files',root),('reusedSources',repo),('dopplerSources',Path(args.doppler)),('sourceIdentity',Path(args.source))]:
  for name,digest in freeze[key].items():assert sha(directory/name)==digest,name
 for name,version in freeze['libraries'].items():assert importlib.metadata.version(name)==version,name
 from transformers import PrefixConstrainedLogitsProcessor
 assert sha(inspect.getsourcefile(PrefixConstrainedLogitsProcessor))==freeze['processorSourceSha256']
 sys.path.insert(0,str(Path(args.doppler)/'tools'));sys.path.insert(0,str(parent))
 from lib import source_task_quality as quality
 from constraint_adapter import PriceConstraint,install_evaluator
 from contract import parse
 original=quality.evaluate_tasks;fixture=json.loads((root/'input.json').read_text())
 def evaluate(model,config,tokenizer,official,suite,report,out):
  assert len(suite['cases'])==18 and len(fixture['occurrences'])==18
  assert hashlib.sha256(official.chat_template.encode()).hexdigest()==freeze['templateSha256']
  total=copy.deepcopy(fixture['priorAccounting']);constraint=PriceConstraint(tokenizer,[151645,151643],official)
  quality.evaluate_tasks=original;identity,restore=install_evaluator(quality,constraint,freeze['dopplerSources']['tools/lib/source_task_quality.py'])
  bound_evaluate=quality.evaluate_tasks
  report.update(schema='reploid.price-context-ablation-source-result/v1',identity=freeze,qualified=False,passed=False,reviewRequired=True,
   matchedContextComparison=True,priorAccounting=fixture['priorAccounting'],syntaxHookIdentity=identity,calls=[],accounting=total,fullTaskQualification=False)
  try:
   for task,item,digest in zip(suite['cases'],fixture['occurrences'],fixture['inputIds'],strict=True):
    exact=quality.task_messages(task,suite);assert exact==item['messages']
    rendered=official.apply_chat_template(exact,tokenize=False,add_generation_prompt=True,enable_thinking=False)
    ids=tokenizer.encode(rendered,add_special_tokens=False).ids
    assert hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()==digest
    if total['totalChargedTokens']+len(ids)+64>8192 or total['generatedTokens']+64>4096:
     report['failure']='Next complete call cannot fit frozen aggregate budget';break
    row={'id':task['id'],'rowIndex':item['rowIndex'],'arm':item['arm'],'sourceOccurrence':item['occurrence'],'messages':exact,'semanticAcceptance':None}
    report['calls'].append(row);quality.write_quality_report(out,report)
    stage=copy.deepcopy(suite);stage['cases']=[copy.deepcopy(task)];stage['maxOutputCharacters']=16000-total['rawUtf16'];phase={'results':[]}
    if stage['maxOutputCharacters']<=0:row['failure']='No raw output allowance';break
    constraint.arm();failure=None
    try:bound_evaluate(model,config,tokenizer,official,stage,phase,out.with_name(out.stem+'-'+task['id']+'.json'))
    except Exception as error:failure={'type':type(error).__name__,'message':str(error)}
    result=phase['results'][0] if phase.get('results') else None;row['result']=result
    generated=result['tokenIds'] if result else [];raw=tokenizer.decode(generated,skip_special_tokens=False)
    total['promptTokens']+=len(ids);total['generatedTokens']+=len(generated);total['totalChargedTokens']=total['promptTokens']+total['generatedTokens'];total['rawUtf16']+=len(raw.encode('utf-16-le'))//2
    if failure:row['failure']=failure
    else:
     try:
      assert result['inputIds']==ids and total['totalChargedTokens']<=8192 and total['generatedTokens']<=4096 and total['rawUtf16']<=16000
      constraint.finish(generated);text=tokenizer.decode(generated[:-1],skip_special_tokens=False)
      if text!=result['text']:raise ValueError('Unexpected stripping; no output repair')
      row['selectedRelation']=parse(text);row['completionAuthority']='grammar-terminal EOS, not unconstrained natural completion'
     except (ValueError,AssertionError) as error:row['failure']={'type':type(error).__name__,'message':str(error)}
    quality.write_quality_report(out,report)
    if row.get('failure'):break
  finally:restore()
  report['unrunCases']=[task['id'] for task in suite['cases'][len(report['calls']):]]
  report['status']='rejected boundary' if report.get('failure') or any(row.get('failure') for row in report['calls']) else 'completed all nine matched decisions awaiting independent semantic review'
  report['additionalCalculationOrAnswerCalls']=0;quality.write_quality_report(out,report)
 quality.evaluate_tasks=evaluate
 spec=importlib.util.spec_from_file_location('frozen_loader',Path(args.doppler)/'tools/source-model-task-quality.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 try:loader.run(SimpleNamespace(source=args.source,suite=str(root/'suite.json'),out=args.out,threads=4,deployed=None,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None))
 finally:quality.evaluate_tasks=original;quality.__dict__.pop('_artifact_syntax_controller',None)
if __name__=='__main__':main()
