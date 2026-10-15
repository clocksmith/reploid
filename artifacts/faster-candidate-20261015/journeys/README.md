# Run 8: installed journeys on placement C (final-10)

**Route:** mac-host Chrome stage 0 (layers 0-7), amd-host native stage 1 (8-15), and a second amd-host
native stage 2 (16-23 with the output head). Both AMD stages share one GPU.

**Harness:** the run-7 harness, unchanged apart from H12, which lets two native stages share a machine (see
`../../signed-completion-journey-20261013/README.md`). The fixtures are the same: prompts, output limits,
sampling, concurrency of 2, timeouts and storage allowances.

**Configs and tools:** configs are in `config/`, written by [make-config.py](make-config.py). Run-8 copies
of the tools are in `tools/`:

- the native launcher with an optional cold private Mesa cache, and `ulimit -c unlimited`;
- the launchers for two natives on amd-host, the stage-0 browser, the supplier and the acquirer;
- the contributor control for stage-addressed loss;
- a Mac health sampler;
- an amd sampler that records both native scopes together.

Room tokens reach the natives only through mode-0600 `--room-token-file`. No token appears in any argv or
journal (`logs/launch-natives-*.txt`). Public contributors (amd-host 4103868 and 4121371) were present and
untouched throughout.

## Attempts

| Attempt | Delivery | Bring-up | Requester (13) | Contributor loss (7) | Contribution (7) | Seeding (7) |
|---|---|---|---|---|---|---|
| a | final-10 attempt 1, Capsule 1 (`e84a2024`) | **failed**: stage 1 refused `rmsnorm_paired.wgsl` as outside the signed closure, after 16 of 21 pipelines in 70.7 s (cold). Stage 2 refused the symlinked model directory ("Model file escapes approved directory") | not run | not run | not run | not run |
| b | final-10 pass 2, Capsule 2 (`5a750ed8`), unrolled state | cold preparation of both stages together: 103.5 s and 103.0 s (21 and 23 pipelines) | **13/13** | **7/7** | **7/7** | not run: superseded by the variant choice |
| **c** | **final-10 pass 3, Capsule 3 (`b1527013`), rolled state (frozen)** | **cold preparation: 90.7 s and 89.1 s; warm (restored natives): 0.15 s** | **13/13** | **7/7** | **7/7** | **7/7** |

Run 8 checks the history separately with `run-7/tools/history-check.mjs`, as in run 7. Both b and c pass:

- one short question from a fresh profile, granted through the one-time permission;
- recipients: the three route peers;
- `reploid-requester-history`: two chained `reploid.ordered-publication/v1` records, sequences 0 and 1,
  terminal `eos-token`;
- after reload, the answer is restored with storage mode `transactional`.

**Attempt c's checks,** from reports `*2026-10-15T04-43-56*`, `*04-55-10*`, `*05-00-00*` and `*06-18-11*`:

- **Requester:**
  - opening, model choice and the one-time recipient permission;
  - selective acquisition: 0 weight requests in every requester profile;
  - streaming, completion and a history-aware follow-up;
  - Copy;
  - reload restores the history and draft with no redispatch;
  - two concurrent independent requesters, with one cancelled in isolation while the neighbor completes
    with EOS and settled cleanup;
  - an explicit Retry after a mid-answer reload: one new attempt naming its route.
- **Contributor loss:**
  - SIGKILL of the output-head stage (`amd-host#2`) while streaming;
  - "A computer disconnected. Retry this answer." 17.3 s later;
  - the lost stage stays unknown;
  - capacity returned 6.4 s after the restore, through a warm preparation of 0.15 s;
  - the explicit Retry generated 111 tokens.
- **Contribution:**
  - sharing within the allowance while chatting;
  - peer acquisition by the amd-host browser through custody;
  - cached-only;
  - reload;
  - competing tabs;
  - interrupted resume;
  - Stop settling a held in-flight piece without cancelling the conversation.

  This reruns REP-12's changed custody storage paths.
- **Full-model seeding** (`full-seeding-2026-10-15T06-18-11-829Z.json`), also a rerun after REP-12:
  - refused with a 64 MiB allowance ("Full-model seeding requires a sufficient cumulative download
    allowance");
  - the resource scope (1.08 GiB kept, at least 1,103 MiB allowance) shown before approval;
  - the mac-host profile seeded the whole model in 11.6 s, charged exactly 1,156,260,602 bytes;
  - the amd-host browser acquired every model file from the seeder in 14 min 47 s (06:19:22 to 06:34:09),
    with 0 origin requests and no failed transfers;
  - reload rebuilt the whole inventory from cache;
  - a bounded grant did not become seeding;
  - Stop settled an in-flight seed 15 ms after the click without cancelling the conversation, with 0
    requests afterwards.

**Settled resources.** Every completed and cancelled attempt settled on every stage. No native or
contributor was left running at settlement; see the settlement section of the top README.

**Runtime caps.** Two natives reached their scope runtime caps. Pass 2's stage 1 reached the 45-minute cap
at 02:41, and the loss-restore of stage 2 reached it at 05:41. Both stopped gracefully. One context
attempt ran during the second gap and failed fast with "Prepared ordered entry unavailable"; it is retained
in `../context/`. Later launches used a 2-hour cap. The last two natives (`1-4`, `2-6`) reached it after
all measurements, idle with 0 unsettled owners, and unloaded.

## Installed answer latency (application timing records)

[summarize-timing.py](summarize-timing.py) reads the application's own `reploid.signed-completion-answer-timing/v2` records:

- requester `attemptMs` is the complete-answer latency;
- first visible text is the time to first token;
- the prompt step and the decode per token come from the coordinator, per stage.

Final-9 placement B is **historical**: run 7, 2026-10-14, the same harness and fixtures (identical prompts,
output lengths, sampling and concurrency). It was not rerun. Its hosts' release checkpoints have advanced
past its sequence-5 history, and its stage 1 is on intel-host.

| Turn (prompt / generated tokens) | Final-9 B (historical) | Run 8 b (pass 2, unrolled) | **Run 8 c (pass 3, rolled, frozen)** |
|---|---|---|---|
| First answer (56 / 100): complete answer | 326.1 s | 116.1 s | **147.8 s** |
| First answer: time to first token | 75.8 s | 17.2 s | **19.3 s** |
| First answer: decode, summed over stages | 2,493 ms/token | 963 ms/token | **1,262 ms/token** |
| Follow-up (189 / 12): complete answer | 291.3 s | 63.9 s | **72.5 s** |
| Follow-up: time to first token | 262.2 s | 52.0 s | **60.2 s** |
| Concurrent neighbor (31 / 51): complete answer | 196.0 s | 63.0 s | **81.1 s** |
| Longest answer (31 / 171): complete answer | 440.9 s | 170.2 s | **227.6 s** |

Per stage, first answer (prompt step; decode per token, with execution in parentheses):

| Stage | Final-9 B | Run 8 b | Run 8 c |
|---|---|---|---|
| 0 | Mac 13.89 s; 404 (391) ms | Mac 8.88 s; 207 (195) ms | Mac 9.09 s; 221 (208) ms |
| 1 | Intel 55.17 s; 1,659 (1,174) ms | AMD 4.09 s; 413 (109) ms | AMD 5.69 s; 624 (88) ms |
| 2 | AMD 6.24 s; 430 (267) ms | AMD 3.80 s; 342 (163) ms | AMD 3.82 s; 417 (137) ms |

**Reading the comparison:**

- **Answer latency** improved 2.2x to 2.6x against final-9 placement B, and time to first token 3.9x.
  Decode fell from 2.5 s per token to about 1.0-1.3 s.
- **b and c compute alike.** Stage execution per token is the same within noise. Pass 3's extra time is in
  each AMD stage's "outside execution" share (305 to 536 ms per token on stage 1): transfer and waiting
  through the coordinator on mac-host. The mac-host to amd-host round trip had a median of 15 ms, 90th
  percentile 26 ms, during b. During c it had a median of 21 ms and 90th percentile 160 ms, with spikes to
  1.5 s (`logs/mac-health.log`).
- **Stage execution time** is now well below transfer time on AMD. The coordinator routes every activation
  through mac-host, so network round trips dominate the remaining per-token cost.

## Both AMD stages together: memory and contention

Both native stage processes ran together throughout. [tools/amd-sampler.py](tools/amd-sampler.py) sampled
both scopes every 2 s, with host GPU memory and MemAvailable ([logs/amd-sampler-c.jsonl](logs/amd-sampler-c.jsonl)).

| Window | Combined scope memory (max) | Per stage | GTT (max) | GPU busy (max) | MemAvailable (min) of 128.8 GB |
|---|---|---|---|---|---|
| Requester journey incl. two concurrent conversations (both natives cold-prepared) | 13.64 GB | 7.28 / 6.39 GB | 2.57 GB | 86% | 41.1 GB |
| 1,588-token prompts, two concurrent requesters (stage 1 cold-prepared, stage 2 warm-restored) | 8.51 GB | 7.58 / 0.97 GB | 2.62 GB | 90% | 45.4 GB |

- **Anonymous memory** is 6.7 GB and 5.6 GB after a cold preparation (`memory.stat`). Mesa's compiler
  holds its heap after compiling and does not return it, so a cold-prepared native stays near 6-7.6 GB.
  A warm-prepared native stays below 1 GB at the 1,588-token context.
- **The ledgers** stay within the 1,420,000,000-byte per-executor ceiling: device allocation peaks are
  125,659,504 and 271,700,368 bytes in the qualification capture.
- **Headroom:** the arrangement fits, at 13.6 GB combined on a host with at least 41 GB available. It is
  not small, and a host with less than about 16 GB free could not hold two cold-prepared stages.
- **Contention:**
  - With two requesters decoding at once, the neighbor's stage execution per token was 196 / 119 / 145 ms
    against 208 / 88 / 137 ms alone.
  - Same-stage execution is serialized. With two 1,588-token prompts, the second requester's Mac prefill
    waited for the first (first token at 723 s against 455 s), and the first requester's second token
    waited for the second prefill.
  - AMD prefill execution was unchanged: 80.5 and 79.1 s against 80.0 s alone.

## Not established

- **Answer usefulness:** independent review is open, as in run 7.
- **Placement B on this candidate:** not run. Intel's cold compile of the rolled state program alone takes
  38.6 s, and a whole Intel stage was not measured.
- **Public promotion:** production signing remains the gate.
