# Isolated 0.6.28 browser delivery preparation

Component: browser delivery. Intent preserved. Boundary effects: isolated
candidate dependency and generated delivery only; the checkout's accepted pin
and public site remain unchanged.

A clean `git archive 37c7bc9f` was exported to
`/var/tmp/reploid-candidate-0.6.28-browser-20261012`. Declared build dependencies
were installed with `npm ci --ignore-scripts`. The existing
`scripts/sync-doppler.js` consumed the clean Doppler `5c2b3188` export, ran
ordinary `npm pack`, installed the archive, and regenerated delivery mirrors.
Its archive hash exactly matches the numerical owner's frozen package:
`102fd0c4900c6744fb7d103a4b3609365b57e8538657bd47b8dfd8e7ac3469e7`.

Public generation/partition contract checks and browser-manifest verification
pass. Existing hosting packaging validates and copies 1,977 files, including
the descriptor. The 1,976 content files bind browser identity
`sha256:48707c0f94c4ef853b6c359a4fd3dd55e48079113a4c78931587c24eb96a3683`.
The [preparation record](browser-preparation.json),
[descriptor](browser-bundle-manifest.json), and [checks](checks.log) retain the
identities and command results. Installation and synchronization logs are also
retained. Dependency audit notices were not repaired by unrelated upgrades.

The isolated candidate also passes all six existing native-delivery and public
partition-contract unit controls; [their output](consumer-controls.log) is
retained. These exercise delivery/contract behavior without opening a GPU.

This is packaging evidence only. The catalog still uses its original verified
manifests; it does not yet select a qualified signed Capsule carrying the paired
execution graph. Signed report/catalog preparation requires the remaining
physical results and a subsequent bundle freeze. No GPU inference, signed
opening, long-conversation acceptance, answer-quality pass or deployment is
claimed by these checks. No synthetic report was substituted for physical
qualification. The native artifact has its own separately recorded descriptor.
