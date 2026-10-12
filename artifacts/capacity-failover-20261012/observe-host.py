import json,sys,time
from pathlib import Path
nativePid,browserPid,nativeLog,browserLog=sys.argv[1:]
last={}
with open(nativeLog) as lines:
 for line in lines:
  try:
   d=json.loads(line)
   if d.get('event')=='partition-state':last=d
  except:pass
browser={}; memory=None
with open(browserLog) as lines:
 for line in lines:
  try:
   d=json.loads(line)
   if 'phase' in d:browser=d
   if d.get('event')=='resident-ready':memory={k:d['memory'].get(k) for k in ['maxBytes','liveBytes','peakBytes']}
  except:pass
print(json.dumps({'at':time.time(),'native':{'pid':int(nativePid),'running':Path('/proc/'+nativePid).exists(),'directory':str(Path('/proc/'+nativePid+'/cwd').resolve()),'phase':last.get('phase'),'placement':last.get('placement'),'active':(last.get('reservations')or{}).get('active'),'unsettledOwners':last.get('unsettledOwners'),'descriptor':last.get('descriptor')},'browser':{'pid':int(browserPid),'running':Path('/proc/'+browserPid).exists(),'state':browser,'memory':memory}},indent=2))
