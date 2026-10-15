# Builds a model directory for the Q/K head-norm graph checks from the frozen candidate's Capsule
# manifest (548e6559...). Weight shards and the tokenizer are symlinked from the unchanged base
# model directory, never copied or modified.
#
# Usage: python3 make-qk-model.py <candidate manifest.json> <base model dir> <mode> <out dir>
#   legacy   manifest bytes unchanged (548e6559...): no q_norm/k_norm steps; the head norms run the
#            interim rmsnorm/paired program, declared as mechanism kernel paired_qk_head_norm.
#   shipped  q_norm and k_norm steps after v_proj in decode and prefill, both naming kernel key
#            paired_qk_head_norm (rmsnorm_paired.wgsl, the program the candidate already runs);
#            paired_qk_head_norm leaves mechanismKernels (it is now a step kernel).
#   sliced   q_norm and k_norm steps naming kernel key norm (rmsnorm_paired_sliced.wgsl, the
#            program of the other norm steps); paired_qk_head_norm is removed from kernels and
#            mechanismKernels, so rmsnorm_paired.wgsl leaves the declared closure.
# Every other manifest field is unchanged. Writes <out dir>/variant.json with both identities and
# the exact changes.
import hashlib
import json
import os
import sys

manifest_path, base_dir, mode, out_dir = sys.argv[1:5]
CANDIDATE = '548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db'
with open(manifest_path, 'rb') as handle:
    base_bytes = handle.read()
if hashlib.sha256(base_bytes).hexdigest() != CANDIDATE:
    raise SystemExit('candidate manifest identity differs')
manifest = json.loads(base_bytes)
execution = manifest['inference']['execution']
changes = []
if mode == 'legacy':
    variant_bytes = base_bytes
else:
    if mode not in ('shipped', 'sliced'):
        raise SystemExit(f'unknown mode {mode}')
    key = 'paired_qk_head_norm' if mode == 'shipped' else 'norm'
    for phase in ('decode', 'prefill'):
        steps = execution[phase]
        ops = [step[0] for step in steps]
        if 'q_norm' in ops or 'k_norm' in ops or ops.count('v_proj') != 1:
            raise SystemExit(f'{phase}: unexpected step list')
        at = ops.index('v_proj') + 1
        steps[at:at] = [['q_norm', key], ['k_norm', key]]
        changes.append({'phase': phase, 'insertedAt': at, 'steps': [['q_norm', key], ['k_norm', key]]})
    execution['mechanismKernels'] = [k for k in execution['mechanismKernels'] if k != 'paired_qk_head_norm']
    changes.append({'mechanismKernelsRemoved': ['paired_qk_head_norm']})
    if mode == 'sliced':
        removed = execution['kernels'].pop('paired_qk_head_norm')
        changes.append({'kernelsRemoved': {'paired_qk_head_norm': removed}})
    variant_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
os.makedirs(out_dir, exist_ok=False)
for name in sorted(os.listdir(base_dir)):
    if name != 'manifest.json':
        os.symlink(os.path.join(base_dir, name), os.path.join(out_dir, name))
with open(os.path.join(out_dir, 'manifest.json'), 'wb') as handle:
    handle.write(variant_bytes)
record = {'mode': mode, 'baseManifestSha256': 'sha256:' + CANDIDATE,
          'variantManifestSha256': 'sha256:' + hashlib.sha256(variant_bytes).hexdigest(), 'changes': changes}
with open(os.path.join(out_dir, 'variant.json'), 'w') as handle:
    json.dump(record, handle, indent=1)
    handle.write('\n')
print(json.dumps(record))
