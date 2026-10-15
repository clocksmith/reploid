"""Placement C partition policy: the frozen fixture policy (sha256 5a6f974f...) with exactly two
fields changed: prefillTokenChunkSize 256 -> 16 (as campaign 3 and the signed Capsule), and
limits.maxPreparationMs added as 1200000, the value Reploid main declares in
self/config/partition-policy.json. Doppler ba72c310 (in the candidate) refuses a resident opening
whose allocation limits do not declare a positive maxPreparationMs, and supplies no default.
Usage: python3 make-policy.py <output path>"""
import hashlib, json, sys
from pathlib import Path
source = Path('/var/tmp/reploid-faster-candidate-20261015/self/config/partition-policy.json').read_bytes()
assert hashlib.sha256(source).hexdigest() == '5a6f974f34b1cba00aff269857c3fe53728782317477bede684a0e11f2b6a235'
main = json.loads(Path(__file__).resolve().parents[3].joinpath('self/config/partition-policy.json').read_text())
policy = json.loads(source)
assert policy['prefillTokenChunkSize'] == 256 and policy['prefillChunkLayers'] == 1 and 'maxPreparationMs' not in policy['limits']
policy['prefillTokenChunkSize'] = 16
policy['limits']['maxPreparationMs'] = main['limits']['maxPreparationMs']
assert policy['limits']['maxPreparationMs'] == 1200000
out = Path(sys.argv[1]); assert not out.exists()
out.write_text(json.dumps(policy, indent=2) + '\n')
print(json.dumps({'policy': str(out), 'sha256': 'sha256:' + hashlib.sha256(out.read_bytes()).hexdigest()}))
