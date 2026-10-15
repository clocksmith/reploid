# CATSCAN: Service Measurement

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Measure useful service against the capacity kept ready for it, from exported records.

## Authority
Owns capacity-weighted readiness utilization over readiness spans, admission records, attempt outcomes and readiness contracts.
Residents own admission; requesters own attempts and provenance; reward services own contracts; quality policies own satisfaction.

## Scope
This directory.

## Contracts
Inputs: `reploid.readiness-span/v1` spans, resident reservation records, attempt outcomes with optional quality decisions and answer supply, accepted readiness contracts.
Outputs: `reploid.capacity-utilization/v1` per contributor stage, contributor and route; [CLI](../../../../scripts/capacity-utilization.js).

## Invariants
- Uncovered time, undeclared capacity, open admissions and undecided outcomes stay unknown, never zero; affected ratios are null with reasons.
- Only satisfactory completions are useful; failed, cancelled and duplicate work stay counted as consumption.
- Paid readiness requires an accepted contract for that exact stage.
- Hosted and unknown answer supply never count as mesh.
- No prices, plans or funding values; capacity-seconds only.
- Contradictory or overlapping records are refused, not reconciled silently.

## Acceptance
Evidence: [utilization](../../../../tests/unit/capacity-utilization.test.js).
Synthetic records only; physical readiness and quality evidence need separate qualification.

## Non-goals
Admission, pricing, rewards, quality judgment, economic acceptance.

## Freedom
Preserve boundaries and acceptance.
