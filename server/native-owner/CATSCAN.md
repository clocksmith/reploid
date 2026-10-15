# CATSCAN: Native Owner Controls

Parent: [Hosted Services](../CATSCAN.md)

## Target

Native contribution stays within the owner's approved schedule, memory,
bandwidth, power, temperature and foreground limits.

## Authority

- Owns the owner policy file, host sensor detection, the admission gate and
  custody rate pacing for the native participant.
- Excludes cumulative REP-5 allowances, attempt settlement, stopping, rewards
  and wall-power accounting.

## Scope

This directory.

## Contracts

Inputs: an explicit [owner policy](policy.js) file, the
[custody policy](../../self/config/chat-files.json) and host sensors.

Outputs: admission decisions for preparation, new stage attempts and piece
supply; paced custody channels; declared controls, readings and measurements in
native status lines.

## Invariants

- Without a policy no gate exists; behavior is unchanged and logs say "no owner policy".
- Fields have no code defaults; unknown keys fail; equipment and network grants
  are explicit, with workplace approval where applicable.
- A requested control without a readable source rejects new work; a setting
  never claims enforcement.
- Gates refuse only new work. Admitted attempts and granted transfers finish or
  settle; nothing cancels conversations or holds the host awake.
- Missing or stale readings defer.
- Rates start empty, burst at most one custody chunk and stay above the protocol deadline floor.

## Acceptance

Evidence: [owner control tests](../../tests/unit/native-owner-controls.test.js).
Installed and physical qualification remain separate.

## Non-goals

Wall power, GPU termination, wake locks, physical VRAM accounting or UI.

## Freedom

Preserve these boundaries and acceptance.
