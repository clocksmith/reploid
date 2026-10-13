from pathlib import Path
import subprocess,json,datetime,os,hashlib
base=Path('/var/tmp/reploid-flat-ledger-20261012');repo=base/'repo';root=repo/'artifacts/cited-calculation-experiment-20261012/source-ledger/flat-experiment';doppler=Path('/var/tmp/doppler-archive9-unit-4umv8z92/workspace/doppler');source=Path('/var/tmp/doppler-qwen3-17b-source-20261011');out=base/'results';out.mkdir(exist_ok=True)
lock=os.open(base/'launch.lock',os.O_CREAT|os.O_EXCL|os.O_WRONLY);os.close(lock)
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
freeze=json.loads((root/'freeze.json').read_text());expected='a6568fee06775b5793b85a438f2e41bed4d681c562a55946682b5a457a498f01';assert sha(root/'freeze.json')==expected
observed={}
for category,directory in [('files',root),('reusedSources',repo),('dopplerSources',doppler),('sourceIdentity',source)]:
 observed[category]={name:sha(directory/name) for name in freeze[category]}
 assert observed[category]==freeze[category],category
receipt=json.loads((source/'download-receipt.json').read_text());assert receipt['revision']==freeze['sourceRevision'] and receipt['source']==freeze['model']
identity={'schema':'reploid.source-ledger-executing-identity/v1','frozenRevision':'bfa37fcf','freezeSha256':expected,'sourceTarSha256':sha(base/'source.tar'),'verifiedBeforeImport':observed,'sourceReceipt':receipt,'weightValidation':'The bound source loader verifies all actual source-file sizes/SHA256 and expected LFS identities before loading. This pre-import check verifies the immutable receipt, not unobserved weight bytes.','sourcePath':str(source),'dopplerPath':str(doppler)}
(base/'executing-host-identity.json').write_text(json.dumps(identity,indent=2)+'\n')
env=dict(os.environ);env.update(PYTHONPATH='/tmp/doppler-reference-deps',PYTHONDONTWRITEBYTECODE='1',OPENBLAS_NUM_THREADS='4',OMP_NUM_THREADS='4',MKL_NUM_THREADS='4')
cmd=['taskset','-c','4-7','nice','-n','10','python3','-u',str(root/'run.py'),'--doppler',str(doppler),'--source',str(source),'--out',str(out/'source.json')]
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();r={'schema':'reploid.source-ledger-run/v1','frozenRevision':'bfa37fcf','freezeSha256':expected,'command':cmd,'startedAtUtc':now(),'status':'running','wrapperPid':os.getpid(),'concurrency':'Root authorized CPU4-7 concurrent with correctness-only signed preparation; no performance claims.','gpu':False,'cpuAffinity':[4,5,6,7],'nice':10,'threads':4,'outputDirectory':str(out),'environment':{k:env[k] for k in ['PYTHONPATH','PYTHONDONTWRITEBYTECODE','OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS']}}
with (out/'run.log').open('wb') as f:
 child=subprocess.Popen(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT);r['sourcePid']=child.pid;(base/'run-binding.json').write_text(json.dumps(r,indent=2)+'\n');code=child.wait()
r.update(status='completed',exitCode=code,finishedAtUtc=now());(base/'run-binding.json').write_text(json.dumps(r,indent=2)+'\n')
