# Installed paired-sigmoid candidate

Component: native installed delivery. Intent preserved. The existing packaging
owner exports Reploid `720d3514` with Doppler's standard `c643cd25...` archive
from committed `e9de1568`. This is an isolated numerical-preflight package.
It excludes concurrent peer/API source edits and is not a frozen chat release.

Native archive: `10121d79ae77d4d1bb95cec54893df238c94435e5234e3000cf5cbd01b1e77a9`.
Descriptor: `45362da009305e5c4513a171bc0952c47905a6520840e59419fca92737ea6d33`.
Installed verification compares 108 descriptor entries and all 1,976 runtime
files with the archive. Normal `npm ci` runs outside the checkout. No GPU opens
in this check. The catalog remains the unsigned base; this establishes neither
signed eligibility, numerical qualification nor a successful conversation.

## Reproduction

Use the existing [native delivery recipe](../ordered-native-delivery-20261013/README.md),
substituting the source, runtime and paths in `binding.json`. Each packaging
command log is retained. Before runtime-config generation, the isolated pool
configuration's sole remaining 0.6.27 runtime declaration (ESM) is changed to
0.6.28; `config-override.json` records it. This does not enable or qualify ESM.
Extract the produced native archive into a separate directory and run normal
`npm ci --no-audit --no-fund`. Then:

```sh
node artifacts/sigmoid-native-delivery-20261013/verify-native.js INSTALL_DIRECTORY NATIVE_ARCHIVE OUTPUT_JSON
node artifacts/sigmoid-native-delivery-20261013/verify-worker.js
```

The actual Verification Worker checks the CPU verifier through its existing
`/testing/` capability. Warnings are retained. The physical owner separately
binds the immutable `35362718...` numerical snapshot (fixture source `49b64dcb`)
to these installed native bytes. Fixture and application identities differ
intentionally and must not be conflated.

Boundary effects: isolated package/config and test preparation only. Public
pins, contributors, caches and sharing allowances remain unchanged. The older
three-stage preparation/cleanup failures remain retained; this candidate must
pass its own preparation and exact-byte numerical/lifecycle checks.
