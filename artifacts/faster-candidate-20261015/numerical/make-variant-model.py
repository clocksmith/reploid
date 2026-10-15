# Builds a model directory whose manifest differs from the Capsule manifest only in declared
# execution-graph kernel entries. Weight shards and the tokenizer are symlinked, not copied.
#
# Usage: python3 make-variant-model.py <base model dir> <substitutions.json> <out dir>
# substitutions.json: {"label": ..., "kernels": {"<execution kernel key>": {kernel, entry, digest,
#   constants?}}}. Only kernel/entry/digest/constants of existing keys may change; precision and
# every other manifest field stay byte-for-byte equal in meaning. Optional "addMechanismKernels":
# {"<new key>": {kernel, entry, digest, constants}} adds declared mechanism programs (appended to
# execution.mechanismKernels), for replacement programs selected by declaration. Writes
# <out dir>/variant.json with the base and variant manifest identities and the exact changes.
import hashlib
import json
import os
import sys

base_dir, substitutions_path, out_dir = sys.argv[1:4]
with open(substitutions_path, 'rb') as handle:
    substitutions = json.load(handle)
with open(os.path.join(base_dir, 'manifest.json'), 'rb') as handle:
    base_bytes = handle.read()
manifest = json.loads(base_bytes)
kernels = manifest['inference']['execution']['kernels']
changed = {}
for key, replacement in substitutions['kernels'].items():
    if key not in kernels:
        raise SystemExit(f'unknown execution kernel key {key}')
    if set(replacement) - {'kernel', 'entry', 'digest', 'constants'}:
        raise SystemExit(f'{key}: only kernel, entry, digest and constants may change')
    before = dict(kernels[key])
    after = dict(before)
    for field in ('kernel', 'entry', 'digest'):
        after[field] = replacement[field]
    if 'constants' in replacement:
        after['constants'] = replacement['constants']
    kernels[key] = after
    changed[key] = {'before': before, 'after': after}
added = {}
for key, declaration in substitutions.get('addMechanismKernels', {}).items():
    if key in kernels:
        raise SystemExit(f'{key} already exists')
    if set(declaration) != {'kernel', 'entry', 'digest', 'constants'}:
        raise SystemExit(f'{key}: kernel, entry, digest and constants are required')
    kernels[key] = dict(declaration)
    manifest['inference']['execution']['mechanismKernels'].append(key)
    added[key] = dict(declaration)
os.makedirs(out_dir, exist_ok=False)
for name in os.listdir(base_dir):
    if name != 'manifest.json':
        os.symlink(os.path.join(base_dir, name), os.path.join(out_dir, name))
variant_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
with open(os.path.join(out_dir, 'manifest.json'), 'wb') as handle:
    handle.write(variant_bytes)
with open(os.path.join(out_dir, 'variant.json'), 'w') as handle:
    json.dump({'label': substitutions['label'],
               'baseManifestSha256': 'sha256:' + hashlib.sha256(base_bytes).hexdigest(),
               'variantManifestSha256': 'sha256:' + hashlib.sha256(variant_bytes).hexdigest(),
               'substituted': changed, 'addedMechanismKernels': added}, handle, indent=1)
    handle.write('\n')
print(json.dumps({'out': out_dir, 'changed': list(changed), 'added': list(added)}))
