# Adapter catalog on replo.id, 2026-11-05

Deployed source `8c799381b`, browser bundle
`sha256:0a783b59d16e2c24da828300ee1562960109a803dd2403106cf422616157e323`,
checked with headless Chrome on mac-host against https://replo.id.

[Observation](live-adapter.json): a fresh browser profile served the Qwen 3.5 0.8B
NER JSON LoRA through Run on this device until it reported Ready. A second, empty
profile opened the picker, which listed the adapter beneath Qwen 3.5 0.8B with its
version, the publisher's purpose, "Served now by 1 computer" and "No evaluation
evidence". It selected the adapter and sent one
extraction prompt. The answer completed on that one shared computer as
`{"people":["Maya Lin"],"places":["Paris","Tokyo"],"dates":["March 3, 2024"]}`.
The saved attempt in `reploid-requester-history` records placement
`peer-whole-request`, base identity `sha256:6788ca6b…` and
`execution.adapterIdentities` `["sha256:dc0248f4…"]`; execution details show the
recorded adapter. The temporary contributor stopped after the check.

Two browser defects surfaced on the way and are fixed in `a7a20cefb` and
`8c799381b`: requester-only ordered participation refused every explicit
whole-model share, and the cached-artifact lookup threw on catalog models
without a base URL. One answer is a functional observation. It is not NER
quality evidence, an evaluation receipt or a latency measurement.

The deployment's release check passed the deploy-surface, production contract
and route checks, then failed the final pool browser smoke test on `/`, `/work`
and `/network`. That failure predates this work (it fails at `1b33760bf`).
