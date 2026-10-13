"""One frozen full-history source-role selection, existing calculator, primary report."""
import argparse,copy,hashlib,importlib.util,json,sys
from pathlib import Path
from types import SimpleNamespace

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser()
    for name in ['doppler','source','out']:parser.add_argument('--'+name,required=True)
    args=parser.parse_args();root=Path(__file__).resolve().parent;repo=root.parents[3]
    freeze=json.loads((root/'freeze.json').read_text())
    for name,digest in freeze['files'].items():assert sha(root/name)==digest,name
    for name,digest in freeze['reusedSources'].items():assert sha(repo/name)==digest,name
    for name,digest in freeze['dopplerSources'].items():assert sha(Path(args.doppler)/name)==digest,name
    for name,digest in freeze['sourceIdentity'].items():assert sha(Path(args.source)/name)==digest,name
    from protocol import parse_call,admission,charge,run_bridge,retain_boundary
    suite=json.loads((root/'suite.json').read_text());inputs=json.loads((root/'inputs.json').read_text())
    preflight=json.loads((root/'token-preflight.json').read_text());limits=suite['aggregateBudgets']
    assert limits=={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000}
    tools=Path(args.doppler)/'tools';sys.path.insert(0,str(tools))
    from lib import source_task_quality as quality
    original_evaluate=quality.evaluate_tasks;original_messages=quality.task_messages
    def evaluate(model,config,tokenizer,source_tokenizer,actual_suite,report,output):
        binding=json.loads((root/'template-binding.json').read_text())
        template_sha=hashlib.sha256(source_tokenizer.chat_template.encode()).hexdigest()
        assert template_sha==binding['templateSha256']
        class ToolTokenizer:
            schema=[]
            def apply_chat_template(self,messages,**options):return source_tokenizer.apply_chat_template(messages,tools=self.schema,**options)
            def __getattr__(self,name):return getattr(source_tokenizer,name)
        effective=ToolTokenizer()
        report.update(schema='reploid.source-ledger-quality-result/v1',qualified=False,passed=False,
            identity=freeze,actualTemplateSha256=template_sha,aggregateBudgets=limits,cases=[])
        for task,prepared,sized in zip(actual_suite['cases'],inputs['cases'],preflight['cases'],strict=True):
            assert task['id']==prepared['id']==sized['id']
            exact=copy.deepcopy(prepared['messages']);assert exact[1:-1]==task['messages']==prepared['originalMessages']
            effective.schema=prepared['schema']
            prompt=effective.apply_chat_template(exact,tokenize=False,add_generation_prompt=True,enable_thinking=suite['enableThinking'])
            ids=tokenizer.encode(prompt,add_special_tokens=False).ids
            assert hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest()==sized['inputIdsSha256']
            maximum=admission(limits,len(ids));assert maximum==sized['admittedGeneratedTokenLimit']
            row={'id':task['id'],'reviewCriteria':task['reviewCriteria'],'originalMessages':task['messages'],
                'messages':exact,'schema':effective.schema,'calls':[],'complete':False,'passed':None,'reviewStatus':'pending'}
            report['cases'].append(row);quality.write_quality_report(output,report)
            if maximum<=0:row['failure']='No whole-work generation allowance'
            else:
                stage=copy.deepcopy(actual_suite);stage['cases']=[copy.deepcopy(task)];stage['generation']['maxTokens']=maximum
                phase={'settings':stage['generation'],'results':[]}
                def bound_messages(actual_task,unused):
                    assert actual_task['id']==task['id'];return copy.deepcopy(exact)
                quality.task_messages=bound_messages
                try:original_evaluate(model,config,tokenizer,effective,stage,phase,output.with_name(output.stem+'-'+task['id']+'.json'))
                finally:quality.task_messages=original_messages
                result=phase['results'][0];assert result['inputIds']==ids,'Executed prompt differs from admission'
                raw=tokenizer.decode(result['tokenIds'],skip_special_tokens=False)
                row['calls'].append(result);row.update(charge(limits,len(ids),result['tokenIds'],raw))
                quality.write_quality_report(output,report)
                try:
                    if result['stopReason']!='eos' or not row['withinBudgets']:raise ValueError('No natural completion within frozen budget')
                    assert result['tokenIds'][-1] in suite['eosTokenIds']
                    raw_call=tokenizer.decode(result['tokenIds'][:-1],skip_special_tokens=False)
                    if raw_call!=result['text']:raise ValueError('Unexpected special token; no stripping repair')
                    call=parse_call(raw_call);row['rawCall']=raw_call;row['selection']=call['arguments']
                    payload={'selection':call['arguments'],'messages':task['messages'],'maxCharacters':limits['rawOutputUtf16']-row['rawOutputUtf16']}
                    response=run_bridge(root/'bridge.js',payload);row['toolResult']=response
                    if response.get('ok') is not True:raise ValueError(response['error'])
                    row.update(charge(limits,len(ids),result['tokenIds'],raw,response['report']['text']))
                    if not row['withinBudgets']:raise ValueError('Primary report exceeds whole-work output budget')
                    row['answerText']=response['report']['text'];row['complete']=True
                except ValueError as error:row['failure']=str(error)
            if retain_boundary(report,row,actual_suite['cases'],lambda value:quality.write_quality_report(output,value)):break
        report['reviewRequired']=True
        report['status']='stopped at structural boundary' if report.get('stoppedAtStructuralBoundary') else 'awaiting unchanged full factual review'
        quality.write_quality_report(output,report)
    quality.evaluate_tasks=evaluate
    spec=importlib.util.spec_from_file_location('frozen_source_loader',tools/'source-model-task-quality.py')
    loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
    try:loader.run(SimpleNamespace(source=args.source,suite=str(root/'suite.json'),out=args.out,threads=4,deployed=None,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None))
    finally:quality.evaluate_tasks=original_evaluate;quality.task_messages=original_messages

if __name__=='__main__':main()
