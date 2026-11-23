#!/usr/bin/env bash
# Runs the app on macOS against a real local provider: the web client's
# signaling server and native participant with a stub model, over real
# WebRTC. Needs Node with the repository's node_modules, Xcode and CocoaPods.
set -euo pipefail
cd "$(dirname "$0")/.."
root="$(cd ../.. && pwd)"
flutter_bin="${FLUTTER_BIN:-flutter}"
log="$(mktemp)"
node "$root/tests/fixtures/requester-conformance/webrtc-provider.js" "$@" >"$log" 2>/dev/null &
provider=$!
trap 'kill "$provider" 2>/dev/null || true; rm -f "$log"' EXIT
for _ in $(seq 1 100); do
  [ -s "$log" ] && break
  sleep 0.1
done
[ -s "$log" ] || { echo "The provider did not start" >&2; exit 1; }
read_field() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").split("\n")[0]);const v=process.argv[2].split(".").reduce((o,k)=>o[k],r);process.stdout.write(Array.isArray(v)?v.map(s=>s.urls||s).flat().join(","):String(v))' "$log" "$1"; }
ice="$(read_field iceServers)"
cd app
"$flutter_bin" test integration_test/real_webrtc_test.dart -d macos \
  --dart-define=REPLOID_NETWORK=room \
  --dart-define=REPLOID_TRACE="${REPLOID_TRACE:-false}" \
  --dart-define=REPLOID_SIGNALING_URL="$(read_field wsUrl)" \
  --dart-define=REPLOID_ROOM="$(read_field roomId)" \
  --dart-define=REPLOID_TOKEN="$(read_field token)" \
  --dart-define=REPLOID_ORIGIN="$(read_field origin)" \
  --dart-define=REPLOID_ICE="${ice:-}" \
  --dart-define=REPLOID_EXPECT_ANSWER="$(read_field answer.content)" \
  --dart-define=REPLOID_EXPECT_PROVIDER="$(read_field provider.participantId)"
