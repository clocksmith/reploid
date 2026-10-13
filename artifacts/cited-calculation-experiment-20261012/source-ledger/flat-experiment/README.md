# Flat source-role selection experiment

Component: source document quality experiment. Intent preserved; no production changes.

The previous source-ledger run (`10b15e76`) emitted 49 tokens with scalar IDs and string document IDs, then failed the nested document schema. This separate treatment replaces nested objects with flat required role-ID lists. It reuses the exact source catalog, calculator and primary evidence renderer. Validation never repairs output or infers missing facts.

All seven original histories, full factual/citation criteria, model, nonthinking greedy policy, and aggregate caps remain unchanged: 4096 generated tokens, 8192 prompt plus generated tokens, and 16000 raw plus rendered UTF-16 units. The first case is a reused diagnostic; remaining cases have not run in this treatment. Stop at the first completed structural/budget/natural-completion failure and mark the rest unrun. A structurally complete report still requires full manual factual review.

Eight JavaScript controls, five Python controls and the actual Verification Worker pass. Exact tokenizer preflight admits every case with the full 4096-token allowance. Own and reused hashes are bound by freeze.json and checked on the executing host. The original-source loader verifies both weight shards and configuration against the retained source receipt.

Known limits: no quantity multiplication role was added, so the printing-balance requirement may remain unsatisfied. Relation labels and recommendations are not verified by source-span equality. Omitted conditions stay unknown. The unchanged renderer may omit necessary conclusions; no criteria are exempted. This experiment cannot qualify the deployed 0.8B weights or runtime package.

Run only CPU4–7, four threads, nice10 on x128. No GPU, downloads, retries, seed selection or production promotion.

Completed result: **rejected**, two natural-completion calls, zero accepted tasks, five unrun. See [RESULTS.md](RESULTS.md) and [review.json](review.json).
