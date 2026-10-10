# Resident contract integration

Component: Reploid model partition coordination and installed Doppler consumer.
Intent: preserved. Boundary effects: public types, admission and recovery capability
reporting; generation arithmetic, frozen reference and 0.001 remain unchanged.

Doppler 0.6.27 is installed from its retained archive, SHA-256
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
The receiver identity fix is `adb55696`. Shared identity validation rejects malformed
model digests, partial placement fields and changed execution/settlement bindings.

Acceptance:

- `installed-signed-opening.json`: public factory, qualification rejection before
  program creation, incompatible descriptors, absent methods, unsupported recovery,
  and cleanup of rejected loaded programs. Synthetic arithmetic only.
- `types.log`: installed public declarations with strict type checking and WebGPU
  declarations; no skipLibCheck and no checkout type paths.
- `contracts.log`: 62 focused tests, including actual signed grant verification.
- `browser.log`: authenticated two-tab conversation, binary RTC transfer,
  independent conversations, cancellation, settlement and history. Injected math.
- `full-tests.log`: 271 passing files, 2,945 passing tests, 29 declared skips.
  The later nine added admission/recovery cases pass in `contracts.log`.
- `layers.log`, `catscan.log`: owning boundary and generated delivery checks.

The first signed-opening invocation failed because it hashed split.1 while checking
0.6.26's pin. The first browser invocation failed on a removed split.1 import.
Both harnesses now follow the installed package; the successful runs above exercise
the current candidate. Physical model acceptance remains a separate result.

Callback isolation is separately exercised in `callback-tests.log` (23 runner
cases) and `callback-browser.log` (authenticated browser conversation). Each
attempt retains one awaited callback and bounded backpressure. GPU steps remain
serialized; no stage-overlap or throughput improvement is claimed.

The installed library check additionally passes without Doppler installed. Its
optional-consumer partition declarations are generated from the installed public
Doppler exports and checked against those exports; they are not a second authored
contract. See [the complete installed report](../library-acceptance/2026-10-10T20-34-35-101Z/report.json), including the Verification Worker and browser consumer.

*Last updated: October 2026*
