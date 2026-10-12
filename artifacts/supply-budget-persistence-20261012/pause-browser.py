import json,os,signal,sys,time
from pathlib import Path
pid=int(sys.argv[1]);root=Path('/proc/'+str(pid));args=[s.decode() for s in (root/'cmdline').read_bytes().split(b'\0') if s]
assert args[1]=='scripts/run-mesh-contributor.js' and 'https://replo.id/' in args
record={'pid':pid,'cwd':str((root/'cwd').resolve()),'args':args,'at':time.time()}
os.kill(pid,signal.SIGTERM)
for _ in range(600):
 try:
  if (root/'stat').read_text().split(') ')[1].split()[0]=='Z':break
 except FileNotFoundError:break
 time.sleep(.1)
else:raise RuntimeError('Browser did not exit')
record['exitedAt']=time.time();print(json.dumps(record))
