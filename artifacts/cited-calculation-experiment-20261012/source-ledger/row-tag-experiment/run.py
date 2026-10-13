"""Frozen two-call row annotation and raw answer; no retries or output repair."""
import argparse,copy,hashlib,importlib.util,json,sys
from pathlib import Path
from types import SimpleNamespace

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
 p=argparse.ArgumentParser()
 for name in ['doppler','source','out']:p.add_argument('--'+name,required=True)
 args=p.parse_args();root=Path(__file__).resolve().parent;repo=root.parents[3]
 freeze=json.loads((root/'freeze.json').read_text())
 for category,directory in [('files',root),('reusedSources',repo),('dopplerSources',Path(args.doppler)),('sourceIdentity',Path(args.source))]:
  for name,digest in freeze[category].items():assert sha(directory/name)==digest,name
 from protocol import parse_call,run_bridge,retain_boundary,answer_messages,allowance,accumulate
 suite=json.loads((root/'suite.json').read_text());inputs=json.loads((root/'inputs.json').read_text());preflight=json.loads((root/'token-preflight.json').read_text())
 limits=suite['aggregateBudgets'];assert limits=={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000}
 assert suite['selectionMaximumGeneratedTokens']==1024
 tools=Path(args.doppler)/'tools';sys.path.insert(0,str(tools))
 from lib import source_task_quality as quality
 original_evaluate=quality.evaluate_tasks;original_messages=quality.task_messages
 def evaluate(model,config,tokenizer,source_tokenizer,actual_suite,report,output):
  binding=json.loads((root/'template-binding.json').read_text())
  template_sha=hashlib.sha256(source_tokenizer.chat_template.encode()).hexdigest();assert template_sha==binding['templateSha256']
  class ToolTokenizer:
   schema=[]
   def apply_chat_template(self,messages,**options):return source_tokenizer.apply_chat_template(messages,tools=self.schema,**options)
   def __getattr__(self,name):return getattr(source_tokenizer,name)
  effective=ToolTokenizer()
  report.update(schema='reploid.source-row-quality-result/v1',identity=freeze,actualTemplateSha256=template_sha,
   qualified=False,passed=False,aggregateBudgets=limits,cases=[])
  for task,prepared,sized in zip(actual_suite['cases'],inputs['cases'],preflight['cases'],strict=True):
   assert task['id']==prepared['id']==sized['id']
   assert prepared['selectionMessages'][1:-1]==task['messages']==prepared['originalMessages']
   row={'id':task['id'],'reviewCriteria':task['reviewCriteria'],'originalMessages':task['messages'],
    'calls':[],'complete':False,'passed':None,'reviewStatus':'pending','promptTokens':0,'generatedTokens':0,'rawOutputUtf16':0}
   report['cases'].append(row);quality.write_quality_report(output,report)
   final=None
   for phase in ['selection','answer']:
    exact=copy.deepcopy(prepared['selectionMessages']) if phase=='selection' else final
    effective.schema=prepared['schema'] if phase=='selection' else []
    assert exact is not None
    if phase=='answer':assert exact[1:-2]==task['messages'],'Final original history changed'
    rendered=effective.apply_chat_template(exact,tokenize=False,add_generation_prompt=True,enable_thinking=suite['enableThinking'])
    ids=tokenizer.encode(rendered,add_special_tokens=False).ids
    digest=hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()
    if phase=='selection':assert digest==sized['phases']['selection']['inputIdsSha256']
    maximum=allowance(limits,row,len(ids),phase)
    row.setdefault('admissions',[]).append({'phase':phase,'actualPromptTokens':len(ids),'inputIdsSha256':digest,'generationAllowance':maximum})
    if maximum<=0:
     row['failure']='No aggregate token allowance for '+phase;quality.write_quality_report(output,report);break
    stage=copy.deepcopy(actual_suite);stage['cases']=[copy.deepcopy(task)];stage['generation']['maxTokens']=maximum
    stage['maxOutputCharacters']=limits['rawOutputUtf16']-row['rawOutputUtf16']
    if stage['maxOutputCharacters']<=0:row['failure']='No raw output allowance';break
    phase_report={'settings':stage['generation'],'results':[]}
    def bound_messages(actual_task,unused):
     assert actual_task['id']==task['id'];return copy.deepcopy(exact)
    quality.task_messages=bound_messages
    try:original_evaluate(model,config,tokenizer,effective,stage,phase_report,output.with_name(output.stem+'-'+task['id']+'-'+phase+'.json'))
    finally:quality.task_messages=original_messages
    result=phase_report['results'][0];assert result['inputIds']==ids,'Executed input differs from admitted input'
    raw=tokenizer.decode(result['tokenIds'],skip_special_tokens=False)
    row['calls'].append({'phase':phase,'messages':exact,'schema':copy.deepcopy(effective.schema),**result})
    accumulate(limits,row,len(ids),result['tokenIds'],raw);quality.write_quality_report(output,report)
    if result['stopReason']!='eos' or not row['withinBudgets']:
     row['failure']=phase+' lacks natural completion within aggregate budgets';break
    if phase=='answer':
     row['answerText']=result['text'];row['complete']=bool(result['text'].strip()) and '<tool_call>' not in result['text']
     if not row['complete']:row['failure']='Empty final answer or unsupported further tool call'
     break
    try:
     assert result['tokenIds'][-1] in suite['eosTokenIds']
     raw_call=tokenizer.decode(result['tokenIds'][:-1],skip_special_tokens=False)
     if raw_call!=result['text']:raise ValueError('Unexpected special token; no stripping repair')
     call=parse_call(raw_call);row['rawCall']=raw_call;row['selection']=call['arguments']
     response=run_bridge(root/'bridge.js',{'selection':call['arguments'],'messages':task['messages']});row['toolResult']=response
     if response.get('ok') is not True:raise ValueError(response['error'])
     final=answer_messages(task['messages'],suite['answerInstruction'],raw_call,response['ledger'])
    except ValueError as error:row['failure']=str(error);break
   if retain_boundary(report,row,actual_suite['cases'],lambda value:quality.write_quality_report(output,value)):break
   report['awaitingFactualReview']=True
   report['unrunCases']=[case['id'] for case in actual_suite['cases'][len(report['cases']):]]
   break # Root requires factual review before any subsequent case, with no automatic pass.
  report['reviewRequired']=True;report['status']='stopped at structural boundary' if report.get('stoppedAtStructuralBoundary') else 'awaiting independent factual review before continuation'
  quality.write_quality_report(output,report)
 quality.evaluate_tasks=evaluate
 spec=importlib.util.spec_from_file_location('frozen_loader',tools/'source-model-task-quality.py');loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
 try:loader.run(SimpleNamespace(source=args.source,suite=str(root/'suite.json'),out=args.out,threads=4,deployed=None,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None))
 finally:quality.evaluate_tasks=original_evaluate;quality.task_messages=original_messages
if __name__=='__main__':main()
