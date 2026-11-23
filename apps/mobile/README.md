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
keeps it in the platform keystore; Forget this device ends the session,
deletes the key and clears every conversation. Conversations are held in
memory only.

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

## Not done

- Any run on a phone or simulator. The secure key store is untested on a
  device, and iOS and Android have not been built.
- The public network. Relay credentials for computers behind strict
  firewalls are not fetched, so only direct connections are tried.
- Durable conversations. They are lost when the app closes.
- Pairing with your own desktop, split routes, credits, attachments, file
  sharing and local models, which the web product has and this app does not.
- Recovery of an answer after a lost connection. A lost answer is asked for
  again as a new request.
