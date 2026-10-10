# Reploid network quick start

Use an available prepared model through the ordinary conversation workspace.
Discovery, contribution and disclosure are separate actions. This guide describes
that workflow; it is not a claim that full physical-device acceptance passes.

## Open Reploid

Open [replo.id](https://replo.id/), or run the current checkout locally:

```sh
npm install
npm start
```

Open `http://localhost:8000`. The requester needs a browser and connectivity to
eligible participants. WebGPU and model storage are needed on a contributing
browser that executes model layers, not merely to request a peer answer.
Cloud-provider keys are not a prerequisite for prepared peer execution.

## Ask through prepared capacity

1. Start a conversation and choose a model with an available execution path.
   The configured public mesh discovers participants without an invitation,
   manual room setup or selecting individual computers.
2. Enter your question. Review the recipients, model and disclosure scope before
   granting remote execution. A grant does not authorize local compute or storage
   contribution, candidate evaluation or adoption.
3. Watch the answer stream into its originating conversation. Using an already
   prepared path requires no requester weight downloads. Preparation on
   contributors is separate from the requester’s conversation.

If nothing eligible is ready, leave the draft intact and wait or explicitly
select a different available model. Local model download is an optional,
separate action; failure must not silently move your request to a cloud provider,
a different model or another recipient.

## Conversations and recovery

Start other conversations independently. Selecting or closing one does not stop
another. Stop cancels the identified attempt and waits for execution settlement;
it does not promise immediate termination of submitted GPU work.

Keep completed and partial answers after a failure. Explicit retry creates a new
attempt with fresh permissions and admission checks. Interrupted GPU state is
not assumed to survive contributor disconnection, reload or replacement.

## Contribute optionally

Use the network controls to offer storage or compute and choose limits. Model
pieces are verified and acquired for the assigned contribution. Discovery alone
grants neither contribution nor input disclosure. Stop or drain the contribution
through its owner; unrelated conversations and other contributors retain their
resources.

## What the evidence establishes

Partition execution and selective acquisition are implemented. Retained physical
runs establish cooperative execution under their exact model, package and
allocation limits. They do not establish universal numerical parity, factual
accuracy, independent operators or dependable public availability.

See the [current checkout and evidence](doppler-partition-handoff.md#current-checkout-and-evidence),
[technical conversation diagrams](open-mesh-architecture.md#technical-diagrams)
and [acceptance contract](chat-mvp.md). Browser and native participants use the
same library contracts; their host support is qualified separately.

## Other supported workflows

- [Zero/X substrate and provider compatibility setup](zero-x-quick-start.md):
  Direct / Proxy / Doppler wizard, Genesis levels and VFS experimentation.
- [Scoped helpers, private peers and tool improvement](work-collaboration.md):
  optional private invitations, candidate delivery, protected evaluation,
  explicit adoption and rollback.
- [Typed decisions and scoring](doppler-choice-scoring.md): model judgments are
  data; authoritative permissions remain deterministic application controls.
