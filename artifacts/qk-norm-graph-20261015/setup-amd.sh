#!/bin/sh
# Q/K head-norm graph session on amd-host: two scratch package roots and three model directories.
#   pkg-control  the frozen candidate archive (Doppler 77c5d9b2, sha256 3b132ee7...), extracted again
#                from the retained copy so this session owns its tree;
#   pkg-new      the Q/K head-norm graph archive (this change's local commit; sha256 passed as $1,
#                copied beforehand to $D/archive.tgz).
# Every archive member is verified against the extracted file. webgpu is symlinked from the installed
# final-9 tree, as in the earlier sessions. Models come from make-qk-model.py over the candidate manifest
# (548e6559...) and the unchanged base weights; the placement C install and its units are not touched.
# Piped over ssh: ssh <amd-host> sh -s <new archive sha256> < setup-amd.sh
set -eu
NEW_SHA=$1
D=/var/tmp/qk-norm-graph-20261015
CONTROL_ARCHIVE=/var/tmp/faster-candidate-20261015/archive-rolled.tgz
CONTROL_SHA=3b132ee7ff984c80ef48487d3010028ade46b64d39323304d674feebfde3bf78
CANDIDATE_MANIFEST=/var/tmp/faster-candidate-20261015/model-final-3/manifest.json
BASE=/var/tmp/doppler-cold-compile-model-20261013
INSTALLED=/var/tmp/reploid-signed-completion-9-20261014/reploid/node_modules
test "$(sha256sum $D/archive.tgz | cut -d' ' -f1)" = "$NEW_SHA"
test "$(sha256sum $CONTROL_ARCHIVE | cut -d' ' -f1)" = $CONTROL_SHA
test "$(sha256sum $BASE/manifest.json | cut -d' ' -f1)" = 6b2cb026e6cd17469ad18fd5253e5e413313fc42756955544181190796c9e934
test ! -e $D/pkg-new && test ! -e $D/pkg-control
mkdir -p $D/out $D/configs
cp $CONTROL_ARCHIVE $D/archive-control.tgz
for pair in "pkg-control archive-control.tgz" "pkg-new archive.tgz"; do
  set -- $pair
  mkdir -p $D/$1/node_modules/doppler-gpu
  tar -xzf $D/$2 -C $D/$1/node_modules/doppler-gpu --strip-components=1
  python3 - "$D/$2" "$D/$1/node_modules/doppler-gpu" <<'PY'
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
  ln -s $INSTALLED/webgpu $D/$1/node_modules/webgpu
done
for mode in legacy shipped sliced; do
  python3 $D/make-qk-model.py $CANDIDATE_MANIFEST $BASE $mode $D/model-$mode
done
test "$(sha256sum $D/model-legacy/manifest.json | cut -d' ' -f1)" = 548e65597f85e190d6f0edf38c63569b872a61696c28ec95dce031f913e953db
cp /var/tmp/faster-candidate-20261015/configs/paired-final.json $D/configs/paired-final.json
sha256sum $D/configs/paired-final.json $D/model-*/manifest.json
grep '"version"' $D/pkg-new/node_modules/doppler-gpu/package.json $D/pkg-control/node_modules/doppler-gpu/package.json $INSTALLED/webgpu/package.json
echo setup-ok
