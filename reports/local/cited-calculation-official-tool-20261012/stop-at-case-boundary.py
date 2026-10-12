import json,os,time,signal,subprocess
from pathlib import Path
from datetime import datetime,timezone
root=Path("/home/x/deco/reploid/reports/local/cited-calculation-official-tool-20261012")
pid=3408285
while True:
 try:
  d=json.loads((root/"result-fresh-bathroom-comparison-answer.json").read_text())
  r=d["results"][0]
  terminal=r.get("stopReason") in ("eos","max-tokens","output-character-limit")
 except (FileNotFoundError,json.JSONDecodeError,KeyError,IndexError):
  terminal=False
 if terminal:
  cmd=subprocess.check_output(["ps","-p",str(pid),"-o","args="],text=True).strip()
  assert "official-tool-protocol/run.py" in cmd
  os.kill(pid,signal.SIGTERM)
  (root/"boundary-stop.json").write_text(json.dumps({"status":"stopped at first case terminal answer receipt by explicit parent instruction","timestamp":datetime.now(timezone.utc).isoformat(),"pid":pid,"terminalPhase":"fresh-bathroom-comparison-answer","stopReason":r.get("stopReason"),"remainingCases":"unrun; do not classify as failures or passes","command":cmd},indent=2)+"\n")
  break
 try: os.kill(pid,0)
 except ProcessLookupError: break
 time.sleep(0.1)
