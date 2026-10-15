#!/bin/sh
# Precision-recovery session on amd-host: one scratch runtime, two model directories, the harness and
# the configurations. Nothing installed, signed or served is touched.
#   pkg           the frozen faster-candidate runtime archive (Doppler 77c5d9b2, sha256 3b132ee7...),
#                 extracted from the retained copy; every archive member is verified after extraction.
#                 webgpu is symlinked from the installed final-9 tree, as in the earlier sessions.
#   model-paired  the frozen candidate's Capsule manifest 548e6559 (paired kernels), unchanged bytes.
#   model-plain   the reference's own plain manifest edeb69dd (ordinary f32, F16 KV), unchanged bytes.
# Both symlink the same 18 Q4_K weight shards and tokenizer files from the unchanged base directory.
# Piped over ssh: ssh <amd-host> sh -s < setup-amd.sh ; the harness, runner, job lists and
# make-configs.py are copied to $D beforehand.
set -eu
D=/var/tmp/precision-recovery-20261015
ARCHIVE=/var/tmp/faster-candidate-20261015/archive-rolled.tgz
ARCHIVE_SHA=3b132ee7ff984c80ef48487d3010028ade46b64d39323304d674feebfde3bf78
PAIRED_MANIFEST=/var/tmp/faster-candidate-20261015/model-final-3/manifest.json
PAIRED_SHA=548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db
PLAIN_MANIFEST=/var/tmp/plain-profile-reference-20261014/model/manifest.json
PLAIN_SHA=edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9
PAIRED_CONFIG=/var/tmp/qk-norm-graph-20261015/configs/paired-final.json
PAIRED_CONFIG_SHA=17adc85cc9360d1f05a11d6e2cc704592346e3f08afcc9d27b11a82c9b24fd31
BASE=/var/tmp/doppler-cold-compile-model-20261013
INSTALLED=/var/tmp/reploid-signed-completion-9-20261014/reploid/node_modules
test "$(sha256sum $ARCHIVE | cut -d' ' -f1)" = $ARCHIVE_SHA
test "$(sha256sum $PAIRED_MANIFEST | cut -d' ' -f1)" = $PAIRED_SHA
test "$(sha256sum $PLAIN_MANIFEST | cut -d' ' -f1)" = $PLAIN_SHA
test "$(sha256sum $PAIRED_CONFIG | cut -d' ' -f1)" = $PAIRED_CONFIG_SHA
test ! -e $D/pkg
mkdir -p $D/out $D/configs $D/mesa $D/pkg/node_modules/doppler-gpu
cp $ARCHIVE $D/archive.tgz
tar -xzf $D/archive.tgz -C $D/pkg/node_modules/doppler-gpu --strip-components=1
python3 - "$D/archive.tgz" "$D/pkg/node_modules/doppler-gpu" <<'PY'
import hashlib, sys, tarfile, os
archive, root = sys.argv[1:3]
count = 0
with tarfile.open(archive) as t:
    for m in t.getmembers():
        if not m.isfile():
            continue
        rel = m.name.split('/', 1)[1]
        assert hashlib.sha256(t.extractfile(m).read()).hexdigest() == hashlib.sha256(open(os.path.join(root, rel), 'rb').read()).hexdigest(), rel
        count += 1
print(root, 'archive members verified', count)
PY
ln -s $INSTALLED/webgpu $D/pkg/node_modules/webgpu
for pair in "model-paired $PAIRED_MANIFEST" "model-plain $PLAIN_MANIFEST"; do
  set -- $pair
  mkdir -p $D/$1
  cp $2 $D/$1/manifest.json
  for f in $BASE/*; do
    name=$(basename $f)
    test "$name" = manifest.json && continue
    ln -s $f $D/$1/$name
  done
done
cp $PAIRED_CONFIG $D/configs/paired-final.json
python3 $D/make-configs.py $D/configs/paired-final.json $D/model-plain/manifest.json $D/model-paired $D/configs
sha256sum $D/model-*/manifest.json $D/configs/*.json $D/precision-check.mjs
grep '"version"' $D/pkg/node_modules/doppler-gpu/package.json $INSTALLED/webgpu/package.json
echo setup-ok
