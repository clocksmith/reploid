# Qwen 27B Q4K whole-model service verification — 2026-10-16

This record reconciles the installed AMD native whole-model service with Doppler's
scoped retained-Q4 qualification. It does not start another numerical campaign.

## Installed identity and configuration

`installed-audit.json` verifies manifest
`19ecff3e4ab9e7c1191e271f4a6e94f10a8a102206dcda9413bed728c33c271d`, all 1,956
files in the qualified patched-runtime inventory, and the complete runtime
configuration. All match. This is installed Doppler 0.6.30 with the qualified
runtime overlay, not proof of a newly published npm release. The existing service
already used this configuration; no reconversion, service restart, or allowance
change was needed.

The service uses explicit 256-token prefill chunks, a 4,096-token context and
256-token output limit. Chat applies the template; the numerical reference uses
raw token inputs. Chat is therefore an application qualification, not a repeated
numerical comparison. Doppler's six-task quality lane already used a chat template.

Doppler separately records 16.994 GB tensor bytes, 401 packed matrices, and an
18.187 GB peak managed GPU allocation. Those are the native qualification's
measurements, not fresh GPU accounting from this browser test. Physical RAM,
shared GPU allocations, OS reserve and context growth must be measured before
claiming suitability for a 24/32/48 GB contributor. The unchunked long-prefill
device-loss failure remains unresolved; chunking is the qualified workaround.

## Browser boundary and harness corrections

The original whole-model browser fixture still selected a hidden dropdown and
read localStorage. The current UI uses radio cards and IndexedDB. The first run
was interrupted at the hidden selector. The repaired fixture uses the actual
model card and durable conversation/publication records.

The next run found Send disabled for a prepared whole-model provider. Another
session repaired the ordered-history admission boundary in `e27aa27f`; its deployed
bundle was verified before continuing. This session did not alter or redeploy
that repair. Both public services and the exact numerical configuration stayed
unchanged.

The first repaired-deployment lifecycle and long-prompt checks passed. Their
inline attachments were not retained by the list-only reporter. Receipts now
write explicit files independently of the reporter; the final run also verifies
provider-reported prompt tokens and adds frozen independent tasks. Earlier
successes are not counted as independent quality samples.

## Final observed results

| Check | Result |
| --- | --- |
| Exact installed runtime and model | Pass; no file differences across 1,956 qualified runtime files |
| Browser streaming, follow-up, cancellation, reuse, reload | Pass; exact whole-model identity, no requester weight/tokenizer downloads |
| Longer prompt through UI and WebRTC | Pass; **3,816** reported prompt tokens, answer `42`, natural stop, unchanged prompt/history after reload |
| Longer-prompt latency | **89.735 s** Send-to-completion; first observed persisted text at **89.213 s**, provider prefill **88.734 s** |
| Eight additional frozen tasks | **7/8**; code trace expected `26`, returned `22`; test remains failed |
| Additional short-task latency | 2.95–5.67 s Send-to-completion, observed under current shared load |
| Provider continuity | All four AMD inference service PIDs unchanged and running at final inspection |

The failing prompt is `Python code: values = [2, 5, 8]; result = sum(x * 2 for x
in values if x > 3). What is result? Reply with only the number.` The expected
answer remains 26. The receipt preserves 22. No prompt retuning or assertion
relaxation was used. This is an application-quality failure; attribution to
quantization, runtime arithmetic, or the base model requires a matched control.
The seven passing answers do not become a broad quality acceptance or an F16
comparison. JSON extraction, missing information, record filtering, corrections,
constraint selection, sorting and Unicode copying passed.

`verification.json` records two passing browser tests and one failing task-suite
test; scoped ESLint and syntax checks pass. `long-context-chat.json`,
`whole-model-chat.json` and `service-tasks.json` retain exact attempts, execution
identities and outputs. Timings are individual observations, not isolated
benchmark medians, throughput claims, or sustained-service guarantees. The first
persisted delta is polled at 250 ms for the capacity case.

The live bundle remained
`sha256:99cae8548d5f68765c54874c381f2fd9831c3692f85785d51ed1103a35356ea2`
throughout the final checks. The installed kernel inventory matches the native
qualification; browser requester success does **not** qualify browser-local GPU
execution of 27B. No 24/32/48 GB tier, provider departure/replacement, sustained
multiuser load, or new Q3/Q2 format was qualified. Long-prefill latency and the
failed code task are concrete remaining limitations.

`ready-models.json` and `ready-models.png` additionally verify the current model
picker shows 0.8B, 2B, whole-model 27B and split 27B Ready in a fresh browser. The
NER LoRA remains unavailable. An already-open tab running the earlier admission
code needs a reload to receive the deployed fix; no inference service restart is
needed for that frontend correction.

## Reproduction

Prepare the exact whole-model contributor separately, then run:

```sh
REPLOID_E2E_BASE_URL=https://replo.id REPLOID_E2E_SKIP_LOCAL_SERVER=1 \
REPLOID_E2E_CHROMIUM_CHANNEL=chrome REPLOID_NATIVE_CHAT_URL=https://replo.id \
REPLOID_NATIVE_CHAT_MODEL=qwen3-8-27b-text-q4k-ehaf16 \
npx playwright test --config tests/playwright.config.js \
  tests/e2e/chat-native-whole-model.spec.js \
  tests/e2e/chat-native-whole-model-capacity.spec.js \
  tests/e2e/chat-native-whole-model-tasks.spec.js --project=chromium
```

The tests use isolated browser profiles, exact-model admission and real UI Send.
They do not mock inference, start GPU providers, download requester weights or
restart public contributors. The capacity fixture is the retained native-provider
prompt, without forcing its raw input token IDs through the chat template.

Component: verification evidence. Intent: preserved. Boundary effects: test
selectors and persisted-history inspection only; numerical policy and application
runtime unchanged. Acceptance evidence: retained browser receipts and installed
audit in this directory.

## Independent follow-up on the failed code task

[Retained CPU reference](code-trace-independent-reference.json) executes the same
Q4 bytes with independent GGUF Q4_K decoding and Transformers F32 equations,
using F16 KV storage. It predicts token IDs `[17,17,248046]` (22, then stop),
matching the wrong service answer; the correct answer remains 26. This isolates
reproduction outside Doppler and Reploid transport. It does not distinguish
quantization quality from the base model or prompt, because no matching F16
control was run. The failed expanded-quality assertion remains failed.
The receipt binds contract, tool and manifest hashes; its referenced full logits
remain on amd-host and are not included here. CPU reference execution took
101.356 seconds with 17.42 GB maximum resident memory.
