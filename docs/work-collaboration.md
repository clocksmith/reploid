# Work, helpers, peers, and tool improvement

Reploid's main workspace contains a thread list and the selected thread, with
network state in a disclosure. The operator defines each thread's objective;
agents may define bounded subtasks within that thread's grants, not replace its
objective. Up to eight threads can remain active independently. Selecting a
thread does not stop another. Stop and public-payload approvals are thread-scoped;
background approvals remain visible in the thread list.

The workspace uses Doppler models, not a local/cloud mode switch. It places whole
inference requests on connected peers advertising the selected model, or this
device when no matching peer is connected. Remote inference requires exact-payload
approval for each dispatch, including the conversation context. Refusal and peer
failure never silently retry on another participant or model. The default model
is Qwen 3.5 2B (`qwen-3-5-2b-q4k-ehaf16`) through `doppler-gpu@0.6.1`.
This device serializes its borrowed GPU operations across threads and contributions;
concurrent agent threads do not promise simultaneous execution on one GPU.

Thread Options contain independent grants:

- **Use helper agents:** the main agent can assign up to three bounded subtasks.
  Helpers use the selected model and the shared Reploid engine, with read-only
  access to task inputs. Each gets at most four cycles. They cannot delegate,
  change permissions, or adopt code.
- **Ask peers:** the agent can propose a text request to a connected provider.
  Before sending, Work shows the exact payload, model, and recipient for approval.
  Returned text is untrusted task data. Specialized signed Pack operations retain
  their separate admission and verification path.
- **Test tool improvements:** the agent can inspect registered tools, propose
  replacement functions, and have the host compare them with the current version.
  Passing tests never activates a candidate by itself.

## Connect another device

Open **Network**, then choose **Invite**. Open the invitation on the participating
devices, then use **Connect peers**. A contributor can explicitly offer
the local Qwen model and stop sharing at any time. Cross-device connections use
the configured signaling service for rendezvous and WebRTC for transport.
Without a cross-device room, discovery is limited to the same browser.

A provider executes a whole text generation request. This workflow does not split
one model's layers or tensors across devices. It uses the existing compatibility
generation protocol; its result is not a signed Pack qualification, hardware
attestation, proof of correctness, or proof of independently operated machines.
Signaling and local model availability remain deployment prerequisites.

## Improve a tool

Enable **Test tool improvements** in thread Options. Review candidates in **Changes**.
The initial registered target is `FormatJson`:
its baseline handles ordinary JSON, while the protected host suite also checks
Markdown fences, byte order marks, malformed input, and preservation of values.
The agent can implement a candidate function and run a paired comparison.

The host runs each case in a fresh worker inside an opaque-origin frame, without
network or application storage access. Candidate code receives one input, not
the expected answer or evaluation suite. Timeouts, cancellation, and host failures
cannot count as successful rejection of invalid input. Protected tests are
host-controlled, although their source is public in this repository.

The Changes page shows the baseline and candidate scores, source, and an evaluation
download. A candidate must pass every correctness and separate workload case,
regress none, and satisfy the host's frozen improvement objective.
Use **Use this version** to adopt it after all active threads settle, or keep the
current version. **Restore previous version** rolls back an adopted change.
Active tasks pin their tool versions. Local records retain failed and rejected
candidates, signed episodes, ancestry, and evaluation observations across reloads.
Each proposal registers its own immutable algorithm generation. A rejected
candidate does not occupy the baseline's registry identity or prevent a retry.

This implements evaluated replacement of registered pure tools. It does not
authorize arbitrary repository edits or demonstrate recursive A -> B -> C
improvement, generalization beyond the suite, or that collaboration beats a
single-agent baseline. Those claims retain the comparisons required by GOALS.md.

### Continuing objectives

`work-evolution.json` selects `format-json-repair-or-latency/v1` before generation.
The original six correctness cases remain mandatory. Four additional workload
cases are host-controlled and omitted from candidate inputs and generation
prompts; public source means they are not secret. A repair must add passing
correctness cases. Once correctness reaches 6/6, another version can qualify by
reducing measured execution time while preserving all required outputs.

The host measures 12 paired samples, alternating baseline/candidate order in
fresh sandboxes. Timing includes sandbox startup and returned-value validation.
Latency qualification requires all three thresholds: at least 5 ms median paired
gain, 20% median relative gain, and a faster candidate in at least 11 of 12 pairs.
Invalid clocks, incomplete samples, identical source and failed workload results
cannot qualify as latency improvements. This measures local end-to-end tool
latency, not isolated algorithm complexity or performance on other devices.

The signed episode retains the objective version, full definition, evaluator
identity and raw paired observations. Changing the objective, budgets or
evaluator invalidates pending adoption and requires fresh evaluation. It does
not silently deactivate an already approved version. Adoption and rollback
remain separate operator actions. The **Measured execution** disclosure shows
the local result without adding another primary dashboard.

`tests/e2e/continuing-tool-objectives.spec.js` verifies repair followed by latency
improvement, approval, reload, use on another input, and rollback with handwritten
fixtures. Unit tests exercise two successive latency improvements, noise,
workload failures, invalid clocks, cancellation and changed objectives. This
removes the fixed-score ceiling; it does not promise endless improvements or
establish that an improvement helps generate its successor.

## Exchange a candidate

Open a candidate’s **Code & sharing** disclosure and inspect its code and
description before choosing **Download candidate**. The file includes those
fields, the target, format version, and code hash. It excludes task records,
protected tests, evaluation claims, and approval records. The hash checks byte
integrity; it does not establish authorship or correctness.

On another device, use **Import a tool** under Improvements. Loading the file
only displays its contents. **Evaluate on this device** runs the recipient’s
protected suite against its current tool and the imported candidate. A changed
baseline requires a fresh preview. Failures remain recorded; passing candidates
still require **Use this version** and retain rollback. Imported code is recorded
as an operator-imported artifact, not as locally generated agent work.

The file handoff remains available without joining a network.

## Send a candidate to a peer

Connect peers using the same invitation. A recipient opens **Import a tool** and
enables **Receive tool offers from connected peers** for this connection. The
sender inspects **Code & sharing**, selects that peer, and chooses **Send candidate**.
Only the candidate code and description are sent, bound to sender, recipient,
room, transfer identity, expiry, byte size, and target-contract identity.

The receiving device stores a preview. **Preview candidate**, **Evaluate on this
device**, and **Use this version** remain separate actions. Delivery never imports
the sender’s evaluation or approval. Local evaluation retains transport provenance
and rejects a changed baseline. **Dismiss** leaves the current tool unchanged.

Peer delivery allows up to 24 KiB per offer, three explicitly requested attempts,
and five minutes for delivery. Receipts confirm retained previews only. A retry
reuses the transfer identity; duplicate delivery does not create another preview.
Missing receipts remain unconfirmed, and expired transfers cannot be retried.
Transfer records and identity persist across reload; reconnect to recover them.
Receiving permission resets on disconnect. A second tab cannot own the same peer
identity concurrently. Transport does not evaluate, adopt, or execute candidates.

These are bounded delivery and local tool-evaluation contracts, not evidence of
independently operated machines or network-caused capability improvement.

## Acceptance evidence

`tests/unit/work-threads.test.js` and `tests/e2e/work-threads.spec.js` exercise two
concurrent host threads, view switching, separate approvals, stopping one without
stopping the other, and retained results after reload. Inference is injected.
The browser thread suite also runs primary inference through two real WebRTC
participants with injected responses and no local requester model.
`tests/unit/legacy-generation-threads.test.js` covers compatible-peer reservations,
queued requests, model-substitution rejection, and request-scoped cancellation.

`tests/e2e/work-integration.spec.js` exercises the Work helper/evaluation/adoption
flow, browser isolation, Verification Worker, and approved text exchange between
two browser contexts over real WebRTC. Inference is deterministic and injected
in these tests; they do not qualify physical GPU execution or model task quality.
`tests/unit/code-evolution.test.js` covers signed authority, interrupted work,
tampering, failed persistence, and rollback. `tests/e2e/work-clarity.spec.js`
checks task visibility, mobile layout, and disclosure controls.
`tests/e2e/tool-offer-exchange.spec.js` exercises file download, preview, local
evaluation, separate adoption, reload, rollback, and tampering rejection across
two isolated browser contexts. Candidate code is supplied by the test, not a model.
`tests/e2e/peer-tool-offer.spec.js` adds real WebRTC delivery, recipient refusal,
restart recovery, local evaluation, adoption and rollback. Protocol unit tests
exercise redelivery, lost receipts, failed persistence, tampering, expiry and
identity binding. The required CI test job runs these product suites alongside
storage, boot and peer-job contracts, and archives browser and package evidence.

Cancellation stops observation before borrowed model work necessarily finishes.
The agent's `settle()` operation waits for that work; the Work host then checkpoints
and closes its owned scope. Timeout reasons survive checkpointing and reload.
The browser recovery test deliberately delays an injected provider after timeout
to exercise this boundary without claiming a real model result.

For the real local leg, run a current local server, then:

```sh
REPLOID_E2E_ACTUAL_INFERENCE=1 node tests/actual-work-improvement.js
```

This uses the configured recommended Doppler model, the unchanged task budget,
and a fenced JSON input. No provider output or candidate code is injected. It
verifies served source hashes, retains task/checkpoint and candidate records,
and records model loading, failures and operator guidance. An incomplete task
exits nonzero. Evidence is written under `artifacts/actual-work-improvement/`;
`REPLOID_E2E_BASE_URL` and `REPLOID_ACTUAL_EVIDENCE_DIR` select the server and
output directory. This is one machine, not the independent-recipient proof or
the controlled network-benefit comparison. Never adopt a candidate merely
because this runner recorded it.

A shorter diagnostic isolates candidate generation from the full Work planner:

```sh
REPLOID_E2E_ACTUAL_INFERENCE=1 node tests/actual-tool-repair.js
```

It executes the failing tool, supplies the observed exception and public contract
to the configured Qwen model, and permits up to four responses within a declared
budget, including model loading. The default is 300 seconds;
`REPLOID_ACTUAL_TIMEOUT_MS` declares a different diagnostic allowance, up to
900000 ms, before the run. It does not change the Work task budget or evaluator
thresholds. Failed responses feed their actual
rejection back to the model. Syntactically valid candidates also run against the
original task input, and that diagnostic result enters the next prompt. The
harness never repairs generated code or supplies
protected cases. The production Verification Worker and evaluator decide whether
any candidate qualifies. Every response, prompt, rejection, served source hash and
signed episode is retained. A passing candidate is exported for preview; it is
never automatically adopted. This diagnostic is not a replacement agent loop or
a completed cross-device demonstration.

Once that report contains a qualifying candidate, replay its unchanged model
output through the product UI and real WebRTC:

```sh
REPLOID_ACTUAL_CANDIDATE_REPORT=artifacts/actual-tool-repair/<run>/report.json node tests/actual-tool-transfer.js
```

The transfer runner checks the candidate against the recorded response, sends it
between disposable browser contexts, evaluates it again, exercises explicit UI
adoption, runs a subsequent input, reloads, and rolls back. It retains the source
report hash, transport provenance, local evaluation and rollback evidence.
These are scripted operator actions on one machine. For the independent-device
milestone, another operator must instead receive the exported candidate through
the invitation flow, evaluate and choose adoption on their own computer, run a
subsequent task, and retain that device's evidence. Neither two contexts nor a
receipt establishes that independent operation.

The [September 20 evidence report](../artifacts/continuing-improvement-2026-09-20/report.json)
records the continuing-objective and retry regressions separately from six local
Qwen runs. Those runs produced 18 candidates and no qualifying repair. A
successful model-generated transfer, independent-recipient adoption and recursive
improvement remain unproved.
