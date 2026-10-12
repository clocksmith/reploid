import json,subprocess,sys,time
record=json.load(open(sys.argv[1]));args=record['args'];assert args[1]=='scripts/run-mesh-contributor.js' and 'https://replo.id/' in args
with open(sys.argv[2],'ab',buffering=0) as output:
 process=subprocess.Popen(args,cwd=record['cwd'],stdin=subprocess.DEVNULL,stdout=output,stderr=output,start_new_session=True)
print(json.dumps({'newPid':process.pid,'cwd':record['cwd'],'args':args,'log':sys.argv[2],'at':time.time()}))
