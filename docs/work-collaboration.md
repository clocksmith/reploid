# Work, helpers, peers, and tool improvement

Reploid's main page connects agents, models, tasks, contribution, and improvements.
The local choice is Qwen 3.5 2B (`qwen-3-5-2b-q4k-ehaf16`) through
`doppler-gpu@0.6.1` and WebGPU. The model selector also offers the configured
Gemini cloud provider; its credential and execution boundary remains explicit.

Each task can enable three independent capabilities:

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

On the main page, choose **Invite** beside Agents & models. Open the invitation on the participating
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

Choose **Improve a tool** on Work. The initial registered target is `FormatJson`:
its baseline handles ordinary JSON, while the protected host suite also checks
Markdown fences, byte order marks, malformed input, and preservation of values.
The agent can implement a candidate function and run a paired comparison.

The host runs each case in a fresh worker inside an opaque-origin frame, without
network or application storage access. Candidate code receives one input, not
the expected answer or evaluation suite. Timeouts, cancellation, and host failures
cannot count as successful rejection of invalid input. Protected tests are
host-controlled, although their source is public in this repository.

The main page and the focused improvement history show the baseline and candidate scores, source, and an evaluation
download. A candidate must pass every case, regress none, and improve the score.
Use **Use this version** to adopt it after the active task settles, or keep the
current version. **Restore previous version** rolls back an adopted change.
Active tasks pin their tool versions. Local records retain failed and rejected
candidates, signed episodes, ancestry, and evaluation observations across reloads.

This implements evaluated replacement of registered pure tools. It does not
authorize arbitrary repository edits or demonstrate recursive A -> B -> C
improvement, generalization beyond the suite, or that collaboration beats a
single-agent baseline. Those claims retain the comparisons required by GOALS.md.

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
