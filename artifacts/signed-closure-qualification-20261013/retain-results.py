import pathlib,json,hashlib,gzip,shutil
P=pathlib.Path;root=P('/var/tmp/reploid-closure-qualification-v2-output-20261013');out=P(__file__).parent/'results';out.mkdir(exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
summary={'scope':'Genuine corrected-graph direct resident qualification on Mac browser and AMD Node, both placements; not signed application conversation or public deployment','archiveSha256':'0fadac5113d2cc154f65d9d40de50722a16454995e927c7d22bedc5f1a4925cd','manifestSha256':'709894a75b4200c111fb7dbb6c9435c8fd69710949ea8ba486cf93f38582fdd3','deliverySha256':'e9f3b8f266382d0aa36980fea657004a286fb66ff58e7d8e56e14d6acb4a6a3a','freezeCommit':'801e2d96','tolerance':0.001,'timingScope':'Shared public consumers/caches; not isolated performance','directions':[]}
for d in [0,1]:
 p=root/f'native-direction-{d}.json';x=json.load(open(p));n=[r for run in x['runs'] for r in run['numerical']];assert len(n)==55 and all(r['matches'] for r in n)
 with open(p,'rb') as src,open(out/(p.name+'.gz'),'wb') as target:
  with gzip.GzipFile(fileobj=target,mode='wb',mtime=0) as z:shutil.copyfileobj(src,z)
 for suffix in ['controller.log','log','exit.json','pid','prelaunch.json']:
  f=root/f'native-direction-{d}.{suffix}' if suffix!='prelaunch.json' else root/f'native-direction-{d}-prelaunch.json'
  if f.exists():shutil.copyfile(f,out/f.name)
 shutil.copyfile(root/f'mac-direction-{d}-prelaunch.json',out/f'mac-direction-{d}-prelaunch.json')
 exit=json.load(open(root/f'native-direction-{d}.exit.json'));assert exit['exitCode']==0 and exit['pid']==x['nativeHostSettlement']['pid']
 row={'direction':d,'producerExitCode':0,'captureSha256':sha(p),'captureBytes':p.stat().st_size,'gzipSha256':sha(out/(p.name+'.gz')),'prefixes':len(n),'allNumericalMatches':True,'maxDifference':max(r['maxDifference'] for r in n),'maxObservedStageMs':max(t[g]['elapsedMs'] for run in x['runs'] for t in run['stageTimings'] for g in ['group0','group1']),'nativeHostSettlement':x['nativeHostSettlement'],'nativeExit':exit,'cleanup':[{'barriers':r['barriers'],'owners':{k:r['snapshot']['pool']['resources'][k]['count'] for k in ['active','deferredCleanup','retainedModel']},'devicePeakBytes':r['snapshot']['device']['peakBytes'],'deviceEvents':r['snapshot']['deviceEvents'],'observationErrors':r['snapshot']['observationErrors']} for r in x['residentSettlement']]}
 assert all(c['barriers']>0 and all(v==0 for v in c['owners'].values()) and c['devicePeakBytes']<=1420000000 and not c['deviceEvents'] and not c['observationErrors'] for c in row['cleanup'])
 summary['directions'].append(row)
for f in root.glob('*postrun.json'):shutil.copyfile(f,out/f.name)
(out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
