import hashlib,json,os,resource,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parent
contract=json.loads((root/'original-reference-contract.json').read_text())
for name,expected in contract['files'].items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==expected,name
memory={line.split(':')[0]:int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.split(':')[0] in ['MemAvailable','MemTotal']}
assert memory['MemAvailable']>=contract['minimumHostAvailableGiB']*1024**3,memory
out=root/'original-reference.json'
assert not out.exists(),'Refuse to overwrite prior reference'
env={**os.environ,'PYTHONPATH':contract['pythonPath'],'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'}
cmd=[contract['python'],str(root/'qwen35-original-weight-generation.py'),'--source',contract['sourceDirectory'],'--revision',contract['sourceRevision'],'--deployed','/home/x/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16','--control',str(root/'control.json'),'--out',str(out),'--threads',str(contract['threads'])]
def limit():
 cap=contract['maxAddressSpaceGiB']*1024**3;resource.setrlimit(resource.RLIMIT_AS,(cap,cap))
started=time.monotonic()
with (root/'original-reference.log').open('x') as log:
 try:
  result=subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,preexec_fn=limit,timeout=contract['perCaseTimeoutSeconds']);status=result.returncode
 except subprocess.TimeoutExpired:status='timeout'
receipt={'command':cmd,'environment':{'PYTHONPATH':contract['pythonPath'],'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'},'memoryBeforeBytes':memory,'exitCode':status,'elapsedSeconds':time.monotonic()-started}
(root/'original-reference-process.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt),flush=True)
raise SystemExit(0 if status==0 else 1)
