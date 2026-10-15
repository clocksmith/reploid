#!/bin/sh
# final-10 export pipeline, scripted from the steps attempt 1 ran by hand (attempt-1/*.json and *.txt record
# them; the same steps as signed-completion-candidate-20261013/final-9). Exports Reploid <commit>, installs
# the candidate runtime archive 21d054ee..., runs the vendor/contract/library/runtime syncs with the recorded
# scope step, prepares the signed catalog for <capsule dir> with minimum release sequence <min>, then (after
# the separate preflight) stages metadata and packages hosting and native deliveries.
# Usage: build-export.sh <export dir (new)> <commit> <capsule dir> <reports dir> <min sequence> <receipt dir> <phase> <archive> <archive sha256>
#   (pass 3 adds the archive arguments: 3b132ee7..., Doppler 77c5d9b2; passes 1 and 2 used 21d054ee...)
#   phase 1 (export and syncs):        build-export.sh ... prepare
#   phase 2 (signed catalog):          build-export.sh ... catalog
#   phase 3 (staging and packaging):   build-export.sh ... package
set -eu
X=$1; COMMIT=$2; CAPSULE=$3; REPORTS=$4; MIN=$5; R=$6; PHASE=$7; ARCHIVE=${8:-/var/tmp/doppler-faster-candidate-20261015/doppler-gpu-0.6.28.tgz}
ARCHIVE_SHA=${9:-21d054eeb70212a7434c9eccfe467fe0accbb8685e9358f2b72341500978cd5f}
REPO=/Users/xyz/deco/reploid
test "$(shasum -a 256 $ARCHIVE | cut -d' ' -f1)" = "$ARCHIVE_SHA"
if [ "$PHASE" = prepare ]; then
  test ! -e "$X"; mkdir -p "$X/app" "$X/signed-catalog" "$R"
  git -C $REPO archive --format=tar "$COMMIT" -- . ':(exclude)artifacts' ':(exclude)reports' ':(exclude)doppler' > "$X/source.tar"
  tar -xf "$X/source.tar" -C "$X/app"
  cp -c -R /var/tmp/reploid-signed-completion-app-9-20261014/app/node_modules "$X/app/node_modules"
  cp $ARCHIVE "$X/app/deploy/artifacts/doppler-gpu-0.6.28.tgz"
  cd "$X/app"
  npm install --save-exact --ignore-scripts --no-audit --no-fund file:deploy/artifacts/doppler-gpu-0.6.28.tgz > "$R/install.txt" 2>&1
  node scripts/vendor-doppler.js deploy/artifacts/doppler-gpu-0.6.28.tgz > "$R/vendor.txt" 2>&1
  node scripts/sync-doppler-generation-contract.js > "$R/generation-sync.txt" 2>&1
  node scripts/sync-doppler-partition-contract.js > "$R/partition-sync.txt" 2>&1
  node scripts/sync-reploid-library.js > "$R/library-sync.txt" 2>&1
  node scripts/sync-runtime-config.js > "$R/runtime-check-before-scope.txt" 2>&1 && exit 3 || true
  node $REPO/artifacts/signed-completion-candidate-20261013/final/scope-export.js "$X/app" "$R/scope.json"
  node scripts/sync-runtime-config.js --write > "$R/runtime-sync.txt" 2>&1
  shasum -a 256 "$X/source.tar"
elif [ "$PHASE" = catalog ]; then
  cd $REPO
  node artifacts/signed-completion-candidate-20261013/final/prepare-catalog.js "$CAPSULE" "$X/app/node_modules/doppler-gpu" \
    "$REPORTS/partition-0.json,$REPORTS/partition-1.json,$REPORTS/partition-2.json" \
    /var/tmp/reploid-faster-candidate-20261015/approved-reference.json http://127.0.0.1:29670/qualification/capsule/ \
    "$X/signed-catalog/chat-models.json" 8,16 "$MIN" > "$R/catalog-preparation.json" 2> "$R/catalog-preparation.stderr.txt"
  shasum -a 256 "$X/signed-catalog/chat-models.json"
elif [ "$PHASE" = package ]; then
  CAT=$X/signed-catalog/chat-models.json; H=$(shasum -a 256 "$CAT" | cut -d' ' -f1)
  cd $REPO && node artifacts/basic-signed-candidate-20261013/final/stage-catalog.js "$X/app" "$CAPSULE" "$CAT" "$H" "$R/metadata-staging.json"
  cd "$X/app"
  node scripts/sync-runtime-config.js --write > "$R/final-runtime-sync.txt" 2>&1
  node scripts/build-module-inventory.js > "$R/final-inventory.txt" 2>&1
  node scripts/build-vfs-manifest.js > "$R/final-vfs.txt" 2>&1
  node scripts/build-browser-bundle-manifest.js > "$R/final-browser-manifest.txt" 2>&1
  npm run prepare:hosting > "$R/final-hosting.txt" 2>&1
  npm run package:native > "$R/final-native-package.txt" 2>&1
  cat "$R/final-browser-manifest.txt"; tail -7 "$R/final-native-package.txt"
else
  exit 2
fi
