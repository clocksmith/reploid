"""Isolated candidate extraction install on amd-host; not signed application qualification.
Adapted from Doppler artifacts/kernel-completion-repair-20261013/install-native-candidate.py.
Differences: the parent is the campaign 2/3 installed native app
(/var/tmp/reploid-completion-candidate-20261013/installed/reploid, native delivery 04a5cf0c...),
the fixture root is /var/tmp/reploid-faster-candidate-20261015 (copied from mac-host and verified
against its snapshot binding first), and the archive is 21d054ee... (Doppler 1c9ec3db). Delivery
entries under node_modules/doppler-gpu are refused, because the runtime is verified against the
archive separately. Generation 2 installs into /var/tmp/reploid-faster-candidate-20261015-2 (see
prepare-fixture.py) with that root's binding hash as the second argument.
Generation 3 (the rolled variant) installs runtime archive 3b132ee7... (1,999 members) into root -3.
Usage: python3 install-native.py [1 | 2 <binding sha256> | 3 <binding sha256>]"""
from pathlib import Path
import json, hashlib, base64, shutil, tarfile, sys

old = Path('/var/tmp/reploid-completion-candidate-20261013/installed/reploid')
GENERATION = sys.argv[1] if len(sys.argv) > 1 else '1'
root = Path('/var/tmp/reploid-faster-candidate-20261015' + {'1': '', '2': '-2', '3': '-3'}[GENERATION]); app = root / 'installed/reploid'
ARCHIVE, MEMBERS = ('3b132ee7ff984c80ef48487d3010028ade46b64d39323304d674feebfde3bf78', 1999) if GENERATION == '3' else ('21d054eeb70212a7434c9eccfe467fe0accbb8685e9358f2b72341500978cd5f', 1998)
BINDING = '678e50f27cf751932e78f9eb36662611e7fe5c50cd1c244d9b2300bd7f2d1895' if GENERATION == '1' else sys.argv[2]
sha = lambda b: hashlib.sha256(b).hexdigest()
assert not app.exists(), 'Never overwrite an installed candidate'
binding_bytes = (root / 'snapshot-binding.json').read_bytes(); assert sha(binding_bytes) == BINDING
for row in json.loads(binding_bytes)['files']:
    assert sha((root / row['path']).read_bytes()) == row['sha256'], row['path']
original = (old / 'native-delivery.json').read_bytes()
assert sha(original) == '04a5cf0c4da08c88c52fa51ed6ad9f9cbc9b6c09c008eecb7cf9afee1016110e'
delivery = json.loads(original)
for row in delivery['entries']:
    assert not row['path'].startswith('node_modules/doppler-gpu/'), row['path']
    assert sha((old / row['path']).read_bytes()) == row['sha256']
archive = root / 'archive.tgz'; raw = archive.read_bytes(); assert sha(raw) == ARCHIVE
integrity = 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()
shutil.copytree(old, app, symlinks=False)
(app / 'deploy/artifacts/doppler-gpu-0.6.28.tgz').write_bytes(raw)
pin_path = app / 'self/config/doppler-package.json'; pin = json.loads(pin_path.read_text())
pin['integrity'] = integrity
if 'sha256' in pin: pin['sha256'] = sha(raw)
pin_path.write_text(json.dumps(pin, indent=2) + '\n')
lock_path = app / 'package-lock.json'; lock = json.loads(lock_path.read_text()); lock['packages']['node_modules/doppler-gpu']['integrity'] = integrity
lock_path.write_text(json.dumps(lock, indent=2) + '\n')
runtime = app / 'node_modules/doppler-gpu'; shutil.rmtree(runtime); runtime.mkdir()
count = 0
with tarfile.open(archive) as t:
    for m in t.getmembers():
        p = Path(m.name); assert p.parts[0] == 'package' and '..' not in p.parts
        if m.isdir(): continue
        assert m.isfile(); dest = runtime / Path(*p.parts[1:]); dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(t.extractfile(m).read()); count += 1
assert count == MEMBERS
delivery['runtime']['integrity'] = integrity
for row in delivery['entries']:
    data = (app / row['path']).read_bytes(); row['sha256'] = sha(data)
    if 'bytes' in row: row['bytes'] = len(data)
    if 'sizeBytes' in row: row['sizeBytes'] = len(data)
(app / 'native-delivery.json').write_text(json.dumps(delivery, indent=2) + '\n')
config = {'applicationDirectory': str(app), 'nativeDeliverySha256': sha((app / 'native-delivery.json').read_bytes()),
          'providerModule': 'webgpu', 'testDelivery': {'root': str(root), 'bindingPath': str(root / 'snapshot-binding.json'),
          'bindingSha256': BINDING, 'archivePath': str(archive)}}
(root / 'startup-config.json').write_text(json.dumps(config, indent=2) + '\n')
receipt = {'schema': 'doppler.candidate-extraction-install/v1', 'method': 'Verified archive extraction; original application/native provider files retained',
           'parentNativeDeliverySha256': sha(original), 'runtimeArchiveSha256': ARCHIVE, 'runtimeFiles': count, 'startupConfig': config,
           'signedApplicationQualified': False, 'publicPackageChanged': False}
(root / 'installed-candidate.json').write_text(json.dumps(receipt, indent=2) + '\n'); print(json.dumps(receipt))
