# Verify a trade

A trade here is one split answer: a requester asked for an answer, several
computers each computed part of it, the requester was debited and each stage was
credited. This page lets someone outside the project check a published trade
receipt without trusting whoever ran the ledger.

## What you need

- Node 22 or later. No npm packages, no keys, no account and no network.
- A copy of this repository at the commit the trade names, or later.
- The trade's receipt directory. It holds `receipt.json`, either a Stage 1
  receipt or the `{ receipt, verdict }` file that `scripts/stage1/run.js` writes.
  The public credit policy is inside it (`settlementReplay.policy` of each
  attempt); for an older receipt that lacks it, put the published policy beside
  it as `policy.json`.

## Run it

```sh
node scripts/settlement/verify-trade.js /path/to/receipt-directory
```

Each attempt in the receipt that carries signed settlement records (`split`,
`cancel` and `drop` in a Stage 1 receipt) gets one line, `PASS` or `FAIL`, with
its outcome, debit, payouts per stage key, the policy digest and the
unfinished-answer terms the requester signed. The command exits 0 only when every
attempt passes. `--json` prints the full verdict; `--at ISO_TIME` replays as of
another instant (an attempt still inside its release window is not final yet).

### A package for someone without the repository

`scripts/settlement/outsider-package.js` puts one or more receipts, this
verifier and every file it imports (copied from one commit), the result each
receipt gives now, and one command into a single folder:

```sh
node scripts/settlement/outsider-package.js --manifest MANIFEST.json --out NEW_DIRECTORY
```

The person checking needs only Node. They run `node verify.mjs` in the folder.
It checks every file against `SHA256SUMS`, replays each receipt and compares the
result with `expected.json`. Its `README.md` lists the expected output and the
commit the verifier was copied from. `node verify.mjs --verifier REPLOID` runs
the same check with their own clone instead.

## What it checks

For each attempt, from the records in the receipt:

1. **Signatures.** Every record is checked against the key it carries; a record
   that fails is reported. Participant IDs derive from those keys.
2. **Policy digest.** The policy hashes, as
   [settlement-replay.md](settlement-replay.md#encoding) defines, to the digest
   the requester signed into its terms and the digest the ledger says it ran.
3. **Replay, twice.** The signed terms, acceptances, stage receipts,
   acknowledgments and any stop are replayed by the service's verifier
   (`server/fleet/settlement-replay.js`) and by a second one written from the
   specification alone (`scripts/settlement/independent/replay.js`). Both must
   reach the same outcome, debit and payouts, and the outcome must be final
   (`settled` or `expired`). The second verifier was written by another session
   under the same operator, so agreement shows the code matches its document,
   not that an independent party checked it.
4. **Debit, payouts and journal.** The ledger's recorded charge equals the
   replay's debit, its payout to each stage's computer equals the replay's
   credit, and its journal for the reservation debits the requester and credits
   the stages by exactly those amounts, summing to zero.
5. **Stored replay.** If the receipt stored a replay result, a fresh replay of
   its records gives the same amounts.

Under the provider-relief rules (terms naming
`reploid.unfinished-answer/acknowledged-prefix-provider-relief/v1`) and the
failed-stage rules that new trades sign
(`reploid.unfinished-answer/acknowledged-prefix-failed-stage-forfeits/v1`) the
ledger and the replay must agree exactly. A receipt from before them, whose terms name
`reploid.unfinished-answer/provider-loss-free/v1`, may carry the one older known
difference that [settlement-replay.md](settlement-replay.md#older-rules)
describes: the ledger charged the acknowledged prefix where the replay charges
nothing. The line then says so, and the check still requires that charge to be
split between the stages by the signed weights.

## What a pass does and does not mean

A pass means: the published records, signed by the keys they name, imply exactly
the debit and payouts the ledger posted, under the policy the requester signed.

It does not show:
- who owns a key, or that the stage keys belong to different people;
- that any computation was correct;
- for a receipt without signed accounts, that a stage the receipt places on
  the requester's own account belongs there. Such a stage is neither charged nor
  paid, and that grouping is the publisher's statement: no signed record carries
  it. The command prints the stages it treated this way. A stage wrongly listed
  there would go unpaid and this check would still pass; that stage owner's own
  statement check is what catches it. A receipt whose terms name the requester's
  account and whose acceptances name each stage's (`accounts, each signed by its
  own party` in the output) does not have this gap: the command takes who is
  charged and who is paid from those signatures and compares the ledger's
  journal per account;
- that no party withheld a record. Withholding can only turn an outcome into
  `unknown`, `expired` or a smaller charge;
- when a record was really signed. Every time is written by its own signer. A
  third-party witness that sees the records as they are signed is the real fix
  for that.

## Try it

```sh
node scripts/settlement/verify-trade.js tests/fixtures/stage1-trade
```

`tests/fixtures/stage1-trade` is a receipt from the Stage 1 harness on three
local processes with a fake model runtime (simulated identities on one machine);
it shows the command working, not a real trade.
