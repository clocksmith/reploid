# Adapters

A LoRA adapter changes one exact base model. Reploid lists, routes and records
adapters by identity; Doppler loads and applies them. This page covers what the
model picker shows, how an adapter keeps its identity through an answer, how to
prepare or serve one, and the held-out evaluation an adapter needs before
Reploid calls it evaluated.

## What the picker shows

Each base model in [`shared/config/chat-models.json`](../shared/config/chat-models.json)
lists `availableAdapters`. An adapter is offered only under the base whose exact
artifact identity it declares (`baseModelIdentity`); names never decide
compatibility. In the picker each adapter sits beneath its base model as its own
choice, and the highlighted adapter shows:

| Field | Source | Kind |
| --- | --- | --- |
| Purpose | `purpose.statement`, with `purpose.source` and its link | Claim by the named source |
| Version | `manifest.version` | Declared |
| Availability | Providers advertising the adapter identity now, and ready distributed routes | Observed now |
| Evaluation | A held-out receipt verified in the browser, or "No evaluation evidence" | Evidence, or its absence |

A base model with no adapters says so. Both link this page.

The catalog's only adapter, Qwen 3.5 0.8B NER JSON LoRA, has publisher-reported
scores and runtime lifecycle observations
([artifacts/lora-first-class-20261016](../artifacts/lora-first-class-20261016/README.md)).
Neither is held-out evaluation, so it shows "No evaluation evidence".

## Identity through an answer

- Selection: an adapter choice is a distinct selection (`<base id>/<adapter id>`)
  carrying the catalog adapter entry. Automatic defaults never choose an adapter.
- Routing: a request names the adapter identity. Only a provider advertising that
  identity is eligible. With none, Send stays disabled ("No computer serves this
  adapter now"), and a request already sent fails with "No contributor serves the
  requested adapter. The base model was not used." It never falls back to the base.
- Result: the provider's Doppler generation evidence reports the adapter it ran;
  the network provider and the conversation workspace reject any mismatch.
- Record: the completed attempt's `execution.adapterIdentities` names the checked
  adapter for whole-model and distributed answers. Execution details show it as
  "Recorded adapter".
- Retry: a retry reuses the failed attempt's request, including its adapter.

## Prepare an adapter for a base model

1. Train a PEFT LoRA externally against the exact source checkpoint of a catalog
   base model (its manifest's `artifactIdentity.sourceRepo` and `sourceRevision`).
   Doppler applies LoRA to `q_proj`, `k_proj`, `v_proj`, `o_proj`, `in_proj_a`,
   `in_proj_b`, `in_proj_qkv`, `in_proj_z`, `out_proj`, `gate_proj`, `up_proj` and
   `down_proj`; it applies none inside mixture-of-experts expert layers.
   The in-product Changes route trains only a bounded fixture-scale adapter
   (Qwen 3.5 0.8B, one `down_proj` layer); see
   [community LoRA](../artifacts/community-lora-20261017/README.md).
2. Publish `adapter_model.safetensors` at an immutable URL pinned to a commit.
3. Compute the catalog entry. The tool hashes the bytes and computes the Doppler
   execution identity with the pinned Doppler loader; it needs no GPU:

   ```bash
   node scripts/prepare-adapter-entry.js --base <catalog model id> \
     --file adapter_model.safetensors --config adapter_config.json \
     --weights-url <immutable https URL> --id <adapter-id> --name "<name>" --version 1.0.0 \
     --purpose "<what it is for>" --purpose-source owner|publisher --purpose-url <source>
   ```

   Run against the published NER adapter bytes, it reproduces that catalog
   entry's identity, size and hash.
4. Add the entry to the base model's `availableAdapters` (a pull request for
   outside contributors). `evaluation` stays `null` until a receipt exists.

## Serve an adapter

- Browser: Run on this device lists each catalog adapter beside the whole models.
  Choosing it reviews the download (base model and adapter) and shares it; the
  device prepares both, runs the readiness check, then advertises the adapter identity.
- Native participant: add `--adapter <adapter id>` to
  `--contribute --execution-mode whole-model --model <base id>`. A readiness
  probe runs the adapter before it is advertised.

## Held-out evaluation

[`self/pool/adapter-evaluation.js`](../apps/poolday/pool/adapter-evaluation.js) defines
`reploid.adapter-evaluation-spec/v1` and `reploid.adapter-evaluation-receipt/v1`.
A spec is frozen before training: task and prompt, pinned data files with
licence, training, selection and held-out splits, the held-out and retention
item lists by digest, metrics and thresholds. A receipt binds the spec hash, the
adapter and base identities, the identities Doppler reported executing, a trainer
and a different evaluator, and per-item counts for both the base model and the
adapter. The verifier recomputes every metric, the paired bootstrap bound and
the outcome, and rejects a receipt that misreports them.

A catalog entry declares `evaluation: { spec: { url, sha256 }, receipt: { url, sha256 } }`
with paths under `/config/adapter-evaluations/`. The browser fetches both,
checks the hashes and runs the verifier. Only a passing result reads "Passed
held-out evaluation"; failing, rejected or unreadable receipts say so.

The first spec,
[`ner-json-people-places-dates-v1`](../apps/poolday/config/adapter-evaluations/ner-json-people-places-dates-v1.json),
uses the existing adapter's stated task for any base model:

| Item | Value |
| --- | --- |
| Data | `tner/ontonotes5` at `cf9ef57a`; OntoNotes 5.0 (LDC2013T19) terms |
| Training | `train00`–`train03`, 59,924 sentences |
| Selection | `valid`, 8,528 sentences, checkpoint choice only |
| Held-out | 1,000 of the 7,578 `test` sentences absent from training and selection (850 with entities, 150 without), seed 20261105 |
| Retention | 500 of the 1,319 GSM8K test problems (MIT), seed 20261106 |
| Pass | adapter micro F1 ≥ 0.85; gain over base ≥ 0.05 with a 95% paired bootstrap lower bound above 0; valid JSON ≥ 99%; retention regression ≤ 2 points |

Item lists hold sentence digests only. To produce a receipt:

```bash
node scripts/adapter-evaluation.js prompts --spec <spec> --data <ontonotes dir> --retention-data <gsm8k dir> --out prompts.jsonl
DOPPLER_SOURCE_URL=<Doppler checkout file URL/> node scripts/adapter-evaluation.js run --spec <spec> --prompts prompts.jsonl \
  --adapter <id> --arm base --model-directory <verified weights> --adapter-file <safetensors> --out base.jsonl
# again with --arm candidate --out candidate.jsonl
node scripts/adapter-evaluation.js score --spec <spec> --data <dir> --retention-data <dir> --adapter <id> \
  --base base.jsonl --candidate candidate.jsonl --run run.json --out receipt.json
node scripts/adapter-evaluation.js verify --receipt receipt.json --spec <spec> --adapter <id>
```

`run.json` names the Doppler runtime, the identities it reported executing, the
trainer with its training-file hashes, and the evaluator. The `run` step needs a
GPU that holds the base model; it has not been exercised by this change.
`freeze` recomputes the frozen item lists from the pinned files.

## 27B and 35B adapters

No adapter or receipt exists for Qwen 3.8 27B or Qwen 3.6 35B A3B, so the
catalog lists none. Requirements to produce them under the spec above:

| | Qwen 3.8 27B | Qwen 3.6 35B A3B |
| --- | --- | --- |
| Training checkpoint | `Qwen/Qwen3.8-27B` at `1d4bf0f2` | Not recorded: the catalog base is a Q4_0 GGUF without an upstream revision |
| Target modules | All twelve Doppler modules | Attention and linear-attention projections only |
| Rank-16 adapter size | 116.7 M parameters, about 233 MB at f16 | 16.3 M parameters, about 33 MB at f16 |
| Training data | 12,000 of the training sentences (15% without entities), about 1.3 M tokens per epoch | Same |
| Training compute, one epoch | About 1.4 × 10¹⁷ FLOP; 4-bit base about 14 GB, about 20 GB peak | About 1.6 × 10¹⁶ FLOP (3 B active); 4-bit base about 18 GB |
| Evaluation | 3,000 Doppler generations; Q4K weights 17.0 GB | 3,000 Doppler generations; weights 19.9 GB |

The 35B adapter additionally needs its source checkpoint recorded and a Doppler
check that PEFT module names apply to the GGUF-sourced tensors with nonzero
effect. Both bases need the OntoNotes licence confirmed before training.
