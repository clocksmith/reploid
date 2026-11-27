# Physical-phone proof: installed build, two networks, authenticated TURN

The checklist for the first qualification of the app on a real phone: an
installed build asks a real model on another computer, the phone and that
computer are on different networks, every byte of the conversation goes
through an authenticated TURN relay, and the answer's signed receipt is
verified on the phone. Until a run of this checklist is recorded, the app is
not qualified on a phone (see the status in [../README.md](../README.md)).

This page is public. Keep tokens, hostnames, addresses, device identifiers
and signing material out of it and out of any receipt committed to this
repository.

## What the build does for this proof

- `--dart-define=REPLOID_NETWORK=public` starts on the public Reploid network
  instead of the in-app demo.
- `--dart-define=REPLOID_AUTH_TOKEN=<Firebase ID token>` is sent as a bearer
  token to the TURN config URL (default: `SignalingConfig.defaultPublicRtcConfigUrl`
  in `app/lib/infrastructure/reploid_api/signaling_config.dart`). The
  service answers only with a valid Firebase ID token, and the app has no
  Firebase sign-in of its own yet, so the token is passed at build time.
- `--dart-define=REPLOID_ICE_POLICY=relay` makes every peer connection
  relay-only (`iceTransportPolicy: relay`). Without TURN credentials nothing
  connects, so an answer under this build cannot have travelled directly.
- `--dart-define=REPLOID_TRACE=true` prints connection steps to the device
  log, prefixed `transport:`. They contain counts, states and candidate types,
  never prompts, addresses or credentials.

## Before you start

1. A computer that serves a real model on the public network: open the
   Reploid web app on it, contribute, and load a model until it shows as
   ready. Note the first characters of its signing identity as shown there.
   Keep it on its usual network (for example home Wi-Fi).
2. The phone on a different network: cellular with Wi-Fi off. For a second
   pair of networks, repeat later on another Wi-Fi (not the computer's).
3. Flutter 3.47.5 (`apps/mobile/.flutter-version`) on `PATH`, and from the
   repository root `npm ci` then `bash apps/mobile/tool/check.sh` passing on
   the commit you build.
4. A fresh Firebase ID token for the Reploid project, at most one hour old
   when you build and run (Firebase ID tokens expire after an hour; after that
   the app cannot fetch new TURN credentials and the relay-only build stops
   connecting). One way, with the public web API key from
   `shared/config/firebase-public.json`, is an anonymous sign-up:

   ```sh
   key=$(node -p "require('./shared/config/firebase-public.json').apiKey")
   token=$(curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"returnSecureToken":true}' \
     "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=$key" \
     | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).idToken")
   ```

   If the answer is an `API_KEY_HTTP_REFERRER_BLOCKED` error, add
   `-H 'Referer: <the Reploid web origin>/'`. If anonymous sign-in is refused, take the ID token from
   a signed-in Reploid web session instead. Do not paste the token into a
   file in this repository or into a shared log.

The proof build carries the token inside the app binary. Treat that build as
private: install it only on your own phone and delete it after the run.

## Build and install

Common flags (from `apps/mobile/app`):

```sh
cd apps/mobile/app
defines=(
  --dart-define=REPLOID_NETWORK=public
  --dart-define=REPLOID_ICE_POLICY=relay
  --dart-define=REPLOID_TRACE=true
  --dart-define=REPLOID_AUTH_TOKEN="$token"
)
```

**Android** (needs the Android SDK and accepted licences; USB debugging on):

```sh
flutter build apk --release "${defines[@]}"
adb install -r build/app/outputs/flutter-apk/app-release.apk
adb logcat -c && adb logcat | grep 'transport:'
```

Without a release keystore configured the release APK is signed with the
local debug key, which is enough for a sideloaded proof.

**iOS** (needs Xcode, CocoaPods and your Apple team selected for the Runner
target in `ios/Runner.xcworkspace`; developer mode on the phone):

```sh
flutter devices                       # find the phone's device id
flutter run --release -d <device-id> "${defines[@]}"
```

`flutter run` installs the app and streams its log; keep that terminal open,
or read the log in Xcode's Devices and Simulators console filtered on
`transport:`. After the first install, disconnect the cable and reopen the
app from the home screen for the real run, so the phone is not tethered to
the Mac's network.

## Run

1. Confirm the phone has no Wi-Fi and the computer is on its own network.
2. Open the app, tap Start. It must not say demo network.
3. Wait until it shows Online; in Computers, find the serving computer and
   check its identity matches the one you noted.
4. Start a new chat aimed at that computer (or let it pick one, then check
   who answered), send a short prompt and wait for the full answer.
5. Open the answer's Details.
6. Repeat once after switching the phone to the second network (fully quit
   and reopen the app first).

## What to record

From the screen, for each run (a screenshot of each is enough):

- The answer line `Answered by <id> (<model>), signed receipt verified`, with
  `<id>` matching the serving computer.
- In Details: `Signed receipt: Verified on this device` and
  `Prompt left this device: Yes`.

From the log (`transport:` lines), in this order:

- `rtc-config: TURN credentials, <n> ICE servers`. If it says
  `no TURN credentials`, the token was missing, invalid or expired, or the
  service had no TURN configured: stop, the run proves nothing.
- `ice policy relay`.
- `ice RTCIceConnectionStateConnected` (or `Completed`).
- `selected pair: local relay/<protocol> via <udp|tcp|tls>, remote ...`. The
  local candidate type must be `relay`. A `host`, `srflx` or `prflx` local
  type means the relay-only policy did not take effect; that run fails.

Also record: the Reploid commit you built, the Flutter version, the phone
model and OS version, which build (Android or iOS), the two networks by kind
only (for example "cellular" and "office Wi-Fi"), the serving computer's
model, and the UTC time of each run. Keep raw logs private; commit only the
lines above with any addresses removed.

## Pass and fail

The proof passes when, on an installed release build with no cable, on at
least two phone networks different from the serving computer's, every run
shows the relay candidate, TURN credentials fetched with the token, the
expected computer answering, and a verified signed receipt. Anything else,
including an answer that arrives without the relay lines, is a failed run;
record it as such rather than retrying until it passes.
