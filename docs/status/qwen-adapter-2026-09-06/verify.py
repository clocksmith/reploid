"""Verify the retained archive; optionally extract into a new directory."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--extract', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
index = json.loads((root / 'index.json').read_text())
archive = (root / index['archive']['file']).read_bytes()
assert len(archive) == index['archive']['sizeBytes']
assert hashlib.sha256(archive).hexdigest() == index['archive']['sha256']
expected = {row['path']: row for row in index['files']}
verified = {}
with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
    for member in source.getmembers():
        name = PurePosixPath(member.name)
        assert member.isfile() and not name.is_absolute() and '..' not in name.parts
        assert member.name in expected and member.name not in verified
        row = expected[member.name]
        assert member.size == row['sizeBytes']
        data = source.extractfile(member).read()
        assert hashlib.sha256(data).hexdigest() == row['sha256'], member.name
        verified[member.name] = data
assert verified.keys() == expected.keys()
if args.extract:
    args.extract.mkdir()  # Refuse to overwrite an existing reproduction.
    for name, data in verified.items():
        target = args.extract / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
print(f'Verified {len(verified)} files; archive SHA-256 {index["archive"]["sha256"]}')
