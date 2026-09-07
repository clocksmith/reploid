"""Restore the exact signed model using retained metadata and verified local weights."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('bundle', type=Path)
parser.add_argument('converted_model', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
retained = args.bundle.resolve() / 'capsule' / 'distribution'
capsule_bytes = (retained / 'capsule.json').read_bytes()
capsule = json.loads(capsule_bytes)
sources = []
for artifact in capsule['artifacts']:
    relative = PurePosixPath(artifact['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    source = retained / artifact['path']
    if not source.exists():
        assert artifact['role'] in ['weight-shard', 'tokenizer']
        source = args.converted_model.resolve() / relative.name
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    assert source.stat().st_size == artifact['sizeBytes'], artifact['artifactId']
    assert f'sha256:{digest.hexdigest()}' == artifact['hash'], artifact['artifactId']
    sources.append((relative, source.resolve()))
args.destination.mkdir()  # All dependencies passed before creating the new directory.
(args.destination / 'capsule.json').write_bytes(capsule_bytes)
for relative, source in sources:
    target = args.destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(source)
print(f'Restored {len(sources)} verified dependencies without copying model weights.')
