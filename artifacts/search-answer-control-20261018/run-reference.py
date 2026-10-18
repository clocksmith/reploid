import hashlib,json,os,resource,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent
contract=json.loads((root/'reference-contract.json').read_text())
for name,expected in contract['files'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name
memory={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.split(':')[0] in ['MemAvailable','MemTotal']}
assert memory['MemAvailable']>=contract['minimumHostAvailableGiB']*1024**3,memory
out=root/'reference.json'
assert not out.exists(),'Refuse to overwrite prior reference'
env={**os.environ,'PYTHONPATH':contract['pythonPath'],'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'}
cmd=[contract['python'],str(root/'qwen35-deployed-reference.py'),'--model','/home/x/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16','--source-config',str(root/'source-config.json'),'--capture',str(root/'capture.json'),'--piece-index',str(root/'pieces.json'),'--piece-index-identity','sha256:'+contract['files']['pieces.json'],'--reference',str(root/'control.json'),'--generation-control',str(root/'control.json'),'--prefixes','1','--threads',str(contract['threads']),'--linear-prefill',contract['linearPrefill'],'--normalization',contract['normalization'],'--out',str(out)]
def limit():
 cap=contract['maxAddressSpaceGiB']*1024**3;resource.setrlimit(resource.RLIMIT_AS,(cap,cap))
started=time.monotonic()
with (root/'reference.log').open('x') as log:
 try:
  result=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,preexec_fn=limit,timeout=contract['perCaseTimeoutSeconds']);status=result.returncode
 except subprocess.TimeoutExpired:status='timeout'
receipt={'command':cmd,'environment':{'PYTHONPATH':contract['pythonPath'],'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'},'memoryBeforeBytes':memory,'exitCode':status,'elapsedSeconds':time.monotonic()-started}
(root/'reference-process.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
raise SystemExit(0 if status==0 else 1)
