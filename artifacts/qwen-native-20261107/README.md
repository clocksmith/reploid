# Physical offline Qwen native-provider composition

All four exact artifacts in `shared/config/chat-models.json` pass this controlled
AMD Radeon 8060S / Dawn run: 0.8B Q4K, 2B Q4K, Qwen 3.8 27B Q4K and Qwen 3.6
35B A3B Q4_0. Each receipt records the exact catalog identity and reported GPU.
The 35B artifact is Q4_0, not Q4K.

The fixture composes the actual native whole-model provider and shared Doppler
runtime service. Before compute it opens the directory through
`openNativeModelSource`, checks the approved manifest and piece-index identities,
and verifies a 16-byte range through the authenticated piece reader. This is a
sampled piece read, not a separate exhaustive audit of every piece. It then checks
nonempty generation, repeated resident output, pre-aborted requests, reuse,
active cancellation on the first update, and reuse after active cancellation.
Cleanup failures fail the process. No signaling server or participant starts.

[Suite receipt](receipt.json) binds each individual output. These are actual GPU
runs using a supplied Doppler source snapshot plus its wide-vocabulary dispatch
repair, now committed as Doppler `019dec78`. They do not qualify the older
published npm package for that repair. Source snapshot IDs and fixture digest
are retained. [Doppler report](https://github.com/clocksmith/doppler/tree/019dec78/reports/qwen-installed-20261107)
records the runtime delta, Metal/AMD shader controls and artifact provenance.

For 0.8B and 2B, the tested profile names are explicit in the receipts. For 27B
and 35B, the catalog load profile is preserved, with a test-only 24 GiB cap where
the configured pool exposes that budget. All runs limit greedy output to four
tokens and context to 512. Adapter lists are empty. This does not establish
adapter, network, public receipt-signing, quality, or isolated performance
qualification. Timings are observations alongside the existing active 27B
provider; it was not restarted. The 35B participant remains stopped.

Run explicitly with a provisioned source/runtime and exact local artifact:

```sh
DOPPLER_SOURCE_URL=file:///absolute/doppler-source/ \
DOPPLER_NODE_WEBGPU_MODULE=webgpu REPLOID_QWEN_PHYSICAL=1 \
REPLOID_EXPECT_CATALOG_IDENTITY=1 \
node tests/fixtures/native-qwen-pipeline-physical.js \
  MODEL_ID MODEL_DIRECTORY PROFILE_OR_catalog OUTPUT.json
```

The tested Reploid archive was `78271fff40a5575835948c8bcc00729c768f0101` plus
the retained fixture. No product files, model identities, bundle, running
participants or deployment were changed. These tests are opt-in, not part of
ordinary CI.
