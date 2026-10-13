import pathlib, shutil, json, hashlib, os
P=pathlib.Path
old=P('/var/tmp/reploid-readiness-numerical-20261012')
new=P('/var/tmp/reploid-closure-qualification-20261013')
model=P('/var/tmp/reploid-closure-model-20261013')
out=P('/var/tmp/reploid-closure-qualification-output-20261013')
source=P('/Users/xyz/deco/doppler/reports/local/paired-intermediates-20261012/model-0.6.28/model')
graph=P('/Users/xyz/deco/doppler/artifacts/paired-intermediates-20261012/signed-closure-correction/execution.json')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v): p.write_text(json.dumps(v,indent=2)+'\n')
assert not new.exists() and not model.exists() and not out.exists()
# Verify the immutable previous fixture before copying it.
binding=json.loads((old/'snapshot-binding.json').read_text())
assert sha(old/'snapshot-binding.json')=='397f4efbf47a8300660fa2e8b11761a3586c0d537044037d904aef255097ed3e'
for entry in binding['files']: assert sha(old/entry['path'])==entry['sha256'],entry['path']
shutil.copytree(old,new,symlinks=True)
model.mkdir(); out.mkdir()
for p in source.iterdir():
 if p.name!='manifest.json' and p.is_file(): os.link(p.resolve(),model/p.name)
manifest=json.loads((source/'manifest.json').read_text()); previous=json.loads(json.dumps(manifest))
manifest['inference']['execution']=json.loads(graph.read_text())
write(model/'manifest.json',manifest)
check=json.loads(json.dumps(manifest)); check['inference']['execution']=previous['inference']['execution']; assert check==previous
shutil.copyfile(graph,new/'execution.json')
pair=json.loads((new/'binding.json').read_text()); pair['immediateParentManifestSha256']=sha(source/'manifest.json'); pair['manifestSha256']=sha(model/'manifest.json');pair['graphSha256']=sha(graph);pair['closureCorrection']='5093283c: declarations only; existing 0fad runtime and shader bytes unchanged'; write(new/'binding.json',pair)
catalog=json.loads((new/'self/config/chat-models.json').read_text())
for m in catalog:
 if m['id']=='qwen-3-5-0-8b-q4k-ehaf16': m['identity']='sha256:'+pair['manifestSha256']
write(new/'self/config/chat-models.json',catalog)
server=new/'delivery-server.js'; server.write_text(server.read_text().replace('29450','29850').replace('29451','29851'))
# Bind all prior immutable members; launch/config files are separately hashed to avoid self-reference.
for entry in binding['files']: entry['sha256']=sha(new/entry['path'])
binding['closureCorrection']={'commit':'5093283c','graphSha256':sha(graph),'previousDeliverySha256':sha(old/'snapshot-binding.json'),'runtimeChanged':False}
write(new/'snapshot-binding.json',binding); delivery=sha(new/'snapshot-binding.json')
config=json.loads((new/'config.json').read_text()); config['testDelivery'].update(root=str(new),bindingPath=str(new/'snapshot-binding.json'),bindingSha256=delivery,archivePath=str(new/'archive.tgz'));write(new/'config.json',config)
for filename in ['run-native-reference.sh','supervise-native.sh']:
 p=new/filename;s=p.read_text().replace(str(old),str(new)).replace('/var/tmp/reploid-readiness-numerical-output-20261012',str(out)).replace(str(source),str(model)).replace('397f4efbf47a8300660fa2e8b11761a3586c0d537044037d904aef255097ed3e',delivery).replace('29429','29829').replace('29450','29850').replace('29451','29851');p.write_text(s);p.chmod(0o755)
record={'scope':'CPU-frozen corrected-graph qualification preparation, no physical result','root':str(new),'model':str(model),'output':str(out),'deliverySha256':delivery,'manifestSha256':sha(model/'manifest.json'),'graphSha256':sha(graph),'archiveSha256':sha(new/'archive.tgz'),'files':len(binding['files']),'controls':{n:sha(new/n) for n in ['run-native-reference.sh','supervise-native.sh','config.json']},'modelFiles':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(model.iterdir())]}
write(P(__file__).parent/'preparation.json',record)
print(json.dumps({k:v for k,v in record.items() if k!='modelFiles'},indent=2))
