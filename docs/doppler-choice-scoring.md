# Doppler decisions in Reploid

Reploid transports and uses typed model results. Doppler owns answer-label
tokenization, model computation, scoring and stopping. Permissions and side
effects remain ordinary application code.

## Public library composition

Open a signed Capsule through the installed Doppler host, with explicit trusted
signers and accepted TargetPlan digests. It must qualify `scoreChoices` on the
actual host; a generation-qualified model is insufficient. Then borrow that
session through Reploid's public operation provider:

```js
import * as runtime from 'doppler-gpu';
import { createDopplerOperationProvider } from 'reploid/doppler';
import { resolveConfig } from 'reploid/config';

const contract = Object.fromEntries(
  ['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest']
    .map(key => [key, session[key]])
);
contract.runtimeVersion = runtime.DOPPLER_VERSION;
const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract } } });
const decisions = createDopplerOperationProvider({ config, session, ownership: 'borrowed', runtime });
try {
  const result = await decisions.execute({
    schema: 'doppler.capsule-operation-request/v2',
    operation: { name: 'scoreChoices', version: 1 },
    input: { prompt: formattedPrompt, choices },
    options: { maxSeqLen: 512 },
    assignment: { attemptId },
    limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt },
  }, { signal });
  const scores = runtime.validateChoiceScoringResult(
    { prompt: formattedPrompt, choices, maxSeqLen: 512 }, result.output
  );
  // Application policy decides whether and how to use scores.selectedId.
} finally {
  await decisions.close(); // Cancels and settles this provider's calls.
  await session.close();   // Borrowed session remains the host's responsibility.
}
```

The same operation can back an explicitly allowed agent tool. Tool invocation
still passes configuration and host authorization. A model result never grants
permission or authorizes itself.

## Peer execution

`createDopplerChoiceScoringAdapter(runtime)` from `reploid/doppler` returns a
definition and implementation for the existing host-supplied operation registry.
Merge these with its existing definitions and implementations before constructing
complete-job providers/requesters. Registration creates no disclosure grant. The
new operation admits public text under the existing signed consent, byte limits,
deadlines, cancellation and receipt verification.

Use actual matching runtime exports. The currently pinned split.13 chat library
does not provide this scoring contract. It remains pinned while its replacement's
partition qualification is unresolved; the new operation is explicitly injected
with the tested installed runtime. This does not silently upgrade deployed chat.

## Evidence and limits

The [physical acceptance record](../artifacts/doppler-choice/README.md) uses a
purpose-trained relevance model, an independent CPU implementation, installed
libraries, real browser WebGPU and actual WebRTC between isolated contexts.
The requester loads no model session or artifacts. Node and browser qualifications
are separate. This is one physical machine and whole-request execution.

The retained cases establish query/document relevance on those examples. They do
not establish calibrated probabilities, general truth checking, model training,
capacity pooling or cross-device partition acceptance. Raw scores explicitly
report `calibration: null`. Rejected generation-model screenings remain retained.

Component: Reploid Doppler adapter, complete peer jobs and verification evidence.
Intent: preserved.
Acceptance evidence: linked physical reports, unit tests and installed library acceptance.
Boundary effects: public operation-provider and injected scoring-adapter exports;
model mathematics stay in Doppler and disclosure authority stays with the host.
