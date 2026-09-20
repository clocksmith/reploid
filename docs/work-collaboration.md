# Work, helpers, peers, and tool improvement

Reploid's Work screen starts with a task, optional files, and an explicit model.
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

## Acceptance evidence

`tests/e2e/work-integration.spec.js` exercises the Work helper/evaluation/adoption
flow, browser isolation, Verification Worker, and approved text exchange between
two browser contexts over real WebRTC. Inference is deterministic and injected
in these tests; they do not qualify physical GPU execution or model task quality.
`tests/unit/code-evolution.test.js` covers signed authority, interrupted work,
tampering, failed persistence, and rollback. `tests/e2e/work-clarity.spec.js`
checks task visibility, mobile layout, and disclosure controls.
