# Reploid network quick start

Use an available prepared model through the ordinary conversation workspace.
Discovery, contribution and disclosure are separate actions. This guide describes
that workflow; it is not a claim that full physical-device acceptance passes.

For the names and code boundaries, see [concepts and glossary](glossary.md).

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

1. Open the page. It joins the configured public mesh and discovers participants
   without a Join button, invitation, manual room setup or selecting individual
   computers.
2. Type your question and press Send once. There is no required model pick,
   approval dialog, charge or budget step. Before you send, the composer names
   the computer kind and the model, and says the answering computer can read
   your prompt. Send authorizes that attempt's messages, attached text and
   derived model data to verified eligible executors for the model shown. It creates no future-message grant and authorizes no local
   contribution, candidate evaluation or adoption.
3. Watch the answer stream into its originating conversation. Using an already
   prepared remote path requires no requester weights. Preparation on
   contributors is separate from the requester’s conversation.

Choosing a model is optional:

- **Automatic choice.** With no pick, the page chooses an available model and
  the shown default follows availability as computers come and go. The model
  shown before Send, the model named on the answer and the model that served
  it are the same.
- **Explicit pick.** A model you pick stays pinned, including across a reload
  and for new threads. When nothing serves it, the page says so, keeps the
  draft and sends to no other model; wait or pick another model yourself.

If nothing eligible is ready, the draft stays intact. Local model download is an optional,
separate action; failure must not silently move your request to a cloud provider,
a different model or another recipient.

## Conversations and recovery

Start other conversations independently. Selecting or closing one does not stop
another. Stop cancels the identified attempt and waits for execution settlement;
it does not promise immediate termination of submitted GPU work.

Keep completed and partial answers after a failure. Explicit retry creates a new
attempt with fresh permissions and admission checks. Interrupted GPU state is
not assumed to survive contributor disconnection, reload or replacement.

## Your computer

Open **Computers**. **This computer** appears first. Contribution has three
separate actions, and downloading alone does not opt in:

1. **Download weights.** A reviewed download stores a model on this device. It
   does not make the device answer requests or share files.
2. **Opt in.** Choose to share model storage, compute, or both. Both switches
   start off. Storage only shares verified model files and never starts compute;
   compute answers other people's requests while the page is open. The confirm
   button names the choice (for example *Share model files* or *Download &
   share*).
3. **Resume.** A contribution you authorized earlier resumes under that choice.
   Cached weights or an old automatic-sharing flag never count as that choice,
   and an explicit off choice persists.

Cached sharing does not approve new downloads. Pause contribution here;
unrelated conversations keep running.

## What the evidence establishes

Partition execution and selective acquisition are implemented. Retained physical
runs establish cooperative execution under their exact model, package and
allocation limits. They do not establish universal numerical parity, factual
accuracy, independent operators or dependable public availability.

See the current integration and evidence (private roadmap),
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
