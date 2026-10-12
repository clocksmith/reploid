"""Artifact-only per-source selection, original source evaluator, no output repair."""
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
from budget import allowance


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser()
    for name in ['doppler','source','deployed','suite','out']:
        parser.add_argument('--'+name,required=True)
    parser.add_argument('--threads',type=int,default=4)
    args=parser.parse_args();root=Path(__file__).resolve().parent
    identity=json.loads((root/'freeze.json').read_text())
    for name,digest in identity['files'].items():assert sha(root/name)==digest,name
    for name,digest in identity['reusedSources'].items():assert sha(root.parents[2]/name)==digest,name
    tools=Path(args.doppler)/'tools'
    for name,digest in identity['additionalDopplerSources'].items():assert sha(Path(args.doppler)/name)==digest,name
    assert sha(tools/'qwen35-original-weight-generation.py')==identity['sourceLoaderSha256']
    assert sha(tools/'lib/source_task_quality.py')==identity['sourceEvaluatorSha256']
    sys.path.insert(0,str(tools))
    from lib import source_task_quality as quality
    original_evaluate=quality.evaluate_tasks;original_messages=quality.task_messages
    suite=json.loads(Path(args.suite).read_text());limits=suite['aggregateBudgets']
    assert limits=={'generatedTokens':4096,'promptPlusGeneratedTokens':8192,'rawOutputUtf16':16000,'extractionMaxTokens':1536}
    tool_schema=json.loads((root/'tools.json').read_text())
    def invoke(export,payload):
        code='import {'+export+'} from '+json.dumps((root/'scope.js').as_uri())+';'
        code+='const args=JSON.parse('+json.dumps(json.dumps(payload))+');console.log(JSON.stringify(await '+export+'(...args)));'
        process=subprocess.run(['node','--input-type=module','-e',code],text=True,capture_output=True,timeout=10)
        if process.returncode:raise ValueError(process.stderr)
        return json.loads(process.stdout)
    def evaluate(model,config,tokenizer,source_tokenizer,actual_suite,report,output):
        binding=json.loads((root/'template-binding.json').read_text())
        assert sha(Path(args.source)/'tokenizer_config.json')==binding['tokenizerConfigSha256']
        template_sha=hashlib.sha256(source_tokenizer.chat_template.encode()).hexdigest()
        assert template_sha==binding['templateSha256']
        class ToolTokenizer:
            def apply_chat_template(self,messages,**options):
                return source_tokenizer.apply_chat_template(messages,tools=tool_schema,**options)
            def __getattr__(self,name):return getattr(source_tokenizer,name)
        effective=ToolTokenizer()
        report.update({'schema':'reploid.source-scoped-quality-result/v1','qualified':False,'passed':False,
            'identity':identity,'actualTemplateSha256':template_sha,'aggregateBudgets':limits,'cases':[]})
        for task in actual_suite['cases']:
            row={'id':task['id'],'reviewCriteria':task['reviewCriteria'],'calls':[],'tools':[],'reviewStatus':'pending',
                'passed':None,'complete':False,'promptTokens':0,'generatedTokens':0,'rawOutputUtf16':0,'operations':0}
            report['cases'].append(row)
            views=invoke('sourceScopes',[task['messages']]);row['sourceScopes']=views
            steps=[*views,None]
            final=[{'role':'system','content':suite['answerInstruction']},*copy.deepcopy(task['messages'])]
            for index,view in enumerate(steps):
                if view is not None:
                    phase='extract-'+view['documentId']
                    exact=[{'role':'system','content':suite['extractionInstruction']+suite['sourceInstructionSuffix'].format(documentId=view['documentId'])},*copy.deepcopy(view['messages'])]
                    exact[-1]['content']+='\n<reploid-literal-catalog-v1>\n'+json.dumps({'documentId':view['documentId'],'entries':view['entries'],'scope':'Exact source literals only; no semantic attribution.'})+'\n</reploid-literal-catalog-v1>'
                else:phase='answer';exact=final
                prompt=effective.apply_chat_template(exact,tokenize=False,add_generation_prompt=True,enable_thinking=False)
                ids=tokenizer.encode(prompt,add_special_tokens=False).ids
                maximum=allowance(limits,row,len(ids),len(views) if view is not None else None)
                if maximum<=0 or row['rawOutputUtf16']>=limits['rawOutputUtf16']:
                    row['failure']='No aggregate budget for '+phase;row['unadmittedPromptTokens']=len(ids);break
                stage=copy.deepcopy(actual_suite);stage['cases']=[copy.deepcopy(task)]
                stage['generation']['maxTokens']=maximum;stage['maxOutputCharacters']=limits['rawOutputUtf16']-row['rawOutputUtf16']
                phase_report={'settings':stage['generation'],'results':[]}
                phase_path=output.with_name(output.stem+'-'+task['id']+'-'+phase+'.json')
                def bound_messages(actual_task,unused):
                    assert actual_task['id']==task['id'];return copy.deepcopy(exact)
                quality.task_messages=bound_messages
                try:original_evaluate(model,config,tokenizer,effective,stage,phase_report,phase_path)
                finally:quality.task_messages=original_messages
                result=phase_report['results'][0];assert result['inputIds']==ids,'Executed input differs from admitted exact prompt'
                raw=tokenizer.decode(result['tokenIds'],skip_special_tokens=False)
                row['calls'].append({'phase':phase,'messages':exact,**result})
                row['promptTokens']+=len(ids);row['generatedTokens']+=len(result['tokenIds'])
                row['rawOutputUtf16']+=len(raw.encode('utf-16-le'))//2
                row['totalChargedTokens']=row['promptTokens']+row['generatedTokens']
                row['withinBudgets']=row['totalChargedTokens']<=8192 and row['generatedTokens']<=4096 and row['rawOutputUtf16']<=16000
                quality.write_quality_report(output,report)
                if result['stopReason']!='eos' or not row['withinBudgets']:
                    row['failure']=phase+' did not naturally complete within budget';break
                if view is not None:
                    try:
                        assert result['tokenIds'][-1] in suite['eosTokenIds']
                        raw_call=tokenizer.decode(result['tokenIds'][:-1],skip_special_tokens=False)
                        if raw_call!=result['text']:raise ValueError('Unexpected special token; no stripping repair')
                        call=parse_call(raw_call);row['operations']+=len(call['arguments']['operations'])
                        if row['operations']>30:raise ValueError('Aggregate operation bound exceeded')
                        tool={'ok':True,'result':invoke('calculateScope',[call['arguments'],task['messages'],view['documentId']])}
                        row['tools'].append({'documentId':view['documentId'],'call':call,'response':tool})
                        final=response_messages(final,raw_call,tool)
                    except (ValueError,subprocess.TimeoutExpired) as error:
                        row['failure']='Source selection/tool rejected: '+str(error);break
                else:
                    row['answerText']=result['text']
                    row['complete']='<tool_call>' not in result['text']
                    if not row['complete']:row['failure']='Final answer attempted another tool call'
                quality.write_quality_report(output,report)
            quality.write_quality_report(output,report)
            if not row['complete']:
                report['unrunCases']=[case['id'] for case in actual_suite['cases'][len(report['cases']):]]
                report['stoppedAtStructuralBoundary']=True;break
        report['reviewRequired']=True
        report['status']='stopped at structural boundary' if report.get('stoppedAtStructuralBoundary') else 'awaiting full manual factual/citation review'
        quality.write_quality_report(output,report)
    quality.evaluate_tasks=evaluate
    spec=importlib.util.spec_from_file_location('existing_source_loader',tools/'qwen35-original-weight-generation.py')
    source=importlib.util.module_from_spec(spec);spec.loader.exec_module(source)
    source.run(SimpleNamespace(source=args.source,deployed=args.deployed,revision=suite['sourceRevision'],suite=args.suite,control=None,out=args.out,threads=args.threads))


if __name__=='__main__':main()
