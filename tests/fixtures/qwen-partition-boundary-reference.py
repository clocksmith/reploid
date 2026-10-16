"""Independent F64 layer-0 equations over the retained, hash-checked Q4 bytes."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np

contract_path, input_path, model_path, tools_path, output_path = map(Path, sys.argv[1:])
contract = json.loads(contract_path.read_text())
for entry in contract['inputs'].values():
    with open(entry['path'], 'rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == entry['sha256']

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

reader = module('q4_reader', tools_path / 'qwen-quantized-stream-reference.py')
equations = module('qwen_equations', contract['inputs']['equations']['path'])
manifest = json.loads((model_path / 'manifest.json').read_text())
inventory = json.loads(Path(contract['inputs']['inventory']['path']).read_text())
assert hashlib.sha256((model_path / 'manifest.json').read_bytes()).hexdigest() == inventory['manifestSha256']
weights = reader.RetainedWeights(model_path, manifest, inventory)
config = json.loads(Path(contract['inputs']['sourceConfig']['path']).read_text())['text_config']
assert config['layer_types'][0] == 'linear_attention'
steps = json.loads(input_path.read_text())['steps']
ids = [token for step in steps for token in step]
output_path.mkdir()
rows = {}

def store(name, value):
    rows[name] = value
    np.save(output_path / (name + '.npy'), value, allow_pickle=False)
    return value

x = store('pre_layer_input', weights['embed_tokens.weight'][ids].copy())
w = lambda name: weights['layers.0.' + name]
local = lambda name: w('linear_attn.' + name)
n = store('post_rmsnorm', equations.rms_norm(x, w('input_layernorm.weight'), config['rms_norm_eps']))
qkv = store('post_qkv', n @ local('in_proj_qkv.weight').T)
core = equations.delta_history(qkv, n @ local('in_proj_z.weight').T,
    n @ local('in_proj_a.weight').T, n @ local('in_proj_b.weight').T,
    local('conv1d.weight').squeeze(1), local('A_log'), local('dt_bias'), local('norm.weight'), config)
update = store('post_oproj', core @ local('out_proj.weight').T)
x = store('post_attn', x + update)
n = store('pre_ffn', equations.rms_norm(x, w('post_attention_layernorm.weight'), config['rms_norm_eps']))
gate, up = n @ w('mlp.gate_proj.weight').T, n @ w('mlp.up_proj.weight').T
update = store('ffn_mlp_out', (gate * equations.sigmoid(gate) * up) @ w('mlp.down_proj.weight').T)
store('post_ffn', x + update)
report = {'schema': 'reploid.q4-layer0-independent-reference/v1', 'precision': 'float64',
    'manifestSha256': inventory['manifestSha256'], 'inputs': contract['inputs'], 'tokenIds': ids,
    'tensorReads': weights.reads, 'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'scope': 'Layer-0 mathematical diagnostic only; no whole-model or cross-device acceptance verdict',
    'outputs': {name: {'shape': list(value.shape), 'sha256': hashlib.sha256((output_path / (name + '.npy')).read_bytes()).hexdigest()}
                for name, value in rows.items()}}
(output_path / 'reference.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'completed': True, 'tensorReads': weights.reads}))
