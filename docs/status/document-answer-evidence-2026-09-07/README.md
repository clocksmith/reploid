# Original physical document-answer evidence

This archive transfers the original Apple-machine evidence previously available
only under `/tmp/reploid-useful-specialization-20260907`. Both `answers-02` and
`answers-03` completed eight physical generation cases but failed to establish
semantic answer support. Their original outputs remain unchanged. `answers-01`
also preserves the earlier interrupted run with unsupported generation options.
This transfer does not repair or qualify the answers.

## Contents

- `reploid-useful-specialization-20260907/answers-02/` and `answers-03/`:
  original `execution.json`, progress, frozen corpus, runner, and captured runtime
  sources. Execution reports retain prompts, outputs, inspections, receipts,
  browser identity, request records, source hashes, and measurements.
- Original evaluation configurations and logs for all three runs.
- `reploid-useful-specialization-20260907/capsule/`: exact signed generation
  Capsule and non-weight artifacts used by these runs.
- `reploid-qwen-adapter-closure/capsule/`: retained Capsule build, distribution,
  custody, release, qualification, and `open-options.json`. Open options contain
  public trusted signers and accepted TargetPlan digests.
- `reploid-qwen-adapter-closure/source/`: source identity, conversion settings,
  license, and acquisition metadata; `reproduction/` includes the original
  hash-checking restoration scripts.
- `omitted-weight-artifacts.json`: identities of twenty-three omitted model
  weight shards. The archive supports diagnosis without downloading weights;
  physical reproduction still requires those exact bytes.

Private signing keys are excluded. Recorded absolute paths identify the original
machine. Preserve these files and create separate configuration copies when
adapting paths, browser flags, or GPU vendor requirements for another host.

## Retrieve and verify

After pulling Reploid, run from its repository root:

```sh
cd docs/status/document-answer-evidence-2026-09-07
shasum -a 256 -c SHA256SUMS
mkdir extracted
tar -xzf evidence.tar.gz -C extracted
python3 - <<'PY'
import hashlib, json
from pathlib import Path
for row in json.loads(Path('files.json').read_text()):
    data = (Path('extracted') / row['path']).read_bytes()
    assert len(data) == row['bytes'], row['path']
    assert hashlib.sha256(data).hexdigest() == row['sha256'], row['path']
print('All archived files verified')
PY
```

Read both `execution.json` files before changing the evaluation. Citation syntax
and successful inference do not establish that a passage supports a claim.
These are generation-with-supplied-passages runs, not end-to-end retrieval tests.
The original reports retain their dirty-source status and served-source hashes.

For physical restoration, provision and convert the pinned source using the
retained source reference and conversion configuration, then run:

```sh
python3 extracted/reploid-qwen-adapter-closure/reproduction/restore-capsule.py \
  extracted/reploid-qwen-adapter-closure /path/to/converted-model /path/to/new-capsule
```

The restoration script verifies every dependency's size and hash before creating
the destination. Configure a new evaluation to use that destination and the
archived `capsule/open-options.json`; do not regenerate signatures or substitute
an unrelated model configuration.

Component: document-answer qualification evidence.
Intent: preserved.
Acceptance evidence: archive extraction verified against `files.json`, original
run bytes compared with archived files, and Capsule digest matched against both
execution reports.
Boundary effects: evidence becomes available through Git; runtime, deployment,
semantic qualification, and independent-operation status are unchanged.

*Last updated: September 2026*
