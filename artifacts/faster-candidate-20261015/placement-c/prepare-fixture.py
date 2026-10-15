"""Faster candidate: a separate immutable numerical fixture delivery; never mutate its parent.
Adapted from Doppler artifacts/kernel-completion-repair-20261013/prepare-candidate-fixture.py.
Differences:
- parent is the campaign 2/3 fixture (/var/tmp/reploid-completion-candidate-20261013, binding 3f6d98a0...);
- the runtime archive is 21d054ee... (Doppler 1c9ec3db, npm pack). Its 1,998 members replace the
  parent's vendored 0.6.28 runtime entirely (the parent's runtime files are not copied, so no stale
  member survives);
- the model manifest is the combined kernel variant 64d74719... (the Capsule manifest 6b2cb026...
  with only the declared execution kernels changed), and execution.json is that manifest's
  inference.execution, serialized as the parent's was;
- paired-binding.json names the new archive, manifest and graph; its representation is unchanged.
Generation 2 (argument 2): the same, with manifest c6220c6a... (64d74719... plus the declared Q/K head-norm
program, rmsnorm_paired, as a mechanism kernel; final-10 attempt 1 found it missing from the signed closure)
into a new root /var/tmp/reploid-faster-candidate-20261015-2.
Generation 3: the rolled recurrent-state variant for the variant comparison: runtime archive 3b132ee7...
(Doppler 77c5d9b2, 1,999 members) and manifest 548e6559... (c6220c6a... with paired_state_sliced replaced by
paired_state_sliced_rolled) into /var/tmp/reploid-faster-candidate-20261015-3.
Usage: python3 prepare-fixture.py <1|2|3>"""
from pathlib import Path
import json, hashlib, tarfile, sys

old = Path('/var/tmp/reploid-completion-candidate-20261013')
GENERATION = sys.argv[1] if len(sys.argv) > 1 else '1'
new, model, MANIFEST = {
  '1': (Path('/var/tmp/reploid-faster-candidate-20261015'), Path('/var/tmp/doppler-faster-model-20261015/manifest.json'),
        '64d747193bd983feb3d25eea6227284c6e979ea35c7cb874a3b0a0a582c2acbd'),
  '2': (Path('/var/tmp/reploid-faster-candidate-20261015-2'), Path('/var/tmp/doppler-faster-model-20261015-2/manifest.json'),
        'c6220c6aefef7006aa2b3bc3c89932d61788340597c9abf055d27e8cdd1767fd'),
  '3': (Path('/var/tmp/reploid-faster-candidate-20261015-3'), Path('/var/tmp/doppler-faster-model-20261015-3/manifest.json'),
        '548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db')}[GENERATION]
archive, ARCHIVE, MEMBERS = (Path('/var/tmp/doppler-faster-candidate-20261015-rolled/doppler-gpu-0.6.28.tgz'),
  '3b132ee7ff984c80ef48487d3010028ade46b64d39323304d674feebfde3bf78', 1999) if GENERATION == '3' else (
  Path('/var/tmp/doppler-faster-candidate-20261015/doppler-gpu-0.6.28.tgz'), '21d054eeb70212a7434c9eccfe467fe0accbb8685e9358f2b72341500978cd5f', 1998)
RUNTIME = 'vendor/doppler/0.6.28/'
sha = lambda b: hashlib.sha256(b).hexdigest()
parent_bytes = (old / 'snapshot-binding.json').read_bytes()
assert sha(parent_bytes) == '3f6d98a0dbf9f83a11e87f28b6483291618c9073756604b5e6e3c609736ecdf6'
parent = json.loads(parent_bytes)
assert not new.exists(), 'Never overwrite an existing candidate delivery'
raw = archive.read_bytes(); assert sha(raw) == ARCHIVE
manifest_bytes = model.read_bytes(); assert sha(manifest_bytes) == MANIFEST
manifest = json.loads(manifest_bytes)
graph_bytes = (json.dumps(manifest['inference']['execution'], indent=2) + '\n').encode()
replaced = {'archive.tgz': raw, 'manifest.json': manifest_bytes, 'execution.json': graph_bytes}
new.mkdir()
kept = []
for row in parent['files']:
    path = Path(row['path']); assert not path.is_absolute() and '..' not in path.parts
    if row['path'].startswith(RUNTIME):
        continue
    data = (old / path).read_bytes(); assert sha(data) == row['sha256'], str(path)
    (new / path).parent.mkdir(parents=True, exist_ok=True)
    (new / path).write_bytes(replaced.get(row['path'], data))
    kept.append(row['path'])
for name in replaced: assert name in kept, name
runtime = []
with tarfile.open(archive) as t:
    for member in t.getmembers():
        path = Path(member.name); assert path.parts[0] == 'package' and '..' not in path.parts
        if member.isdir(): continue
        assert member.isfile()
        rel = RUNTIME + str(Path(*path.parts[1:]))
        target = new / rel; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(t.extractfile(member).read()); runtime.append(rel)
assert len(runtime) == MEMBERS
paired = json.loads((old / 'paired-binding.json').read_text())
paired.update({'archiveSha256': ARCHIVE, 'immediateParentManifestSha256': paired['manifestSha256'],
               'manifestSha256': MANIFEST, 'graphSha256': sha(graph_bytes),
               'sourceConstruction': ('Doppler 77c5d9b2 npm pack (archive 3b132ee7...); ' if GENERATION == '3' else 'Doppler 1c9ec3db npm pack (archive 21d054ee...); ') + 'manifest ' + MANIFEST[:8] + '... is the Capsule manifest 6b2cb026... with the attention, norm, projection and head programs replaced and the sliced state and parallel Q/K mechanism programs declared (reploid artifacts/paired-kernel-optimization-20261014/final-substitution.json)' + ('' if GENERATION == '1' else ', plus the shipped rmsnorm_paired program declared as mechanism kernel paired_qk_head_norm for the Q/K head norms (reploid artifacts/faster-candidate-20261015/numerical/final-substitution-2.json)') + ('' if GENERATION != '3' else ', with the rolled sliced state program (paired_state_sliced_rolled) in place of the unrolled one (final-substitution-3-rolled.json)') + '.',
               'qualified': False})
(new / 'paired-binding.json').write_text(json.dumps(paired, indent=2) + '\n')
binding = {**parent, 'dopplerCommit': '77c5d9b2' if GENERATION == '3' else '1c9ec3db', 'parentSnapshotSha256': sha(parent_bytes), 'archiveSha256': ARCHIVE,
           'files': [{'path': p, 'sha256': sha((new / p).read_bytes())} for p in kept + runtime]}
(new / 'snapshot-binding.json').write_text(json.dumps(binding, indent=2) + '\n')
config = json.loads((old / 'config-preparation.json').read_text().replace(str(old), str(new)))
config['model']['identity'] = 'sha256:' + MANIFEST
for field in ['archive', 'manifest', 'graph', 'pairedBinding', 'delivery']:
    config[field]['hash'] = 'sha256:' + sha(Path(config[field]['path']).read_bytes())
(new / 'config-preparation.json').write_text(json.dumps(config, indent=2) + '\n')
print(json.dumps({'root': str(new), 'archiveSha256': ARCHIVE, 'manifestSha256': MANIFEST, 'graphSha256': sha(graph_bytes),
                  'bindingSha256': sha((new / 'snapshot-binding.json').read_bytes()), 'files': len(binding['files']),
                  'runtimeFiles': len(runtime)}))
