"""Run one arm of the useful-answer set on CPU: the deployed Q4_K weights or the bf16 source.

Arms (the two CPU arms of ../answer-cause-20261014, reused unchanged in their equations):
  q4k   Hugging Face transformers Qwen3_5ForCausalLM, float32 arithmetic, over the signed
        Capsule `-c` bytes decoded by gguf 0.17.1 (Q4_K_M row blocks, F16, F32), head untied
        as deployed, K/V rounded to float16 at storage. Greedy argmax after masking the pad
        token, stop on the token contract. Same code as scripts/q4k-weights-control.py there,
        which reproduced the delivered tokens exactly.
  bf16  The original Qwen/Qwen3.5-0.8B checkpoint (rev 2fc06364) in
        Qwen3_5ForConditionalGeneration, bf16 weights upcast exactly to float32, greedy
        model.generate as in scripts/hf-reference.py there. The pad token is also masked
        here, as the application masks it; steps where it would have been the argmax are
        counted (padArgmaxSteps).

Application text path for both arms (scripts/doppler-text.mjs): Doppler's own qwen
formatter with thinking off renders the messages, Doppler's bundled tokenizer encodes them,
and Doppler's incremental decoder turns output tokens into the delivered text. For a
two-turn item, turn 2's history holds this arm's own turn-1 text, as the application does.
Each prompt is cross-checked against the official Hugging Face template and tokenizer.

Speed: without flash-linear-attention / causal-conv1d, transformers decodes the 18 linear
attention layers' depthwise causal conv through F.conv1d with 6144 groups, which takes
about 1.1 s per token on this CPU. For single-token decode steps only, the conv is replaced
by an equal batched matmul (torch.bmm) with the same fused multiply-add order. Before any
item runs, the script checks that full-vocabulary logits over 8 decode steps are
bit-identical with and without the replacement (convReplacementCheck); it stops otherwise.

No GPU is used: torch runs on CPU with 4 threads. Reads local files only.

Usage:
  python3 -I run-arm.py <q4k|bf16> <answer-set.json> <doppler package root> <capsule dir>
      <installed catalog> <checkpoint dir> <dir containing gguf/> <answer-cause doppler-single-machine.json> <out.json>
"""
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ARM, SET_PATH, PACKAGE, CAPSULE, CATALOG, CHECKPOINT, GGUF_DIR, DOPPLER_EVIDENCE, OUT = sys.argv[1:10]
assert ARM in ('q4k', 'bf16'), ARM
sys.path.append(GGUF_DIR)

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
import transformers  # noqa: E402
from transformers import AutoTokenizer, LogitsProcessor, LogitsProcessorList  # noqa: E402
from transformers.models.qwen3_5 import modeling_qwen3_5 as qwen  # noqa: E402

HELPER = Path(__file__).resolve().parent / 'doppler-text.mjs'
MODEL_ID = 'qwen-3-5-0-8b-q4k-ehaf16'
CHECK_STEPS = 8


def load_json(path):
    with open(path) as handle:
        return json.load(handle)


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b''):
            digest.update(chunk)
    return digest.hexdigest()


class DopplerText:
    """The application's template, tokenizer and incremental decoder (Node, no GPU)."""

    def __init__(self):
        self.proc = subprocess.Popen(['node', str(HELPER), PACKAGE, CAPSULE], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.ready = self._read()

    def _read(self):
        reply = json.loads(self.proc.stdout.readline())
        if not reply.get('ok'):
            raise RuntimeError(reply.get('error'))
        return reply

    def call(self, **request):
        self.proc.stdin.write(json.dumps(request) + '\n')
        self.proc.stdin.flush()
        return self._read()

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


# ---- q4k arm: copied from ../answer-cause-20261014/scripts/q4k-weights-control.py ----------

class StoredHalfCache(qwen.Qwen3_5DynamicCache):
    """K/V rounded to float16 at storage, widened to float32 for attention."""

    def update(self, key_states, value_states, layer_idx, *args, **kwargs):
        keys, values = super().update(key_states.half(), value_states.half(), layer_idx, *args, **kwargs)
        return keys.float(), values.float()


def build_q4k_model():
    import gguf
    from gguf import GGMLQuantizationType, dequantize
    catalog = next(m for m in load_json(CATALOG) if m['id'] == MODEL_ID)
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
    source = load_json(os.path.join(CHECKPOINT, 'config.json'))['text_config']
    assert source['layer_types'] == manifest['inference']['layerPattern']['layerTypes']
    from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5TextConfig
    config = Qwen3_5TextConfig(**source)
    config.tie_word_embeddings = False  # deployed head is a separate Q4_K tensor
    config.dtype = 'float32'
    config._attn_implementation = 'eager'
    with torch.device('meta'):
        model = qwen.Qwen3_5ForCausalLM(config)
    model.model.rotary_emb = qwen.Qwen3_5TextRotaryEmbedding(config, device='cpu')
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
    return model, {'kind': 'deployed Q4_K bytes decoded by gguf to float32', 'gguf': gguf.__file__,
                   'catalogIdentity': catalog['identity'], 'shards': verified, 'tensorDtypeCounts': dtypes,
                   'lmHeadDtype': manifest['tensors'].get('model.language_model.lm_head.weight', {}).get('dtype'),
                   'embedDtype': manifest['tensors']['model.language_model.embed_tokens.weight']['dtype'],
                   'kvStorage': 'float16', 'arithmetic': 'float32'}


def q4k_generate(model, prompt, contract, max_tokens):
    """Greedy decode with f16 K/V storage, pad masked, stop on the token contract."""
    cache = StoredHalfCache(config=model.config)
    stop_ids = set([contract['eosTokenId']] + contract['stopTokenIds'])
    input_ids, tokens, margins, pad_argmax = list(prompt), [], [], 0
    for _ in range(max_tokens):
        with torch.inference_mode():
            out = model(input_ids=torch.tensor([input_ids]), past_key_values=cache, use_cache=True, logits_to_keep=1)
        logits = out.logits[0, -1].float().numpy().copy()
        if int(logits.argmax()) == contract['padTokenId']:
            pad_argmax += 1
        logits[contract['padTokenId']] = -np.inf
        top = np.partition(logits, -2)[-2:]
        margins.append(float(top[1] - top[0]))
        token = int(logits.argmax())
        tokens.append(token)
        input_ids = [token]
        if token in stop_ids:
            break
    return tokens, margins, pad_argmax


# ---- bf16 arm: as ../answer-cause-20261014/scripts/hf-reference.py -------------------------

def verify_checkpoint():
    rows = []
    meta_dir = os.path.join(CHECKPOINT, '.cache', 'huggingface', 'download')
    for name in sorted(os.listdir(meta_dir)):
        if not name.endswith('.metadata'):
            continue
        target = name[:-len('.metadata')]
        with open(os.path.join(meta_dir, name)) as handle:
            revision, etag = handle.read().split('\n')[:2]
        path = os.path.join(CHECKPOINT, target)
        if len(etag) == 64:
            actual = file_sha256(path)
        else:
            with open(path, 'rb') as handle:
                data = handle.read()
            actual = hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
        rows.append({'file': target, 'revision': revision, 'etag': etag, 'actual': actual, 'match': actual == etag})
    return rows


def build_bf16_model():
    files = verify_checkpoint()
    if not all(row['match'] for row in files):
        raise SystemExit('Local checkpoint differs from the official repository etags')
    model = qwen.Qwen3_5ForConditionalGeneration.from_pretrained(CHECKPOINT, dtype=torch.float32, local_files_only=True)
    model.eval()
    return model, {'kind': 'Qwen/Qwen3.5-0.8B bf16 safetensors upcast to float32', 'checkpointFiles': files,
                   'arithmetic': 'float32', 'kvStorage': 'float32'}


class RecordAndMaskPad(LogitsProcessor):
    """Records the top-1/top-2 margin of each step and masks the pad token."""

    def __init__(self, pad_token):
        self.pad_token, self.margins, self.pad_argmax = pad_token, [], 0

    def __call__(self, input_ids, scores):
        if int(scores[0].argmax()) == self.pad_token:
            self.pad_argmax += 1
        scores = scores.clone()
        scores[:, self.pad_token] = -float('inf')
        top = torch.topk(scores[0].float(), 2).values
        self.margins.append(float(top[0] - top[1]))
        return scores


def bf16_generate(model, prompt, contract, max_tokens):
    eos_ids = sorted(set([contract['eosTokenId']] + contract['stopTokenIds']))
    recorder = RecordAndMaskPad(contract['padTokenId'])
    input_ids = torch.tensor([prompt])
    with torch.no_grad():
        out = model.generate(input_ids=input_ids, attention_mask=torch.ones_like(input_ids), do_sample=False,
                             max_new_tokens=max_tokens, eos_token_id=eos_ids, pad_token_id=248044,
                             logits_processor=LogitsProcessorList([recorder]),
                             temperature=None, top_p=None, top_k=None, repetition_penalty=1.0)
    tokens = out[0, len(prompt):].tolist()
    return tokens, recorder.margins[:len(tokens)], recorder.pad_argmax


# ---- exact replacement for the decode-step depthwise conv ---------------------------------

def exact_decode_conv(hidden_states, conv_state, weight, bias=None, activation=None):
    """torch_causal_conv1d_update for one new token, with bmm instead of grouped F.conv1d."""
    if hidden_states.shape[0] != 1 or hidden_states.shape[-1] != 1 or bias is not None:
        return qwen.torch_causal_conv1d_update(hidden_states, conv_state, weight, bias, activation)
    _, hidden_size, seq_len = hidden_states.shape
    state_len = conv_state.shape[-1]
    combined = torch.cat([conv_state, hidden_states], dim=-1).to(weight.dtype)
    conv_state.copy_(combined[:, :, -state_len:])
    # Every valid output position, laid out [1, C, positions] as F.conv1d returns it, so the
    # slice and SiLU below see the same strides (and take the same kernel path) as the original.
    columns = combined[0].unfold(-1, weight.shape[-1], 1).transpose(1, 2)
    out = torch.bmm(weight[:, None, :], columns).view(1, hidden_size, -1)
    out = F.silu(out[:, :, -seq_len:])
    return out.to(hidden_states.dtype)


def conv_modules(model):
    return [m for m in model.modules() if getattr(m, 'causal_conv1d_update', None) is not None]


def set_conv(model, fn):
    modules = conv_modules(model)
    for module in modules:
        module.causal_conv1d_update = fn
    return len(modules)


def decode_logits(model, prompt, steps):
    cache = StoredHalfCache(config=model.config) if ARM == 'q4k' else None
    rows, input_ids = [], list(prompt)
    for _ in range(steps):
        with torch.inference_mode():
            out = model(input_ids=torch.tensor([input_ids]), past_key_values=cache, use_cache=True, logits_to_keep=1)
        cache = out.past_key_values
        logits = out.logits[0, -1].float().clone()
        rows.append(logits)
        input_ids = [int(logits.argmax())]
    return rows


def conv_replacement_check(model, prompt):
    assert all(m.causal_conv1d_update is qwen.torch_causal_conv1d_update for m in conv_modules(model)), \
        'expected the torch fallback conv (no causal-conv1d package)'
    started = time.time()
    reference = decode_logits(model, prompt, CHECK_STEPS)
    reference_seconds = time.time() - started
    count = set_conv(model, exact_decode_conv)
    started = time.time()
    replaced = decode_logits(model, prompt, CHECK_STEPS)
    replaced_seconds = time.time() - started
    identical = all(torch.equal(a, b) for a, b in zip(reference, replaced))
    result = {'decodeStepsCompared': CHECK_STEPS, 'layersReplaced': count, 'logitsBitIdentical': identical,
              'maxAbsDifference': max(float((a - b).abs().max()) for a, b in zip(reference, replaced)),
              'secondsOriginal': round(reference_seconds, 2), 'secondsReplaced': round(replaced_seconds, 2)}
    print(json.dumps({'convReplacementCheck': result}), flush=True)
    if not identical:
        raise SystemExit('Conv replacement changes logits; refusing to run.')
    return result


# ---- run -------------------------------------------------------------------------------

def main():
    torch.set_num_threads(4)
    started = time.time()
    set_bytes = Path(SET_PATH).read_bytes()
    answer_set = json.loads(set_bytes)
    settings = answer_set['settings']
    limit = settings['promptTokenLimit']
    catalog = next(m for m in load_json(CATALOG) if m['id'] == MODEL_ID)
    generation = catalog['generation']
    assert (generation['temperature'], generation['topK'], generation['topP'], generation['repetitionPenalty'],
            generation['presencePenalty'], generation['stopSequences'], generation['suppressTokenIds']) == (0, 1, 1, 1, 0, [], [])
    max_tokens = generation['maxTokens']
    assert max_tokens == settings['maxTokens'], (max_tokens, settings['maxTokens'])
    contract = load_json(DOPPLER_EVIDENCE)['inputs']['tokenContract']
    manifest = load_json(Path(CAPSULE) / 'artifacts' / 'model' / 'manifest.json')
    assert sorted(contract['stopTokenIds']) == sorted(manifest['eos_token_id']), (contract, manifest['eos_token_id'])

    model, weights = build_q4k_model() if ARM == 'q4k' else build_bf16_model()
    load_seconds = round(time.time() - started, 1)
    generate = q4k_generate if ARM == 'q4k' else bf16_generate
    hf_tokenizer = AutoTokenizer.from_pretrained(CHECKPOINT, local_files_only=True)
    text = DopplerText()

    first_prompt = text.call(op='render', messages=[{'role': 'user', 'content': answer_set['items'][0]['turns'][0]['user']}])['ids']
    check = conv_replacement_check(model, first_prompt)

    report = {'schema': 'reploid.useful-answer-set.arm-run/v1', 'arm': ARM, 'machine': 'mac-host', 'device': 'cpu',
              'threads': torch.get_num_threads(), 'answerSetSha256': hashlib.sha256(set_bytes).hexdigest(),
              'versions': {'torch': torch.__version__, 'transformers': transformers.__version__, 'numpy': np.__version__,
                           'python': sys.version.split()[0], 'doppler': text.ready['dopplerVersion']},
              'model': {'catalogId': MODEL_ID, **weights}, 'loadSeconds': load_seconds,
              'generation': {'source': 'installed catalog generation', **generation, 'decoding': 'greedy'},
              'maxTokensUsed': max_tokens, 'tokenContract': contract, 'promptTokenLimit': limit,
              'chatTemplate': text.ready['chatTemplate'], 'convReplacementCheck': check, 'items': []}
    partial = OUT + '.partial'
    cache = {}
    for item in answer_set['items']:
        messages, turns = [], []
        for index, turn in enumerate(item['turns']):
            messages = messages + [{'role': 'user', 'content': turn['user']}]
            rendered = text.call(op='render', messages=messages)
            prompt = rendered['ids']
            official = hf_tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True,
                                                        enable_thinking=False)
            official_ids = hf_tokenizer(official, add_special_tokens=False).input_ids
            row = {'turn': index + 1, 'messages': messages, 'renderedPrompt': rendered['text'],
                   'promptTokenIds': prompt, 'promptTokenCount': len(prompt),
                   'overPromptLimit': len(prompt) > limit,
                   'officialTemplateEqualsApplication': official == rendered['text'],
                   'hfTokenIdsEqualApplication': official_ids == prompt}
            if index == 0 and len(prompt) > limit:
                raise SystemExit(f"{item['id']}: turn-1 prompt {len(prompt)} tokens exceeds {limit}")
            key = tuple(prompt)
            if key in cache:
                result = dict(cache[key], reusedFrom=cache[key]['itemId'])
            else:
                turn_started = time.time()
                tokens, margins, pad_argmax = generate(model, prompt, contract, max_tokens)
                seconds = time.time() - turn_started
                last = tokens[-1] if tokens else None
                stop_reason = ('eos-token' if last == contract['eosTokenId'] else
                               'stop-token' if last in contract['stopTokenIds'] else 'max-tokens')
                delivered = text.call(op='decode', ids=tokens, stopReason=stop_reason)['text']
                visible = [t for t in tokens if t not in contract['stopTokenIds'] and t != contract['eosTokenId']]
                min_index = int(np.argmin(margins)) if margins else None
                result = {'itemId': item['id'], 'outputTokenIds': tokens, 'output': delivered,
                          'hfDecodeEqualsApplication': hf_tokenizer.decode(visible) == delivered,
                          'stopReason': stop_reason, 'decodeSteps': len(tokens), 'seconds': round(seconds, 2),
                          'tokensPerSecond': round(len(tokens) / seconds, 2) if seconds else None,
                          'minMarginTop1Top2': round(margins[min_index], 4) if margins else None,
                          'minMarginStep': min_index, 'padArgmaxSteps': pad_argmax,
                          'marginsTop1Top2': [round(m, 4) for m in margins]}
                cache[key] = result
            row.update({k: v for k, v in result.items() if k != 'itemId'})
            turns.append(row)
            print(json.dumps({'item': item['id'], 'turn': index + 1, 'promptTokens': len(prompt),
                              'steps': result['decodeSteps'], 'stop': result['stopReason'], 'seconds': result['seconds'],
                              'reused': 'reusedFrom' in result, 'output': result['output'][:160]}, ensure_ascii=False),
                  flush=True)
            if index + 1 < len(item['turns']):
                if not result['output'].strip():
                    row['note'] = 'Empty answer: the application rejects it, so the next turn is not run.'
                    break
                messages = messages + [{'role': 'assistant', 'content': result['output']}]
        report['items'].append({'id': item['id'], 'category': item['category'], 'turns': turns})
        with open(partial, 'w') as handle:
            json.dump(report, handle, ensure_ascii=False)
    text.close()
    report['seconds'] = round(time.time() - started, 1)
    with open(OUT, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    os.remove(partial)


if __name__ == '__main__':
    main()
