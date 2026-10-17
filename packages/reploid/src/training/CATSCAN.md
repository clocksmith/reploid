# CATSCAN: Bounded LoRA Training

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Coordinate explicitly authorized individual training and one pooled gradient round.

## Authority
Owns grants, bounded orchestration, participant binding, cancellation and candidate export lifecycle. Doppler owns sample/round identities, gradient production, numerical validation and the shared optimizer update. Hosts own isolated execution, datasets, model preparation and publication decisions.

## Scope
This directory.

## Contracts
Inputs: explicit host ports, immutable policy, selected samples and participants.
Outputs: unapplied candidates and bounded training state. The dedicated training channel reuses authenticated binary framing; it is not model partition execution.

## Invariants
- Discovery and inference contribution never grant training or gradient disclosure.
- Gradients may disclose training data; no privacy-preserving aggregation claim.
- One round binds all assignments and one checkpoint before gradient dispatch.
- Missing/failed contributions never produce a partial optimizer update. No automatic retry of ambiguous work.
- Stop waits for the active borrowed GPU command to settle. Transport cancellation is not GPU termination.
- Training and export cannot evaluate, publish, activate or replace a serving adapter.
- Sessions keep candidates across route changes; page reload does not resume training.

## Acceptance
Evidence: [lifecycle](../../../../tests/unit/lora-training.test.js), [transport](../../../../tests/unit/lora-training-network.test.js), [controls](../../../../tests/unit/lora-training-ui.test.js). Fixtures do not establish GPU or cross-machine qualification.

## Non-goals
Model mathematics, arbitrary layer/model support, durable distributed optimization, adversarial gradient trust and automatic adapter adoption.

## Freedom
Reuse existing authenticated transport and Doppler public contracts without broadening grants.
