from pathlib import Path
import subprocess,json,datetime,os,hashlib
base=Path('/var/tmp/reploid-price-1875e259');repo=base/'repo';root=repo/'artifacts/cited-calculation-experiment-20261012/source-ledger/price-relation-diagnostic';doppler=Path('/var/tmp/doppler-archive9-unit-4umv8z92/workspace/doppler');source=Path('/var/tmp/doppler-qwen3-17b-source-20261011');out=base/'results';out.mkdir(exist_ok=True)
lock=os.open(base/'launch.lock',os.O_CREAT|os.O_EXCL|os.O_WRONLY);os.close(lock)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
freeze=json.loads((root/'freeze.json').read_text());expected='0ca4300b333a7f0a48944bd458ae20e4e43a1b31a21aa4f2a022c440b2a5b622';assert sha(root/'freeze.json')==expected
observed={}
for category,directory in [('files',root),('reusedSources',repo),('dopplerSources',doppler),('sourceIdentity',source)]:
 observed[category]={name:sha(directory/name) for name in freeze[category]}
 assert observed[category]==freeze[category],category
receipt=json.loads((source/'download-receipt.json').read_text());assert receipt['revision']==freeze['sourceRevision'] and receipt['source']==freeze['model']
weights=[]
for item in receipt['files']:
 path=source/item['path'];actual=sha(path)
 assert path.stat().st_size==item['bytes'] and actual==item['sha256'],item['path']
 if item.get('expectedLfsSha256'):assert actual==item['expectedLfsSha256']
 assert '/resolve/'+freeze['sourceRevision']+'/' in item['url']
 weights.append({'path':item['path'],'bytes':path.stat().st_size,'sha256':actual})
processes=[]
for entry in Path('/proc').iterdir():
 if not entry.name.isdigit():continue
 try:
  comm=(entry/'comm').read_text().strip()
  if comm not in ['python3','node','chrome']:continue
  fields=dict(line.split(':',1) for line in (entry/'status').read_text().splitlines() if ':' in line)
  processes.append({'pid':int(entry.name),'comm':comm,'cpuAllowed':fields.get('Cpus_allowed_list','').strip(),'rss':fields.get('VmRSS','').strip()})
 except (OSError,ValueError):pass
resources={'meminfo':Path('/proc/meminfo').read_text(),'processes':processes,'commandLinesExcluded':True}
assert int(next(line.split()[1] for line in resources['meminfo'].splitlines() if line.startswith('MemAvailable:'))) > 12*1024*1024
assert not any(row['cpuAllowed']=='4-7' for row in processes),'Another dedicated CPU4-7 process exists'
(base/'resources-before.json').write_text(json.dumps(resources,indent=2)+'\n')
identity={'schema':'reploid.source-ledger-executing-identity/v1','frozenRevision':'1875e259','freezeSha256':expected,'sourceTarSha256':sha(base/'source.tar'),'verifiedBeforeImport':observed,'sourceReceipt':receipt,'actualSourceFilesVerifiedBeforeImport':weights,'weightValidation':'Launcher streamed every retained source file and verified size/SHA256/LFS/revision before import; bound loader repeats source receipt verification before loading.','sourcePath':str(source),'dopplerPath':str(doppler)}
(base/'executing-host-identity.json').write_text(json.dumps(identity,indent=2)+'\n')
env=dict(os.environ);env.update(PYTHONPATH='/tmp/doppler-reference-deps',PYTHONDONTWRITEBYTECODE='1',OPENBLAS_NUM_THREADS='4',OMP_NUM_THREADS='4',MKL_NUM_THREADS='4')
cmd=['taskset','-c','4-7','nice','-n','10','python3','-u',str(root/'run.py'),'--doppler',str(doppler),'--source',str(source),'--out',str(out/'source.json')]
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();r={'schema':'reploid.source-ledger-run/v1','frozenRevision':'1875e259','freezeSha256':expected,'command':cmd,'startedAtUtc':now(),'status':'running','wrapperPid':os.getpid(),'concurrency':'Root approved frozen one-occurrence relation diagnostic concurrent with functional native-ready/Mac acquisition and public contributor processes; no timing or performance claims. No separate CPU4-7 owner observed before launch.','gpu':False,'cpuAffinity':[4,5,6,7],'nice':10,'threads':4,'outputDirectory':str(out),'environment':{k:env[k] for k in ['PYTHONPATH','PYTHONDONTWRITEBYTECODE','OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS']}}
with (out/'run.log').open('wb') as f:
 child=subprocess.Popen(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT);r['sourcePid']=child.pid;(base/'run-binding.json').write_text(json.dumps(r,indent=2)+'\n');code=child.wait()
r.update(status='completed',exitCode=code,finishedAtUtc=now());(base/'run-binding.json').write_text(json.dumps(r,indent=2)+'\n')
