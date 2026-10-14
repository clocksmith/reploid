"""Assemble the preserved failed examples and the comparison summary from the three
result files. Pure data join; no computation beyond equality checks.

Usage:
  python3 -I assemble.py <distributed-observed.json> <doppler-single-machine.json>
      <hf-reference.json> <q4k-weights-control.json> <failed-examples.json> <comparison.json>
"""
import json
import sys

OBSERVED, DOPPLER, HF, Q4K, EXAMPLES_OUT, COMPARISON_OUT = sys.argv[1:7]
SOURCES = {
    'requestMessages': 'packages/reploid/src/chat/workspace.js:312-317 (history of completed messages; '
                       'system message only if systemContext.content or purpose is non-empty), stored at :125',
    'tokenize': 'packages/reploid/src/mesh/partitions/partition-ordered-chat.js:77 -> Doppler '
                'src/inference/pipelines/text/resident-partition.js:321-347 -> '
                'src/client/model-host/model-session.js:70-89 (tokenizePrompt) -> '
                'src/inference/pipelines/text/chat-format.js:283-299 (formatQwen)',
    'chatTemplate': 'Capsule manifest.json inference.chatTemplate {type: qwen, enabled: true, thinking: false}',
    'generation': 'installed self/config/chat-models.json:12-24 (catalog generation) via '
                  'self/config/partition-generation.js:6-14 and self/host/work-partitions.js:17; '
                  'returned by resident tokenize (resident-partition.js:347) and bound at partition-ordered-chat.js:79-81',
    'sampling': 'Doppler resident-partition.js:207-212 sampleCapsuleLogits(..., seed: samplingSeedForToken(generation.seed, step)); '
                'generation-step.js:9-15; token-sampling.js sample(): temperature 0 => argmax after masking padTokenId',
    'stopping': 'Doppler generation-step.js:18-26 stoppingReason (eos-token, stop tokens, stopSequences, maxTokens)',
}


def load(path):
    with open(path) as handle:
        return json.load(handle)


def main():
    observed, doppler, hf, q4k = load(OBSERVED), load(DOPPLER), load(HF), load(Q4K)
    examples, rows = [], []
    for index, turn in enumerate(observed['runs']['run-5']['turns']):
        ordered = doppler['modes']['orderedThreeStage']['turns'][index]
        unsplit = doppler['modes']['unsplit']['turns'][index]
        ref = hf['turns'][index]
        run4 = observed['runs']['run-4']['turns'][index]
        examples.append({
            'label': turn['label'],
            'question': observed['runs']['run-5']['questions'][index],
            'requestMessages': turn['requestMessages'],
            'systemContext': turn['systemContext'],
            'renderedPrompt': ordered['renderedPrompt'],
            'promptTokenIds': ordered['promptTokenIds'],
            'promptTokenCount': ordered['promptTokenCount'],
            'settings': {'generation': doppler['inputs']['generation'], 'generationDigest': doppler['inputs']['generationDigest'],
                         'seed': doppler['inputs']['seed'], 'chatTemplate': doppler['inputs']['chatTemplate'],
                         'tokenContract': doppler['inputs']['tokenContract']},
            'distributed': {
                'run-5': {'report': observed['runs']['run-5']['report'], 'attemptId': turn['attemptId'],
                          'output': turn['output'], 'stopReason': turn['stopReason'], 'decodeSteps': turn['decodeSteps'],
                          'activationBytes': turn['activationBytes'], 'impliedPromptTokens': turn['impliedPromptTokens'],
                          'outputTokenIds': ref['distributedOutputTokenIds'],
                          'outputTokenIdsSource': 'streamed per-step deltas mapped through the byte-level vocabulary, plus the EOS step'},
                'run-4': {'report': observed['runs']['run-4']['report'], 'attemptId': run4['attemptId'],
                          'output': run4['output'], 'stopReason': run4['stopReason'], 'decodeSteps': run4['decodeSteps'],
                          'activationBytes': run4['activationBytes']},
            },
            'correctAnswer': '[4, 8]' if index == 0 else '[-4, 12]',
            'sources': SOURCES,
        })
        variants = ref['variants']
        control = q4k['turns'][index]
        worst = 0.0
        for d_step, q_step in zip(ordered['steps'], control['greedy']['steps']):
            q_logits = {x['tokenId']: x['logit'] for x in q_step['top5']}
            for x in d_step['top5']:
                if x['tokenId'] in q_logits:
                    worst = max(worst, abs(x['logit'] - q_logits[x['tokenId']]))
        rows.append({
            'label': turn['label'],
            'distributedOutput': turn['output'],
            'distributedDecodeSteps': turn['decodeSteps'],
            'promptTokenCount': {'doppler': ordered['promptTokenCount'], 'impliedByDistributedActivationBytes': turn['impliedPromptTokens'],
                                 'match': ordered['promptTokenCountMatchesDistributedActivationBytes']},
            'template': {'officialEqualsDoppler': ref['template']['officialEqualsDoppler'],
                         'hfTokenIdsEqualDoppler': ref['tokens']['idsEqual']},
            'dopplerOrderedThreeStage': {'output': ordered['output'], 'decodeSteps': ordered['decodeSteps'],
                                         'activationBytes': ordered['activationBytes'],
                                         'activationBytesEqualDistributed': ordered['activationBytes'] == turn['activationBytes'],
                                         'tokenIdsEqualDistributed': ref['distributedEqualsDopplerOrdered'],
                                         'firstDivergence': ordered['firstDeltaDivergenceFromDistributed']},
            'dopplerUnsplit': {'output': unsplit['output'], 'decodeSteps': unsplit['decodeSteps'],
                               'tokenIdsEqualDistributed': ref['distributedEqualsDopplerUnsplit'],
                               'firstDivergence': unsplit['firstDeltaDivergenceFromDistributed']},
            'q4kWeightsControl': {'output': control['greedy']['output'], 'decodeSteps': control['greedy']['decodeSteps'],
                                  'tokenIdsEqualDistributed': control['greedy']['tokenIds'] == ref['distributedOutputTokenIds'],
                                  'teacherForcedDisagreementSteps': control['teacherForcedOnDopplerTokens']['disagreementSteps'],
                                  'maxAbsTop5LogitDifferenceVsDopplerOrdered': worst,
                                  'minMarginTop1Top2': min(s['marginTop1Top2'] for s in control['greedy']['steps'])},
            'hf': {name: {'output': v['greedy']['output'], 'decodeSteps': v['greedy']['decodeSteps'],
                          'tokenIdsEqualDistributed': v['greedyEqualsDistributedTokens'],
                          'firstTokenDivergence': v['firstTokenDivergenceFromDistributed'],
                          'teacherForcedAgreesAtEveryStep': v.get('teacherForcedDistributed', {}).get('agreesAtEveryStep'),
                          'teacherForcedFirstDisagreement': v.get('teacherForcedDistributed', {}).get('firstDisagreementStep')}
                   for name, v in variants.items()},
        })
    with open(EXAMPLES_OUT, 'x') as handle:
        json.dump({'schema': 'reploid.answer-cause.failed-examples/v1',
                   'model': {'id': observed['installedCatalog']['modelId'], 'identity': observed['installedCatalog']['identity'],
                             'runtimeArchive': observed['runs']['run-5']['freeze']['runtimeArchive'],
                             'planId': observed['runs']['run-5']['freeze']['planId']},
                   'examples': examples}, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    with open(COMPARISON_OUT, 'x') as handle:
        json.dump({'schema': 'reploid.answer-cause.comparison/v1',
                   'doppler': {'gpu': doppler['gpu'], 'verification': doppler['verification']},
                   'hfCheckpoint': hf['checkpoint'], 'rows': rows,
                   'q4kWeightsControl': {'versions': q4k['versions'], 'precision': q4k['precision'],
                                         'weights': {k: q4k['weights'][k] for k in ('tensorDtypeCounts', 'lmHeadDtype', 'embedDtype', 'tensorCount')}},
                   'supplementary': {'hfSourceCheckpoint': hf.get('supplementary'),
                                     'q4kWeightsControl': {
                                         'deployedTurn2CorrectedHistory': q4k['supplementary']['deployedTurn2CorrectedHistory']['output'],
                                         'deployedBodyTiedF16Head': [{k: t[k] for k in ('label', 'output', 'firstTokenDivergenceFromDoppler')}
                                                                     for t in q4k['supplementary']['deployedBodyTiedF16Head']]}}}, handle, indent=1, ensure_ascii=False)
        handle.write('\n')
    print(json.dumps(rows, indent=1, ensure_ascii=False)[:4000])


if __name__ == '__main__':
    main()
