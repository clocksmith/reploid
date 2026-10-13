# Journey catalogue integrity

Component: documentation and journey verification. Intent: preserved. Boundary effects: the existing `verify:journeys` entrypoint now validates the Reploid catalogue as well as the Poolday, Zero and X registries. No runtime, public package or deployment changes.

The catalogue requires useful basic answers, source-supported attachment answers or explicit insufficient evidence, and reconciliation of uncertain tool effects before retry. Its matrix now names cancellation ordering and generation endings. DEV-01 covers application-owned ports, public execution and settled shutdown. Flow lengths and family sizes remain flexible.

Validation:

- `npx vitest run --config tests/vitest.config.js --maxWorkers=2 tests/unit/reploid-journey-catalogue.test.js tests/unit/critical-user-journeys.test.js`: 11 tests pass. Negative controls cover ID deletion/duplication, missing/empty fields, absent evidence links, missing files/anchors, repository escapes, unknown scenario references and malformed middle rows. Additional journeys and variable flow lengths pass.
- `npm run verify:journeys`: catalogue integrity plus all three existing registries pass. No numerical, physical or release acceptance follows from these checks.
- `npm run verify:catscan`: all 39 charters pass.
- `node artifacts/journey-catalogue-integrity-20261013/verify-worker.js`: actual Verification Worker passes; exact script hashes and the retained structural warning are in `worker.json`.

`worker-before.json` retains the initial static-analysis rejection: the existing CLI's process exit and regular-expression `.exec` calls matched process-operation patterns. The CLI now reports verification failure by throwing after reporting all errors; equivalent string matching replaces regex `.exec`. The remaining destructuring warning does not report a runtime mutation. The Worker policy is unchanged.

Independent review identified an initial scenario parser that ignored malformed rows after a valid prefix. Parsing the complete table and the malformed-middle-row control close that false pass. These checks establish catalogue integrity, not the semantic validity of every evidence claim or remote link availability.
