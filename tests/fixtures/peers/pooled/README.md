# Peer common-weight diagnostic

The JSON fixture is the byte-identical diagnostic profile previously included
in the vendored Doppler runtime. It is retained only for explicit peer comparison.
Its profile and authenticated model identifiers are unchanged; this migration
does not relabel historical artifacts or make the profile a shipping default.
The browser runtime and its manifests intentionally exclude it.

Vendoring excludes this profile through `scripts/doppler-browser-assets.json` and
checks its reviewed SHA-256 before omission. All retained runtime bytes remain
identical to the pinned archive. Its kernel registry therefore keeps historical
reachability labels from that archive; those labels do not select runtime paths.
Hosting rejects a reintroduced profile, and archive verification remains mandatory.
