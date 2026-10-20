# CATSCAN: Built-in Activities

Parent: [Browser Runtime](../CATSCAN.md)

## Target
Supply versioned research experiments and games for the shared plugin host.

## Authority
Owns activity rules, frozen protocols and participant projections. Host capabilities
own execution, consent and storage; interfaces render projections.

## Scope
Trusted built-ins in this directory.

## Contracts
Inputs: explicit configurations and recorded events.

Outputs: deterministic transitions, capability requests and participant views.

## Invariants
- No network, storage, credentials or model execution inside plugins.
- Pin models, prompts, conditions and scoring before a trial starts.
- Keep example prompts separate from held-out tasks.
- Retain failed and cancelled work; exclude neither silently.
- Hide assignment and timing until judgment. Reveal only after the whole study.
- Same-model controls are distinct from target-versus-imitation trials.
- A game score is not model identity proof or scientific acceptance.

## Acceptance
Evidence: [imitation tests](../../tests/unit/model-imitation-plugin.test.js).

## Non-goals
Arbitrary downloaded plugins, scientific administration, automated publication or training.

## Freedom
Preserve the plugin capability and evidence contracts.
