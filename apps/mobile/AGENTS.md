# Reploid mobile

The repository's [AGENTS.md](../../AGENTS.md) applies. This file adds what is
specific to the Flutter app.

- This is flutter-starter adopted as is. Follow
  [docs/architecture.md](docs/architecture.md); `tool/architecture.json` is the
  checked policy. Do not add exemptions to make a check pass.
- `packages/core` is pure Dart. `packages/ui` holds every visual decision;
  feature presentation composes ui components and imports no visual symbols.
- The wire protocol has one definition:
  `packages/reploid/contracts/requester/` at the repository root. Change
  the contract and its vectors first, then this app's protocol code. Never
  hand-copy a constant or message shape that the contract already states.
- A prompt may leave the device only after the recipient has proven its
  signing identity and admitted the request. Tests assert that order.
- Never put prompts, answers, keys or identifiers in diagnostics.
- Keep the README honest about what has not run on a device.
- Run the touched package's tests; run `bash tool/check.sh` before a commit
  that crosses packages or changes `tool/`.
