#!/usr/bin/env python3
"""Compare two divergence-capture.mjs outputs operator by operator.

The second run (the paired package) is the proxy for the F64 reference: its final F16 KV caches
must hash-match the approved F64 evaluator's cache identities (checked here), and its logits are
within 1e-6 of the approved vectors. Observation only; nothing is fed back into execution.

Usage: python3 divergence-compare.py <plain capture dir> <paired capture dir> <out.json>
"""
import json
import sys
from pathlib import Path

import numpy as np

# Approved F64 evaluator cache identities for request 2 after all 51 prefixes (234 positions),
# retained in doppler/artifacts/selective-materialization-20261012/cache-coordinate-result-summary.json
# (the intervention that reproduces every approved vector and cache identity).
APPROVED_CACHES = {
    3: ('15db78165e546aa799f369858bb786234e7cb24a103191793593ec8cec57de19', 'f571ec0bc4109446dd89cd8774eb4e7151d6ff742d01dc631484a55362c4d6e3'),
    7: ('861a221b8e4fa461874d87aaa692ad50731ae7d59df16162c123f3096ce5abb7', 'd6fe3b3253bb856cc2ec3278f3a091191aaf2bbba0a6550e8919407aa84348ce'),
    11: ('c2f14f50b334a039b5e841b993ec8c0ad244e645feef489b300b430d4d179b48', '10c65a11a60c8da96fe69cfee8a487e923bfd9cd1258b5e62b93b19b4d34503b'),
    15: ('5c9a59cfdb4316c35f7a9d61ea48c05522d5e7e3c456cafe892938d211febc50', '7d1ae7856eec9af444405e259a09535a3f7dabaf3abd2928b12c44406f9ef040'),
    19: ('5e5f1c281f1b3700b39623bb1aa06bcc035f2ba5ae99857138d140a613f60066', 'c1994bcdbee5184efdadf1aa5e2a9d1f2be8396633db0b001bbd44ab85132ddd'),
    23: ('6a52bedee74dce61275ba39519d8cdedf0d355265bd35a809226fb99f3a3ef4a', 'f347812779527175fdb3046f9a44dad141bb6f101c2aec2a31a5f654463de748'),
}


def load(directory):
    directory = Path(directory)
    report = json.loads((directory / 'report.json').read_text())
    return directory, report


def chunk_sizes(row, prompt_tokens, token_chunk):
    """(token count of each captured chunk in emission order, whether chunks are emitted twice).

    Plain prefill is one chunk; the paired prefill runs 16-token chunks. layer.out is emitted twice per
    chunk (two stages share the canonical name), so its chunks alternate A0, B0, A1, B1, ...
    The paired final norm runs only on the last chunk.
    """
    base = [min(token_chunk, prompt_tokens - start) for start in range(0, prompt_tokens, token_chunk)] if token_chunk else [prompt_tokens]
    if row['chunks'] == len(base) and row['tokens'] == prompt_tokens:
        return base, False, 0
    if row['chunks'] == 2 * len(base) and row['tokens'] == 2 * prompt_tokens:
        return [size for size in base for _ in range(2)], True, 0
    if row['chunks'] == 1:
        return [row['tokens']], False, prompt_tokens - row['tokens']
    raise ValueError(f"unexpected chunking for {row['opId']}: {row['chunks']} chunks, {row['tokens']} tokens")


def captures(directory, report, name, paired_storage):
    """{opId: {token index: row}} from a capture file.

    In the paired run every activation buffer holds hi/lo pairs. Captures labeled f32 there (the paired
    full-attention probes do not pass their representation) read numTokens*width F32 words, i.e. the
    first half of the chunk's tokens as hi/lo pairs; those rows are reconstructed as hi+lo.
    """
    data = np.fromfile(directory / f'{name}.f64', dtype='<f8')
    prompt = report['promptTokens'] if name == 'prefill' else 1
    token_chunk = 16 if (paired_storage and name == 'prefill') else None
    out = {}
    for row in report['captures'][name]:
        values = data[row['offset']:row['offset'] + row['length']]
        width = row['width']
        sizes, duplicated, start = chunk_sizes(row, prompt, token_chunk)
        rows, cursor = {}, 0
        for chunk_index, size in enumerate(sizes):
            chunk = values[cursor:cursor + size * width].reshape(size, width)
            cursor += size * width
            if paired_storage and row['precision'] == 'f32':
                # Mislabeled paired buffer: the read holds the first half of the chunk's elements.
                flat = chunk.reshape(-1, 2).sum(axis=1)
                whole = (len(flat) // width) * width
                chunk = flat[:whole].reshape(-1, width)
            for i in range(len(chunk)):
                rows.setdefault(start + i, chunk[i])  # first emission of a duplicated stage
            if not duplicated or chunk_index % 2 == 1:
                start += size
        out[row['opId']] = rows
    return out


def caches(directory, report, name):
    data = np.fromfile(directory / f'{name}.f16', dtype='<u2')
    out, cursor = {}, 0
    for row in report['caches'][name]:
        count = row['seqLen'] * row['numHeads'] * row['headDim']
        for kind in ('key', 'value'):
            out[(row['layer'], kind)] = data[cursor:cursor + count].reshape(row['seqLen'], row['numHeads'], row['headDim'])
            cursor += count
    return out


def op_order(layer_types):
    order = ['embed.out']
    for layer, kind in enumerate(layer_types):
        names = ['attn.post_input_norm']
        names += (['attn.q_proj', 'attn.k_proj', 'attn.v_proj', 'attn.q_norm', 'attn.k_norm', 'attn.q_rope', 'attn.k_rope', 'attn.core_out']
                  if kind == 'full_attention' else ['attn.qkv_proj', 'attn.linear_z_proj', 'attn.linear_core_out'])
        names += ['attn.out', 'attn.post_attn', 'ffn.out', 'layer.out']
        order += [f'layer.{layer}.{name}' for name in names]
    return order + ['final_norm.out']


def deviation(a, b):
    """a, b: {token: row}. Compared on their common tokens."""
    tokens = sorted(set(a) & set(b))
    if not tokens:
        return {'noCommonTokens': True}
    x, y = np.stack([a[t] for t in tokens]), np.stack([b[t] for t in tokens])
    if x.shape != y.shape:
        return {'shapeMismatch': [list(x.shape), list(y.shape)]}
    d = x - y
    scale = np.sqrt(np.mean(y * y))
    last, last_scale = d[-1], np.sqrt(np.mean(y[-1] * y[-1]))
    return {'tokens': len(tokens), 'lastToken': tokens[-1], 'width': int(x.shape[1]),
            'maxAbs': float(np.max(np.abs(d))), 'relRms': float(np.sqrt(np.mean(d * d)) / scale) if scale else None,
            'exactFraction': float(np.mean(d == 0)),
            'lastTokenMaxAbs': float(np.max(np.abs(last))),
            'lastTokenRelRms': float(np.sqrt(np.mean(last * last)) / last_scale) if last_scale else None,
            'referenceRms': float(scale)}


def main(plain_dir, paired_dir, out_path):
    pd, pr = load(plain_dir)
    qd, qr = load(paired_dir)
    approved_match = {row['layer']: (row['keySha256'], row['valueSha256']) == APPROVED_CACHES[row['layer']]
                      for row in qr['caches']['cache-final']}
    plain_match = {row['layer']: (row['keySha256'], row['valueSha256']) == APPROVED_CACHES[row['layer']]
                   for row in pr['caches']['cache-final']}
    result = {'plain': {'label': pr['label'], 'maxDifference': pr['maxDifference'], 'failedSteps': len(pr['failedSteps'])},
              'referenceProxy': {'label': qr['label'], 'maxDifference': qr['maxDifference'], 'failedSteps': len(qr['failedSteps']),
                                 'finalCachesMatchApprovedF64Identities': approved_match},
              'plainFinalCachesMatchApproved': plain_match}
    pre_plain, pre_ref = captures(pd, pr, 'prefill', False), captures(qd, qr, 'prefill', True)
    full = sorted({int(op.split('.')[1]) for op in pre_plain if op.endswith('attn.k_rope')})
    layers = 1 + max(int(op.split('.')[1]) for op in pre_plain if op.startswith('layer.'))
    layer_types = ['full_attention' if layer in full else 'linear_attention' for layer in range(layers)]
    step = pr['captureStep']
    for phase, a, b in (('prefill', pre_plain, pre_ref),
                        (f'decode-{step}', captures(pd, pr, f'decode-{step}', False), captures(qd, qr, f'decode-{step}', True))):
        rows = []
        for op in op_order(layer_types):
            rows.append({'opId': op, **deviation(a[op], b[op])} if op in a and op in b
                        else {'opId': op, 'missing': [op in a, op in b]})
        result[phase] = rows
    # Stored F16 cache bits: plain against the paired cache (which equals the approved F64 cache).
    for name in ('cache-after-prefill', 'cache-final'):
        cp, cq = caches(pd, pr, name), caches(qd, qr, name)
        rows = []
        for layer in full:
            for kind in ('key', 'value'):
                x, y = cp[(layer, kind)], cq[(layer, kind)]
                differ = x != y
                positions = np.nonzero(differ.any(axis=(1, 2)))[0]
                xf, yf = x.view('<f2').astype(np.float64), y.view('<f2').astype(np.float64)
                rows.append({'layer': layer, 'kind': kind, 'values': int(x.size), 'differentStoredValues': int(differ.sum()),
                             'fraction': float(differ.mean()), 'tokensWithDifference': int(len(positions)),
                             'firstTokenWithDifference': int(positions[0]) if len(positions) else None,
                             'maxUlpSteps': int(np.max(np.abs(x.astype(np.int32) - y.astype(np.int32))[differ])) if differ.any() else 0,
                             'maxAbsChange': float(np.max(np.abs(xf - yf))) if differ.any() else 0.0})
        result[name] = rows
    # Pre-store values against stored bits (plain only: the paired attention probes are partial).
    store, stored = [], caches(pd, pr, 'cache-after-prefill')
    for layer in full:
        for kind, op in (('key', 'attn.k_rope'), ('value', 'attn.v_proj')):
            rows = pre_plain[f'layer.{layer}.{op}']
            values = np.stack([rows[t] for t in sorted(rows)])
            bits = stored[(layer, kind)].reshape(values.shape)
            store.append({'layer': layer, 'kind': kind, 'values': int(bits.size),
                          'plainStoredEqualsNearestF16OfPlainPreStoreValue': int((bits == values.astype('<f2').view('<u2')).sum())})
    result['plainCacheStore'] = store
    # Where the reference capture holds complete pre-store K/V (paired probes with representation),
    # attribute each stored-bit difference: both sides round their own pre-store value to nearest F16.
    attribution, stored_ref = [], caches(qd, qr, 'cache-after-prefill')
    for layer in full:
        for kind, op in (('key', 'attn.k_rope'), ('value', 'attn.v_proj')):
            key = f'layer.{layer}.{op}'
            a, b = pre_plain.get(key, {}), pre_ref.get(key, {})
            if len(b) != len(a) or not a:
                continue
            tokens = sorted(a)
            x, y = np.stack([a[t] for t in tokens]), np.stack([b[t] for t in tokens])
            hx, hy = x.astype('<f2'), y.astype('<f2')
            flips = hx.view('<u2') != hy.view('<u2')
            ref_bits = stored_ref[(layer, kind)].reshape(y.shape)
            plain_bits = stored[(layer, kind)].reshape(x.shape)
            relative = np.abs(x - y) / np.maximum(np.abs(y), 1e-30)
            spacing = np.abs(np.nextafter(hy, np.float16(np.inf), dtype=np.float16).astype(np.float64) - hy.astype(np.float64))
            attribution.append({'layer': layer, 'kind': kind, 'values': int(x.size),
                'referenceStoredEqualsNearestF16OfReferencePreStore': int((ref_bits == hy.view('<u2')).sum()),
                'preStoreRelRms': float(np.sqrt(np.mean((x - y) ** 2)) / np.sqrt(np.mean(y * y))),
                'preStoreMaxRelative': float(relative.max()),
                'nearestF16Differs': int(flips.sum()),
                'storedBitsDiffer': int((plain_bits != ref_bits).sum()),
                'flippedMedianPreStoreRelative': float(np.median(relative[flips])) if flips.any() else None,
                'flippedMedianDistanceInF16Spacings': float(np.median(np.abs(x - y)[flips] / spacing[flips])) if flips.any() else None})
    result['cacheStoreAttribution'] = attribution
    Path(out_path).write_text(json.dumps(result, indent=1) + '\n')


if __name__ == '__main__':
    main(*sys.argv[1:4])
