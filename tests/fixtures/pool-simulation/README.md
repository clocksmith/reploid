# Animation reference fixture

This is the former Poolday graph animation, retained for the deterministic frame,
layout, transition, and rendering tests in `tests/unit/pool-home-simulation.test.js`.
It is not an application entry point, served asset, or execution visualization.
The product's active visual adapter is `apps/poolday/ui/pool-home/prism.js`.
Shared event names and participant-slot identifiers still come from the product
contract; the animation's own tuning and topology data live here.

Run the focused regression with:

    npx vitest run --config tests/vitest.config.js tests/unit/pool-home-simulation.test.js
