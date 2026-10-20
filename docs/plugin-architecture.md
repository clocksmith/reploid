# Research and game plugins

Reploid's built-in activities share a session engine, not their domain rules.
`reploid/plugins` owns version binding, persisted effect intents, cancellation,
record limits and restoration. A plugin supplies an initial state, a deterministic
transition function and a participant projection. A host supplies capabilities
and storage. The screen renders the projection and sends actions.

```
participant action → plugin transition → persisted intent → host capability
                          ↑                                  ↓
participant view ← private session state ← recorded result or failure
```

The first built-in is `/experiments`, **Spot the imitation**. Its rules live in
`self/plugins/model-imitation`; they do not import a network, DOM, storage or
model provider. A game can use the same lifecycle with different actions,
state, scoring and host capabilities; the engine tests exercise a dice game
capability independently of model generation.

## Registration and authority

Only trusted, bundled definitions are registered by the host. This is not a
sandbox for downloaded JavaScript. A manifest identifies the plugin version,
API version, capabilities and finite request/record/deadline limits. An effect
cannot invoke a capability absent from that manifest. The host's capability
port must independently enforce consent and exact model/resource scope.

The research host uses Reploid's existing authenticated whole-request service.
It freezes model identities and currently connected recipients when the person
starts a study. A changed recipient or artifact fails; there is no hosted API,
new credential, local weight download or fallback. Model availability can still
change between setup and execution. Provider preparation and GPU optimization
remain outside the plugin system.

The browser host owns an exclusive Web Lock and private local storage. Before
each capability call, the engine saves its intent. Completion, failure and
cancellation remain in the private record. Restoring a pending call marks it
interrupted instead of automatically charging or executing it again. Closing
waits for the capability to settle after abort; abort is not proof that a remote
GPU immediately stopped. Storage failure prevents subsequent effects.

Configuration and manifest receive a SHA-256 identity before execution. This
binds the recorded protocol; it is not a signed preregistration or a guarantee
against the browser owner editing evidence. Exports contain prompts, outputs,
models, recipients, execution observations, decisions and failures. Sharing an
export is explicit; no results are published automatically.

## First study

The default target is the catalog's Qwen 3.5 0.8B Q4K; the default imitator is
Qwen 3.8 27B Q4K. Being larger is not proof of better performance on every task.
Both models and their identities are selectable before the configuration freezes.

Two target answers supply example material, separate from the four test tasks.
Conditions are prompt-only imitation, example-assisted imitation, and a target
versus target control. Task order, condition assignment and answer side are
randomized independently. The complete two-turn transcripts are prepared before
judging. Rounds and follow-ups then reveal without inference waits, reducing the
timing clue that would otherwise expose a faster model. The participant view
contains no assignments, provider names, per-call timing or partial answers.
Revealing the private export early explicitly breaks blinding. Developer tools
can inspect local state; independent adversarial blinding requires a separate
administrator/judge boundary, which this local pilot does not provide.

Judges choose A, B, both target, or unsure, and record confidence. A follow-up
reveals the same predefined challenge for each arm; this version does not allow
arbitrary adaptive interrogation. Identification and exact task correctness are
separate. Same-model false positives are reported separately from identification.
Truncation, failed execution and unavailable timing must remain visible in the
record rather than being treated as model behavior.

Four rounds are an interaction pilot, not statistical evidence for universal
detectability, human preference, capability concealment, or a useful simulator.
The study has no unprompted larger-model control and no fine-tuned imitation arm.
Those require new frozen protocols. The current transport retains provider-configured
sampling and output limits rather than overriding them per study; missing provider
configuration is not evidence of matched generation settings. A useful research outcome would be
measured agreement in *which failures occur*, including recovery under the same
follow-up, followed by whether application bugs transfer to an imitation.

## Adding an activity

1. Provide a versioned manifest and pure `initialize`, `transition`, `project`
   functions. Keep rule/configuration data beside the definition.
2. Register only necessary host capabilities. Enforce permissions, identities,
   budgets and settlement in those ports, independently of plugin code.
3. Render the participant projection. Keep administrator exports separate.
4. Test interruption, refused capabilities, duplicate/out-of-order actions,
   restore, limits and projection leaks. Physical inference evidence is separate
   from injected capability tests.

Development evidence and reproduction commands are retained in the
[local plugin check](../artifacts/plugin-imitation-20261016/README.md).
The real-provider study has not completed; injected browser responses establish
the interaction contract only.

Component: plugin sessions and built-in activity host. Intent: added explicit
research/game composition without changing model execution or existing chats.
Boundary effects: new `reploid/plugins` entry and `/experiments` route; existing
swarm provider contracts are reused unchanged.
