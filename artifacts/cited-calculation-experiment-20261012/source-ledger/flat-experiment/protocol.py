"""Reuse strict JSON parsing; admit exactly one SourceLedger call without prose repair."""
import importlib.util,json,re
from pathlib import Path
path=Path(__file__).resolve().parents[2]/'available-typed/protocol.py'
spec=importlib.util.spec_from_file_location('retained_json_protocol',path)
retained=importlib.util.module_from_spec(spec);spec.loader.exec_module(retained)

def parse_call(text):
    if not isinstance(text,str) or len(text.encode('utf-16-le'))//2>16000:
        raise ValueError('Tool output exceeds allowance')
    match=re.fullmatch(r'\s*<tool_call>\s*(.*?)\s*</tool_call>\s*',text,re.S)
    if not match or text.count('<tool_call>')!=1:
        raise ValueError('Exactly one tool call and no prose required')
    call=json.loads(match[1],object_pairs_hook=retained.unique_object,parse_constant=retained.reject_constant)
    if not isinstance(call,dict) or set(call)!={'name','arguments'} or call['name']!='SourceLedger':
        raise ValueError('Expected SourceLedger name and arguments')
    if not isinstance(call['arguments'],dict) or set(call['arguments'])!={'budget','deadline','documents','base','additional','credits','includedAmounts','depositBase','depositPercent','start','duration','completion','relations'}:
        raise ValueError('Exact ledger fields required')
    return call

def admission(limits,prompt_tokens):
    return max(0,min(limits['generatedTokens'],limits['promptPlusGeneratedTokens']-prompt_tokens))

def charge(limits,prompt_tokens,token_ids,raw,rendered=''):
    values={'promptTokens':prompt_tokens,'generatedTokens':len(token_ids),
        'rawOutputUtf16':len(raw.encode('utf-16-le'))//2,'renderedOutputUtf16':len(rendered.encode('utf-16-le'))//2}
    values['totalChargedTokens']=values['promptTokens']+values['generatedTokens']
    values['totalOutputUtf16']=values['rawOutputUtf16']+values['renderedOutputUtf16']
    values['withinBudgets']=values['generatedTokens']<=limits['generatedTokens'] and values['totalChargedTokens']<=limits['promptPlusGeneratedTokens'] and values['totalOutputUtf16']<=limits['rawOutputUtf16']
    return values

def run_bridge(path,payload,execute=None):
    """Retain infrastructure failure as a rejected case, never an absent result."""
    import subprocess,base64
    execute=execute or subprocess.run
    def capture(value):
        if isinstance(value,bytes):return {'base64':base64.b64encode(value).decode()}
        return {'text':value or ''}
    try:
        process=execute(['node',str(path)],input=json.dumps(payload),text=True,capture_output=True,timeout=10)
    except subprocess.TimeoutExpired as error:
        return {'ok':False,'error':'Calculator bridge timed out','category':'bridge-timeout',
            'stdout':capture(error.stdout),'stderr':capture(error.stderr)}
    except (OSError,RuntimeError) as error:
        return {'ok':False,'error':str(error),'category':'bridge-infrastructure','exceptionType':type(error).__name__}
    observed={'returncode':process.returncode,'stdout':capture(process.stdout),'stderr':capture(process.stderr)}
    if process.returncode:
        return {'ok':False,'error':'Calculator bridge exited unsuccessfully','category':'bridge-exit','observed':observed}
    try:response=json.loads(process.stdout)
    except (json.JSONDecodeError,UnicodeError) as error:
        return {'ok':False,'error':str(error),'category':'bridge-invalid-json','observed':observed}
    valid=isinstance(response,dict) and type(response.get('ok')) is bool
    if valid and response['ok']:
        valid=isinstance(response.get('ledger'),dict) and isinstance(response.get('report'),dict) and isinstance(response['report'].get('text'),str)
    elif valid:valid=isinstance(response.get('error'),str)
    if not valid:return {'ok':False,'error':'Invalid calculator bridge envelope','category':'bridge-invalid-envelope','observed':observed}
    return response


def retain_boundary(report,row,cases,write):
    """Persist a failed completed case and mark remaining cases unrun before exit."""
    stopped=not row['complete']
    if stopped:
        report['unrunCases']=[case['id'] for case in cases[len(report['cases']):]]
        report['stoppedAtStructuralBoundary']=True
        report['reviewRequired']=True
        report['status']='stopped at structural boundary'
    write(report)
    return stopped
