# Blueprint 0x00007E: Quorum-Controlled Community Key

**Classification:** Canonical Full Specification

**Implementation Status:** Proposed

**Verified Artifacts:** None

**Planned Artifacts:** `capabilities/identity/peer-identity.js`, `capabilities/crypto/shamir.js`, `capabilities/communication/community-key.js`, `capabilities/communication/gemini-relay.js`

**Owned Source Files:** None

**Former Blueprint Paths:** `self/blueprints/0x00007E-sponsor-peer-protocol.md`

**Objective:** A free tier for Zero and X in which a shared, cloud-restricted Gemini key is
split among peers with Shamir's Secret Sharing and used only after a quorum of witnesses
checks policy and a signed usage log.

**Prerequisites:** `0x000038` (WebRTC Swarm Transport), `0x000007` (API Client and Communication)

---

## 1. Status

None of this exists in code. There is no community-key, Shamir, peer-identity or relay
module in `self/`, no `qkey:*` message type in
`self/capabilities/communication/swarm-transport.js`, and no community provider in
`self/core/llm-client.js`. This blueprint is design intent only. It is separate from
Poolday's peer identity and transport (`apps/poolday`, `packages/reploid/src/transport`).

## 2. Premise

One peer always sees the full key in memory while it makes the call, and the JavaScript
garbage collector may keep copies. The design does not promise secrecy. It aims for bounded,
audited, policy-gated use of a demo key, and the real cap is on the cloud side: the key is
referrer-locked to the hosted origin, limited to the Generative Language API, locked to one
Flash model and given a low quota.

## 3. Roles

No peer class is privileged; roles are taken per request.

| Role | Does | Declared capability |
| --- | --- | --- |
| Requester | Asks for inference | None |
| Executor | Collects shares, calls the API, streams the reply, signs a usage receipt | `gemini_executor` |
| Witness | Holds one share; releases it only after checking policy and the receipt log | `key_custody` |

## 4. Design

- **Key buckets.** Each key is held by a small committee (3 to 10 custodians, `t`-of-`n`).
  Capacity grows by adding buckets, each with its own quota, log and failure domain, not by
  adding custodians to one key.
- **Custody.** Shares are split over GF(256) and stored AES-GCM wrapped with a device-local
  key. Rotation re-deals the shares and invalidates old ones.
- **Leases.** One quorum round grants a lease for a batch (for example 10 requests in 5
  minutes). Requests within the lease are signed by the requester and carry a sequence
  number; replies stream in 16 KB chunks.
- **Receipt log.** Each completed call produces an executor-signed, hash-chained receipt.
  Quotas are a per-bucket G-Counter merged by taking the maximum per peer. A witness refuses
  to release a share when its log head diverges from the executor's by more than a set
  number of entries, or when the requester's quota is spent.
- **Scoped egress.** A `GeminiRelay` capability may call only the Generative Language
  endpoint over HTTPS, only with a valid lease.
- **Limits.** One Flash model, 2048 output and 8192 input tokens per request, one stream per
  peer, a daily output budget, no Arena and no self-modification beyond L0. Bringing one's
  own key removes these limits.

## 5. First version scope

Own devices only: one bucket, 3 to 5 tabs, 2-of-3 or 3-of-5 quorum, BroadcastChannel
transport, a manual key deal, and an in-memory receipt log. Not included: several buckets,
automatic rotation, cross-device WebRTC, log persistence, public discovery or Sybil
resistance beyond per-key quotas.

## 6. Verification requirements

- Peer identity persists across reloads.
- Shamir split and reconstruct round-trip for `t`-of-`n`.
- Shares are AES-GCM wrapped at rest.
- A witness refuses release when the receipt log diverges or the requester's quota is spent.
- The executor reconstructs, calls, and zeroizes its buffers.
- Chunks with envelope stay under the 64 KB transport limit.
- Receipt logs merge correctly.
- One quorum round covers a whole lease.

## 7. Threats

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Executor keeps the key | Re-deal, lease expiry | Garbage-collected copies; accepted |
| Sybil peers | Per-key quotas, receipt log | New identities get fresh small quotas |
| Receipt log fork | Witnesses refuse on divergence | Short loss of availability during resync |
| Executor and witnesses collude | Cloud-side quota | Bounded by the cloud restrictions |
| Shares accumulate | Re-deal on rotation | The first version trusts its own tabs |

*Last updated: November 2026*
