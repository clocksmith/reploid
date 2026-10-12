import hashlib,json,sys,tarfile
from pathlib import Path
root=Path(sys.argv[1]); receipt=json.loads((root/'native-delivery.json').read_text())
checked=[]
for entry in receipt['entries']:
 p=root/entry['path']; actual=hashlib.sha256(p.read_bytes()).hexdigest()
 assert actual==entry['sha256'],entry['path']
 checked.append(entry['path'])
pin=json.loads((root/'self/config/doppler-package.json').read_text())
archive=root/pin['spec'].removeprefix('file:'); runtime=[]
with tarfile.open(archive) as packed:
 for entry in packed:
  if not entry.isfile():continue
  name=entry.name.removeprefix('package/'); data=packed.extractfile(entry).read()
  installed=root/'node_modules/doppler-gpu'/name
  assert installed.read_bytes()==data,name
  runtime.append({'path':name,'sha256':hashlib.sha256(data).hexdigest()})
print(json.dumps({'nativeRoot':str(root),'manifestSha256':hashlib.sha256((root/'native-delivery.json').read_bytes()).hexdigest(),'sourceFilesVerified':len(checked),'installedRuntimeFilesVerified':len(runtime),'installedRuntimeTreeSha256':hashlib.sha256(json.dumps(runtime,sort_keys=True).encode()).hexdigest(),'runtimeIntegrity':pin['integrity'],'passed':True},indent=2))
