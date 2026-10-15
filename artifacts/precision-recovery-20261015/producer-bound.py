#!/usr/bin/env python3
"""Upper bound for any correction confined to the K/V producers, on the installed plain profile.

CPU diagnostic only; nothing feeds back into execution. For every full-attention layer of the
request-2 prefill (184 tokens) it takes the plain GPU run's own captured inputs and recomputes,
with the approved F64 evaluator's own functions (digest-checked) and the unchanged F16 store:

  producer      K = RoPE(k_norm(x @ Wk^T)), V = x @ Wv^T from the captured post_input_norm x:
                the best any compensated K/V projection, K norm or RoPE could do (exact arithmetic,
                same inputs);
  norm+producer the same from rms_norm(previous captured layer output) in F64: additionally an exact
                input normalization.

Each is rounded to nearest F16 and compared with the reference cache bits (the paired capture, whose
caches equal the approved F64 identities). Counts: stored values differing for the plain run itself
and for each ideal producer; how many plain differences each removes (introduced locally) and how
many remain (inherited from upstream). Validation: at layers 3 and 7 the paired probe-fix capture
holds reference-accurate inputs; the same producer from them must reproduce the reference bits.

Usage: python3 producer-bound.py <doppler checkout> <divergence-compare.py> <plain capture dir>
         <paired capture dir> <paired probe-fix capture dir> <model dir> <out.json>
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

EVALUATOR_SHA256 = '90376ddec6e6bf997425ee0e1ecf1d98533434ebbe3f934ff00a878dd49e8bc7'
CONFIG_SHA256 = 'b90b86f35c8e6925ef74ee04d0e758f0a845c83a42089ad82bbaa948de9b4204'

doppler, compare_path, plain_dir, paired_dir, probefix_dir, model_dir, out_path = sys.argv[1:8]
digest = lambda data: hashlib.sha256(data).hexdigest()


def load_module(name, path, expected=None):
    data = Path(path).read_bytes()
    if expected:
        assert digest(data) == expected, f'{path} digest changed'
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, digest(data)


ref, _ = load_module('approved_f64', Path(doppler) / 'tools/qwen35-f64-reference.py', EVALUATOR_SHA256)
cmp, compare_sha = load_module('divergence_compare', compare_path)
config_bytes = (Path(doppler) / 'artifacts/source-model-reference-20261010/source-config.json').read_bytes()
assert digest(config_bytes) == CONFIG_SHA256
config = json.loads(config_bytes)['text_config']
eps, rope = config['rms_norm_eps'], config['rope_parameters']
kv_heads, width = config['num_key_value_heads'], config['head_dim']
rotary = int(width * rope['partial_rotary_factor'])

model_dir = Path(model_dir)
manifest_bytes = (model_dir / 'manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
tensor_identities = {}


def tensor(name):
    entry = manifest['tensors']['model.language_model.' + name]
    spans = entry.get('spans') or [{'shardIndex': entry['shard'], 'offset': entry['offset'], 'size': entry['size']}]
    data = b''.join((model_dir / manifest['shards'][s['shardIndex']]['filename']).read_bytes()[s['offset']:s['offset'] + s['size']]
                    for s in spans)
    assert len(data) == entry['size']
    tensor_identities[name] = {'dtype': entry['dtype'], 'shape': entry['shape'], 'sha256': digest(data)}
    if entry['dtype'] == 'Q4_K_M':
        assert entry['layout'] == 'row'
        array = ref.dequantize(np.frombuffer(data, dtype=np.uint8).copy(), ref.GGMLQuantizationType.Q4_K)
    else:
        assert entry['dtype'] in ('F16', 'F32')
        array = np.frombuffer(data, dtype='<f2' if entry['dtype'] == 'F16' else '<f4')
    return array.reshape(entry['shape']).astype(np.float64)


def producer(x, layer):
    w = lambda name: tensor(f'layers.{layer}.self_attn.{name}')
    key = ref.rms_norm((x @ w('k_proj.weight').T).reshape(len(x), kv_heads, width), w('k_norm.weight'), eps)
    key = ref.text_rope(key, rope['rope_theta'], rotary).reshape(len(x), -1)
    return {'key': key, 'value': x @ w('v_proj.weight').T}


def bits(values):
    return values.astype('<f2').view('<u2')


pd, pr = cmp.load(plain_dir)
qd, qr = cmp.load(paired_dir)
fd, fr = cmp.load(probefix_dir)
plain_ops = cmp.captures(pd, pr, 'prefill', False)
probefix_ops = cmp.captures(fd, fr, 'prefill', True)
plain_cache, ref_cache = cmp.caches(pd, pr, 'cache-after-prefill'), cmp.caches(qd, qr, 'cache-after-prefill')
stack = lambda rows: np.stack([rows[t] for t in sorted(rows)])
full = sorted({int(op.split('.')[1]) for op in plain_ops if op.endswith('attn.k_rope')})
result = {'schema': 'reploid.kv-producer-bound/v1', 'scope': 'CPU diagnostic on retained captures; request 2 prefill (184 tokens)',
          'evaluatorSha256': EVALUATOR_SHA256, 'sourceConfigSha256': CONFIG_SHA256, 'divergenceCompareSha256': compare_sha,
          'modelManifestSha256': digest(manifest_bytes), 'plainCapture': pr['label'], 'referenceCapture': qr['label'], 'layers': []}
for layer in full:
    x_plain = stack(plain_ops[f'layer.{layer}.attn.post_input_norm'])
    previous = stack(plain_ops[f'layer.{layer - 1}.layer.out'])
    x_norm = ref.rms_norm(previous, tensor(f'layers.{layer}.input_layernorm.weight'), eps)
    candidates = {'producer': producer(x_plain, layer), 'normAndProducer': producer(x_norm, layer)}
    validation = None
    if f'layer.{layer}.attn.post_input_norm' in probefix_ops:
        validation = producer(stack(probefix_ops[f'layer.{layer}.attn.post_input_norm']), layer)
    for kind in ('key', 'value'):
        target = ref_cache[(layer, kind)].reshape(len(x_plain), -1)
        actual = plain_cache[(layer, kind)].reshape(len(x_plain), -1)
        plain_differs = actual != target
        row = {'layer': layer, 'kind': kind, 'values': int(target.size), 'plainStoredDiffering': int(plain_differs.sum())}
        for name, values in candidates.items():
            ideal_differs = bits(values[kind]) != target
            row[name] = {'storedDiffering': int(ideal_differs.sum()),
                         'plainDifferencesRemoved': int((plain_differs & ~ideal_differs).sum()),
                         'plainDifferencesRemaining': int((plain_differs & ideal_differs).sum()),
                         'newDifferences': int((~plain_differs & ideal_differs).sum())}
        if validation is not None:
            row['validationFromReferenceInputsDiffering'] = int((bits(validation[kind]) != target).sum())
        result['layers'].append(row)
        print(json.dumps(row), flush=True)
result['tensors'] = tensor_identities
Path(out_path).write_text(json.dumps(result, indent=1) + '\n')
