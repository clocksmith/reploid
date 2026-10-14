"""Read-only record of a native host's signed state (run-2). Piped over ssh:
  ssh <dest> python3 - <machine alias> <state directory> < signed-state.py
Opens the SQLite stores read-only through Node's node:sqlite (the application's own driver)."""
import datetime, json, os, subprocess, sys
alias, state = sys.argv[1], sys.argv[2]
script = r'''
const {DatabaseSync}=require("node:sqlite"); const fs=require("fs"); const crypto=require("crypto");
const out={};
let db=new DatabaseSync("release-checkpoints/release-checkpoints.sqlite",{readOnly:true}); out.releaseCheckpoints=db.prepare("SELECT * FROM checkpoints").all(); db.close();
db=new DatabaseSync("cache/custody-budget.sqlite",{readOnly:true}); out.supplyLedger=JSON.parse(db.prepare("SELECT record FROM allowance WHERE id=1").get().record); db.close();
const id=fs.readFileSync("identity.json"); out.identityPeerId=JSON.parse(id).peerId; out.identitySha256=crypto.createHash("sha256").update(id).digest("hex");
out.cacheEntries=fs.readdirSync("cache").length; console.log(JSON.stringify(out));
'''
result = subprocess.run(['/usr/bin/node', '-e', script], cwd=state, capture_output=True, text=True)
data = json.loads(result.stdout) if result.returncode == 0 else {'error': result.stderr[-500:]}
print(json.dumps({'schema': 'reploid.run-2-signed-state/v1', 'machine': alias, 'stateDirectory': state,
                  'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **data}, indent=1))
