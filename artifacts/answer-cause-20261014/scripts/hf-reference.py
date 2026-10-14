"""Independent reference: the original Qwen/Qwen3.5-0.8B checkpoint (bf16 safetensors,
revision 2fc06364) in Hugging Face transformers on CPU.

Checks, per failed turn:
  1. The official chat template (tokenizer_config.json chat_template, non-thinking) renders
     the same text as Doppler's `qwen` formatter, and the HF tokenizer gives the same IDs.
  2. Greedy generation from Doppler's exact prompt token IDs (the app's settings are
     temperature 0, topK 1, topP 1, repetitionPenalty 1, no seed: plain greedy).
     Run in float32 (bf16 weights upcast exactly) and in bfloat16.
  3. Teacher-forced scoring of the distributed output tokens: the reference's argmax,
     the distributed token's rank and the logit margin at each step.
  4. Supplementary, labelled as such: Qwen-recommended non-thinking sampling
     (temperature 0.7, top_p 0.8, top_k 20) over fixed seeds; and turn 2 with the
     turn-1 comment corrected to [4, 8] (greedy).

Run with `python3 -I`. Reads only local files (local_files_only=True).
Usage:
  python3 -I hf-reference.py <checkpoint dir> <doppler-single-machine.json>
      <distributed-observed.json> <out.json>
"""
import hashlib
import json
import os
import sys
import time

import torch
import transformers
from transformers import AutoTokenizer, Qwen3_5ForConditionalGeneration

CHECKPOINT, DOPPLER_PATH, OBSERVED_PATH, OUT_PATH = sys.argv[1:5]
EOS_IDS = [248046, 248044]  # <|im_end|>, <|endoftext|> (text_config.eos_token_id = 248044)
MAX_NEW_TOKENS = 1024       # catalog generation.maxTokens
SAMPLED_SEEDS = list(range(8))


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b''):
            digest.update(chunk)
    return digest.hexdigest()


def git_blob_sha1(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


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
        actual = file_sha256(path) if len(etag) == 64 else git_blob_sha1(path)
        rows.append({'file': target, 'revision': revision, 'etag': etag,
                     'kind': 'lfs-sha256' if len(etag) == 64 else 'git-blob-sha1',
                     'actual': actual, 'match': actual == etag})
    return rows


def bytes_to_unicode():
    bs = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, map(chr, cs)))


BYTE_ENCODER = bytes_to_unicode()


def delta_to_token_id(tokenizer, vocab, text):
    piece = ''.join(BYTE_ENCODER[b] for b in text.encode('utf-8'))
    return vocab.get(piece)


def top5(logits, tokenizer):
    values, ids = torch.topk(logits.float(), 5)
    return [{'tokenId': int(i), 'logit': float(v), 'text': tokenizer.decode([int(i)])} for v, i in zip(values, ids)]


def greedy(model, tokenizer, prompt_ids, label):
    started = time.time()
    input_ids = torch.tensor([prompt_ids])
    with torch.no_grad():
        out = model.generate(input_ids=input_ids, attention_mask=torch.ones_like(input_ids), do_sample=False,
                             max_new_tokens=MAX_NEW_TOKENS, eos_token_id=EOS_IDS, pad_token_id=248044,
                             output_logits=True, return_dict_in_generate=True,
                             temperature=None, top_p=None, top_k=None, repetition_penalty=1.0)
    generated = out.sequences[0, len(prompt_ids):].tolist()
    steps = []
    for index, token_id in enumerate(generated):
        logits = out.logits[index][0]
        best = top5(logits, tokenizer)
        steps.append({'step': index, 'tokenId': token_id, 'text': tokenizer.decode([token_id]), 'top5': best,
                      'marginTop1Top2': best[0]['logit'] - best[1]['logit']})
    text_ids = [t for t in generated if t not in EOS_IDS]
    result = {'label': label, 'tokenIds': generated, 'output': tokenizer.decode(text_ids),
              'decodeSteps': len(generated), 'stoppedOn': generated[-1] if generated and generated[-1] in EOS_IDS else None,
              'seconds': round(time.time() - started, 1), 'steps': steps}
    print(json.dumps({k: result[k] for k in ('label', 'decodeSteps', 'stoppedOn', 'seconds', 'output')}), flush=True)
    return result


def teacher_forced(model, tokenizer, prompt_ids, output_ids):
    sequence = torch.tensor([prompt_ids + output_ids])
    with torch.no_grad():
        logits = model(input_ids=sequence, attention_mask=torch.ones_like(sequence)).logits[0]
    rows, first_disagreement = [], None
    for index, token_id in enumerate(output_ids):
        row_logits = logits[len(prompt_ids) - 1 + index].float()
        argmax = int(torch.argmax(row_logits))
        rank = int((row_logits > row_logits[token_id]).sum())
        best = top5(row_logits, tokenizer)
        row = {'step': index, 'distributedTokenId': token_id, 'distributedText': tokenizer.decode([token_id]),
               'referenceArgmax': argmax, 'referenceArgmaxText': tokenizer.decode([argmax]),
               'distributedTokenRank': rank, 'distributedTokenLogit': float(row_logits[token_id]),
               'top5': best, 'marginTop1Top2': best[0]['logit'] - best[1]['logit']}
        rows.append(row)
        if first_disagreement is None and argmax != token_id:
            first_disagreement = index
    return {'agreesAtEveryStep': first_disagreement is None, 'firstDisagreementStep': first_disagreement, 'rows': rows}


def sampled(model, tokenizer, prompt_ids):
    runs = []
    input_ids = torch.tensor([prompt_ids])
    for seed in SAMPLED_SEEDS:
        torch.manual_seed(seed)
        with torch.no_grad():
            out = model.generate(input_ids=input_ids, attention_mask=torch.ones_like(input_ids), do_sample=True,
                                 temperature=0.7, top_p=0.8, top_k=20, max_new_tokens=400,
                                 eos_token_id=EOS_IDS, pad_token_id=248044)
        generated = [t for t in out[0, len(prompt_ids):].tolist() if t not in EOS_IDS]
        runs.append({'seed': seed, 'output': tokenizer.decode(generated)})
    return runs


def main():
    torch.set_num_threads(4)
    with open(DOPPLER_PATH) as handle:
        doppler = json.load(handle)
    with open(OBSERVED_PATH) as handle:
        observed = json.load(handle)
    report = {'schema': 'reploid.answer-cause.hf-reference/v1', 'machine': 'mac-host', 'device': 'cpu',
              'torch': torch.__version__, 'transformers': transformers.__version__,
              'checkpoint': {'repository': 'Qwen/Qwen3.5-0.8B', 'path': CHECKPOINT, 'files': verify_checkpoint()},
              'turns': []}
    if not all(row['match'] for row in report['checkpoint']['files']):
        raise SystemExit('Local checkpoint differs from the official repository etags')
    tokenizer = AutoTokenizer.from_pretrained(CHECKPOINT, local_files_only=True)
    vocab = tokenizer.get_vocab()
    eos_from_doppler = doppler['inputs']['tokenContract']['eosTokenId']

    turns = []
    for index, turn in enumerate(observed['runs']['run-5']['turns']):
        ordered = doppler['modes']['orderedThreeStage']['turns'][index]
        messages = turn['requestMessages']
        official = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        official_explicit = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True,
                                                          enable_thinking=False)
        official_ids = tokenizer(official, add_special_tokens=False).input_ids
        distributed_ids = [delta_to_token_id(tokenizer, vocab, delta['text']) for delta in turn['streamedDeltas']]
        distributed_ids.append(eos_from_doppler)  # stopReason eos-token; the EOS step streams no text
        turns.append({'label': turn['label'], 'messages': messages, 'prompt': ordered['promptTokenIds'],
                      'distributed': distributed_ids, 'distributedOutput': turn['output']})
        report['turns'].append({
            'label': turn['label'],
            'template': {'officialDefault': official, 'officialEnableThinkingFalse': official_explicit,
                         'dopplerRendered': ordered['renderedPrompt'],
                         'officialEqualsDoppler': official == ordered['renderedPrompt'],
                         'officialExplicitEqualsDefault': official_explicit == official},
            'tokens': {'hfTokenizerIds': official_ids, 'dopplerPromptTokenIds': ordered['promptTokenIds'],
                       'idsEqual': official_ids == ordered['promptTokenIds'], 'count': len(official_ids)},
            'distributedOutputTokenIds': distributed_ids,
            'distributedOutputTokenIdsResolved': all(t is not None for t in distributed_ids),
            'distributedEqualsDopplerOrdered': distributed_ids == ordered['tokenIds'],
            'distributedEqualsDopplerUnsplit': distributed_ids == doppler['modes']['unsplit']['turns'][index]['tokenIds'],
            'variants': {}})

    for dtype_name, dtype in (('float32', torch.float32), ('bfloat16', torch.bfloat16)):
        model = Qwen3_5ForConditionalGeneration.from_pretrained(CHECKPOINT, dtype=dtype, local_files_only=True)
        model.eval()
        for index, turn in enumerate(turns):
            variant = {'greedy': greedy(model, tokenizer, turn['prompt'], f"{turn['label']} {dtype_name} greedy")}
            g = variant['greedy']
            variant['greedyEqualsDistributedTokens'] = g['tokenIds'] == turn['distributed']
            variant['greedyEqualsDistributedText'] = g['output'] == turn['distributedOutput']
            first = next((i for i, (a, b) in enumerate(zip(g['tokenIds'], turn['distributed'])) if a != b), None)
            if first is None and len(g['tokenIds']) != len(turn['distributed']):
                first = min(len(g['tokenIds']), len(turn['distributed']))
            variant['firstTokenDivergenceFromDistributed'] = first
            if all(t is not None for t in turn['distributed']):
                variant['teacherForcedDistributed'] = teacher_forced(model, tokenizer, turn['prompt'], turn['distributed'])
            report['turns'][index]['variants'][dtype_name] = variant
        if dtype_name == 'bfloat16':
            report['supplementary'] = {
                'note': 'Not the application settings. Qwen-recommended non-thinking sampling and a corrected-history '
                        'counterfactual, for context only.',
                'sampledQwenRecommended': {t['label']: sampled(model, tokenizer, t['prompt']) for t in turns}}
            corrected = [dict(m) for m in turns[1]['messages']]
            corrected[1]['content'] = corrected[1]['content'].replace('// Output: [2, 4, 6, 8]', '// Output: [4, 8]')
            corrected_ids = tokenizer(tokenizer.apply_chat_template(corrected, tokenize=False, add_generation_prompt=True),
                                      add_special_tokens=False).input_ids
            report['supplementary']['turn2CorrectedHistoryGreedy'] = {
                'assistantHistory': corrected[1]['content'],
                'result': greedy(model, tokenizer, corrected_ids, 'turn-2 corrected-history bfloat16 greedy')}
        del model

    with open(OUT_PATH, 'x') as handle:
        json.dump(report, handle, indent=1, ensure_ascii=False)
        handle.write('\n')


if __name__ == '__main__':
    main()
