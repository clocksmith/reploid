# Native application installation outside the checkout

Component: Reploid native application delivery. Intent: preserved.
Boundary effects: root dependency declarations, generated application file
selection and native CLI help. The accepted Doppler pin and browser runtime
are unchanged; no publication or deployment occurred.

The missing boundary was installation: the reusable library package did not
include the application host, and the root did not declare native WebRTC or
WebGPU. Historical physical runs supplied temporary absolute module paths.
Root optional dependencies now declare the exact exercised versions. The
generated native artifact uses the existing dependency-closure collector to
copy canonical application source bytes, catalog piece indexes, and the accepted
Doppler archive. It is not another maintained implementation or compiler bundle.

`npm run package:native` produced the archive described by
`exercised-delivery.json`. On x128, it was extracted outside the checkout at
`/var/tmp/reploid-native-installed-8n7b1i/reploid`. Ordinary `npm ci` installed
12 packages. The CLI used **named** `@roamhq/wrtc`, `ws`, and public Doppler
entrypoints, with no module references into either repository or previous
temporary dependency directories. `installed-runtime.json` compares all
1,897 installed Doppler files against archive SHA256
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`;
all match.

The first connection failed because the example's weight directory did not
exist. `missing-directory.log` retains that failure. After creating the empty
directory, the participant authenticated four existing browser identities,
observed both ready partition offers, and remained idle with file sharing off,
zero supplied bytes and empty weight/cache directories. No GPU provider library
was mapped. `installed-connection.json` retains its process, package paths,
capabilities and shutdown observation. Explicit SIGTERM settled the owned
participant; its supervising SSH command returned exit zero. The owned reverse
tunnel on port 18200 was closed. Other participants were untouched.

Further inspection found that model manifests, like piece indexes, are read
through dynamically constructed catalog paths. A new regression failed because
the first artifact omitted them (`metadata-before.log`). The collector now
includes and verifies both metadata kinds, preserving their validated bytes.
The example also now creates the empty directory and has an external evidence
link. `delivery-comparison.json` records these additions; executable sources,
catalog, package manifest and lockfile bytes are unchanged.

The corrected **85-file** artifact was freshly extracted and installed under
`final/reploid` on x128, then repeated authenticated discovery with a new signing
identity. `final-installed-connection.json` verifies every delivered file and
all 1,897 installed runtime files, four actual peer identities, no GPU mapping,
zero files supplied, empty weight/cache directories, and confirmed exit after
SIGTERM. The supervising command again exited zero. Its raw connection log and
install output are retained. The owned tunnel was closed.

The final archive is
`output/reploid-native-IBf43D/reploid-native-0.1.0.tgz`, SHA256
`f032431dc4416eeaa2d167d8e079c534aa45784dd42e532302aa0970e979a123`.

Ten canonical focused tests cover the unchanged host boundaries, missing dependency
rejection and CLI help from a copied source closure with **no node_modules**.
The actual Verification Worker accepts the native host (`host-worker.json`).
The broader scan rejected the trusted packaging tool's `node:child_process`
invocations of npm and tar (`build-tool-worker-rejection.json`); that rejection
is retained and is not reported as a sandbox pass. No validator was modified.

This check qualifies outside-checkout installation, authenticated discovery,
consent separation and no-GPU shutdown. It does not repeat inference, native
file transfers, signed Capsule physical opening, or numerical/model quality
acceptance. Those remain separately scoped evidence and release gates.
