"""Independent control with the DEPLOYED quantized weights (not Doppler arithmetic).

Model equations: Hugging Face transformers Qwen3_5ForCausalLM on CPU, float32.
Weights: the exact signed Capsule `-c` bytes (Q4_K_M row blocks, F16, F32), decoded by
gguf.dequantize / NumPy, never by Doppler. The deployed LM head is a separately
quantized Q4_K tensor, so the head is loaded untied, as deployed.
KV storage: rounded to IEEE float16 at the cache boundary, as the deployed program
stores K/V (kvDtype f16); attention arithmetic stays float32.
Sampling: greedy argmax after masking Doppler's padTokenId, as sampleCapsuleLogits does.

This separates "quantized weights" from "Doppler GPU arithmetic and distribution":
if this control produces the distributed tokens, the deployed weights (quantization)
explain them; if it produces the bf16 checkpoint's tokens, Doppler's arithmetic does not.

gguf 0.17.1 (pure Python) is loaded from a directory containing only that package,
because the transformers 5.3 environment does not have it installed.

Usage:
  python3 -I q4k-weights-control.py <dir containing gguf/> <capsule dir> <installed catalog>
      <source checkpoint config.json> <doppler-single-machine.json> <distributed-observed.json> <out.json>
"""
import hashlib
import json
import sys
import time
from pathlib import Path

GGUF_DIR, CAPSULE, CATALOG, SOURCE_CONFIG, DOPPLER, OBSERVED, OUT = sys.argv[1:8]
sys.path.append(GGUF_DIR)

import numpy as np  # noqa: E402
import torch  # noqa: E402
import transformers  # noqa: E402
import gguf  # noqa: E402
from gguf import GGMLQuantizationType, dequantize  # noqa: E402
from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5TextConfig  # noqa: E402
from transformers.models.qwen3_5.modeling_qwen3_5 import (  # noqa: E402
    Qwen3_5DynamicCache, Qwen3_5ForCausalLM, Qwen3_5TextRotaryEmbedding)


class StoredHalfCache(Qwen3_5DynamicCache):
    """K/V rounded to float16 at storage, widened to float32 for attention."""

    def update(self, key_states, value_states, layer_idx, *args, **kwargs):
        keys, values = super().update(key_states.half(), value_states.half(), layer_idx, *args, **kwargs)
        return keys.float(), values.float()


def load_json(path):
    with open(path) as handle:
        return json.load(handle)


def build_model():
    catalog = next(m for m in load_json(CATALOG) if m['id'] == 'qwen-3-5-0-8b-q4k-ehaf16')
    expected = {a['path']: a['hash'] for a in catalog['capsule']['artifacts'] if a['path'].startswith('artifacts/model/')}
    root = Path(CAPSULE) / 'artifacts' / 'model'
    manifest_bytes = (root / 'manifest.json').read_bytes()
    assert 'sha256:' + hashlib.sha256(manifest_bytes).hexdigest() == catalog['identity']
    manifest = json.loads(manifest_bytes)
    shards, verified = {}, []
    for index, shard in enumerate(manifest['shards']):
        data = (root / shard['filename']).read_bytes()
        digest = 'sha256:' + hashlib.sha256(data).hexdigest()
        assert digest == expected['artifacts/model/' + shard['filename']], shard['filename']
        shards[index] = data
        verified.append({'file': shard['filename'], 'sha256': digest})
    source = load_json(SOURCE_CONFIG)['text_config']
    assert source['layer_types'] == manifest['inference']['layerPattern']['layerTypes']
    config = Qwen3_5TextConfig(**source)
    config.tie_word_embeddings = False  # deployed head is a separate Q4_K tensor
    config.dtype = 'float32'
    config._attn_implementation = 'eager'
    with torch.device('meta'):
        model = Qwen3_5ForCausalLM(config)
    model.model.rotary_emb = Qwen3_5TextRotaryEmbedding(config, device='cpu')
    wanted = model.state_dict()
    weights, dtypes = {}, {}
    for name, entry in manifest['tensors'].items():
        if not name.startswith('model.language_model.'):
            continue
        key = name.replace('model.language_model.', 'model.', 1)
        if key == 'model.lm_head.weight':
            key = 'lm_head.weight'
        assert key in wanted, key
        spans = entry.get('spans') or [{'shardIndex': entry['shard'], 'offset': entry['offset'], 'size': entry['size']}]
        data = b''.join(shards[s['shardIndex']][s['offset']:s['offset'] + s['size']] for s in spans)
        assert len(data) == entry['size']
        if entry['dtype'] == 'Q4_K_M':
            assert entry['layout'] == 'row'
            array = dequantize(np.frombuffer(data, dtype=np.uint8).copy(), GGMLQuantizationType.Q4_K)
        else:
            assert entry['dtype'] in ('F16', 'F32'), entry['dtype']
            array = np.frombuffer(data, dtype='<f2' if entry['dtype'] == 'F16' else '<f4').astype(np.float32)
        assert np.isfinite(array).all()
        weights[key] = torch.from_numpy(array.copy().reshape(wanted[key].shape))
        dtypes[entry['dtype']] = dtypes.get(entry['dtype'], 0) + 1
    del shards
    model.load_state_dict(weights, strict=True, assign=True)
    model.eval()
    head_dtype = manifest['tensors'].get('model.language_model.lm_head.weight', {}).get('dtype')
    embed_dtype = manifest['tensors']['model.language_model.embed_tokens.weight']['dtype']
    return model, {'shards': verified, 'tensorDtypeCounts': dtypes, 'lmHeadDtype': head_dtype,
                   'embedDtype': embed_dtype, 'tensorCount': len(weights)}


def top5(logits, decode):
    values, ids = torch.topk(torch.from_numpy(logits), 5)
    return [{'tokenId': int(i), 'logit': float(v), 'text': decode(int(i))} for v, i in zip(values, ids)]


def run(model, config, prompt, pad_token, stop_ids, decode, forced=None, max_tokens=1024):
    """Greedy decode with f16 KV storage; with `forced`, feed those tokens instead and
    record the control's argmax at every step (teacher forcing)."""
    cache = StoredHalfCache(config=config)
    input_ids, steps = list(prompt), []
    limit = len(forced) if forced is not None else max_tokens
    for step in range(limit):
        with torch.inference_mode():
            out = model(input_ids=torch.tensor([input_ids]), past_key_values=cache, use_cache=True, logits_to_keep=1)
        logits = out.logits[0, -1].float().numpy().copy()
        if pad_token is not None:
            logits[pad_token] = -np.inf
        argmax = int(logits.argmax())
        best = top5(logits, decode)
        row = {'step': step, 'argmax': argmax, 'argmaxText': decode(argmax), 'top5': best,
               'marginTop1Top2': best[0]['logit'] - best[1]['logit']}
        token = argmax
        if forced is not None:
            token = forced[step]
            row.update({'forcedToken': token, 'forcedText': decode(token),
                        'forcedRank': int((logits > logits[token]).sum()), 'forcedLogit': float(logits[token])})
        steps.append(row)
        input_ids = [token]
        if forced is None and token in stop_ids:
            break
    return steps


def main():
    torch.set_num_threads(4)
    started = time.time()
    doppler, observed = load_json(DOPPLER), load_json(OBSERVED)
    model, weight_report = build_model()
    config = model.config
    contract = doppler['inputs']['tokenContract']
    stop_ids = sorted(set([contract['eosTokenId']] + contract['stopTokenIds']))
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(str(Path(CAPSULE) / 'artifacts' / 'model' / 'tokenizer.json'))
    decode = lambda token: tokenizer.decode([token], skip_special_tokens=False)
    report = {'schema': 'reploid.answer-cause.q4k-weights-control/v1', 'machine': 'mac-host', 'device': 'cpu',
              'versions': {'torch': torch.__version__, 'transformers': transformers.__version__,
                           'gguf': '0.17.1', 'ggufPath': gguf.__file__, 'numpy': np.__version__},
              'precision': {'arithmetic': 'float32', 'kvStorage': 'float16', 'weights': 'deployed bytes decoded to float32'},
              'padTokenMasked': contract['padTokenId'], 'stopTokenIds': stop_ids,
              'weights': weight_report, 'turns': []}
    for index, turn in enumerate(doppler['modes']['orderedThreeStage']['turns']):
        prompt = turn['promptTokenIds']
        distributed = observed['runs']['run-5']['turns'][index]
        greedy = run(model, config, prompt, contract['padTokenId'], stop_ids, decode)
        tokens = [row['argmax'] for row in greedy]
        text = tokenizer.decode([t for t in tokens if t not in stop_ids], skip_special_tokens=False)
        forced = run(model, config, prompt, contract['padTokenId'], stop_ids, decode, forced=turn['tokenIds'])
        disagreements = [row['step'] for row in forced if row['argmax'] != row['forcedToken']]
        first = next((i for i, (a, b) in enumerate(zip(tokens, turn['tokenIds'])) if a != b), None)
        if first is None and len(tokens) != len(turn['tokenIds']):
            first = min(len(tokens), len(turn['tokenIds']))
        report['turns'].append({'label': turn['label'], 'promptTokenCount': len(prompt),
                                'greedy': {'tokenIds': tokens, 'output': text, 'decodeSteps': len(tokens), 'steps': greedy},
                                'greedyEqualsDistributedText': text == distributed['output'],
                                'greedyEqualsDopplerTokens': tokens == turn['tokenIds'],
                                'firstTokenDivergenceFromDoppler': first,
                                'teacherForcedOnDopplerTokens': {'disagreementSteps': disagreements, 'steps': forced}})
        print(json.dumps({'turn': turn['label'], 'steps': len(tokens), 'output': text,
                          'equalsDistributed': text == distributed['output'], 'firstDivergence': first,
                          'forcedDisagreements': disagreements}), flush=True)
    # Supplementary attribution, not the application path:
    # (a) the same deployed body, with the head tied to the deployed F16 embedding as the
    #     source checkpoint ties it (isolates the separately quantized Q4_K LM head);
    # (b) the deployed weights, turn 2 with the turn-1 comment corrected to [4, 8].
    report['supplementary'] = {'note': 'Attribution variants; not the deployed program.'}
    turns = doppler['modes']['orderedThreeStage']['turns']
    corrected = [dict(m) for m in observed['runs']['run-5']['turns'][1]['requestMessages']]
    corrected[1]['content'] = corrected[1]['content'].replace('// Output: [2, 4, 6, 8]', '// Output: [4, 8]')
    rendered = turns[1]['renderedPrompt'].replace('// Output: [2, 4, 6, 8]', '// Output: [4, 8]')
    corrected_ids = tokenizer.encode(rendered, add_special_tokens=False).ids
    steps = run(model, config, corrected_ids, contract['padTokenId'], stop_ids, decode)
    report['supplementary']['deployedTurn2CorrectedHistory'] = {
        'assistantHistory': corrected[1]['content'], 'promptTokenCount': len(corrected_ids),
        'output': tokenizer.decode([s['argmax'] for s in steps if s['argmax'] not in stop_ids]), 'steps': steps}
    print(json.dumps({'variant': 'deployed turn-2 corrected history',
                      'output': report['supplementary']['deployedTurn2CorrectedHistory']['output']}), flush=True)
    deployed_head = model.lm_head.weight
    model.lm_head.weight = model.model.embed_tokens.weight
    tied = []
    for turn in turns:
        steps = run(model, config, turn['promptTokenIds'], contract['padTokenId'], stop_ids, decode)
        tokens = [s['argmax'] for s in steps]
        tied.append({'label': turn['label'], 'output': tokenizer.decode([t for t in tokens if t not in stop_ids]),
                     'tokenIds': tokens, 'firstTokenDivergenceFromDoppler': next(
                         (i for i, (a, b) in enumerate(zip(tokens, turn['tokenIds'])) if a != b), None), 'steps': steps})
        print(json.dumps({'variant': 'deployed body, head tied to deployed F16 embedding', 'turn': turn['label'],
                          'output': tied[-1]['output'], 'firstDivergence': tied[-1]['firstTokenDivergenceFromDoppler']}), flush=True)
    report['supplementary']['deployedBodyTiedF16Head'] = tied
    model.lm_head.weight = deployed_head
    report['seconds'] = round(time.time() - started, 1)
    with open(OUT, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')


if __name__ == '__main__':
    main()
