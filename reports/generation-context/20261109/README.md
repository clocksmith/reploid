# Whole-model conversation reuse

Poolday and the native whole-model provider use Doppler 0.6.35's explicit
generation contexts. One loaded model serves independent requester/conversation
checkpoints. Model, adapter and execution identities must still match, and the
runtime verifies exact token prefixes. Full messages are sent on each request;
provider affinity is a preference among eligible, available providers and does
not bypass disclosure approval. Provider loss or eviction rebuilds from the
requester's history. Requests remain serialized on the host GPU.

The application policy allows at most four retained contexts, at most 1 GiB
per context, at most 2 GiB across retained/active reservations, and five minutes
idle retention. Idle contexts are charged their reported retained bytes; active
contexts reserve their full allowance. Working state, weights and checkpoint
copy temporaries are additional. The runtime declines over-budget retention.
No chat history is persisted on the contributor by this cache.

`m3-installed.json` records the shipped package integrity and an isolated physical
Node/Dawn/Metal run on Apple M3 with Qwen 0.8B and 256-token KV capacity. A 101-token
follow-up reused 78 tokens and computed 23. It produced the same output as fresh
execution. Alternating conversations, requester isolation with identical thread
IDs, cancellation/rebuild, edited history and settled cleanup passed. Timings are
single development observations, not a speed benchmark or general model-quality
qualification. No public provider, browser or 27B deployment was exercised.

Reproduce with installed dependencies and local model bytes:

```sh
REPLOID_CONTEXT_PHYSICAL=1 node tests/fixtures/generation-context-installed-physical.js /path/to/model /tmp/context-installed.json
```

Focused verification: 83 tests across generation-context-cache,
work-resident-provider, legacy-generation-threads, chat-execution-lifecycle,
whole-model-requester, native-participant and generation-recovery; library types;
scoped lint; installed generation/partition contracts; generated browser bundle.
The signed-identity mesh test rejects a forged requester selecting a retained
context. Cache tests cover LRU, memory reservation, idle expiry, failed expiry,
cleanup retry and active-request pinning. Runtime numerical/lifecycle evidence is
retained in Doppler `reports/generation-context/20261109` at `fa18418b`.
