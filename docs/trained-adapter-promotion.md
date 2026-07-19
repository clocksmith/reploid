# Trained Adapter Promotion

Reploid stages externally trained adapters in Shadow. It activates them only
after Doppler proves identity and inference parity, Gamma selects the exact
artifact on sealed task and retention populations, and a human approves the
bound receipt chain.

## Contract

`NeuralCompiler.stageTrainedAdapter()` accepts:

- a Tinker-attributed adapter manifest;
- a Doppler trainer-artifact identity receipt;
- a Doppler `tinker_peft_browser_adapter` parity receipt; and
- a Gamma `tinker-browser-selection-receipt`.

The stage verifies each receipt hash, then verifies the links between receipts.
The Gamma adapter ID, adapter SHA-256, base model ID, and base checkpoint
SHA-256 must match the manifest. A staged adapter remains in `shadow` and cannot
load.

`NeuralCompiler.promoteTrainedAdapter()` submits an
`alwaysRequireHuman` request to `HITLController`. This request queues even when
the rest of Reploid runs in autonomous mode or security gates are disabled. The
controller creates the approval context. Candidate data cannot supply it.

After approval, NeuralCompiler writes a hash-bound human approval receipt into
the adapter registry. Every later activation revalidates that receipt against
the Doppler and Gamma hashes. Rejection leaves the adapter staged and inactive.

Promotion does not publish the adapter. `buildPromotedAdapterPack()` converts a
promoted registry entry into one immutable pack; the publisher client then signs
a separate network publication. Reploid can revoke that publication without
rewriting the pack or its promotion evidence.

For Poolday execution, a requester signs approval for one publication, prompt
hash, and exact base-model identity. A provider may advertise the pack as
`cached` or `fetchable`, but the inference receipt is valid only after verified
bytes reach Doppler and the pack is `active`. The receipt records whether the
bytes came from cache, a peer, or the publication origin.

## Authority

| Decision | Owner |
|---|---|
| Adapter training and export | Thinking Machines Tinker |
| Byte identity and browser inference parity | Doppler |
| Task gain, retention, and required determinism levels | Gamma SAME-R |
| Shadow state and activation enforcement | Reploid NeuralCompiler |
| Durable promotion | Human through Reploid HITL |
| Publication, revocation, requester approval, and transport | Reploid Poolday |

Neither Tinker, Doppler, nor Gamma may activate an adapter. Gamma selection is
candidate admission, not promotion.

## Current claim boundary

The promotion and Poolday network contracts have focused executable tests. The
repository does not contain a real Tinker training receipt, a promoted Tinker
adapter, or a deployed adapter publication. The synthetic Gamma fixture proves
evaluator mechanics only.

*Last updated: July 2026*
