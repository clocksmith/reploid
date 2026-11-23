# Requester contract

`requester-contract.json` is the wire protocol a public requester speaks to send
one whole-model text request to a provider and verify the answer. It is the
authority for that protocol: signaling frames, the data-channel envelope, every
message a requester sends or receives, the objects inside them, the procedures
(canonical JSON, hashing, signatures, identity proof, prompt commitment, privacy
binding, receipt checks), the order of one request, and what each failure means
for the user.

The web client and the mobile client are two interfaces over this one protocol.
The web code is checked against the contract; the mobile code is written and
tested from it.

## Files

| File | What it is |
| --- | --- |
| `requester-contract.json` | The contract. Edited by hand. |
| [`tests/fixtures/requester-conformance/vectors.json`](../../../../tests/fixtures/requester-conformance/vectors.json) | Test vectors. Generated from the real JavaScript modules; never edited. They sit with the test fixtures because they hold test private keys. |
| [`scripts/build-requester-contract-vectors.js`](../../../../scripts/build-requester-contract-vectors.js) | Builds `vectors.json`. |
| [`scripts/verify-requester-contract.js`](../../../../scripts/verify-requester-contract.js) | Checks the contract against the code. |
| [`scripts/requester-contract/`](../../../../scripts/requester-contract/) | Shared pieces: fixed test inputs, the capture harness, the schema validator. |
| [`tests/fixtures/requester-conformance/`](../../../../tests/fixtures/requester-conformance/) | Providers a client in another language can test against. |
| [`tests/unit/requester-contract.test.js`](../../../../tests/unit/requester-contract.test.js) | Runs the verifier and the stdio provider under vitest. |

## Reading the contract

- `constants` holds every number, name and address. `sources` says which file and
  JSON pointer or symbol each one comes from.
- `signalingMessages` and `channelMessages` give a JSON Schema (draft 2020-12)
  per message type. `envelope` wraps every data-channel message. `objects` holds
  the shared schemas. A `$ref` is a JSON pointer from the root of the contract.
- `additionalProperties: false` means the current code never sends other
  members. `additionalProperties: true` marks a free-form object. Where the
  keyword is absent, a receiver must accept and ignore unknown members.
- `x-signedPayloadFields` on a schema lists the members a signature covers.
- `procedures` are language-neutral steps. `sequence` is one request from
  opening the socket to the countersigned receipt. `failures` maps each error
  text to whether the prompt was sent.
- The schemas use only: `$ref`, `type`, `enum`, `const`, `properties`,
  `required`, `additionalProperties`, `items`, `minItems`, `maxItems`,
  `uniqueItems`, `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`,
  `exclusiveMinimum`, `minProperties`, `maxProperties`, `oneOf`, `anyOf`,
  `allOf`, `not`.

## How the web code is checked

```sh
npm run verify:requester-contract
npx vitest run --config tests/vitest.config.js tests/unit/requester-contract.test.js
```

The verifier fails when:

- a constant differs from the value the code uses (configuration files, the
  configuration the web client resolves, module exports, source literals, and
  values seen in a real exchange);
- a `channelMessages` key is not in the transport's `RTC_MESSAGE_TYPES`;
- a frame of a freshly captured exchange fails its schema, carries a member the
  contract does not describe, or has a type with no entry. The exchanges run the
  real requester (`server/whole-model-requester.js` over the mesh and the swarm
  transport), the real provider protocol code and the real signaling server in
  one process; only the WebRTC connection and the WebSocket are stand-ins;
- rebuilding `vectors.json` gives other bytes than the committed file;
- an error text under `failures` is no longer in its source file.

When the protocol changes on purpose, change the contract first, then run
`npm run build:requester-vectors`, then the verifier.

## Vectors

```sh
npm run build:requester-vectors
```

`vectors.json` is deterministic: keys, nonces, salts, ids and the clock are
fixed in `scripts/requester-contract/fixed-inputs.js`. The keys are test keys
and are published on purpose. Ed25519 signatures are reproducible byte for
byte. ECDSA signing is random, so the ECDSA examples are stored in the build
script and checked on every build; if one stops verifying, run the script with
`--mint-ecdsa` and paste what it prints.

Sections: `canonicalJson`, `identity`, `signatures`, `identityProof`,
`sdpFingerprint`, `promptCommitment`, `privacyBinding`, `admit`, `receipt`,
`generationTerminal`, `envelope`, `readyPeer`, `signaling`, `transcript`,
`scenarios`. Each section starts with a `description` of its fields.
`transcript` is one complete request, frame by frame, with the inputs needed to
reproduce every requester frame.

## How the mobile client is tested

Three levels, from fastest to most real:

1. **Vectors.** Unit-test each procedure against `vectors.json`.
2. **Line provider.** A real provider with the data channel replaced by
   standard input and output, one envelope per line:

   ```sh
   node tests/fixtures/requester-conformance/stdio-provider.js \
     [--room ID] [--provider-transport-id NAME] [--requester-transport-id NAME] \
     [--provider-fingerprint "sha-256 .."] [--requester-fingerprint "sha-256 .."] \
     [--identity ed25519|ecdsa] [--decline] [--fail-after-chunks N] [--chunk-delay-ms N]
   ```

   Its first line is `{"ready":true,...}` with the room, both connection names,
   both fingerprints, the provider identity and the model. Answer its pings: it
   drops a peer that is silent for 60 seconds.
3. **WebRTC provider.** A real native provider behind real signaling on a local
   port, with a stand-in model and no GPU:

   ```sh
   node tests/fixtures/requester-conformance/webrtc-provider.js \
     [--port N] [--host ADDRESS] [--room ID] [--token TEXT] \
     [--identity ed25519|ecdsa] [--fail-after-chunks N] [--chunk-delay-ms N]
   ```

   It prints one line with `wsUrl`, `roomId`, `token`, `origin`, `iceServers`,
   the model and the provider identity, and runs until it gets SIGTERM.

`node tests/fixtures/requester-conformance/prove.js` drives both providers from
Node: with the real JavaScript requester, with the installed `ask` command, and
with `minimal-requester.js`, a requester written from the contract alone that
imports no Reploid module.

## Not covered

Listed in the contract under `notCovered`: split routes, credits and earning,
pairing and guest invitations, per-request generation settings and the receipts
that bind them, adapters, peer introductions, being a provider, and how to get
the sign-in token for relay credentials.

## Where the files live

The contract is in `packages/reploid/contracts/`, beside the library source and
outside `packages/reploid/src/`. Everything under `src/` is copied into the
served browser tree by `npm run sync:library`; the contract and its vectors are
read by tools and tests, not by the browser, so they stay out of it.
