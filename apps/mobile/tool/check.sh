#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flutter_bin="${FLUTTER_BIN:-flutter}"
flutter_path="$(command -v "$flutter_bin")"
dart_bin="$(dirname "$flutter_path")/dart"
"$flutter_bin" pub get
"$dart_bin" format --output=none --set-exit-if-changed packages app/lib app/test app/integration_test tool
"$flutter_bin" analyze --no-pub
"$dart_bin" run tool/check_boundaries.dart
"$dart_bin" run tool/generate_contract.dart --check
node ../../scripts/sync-mobile-tokens.mjs --check
"$dart_bin" test tool/test --reporter expanded
(cd packages/core && "$dart_bin" test --reporter expanded)
(cd packages/ui && "$flutter_path" test --no-pub --reporter expanded)
(cd app && "$flutter_path" test --no-pub --reporter expanded)
"$dart_bin" run tool/verify_consumer.dart "$flutter_path"
