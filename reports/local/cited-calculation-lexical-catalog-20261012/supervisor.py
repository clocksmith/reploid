import os,json,subprocess,time
from pathlib import Path
from datetime import datetime,timezone
root=Path("/home/x/deco/reploid/reports/local/cited-calculation-lexical-catalog-20261012")
command=["nice","-n","10","python3","-u","/home/x/deco/reploid/artifacts/cited-calculation-experiment-20261012/lexical-catalog/run.py","--doppler","/home/x/deco/doppler","--source","/var/tmp/doppler-qwen35-2b-source-20261011","--deployed","/home/x/deco/doppler/models/local/qwen-3-5-2b-q4k-ehaf16","--suite","/home/x/deco/reploid/artifacts/cited-calculation-experiment-20261012/lexical-catalog/suite.json","--out",str(root/"result.json"),"--threads","4"]
environment={"PYTHONPATH":"/tmp/doppler-reference-deps","OPENBLAS_NUM_THREADS":"4","OMP_NUM_THREADS":"4"}
start=time.monotonic();binding={"schema":"reploid.lexical-catalog-run/v1","frozenRevision":"d2ee4d54","host":"x@128.tail995236.ts.net","command":command,"environment":environment,"status":"starting","startedAtUtc":datetime.now(timezone.utc).isoformat(),"remoteReploidRevision":subprocess.check_output(["git","-C","/home/x/deco/reploid","rev-parse","HEAD"],text=True).strip(),"remoteDopplerRevision":subprocess.check_output(["git","-C","/home/x/deco/doppler","rev-parse","HEAD"],text=True).strip()}
with (root/"run.log").open("w") as log:
 child=subprocess.Popen(command,env={**os.environ,**environment},stdout=log,stderr=log,cwd="/home/x/deco/reploid")
 binding.update(status="running",pid=child.pid);(root/"binding.json").write_text(json.dumps(binding,indent=2)+"\n")
 code=child.wait()
binding.update(status="completed",exitCode=code,elapsedSeconds=time.monotonic()-start,finishedAtUtc=datetime.now(timezone.utc).isoformat());(root/"binding.json").write_text(json.dumps(binding,indent=2)+"\n")
