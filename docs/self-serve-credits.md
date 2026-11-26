# Self-serve accounts and service credits

A person opens replo.id, creates an account, pairs a computer with it by a code
shown in the browser, earns non-cash service credits when that computer answers
for other people, and spends them from the same account in the browser. This
page describes that flow, its abuse limits, what the hosted operator can and
cannot see, and how statements stay checkable.

It reuses the existing pieces. The non-cash ledger is the
[fleet credits service](fleet-service.md) (`server/fleet/credits.js`), run with
an open enrollment journal. The computer is the existing native fleet host
(`server/fleet/native-host.js`). The browser spends through the existing
paired-host bridge and Poolday's Computers and Service credits views. Answers
run through [`reploid/inference`](confidential-execution.md). Nothing here adds
a price, a balance rule or a settlement path, and credits have no cash value.

The exchange described here is executor-readable: the computer that answers
can read the request and the answer. The person sees which computers may
receive a request before sending it. It is not confidential pooling. Earning
on one account and spending from another under the same person shows the
mechanism only; an independent trade needs a second human operator on their own
machine with their own key, and an outside verifier who is a different person.

Source: [`server/fleet/self-serve.js`](../server/fleet/self-serve.js) (accounts
and pairing), [`self-serve-http.js`](../server/fleet/self-serve-http.js)
(routes), [`self-serve-mount.js`](../server/fleet/self-serve-mount.js) (the
off-by-default hosted mount), [`join.js`](../server/fleet/join.js) (the
computer's side), [`fleet-account.js`](../apps/poolday/host/fleet-account.js)
and [`fleet-account-view.js`](../apps/poolday/ui/pool-home/fleet-account-view.js)
(the browser).

## The flow

1. **Sign in and create the account.** Computers › Your account offers
   **Sign in with Google** or **Continue without an email** (the existing
   Firebase sign-in, anonymous or Google). **Create account** makes one account
   for that sign-in subject. Asking again returns the same account.
2. **Pair a computer.** **Pair a computer** shows a single-use code such as
   `7KQ2-M9XD` and the command for the computer that will serve:

   ```sh
   npx reploid join 7KQ2-M9XD
   ```

   The computer creates (or reuses) its Ed25519 key in `~/.reploid/fleet/`,
   claims the code with a signature from that key and prints the key's
   fingerprint. The browser shows the claiming computer's name and the same
   fingerprint. The person compares the two and chooses **Confirm computer**.
   Only then does the ledger enroll the key under the account. The computer
   then writes an owner-only host configuration (`~/.reploid/fleet/host.json`)
   with the hosted room, its room token and the service URL, and prints the
   command that starts it (`reploid-fleet-host` in the native package):

   ```sh
   npx reploid-fleet-host ~/.reploid/fleet/host.json
   ```

   Its model entries point at `~/.reploid/weights/<model id>`, where
   `npx reploid serve` keeps weights.

3. **Earn by serving.** The host joins the hosted room and serves the models
   the service credits, through the existing admission, signed receipts and
   settlement. Each answer it gives another account credits this account.
4. **Spend in the browser.** **Use for answers** connects the tab to the
   paired host's local bridge. The host gives its bridge secret once to the
   replo.id origin for the code it joined with, so nobody types a secret. The
   paired host's models appear under Your private computers. Before Send each
   answer states the most it can cost. The answer is charged to the same
   account, and the account line, recent activity and **Save statement**
   update as it settles.

Further computers pair the same way and share the account's balance. A
computer can be removed from the account; its key's later requests are refused
and its earlier signatures still verify.

### Browser contributors

A browser tab can contribute to the public network today. That path earns
public-pool records, not these service credits. No browser fleet provider
exists, so a browser cannot be enrolled to earn service credits yet. In the
browser this account spends through a paired native host.

## Routes

All routes are under one prefix on the page's own server. Session routes take
the existing Firebase ID token as `Authorization: Bearer …`.

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /v1/fleet/client` | anyone | Published settings: policy terms, starter debt, pairing lifetime, credited models |
| `POST /v1/fleet/account`, `GET /v1/fleet/account` | session | Create or read the account: balance, held, debt limit, what can be spent, computers, open codes |
| `POST /v1/fleet/pairings` | session | A new single-use code |
| `GET /v1/fleet/pairings/:id`, `POST …/confirm`, `POST …/cancel` | session | State and claimant fingerprint, confirmation, cancellation |
| `POST /v1/fleet/join`, `POST /v1/fleet/join/status` | computer, signed by its key | Claim a code; wait for confirmation and receive the room settings |
| `GET /v1/fleet/statement` | session | The account's statement |
| `POST /v1/fleet/computers/revoke` | session | Remove one computer key |
| `POST /v1/fleet` | enrolled key | The existing signed fleet operations: reserve, dispatch, admit, settle, recover, statement and placement |

## Accounts and the ledger

The ledger runs with `openEnrollment: true`. It starts with no operator
enrollment and appends each change to its `fleet_enrollment_log` table: a new
account with its first key, another key, a removed key or a changed debt limit.
Each record is checked as an operator enrollment file is checked: keys are
public only, a participant ID must derive from its key, and a key belongs to
exactly one account. Changes are applied one at a time, and the journal is
replayed in order on restart. A ledger opened with a fixed enrollment cannot
later switch to open enrollment, or back, without a migration.

An account is one ledger account. Its ID is random (`acct-…`), its public
label is `Reploid account XXXX`, and it is its own owner. Every paired computer
is a key on that account, so earning and spending share one balance and no
transfer between accounts exists. Self-dealing earns nothing: a computer cannot
be credited for serving its own account. The account table stores a SHA-256 of
the sign-in issuer and subject, never the provider's user ID.

One limit remains. Placement keeps one capacity observation per ledger account.
Two serving computers on one account therefore replace each other's
observations. Both can still request, and the most recent one is placed.

## Trust and abuse limits

Every account, including a fake one, can borrow up to its debt limit. These
limits bound that loss; they do not prevent fake accounts.

- **Starter debt.** A new account's debt limit is set by the operator's
  `starterDebt`. A verified sign-in (`google.com`, or a password account with a
  verified email) gets `starterDebt.verified`. An anonymous sign-in gets
  `starterDebt.unverified`, normally 0, so it must earn before it can spend.
  Both are at most the policy's `maxDebt`, and the ledger also caps each
  account at `maxDebt`. When an anonymous sign-in links Google, the account's
  limit rises once to the verified amount. Nothing lowers a balance, and
  credits are conserved: every credit has an equal debit, so starter debt is a
  negative balance, not newly issued credit. A shipped policy that omits
  `maxDebt` gets the ledger's policy default; set `starterDebt.verified` no
  higher than that.
- **Network-wide debt cap.** `creditPolicy.maxTotalDebt` bounds what all
  accounts may owe together, counting holds as spent. A reservation that would
  exceed it is refused before anything is sent. This caps the loss to fake
  accounts at `maxTotalDebt` credits, whatever the number of accounts.
- **One account per sign-in subject.** Creating accounts is limited per network
  address (`accountsPerClientPerHour`, default 5).
- **Pairing codes.** Codes have 40 random bits in Crockford base32, last ten
  minutes and work once. Only their hash is stored. An account may hold three
  open codes, ten new codes an hour and eight computers. Claims are limited per
  network address (`claimsPerClientPerTenMinutes`, default 20), so guessing an
  open code is impractical. A claim enrolls nothing. The person must confirm
  the claiming key's fingerprint in the browser, so a code read over someone's
  shoulder or guessed pairs no computer unless the person confirms a
  fingerprint they did not see on their own computer.
- **Spending.** The ledger's existing limits apply to every account:
  `maxPendingPerComputer` unfinished answers, `maxOutputTokens` per answer, a
  hold of the full quote before disclosure, and claim-release windows. Signed
  fleet operations are also limited per network address
  (`fleetRequestsPerMinute`, default 600).
- **Not identity.** An account is a sign-in, not a person. A key is a computer
  enrollment, not hardware attestation. A copied key acts as its computer
  until it is removed. A Google account costs something to create, and that
  cost is the only reason it gets starter debt.

## What the hosted operator can and cannot see

The operator runs the account service, the ledger, signaling and the relay.

The operator **can see**:

- each account's hashed sign-in subject, whether it is verified, its label,
  its computers' public keys, names and fingerprints, and the network address
  of each request;
- every reservation, settlement and balance, with each answer's model, output
  limit, token count, timing, the digest of its input and the signed receipts;
- the room token, and connection metadata on signaling and the relay (timing,
  sizes, participant IDs);
- the pairing codes it issues. Whoever controls replo.id's page can also claim
  a paired host's bridge secret with such a code. The page already acts for the
  person in the browser, so this adds no new reader.

The operator **cannot**:

- read prompts or answers. They travel between the requester's host and the
  provider over WebRTC (DTLS). The ledger receives an input digest and signed
  token counts. The provider that answers reads the content in plaintext, as
  in every [plaintext](confidential-execution.md#threat-model-per-protection-and-route)
  route;
- sign as a computer. Keys stay on the computer, and the service receives only
  public keys;
- move credits without signed evidence. Settlement needs the provider's and
  requester's signatures, so the statement check below fails for an invented
  charge or earning;
- see other people's balances through the API. In the hosted directory
  (`directory: 'own'`), `snapshot` returns only the caller's account, and
  `computers` lists only the caller's account and accounts serving now, under
  their public labels.

The operator can refuse service, withhold settlement, drop a request or enroll
a key it controls into an account. The account view and its statement list
every key and every enrollment change, so a key nobody paired is visible.

## Statements and replay

`GET /v1/fleet/statement`, **Save statement** in Your account, and the host's
existing `statement` command return one statement
(`reploid.fleet-credit-statement/v2`, per owner account; see
[fleet service](fleet-service.md#one-balance-per-owner-account)). It has every journal entry with its
accepted terms, outcome and complete signed evidence, the expired holds, the
policy, the account's debt limit and its enrollment journal. `computers` holds
only the accounts this one dealt with, not the whole enrollment. Check it
offline, without trusting the operator:

```sh
node server/fleet/credit-statement.js /absolute/reploid-account-statement.json
```

`verifyCreditStatement` recomputes the balance from receipts, acknowledgments
and cleanup proofs against the keys in `computers`, and lists any entry whose
proof is missing or mismatched. Pin your own keys with `participantIds`
(the fingerprints in Your account are the first eight hexadecimal characters of
each participant ID), so a statement that substitutes an account's keys fails.
Split answers additionally replay from the participants' own records alone
([settlement replay](settlement-replay.md)). The ledger can prove what it
settled, not that it settled everything: work it never recorded cannot appear
in a statement, and either side can keep its own receipts to compare.

## Operating the hosted service

Off unless `REPLOID_FLEET_SELF_SERVE=enabled`. Then the application server
mounts `/v1/fleet` before its general body parser and reads:

| Setting | Value |
| --- | --- |
| `REPLOID_FLEET_SELF_SERVE_CONFIG` | absolute path of a `reploid.fleet-self-serve-config/v1` file |
| `REPLOID_FLEET_ROOM_TOKEN` | the hosted room token, at least 32 characters, from a secret |
| `REPLOID_FLEET_TEST_SIGN_IN=enabled` | loopback development and tests only; refused in production |

```json
{
  "schema": "reploid.fleet-self-serve-config/v1",
  "databaseFile": "/mnt/fleet/credits.sqlite",
  "accountsFile": "/mnt/fleet/accounts.sqlite",
  "creditPolicy": { "schema": "reploid.service-credit-policy/v1", "version": "replo.id/1", "unit": "noncash-service-credit",
    "creditsPerOutputToken": 1, "maxDebt": 256, "maxTotalDebt": 100000, "maxOutputTokens": 256, "maxPendingPerComputer": 2,
    "maxClockSkewMs": 30000, "maxRequestMs": 300000, "allowSameOwner": false, "wholeModelTerminalCharge": 0,
    "wholeModelUnclaimedReleaseMs": 120000, "partitionUnclaimedReleaseMs": 120000 },
  "placementPolicy": { "maxMeasurementAgeMs": 86400000, "maxObservationAgeMs": 30000, "minResidencyMs": 60000,
    "maxRouteCandidates": 100, "queuedRequestsPerReplica": 2 },
  "models": [{ "id": "qwen-3-5-2b-q4k-ef16-af32", "identity": "sha256:eb2a48400c975389a4ed8a166228cdc0feeca8c56bc85f36604e26c18e303541" }],
  "network": { "serviceUrl": "https://replo.id/v1/fleet", "signalingUrl": "wss://<signaling host>/signal", "roomId": "reploid-swarm-fleet" },
  "starterDebt": { "verified": 256, "unverified": 0 }
}
```

The numbers are an example, not a pricing decision. Both SQLite files must be
on a private local filesystem that survives restarts, with exactly one writer.
The policy and enrollment mode are frozen into the ledger; changing them needs
an explicit migration.

## Evidence

- Unit: [ledger journal, pairing codes, mount and sign-in checks](../tests/unit/fleet-self-serve.test.js),
  [browser account port and view](../tests/unit/fleet-account-view.test.js).
- Integration: [HTTP, `join`, earn, spend, statements, debt caps, removal,
  restart and rate limits](../tests/integration/fleet-self-serve.test.js), with the real ledger, signatures
  and settlement over loopback HTTP.
- Browser journey: [new account, pair, earn, spend, statement](../tests/e2e/self-serve-credit-journey.spec.js).
  The account service, ledger, `join` and browser bridge are real. The native
  host behind the bridge is a fixture that returns fixed text.

None of this establishes real inference, WebRTC between real computers, GPU
cleanup or a deployed service. Those need a physical run against a deployed
revision.
