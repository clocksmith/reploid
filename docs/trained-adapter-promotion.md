# Trained Adapter Promotion

Reploid stages externally trained adapters in Shadow. It activates them only
after Doppler proves identity and inference parity, Gamma selects the exact
artifact on sealed task and retention populations, Clocksmith independently
verifies prospective evidence, and a human approves the bound receipt chain.

## Contract

`NeuralCompiler.stageTrainedAdapter()` accepts:

- a Tinker- or Doppler-attributed adapter manifest;
- a Doppler trainer-artifact identity receipt;
- a trainer-matched Doppler browser parity receipt;
- a Gamma selection receipt; and
- a `clocksmith.promotion-verification/v1` receipt bound to the candidate and
  the pinned exposure-ledger schema.

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

AdapterPack v2 also binds the source repository and revision, tokenizer,
weight-pack identity, manifest variant, and conversion-config digest of the
exact Doppler base. A same-family or same-model-name checkpoint is not an
acceptable substitute. The signed distribution contract names one immutable
primary origin and optional preservation mirrors; mutable URLs and origin URL
lists are forbidden.

For Poolday execution, a requester signs approval for one publication, prompt
hash, and exact base-model identity. A provider may advertise the pack as
`cached` or `fetchable`, but the inference receipt is valid only after verified
bytes reach Doppler and the pack is `active`. The receipt records whether the
bytes came from cache, a peer, or the publication origin.

Private Columbo artifacts use generation-pinned GCS identity with an
assignment-bound short-lived read URL. The URL is not persisted. Clocksmith
Hugging Face repositories provide immutable custody and PEFT interoperability,
but private browser delivery does not expose a long-lived Hugging Face token.

## Authority

| Decision | Owner |
|---|---|
| Adapter training and export | Thinking Machines Tinker or Clocksmith Doppler |
| Exposure chronology and prospective promotion eligibility | Clocksmith independent verifier |
| Byte identity and browser inference parity | Doppler |
| Task gain, retention, and required determinism levels | Gamma SAME-R |
| Shadow state and activation enforcement | Reploid NeuralCompiler |
| Durable promotion | Human through Reploid HITL |
| Publication, revocation, requester approval, and transport | Reploid Poolday |

Neither a trainer, Doppler runtime verification, Gamma selection, nor the
independent verifier may activate an adapter. They provide separate evidence;
human approval remains the durable promotion authority.

## Current claim boundary

The promotion and Poolday network contracts have focused executable tests. The
repository does not contain a real Tinker or Doppler training receipt, a promoted
adapter, or a deployed adapter publication. The synthetic Gamma fixture proves
evaluator mechanics only.

That statement applies to routable `reploid.pool.adapter-publication/v2`
records. A signed `reploid.pool.adapter-canary-publication/v1` record may prove
runtime interoperability for real bytes. Its schema requires `routable: false`,
forbids AdapterPack requirement fields, and cannot satisfy promotion.

Immutable network-mechanics canaries are recorded in
[`artifact-custody/network-canaries-v1.json`](artifact-custody/network-canaries-v1.json).
They cover the hosted Gemma 270M base model, an Apache-2.0 external Qwen 0.8B
NER adapter mirror, and the 232,808,939-byte WGSL Repair seed-29 transfer
artifact. Their roles are narrow: none is prospective model-quality or
promotion evidence.

*Last updated: July 2026*
