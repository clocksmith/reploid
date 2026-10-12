# Attachment standalone control

The frozen `input.json` contains the exact two ordered requests from the real
Mac/Suby attachment journey. The proposed control uses installed accepted Doppler
0.6.27 through its public compatibility session, resetting generation state before
each request. It does not repair the prompt or replace the numerical reference.

The first x@128 attempt could not generate: `doppler.open` honored the supplied
8,192-token KV session bound but attempted the manifest's full 262,144-position
RoPE tables. A 134,217,728-byte cosine allocation was rejected with 1,406,276,176
bytes already live under the unchanged 1,420,000,000-byte cap. Model unload and
owned device destruction completed. The exact error and observations are retained
in `budget-rejection.json` and compressed process log. No answers were produced;
this run cannot attribute the attachment failures to distribution or standalone
model behavior. No budget was raised or manifest changed.

The installed `init-rope.js` restricts table extent to the session bound only for
resident partition loading. The numerical owner has been notified of this separate
loading boundary. `replay.mjs` preserves the attempted public operation/options.
