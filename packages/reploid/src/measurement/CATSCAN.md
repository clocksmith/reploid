# CATSCAN: Service Measurement

Parent: [Reploid Browser Library](../../CATSCAN.md)

## Target
Measure useful service against the capacity kept ready for it, from exported records.

## Authority
Owns capacity-weighted readiness utilization and the readiness records hosts write and read back.
Residents own admission; requesters own attempts and provenance; reward services own contracts; quality policies own satisfaction; hosts own sinks.

## Scope
This directory.

## Contracts
Inputs: `reploid.readiness-span/v1` spans or copies, reservation records or `reploid.stage-admission/v1` copies, attempt outcomes with optional quality decisions and answer supply, accepted readiness contracts; recorders observe partition and resident states.
Outputs: `reploid.capacity-utilization/v1` per contributor stage, contributor and route; [CLI](../../../../scripts/capacity-utilization.js); record copies.

## Invariants
- Uncovered time, undeclared capacity, open admissions and undecided outcomes stay unknown, never zero; affected ratios are null with reasons.
- Records count only through their last observation; crashes and unobserved gaps while ready stay unknown.
- Records carry identities, times and slot counts, never conversation text, thread/requester identities or error text.
- Only satisfactory completions are useful; failed, cancelled and duplicate work stay counted as consumption.
- Paid readiness requires an accepted contract for that exact stage.
- Hosted and unknown answer supply never count as mesh.
- No prices, plans or funding values; capacity-seconds only.
- Contradictory or overlapping records are refused, not reconciled silently.

## Acceptance
Evidence: [utilization](../../../../tests/unit/capacity-utilization.test.js), [records](../../../../tests/unit/readiness-records.test.js).
Synthetic records and injected sessions only; physical readiness and quality evidence need separate qualification.

## Non-goals
Admission, pricing, rewards, quality judgment, economic acceptance.

## Freedom
Preserve boundaries and acceptance.
