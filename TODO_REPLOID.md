# TODO: Reploid Descriptor Peer Orchestration

> [!IMPORTANT]
> **Primary Directive:** Browser-Native Distributed Inference
> Establish a reliable, low-overhead coordination layer that distributes model layer execution across web browser peers running the Doppler WebGPU engine.
> If this does not work cleanly, and the UI is not beautiful, minimal, and premium, the system has failed.

Reploid is the browser-native peer orchestration layer for Column B transport. It runs on top of the Doppler WebGPU execution engine to schedule model execution tasks across browser tabs, negotiate VFS shard cache matches, coordinate redundancy pipelines, and verify composite execution receipts.

This document defines the interface schemas, network handshakes, scheduling strategies, and verification rules required to implement peer-based model execution.

---

## 1. Peer Registry and Capability Schema

Every browser tab participating as a provider in the distributed pool must register its capability profile with the central scheduling gateway.

```json
{
  "peer_id": "peer:9a12c8b4-e8f0-423c-a991-f925c4ef67d9",
  "reploid_version": "reploid@0.22.4",
  "hardware_capabilities": {
    "available_vram_bytes": 6442450944,
    "backends": ["webgpu", "metal"],
    "supported_generators": [
      "splitmix64_normal_v1",
      "siren_f16_v1",
      "siren_f32_v1"
    ]
  },
  "network_performance": {
    "bandwidth_ingress_bps": 50000000,
    "bandwidth_egress_bps": 25000000,
    "latency_rtt_ms": 32.5
  },
  "reliability_score": 0.992
}
```

---

## 2. Descriptor Hash Negotiation Handshake

Before assigning execution blocks, the coordinator must execute a three-step negotiation handshake to ensure the peer possesses the target weights.

```
NEGOTIATION FLOW CHART:
[Coordinator]                                           [Peer Tab]
      │                                                     │
      │ 1. Negotiate(Manifest Hash, Shard Hashes)           │
      ├────────────────────────────────────────────────────►│
      │                                                     │─── Parse Shard Cache
      │                                                     │─── Check Local Hashes
      │                                                     │─── [If missing: Fetch from CAS]
      │                                                     │
      │ 2. NegotiationResponse(HAS_SHARDS / FETCH_FAIL)     │
      │◄────────────────────────────────────────────────────┤
      │                                                     │
      │ 3. Dispatch / Terminate                             │
      ├────────────────────────────────────────────────────►│
```

* **Timeout Boundary:**
  * The negotiation handshake must complete within `runtime.scheduler.negotiation_timeout_ms` (default: 500ms).
  * If a peer fails to reply, fails to cache the shards, or times out, cancel the assignment, mark the peer as *Temporary Cache Lag*, and select another host.

---

## 3. Layer Assignment and Scheduling

The scheduler assigns model layers or experts according to execution characteristics.

```
PIPELINE PARALLEL ASSIGNMENT:
Prompt ──► [Peer A: Layers 0-7] ──► [Peer B: Layers 8-15] ──► [Peer C: Layers 16-23] ──► Output Token
```

### Scheduling Algorithms and Rules
1. **Critical Path Optimization:**
   * Time to First Token (TTFT) is dominated by the prefill stage.
   * Route the initial layers (Layers 0..4) exclusively to peers possessing the lowest RTT latency (≤ 20ms) and highest reliability (≥ 0.99).
2. **Warm Standby Policy:**
   * For every layer group assignment A in {L_i..L_j}, the scheduler must register an active peer P1 and a standby peer P2.
   * P2 must pre-load the layer group's functional descriptors during the setup phase.
   * If P1 goes silent or drops offline, route the activation output tensor of layer L_{i-1} directly to P2.
3. **Structured Assignment Logging:**
   * Record every allocation decision in the execution log, including timestamps, peer IDs, latency estimates, and task descriptions. Write this log directly into the final receipt.

---

## 4. Retry and Reroute Policies

Handle failures and timeouts gracefully without dropping inference batches.

* **Response Timeout Policy:**
  * If a peer fails to return the activation tensor within the deadline D_t = Prefill Time + 1.5 × RTT, dispatch the same inputs to the standby peer.
  * Decrement the failed peer's reliability score by 0.05.
* **Output Mismatch Quarantine:**
  * When executing redundant paths, if output hashes from Peer A and Peer B diverge:
    1. Quarantine both peers from the active scheduling pool.
    2. Dispatch the block input to a trusted validator node (or run locally).
    3. Determine the correct output.
    4. Permanent penalty: reduce the cheating/faulty peer's reputation score by 0.25. If reputation drops below 0.50, flag the peer ID as blocked.

---

## 5. Adversarial Correctness Limits

* **Product Copy Boundary:**
  * Descriptor hashes confirm content parity; they do not attest that remote peers run correct shader logic.
  * **Rule:** The word `"guaranteed"` must never be used in documentation, marketing, or UI panels describing computation trust.
  * Provide three configurable trust policies:
    ```json
    {
      "trust_policy": {
        "level": "redundant_verification",
        "redundancy_factor": 2,
        "challenge_frequency": 0.05
      }
    }
    ```
  * **Mitigation Pathways:**
    * **Reputation scoring:** Track peer honesty history inside the ledger.
    * **Challenge-response:** Inject random mock queries with pre-computed outputs to verify peer math logic.
    * **Redundancy:** Route activations to multiple independent peers and compare output hashes.

---

## 6. Composite Receipt Verification

Assemble a single verification package from the individual peers' outputs.

```json
{
  "composite_receipt_version": "reploid.composite.v1.0",
  "session_id": "session:f3b2a...",
  "global_input_hash": "sha256:3a4b...",
  "global_output_hash": "sha256:7e2c...",
  "peer_execution_chain": [
    {
      "layers": [0, 1, 2, 3, 4, 5, 6, 7],
      "assigned_peer": "peer:9a12c8...",
      "doe_receipt": { "output_hash": "sha256:f5e2..." }
    },
    {
      "layers": [8, 9, 10, 11, 12, 13, 14, 15],
      "assigned_peer": "peer:4b8c9d...",
      "doe_receipt": { "output_hash": "sha256:8c1a..." }
    }
  ],
  "verification_status": {
    "chain_integrity": true,
    "mismatch_events_count": 0,
    "challenges_passed": 2
  }
}
```

* **Verification Algorithm:**
  * For each link N in the chain, assert:
    input_hash_{N+1} == output_hash_N
  * Verify that each peer receipt carries a valid `replay_class` matching its execution platform.
  * Reject the generation if any unmitigated quarantine events appear in the assignment records.

---

## 7. Policy and Engine Separation

Keep logic decoupled from execution.

* **Decision Boundaries:**
  * The execution engine (Doppler WebGPU/WGSL) must not make model selection, weight merging, routing topology, or prompt generation decisions.
  * Reploid (the orchestrator) proposes the inputs, weights, paths, and configs. The engine executing the kernels must remain a stateless calculator.
  * If a parameter is unresolved during scheduling, fail fast and abort the pipeline before dispatching tasks to Doppler.

---

## 8. UI/UX and Performance Constraints (Clean, Minimal, Low-Overhead)

* **Minimalist Aesthetics:**
  * Strict adherence to the `rd` design system: monochrome base layout, subtle conic prism animations, and clear monospace typography.
  * No clutter: only expose active participant counts, real-time node routing animations, trust policies, and verified receipts.
  * Micro-animations (e.g., state changes for WebGPU provider load, peer handshakes, or receipts) must feel smooth and light.
* **Low-Overhead Execution:**
  * Minimize Main Thread Blocking: Move parsing, local hash checking, and verification to background workers.
  * Zero-Copy Tensor Transfers: Ensure Doppler inputs/outputs are sliced and transferred cleanly without copying where possible.
  * Handshake & Routing latency must be kept under 500ms total to prevent pipeline stalls.
