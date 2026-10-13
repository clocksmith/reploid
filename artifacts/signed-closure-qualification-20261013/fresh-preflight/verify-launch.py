import pathlib,json,hashlib,subprocess,sys,datetime
P=pathlib.Path
root=P.cwd();role=sys.argv[1];direction=sys.argv[2]
assert role in ['mac','native'] and direction in ['0','1']
frozen=json.loads((root/'launch-preflight.json').read_text());binding=json.loads((root/'snapshot-binding.json').read_text())
def sha(p): return hashlib.sha256(P(p).read_bytes()).hexdigest()
for row in binding['files']: assert sha(root/row['path'])==row['sha256'],row['path']
assert sha(root/'archive.tgz')==binding['archiveSha256']
for row in frozen['modelFiles']: assert sha(P(frozen['model'])/row['name'])==row['sha256'],row['name']
if role=='mac':
 p=frozen['mac'];expected=p['browser'];version=subprocess.check_output([p['executable']['path'],'--version'],text=True).strip();assert expected in version
else:
 p=frozen['native'];expected=p['node'];version=subprocess.check_output([p['executable']['path'],'--version'],text=True).strip();assert version==expected
 for library in p['providerObservation']['nativeProvider']['libraries']:
  assert sha(library['path'])==library['sha256'],library['path']
assert sha(p['executable']['path'])==p['executable']['sha256']
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'role':role,'direction':int(direction),'version':version,'executable':p['executable'],'deliverySha256':sha(root/'snapshot-binding.json'),'modelFiles':len(frozen['modelFiles']),'deliveryFiles':len(binding['files']),'verified':True}
output=P(frozen['output']);output.mkdir(exist_ok=True);(output/f'{role}-direction-{direction}-prelaunch.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
