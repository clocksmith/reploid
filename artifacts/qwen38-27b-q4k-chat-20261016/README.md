# Live Qwen3.8-27B Q4K split chat — October 16, 2026

The actual Reploid browser conversation passed on https://replo.id, with native
M3 Metal executing embeddings/layer 0 and AMD Vulkan executing layers 1–63/head.
Model manifest: `19ecff3e4ab9e7c1191e271f4a6e94f10a8a102206dcda9413bed728c33c271d`.
Plan: `b16f75916a28265354eb89ac2260d100fe44e2083e2f014f2aa1d0a2903dda7b`.
No reconversion or F16 fallback occurred. The requester downloaded no weights
or tokenizer; execution used authenticated Reploid WebRTC, not the earlier SSH
diagnostic transport.

## Observed performance

One live functional journey; concurrent public providers remained resident.
These are observations, not isolated benchmark medians or tails.

| Request | First visible text | Complete answer |
| --- | ---: | ---: |
| 17 + 25, number only | 3.19 s | 3.82 s |
| Follow-up: subtract 2 | 3.10 s | 3.78 s |
| After cancellation: 6 × 7 | 3.91 s | 4.38 s |
| Count 1 through 20 | 4.05 s | 22.12 s |

The counting answer has 70 recorded generation steps, including terminal work:
3.16 steps/s including prefill and request overhead, approximately 3.82 steps/s
after the first visible delta. First-delta observations use 100 ms polling of
persisted publication records; they are not GPU kernel timestamps. Its prompt
includes the earlier conversation (134 prompt tokens). Native preparation from
loading to ready was 4.455 s on Mac and 23.675 s on AMD, with already-local files
and existing caches; acquisition time is excluded. The earlier local browser
journey completed the same counting answer in 20.85 s.

Resident weight buffers are 2,759,312,128 bytes on Mac and 14,242,434,304 bytes on
AMD. Device allocation budgets are 6 GiB and 24 GiB respectively; these are not
physical memory measurements. AMD's existing whole Q4K, 0.8B and 2B contributors
remain running. No speed superiority, broad quality retention, or concurrent-user
qualification is claimed.

## What changed and passed

- Native hosting chooses Metal on macOS instead of hardcoding Vulkan. Explicit
  backend validation and provider lifetime regressions pass.
- The catalog declares the exact ordered split, verified piece index, individual
  GPU budgets, and complete generation policy. Whole-model execution remains
  available; this test deliberately selects the partition entry.
- Browser Send produced 42, follow-up produced 40, streaming cancellation settled,
  reuse produced 42, and reload retained the conversation. Completed receipts
  bind the exact plan and two distinct contributors.
- 49 focused tests pass in the isolated release checkout. Runtime source passes
  the actual Verification Worker. Browser bundle validation passes.
- Hosting release `828578a2` serves bundle
  `sha256:d6bc91e727465927cc30a5a16d322f5e10c18dbfe9bcbcfa1df4fdc4dc184afb`.
  Only Hosting was deployed; no Functions or inference backend redeployment.

Source commits `7af58213` and `b020ac9b` retain the split changes; the latter
removes accidentally staged concurrent search edits from the release while
preserving their working files. The isolated release excludes that search work.

## Separate verdicts and retained failures

The owner explicitly accepted the earlier small cross-device numerical difference
for this integration pass. The historical 0.001 gate still fails one of 55
vectors at 0.0010237693786621094; this release does not rewrite it as a pass.
Deployment lifecycle passes the stated cases. Answer quality evidence is limited
to those cases, independently of implementation parity.

The first local test expected a transient `placement` field in a completed
receipt; the second read blank workspace metadata instead of authoritative
publication text. Both harness assertions were corrected, and the third local
journey passed. The same corrected test then passed on the isolated live release.
Screenshots of failed assertions remain; they do not demonstrate an inference
failure. The history fallback unit test now explicitly supplies a runtime without
`metadataDigest` instead of assuming the installed runtime lacks it.

`verification-worker.json` retains a rejected blanket scan of test fixtures:
the runtime sandbox disallows direct IndexedDB and environment access in that
context. The Playwright fixture uses those APIs to inspect browser persistence
and accept an operator test URL; it is not shipped runtime code. The scoped
runtime verdict is retained separately in `runtime-verification-worker.json`.
No evaluator rules were weakened.

## Active services and stopping

Mac launch agent: `id.replo.qwen27b-split`; AMD user service:
`reploid-qwen-27b-split.service`. Model/application files are in persistent service
locations. The temporary Mac RAM disk was copied to persistent storage and
unmounted; the diagnostic contributors were retired before their replacements
loaded. No public whole-model service was stopped. These two machines must be
awake and connected for the split route to remain available.

Stop only the Mac split contributor:

```sh
launchctl bootout gui/$(id -u)/id.replo.qwen27b-split
```

Stop only the AMD split contributor, on that machine:

```sh
systemctl --user stop reploid-qwen-27b-split.service
```

Run the prepared-service check without starting or modifying contributors:

```sh
REPLOID_E2E_BASE_URL=https://replo.id REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome REPLOID_SPLIT_CHAT_URL=https://replo.id \
REPLOID_SPLIT_CHAT_MODEL=qwen3-8-27b-text-q4k-ehaf16 \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-native-split.spec.js --project=chromium
```

Component: native hosting and model configuration. Intent: preserved. Boundary
effects: native Metal support and explicit Q4K ordered-route admission; Doppler
continues to own model arithmetic. Evidence: `live-browser.json`,
`local-browser.json`, `deployment.json`, and the focused tests above.
