# Concurrent mesh chat MVP

The release is a conversation workspace backed by participating devices, not a
global task runner. This document records the requested release boundary, not a
claim of completed integration.

## Required release

- An invited mesh, a thread list, the selected conversation and compact network status.
- Thread-scoped messages, purpose, membership, model/adapter choice, permissions,
  approvals, cancellation and durable attempts. Answers stream into their originating thread.
- Verified model-file acquisition from authorized peers, reuse and interrupted-transfer recovery.
- Verified compatible LoRA acquisition and Doppler application to the identified base model.
- Whole-request peer execution without requiring the requester to load model weights.
- Separate storage and execution contributions with enforced limits.
- Shared bounded model residency, fair participant scheduling and isolated generation/adapter state.
- Operational observations retaining provenance, costs and duplicate identities for later Bayesian scheduling.
- Monochrome neumorphism, no main-workspace presets, tool import/export furniture or empty improvement sections.

Develop one bounded two-device layer split alongside this integration. Doppler
must define executable portions, tensor interfaces, continuation state and the
comparison contract. File sharing and whole-request execution do not qualify a
split. Reploid's legacy arithmetic layer grouping is not a Doppler partition contract.

## Ownership

- [Conversation workspace](../packages/reploid/src/chat/CATSCAN.md): messages, history, attempts and fair execution scheduling.
- [Host](../self/host/CATSCAN.md): authenticated participant identities, mesh membership, catalog admission, storage and runtime composition.
- [Custody](../packages/reploid/src/artifacts/custody/CATSCAN.md): authorized chunks, integrity and resumable acquisition.
- [Whole requests](../packages/reploid/src/mesh/jobs/CATSCAN.md): signed execution lifecycle and bounded recovery.
- [Transport](../packages/reploid/src/transport/CATSCAN.md): authorized files, requests, supported tensors and result delivery.
- Doppler: model semantics, adapter compatibility/application, generation-state reset and valid partitions.

Conversation retries preserve previous partial output and create new attempt
identities. Reload marks unfinished attempts interrupted; it does not redispatch.
Closing a conversation changes workspace presentation, not its running request.
Stop acts on one identified attempt and waits for borrowed execution settlement.

The scheduler reserves a bounded token allowance per authenticated participant,
not per requester-chosen thread ID. Queues rotate between participants. It keeps
one model resident, resets generation state, applies the exact adapter set for
each request, then clears both states before the next request. Failed cleanup
retires the session. These are application allocation bounds, not physical GPU
memory accounting or immediate GPU termination.

## Acceptance

Use three independent tabs for initial integration. A starts two conversations. B obtains missing model
files and an authorized compatible adapter from C, executes through Doppler and
streams to A. Verify context isolation, cancellation isolation, history recovery,
interrupted-transfer resumption and execution-peer loss. A retry starts a new
generation unless a supported continuation contract is explicitly exercised.

Each tab has its own participant identity and storage namespace. Tabs may share
one browser profile, but shared IndexedDB or cached model files must not bypass
the authorized transfer being tested. This is single-machine evidence, not
cross-device GPU, network-failure or independent-operator qualification.

Record artifact/runtime identities, device identities, authorized recipients,
queue/load/execution times, transferred/reused bytes, failures, retries and
resource budgets. Compare the bounded split with an unsplit reference under
Doppler's declared numerical and output comparison contract.

## Current implementation boundary

The new `reploid/chat` library entry implements conversation lifecycle and a
resident-device scheduling owner. The public workspace composes it with prepared
resident contributors and the compatibility whole-request mesh. Requester and
contributor model identities share one catalog; unavailable providers do not cause
requester model downloads. This compatibility protocol remains distinct from
signed complete-Pack jobs.

Conversation disclosure supports explicit, persisted, revocable thread grants.
Grants bind the mesh, conversation, verified recipient, model, adapters and public
disclosure scope. A fresh signing-key proof binds the recipient to the current
WebRTC certificates before reuse. Changed recipients require approval; peers
without this proof retain exact-payload approval. Grants authorize neither
contribution nor artifact supply.

The [same-device acceptance records](../artifacts/chat-grants-2026-09-23/README.md)
separate actual GPU conversation/grant recovery from injected browser tests and
actual adapter custody/application. Real adapter transfer uses the existing
custody APIs with explicit artifact grants; it is not yet selectable adapted
execution in the public chat UI. Model weight-shard acquisition through chat,
signed complete-job integration, full three-participant model/adapter execution
and independent-device qualification remain required. The bounded layer split
remains unimplemented. Placeholder adapter hashes cannot be admitted.

The [three-tab harness](../tests/e2e/chat-three-tab.spec.js) uses one browser profile,
real WebRTC, signed custody, interrupted-transfer checkpoints and cache reuse.
It verifies isolated conversations, cancellation settlement, shared scheduler
residency, execution-peer disconnection, explicit retry and reload recovery.
Its files and model responses are synthetic. It does not qualify Doppler
inference, LoRA compatibility/application or the signed complete-job protocol.

*Last updated: September 2026*
