"""Run the actual frozen loader through its report boundary, substituting only model construction."""
import argparse,hashlib,importlib.util,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
p=argparse.ArgumentParser();p.add_argument('--doppler',required=True);p.add_argument('--source',required=True);p.add_argument('--out',required=True);args=p.parse_args();root=Path(__file__).resolve().parent
tool=Path(args.doppler)/'tools/source-model-task-quality.py';assert hashlib.sha256(tool.read_bytes()).hexdigest()=='3e1dd96f7e338a48a0c778e7d9b2b20f0c9c2982ff9a59194d03774ed42da483'
sys.path.insert(0,str(tool.parent));spec=importlib.util.spec_from_file_location('actual_source_loader',tool);loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
calls=[];evaluations=[]
class Dummy:
 def eval(self):return self

def model(*a,**kw):calls.append({'localFilesOnly':kw['local_files_only'],'attention':kw['attn_implementation'],'dtype':str(kw['dtype'])});return Dummy()
loader.AutoModelForCausalLM=SimpleNamespace(from_pretrained=model)
def evaluate(model,config,tokenizer,official,suite,report,out):
 assert suite['modelId']==report['source']['source'] and suite['sourceRevision']==report['source']['revision']
 assert report['scope']==suite['scope'] and suite['generation']['maxTokens']==64
 assert report['results']==[] and report['qualified'] is False
 evaluations.append({'scope':report['scope'],'modelId':suite['modelId'],'sourceRevision':suite['sourceRevision']})
loader.evaluate_tasks=evaluate
suite=json.loads((root/'suite.json').read_text())
with tempfile.TemporaryDirectory() as temp:
 path=Path(temp);old=dict(suite)
 for key in ['modelId','sourceRevision','scope']:old.pop(key)
 (path/'missing.json').write_text(json.dumps(old))
 options=dict(source=args.source,out=str(path/'report.json'),threads=4,deployed=None,head_probe_contract=None,probe_report=None,probe_case=None,probe_step=None)
 try:loader.run(SimpleNamespace(suite=str(path/'missing.json'),**options));raise AssertionError('Missing identity was accepted')
 except KeyError as error:assert error.args==('modelId',)
 assert not calls and not evaluations
 loader.run(SimpleNamespace(suite=str(root/'suite.json'),**options))
 assert len(calls)==len(evaluations)==1
receipt={'schema':'reploid.actual-source-loader-preparation-control/v1','passed':True,'sourceModelExecuted':False,'modelConstructorSubstituted':True,'weightsHashedByActualLoader':True,'missingIdentityRejectedBeforeConstruction':True,'realLoaderReportBoundaryReached':True,'construction':calls,'evaluations':evaluations,'toolSha256':hashlib.sha256(tool.read_bytes()).hexdigest()}
Path(args.out).write_text(json.dumps(receipt,indent=2)+'\n')
