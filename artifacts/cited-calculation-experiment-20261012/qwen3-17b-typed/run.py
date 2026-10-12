"""Artifact-only typed requests; one recorded validation correction, no output repair."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from protocol import parse_call, response_messages
from budget import typed_allowance, correction_allowed


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    for name in ['doppler','source','suite','out']:
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--threads',type=int,default=4)
    args=parser.parse_args();root=Path(__file__).resolve().parent
    identity=json.loads((root/'freeze.json').read_text())
    for name,digest in identity['files'].items():assert sha(root/name)==digest,name
    for name,digest in identity['reusedSources'].items():assert sha(root.parents[2]/name)==digest,name
    tools=Path(args.doppler)/'tools'
    for name,digest in identity['additionalDopplerSources'].items():assert sha(Path(args.doppler)/name)==digest,name
    assert sha(tools/'source-model-task-quality.py')==identity['sourceLoaderSha256']
    assert sha(tools/'lib/source_task_quality.py')==identity['sourceEvaluatorSha256']
    sys.path.insert(0,str(tools))
    from lib import source_task_quality as quality
    original_evaluate=quality.evaluate_tasks;original_messages=quality.task_messages
    assert sha(args.suite)==identity['files']['suite.json'],'Execution suite differs from frozen suite'
    suite=json.loads(Path(args.suite).read_text());limits=suite['aggregateBudgets']
    assert limits=={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000,'extractionMaxTokens':1536}
    def invoke(export,payload):
        code='import {'+export+'} from '+json.dumps((root.parent/'typed-requests/adapter.js').as_uri())+';'
        code+='const args=JSON.parse('+json.dumps(json.dumps(payload))+');try{console.log(JSON.stringify(await '+export+'(...args)));}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=2;}'
        process=subprocess.run(['node','--input-type=module','-e',code],text=True,capture_output=True,timeout=10)
        if process.returncode==2:raise ValueError(json.loads(process.stderr)['error'])
        if process.returncode:raise RuntimeError(process.stderr)
        return json.loads(process.stdout)
    def evaluate(model,config,tokenizer,source_tokenizer,actual_suite,report,output):
        binding=json.loads((root/'template-binding.json').read_text())
        assert sha(Path(args.source)/'tokenizer_config.json')==binding['tokenizerConfigSha256']
        assert sha(Path(args.source)/'download-receipt.json')==binding['sourceReceiptSha256']
        template_sha=hashlib.sha256(source_tokenizer.chat_template.encode()).hexdigest()
        assert template_sha==binding['templateSha256']
        class ToolTokenizer:
            schema=[]
            def apply_chat_template(self,messages,**options):
                return source_tokenizer.apply_chat_template(messages,tools=self.schema,**options)
            def __getattr__(self,name):return getattr(source_tokenizer,name)
        effective=ToolTokenizer()
        report.update({'schema':'reploid.qwen3-17b-typed-quality-result/v1','qualified':False,'passed':False,
            'identity':identity,'actualTemplateSha256':template_sha,'aggregateBudgets':limits,'cases':[]})
        for task in actual_suite['cases']:
            row={'id':task['id'],'reviewCriteria':task['reviewCriteria'],'calls':[],'tools':[],'reviewStatus':'pending',
                'passed':None,'complete':False,'promptTokens':0,'generatedTokens':0,'rawOutputUtf16':0,'operations':0}
            report['cases'].append(row)
            views=invoke('typedScopes',[task['messages']]);row['sourceScopes']=views
            steps=[*views,None]
            final=[{'role':'system','content':suite['answerInstruction']},*copy.deepcopy(task['messages'])]
            for index,view in enumerate(steps):
                if view is not None:
                    phase='extract-'+view['documentId'];effective.schema=view['schema']
                    exact=[{'role':'system','content':suite['extractionInstruction']+suite['sourceInstructionSuffix'].format(documentId=view['documentId'])},*copy.deepcopy(view['messages'])]
                    exact[-1]['content']+='\n<reploid-literal-catalog-v1>\n'+json.dumps({'documentId':view['documentId'],'entries':view['entries'],'scope':'Exact source literals only; no semantic attribution.'})+'\n</reploid-literal-catalog-v1>'
                else:phase='answer';exact=final;effective.schema=[]
                source_generated=0
                for attempt in range(2 if view is not None else 1):
                    prompt=effective.apply_chat_template(exact,tokenize=False,add_generation_prompt=True,enable_thinking=False)
                    ids=tokenizer.encode(prompt,add_special_tokens=False).ids
                    maximum=typed_allowance(limits,row,len(ids),len(views) if view is not None else None,source_generated)
                    if maximum<=0:
                        row['failure']='No aggregate/source budget for '+phase;row['unadmittedPromptTokens']=len(ids);break
                    stage=copy.deepcopy(actual_suite);stage['cases']=[copy.deepcopy(task)]
                    stage['generation']['maxTokens']=maximum;stage['maxOutputCharacters']=limits['rawOutputUtf16']-row['rawOutputUtf16']
                    phase_report={'settings':stage['generation'],'results':[]}
                    phase_path=output.with_name(output.stem+'-'+task['id']+'-'+phase+'-'+str(attempt)+'.json')
                    def bound_messages(actual_task,unused):
                        assert actual_task['id']==task['id'];return copy.deepcopy(exact)
                    quality.task_messages=bound_messages
                    try:original_evaluate(model,config,tokenizer,effective,stage,phase_report,phase_path)
                    finally:quality.task_messages=original_messages
                    result=phase_report['results'][0];assert result['inputIds']==ids,'Executed input differs from admitted exact prompt'
                    raw=tokenizer.decode(result['tokenIds'],skip_special_tokens=False)
                    row['calls'].append({'phase':phase,'attempt':attempt,'messages':copy.deepcopy(exact),'schema':copy.deepcopy(effective.schema),**result})
                    row['promptTokens']+=len(ids);row['generatedTokens']+=len(result['tokenIds']);source_generated+=len(result['tokenIds'])
                    row['rawOutputUtf16']+=len(raw.encode('utf-16-le'))//2
                    row['totalChargedTokens']=row['promptTokens']+row['generatedTokens']
                    row['withinBudgets']=row['totalChargedTokens']<=8192 and row['generatedTokens']<=4096 and row['rawOutputUtf16']<=16000
                    quality.write_quality_report(output,report)
                    if result['stopReason']!='eos' or not row['withinBudgets']:
                        row['failure']=phase+' did not naturally complete within budget';break
                    if view is None:
                        row['answerText']=result['text'];row['complete']='<tool_call>' not in result['text']
                        if not row['complete']:row['failure']='Final answer attempted another tool call'
                        break
                    assert result['tokenIds'][-1] in suite['eosTokenIds']
                    raw_call=tokenizer.decode(result['tokenIds'][:-1],skip_special_tokens=False)
                    try:
                        if raw_call!=result['text']:raise ValueError('Unexpected special token; no stripping repair')
                        call=parse_call(raw_call)
                        compiled=invoke('compileRequest',[call['arguments'],task['messages'],view['documentId']])
                        count=len(compiled['operations'])
                        if row['operations']+count>30:raise ValueError('Aggregate operation bound exceeded')
                        response=invoke('calculateRequest',[call['arguments'],task['messages'],view['documentId']])
                        row['operations']+=count
                        tool={'ok':True,'result':response}
                    except ValueError as error:
                        tool={'ok':False,'error':str(error)}
                        row['tools'].append({'documentId':view['documentId'],'attempt':attempt,'rawCall':raw_call,'response':tool})
                        final=response_messages(final,raw_call,tool)
                        remaining=limits['extractionMaxTokens']//len(views)-source_generated
                        if correction_allowed(attempt,result['stopReason'],row['withinBudgets'],True,remaining):
                            exact=response_messages(exact,raw_call,tool)
                            exact.append({'role':'user','content':suite['correctionInstruction']})
                            row.setdefault('corrections',[]).append({'documentId':view['documentId'],'remainingSourceTokens':remaining})
                            quality.write_quality_report(output,report);continue
                        row['failure']='Typed request/tool rejected: '+str(error);break
                    row['tools'].append({'documentId':view['documentId'],'attempt':attempt,'call':call,'response':tool})
                    final=response_messages(final,raw_call,tool)
                    break
                quality.write_quality_report(output,report)
                if row.get('failure'):break
            quality.write_quality_report(output,report)
            if not row['complete']:
                report['unrunCases']=[case['id'] for case in actual_suite['cases'][len(report['cases']):]]
                report['stoppedAtStructuralBoundary']=True;break
        report['reviewRequired']=True
        report['status']='stopped at structural boundary' if report.get('stoppedAtStructuralBoundary') else 'awaiting full manual factual/citation review'
        quality.write_quality_report(output,report)
    quality.evaluate_tasks=evaluate
    spec=importlib.util.spec_from_file_location('existing_source_loader',tools/'source-model-task-quality.py')
    source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
    source.run(SimpleNamespace(source=args.source,deployed=None,suite=args.suite,out=args.out,threads=args.threads,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None))


if __name__=='__main__':main()
