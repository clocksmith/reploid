import pathlib,shutil,json,hashlib
P=pathlib.Path;here=P(__file__).resolve().parent
old=P('/var/tmp/reploid-closure-qualification-20261013');new=P('/var/tmp/reploid-closure-qualification-v2-20261013');out=P('/var/tmp/reploid-closure-qualification-v2-output-20261013')
assert not new.exists() and not out.exists();shutil.copytree(old,new,symlinks=True);out.mkdir()
sha=lambda p:hashlib.sha256(P(p).read_bytes()).hexdigest()
def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
mac=json.loads((here/'mac-observation.json').read_text());native=json.loads((here/'native-observation.json').read_text());plan=json.loads((here/'plan.json').read_text());prior=json.loads((here.parent/'preparation.json').read_text())
write(new/'provider-preflight.json',{'scope':'Fresh adapter-only observations before new qualification','mac':mac,'native':native});write(new/'plan-preflight.json',plan)
write(new/'launch-preflight.json',{'mac':mac,'native':native,'model':prior['model'],'modelFiles':prior['modelFiles'],'output':str(out)})
shutil.copyfile(here/'verify-launch.py',new/'verify-launch.py')
catalog=json.loads((new/'self/config/chat-models.json').read_text())
for model in catalog:
 if model['id']=='qwen-3-5-0-8b-q4k-ehaf16':
  assert model['identity']=='sha256:'+prior['manifestSha256']
  for file in model['source']['files']:
   if file['path']=='manifest.json':file.update(sizeBytes=(P(prior['model'])/'manifest.json').stat().st_size,hash=prior['manifestSha256'],url='http://127.0.0.1:29851/manifest.json')
write(new/'self/config/chat-models.json',catalog)
binding=json.loads((new/'snapshot-binding.json').read_text());binding['files'] += [{'path':n,'sha256':sha(new/n)} for n in ['launch-preflight.json','verify-launch.py']]
for row in binding['files']:row['sha256']=sha(new/row['path'])
binding['providerRefresh']={'previousRejectedDeliverySha256':sha(old/'snapshot-binding.json'),'reason':'Fresh Chromium155.0.8059.40 and actual mapped native library observations before output; prior mismatched expectations retained'}
write(new/'snapshot-binding.json',binding);delivery=sha(new/'snapshot-binding.json')
config=json.loads((new/'config.json').read_text());config['testDelivery'].update(root=str(new),bindingPath=str(new/'snapshot-binding.json'),bindingSha256=delivery,archivePath=str(new/'archive.tgz'));write(new/'config.json',config)
for name,role in [('run-native-reference.sh','mac'),('supervise-native.sh','native')]:
 p=new/name;s=p.read_text().replace(str(old),str(new)).replace('/var/tmp/reploid-closure-qualification-output-20261013',str(out)).replace(sha(old/'snapshot-binding.json'),delivery)
 s=s.replace('cd '+str(new),'cd '+str(new)+'\npython3 verify-launch.py '+role+' "${1:?direction0or1required}"');p.write_text(s);p.chmod(0o755)
for d in [0,1]:
 e=json.loads((here.parent/f'direction-{d}-expectations.json').read_text());e['testDeliveryHash']='sha256:'+delivery;e['providers'][mac['host']]=mac['provider'];e['browserVersions'][mac['host']]=mac['browser']
 host='x@128.tail995236.ts.net:node-dawn';raw=native['providerObservation']['rawAdapter'];e['providers'][host]={'adapter':{k:(v or ('unknown' if k!='description' else '')) for k,v in raw.items()}}
 n=e['nativeHosts'][host];n['testDeliveryHash']=e['testDeliveryHash'];n['provider']=native['providerObservation']['nativeProvider'];n['node']=native['observedIdentity']['node'];n['nativeDeliverySha256']=native['observedIdentity']['fixture']['nativeDeliverySha256']
 e['partitionPlan']=plan['plan'];e['legacyPlanId']=plan['legacyPlanId'];e['preflightBinding']={'providerSha256':sha(new/'provider-preflight.json'),'planSha256':sha(new/'plan-preflight.json'),'launchPreflightSha256':sha(new/'launch-preflight.json'),'notApplicationRelease':True}
 e['expectationBasis']={'scope':'Fresh Mac and native pre-output adapter-only observations, unchanged independently frozen reference and producer','priorRejectedExpectationsSha256':sha(here.parent/f'direction-{d}-expectations.json')}
 write(here/f'direction-{d}-expectations.json',e)
record={'root':str(new),'output':str(out),'deliverySha256':delivery,'files':len(binding['files']),'archiveSha256':prior['archiveSha256'],'manifestSha256':prior['manifestSha256'],'graphSha256':prior['graphSha256'],'controls':{n:sha(new/n) for n in ['config.json','run-native-reference.sh','supervise-native.sh']}}
write(here/'preparation.json',record)
for name in ['snapshot-binding.json','config.json','run-native-reference.sh','supervise-native.sh','launch-preflight.json','provider-preflight.json','plan-preflight.json']:shutil.copyfile(new/name,here/name)
print(json.dumps(record,indent=2))
