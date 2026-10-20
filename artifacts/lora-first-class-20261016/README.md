# Native LoRA lifecycle, mac-host

[Observed result](mac-native-service.json): real Qwen 3.5 0.8B Q4K plus pinned NER adapter through Reploid native whole-model/provider composition and Doppler source. Adapter preparation, base → adapter → base isolation, concurrent caller serialization, pre-cancellation, subsequent reuse and shutdown passed. Base and adapted answers have distinct adapter identities and content. Eight-token outputs intentionally end incomplete; this is lifecycle evidence, not NER quality acceptance.

Reproduce from Reploid: set `DOPPLER_SOURCE_URL` to the tested Doppler checkout file URL with trailing slash, `LORA_MODEL_DIR` to the verified model folder, `LORA_ADAPTER_FILE` to the pinned adapter bytes, then `node tests/fixtures/native-lora-physical.js`.

Doppler companion evidence: `reports/lora-partitions/20261016/` records whole versus two-stage numerical parity and a nonzero adapter effect.

This run used source, not the deployed browser or remote contributors. Peer file delivery and route identity are covered by focused contract tests; this physical run does not establish cross-machine adapter execution.

Component: native contributor, host adapter resolution, partition routing. Intent: preserved. Boundary effects: exact adapter selection and base identity cross preparation, advertisement, permissions and returned execution identity.

## Installed live follow-through

[Live browser observation](live-browser.json): deployed Reploid `374cae85`, Doppler
0.6.31 archive, backend revision `reploid-pool-00121-h8k`, matching hosting bundle
`219b05cf30fdd324ad3beb67818eb6094d667a7df6015f64fbfec1605f8e6b92`.
A fresh Playwright Chrome requester discovered the exact NER adapter as Ready,
selected it, authorized the remote request, and received
`{"people":["Maya"],"places":["Paris"]}`. The UI showed Complete, Mesh, one computer,
11 output tokens and 1.7 seconds; no page errors. This is a functional observation,
not an isolated latency benchmark. A separate installed Mac contributor serves
that adapter and shares its verified cached files; existing contributors were not stopped.

LoRA remains scoped to one exact adapter per request and supported scalar
execution. Paired arithmetic, adapter stacking, signed Capsule composition,
selective acquisition of only stage-local adapter bytes, and physical
cross-machine LoRA stages are not qualified by these results.
