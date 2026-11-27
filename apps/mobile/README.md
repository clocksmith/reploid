# Reploid mobile

The Reploid requester as a Flutter app: ask an open model that runs on a
participating computer, see which computer will read the prompt before it
is sent, and keep a signed receipt check for every answer. It is the same
product as the web client in `apps/poolday` with a different interface and
rendering surface.

**Status.** The requester protocol is implemented in Dart and tested against
the web client's own code. On macOS and on an iOS 26 simulator the app has asked
a real provider over real signaling and real WebRTC and shown a verified answer,
and has paired with a provider as the owner's desktop and been answered by it
alone. In those runs the provider ran a stand-in model on the same machine, and
its owner's approval was given by the test. On macOS the default build has also
started with its real Keychain store and private directory and forgotten them
cleanly. The default build starts in the in-app synthetic demo network (and says
so on screen) and can switch at runtime in Settings to the public Reploid network
or a private signaling room, with ephemeral TURN credentials fetched over HTTPS
when configured. `flutter build web` compiles. Nothing here has run on a physical
phone, on Android, across cellular networks, through a real TURN relay, or
against a computer serving a real model.

## How it is put together

This directory is a copy of
[flutter-starter](https://github.com/clocksmith/flutter-starter) at the
revision in `.starter-revision`, and it keeps that starter's rules. The
ownership and lifecycle contract is [docs/architecture.md](docs/architecture.md);
`tool/architecture.json` is the checked dependency policy.

| Location | Owns |
|---|---|
| `packages/core` | Pure Dart session lifecycle, revocable session handles, typed failures, safe diagnostics. Unchanged from the starter. |
| `packages/ui` | Theme, layout and accessible components. The starter's set plus conversation components: thread surface, message bubble, composer, notice, switch row, choice tile, labelled value. |
| `app/lib/features/chat` | Conversations, models, computers and sending: domain, repository, the requester API interface, the synthetic network, and screens. |
| `app/lib/infrastructure/reploid_api` | The requester wire protocol in Dart: canonical JSON, digests, signing identities, and (in progress) the contract engine and transports. |
| `app/lib/infrastructure/identity_store.dart` | Where the device signing key is kept. |
| `app/lib/app`, `app/lib/main.dart` | Bootstrap, providers, session gate and routes. |
| `app/lib/design_system` | Reploid's colours, translated from the web product's tokens. |
| `tool` | Formatting, analysis, boundary checks, tests, independent consumer verification. |

A session is one device signing identity. Start creates it on first use and
keeps it in the platform keystore; Forget this device ends the session and
deletes the key and every conversation.

The phone can be paired with the person's own desktop from a pairing link.
The link is read first and shows which desktop it names; only Connect sends
anything, and the desktop's owner must approve. The pairing pins the
desktop's signing identity: it counts as online only while a connection has
proven that identity, a conversation aimed at it is never answered by
another computer, and an offline desktop is shown as offline. Each
conversation says where it is answered, on the desktop or by contributors,
and only the person changes that.

Conversations are kept on the device, in one file per identity sealed with
AES-256-GCM under a key held in the platform keystore. An answer that was
under way when the app stopped is shown as ended, with whether its prompt
had been sent; it is never resumed or resent on its own. A lost answer can be
asked for from the computer that was running it: nothing is sent or run again,
and what comes back is checked against that computer's signed receipt or
terminal record. Each answer is an attempt with its own identity, so asking
again cannot be overwritten by an earlier attempt.

## One source of truth for the API

The requester wire protocol is defined once, in
`packages/reploid/contracts/requester/` at the repository root, as a
machine-readable contract. Its test vectors, generated from the web client's
own modules, are in `tests/fixtures/requester-conformance/`. The web code is checked against that contract, and this app's
protocol code is tested against the same vectors. A change to the protocol
is a change to the contract first.

## Run and verify

Put Flutter 3.47.5 on `PATH` (the pin is in `.flutter-version`), then from
this directory:

```sh
flutter pub get
bash tool/check.sh          # format, analysis, boundaries, generated code, all tests, consumer
bash tool/e2e_macos.sh      # the app on macOS against a real local provider over WebRTC
bash tool/e2e_macos.sh --pairing   # the same, pairing with it as the owner's desktop
cd app && flutter run       # the demo network; pick a device with -d
```

`flutter test` in `app`, `packages/ui` or `packages/core` runs one package.
The tests that need the web client's provider code are skipped when Node or
the repository's `node_modules` is missing.

The initial network can be fixed at build time (or changed at runtime in
Settings when using the default build):

```sh
flutter run --dart-define=REPLOID_NETWORK=public
flutter run --dart-define=REPLOID_NETWORK=room \
  --dart-define=REPLOID_SIGNALING_URL=ws://127.0.0.1:8000/swarm \
  --dart-define=REPLOID_ROOM=reploid-swarm-example \
  --dart-define=REPLOID_TOKEN=<at least 32 characters>
```

After changing the contract or the model catalog, run
`dart run tool/generate_contract.dart` and commit the result.

### CI

The `mobile` job in Reploid's CI (`.github/workflows/test.yml`) runs
`bash tool/check.sh` on Linux with the Flutter version in `.flutter-version`
on every push to `main` and every pull request. It installs the repository's
Node modules first and sets `REPLOID_MOBILE_REQUIRE_PROVIDER=1`, so the tests
that run the web client's provider code fail instead of skipping when Node or
`node_modules` is missing. It has no path filter: those tests and the
generated contract and token checks read sources outside this directory. It
builds no platform binary; run `tool/e2e_macos.sh` locally for a change to the
transport or the request flow. `npm run lint` also includes `verify:js-only`,
which allows Dart, pub manifests and Flutter's generated runner files only in
this directory. Run `npm run verify:requester-contract` at the repository root
after a change to the contract, its vectors or the web modules they come from;
it is not in CI.

## Releases

`codemagic.yaml` describes three builds: the full check on every pull
request, and unsigned Android and iOS builds that run the same check first.
It has never run on Codemagic. There is no signing, store upload or Shorebird
setup; those need the owner's accounts.

What could ship as a code-push patch later, once Shorebird is set up: changes
to Dart code only (screens, the protocol engine, the generated contract
constants). What needs a new binary: any change to native code or plugins
(the WebRTC and keystore libraries), permissions and usage descriptions in
`Info.plist` or `AndroidManifest.xml`, the Flutter version, and assets.

## Not done

- Any run on a physical phone. Android has never been built: this Mac has no
  Android SDK, and its licences are the owner's to accept.
- Firebase anonymous sign-in for public TURN relay tokens on mobile (the HTTPS
  `/rtc-config` client is implemented and falls back to direct STUN when
  unauthenticated or unconfigured), and any run through a real TURN relay.
- Split routes, credits, file sharing, contribution and local models, which the
  web product has and this app does not. Attachments are text only.
