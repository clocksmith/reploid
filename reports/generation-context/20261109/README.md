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

## Public rollout and AMD catalog check

Frozen Reploid `549a801b0c5572c3cc22df9eca1c79f4483abb6c` contains the context
implementation and the subsequent Doppler 0.6.36 package integration. It was
deployed to Firebase Hosting and Cloud Run, and installed into a separate native
release directory on Jupiter. This is the deployed source identity, not a claim
that later commits were deployed.

- [AMD catalog receipt](deployment/amd-catalog.json): actual Qwen 27B, catalog
  4,096-token KV configuration, existing 24 GiB buffer budget. Alternating
  conversations reused 78 of 101 input tokens and produced the same four output
  tokens as fresh execution. A different requester with the same conversation ID
  reused zero. Cancellation discarded its checkpoint; edited history rebuilt.
  Provider, runtime service and GPU cleanup settled. This short diagnostic does
  not qualify 4,096-token numerical accuracy or full-logit equivalence.
- [Native delivery](deployment/native-package.json) and
  [rollout](deployment/native-rollout.json): exact archive hash and all 206
  delivery files checked. The existing public service was restarted with the
  same signing identity, owner policy and model manifest. The old release and
  systemd override remain available for rollback. The disabled services and
  Flash-Next operator were not changed.
- [Hosted requester receipt](deployment/hosted.json): real Chrome, public
  `https://replo.id`, remote 27B inference. The first answer was `red`; its
  contextual follow-up answered `blue`, reusing 116 tokens and computing 26.
  Reload preserved history. Stop cancelled a subsequent request, and the next
  request rebuilt with zero reused tokens and answered `42`. No requester weight
  downloads or page errors were observed.
- [Deployment verification](deployment/deployment.json): all 2,311 served files
  match the frozen bundle; backend source/runtime identity and 100% traffic,
  production configuration, and desktop/mobile surface checks passed. The first
  release check failed only because its browser smoke still required the removed
  top model-card list. The repaired smoke asserts one composer picker, keyboard
  opening/Escape/focus restoration, containment and phone visibility. Its live
  rerun passes, including all routes, drawer layout and draft persistence. No
  product code changed to satisfy that stale assertion. The many-route audit
  emitted peer-connectivity and TURN rate-limit diagnostics; this is not a
  capacity or rate-limit qualification.

These are correctness and lifecycle development observations, not a throughput
benchmark or general quality qualification. Requests remain serialized; only
bounded ephemeral computation state is retained on the provider. Durable thread
history remains on the requester.

Reproduce with the installed native delivery and exact catalog model directory:

```sh
REPLOID_CONTEXT_PHYSICAL=1 node tests/fixtures/generation-context-installed-physical.js /path/to/model /tmp/amd-catalog.json catalog
REPLOID_CONTEXT_PHYSICAL=1 node tests/fixtures/generation-context-hosted-physical.js https://replo.id /tmp/hosted.json
```

The hosted check sends synthetic color and arithmetic prompts to a prepared
public provider. It requires permission to generate there and does not start,
stop, or reconfigure the provider itself.

Component: whole-model context retention and deployment evidence. Intent:
preserved. Boundary effects: hosted requester/backend package and Jupiter's
public native 27B process; model bytes, precision and qualification gates unchanged.
