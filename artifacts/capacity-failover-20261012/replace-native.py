import json,os,signal,subprocess,sys,time
from pathlib import Path
pid=int(sys.argv[1]); expected=Path(sys.argv[2]); target=Path(sys.argv[3]); log=Path(sys.argv[4])
assert Path('/proc/'+str(pid)+'/cwd').resolve()==expected.resolve(),'Process working directory differs'
argv=Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0'); argv=[v.decode() for v in argv if v]
assert argv[1] in ['server/native-participant.js', 'scripts/run-mesh-contributor.js']
if argv[1]=='server/native-participant.js': assert (target/'native-delivery.json').is_file()
record={'oldPid':pid,'oldDirectory':str(expected),'newDirectory':str(target),'log':str(log),'startedAt':time.time()}
os.kill(pid,signal.SIGTERM)
for _ in range(600):
 try:
  state=Path('/proc/'+str(pid)+'/stat').read_text().split(') ')[1].split()[0]
  if state=='Z':break
 except FileNotFoundError:break
 time.sleep(.1)
else:raise RuntimeError('Old participant did not exit; replacement not started')
record['oldExitedAt']=time.time()
with log.open('ab',buffering=0) as out:
 new=subprocess.Popen(argv,cwd=target,stdin=subprocess.DEVNULL,stdout=out,stderr=out,start_new_session=True)
record['newPid']=new.pid; record['launchedAt']=time.time()
print(json.dumps(record,indent=2))
