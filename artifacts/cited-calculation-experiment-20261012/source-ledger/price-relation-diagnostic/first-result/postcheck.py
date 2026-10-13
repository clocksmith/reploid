from pathlib import Path
import hashlib,json,datetime
base=Path('/var/tmp/reploid-price-1875e259');repo=base/'repo';root=repo/'artifacts/cited-calculation-experiment-20261012/source-ledger/price-relation-diagnostic';doppler=Path('/var/tmp/doppler-archive9-unit-4umv8z92/workspace/doppler');source=Path('/var/tmp/doppler-qwen3-17b-source-20261011')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
f=json.loads((root/'freeze.json').read_text());observed={}
for name,directory in [('files',root),('reusedSources',repo),('dopplerSources',doppler),('sourceIdentity',source)]:
 observed[name]={key:sha(directory/key) for key in f[name]};assert observed[name]==f[name],name
before=json.loads((base/'executing-host-identity.json').read_text());source_files=[]
for item in before['actualSourceFilesVerifiedBeforeImport']:
 path=source/item['path'];actual={'path':item['path'],'bytes':path.stat().st_size,'sha256':sha(path)};assert actual==item;source_files.append(actual)
binding=json.loads((base/'run-binding.json').read_text());assert binding['status']=='completed' and binding['exitCode']==0
alive={str(binding[k]):Path('/proc',str(binding[k])).exists() for k in ['wrapperPid','sourcePid']};assert not any(alive.values())
result={'schema':'reploid.single-price-postrun-identity/v1','observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'freezeSha256':sha(root/'freeze.json'),'frozenFilesUnchanged':True,'observed':observed,'sourceFilesUnchanged':source_files,'ownedProcessesAlive':alive,'sourceOutputSha256':sha(base/'results/source.json'),'runLogSha256':sha(base/'results/run.log')}
(base/'postrun-identity.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'frozenFilesUnchanged':True,'sourceFilesUnchanged':len(source_files),'ownedProcessesAlive':alive}))
