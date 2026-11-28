# Two physical browsers trained one adapter

The coordinator used Chrome on Apple M3 Metal. The contributor used Chrome on AMD Radeon 8060S Vulkan. Each browser joined a newly created private Reploid room through the shipped signaling server, verified its counterpart’s signing identity and WebRTC certificate, and accepted the gradient-sharing disclosure. The qualification operator drove both screens. Each training round required a fresh contributor grant. The task adapter stayed outside the chat model.

## One update and a disconnect

The production Doppler trainer applied one token-weighted AdamW update on the coordinator. Two of the three loss positions came from the coordinator and one came from the contributor. The independent reference ran a single trainStep over all three on the coordinator. Across 9,216 FP32 adapter values, maximum absolute error was 1.19e-6 and RMS error was 1.24e-8. The respective limits were 2e-5 and 2e-6. The coordinator and contributor recorded the same byte count for each direction.

With a completed update retained, the operator interrupted the contributor’s live WebRTC channel during the next gradient request. The coordinator applied zero updates from that attempt. Its adapter and its checkpoint, including Adam moments, compared equal before and after. A new worker on the surviving coordinator restored step 1 and finished step 2. This exercises a contributor drop while the coordinator remains alive.

## Sixteen task rounds

The pooled and single-computer trainers saw the same 32 synthetic support tickets in the same pairs. The pooled run used one new opt-in per pair. Across the final two adapters, the maximum absolute weight difference was 1.71e-6 and the RMS difference was 3.85e-8. Peer training payloads totaled 3,194,151 bytes (2,389,951 from the coordinator and 804,200 from the contributor). Adding up the measured rounds gives 319.61 s after subtracting the recorded 635.42 s pause. The single-computer reference took 48.15 s. The pooled product flow reopens workers and obtains fresh grants. The single-computer reference keeps one loaded trainer across its 16 updates.

[Measured steps and single-host references](workout.json) · [Browser and transport receipt](training-workout.json) · [Earlier attempts](initial-attempts.json) · [Pause](qualification-pause.json) · [Resume](qualification-resume.json)

## Held-out quality

| Arm | Export tickets | Queue A | Queue B | Retention |
| --- | ---: | ---: | ---: | ---: |
| Base Qwen3.5-0.8B | 12/24 | 12/12 | 0/12 | 10/12 |
| Single computer | 12/24 | 12/12 | 0/12 | 10/12 |
| Two computers | 12/24 | 12/12 | 0/12 | 10/12 |

The independent scorer recorded 108 arm-by-case decisions. The pooled adapter changed the logits on all 36 cases but changed zero decisions. Both trained adapters missed the minimum 16 correct, minimum 7 correct per queue, and minimum gain of 3 over base. Both preserved all ten controls the base answered correctly. The adapter has no demonstrated routing benefit on this task.

The first frozen readout called a selected-token operation that requires an FP16 output head. This model has a Q4K output head. That attempt returned zero predictions. The replacement readout took the same A and B entries from full-vocabulary logits and passed a public training-example check before the held-out pass. The author verified that the scoring revision kept the same models, cases and decision thresholds.

[Replay the held-out comparison](holdout-replay.md) · [Independent quality receipt](quality.json) · [Reader freeze](score-freeze.json) · [Public-example check](quality-public-probe.json) · [First reader failure](selected-logit-attempt/failure.json) · [Pooled adapter](task/adapter.json) · [Single-computer adapter](task-reference/adapter.json)

## Measurement

Elapsed times include browser-side preparation, worker startup and the optimizer update. Application payload counters cover the training channels; independent identity discovery, model provisioning, DTLS/SCTP framing and retransmission are outside those counts. The first qualification also streamed the weight files across the network. Subsequent trials verified the same pinned bytes on each host before training. Part of the AMD run overlapped another GPU job, and the operator paused after task step 4. This run establishes no dedicated-device performance ranking.

[Reproduction](../../../examples/export-triage/README.md) · [Frozen task and decision thresholds](../../../examples/export-triage/contract.json)
