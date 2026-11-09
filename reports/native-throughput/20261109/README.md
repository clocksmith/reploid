# Qwen 27B on Miles and Jupiter

The current installed Reploid Qwen 27B path runs on Jupiter. It does not load on
Miles: the declared embedding table needs 2,542,796,800 bytes, exceeding the
Windows Vulkan adapter's 2,147,483,648-byte buffer/binding limit. No Miles token
rate or cross-machine speed ratio was measured. This is a rejection of this
configuration, not proof that every 27B implementation is impossible on Miles.

| Resident measurement | Jupiter | Miles |
| --- | --- | --- |
| CPU | Ryzen AI Max+ 395 | Ryzen 7 6800H |
| GPU/backend | Radeon 8060S, Linux RADV Vulkan | AMD Radeon Graphics, Windows Vulkan |
| Decode tokens/second, median | 6.106 | Unavailable: load rejected |
| Decode range, three runs | 6.036–6.127 | No generation |
| Prefill tokens/second, median | 49.594 | No generation |
| First token, median | 1.176 s | No generation |
| Complete 128-token request, median | 21.984 s | No generation |

## Exact workload and limits

Both tests used the native delivery from Reploid
`549a801b0c5572c3cc22df9eca1c79f4483abb6c`, installed Doppler 0.6.36,
`webgpu` 0.4.0, and the same added
[measurement fixture](../../../tests/fixtures/native-model-throughput-physical.js).
[summary.json](summary.json) records the archive and fixture hashes.

The exact model is `qwen3-8-27b-text-q4k-ehaf16`, manifest
`e29626a8d3c41c0af8c0dd945d028464dcebfef2413ba85e4f5e8695d5910d06`.
Its stored weights total 16,994,352,128 bytes. That is not a GPU allocation
measurement. The unchanged catalog profile uses F32 activations, F16 KV,
4,096-token cache capacity, a 24 GiB buffer-pool budget, greedy generation,
batch size 1 and readback interval 1. No adapters were selected.

The prompt asks for a detailed account of transformer execution; its exact text
and all effective catalog options are in [jupiter.json](jupiter.json). Each
request computed 58 prompt tokens afresh and generated 128 tokens. One warmup
preceded three measured repetitions. Every Jupiter answer hash matched across
all four requests. This checks repeatability of this output, not independent
answer quality or full-logit correctness.

Decode rate is `(generatedTokenCount - 1) / decodeSeconds`: the first token comes
from prefill. Request rate includes prefill and provider work, but excludes model
loading and mesh transport. Loading took 104.46 seconds on Jupiter through the
temporary HTTP artifact source with ordinary shard verification. Loading is
reported separately and is not compared across machines.

Jupiter's public 27B and Flash-Next services remained resident. The test used the
shared operator lock, not an exclusive idle-GPU reservation. These are short
application-profile measurements under that co-residency, not hardware peak
throughput or a broad benchmark campaign.

## Miles: first failed boundary

The initial test selected the generic Node installation and failed to open
`vulkan-1.dll` before model loading. That failure is retained in
[miles-launch-failure.json](miles-launch-failure.json). The existing serving
directory contains the required DLL beside Node. Repeating with that executable
opened the physical Vulkan adapter; both Node executables have the same SHA-256.

The actual model attempt then failed at `loadWeights`' embedding-limit preflight;
[miles.json](miles.json) retains the exact error. The 2B provider was stopped
during both attempts. The rejection happens before generation or a full-model
allocation attempt, so it does not establish an out-of-memory result.

Doppler contains split embedding gather kernels, but this model's declared
execution configuration does not select one. A compatible split-table
configuration would need validation, followed by an actual full-model memory
and generation test. It would change the tested execution configuration and
must be recorded separately. Miles's device-local heap budget was only
10.84 GiB in the pre-test Vulkan snapshot; that is an additional fit concern,
not the demonstrated failure. Shared/system RAM does not remove a per-binding
limit. Flash-Next's sparse expert cache is a different loading strategy from
this dense 27B path.

## Restoration and reproduction

Miles's original 2B launch command, identity and owner policy were preserved.
The final provider PID is 21096, model-ready and offering, with a connected mesh
sample at 22:49:15 UTC. Its existing Doppler 0.6.33 was not upgraded. Jupiter's
public provider retained main PID 204246 / Node PID 204252; Flash-Next retained
PID 1259994 and reported ready with no active request at the final check.
Both test processes exited with settled GPU cleanup. The temporary artifact
server was stopped. No provider was permanently switched to a different model.

To reproduce, install the recorded native delivery, add the fixture at its
repository-relative path, and serve the exact model directory using the existing
Doppler range-capable static-file server. Supply a JSON configuration containing
`baseUrl`, `modelId`, `output`, `prompt`, `warmupRuns: 1`, `measuredRuns: 3` and
`maxOutputTokens: 128`; copy the prompt from the receipt. Run:

```sh
REPLOID_CONTEXT_PHYSICAL=1 node tests/fixtures/native-model-throughput-physical.js /path/to/config.json
```

On Windows, set the equivalent environment variable and use the serving Node
executable with its Vulkan DLL. The fixture does not manage existing providers;
an operator must coordinate those separately. No model precision, driver or
memory-policy changes are part of this receipt.

Focused checks: fixture syntax, scoped ESLint, retained JSON consistency and
diff whitespace. No runtime production code or public deployment changed.
