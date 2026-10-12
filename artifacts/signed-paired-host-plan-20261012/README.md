# Explicit provider plan through browser and native signed opening

Component: Reploid host composition. Intent preserved: Doppler owns model representation, validation, signed eligibility and execution. Boundary effect: optional catalog `partitionPlan` now carries a provider-produced immutable plan into the existing resident/signed opening. Legacy catalog assembly and the accepted Doppler pin are unchanged.

## Reproduced mismatch and repair

Both hosts formerly rebuilt every plan using only manifest `activationDtype`. That lost the explicit paired representation: its logical F32 activation has two components and an eight-byte element stride. Precision is not inferred from dtype, shader names or a global flag.

An explicit plan is snapshotted before asynchronous acquisition, deeply frozen, checked against selected model/split, validated against the acquired manifest by Doppler, and checked through the provider's activation contract. The same plan reaches hashing and resident admission. An unsupported provider or inconsistent plan rejects; there is no scalar fallback. Signed admission still validates qualification and exact initial execution identity.

Evidence:

- `before.log`: eight new host cases failed against scalar reconstruction; 53 existing tests passed.
- `fixture-cleanup-failure.log`: two test-only failures from calling the wrong result cleanup port; fixed to the actual `result.resident.close()` interface.
- `immutability-before.log`: four added freeze/acquisition-snapshot checks failed before the ownership repair.
- `wrong-config-command.log`: failed invocation naming nonexistent root Vitest config; no tests executed.
- `final-tests.log`: 67 checks pass with `npx vitest run --config tests/vitest.config.js tests/unit/work-partitions-lifecycle.test.js tests/unit/work-partition-plan.test.js`.
- `candidate-contract.js` / `.json`: actual archive3 package codec accepts the existing frozen synthetic v2 plan with unchanged hash; immutable nested metadata verified. Package source hashes retained. Run with the unpacked candidate directory argument.
- `verify-worker.js` / `verification-worker.json`: actual Verification Worker loaded into isolated VM, three production files parsed; passes with nine warnings. This is source verification, not browser execution.
- Browser manifest regenerated and locally verified: `sha256:4591784924154b593b14066e6712c75bc64480c13c08373a3fa4763d26fdf305`.

Doppler's existing synthetic signed-opening fixture (`tests/runtime/paired-resident-opening.test.js`, introduced in `6d238e05`) exercises both partition indices, signed paired session policy, and scalar identity/stride rejection. The fixture uses a test signer and synthetic evidence; it establishes contract plumbing only. The canonical session field is `linearRecurrentStatePrecision`.

## Concrete physical handoff

No real paired model is qualified or signed by this change. The numerical candidate currently fails; physical signed opening remains open.

The existing producer is `rigModelCapsule` / `node tools/rig-model-capsule.js`, with `--program-bundle`, `--manifest`, `--model-dir`, `--reference-report`, repeated `--qualification-report`, `--initial-identity`, `--piece-index`, `--resident-contract`, `--release-manifest`, signing options and `--out`. No new producer or approval path is needed.

Before invoking it for the real model, retain actual independently compared receipts for each required physical surface and partition index. Existing `doppler.resident-partition-qualification/v1` reports must bind exact model ID, current manifest hash, execution graph, initial execution identity, canonical partition plan/hash/index, independent evaluator/reference/contract hashes, complete capture hashes and all declared ordered steps at unchanged 0.001. A self-reported pass is not independent numerical proof. Never relabel failed receipts or copy one placement's evidence to another.

The signed initial identity must include the actual immutable session (`intermediatePrecision`, `linearRecurrentStatePrecision` and all remaining settings). Updated kernel/graph identities may produce a new manifest while preserving model-weight semantics; historical manifest bytes are not a substitute for the new manifest. The verified piece index must bind that manifest and actual file/range/size/hash identities. Rig already emits signed `pieceIndexArtifactId` and partition qualification bindings.

Reploid then consumes the exact selected model identity, generation and provider `partitionPlan`; signed `capsule`, `executablePack` artifact closure/accepted target digests, `packOpenOptions` trust/admission policy, and existing monotonic release policy/checkpoint ports. The existing verified artifact source maps manifest-relative paths and acquires only assigned pieces. Both hosts already restore signed load options and validate loaded identity before readiness. The browser and native placement still need actual signed execution, useful answers, cancellation/reuse and settlement evidence with the eligible archive.

Existing limits already permit 1,588 × 1,024 × 8 = 13,008,896 activation bytes per prefill. No transport allowance, accepted pin, public catalog or deployment changed.
