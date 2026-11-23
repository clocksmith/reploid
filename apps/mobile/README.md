# Reploid mobile

The Reploid requester as a Flutter app: ask an open model that runs on a
participating computer, see which computer will read the prompt before it
is sent, and keep a signed receipt check for every answer. It is the same
product as the web client in `apps/poolday` with a different interface and
rendering surface.

**Status.** The requester protocol is implemented in Dart and tested against
the web client's own code. On macOS the app has asked a real provider over
real signaling and real WebRTC and shown a verified answer; that provider ran
a stand-in model on the same machine. The default build still answers from a
synthetic network inside the app, and says so on screen. Nothing here has run
on a phone, on a simulator, across real networks, or against a computer
serving a real model.

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
had been sent; it is never resumed or resent on its own. Each answer is an
attempt with its own identity, so asking again cannot be overwritten by an
earlier attempt.

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
cd app && flutter run       # the demo network; pick a device with -d
```

`flutter test` in `app`, `packages/ui` or `packages/core` runs one package.
The tests that need the web client's provider code are skipped when Node or
the repository's `node_modules` is missing.

Which network a build uses is fixed at build time:

```sh
flutter run --dart-define=REPLOID_NETWORK=public
flutter run --dart-define=REPLOID_NETWORK=room \
  --dart-define=REPLOID_SIGNALING_URL=ws://127.0.0.1:8000/swarm \
  --dart-define=REPLOID_ROOM=reploid-swarm-example \
  --dart-define=REPLOID_TOKEN=<at least 32 characters>
```

After changing the contract or the model catalog, run
`dart run tool/generate_contract.dart` and commit the result.

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

- Any run on a phone or simulator. The secure key store is untested on a
  device, and iOS and Android have not been built.
- The public network. Relay credentials for computers behind strict
  firewalls are not fetched, so only direct connections are tried.
- Excluding the encrypted history file from device backups. The key is
  never backed up, so a backup alone cannot be read.
- Pairing over real WebRTC and across two rooms on a device; it is tested
  against the web client's desktop code over a text link only.
- Split routes, credits, attachments, file sharing and local models, which
  the web product has and this app does not.
- Recovery of an answer after a lost connection. A lost answer is asked for
  again as a new request.
