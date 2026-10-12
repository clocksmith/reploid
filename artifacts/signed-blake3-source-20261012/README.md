# Signed source identity mapping

Component: browser/native partition artifact source. Intent preserved.
The shared resolver now maps a signed SHA256 weight artifact to its exact
BLAKE3 manifest source descriptor without comparing unlike hashes or relabeling
the source. Signed manifest identity, artifact membership, declared weight role,
path, size and source hash remain required. Doppler authenticates the signed
piece index and verifies each acquired piece; this resolver does not claim
whole-shard verification.

Evidence: original failing regression, 29 focused passes and one initially
optional skip, then all five source controls with the actual Doppler reader;
the actual Verification Worker passes with zero errors/warnings. Browser and
native hosts import the same resolver. Physical signed opening remains pending.
