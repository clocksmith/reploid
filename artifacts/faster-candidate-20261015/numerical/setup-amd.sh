#!/bin/sh
# Faster candidate, whole-model numerical session on amd-host: install the frozen runtime archive
# (Doppler 1c9ec3db, npm pack, sha256 21d054ee...) into a scratch package root, build the combined
# kernel variant model (manifest 64d74719...) beside the unchanged Capsule model, and record both.
# Piped over ssh with the archive already copied to $D/archive.tgz:
#   ssh <amd-host> sh -s < setup-amd.sh
set -eu
D=/var/tmp/faster-candidate-20261015
ARCHIVE_SHA=21d054eeb70212a7434c9eccfe467fe0accbb8685e9358f2b72341500978cd5f
BASE=/var/tmp/doppler-cold-compile-model-20261013
INSTALLED=/var/tmp/reploid-signed-completion-9-20261014/reploid/node_modules
test "$(sha256sum $D/archive.tgz | cut -d' ' -f1)" = $ARCHIVE_SHA
test "$(sha256sum $BASE/manifest.json | cut -d' ' -f1)" = 6b2cb026e6cd17469ad18fd5253e5e413313fc42756955544181190796c9e934
test ! -e $D/pkg
mkdir -p $D/pkg/node_modules/doppler-gpu $D/out $D/configs
tar -xzf $D/archive.tgz -C $D/pkg/node_modules/doppler-gpu --strip-components=1
# Every archive member must equal the extracted file.
python3 - "$D/archive.tgz" "$D/pkg/node_modules/doppler-gpu" <<'PY'
import hashlib, sys, tarfile, os
archive, root = sys.argv[1:3]
count = 0
with tarfile.open(archive) as t:
    for m in t.getmembers():
        if not m.isfile():
            continue
        rel = m.name.split('/', 1)[1]
        a = hashlib.sha256(t.extractfile(m).read()).hexdigest()
        b = hashlib.sha256(open(os.path.join(root, rel), 'rb').read()).hexdigest()
        assert a == b, rel
        count += 1
print('archive members verified', count)
PY
ln -s $INSTALLED/webgpu $D/pkg/node_modules/webgpu
python3 $D/make-variant-model.py $BASE $D/final-substitution.json $D/model-final
test "$(sha256sum $D/model-final/manifest.json | cut -d' ' -f1)" = 64d747193bd983feb3d25eea6227284c6e979ea35c7cb874a3b0a0a582c2acbd
grep '"version"' $D/pkg/node_modules/doppler-gpu/package.json $INSTALLED/webgpu/package.json
echo setup-ok
