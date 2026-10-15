#!/usr/bin/env python3
"""Write the precision-recovery session configurations for precision-check.mjs.

Usage: python3 make-configs.py <paired-final.json> <plain manifest.json> <paired model dir> <out dir>

Controls (unchanged programs):
  plain    the reference's plain manifest with its own session (F16 KV, maxSeqLen 8192); no overrides.
  paired   the frozen faster candidate's Capsule TargetPlan runtime config (paired-final.json), unchanged.
Candidates:
  kvf32    plain, with only runtime.inference.session.kvcache replaced by the manifest's own kvcache
           object with kvDtype "f32". Doppler resolves this through its runtime-session-compatibility
           capability rule (kvDtype f32), not through any new code; the receipt records the matched rule.
  splitN   paired layers 0..N-1 with the embedding (partition 0, paired TargetPlan config on the paired
           manifest), plain layers N..23 and the LM head (partition 1, plain manifest defaults). The
           harness narrows the paired boundary activation to its nearest F32 every step (host round trip
           included in the timing). A harness composition, not a Doppler program.
Every configuration dumps the full-attention K/V caches after each request for the separate identity check.
"""
import json
import sys
from pathlib import Path

paired_path, plain_manifest_path, paired_model, out = sys.argv[1:5]
paired = json.loads(Path(paired_path).read_text())
plain_manifest = json.loads(Path(plain_manifest_path).read_text())
out = Path(out)

kvcache = json.loads(json.dumps(plain_manifest['inference']['session']['kvcache']))
assert kvcache['kvDtype'] == 'f16'
kvcache['kvDtype'] = 'f32'

configs = {
    'plain': {'label': 'plain control (manifest defaults)', 'dumpCaches': True},
    'paired': {**paired, 'label': 'paired control (frozen faster candidate, Capsule TargetPlan config)', 'dumpCaches': True},
    'kvf32': {'label': 'plain + F32 K/V cache (session kvcache.kvDtype f32; all else manifest defaults)',
              'sessionOverrides': {'kvcache': kvcache}, 'dumpCaches': True},
}
for split in (12, 16, 20, 23):
    configs[f'split{split}'] = {
        'label': f'paired layers 0-{split - 1} (faster kernels), plain layers {split}-23 + head',
        'split': {'splitLayer': split, 'front': {'modelDir': paired_model, 'runtimeConfig': paired['runtimeConfig']}},
        'dumpCaches': True,
    }
# Sensitivity diagnostics (not candidates): the same splits with a seeded one-F32-step perturbation of a
# fraction of the narrowed boundary values every step (precision-check.mjs perturbBoundary).
for split, probability, seeds in ((16, 1e-4, (1, 2, 3)), (20, 1e-4, (1, 2, 3)), (23, 1e-4, (1, 2, 3)), (20, 1e-3, (1, 2, 3))):
    for seed in seeds:
        base = configs[f'split{split}']
        configs[f'split{split}-p{probability:g}-s{seed}'] = {
            'label': base['label'] + f'; diagnostic boundary perturbation p={probability:g} seed {seed}',
            'split': {**base['split'], 'boundaryPerturbation': {'seed': seed, 'probability': probability}},
            'dumpCaches': False,
        }
for name, config in configs.items():
    path = out / f'{name}.json'
    path.write_text(json.dumps(config, indent=1) + '\n')
    print(path)
