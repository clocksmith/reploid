# Homomorphic execution (paused research)

> **Paused research.** This route is off in every build and offered by no surface.
> It is parked until an independent security review and a two-machine end-to-end
> run pass. Nothing here is a product capability or a qualification claim. Moved
> from [confidential-execution.md](../confidential-execution.md), which remains the
> canonical account of protections, routes and who can read what.

## Protected route (research, unavailable)

Source: [`mesh/protected-generation.js`](../../packages/reploid/src/mesh/protected-generation.js)
(protocol), [`inference/protected.js`](../../packages/reploid/src/inference/protected.js)
(API integration), [`server/protected-route/`](../../server/protected-route/) (Node
host ports, the evaluator peer and the links to Doppler's processes). The
backend is Doppler's single-key CKKS prototype in JavaScript
(`tools/privacy-protected/` on Doppler's `protected-route-js` branch, which
also carries `protected-he-split-js`): a JavaScript RNS-CKKS key holder and
requester, and a WebGPU evaluator, whole or split at the `ln2` layer boundary
into stage A (embedding through attention, holding the encrypted KV cache) and
stage B (MLP through the head), on a one-block 32-symbol fixture model. It is a
research fixture, not a catalogued model, and the route is not a product
capability.

Reploid drives Doppler's JavaScript tooling from a Doppler checkout the host
names (`doppler`), never by default:
[`doppler-key-holder.js`](../../server/protected-route/doppler-key-holder.js)
runs `pp.js bridge` as the requester's key holder (a child Node process),
[`doppler-evaluator.js`](../../server/protected-route/doppler-evaluator.js) is the
evaluator engine port over Doppler's `webgpu/evaluator.js` (one address, or a
stage A and a stage B address; it gives both stages a one-time hop token and
never sees the carry ciphertext), and
[`doppler-tooling.js`](../../server/protected-route/doppler-tooling.js) reads the
pins (profile and circuit digests, layout) from Doppler's own constants. Without
a Doppler checkout or a host `openKeyHolder`, `createNodeProtectedExecution`
refuses to open a key holder.

### Enabling it

Nothing in Reploid enables it. A host must construct the port and pass the flag
itself:

```js
import { createInference, createProtectedExecution } from 'reploid/inference';

const protectedExecution = createProtectedExecution({ policy, discover, connect, openCrypto });
const inference = createInference({ resolveRoute, execute, protectedExecution, unreviewedProtectedExecution: true });
```

Without both, `prepare` with `protection: "homomorphic"` throws
`CONFIDENTIAL_EXECUTION_UNAVAILABLE` before discovery, exactly as before, and
`PROTECTED_EXECUTION_STATUS` is `{ available: false, reason: "awaiting
independent security review" }`. The HTTP adapters, the CLI and the chat never
pass the flag, `listCapabilities` reports `homomorphic` as unavailable with that
reason, and `server/fleet/browser-bridge.js` keeps refusing every protection but
`plaintext`. The ports:

- `discover({ signal, model })` returns signed advertisements. It sends no
  content, no prompt length and no model choice the advertisement did not
  already name.
- `connect(endpoint)` returns a frame channel (`send`, `receive`, `close`).
  [`frame-socket.js`](../../server/protected-route/frame-socket.js) carries it over
  TCP; a WebRTC data channel adapter is still to be written.
- `openCrypto({ parameterSet })` returns the requester's key holder. In Node it is
  Doppler's JavaScript `pp.js bridge` as a child process when the host names a
  Doppler checkout, or the host's own `openKeyHolder`; with neither it refuses. The secret
  key is made and kept inside the key holder and never crosses its interface.

### Protocol `reploid.protected-generation/v1`

1. **Advertisement.** The evaluator peer signs a backend descriptor
   (`reploid.protected-backend/v1`) with its Reploid signing identity: protocol,
   backend `doppler-protected-ckks/v1`, engine protocol and implementation,
   scheme, parameter-set id and digest, circuit identity and layout (model
   identity, vocabulary, context, input level, slots, rotations), evaluator
   participant identity and public key, key-epoch policy (longest key lifetime,
   reuse), and the most lanes per session. The requester checks the signature
   and that the key hashes to the named participant.
2. **Eligibility in `prepare`.** The requester's own allowlist decides, never
   the descriptor: allowed protocols and engine protocols, parameter sets by
   digest (with the requester's own record of which are insecure development
   sets), pinned circuits with their layout, each circuit's trap oracle
   (endpoint and pinned Ed25519 keys), a trap-lane count, a largest accepted
   tolerance and a longest key epoch. `prepare` sees no prompt and contacts no
   oracle. It returns the route (one named evaluator, `selection: "one-of"`, and
   a `protected` block with the descriptor, parameter-set and circuit digests,
   the trap source with its oracle keys, and the lane counts) and this
   disclosure (with `extensions.homomorphic.trapOracle`, what the oracle learns):

   ```json
   { "prompt": { "readers": "unknown",
                 "assumptions": ["parameters-not-estimated", "not-independently-reviewed", "requester-key-holder-unchecked"],
                 "verified": false, "check": null },
     "intermediate": { "…": "as prompt" },
     "answer": { "…": "as prompt" },
     "metadata": { "items": ["model-id", "timing", "length"], "readers": [{ "role": "requester-device" }, { "role": "evaluator", "ids": ["peer:…"] },
                   { "role": "carrier" }], "assumptions": [], "verified": false, "check": null },
     "trustAssumptions": ["parameters-not-estimated", "not-independently-reviewed", "requester-key-holder-unchecked",
                          "traps-detect-blind-tampering-only", "trap-oracle-does-not-collude"],
     "review": { "state": "not-reviewed" },
     "extensions": { "homomorphic": {
       "status": { "protection": "target-not-established", "reason": "parameters not estimated; awaiting independent security review" },
       "computedBy": ["peer:…"],
       "leaks": ["model and circuit identity", "prompt length (in the bind offer, before the endpoint proves its key) and generated token count",
                 "lane count", "ciphertext and message sizes", "timing of each step", "session linkage through the key epoch",
                 "after a session, whether a verification failed (through the evaluator lockout and key-epoch rotation): exposure bounded to log2(n + 1) chosen bits per evaluator per key epoch over n sessions, not closed",
                 "evaluator and requester identities and network metadata"],
       "trapOracle": { "learns": ["that a session is starting", "prompt length, generated count and trap count", "request time and network address"],
                       "trusted": "not to collude with the evaluator" } } } }
   ```

   On an insecure development parameter set the same disclosure lists the
   evaluator beside `requester-device` as a reader of the prompt, intermediate
   state and answer, with the single assumption
   `insecure-development-parameters`, and sets
   `extensions.homomorphic.status.protection: "none"`. The route is free
   (`maxCharge: { kind: "free" }`). A request that does not allow all of `model-id`,
   `timing` and `length` is `LEAKAGE_NOT_ALLOWED`. `run` resolves the route again and refuses any change
   (`EXECUTION_PLAN_CHANGED`) before connecting.
3. **Binding before upload.** The requester sends a `bind-offer` signed with a
   fresh signing key: plan id, route id, descriptor digest, evaluator identity,
   requester identity and key, key epoch id and expiry, a 256-bit requester nonce,
   a session expiry, and the schedule (lanes, prompt tokens, generated tokens).
   The evaluator checks that the offer names it and its current descriptor, is
   unexpired, has an unseen nonce and fits its limits, then answers a signed
   `bind-accept` with the offer's digest, a 256-bit evaluator nonce and the digest
   of evaluation keys it already holds for that epoch. The binding digest is the
   hash of the offer and the evaluator nonce; the requester confirms it in a
   signed `bind-confirm`. Only then are evaluation keys (or `keys-held`) and
   ciphertexts sent. The `admitted` event carries the binding digest as the
   admitted route id.
4. **Frames.** Every frame after the offer carries the schema, the binding
   digest, the session id, a per-direction sequence number starting at zero, and
   the size and SHA-256 of each blob, all signed by the sender. The requester
   authenticates before anything else, and only an authenticated, in-sequence
   frame can be held against the evaluator:
   - Ignored (up to 16 per session): junk, wrong schema, bad or missing
     signature, an unsigned `abort`, a frame of another session, a reflected
     requester frame, a replayed old frame. None of these can make the requester
     end or blame anything.
   - Closed with `PROTECTED_SESSION_CLOSED`, not blamed: a signed frame whose
     blob was altered, and a sequence gap.
   - `RESULT_UNVERIFIED`, held against the evaluator: an authenticated frame of
     a kind the requester is not waiting for (it accepts only `bind-accept`,
     `ready`, `result` and a signed `abort`), including a decrypt request.

   The bind offer carries the prompt length and lane count before the endpoint
   has proved its key; the disclosure lists this. Expiries tolerate five
   minutes of clock skew between the two machines. The requester's session
   lasts 25 minutes and the evaluator accepts up to 30.
5. **Steps.** One `step` per generated token: the prefill carries every lane's
   prompt tokens, each decode one token per lane, each a fresh encryption. The
   evaluator returns one logits ciphertext per lane. The schedule is fixed and
   public: no early stop.
6. **State, logs and recovery.** Both sides keep a protected journal separate
   from the plaintext generation journal. Its records are checked against a field
   allowlist (session, binding and descriptor digests, sequence and step numbers,
   trap verdicts and errors, result digests, frame counts and sizes); tokens,
   logits, text and ciphertexts have no field to go in. The evaluator peer logs
   sizes, timings and digests. Recovery never resumes: an unfinished session is
   marked abandoned, and a new plan starts a new session. A failure is never
   retried as readable or local.

### Result verification: secret known-answer traps (v2)

The requester holds no weights, so it cannot recompute an answer, and two
evaluators agreeing proves nothing if they collude. The route checks results
with known-answer traps that the evaluator cannot tell from the real input.

**Why v1 was broken.** Version 1 used a public, signed trap set. An evaluator
that reads the set can compute, on ciphertext and without any key, an indicator
I(x) that is 1 exactly when a lane's prompt is a published trap, and add
(1 − I(x)) · δ to the logits. The perturbation vanishes on every published trap
and corrupts every other input, so every trap passes and every real answer is
wrong. Doppler's evaluator implements this attack (`--misbehave vanish:<set>`),
and the tests show it passing undetected under v1. Any fixed list has the same
flaw. The public set is now ineligible unless a policy sets
`allowPublicTrapSet: true`, which only the comparison tests do.

**v2: a trap oracle.** A party the evaluator cannot see into holds the pinned
public weights and runs Doppler's `privacy-protected trap-oracle`. That party can
be the model publisher or a separate host. For each session:

1. The requester sends `doppler.protected-trap-request/v1`: the circuit digest,
   the prompt length, the generated count, the number of traps, a fresh 256-bit
   nonce and a one-time X25519 public key. It sends nothing about the prompt.
2. The oracle samples fresh trap prompts of that length with the platform
   CSPRNG. For the fixture it draws a third letter progressions (the training
   task), a third sequences the model itself generates from a random start, and a
   third random letters. Nothing comes from a fixed list. It keeps prompts whose
   trajectory stays inside every approximation interval with a top-1 margin of
   at least 2.5. For each it records the greedy continuation and the expected
   logits from the pinned approximate circuit.
3. It encrypts the batch to the requester's one-time key (X25519 with a fresh
   oracle key, HKDF-SHA256 salted with the nonce, AES-256-GCM). It signs a
   header with its Ed25519 key, and the header binds the batch id, the circuit,
   the requester's nonce and key, the oracle's one-time key, the IV, the
   ciphertext digest, the issue time and the expiry (10 minutes).
4. The requester checks the signature against its pinned oracle key, the nonce
   and key binding, the expiry, that the batch id is unused, the digest,
   decryption, and every trap's shape and tolerance. Any failure ends the run
   before anything reaches the evaluator (`EXECUTION_ROUTE_UNAVAILABLE`,
   "Trap batch refused"). A forged, altered, expired or replayed batch never
   opens.
5. The session runs as before. The T traps are placed at random lane indices
   beside the real lane, every lane is a fresh encryption on the same schedule,
   and each step's traps are checked within the tolerance (and on argmax)
   before the real lane is decrypted. A failure is `RESULT_UNVERIFIED`, with
   nothing real decrypted.

The batch is end-to-end encrypted and signed, so any transport can carry it. The
Node host posts it over HTTP
([`requester-host.js`](../../server/protected-route/requester-host.js)). The
requester is anonymous to the oracle. **The oracle learns** that a session is
starting, its prompt length, generated count and trap count, the request time
and the network address. It never learns the prompt, the answer or which
evaluator runs the session. The disclosure says so in `trapOracle`, and the
receipt records the batch id and the oracle key.

**Trust assumption.** The oracle must not collude with the evaluator. An oracle
that tells the evaluator its traps defeats v2 completely: the evaluator then
perturbs only the other lane. This is weaker than verifiable computation. Traps
check a sample of the evaluator's work against outputs the oracle computed, and
prove nothing about the real lane itself. The receipt lists
`trap-oracle-independence-from-the-evaluator` as not verified.

**Detection versus trap ratio.** These odds hold only for an evaluator that
tampers blindly, or by a predicate of the input it cannot aim at traps. An
evaluator that knows the traps (an oracle colluding with it) or the real lane is
never caught. With K = T + 1 lanes:

- An evaluator that tampers lanes it cannot tell apart is caught with
  probability 1 − C(K − T, m) / C(K, m) for m tampered lanes. That is T / K for
  one lane (0.75 at T = 3) and certainty for two or more.
- An evaluator that tampers by input, on some set C of prompts, corrupts a real
  prompt drawn from the oracle's distribution D with probability p = D(C). It is
  caught with probability 1 − (1 − p)^T. Its chance of a silent corruption per
  session is p (1 − p)^T, at most (T/(T+1))^T / (T + 1): 0.25 at T = 1, 0.105 at
  T = 3, 0.049 at T = 7.
- Under v1 a public set made p ≈ 1 with zero detection. Under v2 a perturbation
  that vanishes on fresh traps must also vanish on most real prompts like them.

**Tokens streamed before a failure.** The real index is drawn once per session,
so steps do not compound. From step 2 on, a failing step follows real tokens
that were already decrypted, checked only by earlier steps' traps, and streamed
as `output.delta` events. The run then fails and returns no result, but the
streamed tokens came from an evaluator that was caught tampering: treat them as
unverified. A caller's `cancel()` also ends the schedule early, and the
evaluator sees that.

**What v2 does not catch.**

- Real prompts unlike the oracle's distribution. An attack on rare inputs (small
  p) is rarely caught, and it hurts a requester whose prompt is in that rare set.
  The requester cannot tell the oracle its prompt's style without leaking it.
- Low-margin inputs. Traps are filtered to a top-1 margin of at least 2.5, so
  inputs with smaller margins are never sampled, and an attack confined to them
  is unseen.
- Deviations below the tolerance (0.75 logits), and approximation error of the
  pinned circuit itself.
- An oracle that colludes with the evaluator, or an oracle that is down: the run
  fails, never silently.

**Cost per session**, beyond an unprotected one:

- T more lanes of evaluator compute and upload (K = 4 is four times the work).
- One round trip to the oracle.
- T greedy trajectories of the plaintext circuit on the oracle: about a
  millisecond for the fixture, T × (L + G) forward passes for a real model.
- A batch of T × G × vocabulary expected logits (about 10 KB for the fixture).
- On the requester: one X25519 key generation, one ECDH, HKDF, AES-GCM and one
  Ed25519 verification, a few milliseconds.

Dual evaluation (two evaluators, byte-identical results) remains an optional
extra in Doppler's own requester, not this route's guarantee.

**Trap freshness and revocation.** v1 trap sets carry no expiry and cannot be
revoked, another reason they are ineligible. v2 batches expire 10 minutes after
issue, open once (the requester remembers batch ids until they expire), and are
bound to one request's nonce and one-time key. Revoking an oracle key means
removing it from the requester's pins. The tests and the two-machine script pin
the oracle key out of band: from the seed file the test wrote, or from the
oracle host's own log. They never take it from the endpoint it authenticates.

### Selective failure: the trap verdict as an oracle

A trap verdict depends on the evaluator's output, and the evaluator can make its
output depend on the real input. On ciphertext it can add to every lane a term
that is zero on trap-like inputs and large when the real prompt satisfies a
predicate P of its choosing ("is the prompt exactly `hkn`?"). If the requester
aborted when a trap failed, the abort would reveal P(prompt), one bit per step.
A user retrying would feed a search. The verdict would also be a pass/fail
decryption oracle on evaluator-chosen ciphertexts under the key epoch.

The route's response limits this exposure; it does not close it:

1. **Silent failure.** When a trap fails, the requester stops decrypting
   anything, trap or real. It keeps feeding every lane fresh encryptions on the
   fixed schedule (the real lane gets a dummy token), sends `bye` as usual, and
   only then reports `RESULT_UNVERIFIED` to its caller. The evaluator's view
   (frames, kinds, sizes, schedule, close) is the same as for a passing session.
   Every step decrypts all T traps before judging, so the count of decryptions
   per step does not depend on which trap failed.
2. **Key epoch retired** on any `RESULT_UNVERIFIED`: the key holder deletes the
   stored secret key and epoch, so each key answers at most one failed verdict,
   and the next session makes a new key and uploads new evaluation keys.
3. **Lockout and budget.** A requester does not use an evaluator again for
   `failureLimits.windowSeconds` (default 24 hours) after
   `failureLimits.perEvaluator` failures (default 1). After
   `failureLimits.total` failures in the window (default 3) the whole route is
   closed. The host may persist the record (`failureStore`); otherwise it lasts
   as long as the protected execution object.
4. **No automatic retry.** Nothing in Reploid retries a protected run. The error
   says not to retry automatically, and the lockout makes an immediate retry
   against the same evaluator impossible.
5. **Layouts.** The real lane's index is uniform per session (tested over 4,000
   draws). Re-randomizing it per step was considered and rejected: each lane
   holds its own encrypted KV cache, so moving the real input between lanes
   would need an oblivious permutation on ciphertext.

**Exposure, bounded but not closed.** These channels stay open:

- **Timing within a session.** After a failure the requester skips its
  decryptions, a few milliseconds per lane-step on the fixture against seconds of
  evaluator compute per step. It is small, but not removed.
- **After the session.** The verdict shows through the lockout (the requester
  stops coming back), the rotated key epoch (a new epoch id and a key upload in
  the next session, visible to any colluding evaluator), and whatever the user
  does out of band.

Each of these reveals at most which session first failed. Exposure is
bounded to log2(n + 1) bits per evaluator per key epoch, where n is the number
of sessions that evaluator served under the epoch. A locked-out evaluator gets
nothing more until its window ends, and then only under a new epoch. Colluding
evaluators get at most the sum of these over the evaluators used. The budget
stops the route after `total` failures per window, so at most `total`
evaluators per window see a predicate come out true. The bound is the
requester's own accounting under these mechanisms, not a proof: the
selective-failure leak is limited, not closed, and it is one reason
`homomorphic` stays off.

Each bit is a predicate the evaluator chose, so a targeted guess is confirmed
outright when it is right. The user's own reactions are outside this bound:
retrying the same prompt elsewhere, or rewording it.

### Threat model

- **Keeping content from remote parties is a target, not an established property.** The design
  rests on RLWE with one secret key that never leaves the requester's key
  holder, and aims to hold if every remote party colludes. Nothing here shows
  that it does. The parameters were never security-estimated, the protocol is
  unreviewed, and on the insecure development parameter set
  (`dev-insecure-n12`, used by the tests) there is **no protection**. There,
  the disclosure lists the evaluator as a reader; otherwise its readers beyond
  this device are `"unknown"`. The disclosure and receipts never claim that no
  one else can read the prompt. They state `status.protection`: `none` for
  insecure parameters, `target-not-established` otherwise, and the receipt's
  `evidence.privacy` lists `protection` and `requester-held-key` as not
  verified. The
  evaluator sees the model and circuit identity, the evaluation keys, the prompt
  length, the generated count, ciphertext sizes, per-step timing (the evaluator is not
  constant-time) and network metadata. The requester never returns a decrypted
  value; its next input is a fresh encryption of a token it chose. Publishing
  outputs gives an IND-CPA-D adversary argmax decisions only; key epochs bound
  how much is encrypted under one key.
- **Integrity** is the trap detection above, under the assumption that the trap
  oracle does not collude with the evaluator. The binding prevents a different
  evaluator, a replayed frame or a network attacker from substituting results;
  it does not make the bound evaluator honest.
- **Not covered:** the requester's own device and software, side channels on
  it, the publisher colluding with evaluators (it could tell them the traps),
  denial of service, parameter security (`research-n16` is 1629 bits of QP at
  N = 2^16, compared only with the commonly cited 1772-bit ceiling; never
  estimated), and the JavaScript CKKS code's handling of untrusted ciphertexts and keys.

### Tests

- [`tests/unit/protected-generation.test.js`](../../tests/unit/protected-generation.test.js)
  pins the protocol with in-process fakes (no cryptography): flag off,
  eligibility and leakage, happy path and journal contents, expired and changed
  plans, wrong identity, replay, transit tampering, all-lane lies, decrypt
  request, drop, non-finite real values, offer replay, and a 200-trial
  single-lane liar. Trap v2 cases: the vanishing perturbation undetected under
  v1 and caught under v2, forged or altered batches refused, a stale batch
  replayed into a later session refused, the oracle request carrying only sizes.
  Review cases: silent trap failure (the evaluator's view equal for a fired and
  a quiet predicate), epoch retirement, lockout, failure budget and window,
  uniform real-lane placement, six kinds of injected post-binding frames
  ignored, expiry after waiting, single-field allowlist failures, the flag and
  port gates, the requester's own longest key epoch, and journal value checks
  and recovery.
- [`tests/integration/protected-route.test.js`](../../tests/integration/protected-route.test.js)
  runs real processes when `REPLOID_PROTECTED_DOPPLER_DIR` names a Doppler
  checkout: this process as requester through `reploid/inference`, Doppler's
  JavaScript key holder as its child, Doppler's trap oracle as its own process,
  and evaluator peers over Doppler's WebGPU evaluator (one whole evaluator, and
  a stage A and stage B pair for the split), on the insecure development ring.
  Engine misbehaviours (`lie-all`, `lie-random`, `tamper`, `lie-lane=N`)
  flip bits of result ciphertexts. The vanishing perturbation is a homomorphic
  computation Doppler's JavaScript evaluator does not implement, so the
  evaluator peer refuses `vanish:`; the unit tests cover its trap semantics
  with a fake engine, and the integration test checks the public set (v1) is
  refused unless allowed.
- [`scripts/protected-route-e2e.js`](../../scripts/protected-route-e2e.js) runs
  the requester and an evaluator peer on separate machines over the network,
  with the secure ring by default, whole or split (stage A and stage B on two
  machines).

### The evaluator engine port

The evaluator peer talks to its engine through one port (`describe(profile)`,
`open(schedule)` returning `sendKey`, `keysHeld`, `ready`, `step`, `close`);
Doppler's JavaScript WebGPU evaluator implements it today, whole or split. Any
other evaluator implements the same port, computes the same pinned circuit
(same profile digest and circuit digest, so the same trap oracle applies), returns
one logits ciphertext per lane at the pinned layout, and never constructs a
secret key. Nothing in the protocol, the API or the traps changes.

### Known, unfixed issues

The route is parked. A second session of the same operator reviewed it (not
the independent review). These findings from that review remain open:

- The bind offer sends the prompt length and lane count before the endpoint
  proves its key. This is disclosed, not moved after the key proof.
- The selective-failure exposure is bounded, not closed: the timing residual,
  the lockout and the epoch rotation remain (see above).
- A caller's `cancel()` ends the fixed schedule early, visibly to the evaluator.
- The receipt cannot verify that the secret key stayed in the key holder; it
  records the key holder's report.
- Session linkage: every session in one key epoch carries the same epoch id.
- Traps cover only the oracle's distribution, margins of at least 2.5 and
  deviations above the tolerance (see "What v2 does not catch").
- The descriptor's scheme, implementation label and issue time are not checked
  against the allowlist.
- The key holder's last 2 KB of stderr is quoted into error messages. Its
  contents were not audited.
- Not done: a WebRTC channel adapter, a WebAssembly key holder, the two-machine
  run, a parameter-security estimate and the independent review.

Fixed since the review: an honest disclosure, the abort oracle bounded (silent
failure, epoch retirement, lockout and budget), the gate on
`createProtectedExecution`, abort and other unauthenticated frames verified
before use and never blamed on the evaluator, `maxKeyEpochSeconds`, clock skew
and the expiry recheck, the frame schema, the journal's nested values and
`recover()`, and `request.protected` selecting the protected path.

### Before review

An independent cryptographer reviews the parameters (lattice estimate for the
exact N, Q, P and secret distribution), the protocol (binding, sequence and
replay handling, key-epoch reuse, the trap oracle's channel and its sampling
distribution, trap indistinguishability,
decrypt-after-verify ordering, behaviour on approximation failure, timing
leakage, IND-CPA-D exposure), the implementation (deserialization of
untrusted input, memory handling, side channels on the requester) and this
integration (no readable fallback, state and log separation). Until that review
and the two-machine end-to-end run both pass, the flag stays off, no surface
offers the mode, and `PROTECTED_EXECUTION_STATUS.available` stays false.

Passing that review would qualify only a **single-evaluator** (`selection: "one-of"`)
fixture route. It is a step toward the north star, which [GOALS.md](../../GOALS.md#operating-mission)
states along with what proving it requires.
