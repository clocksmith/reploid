# Remote operations and reviewed document tasks

Complete jobs can name an exact base model and one exact, signed LoRA publication.
The current combination policy permits one `peft_safetensors` adapter, at most
64 MiB. `pool-config.json.peerJobs.execution.adapters` owns those limits and
whether a provider may fetch missing bytes. The default request uses the base
model alone. Missing policy fails before assignment.

`normalizeExecutionAdapterSet()` verifies the publication, exact base identity,
source/tokenizer compatibility, runtime version, format and size. The assignment
and durable attempt retain that exact set. Providers require an already admitted,
current publication in their adapter registry; a job cannot publish its own
adapter into that registry. Revocation is checked before execution, throughout
output processing and before replaying an old completion.

`createPeerAdapterResolver()` uses `peer-pack-custody.js` with an authorized
`artifactSet` containing adapter weights only. Its authorization and signed
supplier inventory come from the application's existing custody arrangement.
Verified chunks use native browser storage and survive a browser restart. The
Doppler operation receives immutable adapter descriptors and a byte-store port;
Doppler verifies bytes, activates tensors and unloads them when the operation
settles. Its selected signed execution plan must explicitly permit adapter
execution and include the required kernel closure.

For ordinary generation, use `acceptanceMode: "execution"`,
`comparisonPolicy: null`, and `reference: null`. Verification jobs retain the
reference mode. Ordinary acceptance checks the output contract, execution
identity and policy; it does not establish answer correctness. Partial text
remains provisional, and a retry never joins two generations into one answer.

The document assistant keeps retrieval local. After a local search, **Ask another
computer** starts with an empty task field. **Review task** shows the exact text,
recipient and model. **Send this task** requires explicit confirmation that the
text is public. Editing the text, changing local inputs, cancelling or allowing
the preview to expire invalidates approval. The returned signed episode is
verified before the local model quotes the remote draft alongside local passages.
Citation-number validation does not prove that an answer faithfully represents
the sources.

`createOperationRoomNetwork()` and `createOperationRoomProvider()` compose the
existing room bus, signing, WebRTC, message framing and durable execution owners.
The helper can use **Share compute → Share an answer model**, choose document
model settings, confirm publisher trust and public-task participation, and start
or stop sharing. Applications can also call `start()` with selected models,
current capability observations and an admission callback. Discovery and signed
connection tickets contain identities only; operation inputs use the data
channel. The public document UI composes the requester port automatically.
Application code may supply a room network through `initPoolHome`'s
`operationNetwork` option. Browser contexts on one machine are not independent
operators.

Acceptance commands:

```sh
npx vitest run tests/unit/pool-peer-pack-job.test.js tests/unit/pool-peer-adapter-execution.test.js tests/unit/pool-document-delegation.test.js
REPLOID_E2E_SKIP_LOCAL_SERVER=1 npx playwright test tests/e2e/peer-pack-jobs.spec.js --project=chromium
```

These protocol and browser tests use synthetic model outputs. They cover exact
identities, adapter acquisition, revocation, native restart persistence, real
WebRTC, reviewed disclosure and durable replay. They do not qualify a specialist
adapter or establish independently operated machines. Public npm 0.5.1 lacks this
operation bridge; the changed Doppler runtime and adapter-enabled signed model
release must be installed together before this becomes a public product claim.

The [physical adapter diagnostic](../status/remote-adapter-2026-09-06/README.md)
retains direct GPU activation, declared auxiliary shaders, and unchanged model
bytes. It separates those observations from signed execution, source comparison,
specialist quality, and independent-machine proof.
