# Native signed metadata delivery

Component: hosted-services. Intent: preserved. Boundary effects: native artifact packaging and signed metadata acquisition; Doppler arithmetic and public package pin unchanged.

The genuine signed candidate contains nested logical paths such as `artifacts/program/host/entry.js`. The native consumer attempted to read these as flat model-directory filenames and raised `Plain model filename required`. The new regression failed at that exact boundary before the repair.

Native deliveries now include catalog-pinned files under `/config/model-artifacts/`. Signed non-weight metadata must be bundled; remote-only metadata is rejected at packaging. The native reader keeps flat model-file access constrained and resolves bundled signed metadata independently. All bytes still pass exact size and SHA-256 verification. Weight acquisition remains complete verified pieces; no file-sharing permission is inferred.

Validation: focused native files/delivery/participant and signed source suites. The actual Verification Worker accepts the host/regression (six warnings). The broader browser Worker rejects the trusted packager/test's pre-existing child-process use; its rejection remains separate, as in the earlier native-delivery record. No physical signed-opening pass or public deployment is claimed here.
