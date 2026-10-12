# Provider-declared activation layouts

Component: partition coordination. Intent: preserved. Doppler defines the tensor
representation; Reploid preserves its bytes, identities, permissions and limits.

The approved intermediate-precision implementation requires both components at
the contributor boundary. The old Reploid peer admitted only scalar v1 frames
and calculated four bytes per F32 value. It could not carry the new contract.

Reploid now asks an injected runtime for `getPartitionActivationContract(plan)`
and uses `validateActivationFrameForPlan(frame, plan)` for complete payloads.
Header admission checks the declared schema, precision, component count and
stride before sending bytes. It also rejects representation fields on legacy v1
frames, matching Doppler's codec. The existing accepted runtime remains supported
by its scalar v1 adapter; an unrecognized plan cannot silently use that adapter.
No model arithmetic, plan selection, grant policy or transfer allowance changed.

The frozen synthetic fixture in `tests/fixtures/paired-activation-contract.json`
comes from Doppler `104d3bbd`, with the precise source hash recorded inside it.
It includes signed zero and minimum-subnormal low components; the tests compare
their bytes without recombination. These are injected protocol controls, not
numerical or physical inference evidence.

- `before.log`: all five initial paired-boundary tests fail against the old code.
- `after.log`: 49 focused tests pass, including peer RPC, malformed layout
  rejection before remote execution, transfer allocation and unchanged legacy
  conversation/lifecycle behavior.
- `full-suite.log`: 3,200 tests pass; 29 remain skipped.
- `worker-verification.json`: actual Verification Worker, with warnings retained
  and no errors. Library TypeScript checks also pass.

A bounded independent source review found the legacy malformed-header case;
the additional regression now rejects it before payload admission.

Boundary effects: optional provider contract helpers, exact frame metadata and
byte accounting. The accepted Doppler pin is unchanged. The regenerated source
bundle is not a deployment or paired-runtime qualification. The public deployment
for the preparation/budget repairs remains separately recorded as `68b3997b…`.
