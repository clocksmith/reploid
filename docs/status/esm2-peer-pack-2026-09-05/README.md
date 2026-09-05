# ESM-2 peer Pack execution: one physical machine

The [episode](episode.json) records a fresh Chrome 145 receiver reconstructing
the signed Pack envelope and all 24 declared dependencies over RTCDataChannels
from complementary authorized suppliers. A corrupt contribution was rejected,
a supplier departed, and the receiver recovered without an origin or mirror
fallback attempt. The public Reploid runtime service opened Doppler's real Pack
and executed `encodeSequence()` with real weights. All eight frozen reference
checks passed. Sampled pooled/token errors were respectively
0.000512970571081163 and 0.0008977349577942162, below 0.001.

This is one internally operated machine with isolated browser contexts and a
physical Intel gen12lp adapter. It is not independent-operator evidence, a remote
assignment across machines, biological correctness, general numerical
equivalence, a history-value comparison, or proof of other model operations.
The signing key is the explicit Doppler development authority, not a production
publisher identity. Runtime JavaScript remains installed software served locally;
only two pinned device-probe shaders are bootstrapped outside Pack custody.
All model shaders must come from the signed Pack closure.

## Retained bytes and source identity

[index.json](index.json) hashes the retained files and identifies the two weight
shards kept outside Git. [pack/pack.json](pack/pack.json) is the exact signed
envelope, not a reconstruction of it. Every smaller declared artifact is retained
under `pack/`. The index gives immutable download URLs and Pack-bound hashes for
the unchanged weight bytes. [The original source license](attachments/source-license.txt)
is retained with them.

The episode hashes 551 served runtime files and records the source commits and
dirty state. `doppler-runtime.patch` and `reploid-runtime.patch` preserve the
changes and new files needed by those browser sources and proof entrypoints,
relative to the recorded commits. They are not all development changes and do
not qualify rebuilding or publishing a new Pack. Apply them only to separate
checkouts at those exact commits, not over another working tree's edits.

The [incomplete closure failure](attachments/public-pack-incomplete-closure-failure.json)
records the older Pack failing at the missing `rope_precompute.wgsl` boundary.
The [URL contract failure](attachments/browser-url-contract-failure.json) records
an earlier harness input mismatch. Other intermediate browser reports were lost
when Playwright cleared `test-results`; they are not retained evidence here.

## Reproduce

Use Reploid and Doppler checkouts containing the recorded source state, Node 22,
their lockfile dependencies, and Chrome 145 with physical WebGPU and Ed25519.
From Reploid, set absolute paths for `DOPPLER_ROOT` and `PROOF_BROWSER`.
On this observation the executable was Chrome for Testing 145.0.7632.6.
The configuration and flags below are the observed lane, not portability claims.

```bash
export DOPPLER_ROOT=/absolute/path/to/doppler
export PROOF_BROWSER=/absolute/path/to/chrome
node --input-type=module <<'JS'
import { readFile, cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { verifyPeerPackExecution } from './scripts/verify-peer-pack-execution.js';

const retained = resolve('docs/status/esm2-peer-pack-2026-09-05');
const index = JSON.parse(await readFile(resolve(retained, 'index.json'), 'utf8'));
const previous = JSON.parse(await readFile(resolve(retained, 'episode.json'), 'utf8'));
const output = await mkdtemp(resolve(tmpdir(), 'esm2-peer-reproduction-'));
await cp(resolve(retained, 'pack'), resolve(output, 'pack'), { recursive: true });
for (const artifact of index.externalArtifacts) {
  const response = await fetch(artifact.url);
  if (!response.ok) throw new Error(`Weight download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  if (hash !== artifact.hash || bytes.length !== artifact.sizeBytes) throw new Error('Weight integrity failed');
  const file = resolve(output, 'pack', artifact.path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
}
const report = await verifyPeerPackExecution({
  ...previous.config,
  packPath: resolve(output, 'pack/pack.json'),
  dopplerRoot: process.env.DOPPLER_ROOT,
  referencePath: resolve(process.env.DOPPLER_ROOT, 'tools/data/esm2-t12-35m-ur50d-sequence-reference.json'),
  browserExecutablePath: process.env.PROOF_BROWSER,
  outputPath: resolve(output, 'episode.json'),
});
console.log({ passed: report.passed, retainedOutput: output });
if (!report.passed) process.exitCode = 1;
JS
```

Downloading above provisions suppliers before the episode. It does not provide
the receiver an origin fallback: the harness disables model origin access before
receiver acquisition and rejects external requests. The receiver starts with no
IndexedDB or OPFS model cache. A rerun creates new authorization, peer identities,
transfer IDs, attempts, and receipts; it does not replay expired authorizations.
Keep its output outside Playwright's disposable `test-results` directory.

The archive was generated by `scripts/retain-peer-pack-execution.js`, which checks
the episode envelope, every declared artifact, served runtime hashes, and source
base revisions before retaining a new directory. No commit, push, release,
independent recruitment, or model catalog promotion is established by this record.

## Implementation handoff

Component: `doppler.runtime-source.client`, `doppler.runtime-source.gpu.kernels`,
`doppler.runtime-source.inference`, `doppler.runtime-source.config`,
`doppler.repository-tooling`, Reploid, and Poolday Evidence Runtime.
Intent: preserved.
Boundary effects: signed Pack artifact custody now supplies the model shader
closure consumed by real execution; warmed pipeline and RoPE caches cannot
replace that declared closure. Public invocation scopes restore on failure and
stream cleanup. Registry generation preserves unchanged bytes and timestamps.

Acceptance evidence: Doppler `npm run check:green`; Reploid's opt-in
`DOPPLER_TEST_CHECKOUT` handoff integration; 24 focused unit tests; browser custody
and Verification Worker test; module-system, layer, and surface-claim checks;
the retained physical episode; and a successful execution of the reproduction
command above. The reproduction output is locally retained at
`/tmp/esm2-peer-reproduction-aPEDCs/episode.json`, outside Playwright output.
These checks do not imply the full Reploid test suite passed.

The registry-audit skill exposed timestamp churn, which was repaired and checked
with two byte-identical generator runs. Its [remaining 99 findings](../registry-audit-2026-09-05.json)
are 83 orphan-file reports and 16 missing-blueprint reports. The audit is not
clean. No architectural mappings were fabricated to remove those findings.

Remaining network work: remove sequence-only admission assumptions through a
versioned operation contract and per-operation adapters; preserve generation
streaming, cancellation, and attempts; qualify real generation, document
embedding, and reranking Packs; connect the free local document assistant;
demonstrate explicit whole-job delegation on independently operated machines;
and connect admitted history to routing with both frozen scheduler controls and
complete resource accounting. Existing sequence functionality and separate
Research Room, Zero, X, and Change Passport authorities remain intact.
