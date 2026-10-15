#!/usr/bin/env python3
"""Build the F32 K/V candidate model directory from the reference's plain manifest (edeb69dd...).

The runtime-only override (session kvcache.kvDtype "f32" on the unchanged manifest) is refused by
Doppler before the first attention: the manifest's attention programs declare kvDtype "f16" and the
precision contract fails closed (out/p1-kvf32.log). This variant states the lane in the manifest
instead:
  - inference.session.kvcache.kvDtype: "f16" -> "f32";
  - kernels attn_decode, attn_head256 and attn_stream (the three F16-KV attention programs) ->
    the registered F32-KV program attention_streaming.wgsl#main, with its file digest and
    precision {kvDtype: "f32"}.
Every other byte of meaning is unchanged: weights, tokenizer, every projection, norm, recurrent,
residual and head program. Shards and tokenizer are symlinked from the unchanged base directory.
Writes <out dir>/variant.json with both identities and the exact changes.

Usage: python3 make-kvf32-model.py <plain manifest.json> <base model dir> <attention_streaming.wgsl> <out dir>
"""
import hashlib
import json
import os
import sys

manifest_path, base_dir, wgsl_path, out_dir = sys.argv[1:5]
PLAIN = 'edeb69dd65cbb26971abf773a95bf6dc219a82942c0951d65e1893d442b607c9'
base_bytes = open(manifest_path, 'rb').read()
if hashlib.sha256(base_bytes).hexdigest() != PLAIN:
    raise SystemExit('plain manifest identity differs')
manifest = json.loads(base_bytes)
wgsl_digest = 'sha256:' + hashlib.sha256(open(wgsl_path, 'rb').read()).hexdigest()
session = manifest['inference']['session']
kernels = manifest['inference']['execution']['kernels']
changes = [{'path': 'inference.session.kvcache.kvDtype', 'from': session['kvcache']['kvDtype'], 'to': 'f32'}]
assert session['kvcache']['kvDtype'] == 'f16'
session['kvcache']['kvDtype'] = 'f32'
for key in ('attn_decode', 'attn_head256', 'attn_stream'):
    before = kernels[key]
    assert before['precision'] == {'kvDtype': 'f16'}, (key, before)
    after = {'kernel': 'attention_streaming.wgsl', 'entry': 'main', 'digest': wgsl_digest, 'precision': {'kvDtype': 'f32'}}
    kernels[key] = after
    changes.append({'path': f'inference.execution.kernels.{key}', 'from': before, 'to': after})
remaining = [key for key, entry in kernels.items() if (entry.get('precision') or {}).get('kvDtype') == 'f16']
assert not remaining, remaining
os.makedirs(out_dir)
variant_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
with open(os.path.join(out_dir, 'manifest.json'), 'wb') as handle:
    handle.write(variant_bytes)
for name in sorted(os.listdir(base_dir)):
    if name in ('manifest.json', 'variant.json'):
        continue
    os.symlink(os.path.join(base_dir, name), os.path.join(out_dir, name))
record = {'schema': 'reploid.precision-recovery-variant/v1', 'baseManifestSha256': PLAIN,
          'variantManifestSha256': hashlib.sha256(variant_bytes).hexdigest(), 'changes': changes}
with open(os.path.join(out_dir, 'variant.json'), 'w') as handle:
    json.dump(record, handle, indent=1)
    handle.write('\n')
print(json.dumps({'variant': record['variantManifestSha256'], 'changes': len(changes)}))
