# Reploid mobile

The Reploid requester as a Flutter app: ask an open model that runs on a
participating computer, see which computer will read the prompt before it
is sent, and keep a signed receipt check for every answer. It is the same
product as the web client in `apps/poolday` with a different interface and
rendering surface.

**Status.** The app runs end to end against a synthetic network that lives
inside the app, and every screen says so. The adapter that reaches real
computers is being built against the shared requester contract; until it
lands, no prompt leaves the device. Nothing here has run on a physical
phone.

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
bash tool/check.sh          # format, analysis, boundaries, all tests, consumer
cd app && flutter run       # pick a device with -d
```

`flutter test` in `app`, `packages/ui` or `packages/core` runs one package.

## Not done

- The real-network adapter (signaling, WebRTC, the contract engine).
- Any run on a physical phone or simulator; the secure key store and
  WebRTC are untested on devices.
- Durable conversations. They are lost when the app closes.
- Split routes, credits, owner pairing and local models, which the web
  product has and this app does not.
