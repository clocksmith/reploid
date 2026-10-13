# Ordinary canonical runner integration

Component: partition runner. Intent: preserved; optional canonical execution shares the existing attempt limits, FIFO numerical lease, cancellation and final settlement owner. No sampler, shader, scheduler, package pin or public activation changed.

`createLayerPartitionRunner({canonical:true})` requires the explicit runtime and participant capabilities. `executeCanonical` binds the full attempt, effective prompt, current participant stages, exact plan and allocated generation. It authorizes both computation/disclosure paths before durable admission and reservation. It verifies B's genuine stage signature before A commits the actual cursor transition; A returns its own signed commitment. Both envelopes, the exact accepted token/delta/cursor and receipt commit through the existing required-evidence publication owner before any output callback. B acknowledges that actual receipt before another step. Storage and output callbacks do not hold another conversation's numerical lease.

N=0 and full-context admission use actual Doppler admission results from both owners, an empty evidence array and no GPU acknowledgments. Failed or uncertain publication does not deliver text. Cancellation races through the same transactional publication owner. A restart cannot regenerate an already admitted durable attempt. Failed preflight cannot close another coordinator's resources: canonical cleanup tracks each reservation before beginning it, including uncertain outcomes, and closes only those touched owners.

`before.log` retains the actual missing `executeCanonical` failure. `tests/canonical-runner-source.js` uses current Doppler source target/mirror transitions, real ECDSA stage and v3 grant signatures, and the real publication reducer with an injected transactional store. Numerical tensors and participant device calls are injected. Controls cover two steps, no premature UI, forged B before A mutation, uncertain commit, N=0, cancellation during asynchronous signature verification, stale generation/epoch/plan/prompt, unsupported publication, restart refusal, and a second conversation completing while the first waits on storage authentication.

`after.log`, `types.log`, `legacy.log` (114 tests), `worker.json` (actual Worker, 9 warnings) and `mirror.log` retain the results. Reproduce:

```sh
DOPPLER_SOURCE_ROOT=/Users/xyz/deco/doppler node tests/canonical-runner-source.js
npm run verify:library-types
npx vitest run --config tests/vitest.config.js tests/unit/partition-api.test.js tests/unit/partition-runner.test.js tests/unit/partition-step-receiver.test.js tests/unit/partition-data-channel.test.js tests/unit/catscan.test.js --maxWorkers=2
```

Boundary effects: explicit runner request/result APIs and a narrow per-attempt assembly helper. Existing chat/entry/automatic composition still chooses the accepted legacy branch. Conversation-owner history migration, authenticated requester-side publication over the entry channel, ordinary UI integration and exact-package physical qualification remain open. This is source integration proof, not complete RD-CANON acceptance.
